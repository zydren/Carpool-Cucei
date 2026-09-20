import { supabase } from '../lib/supabase';

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
  date: string;
  time: string;
  seatsAvailable: number;
  price: number;
  driver: {
    name: string;
    rating: number;
    university: string;
  };
}

/**
 * Tipo de coincidencia entre la búsqueda del pasajero y un viaje.
 * - 'textual': el texto del origen del viaje contiene el texto buscado.
 * - 'origin':  el origen del viaje está dentro del radio de búsqueda.
 */
export type TripMatchType = 'textual' | 'origin';

/** Viaje de resultados enriquecido con la información de la búsqueda. */
export interface TripSearchResult extends Trip {
  matchType: TripMatchType;
  /**
   * Distancia en km entre el punto de búsqueda y el origen del viaje.
   * null si el viaje no tiene coordenadas o no había punto de búsqueda.
   */
  distanceToOriginKm: number | null;
}

export interface CreateTripParams {
  origin: string;
  destination: string;
  origin_lat: number;
  origin_lng: number;
  route_distance_km: number;
  route_duration_minutes: number;
  date: string;
  time: string;
  seats_available: number;
  price: number;
  notes?: string;
}

/**
 * Convierte una fila de base de datos (vista trips_with_driver) en el tipo Trip
 * que consume la interfaz.
 */
export const mapTripFromDBToTrip = (trip: TripFromDB): Trip => ({
  id: trip.id,
  origin: trip.origin,
  destination: trip.destination,
  originLat: trip.origin_lat,
  originLng: trip.origin_lng,
  date: trip.date,
  time: trip.time,
  seatsAvailable: trip.seats_available,
  price: trip.price,
  driver: {
    name: trip.driver_name,
    rating: trip.driver_rating,
    university: trip.driver_university,
  },
});

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
    let query = supabase
      .from('trips_with_driver')
      .select('*')
      .eq('status', 'active');

    if (params.destination && params.destination.trim() !== '') {
      query = query.ilike('destination', `%${params.destination}%`);
    }

    if (params.date && params.date.trim() !== '') {
      query = query.gte('date', params.date);
    }

    // Orden por fecha ascendente (la relevancia final la decide geoSearchService)
    query = query.order('date', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('Error searching trips:', error);
      throw error;
    }

    return (data || []) as TripFromDB[];
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
