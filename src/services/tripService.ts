import { supabase } from '../lib/supabase';
import type { LineStringGeometry } from '../services/routingService';
import { parseTripDateTime } from '../utils/dateTime';

// ============================================================
// CICLO DE VIDA DEL VIAJE (columna trips.status)
// ============================================================
/**
 * Estados del viaje. Son los nombres EXISTENTES en la base de datos
 * (CHECK trips_status_check, ver supabase/migrations/add_trip_lifecycle.sql);
 * no se renombran para conservar la compatibilidad con los datos actuales,
 * con los triggers de solicitudes/ratings y con el frontend.
 *
 * Equivalencia con el ciclo de vida conceptual:
 *   scheduled             -> 'active'               publicado; en búsqueda si su salida aún no pasó
 *   in_progress           -> 'in_progress'          ETAPA 2: estado EFECTIVO por horario (la BD
 *                                                   lo deriva de la salida; no se persiste)
 *   pending_completion    -> 'pending_completion'   ETAPA 2: el viaje ya terminó y se esperan las
 *                                                   confirmaciones de los participantes
 *   completed             -> 'completed'            finalizado; nunca aparece en búsqueda
 *   cancelled             -> 'cancelled'            cancelado; nunca aparece en búsqueda
 *
 * Regla de búsqueda (etapa 1): un viaje es elegible SOLO si su status es
 * 'active', tiene lugares disponibles y su fecha + hora de salida aún no ha
 * pasado. La comprobación principal se hace en la consulta a Supabase
 * (runSearchQuery); el frontend aplica además una defensa en cliente.
 *
 * REGLA DE FINALIZACIÓN (etapa 2): el viaje pasa a 'completed' cuando
 * confirman todos los participantes (conductor + pasajeros 'accepted') o, de
 * forma automática, 48 h después de su fin programado. El detalle está en
 * supabase/migrations/add_trip_completion.sql y en los helpers
 * getTripLifecycleStatus / canConfirmTripCompletion de este archivo.
 *
 * HISTORIAL (etapa 3): el historial es una lectura de estos mismos datos. Un
 * viaje vive en «Próximos» mientras su estado efectivo es scheduled /
 * in_progress / pending_completion, y pasa a «Historial» en cuanto es
 * completed o cancelled (helpers isTripLifecycleUpcoming /
 * isTripLifecycleFinished). No hay tabla de historial: las consultas
 * existentes (getTripsByDriver, getMyRequestedTrips) ya devuelven los viajes
 * de cualquier estado y las calificaciones siguen siendo el mismo sistema
 * (ratingService + RPC submit_rating).
 */
export const TRIP_STATUS = {
  ACTIVE: 'active',
  IN_PROGRESS: 'in_progress',
  PENDING_COMPLETION: 'pending_completion',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type TripStatus = (typeof TRIP_STATUS)[keyof typeof TRIP_STATUS];

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

/** Evita repetir en cada búsqueda el aviso de "falta la columna departure_at". */
let hasWarnedMissingDepartureColumn = false;

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
 * Modo en que la búsqueda filtra la SALIDA del viaje (fecha + hora) a nivel SQL.
 * - 'departure_at': compara contra la columna generada `departure_at`
 *   (migración add_trip_lifecycle.sql). Es el modo ideal: un único instante
 *   TIMESTAMPTZ ya interpretado en America/Mexico_City, indexado y ajeno a
 *   la zona horaria del cliente.
 * - 'local': sin la migración aplicada, se compara `date`/`time` (naive, en
 *   hora local de México) contra la fecha y hora ACTUALES del cliente con un
 *   filtro OR de PostgREST:
 *     date > HOY  OR  (date = HOY AND time > AHORA)
 *   Mismo efecto que departure_at para usuarios en México (UTC-6 sin horario
 *   de verano desde 2022). Es un filtro de Supabase, no una lógica de React.
 */
type DepartureFilterMode = 'departure_at' | 'local';

/**
 * Construye el filtro OR local (modo 'local') a partir de la hora actual del
 * cliente, ya en formato YYYY-MM-DD y HH:MM (pad con ceros). Se parsea la
 * fecha a mano para que siempre sea la hora LOCAL del dispositivo.
 */
const buildLocalDepartureFilter = (now: Date): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;
  const time = `${hours}:${minutes}`;
  return `date.gt.${today},and(date.eq.${today},time.gt.${time})`;
};

/**
 * Ejecuta la consulta de viajes publicados con los filtros de disponibilidad
 * (status activo, con lugares y cuya salida aún no ha pasado) y de
 * destino/fecha. El origen NO se filtra en SQL: lo resuelve geoSearchService
 * por coincidencia textual y por proximidad geográfica.
 */
const runSearchQuery = async (
  params: TripSearchParams,
  columns: string,
  departureMode: DepartureFilterMode = 'departure_at'
) => {
  let query = supabase
    .from('trips_with_driver')
    .select(columns)
    // Solo viajes publicados: excluye 'cancelled' y 'completed'.
    .eq('status', TRIP_STATUS.ACTIVE)
    // Solo viajes con lugares disponibles (requisito de búsqueda).
    .gt('seats_available', 0);

  // Solo viajes cuya fecha + hora de salida AÚN NO HA PASADO:
  //   hoy futuro, o cualquier día posterior a hoy.
  // Un viaje de ayer, o de hoy a una hora ya transcurrida, queda fuera.
  if (departureMode === 'departure_at') {
    query = query.gt('departure_at', new Date().toISOString());
  } else {
    query = query.or(buildLocalDepartureFilter(new Date()));
  }

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
 * Busca viajes publicados en Supabase, aplicando la regla de disponibilidad
 * de la etapa 1 del ciclo de vida:
 *   - status = 'active' (no cancelados ni completados),
 *   - seats_available > 0 (con lugares),
 *   - salida futura: date + hora aún no pasó (departure_at > now, o el
 *     filtro local equivalente si la migración aún no está aplicada).
 * Además aplica los filtros opcionales de destino y fecha, pero NO filtra
 * el origen a nivel SQL: el origen se resuelve en geoSearchService
 * (coincidencia textual + geográfica), de modo que también aparezcan viajes
 * cercanos o cuya ruta pasa cerca de la ubicación buscada aunque su texto
 * no coincida.
 * @param params Parámetros de búsqueda (destination, date opcionales)
 * @returns Filas de base de datos de viajes disponibles
 */
export const fetchTripsForSearch = async (
  params: TripSearchParams
): Promise<TripFromDB[]> => {
  try {
    // 1) Consulta ideal: filtra la salida con la columna generada departure_at.
    let response = await runSearchQuery(params, SEARCH_SELECT_COLUMNS);

    // 2) Si la consulta falla porque departure_at aún no existe en la vista
    //    (migración add_trip_lifecycle.sql pendiente), se repite con el
    //    filtro local de fecha/hora: mismo efecto (excluir salidas pasadas)
    //    sin depender de la columna nueva.
    if (
      response.error &&
      isMissingColumnError(response.error) &&
      /departure_at/.test(response.error.message ?? '')
    ) {
      if (!hasWarnedMissingDepartureColumn) {
        hasWarnedMissingDepartureColumn = true;
        console.warn(
          '[fetchTripsForSearch] No existe la columna departure_at (' +
            response.error.message +
            '). Se usará el filtro local de fecha/hora. Aplica ' +
            'supabase/migrations/add_trip_lifecycle.sql para filtrar en la BD.'
        );
      }

      response = await runSearchQuery(params, SEARCH_SELECT_COLUMNS, 'local');
    }

    // 3) La vista no expone las columnas geográficas: se repite la consulta con
    // '*' (válido para cualquier versión de la vista) y se completan las
    // coordenadas y route_geometry desde la tabla base `trips`.
    if (response.error && isMissingColumnError(response.error)) {
      if (!hasWarnedMissingGeoColumns) {
        hasWarnedMissingGeoColumns = true;
        console.warn(
          '[fetchTripsForSearch] La vista trips_with_driver no expone las columnas geográficas (' +
            response.error.message +
            '). Se consultará SELECT * + tabla trips. Aplica ' +
            'supabase/migrations/006_update_trips_with_driver_view.sql para evitarlo.'
        );
      }

      const fallback = await runSearchQuery(params, '*', 'local');

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
        // Viajes gratuitos: la columna price es NOT NULL sin DEFAULT, así que
        // se envía 0 para satisfacer la restricción sin migración destructiva
        // (recomendación opcional en el informe ETAPA 3).
        price: 0,
        notes: params.notes || null,
        status: TRIP_STATUS.ACTIVE,
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
 * ¿La salida del viaje (fecha `date` + hora `time`, AMBAS en hora local de
 * México) ya pasó respecto al reloj actual del dispositivo?
 *
 * Es la ÚNICA implementación de "viaje pasado" en el frontend: la usan
 * isTripOver (calificaciones), la defensa de la búsqueda y la creación de
 * solicitudes. El parseo es manual (sin Z ni UTC) para que los valores se
 * interpreten como hora local: en México (UTC-6) `new Date('YYYY-MM-DD')`
 * marcaría el día anterior, de ahí que se componga el Date componente a
 * componente (mismo criterio que utils/dateTime).
 *
 * @returns false si la fecha/hora no es interpretable (se asume no pasado
 *          para no ocultar viajes por datos corruptos; la BD garantiza
 *          DATE/TIME no nulos).
 */
export const isTripPast = (date: string, time: string): boolean => {
  const departure = parseTripDateTime(date, time);
  if (!departure) return false;
  return departure.getTime() < Date.now();
};

/**
 * ¿El viaje puede aparecer en los resultados de búsqueda? (defensa en
 * cliente). La misma regla ya aplica la consulta SQL de fetchTripsForSearch;
 * este filtro complementario evita mostrar salidas ya pasadas o viajes sin
 * lugares si la respuesta llegara sin esos filtros.
 * @param trip Viaje con fecha y hora de salida
 * @param seatsAvailable Lugares disponibles del viaje
 */
export const isTripAvailableForSearch = (
  trip: { date: string; time: string },
  seatsAvailable: number
): boolean => seatsAvailable > 0 && !isTripPast(trip.date, trip.time);

/**
 * Determina si un viaje ya terminó (y por tanto es calificable).
 * - completed -> sí.
 * - cancelled -> no.
 * - active (u otro estado no terminal) -> sí solo si su fecha/hora ya pasaron.
 */
export const isTripOver = (trip: {
  date: string;
  time: string;
  status?: string;
}): boolean => {
  if (trip.status === TRIP_STATUS.COMPLETED) return true;
  if (trip.status === TRIP_STATUS.CANCELLED) return false;

  return isTripPast(trip.date, trip.time);
};
/**
 * ============================================================
 * CICLO DE VIDA DEL VIAJE (etapa 2: confirmación de finalización)
 * ============================================================
 * Misma regla que aplica la base de datos (supabase/migrations/
 * add_trip_completion.sql) para que la interfaz no invente estados:
 *
 *   salida         = date + time (hora local de México)
 *   fin_programado = salida + (route_duration_minutes o 60 minutos)
 *   plazo_cierre   = fin_programado + 48 horas
 *
 *   scheduled          -> ahora < salida                  ("Publicado")
 *   in_progress        -> salida <= ahora < fin_programado ("En curso")
 *   pending_completion -> fin_programado <= ahora < plazo_cierre
 *                                                     ("Pendiente de finalizar")
 *   completed          -> acuerdo de todos los participantes o plazo vencido
 *
 * La BD es la que decide y persiste el estado (RPC confirm_trip_completion /
 * get_trip_completion_summary); estos helpers solo pintan el estado efectivo
 * en la interfaz, igual que isTripPast hace con la regla de la etapa 1.
 */

/** Duración asumida cuando el viaje no tiene duración de ruta (viajes antiguos). */
export const DEFAULT_TRIP_DURATION_MINUTES = 60;

/** Horas de cortesía tras el fin programado antes del cierre automático. */
export const TRIP_COMPLETION_GRACE_HOURS = 48;

/** Estados efectivos del ciclo de vida (no todos se guardan en trips.status). */
export type TripLifecycleStatus =
  | 'scheduled'
  | 'in_progress'
  | 'pending_completion'
  | 'completed'
  | 'cancelled';

/** Datos mínimos para calcular el ciclo de vida de un viaje. */
export interface TripLifecycleInput {
  date: string;
  time: string;
  /** Status almacenado en trips (gana si es 'cancelled' o 'completed'). */
  status?: string;
  /** Duración estimada de la ruta en minutos (route_duration_minutes). */
  durationMinutes?: number | null;
}

/**
 * Salida programada del viaje (date + time en hora local).
 * @returns null si la fecha/hora no es interpretable.
 */
export const getTripScheduledStart = (trip: {
  date: string;
  time: string;
}): Date | null => parseTripDateTime(trip.date, trip.time);

/**
 * Fin programado del viaje: salida + duración estimada de la ruta.
 * @returns null si la fecha/hora no es interpretable.
 */
export const getTripScheduledEnd = (trip: TripLifecycleInput): Date | null => {
  const start = getTripScheduledStart(trip);
  if (!start) return null;

  const durationMinutes =
    typeof trip.durationMinutes === 'number' && trip.durationMinutes > 0
      ? trip.durationMinutes
      : DEFAULT_TRIP_DURATION_MINUTES;

  return new Date(start.getTime() + durationMinutes * 60_000);
};

/**
 * Fecha límite del cierre automático de cortesía: fin programado + 48 h.
 * @returns null si el viaje no tiene fin programado interpretable.
 */
export const getTripCompletionDeadline = (trip: TripLifecycleInput): Date | null => {
  const end = getTripScheduledEnd(trip);
  if (!end) return null;
  return new Date(end.getTime() + TRIP_COMPLETION_GRACE_HOURS * 3_600_000);
};

/** Estado efectivo del viaje según su fecha, duración y status almacenado. */
export const getTripLifecycleStatus = (
  trip: TripLifecycleInput,
  now: Date = new Date()
): TripLifecycleStatus => {
  // Los estados terminales guardados en la BD mandan siempre.
  if (trip.status === TRIP_STATUS.CANCELLED) return 'cancelled';
  if (trip.status === TRIP_STATUS.COMPLETED) return 'completed';

  const start = getTripScheduledStart(trip);
  const end = getTripScheduledEnd(trip);
  if (!start || !end) return 'scheduled';

  if (now.getTime() < start.getTime()) return 'scheduled';
  if (now.getTime() < end.getTime()) return 'in_progress';

  const deadline = end.getTime() + TRIP_COMPLETION_GRACE_HOURS * 3_600_000;
  if (now.getTime() >= deadline) return 'completed';

  return 'pending_completion';
};

/** Etiqueta visible del estado del viaje. */
export const TRIP_LIFECYCLE_LABELS: Record<TripLifecycleStatus, string> = {
  scheduled: 'Publicado',
  in_progress: 'En curso',
  pending_completion: 'Pendiente de finalizar',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
};

/** Explicación corta del estado (para title/aria en la interfaz). */
export const TRIP_LIFECYCLE_DESCRIPTIONS: Record<TripLifecycleStatus, string> = {
  scheduled: 'El viaje está publicado y su salida aún no ocurre.',
  in_progress: 'La salida ya ocurrió y el viaje sigue en curso.',
  pending_completion:
    'El viaje ya terminó según su horario. Esperando las confirmaciones de los participantes.',
  completed:
    'El viaje se dio por finalizado: confirmaron todos los participantes o venció el plazo de 48 h.',
  cancelled: 'El viaje fue cancelado por el conductor.',
};

/** ¿El viaje admite ya la confirmación de finalización? */
export const canConfirmTripCompletion = (
  lifecycle: TripLifecycleStatus,
  alreadyConfirmed: boolean
): boolean => lifecycle === 'pending_completion' && !alreadyConfirmed;

/** ¿El viaje está en un estado terminal (no admite más acciones)? */
export const isTripLifecycleFinished = (lifecycle: TripLifecycleStatus): boolean =>
  lifecycle === 'completed' || lifecycle === 'cancelled';

/**
 * ¿El viaje sigue "próximo" (futuro, en curso o pendiente de finalizar)?
 * Complemento exacto de isTripLifecycleFinished: entre ambos se reparten TODOS
 * los estados del ciclo de vida, de modo que una tarjeta nunca aparece en las
 * dos listas ni desaparece de la interfaz (etapa 3: Próximos vs Historial).
 */
export const isTripLifecycleUpcoming = (lifecycle: TripLifecycleStatus): boolean =>
  !isTripLifecycleFinished(lifecycle);

/** Rol del usuario en el viaje (etiquetas usadas por Mis Viajes y el detalle). */
export const TRIP_ROLE_LABELS: Record<'driver' | 'passenger', string> = {
  driver: 'Como conductor',
  passenger: 'Como pasajero',
};

/**
 * ¿Este viaje terminado es calificable por el usuario?
 * Un viaje cancelado nunca se califica y el RPC submit_rating exige que el
 * viaje ya haya terminado, por lo que la interfaz solo ofrece el botón cuando
 * el estado efectivo es 'completed'.
 */
export const canRateFinishedTrip = (lifecycle: TripLifecycleStatus): boolean =>
  lifecycle === 'completed';
