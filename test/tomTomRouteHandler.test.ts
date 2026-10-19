/**
 * Pruebas del ENDPOINT `api/route.ts` (proxy TomTom de Vercel) con `fetch`
 * SIMULADO: cero llamadas HTTP reales y sin API key real.
 *
 * Estrategia de aislablamiento (restaurado en cada prueba):
 * - `globalThis.fetch` se reemplaza en `beforeEach` por una guarda que registra
 *   la llamada y la deriva a un `fetchImpl` configurable; por defecto RECHAZA
 *   (si un test no prepara un mock y el handler intenta salir a la red, el
 *   propio test falla). Se restaura el fetch original en `afterEach`.
 * - `console.error` se captura en `logs[]` para poder revisar que NUNCA filtre
 *   la clave; se restaura en `afterEach`.
 * - `process.env.TOMTOM_API_KEY` se guarda en `beforeEach` y se restaura en
 *   `afterEach` (aunque algún test la borre).
 *
 * Ejecutar con el runner built-in de Node (sin dependencias):
 *   node --test test/
 * Este archivo vive FUERA de `src/` a propósito: `tsc -b` solo cubre `src`.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../api/route.ts';
import {
  tomTomRouteValid,
  tomTomRouteMissingHistoric,
} from './tomTomAdapter.fixture.ts';

/** Clave SINTÉTICA solo para pruebas. NUNCA es una clave real de TomTom. */
const TEST_KEY = 'TEST-TOMTOM-KEY-no-real-000';

/** Zona horaria de Guadalajara (el servidor la usa tal cual, sin adivinarla). */
const DEPART_AT = '2026-10-14T08:00:00-06:00';

// ============================================================
// Andamiaje de aislamiento: fetch simulado + console.error capturada + env
// ============================================================

interface FetchCall {
  url: string;
  init?: RequestInit;
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Llamadas a `fetch` registradas durante la prueba actual. */
const fetchCalls: FetchCall[] = [];
/** Mensajes capturados de `console.error` durante la prueba actual. */
const logs: string[] = [];
/** Implementación simulada de la red para la prueba actual. */
let fetchImpl: FetchImpl = () =>
  Promise.reject(new Error('fetch no debe llamarse en esta prueba'));

let originalFetch: (typeof globalThis)['fetch'];
let originalConsoleError: (typeof console)['error'];
let originalApiKey: string | undefined;

/** Acceso al `fetch` global con un tipo que admite reasignación. */
const globalWithFetch = globalThis as unknown as {
  fetch: (typeof globalThis)['fetch'];
};

const setFetchImpl = (impl: FetchImpl): void => {
  fetchImpl = impl;
};

/** Respuesta JSON 200 con payload dado. */
const jsonOk = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  originalFetch = globalWithFetch.fetch;
  originalConsoleError = console.error;
  originalApiKey = process.env.TOMTOM_API_KEY;

  fetchCalls.length = 0;
  logs.length = 0;
  // Guardia: por defecto ninguna prueba debe llegar a la red.
  fetchImpl = () =>
    Promise.reject(new Error('fetch no debe llamarse en esta prueba'));

  globalWithFetch.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  }) as (typeof globalThis)['fetch'];

  console.error = (...args: unknown[]) => {
    logs.push(
      args
        .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
        .join(' ')
    );
  };

  // Contexto por defecto: clave presente. Los tests que no la quieren la borran.
  process.env.TOMTOM_API_KEY = TEST_KEY;
});

afterEach(() => {
  globalWithFetch.fetch = originalFetch;
  console.error = originalConsoleError;
  if (originalApiKey === undefined) {
    delete process.env.TOMTOM_API_KEY;
  } else {
    process.env.TOMTOM_API_KEY = originalApiKey;
  }
});

// ============================================================
// Helpers de peticiones
// ============================================================

const postJson = (body: unknown): Request =>
  new Request('http://localhost/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const postRaw = (raw: string): Request =>
  new Request('http://localhost/api/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });

/** Cuerpo válido de referencia (zona CUCEI / Guadalajara). */
const validBody = () => ({
  origin: { lat: 20.6586, lng: -103.3254 },
  destination: { lat: 20.6751, lng: -103.3122 },
  waypoints: [{ lat: 20.6601, lng: -103.3298 }],
  departAt: DEPART_AT,
});

// ============================================================
// Validación de la petición (sin tocar la red)
// ============================================================

test('responde 405 a métodos distintos de POST y no llama a TomTom', async () => {
  const res = await handler(new Request('http://localhost/api/route', { method: 'GET' }));
  assert.equal(res.status, 405);
  const body = await res.json();
  assert.match(body.error, /POST/);
  assert.equal(fetchCalls.length, 0);
});

test('responde 500 si falta TOMTOM_API_KEY, sin llamar a TomTom', async () => {
  delete process.env.TOMTOM_API_KEY;

  const res = await handler(postJson(validBody()));

  assert.equal(res.status, 500);
  const body = await res.json();
  // Mensaje genérico: no revela configuración interna ni la variable.
  assert.equal(body.error, 'El servicio de rutas no está disponible.');
  assert.equal(fetchCalls.length, 0);
  // El registro sí es explícito para el operador del servidor.
  assert.equal(logs.length, 1);
  assert.match(logs[0], /TOMTOM_API_KEY/);
});

test('responde 400 si el body no es JSON válido', async () => {
  const res = await handler(postRaw('{esto no es json'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /JSON válido/);
  assert.equal(fetchCalls.length, 0);
});

test('responde 400 si el body carece de campos requeridos', async () => {
  const res = await handler(postJson({ origin: { lat: 20.65, lng: -103.32 } }));
  assert.equal(res.status, 400);
  assert.equal(fetchCalls.length, 0);
});

test('responde 400 si una coordenada está fuera de rango (WGS84)', async () => {
  const res = await handler(
    postJson({
      ...validBody(),
      origin: { lat: 999, lng: -103.3254 }, // lat > 90
    })
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Origen inválido/);
  assert.equal(fetchCalls.length, 0);
});

test('responde 400 si se excede el límite de puntos', async () => {
  const waypoints = Array.from({ length: 24 }, () => ({ lat: 20.66, lng: -103.33 }));
  const res = await handler(postJson({ ...validBody(), waypoints }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /límite/);
  assert.equal(fetchCalls.length, 0);
});

test('responde 400 si falta departAt (no se adivina la hora de salida)', async () => {
  const bodySinHora = {
    origin: { lat: 20.6586, lng: -103.3254 },
    destination: { lat: 20.6751, lng: -103.3122 },
    waypoints: [{ lat: 20.6601, lng: -103.3298 }],
    // departAt ausente a propósito.
  };
  const res = await handler(postJson(bodySinHora));
  assert.equal(res.status, 400);
  const parsed = await res.json();
  assert.match(parsed.error, /departAt/);
  assert.equal(fetchCalls.length, 0);
});

// ============================================================
// Construcción de la URL upstream
// ============================================================

test('llama a TomTom con la URL correcta, orden lat,lng y parámetros exigidos', async () => {
  setFetchImpl(async () => jsonOk(tomTomRouteValid));

  const res = await handler(postJson(validBody()));
  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);

  const url = new URL(fetchCalls[0].url);
  // Formato TomTom: /calculateRoute/{lat},{lng}:{lat},{lng}:.../json (¡lat primero!)
  assert.equal(
    `${url.origin}${url.pathname}`,
    'https://api.tomtom.com/routing/1/calculateRoute' +
      '/20.6586,-103.3254:20.6601,-103.3298:20.6751,-103.3122/json'
  );
  assert.equal(url.searchParams.get('key'), TEST_KEY);
  assert.equal(url.searchParams.get('computeTravelTimeFor'), 'all');
  assert.equal(url.searchParams.get('departAt'), DEPART_AT);
  assert.equal(url.searchParams.get('traffic'), 'true');
  assert.equal(url.searchParams.get('routeType'), 'fastest');
  // El método hacia el upstream es GET.
  assert.equal(fetchCalls[0].init?.method, 'GET');
});

// ============================================================
// Respuesta satisfactoria
// ============================================================

test('devuelve 200 con RouteResult mapeado (distance, duration histórica, geometry)', async () => {
  setFetchImpl(async () => jsonOk(tomTomRouteValid));

  const res = await handler(postJson(validBody()));

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  const body = await res.json();
  assert.equal(body.distance, 5230);
  // Duration viene EXCLUSIVAMENTE de historicTrafficTravelTimeInSeconds (845).
  assert.equal(body.duration, 845);
  assert.equal(body.geometry.type, 'LineString');
  assert.deepEqual(body.geometry.coordinates[0], [-103.3254, 20.6586]);
  // La geometría conserva el orden GeoJSON [longitud, latitud] (el adaptador
  // convierte {latitude, longitude} de TomTom a [lng, lat]).
  assert.deepEqual(body.geometry.coordinates, [
    [-103.3254, 20.6586],
    [-103.3298, 20.6601],
    [-103.3322, 20.664],
  ]);
});

// ============================================================
// Errores de TomTom / red / timeout
// ============================================================

test('devuelve 502 ante un error HTTP de TomTom (sin exponer detalles)', async () => {
  setFetchImpl(async () => new Response('Internal Server Error', { status: 500 }));

  const res = await handler(postJson(validBody()));

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'El proveedor de rutas rechazó la solicitud.');
  // El registro solo menciona el código HTTP, nunca la URL (que lleva la key).
  assert.equal(logs.length, 1);
  assert.match(logs[0], /estado 500/);
});

test('devuelve 502 ante un error de red (fetch rechaza)', async () => {
  setFetchImpl(async () => {
    throw new TypeError('fetch failed');
  });

  const res = await handler(postJson(validBody()));

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'No se pudo contactar al proveedor de rutas.');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Fallo de red o timeout/);
});

test('devuelve 502 ante timeout del upstream (AbortError)', async () => {
  setFetchImpl(async () => {
    throw new DOMException('The operation was aborted', 'AbortError');
  });

  const res = await handler(postJson(validBody()));

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'No se pudo contactar al proveedor de rutas.');
});

test('devuelve 502 si TomTom responde con JSON inválido', async () => {
  setFetchImpl(async () => new Response('<html>not json</html>', { status: 200 }));

  const res = await handler(postJson(validBody()));

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'El proveedor de rutas devolvió una respuesta ilegible.');
});


// ============================================================
// Seguridad: la clave API nunca se expone
// ============================================================

test('ninguna respuesta ni registro expone la clave API (éxito y todos los errores)', async () => {
  // Escenarios: éxito, error HTTP de TomTom, error de red, timeout,
  // JSON inválido y falta de duración histórica.
  const escenarios: FetchImpl[] = [
    async () => jsonOk(tomTomRouteValid),
    async () => new Response('boom', { status: 503 }),
    async () => {
      throw new TypeError('fetch failed');
    },
    async () => {
      throw new DOMException('aborted', 'AbortError');
    },
    async () => new Response('no es json', { status: 200 }),
    async () => jsonOk(tomTomRouteMissingHistoric),
  ];

  for (const impl of escenarios) {
    setFetchImpl(impl);
    const res = await handler(postJson(validBody()));
    const texto = await res.text();
    assert.ok(
      !texto.includes(TEST_KEY),
      `la respuesta expuso la clave API: ${texto.slice(0, 200)}`
    );
  }

  // Todas las respuestas de validación previas (405/400/500) tampoco la filtran.
  const res405 = await handler(new Request('http://localhost/api/route'));
  assert.ok(!(await res405.text()).includes(TEST_KEY));
  const res400 = await handler(postRaw('no-json'));
  assert.ok(!(await res400.text()).includes(TEST_KEY));
  delete process.env.TOMTOM_API_KEY;
  const res500 = await handler(postJson(validBody()));
  assert.ok(!(await res500.text()).includes(TEST_KEY));

  // Los registros de console.error capturados en todos los escenarios
  // anteriores jamás contienen la clave ni la URL upstream completa.
  assert.ok(logs.length > 0, 'se esperaban registros para poder auditarlos');
  for (const linea of logs) {
    assert.ok(!linea.includes(TEST_KEY), `un registro expuso la clave: ${linea}`);
    assert.ok(!linea.includes('api.tomtom.com'), `un registro expuso la URL upstream: ${linea}`);
  }
});

test('devuelve 502 si falta la duración histórica (no inventa duration)', async () => {
  setFetchImpl(async () => jsonOk(tomTomRouteMissingHistoric));

  const res = await handler(postJson(validBody()));

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'El proveedor no devolvió datos suficientes para estimar la ruta.');
  // Asegurar que NO se devuelve ningún duration inventado.
  assert.equal(body.duration, undefined);
});
