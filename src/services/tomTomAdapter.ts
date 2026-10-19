/**
 * Adaptador PURO de la respuesta de TomTom Routing API (calculateRoute) al
 * formato `RouteResult` que ya consume la aplicación (mismo contrato que OSRM).
 *
 * Alcance de esta etapa: SOLO transformación de datos. No hace llamadas HTTP,
 * no lee variables de entorno, no toca la base de datos ni el frontend. La
 * integración real (proxy, páginas) es de etapas posteriores.
 *
 * Forma esperada de entrada (calculateRoute con `computeTravelTimeFor=all`):
 *   {
 *     routes: [{
 *       summary: { lengthInMeters, travelTimeInSeconds,
 *                  noTrafficTravelTimeInSeconds?, historicTrafficTravelTimeInSeconds?,
 *                  liveTrafficIncidentsTravelTimeInSeconds?, ... },
 *       legs: [{ points: [{ latitude, longitude }, ...] }]
 *     }]
 *   }
 *
 * Contrato de salida: igual que OSRM -> `RouteResult`
 *   { distance (m), duration (s), geometry: LineString { coordinates: [lng, lat] } }
 */

import type { LineStringGeometry, RouteResult } from './routingService';

/** Forma mínima de un punto de geometría de TomTom. */
interface TomTomPoint {
  latitude: number;
  longitude: number;
}

/** Tramo (leg) de la ruta de TomTom. */
interface TomTomLeg {
  points?: TomTomPoint[];
}

/** Resumen de la ruta de TomTom (subconjunto documentado que usamos). */
interface TomTomSummary {
  lengthInMeters: number;
  travelTimeInSeconds: number;
  noTrafficTravelTimeInSeconds?: number;
  historicTrafficTravelTimeInSeconds?: number;
  liveTrafficIncidentsTravelTimeInSeconds?: number;
}

/** Una ruta dentro de `routes`. */
interface TomTomRoute {
  summary: TomTomSummary;
  legs?: TomTomLeg[];
}

/** Respuesta completa de `calculateRoute` (subconjunto que consumimos). */
export interface TomTomCalculateRouteResponse {
  routes?: TomTomRoute[];
}

/** Rangos geográficos válidos (WGS84) para las coordenadas de un punto. */
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/** ¿El valor es un número finito utilizable? */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** ¿El valor es un número finito y no negativo (válido para distancia/duración)? */
const isNonNegativeFinite = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0;

/** ¿La latitud está dentro del rango geográfico [-90, 90]? */
const isValidLatitude = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= MIN_LATITUDE && value <= MAX_LATITUDE;

/** ¿La longitud está dentro del rango geográfico [-180, 180]? */
const isValidLongitude = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= MIN_LONGITUDE && value <= MAX_LONGITUDE;

/**
 * Convierte la respuesta de TomTom `calculateRoute` en el `RouteResult` que ya
 * usa la app, o `null` si no se puede construir una ruta válida.
 *
 * Reglas (sin inventar datos):
 * - `distance` = `summary.lengthInMeters`. Debe ser un número finito y NO
 *   negativo; si no, se devuelve `null`.
 * - `duration` = `summary.historicTrafficTravelTimeInSeconds` (tráfico
 *   HISTÓRICO por día/hora de salida). Es la métrica objetivo del proyecto.
 *   NO se usa `travelTimeInSeconds` porque incluye tráfico en tiempo real, que
 *   queda explícitamente fuera de alcance. Debe ser finito y NO negativo; si la
 *   histórica no está disponible (p. ej. `computeTravelTimeFor` no la pidió) o
 *   es inválida, se devuelve `null` para que el llamador recurra a OSRM en
 *   lugar de mostrar una duración inventada.
 * - `geometry` = concatenación, en orden, de los `points` de todos los `legs`,
 *   convertidos a `[longitude, latitude]`. Para una ruta simple equivale a
 *   `legs[0].points`; con paradas intermedias arma la polilínea completa.
 *   Reglas de la geometría:
 *     - Se descartan puntos cuyas coordenadas no sean finitas o caigan fuera de
 *       los rangos geográficos válidos (lat [-90,90], lng [-180,180]).
 *     - Se eliminan puntos CONSECUTIVOS idénticos: el punto de unión que
 *       comparten dos `legs` aparece como último del anterior y primero del
 *       siguiente, y duplicarlo generaría un segmento de longitud cero
 *       innecesario. Tras la deduplicación se exigen al menos 2 puntos.
 *
 * No modifica el objeto de entrada: solo lo lee.
 *
 * @returns `RouteResult` o `null` si faltan datos históricos o geometría.
 */
export const tomTomRouteToRouteResult = (
  response: TomTomCalculateRouteResponse
): RouteResult | null => {
  const route = response?.routes?.[0];
  if (!route) {
    return null;
  }

  const summary = route.summary;
  const distance = summary?.lengthInMeters;
  const duration = summary?.historicTrafficTravelTimeInSeconds;

  // Sin distancia o sin duración histórica VÁLIDAS (finitas y no negativas) no
  // hay ruta utilizable para el objetivo del proyecto: se delega en OSRM
  // (nunca se simula la duración ni se inventa un valor).
  if (!isNonNegativeFinite(distance) || !isNonNegativeFinite(duration)) {
    return null;
  }

  const coordinates: [number, number][] = [];
  for (const leg of route.legs ?? []) {
    for (const point of leg.points ?? []) {
      if (isValidLatitude(point?.latitude) && isValidLongitude(point?.longitude)) {
        const coordinate: [number, number] = [point.longitude, point.latitude];
        // Evita duplicar el punto de unión entre legs consecutivos (segmento
        // de longitud cero). Solo compara con el último punto YA aceptado.
        const previous = coordinates[coordinates.length - 1];
        if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
          coordinates.push(coordinate);
        }
      }
    }
  }

  // Un LineString necesita al menos dos puntos distintos; con menos no es dibujable.
  if (coordinates.length < 2) {
    return null;
  }

  const geometry: LineStringGeometry = { type: 'LineString', coordinates };
  return { distance, duration, geometry };
};
