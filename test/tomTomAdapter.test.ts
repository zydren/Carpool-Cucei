/**
 * Pruebas del adaptador puro TomTom -> RouteResult.
 *
 * Ejecutar con el runner built-in de Node (sin dependencias instaladas):
 *   node --test test/
 *
 * Node >= 22.18 / 23.6 ejecuta TypeScript por "type stripping" sin compilar.
 * Este archivo está FUERA de `src/` a propósito: el build de la app
 * (`tsc -b`) solo cubre `src`, así estas pruebas no entran al bundle.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tomTomRouteToRouteResult } from '../src/services/tomTomAdapter.ts';
import {
  tomTomRouteValid,
  tomTomRouteMissingHistoric,
  tomTomRouteShortGeometry,
  tomTomRouteWithBadPoints,
  tomTomRouteEmpty,
  tomTomRouteNull,
  tomTomRouteOutOfRange,
  tomTomRouteDuplicatedConsecutive,
  tomTomRouteNegativeDistance,
  tomTomRouteNegativeDuration,
} from './tomTomAdapter.fixture.ts';

test('mapea distance desde summary.lengthInMeters', () => {
  const result = tomTomRouteToRouteResult(tomTomRouteValid);
  assert.ok(result);
  assert.equal(result.distance, 5230);
});

test('usa la duración HISTÓRICA (no travelTimeInSeconds ni noTraffic)', () => {
  const result = tomTomRouteToRouteResult(tomTomRouteValid);
  assert.ok(result);
  // Debe ser 845 (historicTrafficTravelTimeInSeconds), NO 900 ni 780.
  assert.equal(result.duration, 845);
});

test('convierte la geometría a LineString [lng, lat] y deduplica la unión entre legs', () => {
  const result = tomTomRouteToRouteResult(tomTomRouteValid);
  assert.ok(result);
  assert.equal(result.geometry.type, 'LineString');
  // leg1: [A,B] + leg2: [B,C]; B es el punto de unión compartido y se elimina
  // el duplicado consecutivo -> quedan 3 coordenadas: A, B, C.
  assert.equal(result.geometry.coordinates.length, 3);
  // El primer punto era {lat 20.6586, lng -103.3254} -> [-103.3254, 20.6586].
  assert.deepEqual(result.geometry.coordinates[0], [-103.3254, 20.6586]);
  // El segundo punto conserva la unión {lat 20.6601, lng -103.3298}.
  assert.deepEqual(result.geometry.coordinates[1], [-103.3298, 20.6601]);
  // No debe haber dos puntos consecutivos idénticos (sin segmentos de longitud cero).
  for (let i = 1; i < result.geometry.coordinates.length; i += 1) {
    const prev = result.geometry.coordinates[i - 1];
    const curr = result.geometry.coordinates[i];
    assert.notDeepEqual(prev, curr, `puntos ${i - 1} y ${i} están duplicados`);
  }
});

test('descarta puntos con coordenadas no finitas (NaN/undefined)', () => {
  const result = tomTomRouteToRouteResult(tomTomRouteWithBadPoints);
  assert.ok(result);
  // De 5 puntos crudos, 2 son inválidos -> quedan 3 válidos.
  assert.equal(result.geometry.coordinates.length, 3);
  for (const [lng, lat] of result.geometry.coordinates) {
    assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
  }
});

test('descarta puntos fuera de rango geográfico (lat/lng inválidos)', () => {
  const result = tomTomRouteToRouteResult(tomTomRouteOutOfRange);
  assert.ok(result);
  // De 7 puntos crudos, 4 están fuera de rango -> quedan 3 válidos.
  assert.equal(result.geometry.coordinates.length, 3);
  for (const [lng, lat] of result.geometry.coordinates) {
    assert.ok(lat >= -90 && lat <= 90, `latitud fuera de rango: ${lat}`);
    assert.ok(lng >= -180 && lng <= 180, `longitud fuera de rango: ${lng}`);
  }
});

test('elimina puntos consecutivos duplicados (sin segmentos de longitud cero)', () => {
  const result = tomTomRouteToRouteResult(tomTomRouteDuplicatedConsecutive);
  assert.ok(result);
  // 5 puntos crudos con duplicados consecutivos -> 3 puntos distintos (A,B,C).
  assert.equal(result.geometry.coordinates.length, 3);
});

test('devuelve null si distance (lengthInMeters) es negativa', () => {
  assert.equal(tomTomRouteToRouteResult(tomTomRouteNegativeDistance), null);
});

test('devuelve null si la duración histórica es negativa', () => {
  assert.equal(tomTomRouteToRouteResult(tomTomRouteNegativeDuration), null);
});

test('no modifica el objeto de entrada', () => {
  // Copia profunda del fixture antes de la conversión.
  const before = structuredClone(tomTomRouteValid);
  tomTomRouteToRouteResult(tomTomRouteValid);
  // El fixture debe permanecer idéntico (deepEqual con la copia previa).
  assert.deepEqual(tomTomRouteValid, before);
});

test('devuelve null si falta la duración histórica', () => {
  assert.equal(tomTomRouteToRouteResult(tomTomRouteMissingHistoric), null);
});

test('devuelve null si la geometría tiene menos de 2 puntos válidos', () => {
  assert.equal(tomTomRouteToRouteResult(tomTomRouteShortGeometry), null);
});

test('devuelve null si no hay rutas', () => {
  assert.equal(tomTomRouteToRouteResult(tomTomRouteEmpty), null);
});

test('devuelve null ante respuesta nula (defensa)', () => {
  assert.equal(tomTomRouteToRouteResult(tomTomRouteNull), null);
});
