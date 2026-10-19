/**
 * Servicio de rutas con despacho de proveedor.
 *
 * - OSRM (http://project-osrm.org/docs/v5.24.0/api/) es el proveedor por
 *   defecto y el único disponible sin configuración.
 * - TomTom Routing API se intenta SOLO cuando la bandera de entorno
 *   ROUTING_PROVIDER='tomtom' (nombre canónico; la variable heredada
 *   VITE_ROUTING_PROVIDER se acepta como respaldo) Y el llamador pasa
 *   `departAt` (hora de salida RFC 3339 con offset, compuesta con
 *   `buildDepartAt` de src/utils/departAt.ts). La petición se hace al proxy
 *   propio POST /api/route: la clave API vive exclusivamente en el servidor.
 * - Cualquier fallo o respuesta inválida de TomTom activa el respaldo en
 *   OSRM: nunca se inventa una duración ni se propaga un error mientras OSRM
 *   esté disponible. La matriz de duraciones (optimizeWaypointOrder) sigue
 *   siendo exclusivamente de OSRM.
 */

// Reexporta el helper de hora de salida para que los consumidores del servicio
// (p. ej. OfferTripPage) comp `departAt` desde un único módulo. La fuente de
// verdad sigue siendo src/utils/departAt.ts (etapa 1, ya probada).
export { buildDepartAt, TRIP_TIME_ZONE } from '../utils/departAt.ts';

export interface RouteResult {
  distance: number; // en metros
  duration: number; // en segundos
  geometry: LineStringGeometry;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][]; // [longitude, latitude]
}

// ============================================================
// PUNTOS INTERMEDIOS (puntos de paso, NO paradas de pasajeros)
// ============================================================

/** Punto geográfico genérico usado por el planificador de rutas. */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/** Punto intermedio tal como se persiste dentro de route_geometry. */
export interface StoredRouteWaypoint extends RoutePoint {
  /**
   * Dirección legible aproximada (reverse geocoding). Puede ser null si
   * Nominatim no respondió; nunca se inventa una dirección.
   */
  address?: string | null;
}

/**
 * Geometría de ruta que además conserva los puntos de paso elegidos por el
 * conductor. Es un LineString GeoJSON válido CON un miembro extra `waypoints`:
 * los consumidores actuales (mapa, búsqueda por proximidad) solo leen
 * `type` y `coordinates`, y los viajes antiguos simplemente no traen la clave.
 */
export interface WaypointRouteGeometry extends LineStringGeometry {
  waypoints?: StoredRouteWaypoint[];
}

/**
 * Límite de puntos intermedios por viaje.
 *
 * Justificación: cada cálculo usa como máximo 2 peticiones al servidor demo
 * de OSRM (matriz `table` de 7×7 y ruta multipunto con 7 coordenadas). El
 * demo es público y limita la tasa de peticiones; 5 puntos cubren el caso de
 * uso (origen → vialidad preferida → CUCEI) sin provocar 400/429 por exceso
 * de trabajo y mantienen la búsqueda exacta del orden trivial en tiempo.
 */
export const MAX_WAYPOINTS = 5;

// ============================================================
// DESPACHO DE PROVEEDOR: TomTom (opcional) con respaldo en OSRM
// ============================================================

/** Valor de la bandera (ROUTING_PROVIDER o VITE_ROUTING_PROVIDER) que activa TomTom. */
const ROUTING_PROVIDER_TOMTOM = 'tomtom';

/** Ruta relativa del proxy propio (Vercel) hacia la Routing API de TomTom. */
const TOMTOM_PROXY_PATH = '/api/route';

/**
 * Techo de espera del proxy TomTom (ms). El servidor agota 10 s contra TomTom
 * (`UPSTREAM_TIMEOUT_MS` en api/route.ts); aquí se deja margen para la ida y
 * vuelta completa antes de degradar a OSRM.
 */
const TOMTOM_PROXY_TIMEOUT_MS = 15_000;

/**
 * Formato EXACTO que emite `buildDepartAt` (src/utils/departAt.ts): fecha y
 * hora locales con segundos ':00' y offset explícito '±HH:MM'. Cualquier otra
 * cadena se trata como ausente: TomTom nunca recibe una hora aproximada ni
 * inventada (el proxy además exige `departAt` no vacío en el servidor).
 */
const DEPART_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/**
 * Devuelve el valor de una variable de entorno solo si es un string no vacío.
 * Un valor vacío se trata como "sin definir" para seguir la cadena de respaldo.
 */
const readNonEmptyEnvString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * Bandera de despacho del proveedor. Orden de lectura:
 * 1. `import.meta.env.ROUTING_PROVIDER`: nombre canónico. En el build de
 *    Vercel/Vite se inyecta desde la variable de entorno del servidor
 *    ROUTING_PROVIDER (Vite la expone al bundle gracias a envPrefix en
 *    vite.config.ts). Su valor NO es un secreto; la CLAVE de TomTom no se lee
 *    jamás aquí: el navegador solo envía geometría y hora de salida al proxy,
 *    que añade la clave en el servidor.
 * 2. `import.meta.env.VITE_ROUTING_PROVIDER`: nombre heredado, se conserva
 *    por compatibilidad.
 * 3. `process.env.ROUTING_PROVIDER` y `process.env.VITE_ROUTING_PROVIDER`:
 *    respaldo del runner de pruebas de Node (sin Vite).
 * Sin bandera (o con cualquier otro valor) el despacho sigue en OSRM.
 */
const routingProviderFlag = (): string | null => {
  const metaEnv = import.meta.env;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return (
    readNonEmptyEnvString(metaEnv?.ROUTING_PROVIDER) ??
    readNonEmptyEnvString(metaEnv?.VITE_ROUTING_PROVIDER) ??
    readNonEmptyEnvString(processEnv?.ROUTING_PROVIDER) ??
    readNonEmptyEnvString(processEnv?.VITE_ROUTING_PROVIDER) ??
    null
  );
};

/** ¿Está activo el intento con TomTom? Solo con flag explícito, nunca por defecto. */
const isTomTomEnabled = (): boolean => routingProviderFlag() === ROUTING_PROVIDER_TOMTOM;

/**
 * Normaliza la hora de salida recibida: acepta SOLO el formato RFC 3339 exacto
 * de `buildDepartAt`. Cualquier otra entrada (null, undefined, '2026-02-30',
 * '2026-10-15' sin hora, '08:00', basura) produce `null`, que desactiva
 * TomTom para esa llamada y conserva el flujo OSRM existente sin alterarlo.
 */
const resolveDepartAt = (departAt: string | null | undefined): string | null =>
  typeof departAt === 'string' && DEPART_AT_PATTERN.test(departAt) ? departAt : null;

/**
 * Valida el `RouteResult` que devuelve el proxy POST /api/route (el servidor
 * ya adaptó la respuesta de TomTom). No se confía en la respuesta: distancia
 * y duración deben ser finitas y no negativas, y la geometría un LineString
 * con al menos dos coordenadas [lng, lat] dentro de rango. Devuelve `null`
 * ante cualquier problema (quien llama recurre a OSRM; nunca se usa un dato
 * inválido ni se inventa una duración).
 */
const parseRouteResult = (raw: unknown): RouteResult | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as { distance?: unknown; duration?: unknown; geometry?: unknown };
  const { distance, duration, geometry } = candidate;
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) {
    return null;
  }
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    return null;
  }
  if (typeof geometry !== 'object' || geometry === null) {
    return null;
  }
  const line = geometry as { type?: unknown; coordinates?: unknown };
  if (
    line.type !== 'LineString' ||
    !Array.isArray(line.coordinates) ||
    line.coordinates.length < 2
  ) {
    return null;
  }
  const coordinates: [number, number][] = [];
  for (const coordinate of line.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length !== 2) {
      return null;
    }
    const [lng, lat] = coordinate as [unknown, unknown];
    if (
      typeof lng !== 'number' ||
      typeof lat !== 'number' ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }
    coordinates.push([lng, lat]);
  }
  return { distance, duration, geometry: { type: 'LineString', coordinates } };
};

/**
 * Intenta la ruta con TomTom vía el proxy propio POST /api/route.
 *
 * El cuerpo replica el contrato ya validado por `parseRouteProxyRequest`
 * (tomTomRouteProxyRequest.ts): `{ origin: {lat,lng}, destination: {lat,lng},
 * waypoints: [{lat,lng}...], departAt }`, con `departAt` en RFC 3339.
 *
 * Devuelve `null` ante CUALQUIER problema (HTTP de error, red, timeout, JSON
 * ilegible o resultado inválido): el llamador cae en OSRM. No se registra el
 * cuerpo (contiene coordenadas del usuario) ni ninguna clave (no viaja ninguna).
 */
const fetchTomTomRoute = async (
  origin: RoutePoint,
  waypoints: RoutePoint[],
  destination: RoutePoint,
  departAt: string
): Promise<RouteResult | null> => {
  try {
    const response = await fetch(TOMTOM_PROXY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin, destination, waypoints, departAt }),
      signal: AbortSignal.timeout(TOMTOM_PROXY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    return parseRouteResult(data);
  } catch {
    return null;
  }
};

/**
 * Calcula la ruta entre dos puntos con despacho de proveedor.
 *
 * - Con `ROUTING_PROVIDER='tomtom'` (o el alias heredado
 *   `VITE_ROUTING_PROVIDER`) y un `departAt` RFC 3339 válido se
 *   intenta PRIMERO el proxy TomTom (tráfico histórico). Si falla o no está
 *   activo, se usa OSRM (el comportamiento histórico del proyecto, intacto).
 * - Sin `departAt` válido TomTom no se usa nunca: la hora no se adivina.
 *
 * @param originLon Longitud del origen
 * @param originLat Latitud del origen
 * @param destLon Longitud del destino
 * @param destLat Latitud del destino
 * @param departAt  Opcional: hora de salida RFC 3339 con offset, compuesta
 *                  con `buildDepartAt(date, time)` (src/utils/departAt.ts).
 * @returns Objeto con distancia, duración y geometría de la ruta
 */
export const calculateRoute = async (
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number,
  departAt?: string | null
): Promise<RouteResult> => {
  const resolvedDepartAt = resolveDepartAt(departAt);
  if (resolvedDepartAt && isTomTomEnabled()) {
    const tomTomRoute = await fetchTomTomRoute(
      { lat: originLat, lng: originLon },
      [],
      { lat: destLat, lng: destLon },
      resolvedDepartAt
    );
    if (tomTomRoute) {
      return tomTomRoute;
    }
    console.warn('TomTom no devolvió una ruta utilizable; se usa OSRM como respaldo.');
  }
  const url = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${destLon},${destLat}?overview=full&geometries=geojson`;
  return fetchOsrmRoute(url);
};

/**
 * Petición cruda a OSRM /route y validación de la respuesta.
 * Compartida por calculateRoute (2 puntos) y calculateRouteThrough (multipunto).
 */
async function fetchOsrmRoute(url: string): Promise<RouteResult> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Error en la petición a OSRM: ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No se pudo calcular una ruta entre los puntos especificados');
    }

    const route = data.routes[0];
    
    return {
      distance: route.distance, // metros
      duration: route.duration, // segundos
      geometry: route.geometry, // GeoJSON LineString
    };
  } catch (error) {
    console.error('Error en cálculo de ruta:', error);
    throw error;
  }
}

/**
 * Petición con un reintento simple: el servidor demo de OSRM devuelve 4xx
 * bajo ráfagas (límite de tasa). Solo se reintenta una vez y nunca se
 * convierte un fallo en datos ficticios: si persiste, se propaga el error.
 */
async function fetchWithOneRetry(url: string): Promise<Response> {
  // Nota: el servidor demo responde incluso 400 cuando limita la tasa de
  // peticiones, por lo que se reintenta ante cualquier fallo transitorio.
  let response = await fetch(url).catch(() => null);
  if (!response || !response.ok) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    response = await fetch(url).catch(() => null);
  }
  if (!response) {
    throw new Error('Error de red al consultar OSRM');
  }
  return response;
}

/**
 * Calcula la ruta que pasa por `waypoints` en el ORDEN dado, de `origin` a
 * `destination` (en este proyecto, CUCEI).
 *
 * OSRM resuelve la secuencia completa en UNA petición, por lo que la
 * geometría, la distancia y la duración devueltas corresponden siempre al
 * MISMO recorrido final (no hay que concatenar tramos ni sumar métricas).
 *
 * @throws Error comprensible si OSRM no puede trazar la ruta.
 */
export const calculateRouteThrough = async (
  origin: RoutePoint,
  waypoints: RoutePoint[],
  destination: RoutePoint,
  departAt?: string | null
): Promise<RouteResult> => {
  // Con ROUTING_PROVIDER='tomtom' (alias heredado: VITE_ROUTING_PROVIDER) y
  // una hora de salida RFC 3339 válida se
  // intenta primero el proxy TomTom (paradas incluidas). Sin hora válida, o si
  // TomTom falla, se conserva el flujo OSRM multipunto de una sola petición
  // descrito arriba (el error de OSRM se propaga igual que siempre).
  const resolvedDepartAt = resolveDepartAt(departAt);
  if (resolvedDepartAt && isTomTomEnabled()) {
    const tomTomRoute = await fetchTomTomRoute(origin, waypoints, destination, resolvedDepartAt);
    if (tomTomRoute) {
      return tomTomRoute;
    }
    console.warn('TomTom no devolvió una ruta utilizable; se usa OSRM como respaldo.');
  }

  const coordinates: RoutePoint[] = [origin, ...waypoints, destination];
  const path = coordinates.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&alternatives=false`;

  const response = await fetchWithOneRetry(url);
  if (!response.ok) {
    throw new Error(`Error en la petición a OSRM: ${response.status}`);
  }
  const data = await response.json();
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error('OSRM no pudo trazar una ruta válida por los puntos seleccionados');
  }
  const route = data.routes[0];
  return {
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry,
  };
};

/**
 * Matriz de tiempos de recorrido (segundos) entre todos los pares de
 * `points` usando el servicio `table` de OSRM. `durations[i][j]` es el
 * tiempo de conducir de i a j; null = par no alcanzable (se trata como
 * Infinity en la optimización).
 *
 * @throws Error si el servidor no devuelve una matriz válida.
 */
export const fetchDurationMatrix = async (points: RoutePoint[]): Promise<number[][]> => {
  const path = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/table/v1/driving/${path}?annotations=duration`;

  const response = await fetchWithOneRetry(url);
  if (!response.ok) {
    throw new Error(`Error en la petición a OSRM (table): ${response.status}`);
  }
  const data = await response.json();
  if (
    data.code !== 'Ok' ||
    !Array.isArray(data.durations) ||
    data.durations.length !== points.length
  ) {
    throw new Error('OSRM no devolvió una matriz de tiempos válida');
  }
  return data.durations as number[][];
};

/** Resultado de la optimización del orden de visita. */
export interface WaypointOrderResult {
  /**
   * Índices de los waypoints en el orden de visita elegido
   * (ej: [1, 0] = el waypoint 1 se visita antes que el 0).
   */
  order: number[];
  /**
   * true cuando el orden salió de la matriz de tiempos de OSRM;
   * false cuando se conservó el orden de selección del usuario porque el
   * servicio de optimización no estuvo disponible (no se simula nada).
   */
  optimized: boolean;
}

/**
 * Óptimo EXACTO del orden de visita con origen y destino fijos, vía
 * programación dinámica sobre subconjuntos (Held-Karp reducido):
 *
 *   dp[mask][i] = mínimo tiempo de ir del origen → visitar `mask` →
 *                 terminar en el waypoint i; y al final se añade i → destino.
 *
 * Con MAX_WAYPOINTS = 5 el estado es 2^5 × 5 = 160 celdas: exacto y
 * instantáneo. El costo proviene EXCLUSIVAMENTE de la matriz de tiempos de
 * OSRM (nunca de distancias en línea recta).
 *
 * Índices de la matriz: 0 = origen, 1..n = waypoints, n+1 = destino.
 */
function solveExactOrder(matrix: number[][], waypointCount: number): number[] {
  const size = 1 << waypointCount;
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: waypointCount }, () => INF)
  );
  const parent: number[][] = Array.from({ length: size }, () =>
    Array.from({ length: waypointCount }, () => -1)
  );

  const nodeOfWaypoint = (i: number) => i + 1;
  const destinationNode = waypointCount + 1;

  for (let i = 0; i < waypointCount; i++) {
    const cost = matrix[0]?.[nodeOfWaypoint(i)];
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      dp[1 << i][i] = cost;
    }
  }

  for (let mask = 1; mask < size; mask++) {
    for (let i = 0; i < waypointCount; i++) {
      if (!(mask & (1 << i)) || dp[mask][i] === INF) continue;
      for (let k = 0; k < waypointCount; k++) {
        if (mask & (1 << k)) continue;
        const leg = matrix[nodeOfWaypoint(i)]?.[nodeOfWaypoint(k)];
        if (typeof leg !== 'number' || !Number.isFinite(leg)) continue;
        const candidate = dp[mask][i] + leg;
        const nextMask = mask | (1 << k);
        if (candidate < dp[nextMask][k]) {
          dp[nextMask][k] = candidate;
          parent[nextMask][k] = i;
        }
      }
    }
  }

  const fullMask = size - 1;
  let best = -1;
  let bestCost = INF;
  for (let i = 0; i < waypointCount; i++) {
    const tail = matrix[nodeOfWaypoint(i)]?.[destinationNode];
    if (dp[fullMask][i] === INF) continue;
    if (typeof tail !== 'number' || !Number.isFinite(tail)) continue;
    const total = dp[fullMask][i] + tail;
    if (total < bestCost) {
      bestCost = total;
      best = i;
    }
  }

  if (best === -1) {
    throw new Error(
      'No existe una ruta por carretera que conecte todos los puntos seleccionados'
    );
  }

  const order: number[] = [];
  let mask = fullMask;
  let current = best;
  while (current !== -1) {
    order.push(current);
    const previous = parent[mask][current];
    mask &= ~(1 << current);
    current = previous;
  }
  return order.reverse();
}

/**
 * Decide el orden en que deben visitarse los waypoints intermedios con el
 * origen y el destino (CUCEI) fijos.
 *
 * - Con 0 o 1 waypoint no hay decisión de orden: se devuelve tal cual sin
 *   gastar una petición.
 * - Con 2 o más se pide la matriz de tiempos al servicio `table` de OSRM y
 *   se resuelve el orden óptimo exacto (solveExactOrder).
 * - Si `table` falla (p. ej. límite de tasa), se conserva el orden de
 *   selección del usuario y `optimized` queda en false para que la interfaz
 *   lo indique con honestidad. NO se simula una optimización.
 *
 * El servicio `trip` de OSRM no se usa: no garantiza fijar origen y
 * destino finales, que son restricciones de este proyecto.
 */
export const optimizeWaypointOrder = async (
  origin: RoutePoint,
  waypoints: RoutePoint[],
  destination: RoutePoint
): Promise<WaypointOrderResult> => {
  const identity = waypoints.map((_, index) => index);
  if (waypoints.length < 2) {
    return { order: identity, optimized: waypoints.length === 1 };
  }

  try {
    const matrix = await fetchDurationMatrix([origin, ...waypoints, destination]);
    return { order: solveExactOrder(matrix, waypoints.length), optimized: true };
  } catch (error) {
    console.warn('Optimización de orden no disponible:', error);
    return { order: identity, optimized: false };
  }
};

/**
 * Pipeline completo para una ruta con puntos de paso:
 * 1) optimiza el orden de los waypoints (matriz `table` de OSRM),
 * 2) calcula la geometría y las métricas finales pasando por todos ellos.
 *
 * Si falla el paso 2 se propaga el error: nunca se devuelve una ruta
 * incompleta como si fuera válida.
 */
export const buildWaypointRoute = async (
  origin: RoutePoint,
  waypoints: RoutePoint[],
  destination: RoutePoint,
  departAt?: string | null
): Promise<WaypointOrderResult & { route: RouteResult }> => {
  const { order, optimized } = await optimizeWaypointOrder(origin, waypoints, destination);
  const orderedWaypoints = order.map((index) => waypoints[index]);
  // La matriz de tiempos sigue siendo exclusiva de OSRM; `departAt` solo
  // afecta a la ruta final, que hace el despacho de proveedor dentro de
  // calculateRouteThrough (TomTom con respaldo en OSRM).
  const route = await calculateRouteThrough(origin, orderedWaypoints, destination, departAt);
  return { order, optimized, route };
};

/**
 * Formatea la distancia para mostrarla al usuario
 * @param distanceInMeters Distancia en metros
 * @returns String formateado (ej: "8.4 km")
 */
export const formatDistance = (distanceInMeters: number): string => {
  const km = distanceInMeters / 1000;
  if (km < 1) {
    return `${Math.round(distanceInMeters)} m`;
  }
  return `${km.toFixed(1)} km`;
};

/**
 * Formatea la duración para mostrarla al usuario
 * @param durationInSeconds Duración en segundos
 * @returns String formateado (ej: "21 min")
 */
export const formatDuration = (durationInSeconds: number): string => {
  const minutes = Math.round(durationInSeconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainingMinutes} min`;
};
