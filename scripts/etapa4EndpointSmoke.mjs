/**
 * Etapa 4 — validación LOCAL reproducible de `api/route.ts` y del fallback a OSRM.
 *
 * Qué hace (y qué NO):
 * - Reproduce la invocación EXACTA con la que @vercel/node ejecuta un default
 *   export plano en funciones Node (código fuente publicado: bundling-handler.js
 *   y serverless-handler.mts de vercel/vercel): un default export sin `.fetch`
 *   ni métodos con nombre se llama como handler CLÁSICO (req, res), no con un
 *   web Request.
 * - Ejecuta el handler REAL contra un servidor HTTP local con la conversión
 *   publicada por Vercel (createWebHandler): NO se simula la respuesta de
 *   TomTom; si TOMTOM_API_KEY está en el entorno, la solicitud al upstream es
 *   REAL y se registra la URL enviada con la clave ENMASCARADA.
 * - Ejecuta el despacho de proveedor REAL de routingService.calculateRoute:
 *   proxy local + fallback REAL a OSRM (router.project-osrm.org). Sin clave,
 *   el proxy real devuelve 500 y se observa el fallback.
 * - NO modifica ningún archivo del repositorio, NO imprime la clave y NO
 *   escribe secretos en disco.
 *
 * Uso:
 *   node scripts/etapa4EndpointSmoke.mjs
 *   (con clave REAL, solo en tu máquina:)
 *   $env:TOMTOM_API_KEY='…' ; node scripts/etapa4EndpointSmoke.mjs     # PowerShell
 *   TOMTOM_API_KEY='…' node scripts/etapa4EndpointSmoke.mjs            # bash
 */

import http from 'node:http';

const DEPART_AT_ESPERADO = '2026-10-21T08:00:00-06:00';
const ORIGIN = { lat: 20.6546, lng: -103.3235 }; // CUCEI
const DESTINATION = { lat: 20.6806, lng: -103.3667 }; // Centro de Guadalajara
const VALID_BODY = { origin: ORIGIN, destination: DESTINATION, waypoints: [], departAt: DEPART_AT_ESPERADO };

const resultados = [];
const registrar = (fase, caso, ok, detalle) => {
  resultados.push({ fase, caso, ok, detalle });
  console.log(`  [${ok ? 'OK' : 'FALLA'}] ${caso}${detalle ? ` — ${detalle}` : ''}`);
};

const escuchar = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const pedir = async (url, init = {}, timeoutMs = 2500) => {
  const t0 = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const texto = await response.text();
    return { estado: response.status, texto, ms: Date.now() - t0, sinRespuesta: false };
  } catch (error) {
    const nombre = error?.name === 'TimeoutError' ? 'timeout-cliente' : (error?.cause?.code ?? error?.name ?? 'error');
    return { estado: null, texto: null, ms: Date.now() - t0, sinRespuesta: true, motivo: nombre };
  }
};

// ============================================================
// FASE 0 — ¿Cómo invocaría Vercel a este export? (misma lógica publicada)
// ============================================================
const rawModule = await import('../api/route.ts');
const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'];
let listener = rawModule;
for (let i = 0; i < 5; i += 1) {
  if (listener && typeof listener === 'object' && listener.default) listener = listener.default;
  else break;
}
const esWebHandler =
  HTTP_METHODS.some((metodo) => typeof listener?.[metodo] === 'function') ||
  typeof listener?.fetch === 'function';

console.log('=== FASE 0: detección de forma del export (lógica de @vercel/node) ===');
console.log(
  `  export default = ${typeof rawModule.default}; ¿web handler? = ${esWebHandler}` +
    ` → Vercel invocaría como ${esWebHandler ? 'web handler (Request → Response)' : 'CLÁSICO (req, res)'}`
);

// ============================================================
// FASE 1 — Invocación CLÁSICA (req, res): reproduce el entorno de Vercel HOY
// ============================================================
console.log('=== FASE 1: invocación clásica (req, res) — tal como @vercel/node llama a un default export plano ===');
if (esWebHandler) {
  console.log('  [OMITIDO] el export ya es forma web; la rama clásica no aplica.');
} else {
  const clasico = http.createServer((req, res) => {
    // igual que bundling-handler.js: return listener; handler(req, res)
    void Promise.resolve(listener(req, res)).catch(() => { /* el defecto se mide por la ausencia de respuesta */ });
  });
  const puertoClasico = await escuchar(clasico);
  const base = `http://127.0.0.1:${puertoClasico}/api/route`;

  const get = await pedir(base, { method: 'GET' });
  registrar('1', 'GET vía invocación clásica', get.sinRespuesta, get.sinRespuesta ? `sin respuesta en ${get.ms} ms (${get.motivo})` : `respondió HTTP ${get.estado} (¡inesperado con la forma actual!)`);

  const post = await pedir(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(VALID_BODY),
  });
  registrar('1', 'POST válido vía invocación clásica', post.sinRespuesta, post.sinRespuesta ? `sin respuesta en ${post.ms} ms (${post.motivo})` : `respondió HTTP ${post.estado} (¡inesperado con la forma actual!)`);
  clasico.close();
}

// ============================================================
// FASE 2 — Adaptador web local (réplica de createWebHandler de @vercel/node)
// ============================================================
console.log('=== FASE 2: handler REAL vía adaptador web local (réplica de la conversión publicada por Vercel) ===');

let ultimoCuerpoRecibido = null;
const textosRespuesta = [];

const invocarWeb = (request) => {
  if (esWebHandler) {
    const fn = typeof listener.fetch === 'function' ? listener.fetch : listener[request.method];
    return fn(request);
  }
  return listener(request);
};

const webServer = http.createServer(async (req, res) => {
  try {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `${proto}://${host}`);
    const metodo = (req.method || 'GET').toUpperCase();
    const init = { method: metodo, headers: { ...req.headers } };
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const crudo = Buffer.concat(chunks).toString('utf8');
      try { ultimoCuerpoRecibido = JSON.parse(crudo); } catch { ultimoCuerpoRecibido = crudo; }
      init.body = Buffer.from(crudo, 'utf8'); // mismo contenido, sin interpretar
    }
    const response = await invocarWeb(new Request(url, init));
    const buf = Buffer.from(await response.arrayBuffer());
    textosRespuesta.push(buf.toString('utf8'));
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(buf);
  } catch (error) {
    const msg = 'FALLA DEL ADAPTADOR LOCAL: ' + String(error?.message ?? error);
    textosRespuesta.push(msg);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: msg }));
  }
});
const puertoWeb = await escuchar(webServer);
const baseWeb = `http://127.0.0.1:${puertoWeb}/api/route`;

// Captura de la URL upstream de TomTom (solo con clave real); la clave se
// ENMASCARA siempre antes de imprimirse. Sin clave, no se toca el fetch global.
const apiKey = process.env.TOMTOM_API_KEY ?? null;
const fetchOriginal = globalThis.fetch.bind(globalThis);
let urlUpstreamCapturada = null;
if (apiKey) {
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://api.tomtom.com/')) {
      urlUpstreamCapturada = url;
    }
    return fetchOriginal(input, init);
  };
}
console.log(`  Clave TOMTOM_API_KEY en el entorno: ${apiKey ? 'SÍ (se hará solicitud REAL a TomTom)' : 'NO (el proxy real responderá 500; solicitud real a TomTom PENDIENTE)'}`);

const enmascarar = (texto) => (apiKey ? texto.split(apiKey).join('[CLAVE-REDACTADA]') : texto);

// 2a) GET → 405
{
  const r = await pedir(baseWeb, { method: 'GET' });
  registrar('2', 'GET rechazado con 405', r.estado === 405, `HTTP ${r.estado} ${r.texto?.slice(0, 80)}`);
}
// Nota: el handler valida la configuración (API key) ANTES que el cuerpo, así
// que sin clave cualquier POST responde 500; los 400 exigen clave presente y
// ya están cubiertos por test/tomTomRouteHandler.test.ts (con clave falsa).
const estadoCuerpoInvalido = apiKey ? 400 : 500;
// 2b) cuerpo vacío → 400 (500 sin clave)
{
  const r = await pedir(baseWeb, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
  registrar('2', `POST vacío → ${estadoCuerpoInvalido} (${apiKey ? 'validación de cuerpo' : 'configuración se valida antes que el cuerpo'})`, r.estado === estadoCuerpoInvalido, `HTTP ${r.estado} ${r.texto?.slice(0, 100)}`);
}
// 2c) sin departAt → 400 (500 sin clave)
{
  const { departAt, ...sinHora } = VALID_BODY;
  const r = await pedir(baseWeb, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sinHora) });
  registrar('2', `POST sin departAt → ${estadoCuerpoInvalido}`, r.estado === estadoCuerpoInvalido, `HTTP ${r.estado} ${r.texto?.slice(0, 120)}`);
}
// 2d) JSON ilegible → 400 (500 sin clave)
{
  const r = await pedir(baseWeb, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{no-json' });
  registrar('2', `POST con JSON ilegible → ${estadoCuerpoInvalido}`, r.estado === estadoCuerpoInvalido, `HTTP ${r.estado}`);
}
// 2e) solicitud válida (con o sin clave)
{
  const r = await pedir(baseWeb, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID_BODY) }, 20000);
  const recibido = ultimoCuerpoRecibido;
  const shapeOk =
    recibido && typeof recibido === 'object' &&
    typeof recibido.origin?.lat === 'number' && typeof recibido.origin?.lng === 'number' &&
    typeof recibido.destination?.lat === 'number' && typeof recibido.destination?.lng === 'number' &&
    Array.isArray(recibido.waypoints) && recibido.departAt === DEPART_AT_ESPERADO;
  registrar('2', 'El proxy recibió el contrato {origin{lat,lng}, destination{lat,lng}, waypoints[], departAt} tal cual lo envía el cliente', Boolean(shapeOk), `departAt recibido = ${JSON.stringify(recibido?.departAt)}; waypoints = ${Array.isArray(recibido?.waypoints) ? recibido.waypoints.length : 'n/a'}`);

  if (!apiKey) {
    const ok = r.estado === 500 && !/TOMTOM|clave|key/i.test(r.texto ?? '');
    registrar('2', 'Sin clave: 500 genérico sin filtrar configuración', ok, `HTTP ${r.estado} ${r.texto?.slice(0, 100)}`);
  } else if (r.estado === 200) {
    let parsed = null;
    try { parsed = JSON.parse(r.texto); } catch { /* se reporta abajo */ }
    const coords = parsed?.geometry?.coordinates ?? [];
    const coordOk = coords.length >= 2 && coords.every(
      ([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
    );
    const cercaGdl = coords.every(([lng, lat]) => lng > -104 && lng < -102.5 && lat > 19.5 && lat < 21.5);
    const okDatos = parsed && Number.isFinite(parsed.distance) && parsed.distance > 0 &&
      Number.isFinite(parsed.duration) && parsed.duration > 0 &&
      parsed.geometry?.type === 'LineString' && coordOk;
    registrar('2', 'Respuesta REAL de TomTom con forma RouteResult {distance>0, duration>0, LineString [lng,lat]≥2}', Boolean(okDatos), okDatos ? `distancia=${Math.round(parsed.distance)} m, duración=${Math.round(parsed.duration)} s, puntos=${coords.length}, primera=[${coords[0].join(', ')}]` : (r.texto ?? '').slice(0, 200));
    registrar('2', 'Coordenadas dentro del área de Guadalajara ([lng,lat] en geometría)', Boolean(okDatos && cercaGdl), okDatos && cercaGdl ? 'sí' : 'revisar');
    // duration>0 con esta forma exige historicTrafficTravelTimeInSeconds válido,
    // que TomTom solo devuelve si aceptó departAt + computeTravelTimeFor=all.
    const urlOk = urlUpstreamCapturada &&
      urlUpstreamCapturada.includes(`/${ORIGIN.lat},${ORIGIN.lng}:`) &&
      urlUpstreamCapturada.includes(`:${DESTINATION.lat},${DESTINATION.lng}/json`) &&
      urlUpstreamCapturada.includes('computeTravelTimeFor=all') &&
      urlUpstreamCapturada.includes(`departAt=${encodeURIComponent(DEPART_AT_ESPERADO)}`);
    const urlLimpia = urlUpstreamCapturada ? urlUpstreamCapturada.replace(/key=[^&]+/, 'key=[REDACTADA]') : 'sin URL capturada';
    registrar('2', 'URL upstream REAL enviada a TomTom (path lat,lng en orden, computeTravelTimeFor=all, departAt)', Boolean(urlOk), enmascarar(urlLimpia));
  } else {
    registrar('2', 'Solicitud REAL a TomTom', false, `HTTP ${r.estado} ${enmascarar(r.texto ?? '').slice(0, 200)}`);
  }
}
// 2f) ninguna respuesta filtró la clave ni el nombre de la variable
{
  const filtrado = textosRespuesta.some(
    (t) => t.includes('TOMTOM_API_KEY') || (apiKey && t.includes(apiKey))
  );
  registrar('2', 'Sin fugas de clave ni del nombre TOMTOM_API_KEY en respuestas', !filtrado, filtrado ? '¡FILTRADO DETECTADO!' : `${textosRespuesta.length} respuestas verificadas`);
}

// ============================================================
// FASE 3 — Despacho REAL del cliente: proxy local + fallback REAL a OSRM
// ============================================================
console.log('=== FASE 3: cliente REAL (routingService.calculateRoute) contra proxy local y OSRM ===');

process.env.ROUTING_PROVIDER = 'tomtom';
process.env.VITE_ROUTING_PROVIDER = 'tomtom';
const { calculateRoute } = await import('../src/services/routingService.ts');
const { buildDepartAt } = await import('../src/utils/departAt.ts');

const avisos = [];
const warnOriginal = console.warn;
const errOriginal = console.error;
const capturar = (...args) => {
  avisos.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
};
console.warn = capturar;
console.error = capturar;

// Rebase ÚNICO de transporte: '/api/route' (URL relativa que usa el cliente en
// el navegador) → servidor local. El contenido de la petición no se toca.
const rebaseProxy = (puerto) => {
  const base = `http://127.0.0.1:${puerto}`;
  globalThis.fetch = (input, init) => fetchOriginal(
    typeof input === 'string' && input.startsWith('/api/route') ? base + input : input,
    init
  );
};

const departAtReal = buildDepartAt('2026-10-21', '08:00');

// 3a) el proxy local responde de verdad (500 sin clave; 200 con clave real)
rebaseProxy(puertoWeb);
let ruta3 = null;
let fallo3 = null;
const t3 = Date.now();
try {
  ruta3 = await calculateRoute(ORIGIN.lng, ORIGIN.lat, DESTINATION.lng, DESTINATION.lat, departAtReal);
} catch (error) {
  fallo3 = String(error?.message ?? error);
}
{
  const transmitio = ultimoCuerpoRecibido?.departAt === departAtReal;
  registrar('3', 'calculateRoute transmitió departAt RFC 3339 (buildDepartAt) al proxy', Boolean(transmitio), JSON.stringify(ultimoCuerpoRecibido?.departAt));

  const huboWarn = avisos.some((a) => a.includes('TomTom no devolvió'));
  const ok = ruta3 && ruta3.distance > 0 && ruta3.duration > 0 &&
    ruta3.geometry?.type === 'LineString' && ruta3.geometry.coordinates.length >= 2;
  const proveedor = apiKey && ok && !huboWarn ? 'TomTom (REAL)' : (ok ? 'OSRM (fallback)' : 'ninguno');
  registrar('3', 'calculateRoute devuelve ruta válida tras pasar por el proxy', Boolean(ok), ok ? `proveedor efectivo: ${proveedor}; distancia=${Math.round(ruta3.distance)} m; duración=${Math.round(ruta3.duration)} s; en ${Date.now() - t3} ms${fallo3 ? `; error previo: ${fallo3}` : ''}` : (fallo3 ?? 'sin datos'));

  const warnEsperado = apiKey ? !huboWarn : huboWarn;
  registrar('3', 'Aviso de fallback presente/ausente según corresponde', Boolean(warnEsperado), huboWarn ? avisos.find((a) => a.includes('TomTom no devolvió')) : (apiKey && ok ? 'no aplica (TomTom respondió 200 con clave real)' : 'sin aviso de fallback'));
}

// 3b) proxy COLGADO (la situación del defecto de la Fase 1): el cliente debe
// abortar a los ~15 s (TOMTOM_PROXY_TIMEOUT_MS) y completar con OSRM.
{
  const hangServer = http.createServer(() => { /* nunca responde */ });
  const puertoHang = await escuchar(hangServer);
  rebaseProxy(puertoHang);
  avisos.length = 0;
  let ruta4 = null;
  let fallo4 = null;
  const t4 = Date.now();
  try {
    ruta4 = await calculateRoute(ORIGIN.lng, ORIGIN.lat, DESTINATION.lng, DESTINATION.lat, departAtReal);
  } catch (error) {
    fallo4 = String(error?.message ?? error);
  }
  const elapsed4 = Date.now() - t4;
  const okRuta = ruta4 && ruta4.distance > 0 && ruta4.duration > 0 && ruta4.geometry?.coordinates?.length >= 2;
  const abortoEnEspera = elapsed4 >= 14000 && elapsed4 < 18000;
  registrar('3', 'Proxy colgado: el cliente aborta a los ~15 s y completa la ruta con OSRM (no bloquea indefinidamente)', Boolean(okRuta && abortoEnEspera), okRuta ? `intento = ${elapsed4} ms; ruta final = ${Math.round(ruta4.distance)} m / ${Math.round(ruta4.duration)} s vía OSRM` : (fallo4 ?? 'sin ruta'));
  hangServer.close();
}

console.warn = warnOriginal;
console.error = errOriginal;
globalThis.fetch = fetchOriginal;
webServer.close();

// ============================================================
// RESUMEN
// ============================================================
const fallas = resultados.filter((r) => !r.ok);
console.log('=== RESUMEN ETAPA 4 (local) ===');
console.log(`${resultados.length - fallas.length}/${resultados.length} comprobaciones OK.`);
if (!apiKey) {
  console.log('NOTA: sin TOMTOM_API_KEY en el entorno, la solicitud REAL a TomTom queda PENDIENTE.');
  console.log('      Para ejecutarla: define la clave y vuelve a correr este script (no la guardes en el repo).');
}
process.exitCode = fallas.length === 0 ? 0 : 1;
