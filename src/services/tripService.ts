import { supabase } from '../lib/supabase';
import type { LineStringGeometry } from '../services/routingService';


export interface TripSearchParams {
  origin?: string;
  destination?: string;
  date?: string;
  /**
   * Coordenadas opcionales del punto desde el que busca el pasajero.
   * Pueden venir del texto geocodificado (Nominatim) o de un clic en el mapa.
   */
  originLatitude?: number;
  originLongitude?: number;
}

export interface TripFromDB {
  id: string;
  driver_id: string;
  origin: string;
  destination: string;
  origin_lat: number | null;
  origin_lng: number | null;
  route_distance_km: number | null;
  route_duration_minutes: number | null;
  /** Geometría GeoJSON LineString origen→CUCEI (puede ser NULL en viajes antiguos). */
  route_geometry: LineStringGeometry | null;
  date: string;
  time: string;
  seats_available: number;
  price: number;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  driver_name: string;
  driver_rating: number;
  driver_university: string;
  driver_email: string;
}

export interface Trip {
  id: string;
  origin: string;
  destination: string;
  originLat: number | null;
  originLng: number | null;
  /** Geometría GeoJSON LineString origen→CUCEI (puede ser NULL en viajes antiguos). */
  routeGeometry: LineStringGeometry | null;
  date: string;
  time: string;
  seatsAvailable: number;
  price: number;
  driver: {
    id: string;
    name: string;
    rating: number;
    university: string;
  };
}

/**
 * Tipo de coincidencia entre la búsqueda del pasajero y un viaje.
 * - 'textual': el texto del origen del viaje contiene el texto buscado.
 * - 'origin':  el origen del viaje está dentro del radio de búsqueda.
 * - 'routeNearby': la ruta (route_geometry) del viaje pasa dentro del radio de
 *   búsqueda del punto indicado por el pasajero (CO no hace llamadas OSRM aquí;
 *   la distancia se calcula localmente a partir de los segmentos del LineString).
 * - 'all': el viaje se lista sin filtro alguno (vista "ver todos los viajes
 *   publicados"): no hubo coincidencia textual ni geográfica que evaluar.
 */
export type TripMatchType = 'textual' | 'origin' | 'routeNearby' | 'all';

/** Viaje de resultados enriquecido con la informaciÃ³n de la bÃºsqueda. */
export interface TripSearchResult extends Trip {
  matchType: TripMatchType;
  /**
   * Distancia en km entre el punto de bÃºsqueda y el origen del viaje.
   * null si el viaje no tiene coordenadas o no habÃ­a punto de bÃºsqueda.
   */
  distanceToOriginKm: number | null;
  /**
   * Distancia en km entre el punto de bÃºsqueda y la ruta del viaje
   * (distancePointToRouteKm). null si no aplicable.
   */
  distanceToRouteKm: number | null;
}

/**
 * Distancia mÃ­nima (km) desde un punto geogrÃ¡fico hasta una lÃ­nea
 * representada como un GeoJSON LineString.
 * 
 * Se calcula sobre cada segmento consecutivo del trayecto (par de
 * coordenadas [lng,lat]) y se toma el mÃ­nimo. No se hace ninguna
 * peticiÃ³n a OSRM: la ruta ya estÃ¡ guardada en route_geometry y la
 * distancia se computa puramente en local.
 */
export const distancePointToRouteKm = (
  point: { lat: number; lng: number },
  geometry: LineStringGeometry | null
): number | null => {
  if (!geometry || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return null;
  }

  const coords = geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const p: LatLng = { lat: point.lat, lng: point.lng };
  let minDistance = Infinity;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const a: LatLng = { lat: coords[i][1], lng: coords[i][0] };
    const b: LatLng = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const d = pointToSegmentDistanceKm(p, a, b);
    if (d < minDistance) {
      minDistance = d;
    }
  }

  return minDistance === Infinity ? null : minDistance;
};

/**
 * Punto del segmento rectilíneo terrestre a→b más cercano al punto p, junto
 * con su distancia en km.
 *
 * Devuelve el punto proyectado sobre la geodésica del segmento (y, si la
 * proyección cae fuera, el extremo más cercano). Es la MISMA matemática que
 * usaba pointToSegmentDistanceKm, extraída para poder reutilizarla y obtener
 * además las coordenadas del punto proyectado.
 */
const closestPointOnSegment = (
  p: LatLng,
  a: LatLng,
  b: LatLng
): { lat: number; lng: number; distanceKm: number } => {
  if (a.lat === b.lat && a.lng === b.lng) {
    return { lat: a.lat, lng: a.lng, distanceKm: haversineDistanceKm(p, a) };
  }

  const d_ab = haversineDistanceKm(a, b);
  const d_ap = haversineDistanceKm(p, a);
  const d_bp = haversineDistanceKm(p, b);

  if (d_ab === 0) {
    return { lat: a.lat, lng: a.lng, distanceKm: d_ap };
  }

  // Coseno del ángulo en a (ley de cosenos sobre las distancias haversine).
  const cosA = (d_ap * d_ap + d_ab * d_ab - d_bp * d_bp) / (2 * d_ap * d_ab);

  // Parámetro de proyección sobre el segmento: t = |a→p|·cos(A) / |a→b|.
  // (Usar cos(A) directamente como t colocaba el pie de la perpendicular en el
  // lugar equivocado en segmentos largos: el punto proyectado se iba hacia un
  // extremo y la distancia salía sobreestimada.)
  const t = Math.max(0, Math.min(1, (d_ap * cosA) / d_ab));

  const proj: LatLng = {
    lat: a.lat + t * (b.lat - a.lat),
    lng: a.lng + t * (b.lng - a.lng),
  };

  return { lat: proj.lat, lng: proj.lng, distanceKm: haversineDistanceKm(p, proj) };
};

/**
 * Distancia (km) mínima desde un punto p hasta el segmento rectilíneo
 * terrestre entre a y b. Envoltorio de closestPointOnSegment que conserva el
 * comportamiento y la firma anteriores.
 */
const pointToSegmentDistanceKm = (p: LatLng, a: LatLng, b: LatLng): number =>
  closestPointOnSegment(p, a, b).distanceKm;

/**
 * Punto de la ruta (route_geometry) más cercano a un punto geográfico.
 *
 * Reutiliza la misma proyección que distancePointToRouteKm
 * (closestPointOnSegment): recorre los segmentos del LineString y devuelve el
 * punto proyectado de menor distancia. No añade matemática nueva ni llamadas a
 * OSRM; sirve para dibujar el "punto de recogida ajustado" sobre la ruta sin
 * sustituir nunca el punto original del pasajero.
 *
 * @param point Punto del pasajero (lat/lng en grados)
 * @param geometry GeoJSON LineString de la ruta (coordenadas [lng,lat])
 * @returns { lat, lng, distanceKm } con el punto proyectado y su distancia, o
 *          null si no hay geometría válida.
 */
export const nearestPointOnRoute = (
  point: { lat: number; lng: number },
  geometry: LineStringGeometry | null
): { lat: number; lng: number; distanceKm: number } | null => {
  if (!geometry || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return null;
  }

  const coords = geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const p: LatLng = { lat: point.lat, lng: point.lng };
  let best: { lat: number; lng: number; distanceKm: number } | null = null;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const a: LatLng = { lat: coords[i][1], lng: coords[i][0] };
    const b: LatLng = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const candidate = closestPointOnSegment(p, a, b);
    if (best === null || candidate.distanceKm < best.distanceKm) {
      best = candidate;
    }
  }

  return best;
};

interface LatLng {
  lat: number;
  lng: number;
}

const haversineDistanceKm = (a: LatLng, b: LatLng): number => {
  const EARTH_RADIUS_KM = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.pow(Math.sin(dLat/2), 2) + Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) * Math.pow(Math.sin(dLng/2), 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

/**
 * Convierte una fila de la base de datos (TripFromDB) al objeto Trip
 * que consume la interfaz.
 */
export const mapTripFromDBToTrip = (trip: TripFromDB): Trip => ({
  id: trip.id,
  origin: trip.origin,
  destination: trip.destination,
  originLat: trip.origin_lat,
  originLng: trip.origin_lng,
  routeGeometry: trip.route_geometry,
  date: trip.date,
  time: trip.time,
  seatsAvailable: trip.seats_available,
  price: trip.price,
  driver: {
    id: trip.driver_id,
    name: trip.driver_name,
    rating: trip.driver_rating,
    university: trip.driver_university,
  },
});

/**
 * Columnas que la búsqueda pide a la vista `trips_with_driver`. Incluye las
 * columnas geográficas (origin_lat, origin_lng, route_geometry...) que se
 * añadieron a la tabla `trips` DESPUÉS de crear la vista: si la migración
 * supabase/migrations/006_update_trips_with_driver_view.sql todavía no está
 * aplicada, la vista no las expone y PostgREST responde 42703
 * ("column ... does not exist"). Antes eso hacía fallar la consulta completa y
 * la búsqueda devolvía 0 viajes (tanto "ver todos los viajes" como la búsqueda
 * por ubicación); ahora se detecta y se resuelve sin romper la búsqueda.
 */
const SEARCH_SELECT_COLUMNS = `
  id,
  driver_id,
  origin,
  destination,
  origin_lat,
  origin_lng,
  route_distance_km,
  route_duration_minutes,
  route_geometry,
  date,
  time,
  seats_available,
  price,
  notes,
  status,
  created_at,
  updated_at,
  driver_name,
  driver_rating,
  driver_university,
  driver_email
`;

/**
 * Columnas geográficas que la vista puede no exponer. Cuando faltan se leen de
 * la tabla base `trips`, cuya política RLS permite a cualquiera leer los viajes
 * con status = 'active'.
 */
const GEO_COLUMNS_SELECT =
  'origin_lat, origin_lng, route_distance_km, route_duration_minutes, route_geometry';

/** Fila de búsqueda: la parte geográfica puede faltar según el estado de la vista. */
type SearchRow = Partial<TripFromDB> & { id: string };

/** Evita repetir en cada búsqueda el aviso de "la vista no expone las columnas geográficas". */
let hasWarnedMissingGeoColumns = false;

/**
 * ¿El error de PostgREST significa "esa columna no existe"?
 * 42703 = undefined_column. Se comprueba también el mensaje por robustez.
 */
const isMissingColumnError = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  if (error.code === '42703') return true;
  return /column .* does not exist/i.test(error.message ?? '');
};

/**
 * Garantiza que las columnas geográficas existan siempre como null cuando la
 * vista no las expone o el viaje es antiguo, de modo que el resto del flujo
 * nunca reciba `undefined`.
 */
const withGeoDefaults = (row: SearchRow): TripFromDB => ({
  ...(row as TripFromDB),
  origin_lat: row.origin_lat ?? null,
  origin_lng: row.origin_lng ?? null,
  route_distance_km: row.route_distance_km ?? null,
  route_duration_minutes: row.route_duration_minutes ?? null,
  route_geometry: row.route_geometry ?? null,
});

/**
 * Ejecuta la consulta de viajes activos con los filtros de destino y fecha.
 * El origen NO se filtra en SQL: lo resuelve geoSearchService por coincidencia
 * textual y por proximidad geográfica.
 */
const runSearchQuery = async (params: TripSearchParams, columns: string) => {
  let query = supabase.from('trips_with_driver').select(columns).eq('status', 'active');

  if (params.destination && params.destination.trim() !== '') {
    query = query.ilike('destination', `%${params.destination}%`);
  }

  if (params.date && params.date.trim() !== '') {
    query = query.gte('date', params.date);
  }

  // Orden por fecha ascendente (la relevancia final la decide geoSearchService)
  return query.order('date', { ascending: true });
};

/**
 * Lee las columnas geográficas directamente de la tabla base `trips`.
 * Solo se usa cuando la vista no las expone (migración 006 pendiente).
 */
const fetchGeoColumnsByTripId = async (ids: string[]): Promise<Map<string, SearchRow>> => {
  const geoById = new Map<string, SearchRow>();
  if (ids.length === 0) {
    return geoById;
  }

  const { data, error } = await supabase
    .from('trips')
    .select(`id, ${GEO_COLUMNS_SELECT}`)
    .in('id', ids);

  if (error) {
    console.warn(
      '[fetchTripsForSearch] No se pudieron leer coordenadas/geometría desde la tabla trips:',
      error.message
    );
    return geoById;
  }

  for (const row of (data ?? []) as unknown as SearchRow[]) {
    geoById.set(row.id, row);
  }

  return geoById;
};

/**
 * Busca viajes activos en Supabase.
 * Aplica los filtros de destino y fecha, pero NO filtra el origen a nivel SQL:
 * el origen se resuelve en geoSearchService (coincidencia textual + geográfica),
 * de modo que también aparezcan viajes cercanos o cuya ruta pasa cerca de la
 * ubicación buscada aunque su texto no coincida.
 * @param params Parámetros de búsqueda (destination, date opcionales)
 * @returns Filas de base de datos de viajes activos
 */
export const fetchTripsForSearch = async (
  params: TripSearchParams
): Promise<TripFromDB[]> => {
  try {
    const response = await runSearchQuery(params, SEARCH_SELECT_COLUMNS);

    if (response.error && isMissingColumnError(response.error)) {
      // La vista no expone las columnas geográficas: se repite la consulta con
      // '*' (válido para cualquier versión de la vista) y se completan las
      // coordenadas y route_geometry desde la tabla base `trips`.
      if (!hasWarnedMissingGeoColumns) {
        hasWarnedMissingGeoColumns = true;
        console.warn(
          '[fetchTripsForSearch] La vista trips_with_driver no expone las columnas geográficas (' +
            response.error.message +
            '). Se consultará SELECT * + tabla trips. Aplica ' +
            'supabase/migrations/006_update_trips_with_driver_view.sql para evitarlo.'
        );
      }

      const fallback = await runSearchQuery(params, '*');

      if (fallback.error) {
        console.error('Error searching trips:', fallback.error);
        throw fallback.error;
      }

      const rows = (fallback.data ?? []) as unknown as SearchRow[];
      const geoById = await fetchGeoColumnsByTripId(rows.map((row) => row.id));

      return rows.map((row) => {
        const geo = geoById.get(row.id);
        return withGeoDefaults(geo ? { ...row, ...geo } : row);
      });
    }

    if (response.error) {
      console.error('Error searching trips:', response.error);
      throw response.error;
    }

    const rows = (response.data ?? []) as unknown as SearchRow[];
    return rows.map((row) => withGeoDefaults(row));
  } catch (error) {
    console.error('Error in fetchTripsForSearch:', error);
    throw error;
  }
};

/**
 * Obtiene un viaje por su ID
 * @param tripId ID del viaje
 * @returns El viaje encontrado o null si no existe
 */
export const getTripById = async (tripId: string): Promise<Trip | null> => {
  try {
    const { data, error } = await supabase
      .from('trips_with_driver')
      .select('*')
      .eq('id', tripId)
      .eq('status', 'active')
      .single();

    if (error) {
      console.error('Error getting trip:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    return mapTripFromDBToTrip(data as TripFromDB);
  } catch (error) {
    console.error('Error in getTripById:', error);
    return null;
  }
};

/**
 * Parámetros para crear un viaje nuevo (ofrecer viaje).
 * Los nombres coinciden con las columnas de la tabla trips en Supabase.
 */
export interface CreateTripParams {
  origin: string;
  destination: string;
  /** Coordenadas del origen seleccionado por el conductor. */
  origin_lat: number;
  origin_lng: number;
  route_distance_km: number;
  route_duration_minutes: number;
  /** Geometría GeoJSON LineString de la ruta origen→CUCEI (para búsquedas "ruta pasa cerca"). */
  route_geometry?: LineStringGeometry | null;
  date: string;
  time: string;
  seats_available: number;
  price: number;
  notes?: string | null;
}

/**
 * Crea un nuevo viaje en la base de datos
 * @param params Parámetros del viaje a crear
 * @returns El viaje creado
 */
export const createTrip = async (params: CreateTripParams) => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error('Usuario no autenticado');
    }

    const { data, error } = await supabase
      .from('trips')
      .insert({
        driver_id: user.id,
        origin: params.origin,
        destination: params.destination,
        origin_lat: params.origin_lat,
        origin_lng: params.origin_lng,
        route_distance_km: params.route_distance_km,
        route_duration_minutes: params.route_duration_minutes,
        route_geometry: params.route_geometry ?? null,
        date: params.date,
        time: params.time,
        seats_available: params.seats_available,
        price: params.price,
        notes: params.notes || null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating trip:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error in createTrip:', error);
    throw error;
  }
};
/**
 * Obtiene los viajes publicados por el usuario autenticado.
 * @returns Array de viajes creados por el conductor actual
 */
export const getTripsByDriver = async (): Promise<TripFromDB[]> => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error('Debes iniciar sesión');
    }

    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .eq('driver_id', user.id)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error getting trips by driver:', error);
      throw error;
    }

    return (data || []) as TripFromDB[];
  } catch (error) {
    console.error('Error in getTripsByDriver:', error);
    throw error;
  }
};

/**
 * Elimina un viaje publicado por el usuario autenticado.
 * La política RLS "Drivers can delete own trips" garantiza que solo el
 * conductor del viaje pueda eliminarlo. Las solicitudes asociadas y las
 * calificaciones se eliminan en cascada (ON DELETE CASCADE).
 * @param tripId ID del viaje a eliminar
 */
export const deleteTrip = async (tripId: string): Promise<void> => {
  try {
    const { error } = await supabase.from('trips').delete().eq('id', tripId);

    if (error) {
      console.error('Error deleting trip:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in deleteTrip:', error);
    throw error;
  }
};

/**
 * Determina si un viaje ya terminó (y por tanto es calificable).
 * - Completado -> sí.
 * - Cancelado -> no.
 * - Activo -> sí solo si su fecha/hora ya pasaron.
 */
export const isTripOver = (trip: {
  date: string;
  time: string;
  status?: string;
}): boolean => {
  if (trip.status === 'completed') return true;
  if (trip.status === 'cancelled') return false;

  const datePart = trip.date.slice(0, 10);
  const timePart = trip.time.slice(0, 5);

  if (!datePart || !timePart) return false;

  const tripDateTime = new Date(`${datePart}T${timePart}`);
  return tripDateTime.getTime() < Date.now();
};