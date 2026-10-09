import { supabase } from '../lib/supabase';
import { isTripPast } from './tripService';

export type TripRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface TripRequest {
  id: string;
  trip_id: string;
  passenger_id: string;
  status: TripRequestStatus;
  message: string | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTripRequestParams {
  tripId: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  message?: string;
}

/** Solicitud con datos del viaje y del pasajero (vista trip_requests_details) */
export interface TripRequestDetails {
  id: string;
  trip_id: string;
  passenger_id: string;
  status: TripRequestStatus;
  message: string | null;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  created_at: string;
  updated_at: string;
  driver_id: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  trip_seats_available: number;
  passenger_name: string;
  passenger_email: string | null;
  passenger_rating: number;
  passenger_university: string;
}

/** Viaje solicitado por el usuario como pasajero (vista trip_requests_details) */
export interface MyRequestedTrip {
  id: string; // id de la solicitud
  trip_id: string;
  driver_id: string;
  driver_name: string;
  driver_rating: number;
  status: TripRequestStatus;
  pickup_address: string | null;
  origin: string;
  destination: string;
  date: string;
  time: string;
  trip_seats_available: number;
  /**
   * Status del viaje (trips.status): puede ser 'active',
   * 'pending_completion' o 'completed'. Se completa en getMyRequestedTrips
   * consultando la tabla trips, porque la vista no lo expone.
   */
  trip_status: string;
  /** Duración estimada de la ruta del viaje (para el fin programado). */
  trip_route_duration_minutes: number | null;
}

const NOT_AUTHENTICATED_MESSAGE =
  'Debes iniciar sesión para solicitar un lugar en un viaje.';

/**
 * Obtiene el id del usuario autenticado o lanza un error amigable.
 */
const getAuthenticatedUserId = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new Error(NOT_AUTHENTICATED_MESSAGE);
  }

  return data.user.id;
};

/**
 * TEMPORAL (diagnóstico): imprime el error COMPLETO de Supabase
 * (code/message/details/hint/status) antes de mapearlo a un texto amigable.
 * NO oculta el error real durante el diagnóstico.
 * TODO: eliminar cuando finalice el diagnóstico.
 */
interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
}

const logSupabaseError = (operation: string, error: unknown): void => {
  const e = (typeof error === 'object' && error !== null ? error : {}) as SupabaseErrorLike;

  console.error(
    `[SUPABASE][${operation}] error completo:`,
    JSON.stringify(
      {
        code: e.code ?? null,
        message: e.message ?? null,
        details: e.details ?? null,
        hint: e.hint ?? null,
        status: e.status ?? null,
      },
      null,
      2
    )
  );
  console.error(`[SUPABASE][${operation}] error crudo:`, error);
};

/**
 * Mapea mensajes de error de la base de datos (raise/constraints) a un texto amigable.
 */
const mapDatabaseError = (
  error: { message?: string; code?: string; details?: string } | null,
  operation = 'trip_requests'
): string => {
  if (error) {
    logSupabaseError(operation, error);
  }

  if (!error) {
    return 'No se pudo completar la operación. Intenta nuevamente.';
  }

  const message = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();

  if (message.includes('propio viaje')) {
    return 'No puedes solicitar tu propio viaje.';
  }

  if (message.includes('asientos')) {
    return 'Este viaje ya no tiene asientos disponibles.';
  }

  if (message.includes('ya no está activo')) {
    return 'Este viaje ya no está activo.';
  }

  if (message.includes('ya no está pendiente')) {
    return 'La solicitud ya fue procesada.';
  }

  if (message.includes('la solicitud no existe')) {
    return 'La solicitud no existe o ya no está disponible.';
  }

  if (
    message.includes('duplicate') ||
    message.includes('trip_requests_trip_id_passenger_id_key')
  ) {
    return 'Ya tienes una solicitud para este viaje.';
  }

  return 'No se pudo completar la operación. Intenta nuevamente.';
};

/**
 * Crea una solicitud real en trip_requests.
 *
 * Verifica (en este orden):
 * 1. Sesión de Supabase Auth.
 * 2. Que el viaje exista, esté activo y su salida aún no haya pasado.
 * 3. Que el solicitante no sea el conductor del viaje.
 * 4. Que el viaje tenga asientos disponibles.
 * 5. Que no exista una solicitud previa del pasajero para ese viaje.
 *
 * La integridad también está garantizada en la base de datos:
 * - Constraint UNIQUE(trip_id, passenger_id) -> sin duplicados.
 * - Trigger prevent_invalid_trip_request -> sin viaje propio / inactivo / sin asientos.
 */
export const createTripRequest = async (
  params: CreateTripRequestParams
): Promise<TripRequest> => {
  const passengerId = await getAuthenticatedUserId();

  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id, driver_id, status, seats_available, date, time')
    .eq('id', params.tripId)
    .single();

  if (tripError || !trip) {
    throw new Error('El viaje no existe o ya no está disponible.');
  }

  if (trip.driver_id === passengerId) {
    throw new Error('No puedes solicitar tu propio viaje.');
  }

  if (trip.status !== 'active') {
    throw new Error('Este viaje ya no está activo.');
  }

  if (isTripPast(trip.date, trip.time)) {
    throw new Error('Este viaje ya salió y ya no acepta solicitudes.');
  }

  if (trip.seats_available <= 0) {
    throw new Error('Este viaje ya no tiene asientos disponibles.');
  }

  // Una solicitud existente que siga vigente (pendiente/aceptada) bloquea el reenvío.
  const { data: existing, error: existingError } = await supabase
    .from('trip_requests')
    .select('id, status')
    .eq('trip_id', params.tripId)
    .eq('passenger_id', passengerId)
    .maybeSingle();

  if (existingError) {
    console.error('Error checking existing trip request:', existingError);
  }

  if (existing) {
    if (existing.status === 'pending') {
      throw new Error('Ya tienes una solicitud pendiente para este viaje.');
    }
    if (existing.status === 'accepted') {
      throw new Error('Ya tienes un lugar aceptado en este viaje.');
    }
    throw new Error('Ya tienes una solicitud registrada para este viaje.');
  }
const { data, error } = await supabase
    .from('trip_requests')
    .insert({
      trip_id: params.tripId,
      passenger_id: passengerId,
      status: 'pending',
      pickup_address: params.pickupAddress,
      pickup_lat: params.pickupLat,
      pickup_lng: params.pickupLng,
      message: params.message || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating trip request:', error);
    throw new Error(mapDatabaseError(error, 'createTripRequest.insert'));
  }

  return data as TripRequest;
};

/**
 * Obtiene las solicitudes del usuario autenticado como pasajero.
 */
export const getMyTripRequests = async (): Promise<TripRequest[]> => {
  const passengerId = await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from('trip_requests')
    .select('*')
    .eq('passenger_id', passengerId)
    .order('created_at', { ascending: false });

  if (error) {
    logSupabaseError('getMyTripRequests.select', error);
    console.error('Error getting my trip requests:', error);
    throw new Error('No se pudieron cargar tus solicitudes.');
  }

  return (data || []) as TripRequest[];
};

/**
 * Obtiene los viajes que el usuario autenticado solicitó como pasajero,
 * con los datos del viaje (usando la vista trip_requests_details).
 */
export const getMyRequestedTrips = async (): Promise<MyRequestedTrip[]> => {
  const passengerId = await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from('trip_requests_details')
    .select(
      'id, trip_id, driver_id, driver_name, driver_rating, status, pickup_address, origin, destination, date, time, trip_seats_available'
    )
    .eq('passenger_id', passengerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error getting my requested trips:', error);
    throw error;
  }

  const requestedTrips = (data || []) as MyRequestedTrip[];

  // Etapa 2 del ciclo de vida: la vista trip_requests_details no expone
  // trips.status, así que el estado y la duración del viaje se completan con
  // una consulta a trips. La política RLS de add_trip_completion permite a un
  // pasajero 'accepted' leer su viaje en cualquier estado; si esa migración
  // aún no está aplicada se usa 'active' como respaldo para no romper la vista.
  const tripIds = [...new Set(requestedTrips.map((request) => request.trip_id))];
  const tripMetaById = new Map<string, { status: string; durationMinutes: number | null }>();

  if (tripIds.length > 0) {
    const { data: tripsData, error: tripsError } = await supabase
      .from('trips')
      .select('id, status, route_duration_minutes')
      .in('id', tripIds);

    if (tripsError) {
      console.warn(
        'No se pudo leer el estado de los viajes solicitados (se asume activo):',
        tripsError.message
      );
    } else {
      for (const row of (tripsData ?? []) as {
        id: string;
        status: string;
        route_duration_minutes: number | null;
      }[]) {
        tripMetaById.set(row.id, {
          status: row.status,
          durationMinutes: row.route_duration_minutes,
        });
      }
    }
  }

  return requestedTrips.map((request) => {
    const meta = tripMetaById.get(request.trip_id);
    return {
      ...request,
      trip_status: meta?.status ?? 'active',
      trip_route_duration_minutes: meta?.durationMinutes ?? null,
    };
  });
};

/**
 * Obtiene las solicitudes recibidas por el usuario autenticado como conductor.
 * Utiliza la vista trip_requests_details (filtrada por driver_id).
 */
export const getTripRequestsForDriver = async (): Promise<TripRequestDetails[]> => {
  const driverId = await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from('trip_requests_details')
    .select('*')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: true });

  if (error) {
    logSupabaseError('getTripRequestsForDriver.select', error);
    console.error('Error getting trip requests for driver:', error);
    throw new Error('No se pudieron cargar las solicitudes de tus viajes.');
  }

  return (data || []) as TripRequestDetails[];
};

/**
 * Acepta una solicitud (RPC). La función de la base de datos:
 * - Verifica que el llamador sea el conductor del viaje.
 * - Verifica que la solicitud esté pendiente.
 * - Decrementa seats_available de forma atómica (nunca por debajo de 0).
 */
export const acceptTripRequest = async (tripRequestId: string): Promise<void> => {
  const { error } = await supabase.rpc('accept_trip_request', {
    p_request_id: tripRequestId,
  });

  if (error) {
    console.error('Error accepting trip request:', error);
    throw new Error(mapDatabaseError(error, 'acceptTripRequest.rpc'));
  }
};

/**
 * Rechaza una solicitud (RPC). No modifica seats_available.
 */
export const rejectTripRequest = async (tripRequestId: string): Promise<void> => {
  const { error } = await supabase.rpc('reject_trip_request', {
    p_request_id: tripRequestId,
  });

  if (error) {
    console.error('Error rejecting trip request:', error);
    throw new Error(mapDatabaseError(error, 'rejectTripRequest.rpc'));
  }
};

/**
 * Cancela una solicitud pendiente propia (RPC).
 */
export const cancelTripRequest = async (tripRequestId: string): Promise<void> => {
  const { error } = await supabase.rpc('cancel_trip_request', {
    p_request_id: tripRequestId,
  });

  if (error) {
    console.error('Error cancelling trip request:', error);
    throw new Error(mapDatabaseError(error, 'cancelTripRequest.rpc'));
  }
};

/**
 * Etiquetas para mostrar el estado de una solicitud en la interfaz.
 */
export const tripRequestStatusLabel: Record<TripRequestStatus, string> = {
  pending: 'Solicitud pendiente',
  accepted: 'Solicitud aceptada',
  rejected: 'Solicitud rechazada',
  cancelled: 'Solicitud cancelada',
};