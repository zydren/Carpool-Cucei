/**
 * Pruebas del helper puro `buildDepartAt` (src/utils/departAt.ts): compone el
 * `departAt` RFC 3339 de TomTom desde las cadenas locales del formulario,
 * con validación estricta, cálculo real del offset (tzdata del runtime) e
 * independencia de la zona horaria del dispositivo.
 *
 * Cero red, cero dependencias. Ejecutar con el runner built-in de Node:
 *   node --test test/departAt.test.ts
 *
 * Este archivo vive FUERA de `src/` a propósito: `tsc -b` solo cubre `src`,
 * así estas pruebas no entran al bundle de la app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildDepartAt } from '../src/utils/departAt.ts';

/** Patrón de una salida RFC 3339 con segundos y offset explícito. */
const RFC_3339_OUTPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/;

// ============================================================
// Caso feliz: formato, offset y conservación de la hora de pared
// ============================================================

test('fecha/hora válida → RFC 3339 con segundos y offset de America/Mexico_City', () => {
  // Octubre 2026 (UTC-06:00 permanente en México desde oct-2022).
  assert.equal(buildDepartAt('2026-10-15', '08:00'), '2026-10-15T08:00:00-06:00');
  assert.equal(buildDepartAt('2026-01-01', '00:00'), '2026-01-01T00:00:00-06:00');
  assert.equal(buildDepartAt('2026-12-31', '23:59'), '2026-12-31T23:59:00-06:00');
});

test('la salida siempre lleva segundos ":00" y sufijo offset RFC 3339', () => {
  const value = buildDepartAt('2026-10-15', '08:00');
  assert.ok(value !== null);
  assert.match(value, RFC_3339_OUTPUT);
  // La hora de pared se conserva intacta (no se desplaza al convertir).
  assert.equal(value.slice(0, 16), '2026-10-15T08:00');
});

test('acepta los límites de fecha y hora válidos (casos límite)', () => {
  assert.equal(buildDepartAt('2026-10-15', '00:00'), '2026-10-15T00:00:00-06:00');
  assert.equal(buildDepartAt('2026-10-15', '23:59'), '2026-10-15T23:59:00-06:00');
  // Año bisiesto: 29 de febrero existe.
  assert.equal(buildDepartAt('2024-02-29', '10:30'), '2024-02-29T10:30:00-06:00');
  assert.equal(buildDepartAt('2028-02-29', '10:30'), '2028-02-29T10:30:00-06:00');
});

// ============================================================
// Validación estricta: nunca normaliza entradas imposibles
// ============================================================

test('rechaza fechas imposibles o mal formadas (devuelve null, sin normalizar)', () => {
  const invalidas = [
    '2026-02-30', // febrero de 2026 tiene 28 días
    '2025-02-29', // 2025 no es bisiesto
    '2026-13-01', // mes inexistente
    '2026-00-10', // mes 0
    '2026-04-31', // abril tiene 30 días
    '2026-4-5', // sin ceros a la izquierda
    '20261015', // sin guiones
    '15/10/2026', // otro separador
    '2026-10-15T08:00', // fecha con hora incluida
    '',
  ];
  for (const date of invalidas) {
    assert.equal(buildDepartAt(date, '08:00'), null, `debió rechazar fecha: ${date}`);
  }
});

test('rechaza horas fuera de rango o mal formadas (devuelve null)', () => {
  const invalidas = [
    '25:90', // fuera de rango
    '24:00', // 24:00 no existe (23:59 es el máximo)
    '23:60', // minuto 60
    '08:60', // minuto 60
    '8:00', // sin cero inicial
    '08:0', // minutos incompletos
    '08:00:00', // la entrada es solo HH:MM (el formulario no tiene segundos)
    'ab:cd', // no numérica
    '',
  ];
  for (const time of invalidas) {
    assert.equal(buildDepartAt('2026-10-15', time), null, `debió rechazar hora: ${time}`);
  }
});

test('devuelve null ante entradas que no son cadenas (defensa en runtime)', () => {
  assert.equal(buildDepartAt(undefined as unknown as string, '08:00'), null);
  assert.equal(buildDepartAt('2026-10-15', null as unknown as string), null);
  assert.equal(buildDepartAt(20261015 as unknown as string, '08:00'), null);
});

// ============================================================
// Zona horaria: cálculo real del offset, no constante mágica
// ============================================================

test('el offset corresponde a la fecha pedida (DST histórico real del tzdata)', () => {
  // México observaba DST hasta oct-2022: mayo-2021 y jun-2022 → -05:00.
  assert.equal(buildDepartAt('2021-05-15', '08:00'), '2021-05-15T08:00:00-05:00');
  assert.equal(buildDepartAt('2022-06-01', '08:00'), '2022-06-01T08:00:00-05:00');
  // Enero (invierno) → -06:00 en cualquier año.
  assert.equal(buildDepartAt('2021-01-15', '08:00'), '2021-01-15T08:00:00-06:00');
  // Tras el decreto de UTC-6 permanente: todo 2023 y fechas futuras → -06:00.
  assert.equal(buildDepartAt('2023-05-15', '08:00'), '2023-05-15T08:00:00-06:00');
});

test('el resultado no depende de la zona horaria del dispositivo (TZ en proceso hijo)', () => {
  const esperado = '2026-10-15T08:00:00-06:00';
  const helperUrl = new URL('../src/utils/departAt.ts', import.meta.url).href;

  for (const tz of ['America/New_York', 'Asia/Tokyo', 'UTC', 'America/Mexico_City']) {
    const script =
      `const { buildDepartAt } = await import(${JSON.stringify(helperUrl)});` +
      `process.stdout.write(String(buildDepartAt('2026-10-15', '08:00')));`;
    const salida = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
    assert.equal(salida, esperado, `TZ=${tz} alteró el resultado`);
  }
});

// ============================================================
// Política de horas inexistentes/ambiguas (transiciones históricas)
// ============================================================

test('horas inexistentes o ambiguas por transición: conserva la hora de pared y emite offset válido', () => {
  // 2021-04-04 02:30 no existió en Mexico City (el reloj saltó 02:00→03:00).
  // 2021-10-31 01:30 ocurrió dos veces (reloj retrocedió 02:00→01:00).
  // Política documentada: la hora escrita por el usuario NO se corrige; solo
  // se adjunta el offset determinista calculado para esa fecha.
  const casos: Array<[string, string]> = [
    ['2021-04-04', '02:30'], // inexistente (avance de reloj)
    ['2021-10-31', '01:30'], // ambigua (regreso de reloj)
  ];

  for (const [date, time] of casos) {
    const value = buildDepartAt(date, time);
    assert.ok(value !== null, `debió producir un valor para ${date} ${time}`);
    assert.equal(value.slice(0, 16), `${date}T${time}`, 'la hora de pared debe conservarse');
    assert.match(value, RFC_3339_OUTPUT);
    // El offset siempre queda dentro del rango histórico de México (-06/-05).
    assert.ok(
      value.endsWith('-06:00') || value.endsWith('-05:00'),
      `offset inesperado para ${date} ${time}: ${value}`
    );
  }
});
