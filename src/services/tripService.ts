import { supabase } from '../lib/supabase';

export interface TripSearchParams {
  origin?: string;
  destination?: string;
  date?: string;
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
 * Busca viajes en la base de datos de Supabase
 * @param params Parámetros de búsqueda (origin, destination, date)
 * @returns Array de viajes que coinciden con los criterios
 */
export const searchTrips = async (params: TripSearchParams): Promise<Trip[]> => {
  try {
    let query = supabase
      .from('trips_with_driver')
      .select('*')
      .eq('status', 'active');

    // Aplicar filtros si se proporcionan
    if (params.origin && params.origin.trim() !== '') {
      query = query.ilike('origin', `%${params.origin}%`);
    }

    if (params.destination && params.destination.trim() !== '') {
      query = query.ilike('destination', `%${params.destination}%`);
    }

    if (params.date && params.date.trim() !== '') {
      query = query.gte('date', params.date);
    }

    // Ordenar por fecha ascendente
    query = query.order('date', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('Error searching trips:', error);
      throw error;
    }

    // Mapear datos de la base de datos a la estructura del frontend
    const trips: Trip[] = (data || []).map((trip: TripFromDB) => ({
      id: trip.id,
      origin: trip.origin,
      destination: trip.destination,
      date: trip.date,
      time: trip.time,
      seatsAvailable: trip.seats_available,
      price: trip.price,
      driver: {
        name: trip.driver_name,
        rating: trip.driver_rating,
        university: trip.driver_university,
      },
    }));

    return trips;
  } catch (error) {
    console.error('Error in searchTrips:', error);
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

    const trip: Trip = {
      id: data.id,
      origin: data.origin,
      destination: data.destination,
      date: data.date,
      time: data.time,
      seatsAvailable: data.seats_available,
      price: data.price,
      driver: {
        name: data.driver_name,
        rating: data.driver_rating,
        university: data.driver_university,
      },
    };

    return trip;
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
