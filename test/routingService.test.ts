/**
 * Pruebas de integración del despacho de proveedor en routingService:
 * compatibilidad de las llamadas existentes (OSRM), activación TomTom con
 * `departAt` válido compuesto por `buildDepartAt`, rechazo de horas
 * inventadas y respaldo TomTom → OSRM ante cualquier fallo.
 *
 * No se hace ninguna llamada de red: `globalThis.fetch` se sustituye por un
 * mock que registra las peticiones, y la bandera de proveedor
 * (ROUTING_PROVIDER y su alias heredado VITE_ROUTING_PROVIDER) se controla
 * vía process.env (respaldo del runner de Node, sin Vite).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDepartAt,
  buildWaypointRoute,
  calculateRoute,
  calculateRouteThrough,
  TRIP_TIME_ZONE,
} from '../src/services/routingService.ts';
import { buildDepartAt as buildDepartAtOriginal } from '../src/utils/departAt.ts';

// ============================================================
// Utilidades de prueba
// ============================================================

/** Origen de prueba (zona de Guadalajara). */
const ORIGIN = { lat: 20.6595, lng: -103.35 };
/** Destino de prueba (CUCEI). */
const DESTINATION = { lat: 20.6855, lng: -103.3254 };
/** Parada intermedia de prueba. */
const WAYPOINT = { lat: 20.67, lng: -103.34 };

/** Respuesta válida simulada del servidor demo de OSRM. */
const osrmRoutePayload = {
  code: 'Ok',
  routes: [
    {
      distance: 1500.4,
      duration: 320.2,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-103.35, 20.6595],
          [-103.3254, 20.6855],
        ],
      },
    },
  ],
};

/** RouteResult válido simulado del proxy POST /api/route (ya adaptado). */
const proxyRoutePayload = {
  distance: 5200,
  duration: 640,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-103.35, 20.6595],
      [-103.3254, 20.6855],
    ],
  },
};

/** Llamada a fetch registrada por el mock. */
interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
}

/**
 * Sustituye globalThis.fetch por un handler que registra cada llamada y
 * responde según la llamada y su índice (0-based).
 */
const installFetchMock = (
  respond: (call: RecordedCall, index: number) => Response
): { calls: RecordedCall[]; restore: () => void } => {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

/** Respuesta JSON sintética como la que devuelven OSRM y el proxy. */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** Activa ('tomtom') o desactiva (null) la bandera de despacho. */
const setProviderFlag = (value: string | null): void => {
  // Controla AMBOS nombres para que las pruebas sean deterministas aunque el
  // entorno local exporte ROUTING_PROVIDER (nombre con precedencia en el código).
  for (const key of ['ROUTING_PROVIDER', 'VITE_ROUTING_PROVIDER'] as const) {
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

/**
 * Arnés de cada prueba: fija la bandera, instala el mock de fetch y garantiza
 * la restauración de AMBOS en un finally (nada se filtra entre pruebas).
 */
const withHarness = async (
  flag: string | null,
  respond: (call: RecordedCall, index: number) => Response,
  run: (calls: RecordedCall[]) => Promise<void> | void
): Promise<void> => {
  setProviderFlag(flag);
  const mock = installFetchMock(respond);
  try {
    await run(mock.calls);
  } finally {
    mock.restore();
    setProviderFlag(null);
  }
};

/** URL exacta de OSRM que usa calculateRoute para estos puntos. */
const OSRM_TWO_POINT_URL =
  `https://router.project-osrm.org/route/v1/driving/` +
  `${ORIGIN.lng},${ORIGIN.lat};${DESTINATION.lng},${DESTINATION.lat}?overview=full&geometries=geojson`;

// ============================================================
// 1. Compatibilidad: llamadas antiguas sin departAt (sin TomTom)
// ============================================================

test('calculateRoute sin departAt sigue usando OSRM (compatibilidad binaria)', async () => {
  await withHarness(null, () => jsonResponse(osrmRoutePayload), async (calls) => {
    const result = await calculateRoute(ORIGIN.lng, ORIGIN.lat, DESTINATION.lng, DESTINATION.lat);
    assert.deepEqual(result, {
      distance: 1500.4,
      duration: 320.2,
      geometry: osrmRoutePayload.routes[0].geometry,
    });
    assert.equal(calls.length, 1);
    // OSRM sigue recibiendo coordenadas en orden lng,lat y sin cambios de URL.
    assert.equal(calls[0].url, OSRM_TWO_POINT_URL);
    assert.equal(calls[0].method, 'GET');
  });
});

test('calculateRouteThrough y buildWaypointRoute sin departAt siguen usando OSRM', async () => {
  await withHarness(null, () => jsonResponse(osrmRoutePayload), async (calls) => {
    const route = await calculateRouteThrough(ORIGIN, [WAYPOINT], DESTINATION);
    assert.equal(route.distance, 1500.4);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith('https://router.project-osrm.org/route/v1/driving/'));
    assert.ok(calls[0].url.includes(';')); // ruta multipunto en UNA petición
  });

  await withHarness(null, () => jsonResponse(osrmRoutePayload), async (calls) => {
    const result = await buildWaypointRoute(ORIGIN, [WAYPOINT], DESTINATION);
    // Un waypoint no gasta petición de matriz: orden trivial y ruta OSRM.
    assert.deepEqual(result.order, [0]);
    assert.equal(result.optimized, true);
    assert.equal(result.route.distance, 1500.4);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith('https://router.project-osrm.org/route/v1/driving/'));
    assert.ok(calls[0].url.includes(`${WAYPOINT.lng},${WAYPOINT.lat}`));
  });
});

test('flag tomtom sin departAt no intenta TomTom: la hora nunca se adivina', async () => {
  await withHarness('tomtom', () => jsonResponse(osrmRoutePayload), async (calls) => {
    await calculateRoute(ORIGIN.lng, ORIGIN.lat, DESTINATION.lng, DESTINATION.lat);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, OSRM_TWO_POINT_URL);
  });

  await withHarness('tomtom', () => jsonResponse(osrmRoutePayload), async (calls) => {
    await calculateRouteThrough(ORIGIN, [WAYPOINT], DESTINATION, null);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith('https://router.project-osrm.org/'));
  });
});

// ============================================================
// 2. Fecha válida: se transforma con buildDepartAt y se transmite
// ============================================================

test('fecha válida (buildDepartAt) llega intacta al proxy TomTom y se usa su resultado', async () => {
  const departAt = buildDepartAt('2026-10-15', '08:00');
  // Contrato de la etapa 1: hora de pared conservada + offset -06:00 (oct 2026).
  assert.equal(departAt, '2026-10-15T08:00:00-06:00');

  await withHarness('tomtom', () => jsonResponse(proxyRoutePayload), async (calls) => {
    const result = await calculateRoute(
      ORIGIN.lng,
      ORIGIN.lat,
      DESTINATION.lng,
      DESTINATION.lat,
      departAt
    );
    assert.deepEqual(result, proxyRoutePayload);
    assert.equal(calls.length, 1); // TomTom resolvió la ruta: ni una petición a OSRM
    assert.equal(calls[0].url, '/api/route');
    assert.equal(calls[0].method, 'POST');
    // Contrato de parseRouteProxyRequest: lat,lng por punto + departAt intacto.
    assert.deepEqual(JSON.parse(calls[0].body ?? 'null'), {
      origin: { lat: ORIGIN.lat, lng: ORIGIN.lng },
      destination: { lat: DESTINATION.lat, lng: DESTINATION.lng },
      waypoints: [],
      departAt: '2026-10-15T08:00:00-06:00',
    });
  });
});

test('buildWaypointRoute optimiza el orden con matriz OSRM y envía paradas y departAt al proxy', async () => {
  const waypoints = [WAYPOINT, { lat: 20.68, lng: -103.33 }];
  const departAt = buildDepartAt('2026-10-16', '07:30');
  assert.equal(departAt, '2026-10-16T07:30:00-06:00');
  // Matriz 4×4 (origen + 2 paradas + destino) con costos crecientes por
  // separación de índice: el orden óptimo resultante es el de selección [0, 1].
  const durations = [
    [0, 60, 120, 180],
    [60, 0, 60, 120],
    [120, 60, 0, 60],
    [180, 120, 60, 0],
  ];
  await withHarness(
    'tomtom',
    (call) =>
      call.url.includes('/table/v1/driving/')
        ? jsonResponse({ code: 'Ok', durations })
        : jsonResponse(proxyRoutePayload),
    async (calls) => {
      const result = await buildWaypointRoute(ORIGIN, waypoints, DESTINATION, departAt);
      assert.deepEqual(result.route, proxyRoutePayload);
      assert.deepEqual(result.order, [0, 1]);
      assert.equal(result.optimized, true);
      assert.equal(calls.length, 2);
      assert.ok(calls[0].url.includes('/table/v1/driving/')); // matriz: OSRM
      assert.equal(calls[1].url, '/api/route'); // ruta final: TomTom
      assert.deepEqual(JSON.parse(calls[1].body ?? 'null'), {
        origin: { lat: ORIGIN.lat, lng: ORIGIN.lng },
        destination: { lat: DESTINATION.lat, lng: DESTINATION.lng },
        waypoints, // orden óptimo = orden de selección
        departAt: '2026-10-16T07:30:00-06:00',
      });
    }
  );
});

test('buildWaypointRoute propaga departAt a la ruta final (1 parada, sin matriz)', async () => {
  const departAt = buildDepartAt('2026-10-17', '09:00');
  await withHarness('tomtom', () => jsonResponse(proxyRoutePayload), async (calls) => {
    const result = await buildWaypointRoute(ORIGIN, [WAYPOINT], DESTINATION, departAt);
    assert.deepEqual(result.route, proxyRoutePayload);
    assert.deepEqual(result.order, [0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/route');
    assert.deepEqual(JSON.parse(calls[0].body ?? 'null'), {
      origin: { lat: ORIGIN.lat, lng: ORIGIN.lng },
      destination: { lat: DESTINATION.lat, lng: DESTINATION.lng },
      waypoints: [WAYPOINT],
      departAt,
    });
  });
});

// ============================================================
// 3. Fecha inválida: sin horario inventado y sin cambios ocultos
// ============================================================

test('departAt inválido no intenta TomTom ni altera el comportamiento OSRM', async () => {
  const invalidValues: Array<string | null> = [
    null, // formulario sin fecha
    '', // cadena vacía
    '2026-02-30', // día inexistente y sin hora/offset
    '2026-10-15', // fecha sin hora
    '2026-10-15T08:00', // sin segundos ni offset
    '2026-10-15T08:00:00', // sin offset explícito
    '2026-10-15T08:00:00Z', // 'Z' no es el contrato ±HH:MM de buildDepartAt
    'no-es-una-fecha',
  ];
  for (const value of invalidValues) {
    await withHarness('tomtom', () => jsonResponse(osrmRoutePayload), async (calls) => {
      const result = await calculateRoute(
        ORIGIN.lng,
        ORIGIN.lat,
        DESTINATION.lng,
        DESTINATION.lat,
        value
      );
      // Resultado OSRM intacto y sin NINGÚN intento contra el proxy.
      assert.equal(result.distance, 1500.4);
      assert.equal(result.duration, 320.2);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, OSRM_TWO_POINT_URL);
    });
  }
});

// ============================================================
// 4. Respaldo: cualquier fallo de TomTom cae en OSRM
// ============================================================

test('respaldo: error HTTP del proxy TomTom → la ruta la resuelve OSRM', async () => {
  const departAt = buildDepartAt('2026-10-15', '08:00');
  await withHarness(
    'tomtom',
    (call) =>
      call.url === '/api/route'
        ? jsonResponse({ error: 'El proveedor de rutas no está disponible.' }, 502)
        : jsonResponse(osrmRoutePayload),
    async (calls) => {
      const result = await calculateRoute(
        ORIGIN.lng,
        ORIGIN.lat,
        DESTINATION.lng,
        DESTINATION.lat,
        departAt
      );
      assert.equal(result.distance, 1500.4); // métricas de OSRM, jamás inventadas
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, '/api/route');
      assert.equal(calls[1].url, OSRM_TWO_POINT_URL);
    }
  );
});

test('respaldo: un fallo de red contra el proxy cae en OSRM', async () => {
  const departAt = buildDepartAt('2026-10-15', '08:00');
  await withHarness(
    'tomtom',
    (call) => {
      // Solo falla la petición al proxy; el respaldo OSRM responde con normalidad.
      if (call.url === '/api/route') {
        throw new Error('fallo de red simulado');
      }
      return jsonResponse(osrmRoutePayload);
    },
    async (calls) => {
      const result = await calculateRouteThrough(ORIGIN, [WAYPOINT], DESTINATION, departAt);
      assert.equal(result.duration, 320.2);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, '/api/route');
      assert.ok(calls[1].url.startsWith('https://router.project-osrm.org/route/v1/driving/'));
    }
  );
});

test('respaldo: un resultado inválido del proxy cae en OSRM (nunca datos ficticios)', async () => {
  const departAt = buildDepartAt('2026-10-15', '08:00');

  // Caso A: 200 con duration negativa → el validador la rechaza.
  await withHarness(
    'tomtom',
    (call) =>
      call.url === '/api/route'
        ? jsonResponse({ ...proxyRoutePayload, duration: -5 })
        : jsonResponse(osrmRoutePayload),
    async (calls) => {
      const result = await calculateRoute(
        ORIGIN.lng,
        ORIGIN.lat,
        DESTINATION.lng,
        DESTINATION.lat,
        departAt
      );
      assert.equal(result.duration, 320.2);
      assert.equal(calls.length, 2);
    }
  );

  // Caso B: 200 con cuerpo ilegible (no es JSON) → se rechaza.
  await withHarness(
    'tomtom',
    (call) =>
      call.url === '/api/route'
        ? new Response('esto-no-es-json', { status: 200 })
        : jsonResponse(osrmRoutePayload),
    async (calls) => {
      const result = await calculateRoute(
        ORIGIN.lng,
        ORIGIN.lat,
        DESTINATION.lng,
        DESTINATION.lat,
        departAt
      );
      assert.equal(result.duration, 320.2);
      assert.equal(calls.length, 2);
    }
  );
});

// ============================================================
// 5. Integración con la etapa 1 (buildDepartAt / TRIP_TIME_ZONE)
// ============================================================

test('routingService reexporta buildDepartAt y TRIP_TIME_ZONE (fuente única)', () => {
  assert.equal(TRIP_TIME_ZONE, 'America/Mexico_City');
  // Misma referencia que el helper original: no hay una segunda implementación.
  assert.equal(buildDepartAt, buildDepartAtOriginal);
  assert.equal(buildDepartAt('2026-10-15', '08:00'), '2026-10-15T08:00:00-06:00');
});