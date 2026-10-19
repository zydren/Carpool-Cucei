/**
 * Verificación de cableado de la Etapa 3 en src/pages/OfferTripPage.tsx.
 *
 * El proyecto no tiene infraestructura de pruebas de componentes React (sin
 * vitest/jsdom/react-testing-library; agregar dependencias está fuera de
 * alcance), así que estas pruebas verifican sobre el FUENTE los invariantes
 * que la etapa debe garantizar y que de otro modo solo se podrían comprobar
 * en un navegador:
 *
 *  1. `departAt` se compone con `buildDepartAt(formData.date, formData.time)`
 *     dentro de `recalculateRoute` (no se lee el reloj del dispositivo).
 *  2. Las dos entradas de cálculo (ruta directa y ruta con puntos de paso)
 *     pasan `departAt` como último argumento del servicio.
 *  3. Cambiar la fecha o la hora invalida la ruta vía el mecanismo existente
 *     (`invalidateRouteForWaypointChange`: token + limpieza de estado).
 *  4. El recálculo manual pasa el token vigente para que una invalidación
 *     posterior descarte su respuesta (una respuesta vieja no sobrescribe).
 *  5. El botón «Recalcular ruta» está disponible también sin puntos de paso.
 *  6. Sin offsets manuales ni fechas inventadas en la página.
 *
 * Es una prueba de CABLEADO, no de comportamiento en runtime: el
 * comportamiento del servicio (despacho TomTom/OSRM, fallback, formatos de
 * fecha) está cubierto por test/routingService.test.ts y test/departAt.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/pages/OfferTripPage.tsx', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n');

/** Extrae el cuerpo delimitado por llaves que sigue a `marker` (sin anidar
    llaves dentro de cadenas o comentarios en estas funciones). */
const extractBraceBlock = (code: string, marker: string): string => {
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, `No se encontró «${marker}» en OfferTripPage.tsx`);
  const open = code.indexOf('{', start + marker.length);
  assert.notEqual(open, -1, `No se encontró «{» tras «${marker}»`);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`Bloque sin cerrar tras «${marker}»`);
};

const RECALCULATE_ROUTE_MARKER =
  'const recalculateRoute = async (lat: number, lng: number, token?: number) => {';

test('importa buildDepartAt desde el servicio de rutas (fuente única)', () => {
  const importMatch = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/services\/routingService'/.exec(source);
  assert.ok(importMatch, 'Falta el import de valores desde ../services/routingService');
  assert.match(importMatch[1], /\bbuildDepartAt\b/, 'buildDepartAt debe importarse del servicio');
});

test('compone departAt con la fecha y hora actuales del formulario', () => {
  const fn = extractBraceBlock(source, RECALCULATE_ROUTE_MARKER);
  assert.match(fn, /buildDepartAt\(formData\.date,\s*formData\.time\)/);
});

test('la ruta directa pasa departAt a calculateRoute', () => {
  assert.match(
    source,
    /calculateRoute\(\s*lng,\s*lat,\s*CUCEI_COORDS\.lng,\s*CUCEI_COORDS\.lat,\s*departAt\s*\)/
  );
});

test('la ruta con puntos de paso pasa departAt a buildWaypointRoute', () => {
  assert.match(
    source,
    /buildWaypointRoute\(\s*origin,\s*waypoints,\s*CUCEI_COORDS,\s*departAt\s*\)/
  );
});

test('cambiar la fecha o la hora invalida la ruta calculada', () => {
  const fn = extractBraceBlock(source, 'const handleChange = (');
  assert.match(fn, /name === 'date' \|\| name === 'time'/);
  assert.match(fn, /invalidateRouteForWaypointChange\(\)/);
});

test('la invalidación usa el token anti-carrera y limpia el resultado', () => {
  const fn = extractBraceBlock(source, 'const invalidateRouteForWaypointChange = () => {');
  assert.match(fn, /originActionRef\.current \+= 1/, 'debe descartar cálculos en curso');
  assert.match(fn, /setRouteResult\(null\)/, 'debe limpiar la ruta calculada');
  assert.match(fn, /setIsCalculatingRoute\(false\)/, 'debe liberar el indicador de cálculo');
});

test('el recálculo manual pasa el token vigente (las respuestas viejas se descartan)', () => {
  const manual = extractBraceBlock(source, 'const handleManualRecalculate = () => {');
  assert.match(
    manual,
    /recalculateRoute\(originPoint\.lat,\s*originPoint\.lng,\s*originActionRef\.current\)/
  );
  const recalc = extractBraceBlock(source, RECALCULATE_ROUTE_MARKER);
  assert.match(
    recalc,
    /token !== undefined && token !== originActionRef\.current/,
    'el guardia isStale de recalculateRoute debe seguir intacto'
  );
});

test('el botón «Recalcular ruta» está disponible también sin puntos de paso', () => {
  assert.match(
    source,
    /\{\(originPoint \|\| waypoints\.length > 0\) && \(\s*<Button[\s\S]*?onClick=\{handleManualRecalculate\}/
  );
});

test('la página no usa el reloj del dispositivo ni fabrica offsets manualmente', () => {
  // Se ignoran comentarios: pueden mencionar `new Date(...)` para explicar
  // por qué NO se usa (caso del parseo de fechas) u offsets de ejemplo.
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!codeOnly.includes('new Date('), 'No debe construirse una fecha con el reloj del dispositivo');
  assert.ok(!codeOnly.includes('Date.now'), 'No debe leerse el reloj del dispositivo');
  assert.ok(
    !/[-+]\d{2}:\d{2}/.test(codeOnly),
    'Offset manual detectado; el offset de America/Mexico_City lo calcula buildDepartAt'
  );
});

test('la página no llama calculateRouteThrough directamente (solo puntos de entrada del servicio)', () => {
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(
    !codeOnly.includes('calculateRouteThrough'),
    'La ruta con paradas se pide con buildWaypointRoute, que internamente usa calculateRouteThrough'
  );
});

// ============================================================
// Etapa 4: indicador de proveedor y botón «Recalcular ruta
// según fecha y hora»
// ============================================================

test('existe el botón «Recalcular ruta según fecha y hora» ligado a su handler', () => {
  assert.match(source, /Recalcular ruta según fecha y hora/, 'falta el texto del botón');
  const index = source.indexOf('Recalcular ruta según fecha y hora');
  // El botón cercano debe usar el handler nuevo (no handleManualRecalculate).
  const around = source.slice(Math.max(0, index - 600), index);
  assert.match(around, /onClick=\{handleRecalculateByDepartAt\}/);
  assert.match(around, /disabled=\{!originPoint \|\| isCalculatingRoute\}/,
    'el botón debe deshabilitarse durante el cálculo (sin duplicados)');
});

test('handleRecalculateByDepartAt valida con buildDepartAt ANTES de recalcular', () => {
  // Marker SIN la llave final: extractBraceBlock contaría desde el primer
  // bloque interno (if) y cortaría antes de la llamada al servicio.
  const fn = extractBraceBlock(source, 'const handleRecalculateByDepartAt = () =>');
  // Guardia de duplicados durante la carga.
  assert.match(fn, /!originPoint \|\| isCalculatingRoute/, 'falta la guardia de duplicados');
  // Valida la hora con buildDepartAt leyendo la fecha/hora ACTUALES del formulario.
  assert.match(fn, /buildDepartAt\(formData\.date,\s*formData\.time\)/,
    'debe validar con buildDepartAt sobre formData actual');
  // Rama de error: mensaje comprensible y NO se ejecuta el cálculo.
  assert.match(fn, /if \(!departAt\) \{/, 'falta la validación de departAt');
  assert.match(fn, /setRouteError\(/, 'debe notificar un error comprensible');
  assert.match(fn, /return;/, 'debe salir sin recalcular si la hora es inválida');
  // Rama válida: reutiliza el flujo existente con el token vigente.
  assert.match(
    fn,
    /recalculateRoute\(originPoint\.lat,\s*originPoint\.lng,\s*originActionRef\.current\)/,
    'debe reutilizar recalculateRoute con el token vigente'
  );
  // El return temprano debe ANTECEDER a la llamada: si la hora no vale, no hay cálculo.
  const validation = fn.indexOf('if (!departAt)');
  const call = fn.indexOf('recalculateRoute(');
  assert.ok(validation !== -1 && call !== -1 && validation < call,
    'la validación debe preceder a la llamada de recálculo');
});

test('el indicador muestra el proveedor del RESULTADO, no la bandera de entorno', () => {
  assert.match(source, /routeResult\.provider === 'tomtom' \? 'TomTom' : 'OSRM'/,
    'el indicador debe leer routeResult.provider');
  assert.match(source, /Sistema de cálculo/, 'falta la etiqueta visible');
  // No se consulta la bandera directamente en la página (evita mostrar
  // «TomTom» cuando en realidad respondió OSRM por fallback).
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(
    !codeOnly.includes('ROUTING_PROVIDER') && !codeOnly.includes('isTomTomEnabled'),
    'la página no debe leer la bandera de proveedor: usa el resultado real'
  );
  assert.ok(!codeOnly.includes('import.meta.env'), 'la página no debe leer import.meta.env');
});

test('el fallback OSRM se explica al usuario cuando usedTomTomFallback es true', () => {
  assert.match(
    source,
    /routeResult\.provider === 'osrm' && routeResult\.usedTomTomFallback/,
    'la nota de respaldo debe condicionarse a un intento real fallido de TomTom'
  );
  assert.match(source, /OSRM se\s+utilizó como respaldo/);
});

test('la hora de salida del último cálculo se registra y se limpia al invalidar', () => {
  // Acotado con marcadores: extractBraceBlock corta el try y no llegaría al
  // catch, donde un cálculo fallido limpia la hora anterior.
  const start = source.indexOf(RECALCULATE_ROUTE_MARKER);
  assert.notEqual(start, -1, 'Falta recalculateRoute en OfferTripPage.tsx');
  const end = source.indexOf('const handleManualRecalculate', start);
  assert.notEqual(end, -1, 'No se encontró el límite posterior de recalculateRoute');
  const recalc = source.slice(start, end);
  assert.match(recalc, /setRouteDepartAtUsed\(departAt\)/,
    'recalculateRoute debe registrar la hora usada al aplicar el resultado');
  assert.match(recalc, /setRouteResult\(null\);\s*\n\s*setRouteDepartAtUsed\(null\)/,
    'un cálculo fallido no debe conservar la hora anterior');
  const invalidate = extractBraceBlock(source, 'const invalidateRouteForWaypointChange = () => {');
  assert.match(invalidate, /setRouteDepartAtUsed\(null\)/,
    'la invalidación (fecha, hora u origen) debe limpiar la hora mostrada');
});
