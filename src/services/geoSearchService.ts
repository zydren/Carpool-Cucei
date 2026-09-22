import {
  fetchTripsForSearch,
  mapTripFromDBToTrip,
  distancePointToRouteKm,
} from './tripService';
import type {
  Trip,
  TripSearchParams,
  TripSearchResult,
} from './tripService';

// ============================================================
// CONSTANTE CONFIGURABLE DE LA BÚSQUEDA POR PROXIMIDAD
// ============================================================

/**
 * Radio (km) alrededor del punto de búsqueda usado por la coincidencia
 * `routeNearby`: distancia máxima permitida entre el punto de partida del
 * pasajero y la RUTA del conductor (route_geometry). Es deliberadamente más
 * estricto que el radio de origen (ORIGIN_RADIUS_KM), porque aquí se mide
 * punto → polilínea de la ruta, no punto → origen del viaje.
 */
export const SEARCH_RADIUS_KM = 1;

/**
 * Radio (km) alrededor del punto de búsqueda usado por la coincidencia
 * `origin`: distancia máxima permitida entre el punto del pasajero y el ORIGEN
 * del viaje. Conserva el valor histórico (5 km) para no alterar la búsqueda por
 * origen cercano.
 */
export const ORIGIN_RADIUS_KM = 5;

// ============================================================
// DIAGNÓSTICO TEMPORAL DE LA BÚSQUEDA (retirar al cerrar la incidencia)
// ============================================================
/**
 * Activa los logs de diagnóstico de la búsqueda geográfica. Poner en `false`
 * (o borrar este bloque junto con sus usos) para dejar la búsqueda sin logs.
 */
const DEBUG_SEARCH_LOGS = true;

/** Viaje bajo investigación: Arcos de Zapopan → CUCEI. */
const DEBUG_TRIP_ID = 'b339586c-9590-415c-9f23-508261cf822b';

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
  // 'routeNearby' tiene menor prioridad que 'origin': el punto buscado está
  // cerca de la ruta del viaje, pero más lejos de su origen.
  routeNearby: 2,
  // 'all' es el listado sin filtros: sin señal de coincidencia que ponderar.
  all: 3,
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
  const matchDistanceKm = trip.distanceToOriginKm ?? trip.distanceToRouteKm ?? 0;

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
 *   viajes cuyo ORIGEN está dentro de ORIGIN_RADIUS_KM del punto de búsqueda, y
 *   también los viajes cuya route_geometry (guardada en la BD) pasa dentro de
 *   SEARCH_RADIUS_KM del punto. La distancia a la ruta se calcula en local con
 *   distancePointToRouteKm sobre los segmentos del LineString: NO se hace
 *   ninguna petición a OSRM por viaje durante la búsqueda.
 * - El texto de origen (params.origin) se conserva como complemento textual:
 *   los viajes cuyo origen contiene ese texto también aparecen.
 * - Sin coordenadas y sin texto de origen: se conserva la búsqueda actual
 *   por destino/fecha (el origen NO es obligatorio).
 *
 * NOTA: la comprobación de "la ruta del viaje pasa cerca" usa la geometría
 * guardada en trips.route_geometry (LineString de OSRM). Si la fila llega sin
 * geometría (viajes antiguos o vista que no expone la columna), ese viaje solo
 * puede coincidir por texto u origen cercano; nunca se llama a OSRM durante la
 * búsqueda para no degradar el rendimiento.
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

  if (DEBUG_SEARCH_LOGS) {
    console.log('[geoSearch][diagnóstico] searchTripsByLocation', {
      origin: params.origin ?? null,
      originLatitude: params.originLatitude ?? null,
      originLongitude: params.originLongitude ?? null,
      date: params.date ?? null,
      hasSearchPoint,
      'trips returned by fetchTripsForSearch': items.length,
    });
  }

  const results: TripSearchResult[] = [];

  for (const item of items) {
    const trip: Trip = mapTripFromDBToTrip(item);
    const textMatch = isTextualOriginMatch(trip.origin, originText);
    const tripHasCoords = trip.originLat != null && trip.originLng != null;
    /** Diagnóstico temporal: solo se detalla el viaje bajo investigación. */
    const isDebugTrip = DEBUG_SEARCH_LOGS && trip.id === DEBUG_TRIP_ID;

    let distanceToOriginKm: number | null = null;
    let distanceToRouteKm: number | null = null;

    if (tripHasCoords && hasSearchPoint) {
      distanceToOriginKm = haversineDistanceKm(
        {
          lat: params.originLatitude as number,
          lng: params.originLongitude as number,
        },
        { lat: trip.originLat as number, lng: trip.originLng as number }
      );

      // Calcular distancia a la ruta si existe route_geometry
      if (trip.routeGeometry) {
        distanceToRouteKm = distancePointToRouteKm(
          {
            lat: params.originLatitude as number,
            lng: params.originLongitude as number,
          },
          trip.routeGeometry
        );
      }
    }

    // Señales de coincidencia calculadas SIEMPRE (aunque no haya punto de
    // búsqueda) para poder diagnosticarlas. Ninguna descarta a las demás:
    // basta una (texto, origen cerca o ruta cerca) para conservar el viaje.
    const originNear = distanceToOriginKm !== null && distanceToOriginKm <= ORIGIN_RADIUS_KM;
    const routeNear = distanceToRouteKm !== null && distanceToRouteKm <= SEARCH_RADIUS_KM;

    let matchType: TripSearchResult['matchType'] | null = null;

    if (hasSearchPoint) {
      // Proximidad: origen dentro del radio configurado, O la ruta del viaje
      // (route_geometry) pasa dentro del radio del punto indicado. Un origen
      // lejano NO descarta un viaje cuya ruta pasa cerca (routeNearby).
      if (originNear) {
        matchType = 'origin';
      } else if (routeNear) {
        matchType = 'routeNearby';
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

    if (isDebugTrip) {
      console.log('[geoSearch][diagnóstico] evaluación del viaje ' + trip.id, {
        'search point': hasSearchPoint
          ? { lat: params.originLatitude, lng: params.originLongitude }
          : null,
        'origin coordinates': tripHasCoords
          ? { lat: trip.originLat, lng: trip.originLng }
          : null,
        'route geometry exists': trip.routeGeometry !== null,
        'route geometry points': trip.routeGeometry?.coordinates.length ?? 0,
        distanceToOriginKm,
        distanceToRouteKm,
        textMatch,
        originNear,
        routeNear,
        matchType: matchType ?? 'null (viaje DESCARTADO)',
        routeRadiusKm: SEARCH_RADIUS_KM,
        originRadiusKm: ORIGIN_RADIUS_KM,
      });
    }

    if (matchType === null) {
      continue;
    }

    results.push({ ...trip, matchType, distanceToOriginKm, distanceToRouteKm });
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

/**
 * Devuelve TODOS los viajes activos publicados, sin aplicar ningún filtro de
 * origen, fecha ni destino: es la vista "ver todos los viajes" de la página
 * de búsqueda. Los resultados se ordenan cronológicamente (fecha ascendente
 * y, a igual fecha, hora de salida ascendente) para que el listado sea
 * predecible para el pasajero.
 *
 * @returns Array de todos los viajes activos como TripSearchResult con
 *          matchType 'all' (sin distancias de coincidencia).
 */
export const getAllPublishedTrips = async (): Promise<TripSearchResult[]> => {
  // Sin params: fetchTripsForSearch no aplica filtros de destino/fecha.
  const items = await fetchTripsForSearch({});

  if (DEBUG_SEARCH_LOGS) {
    console.log(
      '[geoSearch][diagnóstico] getAllPublishedTrips ("ver todos los viajes") -> filas de la BD: ' +
        items.length
    );
  }

  const results: TripSearchResult[] = items.map((item) => {
    const trip: Trip = mapTripFromDBToTrip(item);
    return {
      ...trip,
      matchType: 'all',
      distanceToOriginKm: null,
      distanceToRouteKm: null,
    };
  });

  // Orden cronológico: fetchTripsForSearch ya ordena por fecha; se reafirma
  // aquí (y se desempata por hora) para no depender del orden de la BD.
  results.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    if (a.time !== b.time) {
      return a.time < b.time ? -1 : 1;
    }
    return 0;
  });

  return results;
};
