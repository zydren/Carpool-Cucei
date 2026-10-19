/**
 * Lógica PURA del proxy de rutas de TomTom: validación del cuerpo de la
 * petición y construcción de la URL de `calculateRoute`.
 *
 * No hace llamadas de red, no lee variables de entorno ni depende del runtime
 * de Vercel. Por eso es testeable de forma aislada (ver
 * test/tomTomRouteProxyRequest.test.ts) y reutilizable. La clave de API y el
 * `fetch` viven en el endpoint `api/route.ts`.
 *
 * Alcance de la Etapa 2: SOLO este endpoint. NO se integra aún en las páginas
 * ni se sustituye OSRM.
 */

import type { RoutePoint } from './routingService';

/** Base de la API de rutas de TomTom (v1). */
export const TOMTOM_ROUTE_BASE_URL =
  'https://api.tomtom.com/routing/1/calculateRoute';

/**
 * Límite total de puntos (origen + destino + paradas intermedias) por petición.
 * La API de TomTom admite hasta 150 waypoints, pero el proyecto limita las
 * paradas a MAX_WAYPOINTS = 5, así que este techo es holgado y defensivo.
 */
export const MAX_PROXY_POINTS = 25;

/** Resultado de validar el cuerpo de la petición. */
export type RouteProxyParseResult =
  | { ok: true; value: RouteProxyRequestBody }
  | { ok: false; error: string };

/** Cuerpo normalizado y validado que espera el proxy. */
export interface RouteProxyRequestBody {
  origin: RoutePoint;
  destination: RoutePoint;
  waypoints: RoutePoint[];
  /**
   * Hora de salida ya formateada por el cliente (ISO 8601 con offset de zona
   * horaria, p. ej. '2026-10-14T08:00:00-06:00'). El servidor NO la reconstruye
   * ni adivina la zona horaria: la usa tal cual para que el tráfico histórico
   * corresponda a la hora local de Guadalajara/México.
   */
  departAt: string;
}

/** Rangos geográficos válidos (WGS84), igual que el adaptador. */
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** ¿Es un punto {lat, lng} con coordenadas finitas y dentro de rango? */
const isValidPoint = (value: unknown): value is RoutePoint => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const point = value as { lat?: unknown; lng?: unknown };
  return (
    isFiniteNumber(point.lat) &&
    point.lat >= MIN_LATITUDE &&
    point.lat <= MAX_LATITUDE &&
    isFiniteNumber(point.lng) &&
    point.lng >= MIN_LONGITUDE &&
    point.lng <= MAX_LONGITUDE
  );
};

/**
 * Valida el cuerpo crudo (JSON ya parseado) de la petición al proxy.
 * No inventa valores: si falta algo o está fuera de rango, devuelve error.
 */
export const parseRouteProxyRequest = (raw: unknown): RouteProxyParseResult => {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'El cuerpo de la petición debe ser un objeto JSON.' };
  }

  const body = raw as Record<string, unknown>;
  const { origin, destination, waypoints, departAt } = body;

  if (!isValidPoint(origin)) {
    return { ok: false, error: 'Origen inválido: se esperaba { lat, lng } dentro de rango geográfico.' };
  }
  if (!isValidPoint(destination)) {
    return { ok: false, error: 'Destino inválido: se esperaba { lat, lng } dentro de rango geográfico.' };
  }
  if (typeof departAt !== 'string' || departAt.trim() === '') {
    return {
      ok: false,
      error: 'Hora de salida inválida: se esperaba "departAt" en formato ISO 8601 con zona horaria.',
    };
  }

  let normalizedWaypoints: RoutePoint[] = [];
  if (waypoints !== undefined) {
    if (!Array.isArray(waypoints) || waypoints.some((point) => !isValidPoint(point))) {
      return { ok: false, error: 'Puntos intermedios inválidos: cada uno debe ser { lat, lng } dentro de rango.' };
    }
    normalizedWaypoints = waypoints as RoutePoint[];
  }

  const totalPoints = 2 + normalizedWaypoints.length;
  if (totalPoints > MAX_PROXY_POINTS) {
    return {
      ok: false,
      error: `La ruta excede el límite de ${MAX_PROXY_POINTS} puntos (origen + destino + paradas).`,
    };
  }

  return {
    ok: true,
    value: {
      origin,
      destination,
      waypoints: normalizedWaypoints,
      departAt,
    },
  };
};

/**
 * Construye la URL de `calculateRoute` de TomTom.
 *
 * La clave API se pasa como parámetro `key` (así la espera la API de TomTom) y
 * se codifica. Esta función es pura y no registra nada: quien la use NUNCA debe
 * loguear la URL resultante porque contiene la clave.
 *
 * El path lleva cada punto en orden `latitud,longitud` (WGS84), como exige
 * la Routing API v1 de TomTom, unidos por ':' en el orden origen, paradas
 * intermedias y destino.
 *
 * @param body    Cuerpo ya validado por `parseRouteProxyRequest`.
 * @param apiKey  Clave de TomTom leída en el servidor (process.env).
 */
export const buildTomTomRouteUrl = (
  body: RouteProxyRequestBody,
  apiKey: string
): string => {
  const allPoints = [body.origin, ...body.waypoints, body.destination];
  // TomTom espera `latitud,longitud` en el path (¡NO longitud,latitud!).
  const locations = allPoints.map((point) => `${point.lat},${point.lng}`).join(':');

  const params = new URLSearchParams({
    key: apiKey,
    // 'all' es lo que habilita historicTrafficTravelTimeInSeconds (y el resto).
    computeTravelTimeFor: 'all',
    departAt: body.departAt,
    traffic: 'true',
    routeType: 'fastest',
  });

  return `${TOMTOM_ROUTE_BASE_URL}/${locations}/json?${params.toString()}`;
};
