/**
 * Pruebas de la lógica PURA del proxy TomTom (`parseRouteProxyRequest` y
 * `buildTomTomRouteUrl`): validación del body de la petición y construcción de
 * la URL de `calculateRoute`.
 *
 * Cero llamadas HTTP, cero variables de entorno, cero dependencias.
 * Ejecutar con el runner built-in de Node (type stripping nativo):
 *   node --test test/
 *
 * Este archivo vive FUERA de `src/` a propósito: `tsc -b` solo cubre `src`,
 * así estas pruebas no entran al bundle de la app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRouteProxyRequest,
  buildTomTomRouteUrl,
  TOMTOM_ROUTE_BASE_URL,
  MAX_PROXY_POINTS,
} from '../src/services/tomTomRouteProxyRequest.ts';

/** Punto de ejemplo válido (zona CUCEI / Guadalajara). */
const origin = { lat: 20.6586, lng: -103.3254 };
const waypoint = { lat: 20.6601, lng: -103.3298 };
const destination = { lat: 20.6751, lng: -103.3122 };
const departAt = '2026-10-14T08:00:00-06:00';

/** Cuerpo válido de referencia. */
const validBody = () => ({
  origin,
  destination,
  waypoints: [waypoint],
  departAt,
});

// ============================================================
// parseRouteProxyRequest
// ============================================================

test('rechaza cuerpos que no son objetos JSON', () => {
  for (const raw of [null, undefined, 'texto', 42, true]) {
    const result = parseRouteProxyRequest(raw);
    assert.equal(result.ok, false, `debió rechazar: ${String(raw)}`);
  }
});

test('rechaza si falta el origen', () => {
  const result = parseRouteProxyRequest({ destination, departAt });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Origen inválido/);
});

test('rechaza si falta el destino', () => {
  const result = parseRouteProxyRequest({ origin, departAt });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Destino inválido/);
});

test('rechaza coordenadas fuera de rango geográfico (WGS84)', () => {
  const outOfRange = [
    { origin: { lat: 95, lng: -103.3254 }, destination, departAt }, // lat > 90
    { origin: { lat: 20.6586, lng: 200 }, destination, departAt }, // lng > 180
    { origin: { lat: -91, lng: -103.3254 }, destination, departAt }, // lat < -90
    { origin: { lat: 20.6586, lng: -181 }, destination, departAt }, // lng < -180
    { origin, destination: { lat: 999, lng: 0 }, departAt }, // destino inválido
  ];
  for (const raw of outOfRange) {
    const result = parseRouteProxyRequest(raw);
    assert.equal(result.ok, false, `debió rechazar: ${JSON.stringify(raw)}`);
  }
});

test('rechaza coordenadas no finitas (NaN/Infinity)', () => {
  for (const raw of [
    { origin: { lat: NaN, lng: -103.3254 }, destination, departAt },
    { origin, destination: { lat: 20.6, lng: Infinity }, departAt },
  ]) {
    const result = parseRouteProxyRequest(raw);
    assert.equal(result.ok, false, `debió rechazar: ${JSON.stringify(raw)}`);
  }
});

test('rechaza departAt ausente o vacío', () => {
  assert.equal(parseRouteProxyRequest({ origin, destination }).ok, false);
  assert.equal(parseRouteProxyRequest({ origin, destination, departAt: '' }).ok, false);
  assert.equal(parseRouteProxyRequest({ origin, destination, departAt: '  ' }).ok, false);
  assert.equal(parseRouteProxyRequest({ origin, destination, departAt: 12345 }).ok, false);
});

test('rechaza waypoints que no sean puntos válidos', () => {
  const result = parseRouteProxyRequest({
    origin,
    destination,
    waypoints: [{ lat: 20.66, lng: -103.33 }, { lat: 999, lng: 0 }],
    departAt,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /intermedios inválidos/);
  // También si `waypoints` no es un array.
  assert.equal(
    parseRouteProxyRequest({ origin, destination, waypoints: 'nope', departAt }).ok,
    false
  );
});


test('rechaza cuerpos con exceso de puntos (límite MAX_PROXY_POINTS)', () => {
  const many = Array.from({ length: MAX_PROXY_POINTS - 1 }, () => waypoint); // 2 + 24 = 26 > 25
  const result = parseRouteProxyRequest({ origin, destination, waypoints: many, departAt });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, new RegExp(String(MAX_PROXY_POINTS)));

  // Justo en el límite: 2 + 23 = 25 puntos -> válido.
  const atLimit = Array.from({ length: MAX_PROXY_POINTS - 2 }, () => waypoint);
  assert.equal(
    parseRouteProxyRequest({ origin, destination, waypoints: atLimit, departAt }).ok,
    true
  );
});

test('acepta un cuerpo válido y normaliza los waypoints a [] si faltan', () => {
  const result = parseRouteProxyRequest(validBody());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.origin, origin);
    assert.deepEqual(result.value.destination, destination);
    assert.deepEqual(result.value.waypoints, [waypoint]);
    assert.equal(result.value.departAt, departAt);
  }

  const withoutWaypoints = parseRouteProxyRequest({ origin, destination, departAt });
  assert.equal(withoutWaypoints.ok, true);
  if (withoutWaypoints.ok) {
    assert.deepEqual(withoutWaypoints.value.waypoints, []);
  }
});

// ============================================================
// buildTomTomRouteUrl
// ============================================================

test('construye la URL con el formato lat,lng y el orden origen:paradas:destino', () => {
  const parsed = parseRouteProxyRequest(validBody());
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const url = new URL(buildTomTomRouteUrl(parsed.value, 'CLAVE-DE-PRUEBA'));

  // TomTom Routing API v1 espera `latitud,longitud` (¡NO longitud,latitud!) separados por ':'.
  assert.equal(
    `${url.origin}${url.pathname}`,
    `${TOMTOM_ROUTE_BASE_URL}/20.6586,-103.3254:20.6601,-103.3298:20.6751,-103.3122/json`
  );
});

test('incluye los parámetros obligatorios: computeTravelTimeFor=all, departAt y la clave', () => {
  const parsed = parseRouteProxyRequest(validBody());
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const url = new URL(buildTomTomRouteUrl(parsed.value, 'CLAVE-DE-PRUEBA'));

  assert.equal(url.searchParams.get('computeTravelTimeFor'), 'all');
  assert.equal(url.searchParams.get('departAt'), departAt); // se usa tal cual, con su zona horaria
  assert.equal(url.searchParams.get('key'), 'CLAVE-DE-PRUEBA');
  assert.equal(url.searchParams.get('traffic'), 'true');
  assert.equal(url.searchParams.get('routeType'), 'fastest');
});

test('sin waypoints la ruta es solo origen:destino', () => {
  const parsed = parseRouteProxyRequest({ origin, destination, departAt });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const url = new URL(buildTomTomRouteUrl(parsed.value, 'K'));
  assert.equal(
    `${url.origin}${url.pathname}`,
    `${TOMTOM_ROUTE_BASE_URL}/20.6586,-103.3254:20.6751,-103.3122/json`
  );
});

test('cada punto del path va en orden lat,lng y la latitud queda en [-90,90]', () => {
  const parsed = parseRouteProxyRequest(validBody());
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const url = new URL(buildTomTomRouteUrl(parsed.value, 'K'));
  // /routing/1/calculateRoute/<puntos>/json
  const segments = url.pathname.split('/').filter(Boolean);
  const locations = segments[3];
  assert.ok(typeof locations === 'string', `path inesperado: ${url.pathname}`);

  // Origen, parada intermedia y destino, en ese orden y en formato lat,lng.
  const parts = locations.split(':');
  assert.deepEqual(parts, [
    '20.6586,-103.3254',
    '20.6601,-103.3298',
    '20.6751,-103.3122',
  ]);

  for (const part of parts) {
    const [lat, lng] = part.split(',').map(Number);
    // La latitud va PRIMERA y debe estar en rango: la coordenada de
    // Guadalajara (-103.3254) no puede enviarse como latitud.
    assert.ok(
      Number.isFinite(lat) && lat >= -90 && lat <= 90,
      `latitud fuera de [-90,90]: ${String(lat)}`
    );
    assert.ok(
      Number.isFinite(lng) && lng >= -180 && lng <= 180,
      `longitud fuera de [-180,180]: ${String(lng)}`
    );
  }
});

test('codifica la clave en la query (caracteres especiales seguros)', () => {
  const parsed = parseRouteProxyRequest(validBody());
  assert.ok(parsed.ok);
  if (!parsed.ok) return;

  const trickyKey = 'abc+def/ghi=jkl mno';
  const url = new URL(buildTomTomRouteUrl(parsed.value, trickyKey));
  // Puede recuperarse intacta vía URLSearchParams (ya viene codificada en la URL).
  assert.equal(url.searchParams.get('key'), trickyKey);
  assert.ok(url.href.includes('key=abc%2Bdef%2Fghi%3Djkl+mno'));
});
