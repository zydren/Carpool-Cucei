import { fetchTripsForSearch, mapTripFromDBToTrip } from './tripService';
import type {
  Trip,
  TripSearchParams,
  TripSearchResult,
} from './tripService';

// ============================================================
// CONSTANTE CONFIGURABLE DE LA BÚSQUEDA POR PROXIMIDAD
// ============================================================

/**
 * Radio (km) alrededor del punto de búsqueda dentro del cual se consideran
 * los viajes por "origen cercano". Es la ÚNICA constante de radio del
 * proyecto: cambiar este número reconfigura toda la búsqueda por proximidad.
 */
export const SEARCH_RADIUS_KM = 5;

// ============================================================
// MATEMÁTICA GEOGRÁFICA
// ============================================================

interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Distancia (km) entre dos coordenadas por Haversine (gran círculo). */
const haversineDistanceKm = (a: LatLng, b: LatLng): number => {
  const EARTH_RADIUS_KM = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

// ============================================================
// RELEVANCIA DE RESULTADOS
// ============================================================

interface TripRelevanceInput {
  trip: TripSearchResult;
  /** Fecha solicitada (YYYY-MM-DD) o null si no se filtró por fecha. */
  requestedDate: string | null;
}

/**
 * Pesos de la puntuación de relevancia, separados por órdenes de magnitud.
 * Menor puntuación = mejor resultado. El orden de importancia es:
 *   1ro: tipo de coincidencia (textual > origen cercano)
 *   2do: cercanía a la fecha solicitada (mismo día = 0)
 *   3ro: distancia al punto de búsqueda (más cerca = mejor)
 *   4to: hora de salida (más temprano = mejor, desempate)
 */
const RELEVANCE_TYPE_WEIGHT = 1_000_000;
const RELEVANCE_DATE_WEIGHT = 10_000;
const RELEVANCE_DISTANCE_WEIGHT = 10;
const RELEVANCE_TIME_WEIGHT = 1;

const matchTypePriority: Record<TripSearchResult['matchType'], number> = {
  textual: 0,
  origin: 1,
};

/**
 * Calcula la relevancia de un viaje frente a la búsqueda.
 * Aislada y fácil de modificar: ajusta pesos o añade señales sin tocar
 * la lógica que recorre los viajes.
 */
export const calculateTripRelevance = ({
  trip,
  requestedDate,
}: TripRelevanceInput): number => {
  // 1. Tipo de coincidencia
  const typePriority = matchTypePriority[trip.matchType];

  // 2. Días de diferencia con la fecha solicitada (0 = el día exacto)
  let dateDistanceDays = 0;
  if (requestedDate) {
    const requestedMs = new Date(requestedDate.slice(0, 10)).getTime();
    const tripMs = new Date(trip.date.slice(0, 10)).getTime();
    dateDistanceDays = Math.max(0, Math.round((tripMs - requestedMs) / 86_400_000));
  }

  // 3. Distancia al punto de búsqueda (0 si no hubo punto de búsqueda
  //    o el viaje no tiene coordenadas)
  const matchDistanceKm = trip.distanceToOriginKm ?? 0;

  // 4. Hora de salida en minutos desde medianoche (desempate)
  const [hoursText, minutesText] = trip.time.slice(0, 5).split(':');
  const timeMinutes = Number(hoursText || 0) * 60 + Number(minutesText || 0);

  return (
    typePriority * RELEVANCE_TYPE_WEIGHT +
    dateDistanceDays * RELEVANCE_DATE_WEIGHT +
    Math.round(matchDistanceKm * 100) * RELEVANCE_DISTANCE_WEIGHT +
    timeMinutes * RELEVANCE_TIME_WEIGHT
  );
};

// ============================================================
// BÚSQUEDA
// ============================================================

/** Compara el texto del origen con la consulta (misma semántica que un ilike %q%). */
const isTextualOriginMatch = (origin: string, query: string): boolean => {
  if (!query || query.trim() === '') {
    return false;
  }
  return origin.toLowerCase().includes(query.toLowerCase());
};

/**
 * Busca viajes por proximidad y/o por texto.
 *
 * - Si se reciben originLatitude/originLongitude (provenientes del texto
 *   geocodificado con Nominatim o de un clic en el mapa): se incluyen los
 *   viajes cuyo ORIGEN está dentro de SEARCH_RADIUS_KM del punto de búsqueda.
 * - El texto de origen (params.origin) se conserva como complemento textual:
 *   los viajes cuyo origen contiene ese texto también aparecen.
 * - Sin coordenadas y sin texto de origen: se conserva la búsqueda actual
 *   por destino/fecha (el origen NO es obligatorio).
 *
 * NOTA (siguiente etapa): la comprobación de "la ruta del viaje pasa cerca
 * del punto" requiere la geometría de la ruta guardada en la base de datos
 * (hoy solo se guardan distancia/duración). No se hace una petición OSRM por
 * viaje para no degradar el rendimiento; quedará como mejora futura.
 */
export const searchTripsByLocation = async (
  params: TripSearchParams
): Promise<TripSearchResult[]> => {
  const originText = (params.origin ?? '').trim();
  const hasSearchPoint =
    params.originLatitude != null &&
    params.originLongitude != null &&
    Number.isFinite(params.originLatitude) &&
    Number.isFinite(params.originLongitude);

  // Viajes activos con los filtros de destino/fecha (sin filtro SQL de origen)
  const items = await fetchTripsForSearch(params);

  const results: TripSearchResult[] = [];

  for (const item of items) {
    const trip: Trip = mapTripFromDBToTrip(item);
    const textMatch = isTextualOriginMatch(trip.origin, originText);
    const tripHasCoords = trip.originLat != null && trip.originLng != null;

    let distanceToOriginKm: number | null = null;
    if (tripHasCoords && hasSearchPoint) {
      distanceToOriginKm = haversineDistanceKm(
        {
          lat: params.originLatitude as number,
          lng: params.originLongitude as number,
        },
        { lat: trip.originLat as number, lng: trip.originLng as number }
      );
    }

    let matchType: TripSearchResult['matchType'] | null = null;

    if (hasSearchPoint) {
      // Proximidad: origen dentro del radio configurado
      if (distanceToOriginKm !== null && distanceToOriginKm <= SEARCH_RADIUS_KM) {
        matchType = 'origin';
      }
      // Complemento textual: no se pierden los resultados que coinciden
      // literalmente con lo escrito por el usuario.
      if (textMatch) {
        matchType = 'textual';
      }
    } else if (originText === '') {
      // Sin origen: comportamiento actual (solo destino/fecha)
      matchType = 'textual';
    } else if (textMatch) {
      matchType = 'textual';
    }

    if (matchType === null) {
      continue;
    }

    results.push({ ...trip, matchType, distanceToOriginKm });
  }

  // Ordenar por relevancia
  const requestedDate = (params.date ?? '').trim() || null;
  results.sort(
    (a, b) =>
      calculateTripRelevance({ trip: a, requestedDate }) -
      calculateTripRelevance({ trip: b, requestedDate })
  );

  return results;
};