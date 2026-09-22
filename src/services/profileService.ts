import { supabase } from '../lib/supabase';
import type { Rating } from './ratingService';
import type { Car } from './carService';

/** Fila completa de profiles (solo el propio usuario la ve con email/phone). */
export interface FullProfile {
  id: string;
  full_name: string;
  email: string;
  university: string;
  phone: string;
  rating: number;
  total_ratings: number;
  created_at: string;
  updated_at: string;
}

/** Perfil publico: subconjunto sin datos sensibles (vista public_profiles). */
export interface PublicProfile {
  id: string;
  full_name: string;
  university: string;
  rating: number;
  total_ratings: number;
  created_at: string;
}

/** Auto con solo campos publicos (RPC get_user_public_car). */
export interface PublicCar {
  brand: string;
  model: string;
  year: number;
  color: string;
  seats: number;
}

export interface UserTripStats {
  offeredTrips: number;
  passengerTrips: number;
}

/** Calificacion recibida enriquecida (RPC get_user_received_ratings). */
export interface ReceivedRating extends Rating {
  rater_name: string | null;
  trip_origin: string | null;
  trip_destination: string | null;
  trip_driver_id: string | null;
}

export interface UpdateProfileParams {
  fullName: string;
  phone: string;
  university?: string;
}

const NOT_AUTHENTICATED_MESSAGE = 'Debes iniciar sesión para ver tu perfil.';
const LOAD_ERROR_MESSAGE = 'No se pudo cargar el perfil.';
const USER_NOT_FOUND_MESSAGE = 'Usuario no encontrado.';

const getAuthenticatedUserId = async (): Promise<string> => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error(NOT_AUTHENTICATED_MESSAGE);
  return data.user.id;
};

/**
 * Perfil completo del usuario autenticado (incluye email/phone).
 * RLS: solo la propia fila (politicas etapa2 aditivas).
 */
export const getMyProfile = async (): Promise<FullProfile> => {
  const userId = await getAuthenticatedUserId();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error || !data) {
    console.error('Error getting my profile:', error);
    throw new Error(LOAD_ERROR_MESSAGE);
  }
  return data as FullProfile;
};

/**
 * Perfil publico de otro usuario (vista public_profiles, sin email/phone).
 * Lanza 'Usuario no encontrado' si el id no existe.
 */
export const getPublicProfile = async (userId: string): Promise<PublicProfile> => {
  const { data, error } = await supabase
    .from('public_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error || !data) {
    console.error('Error getting public profile:', error);
    throw new Error(USER_NOT_FOUND_MESSAGE);
  }
  return data as PublicProfile;
};

/**
 * Actualiza solo full_name/phone (+university opcional) del propio usuario.
 * Nunca id/rating/total_ratings/estadisticas (el UPDATE solo envia esas columnas).
 */
export const updateMyProfile = async (params: UpdateProfileParams): Promise<FullProfile> => {
  const userId = await getAuthenticatedUserId();
  const fullName = params.fullName.trim();
  const phone = params.phone.replace(/\s/g, '');
  if (!fullName) throw new Error('El nombre completo es requerido.');
  if (!/^\d{10}$/.test(phone)) throw new Error('El teléfono debe tener 10 dígitos (ej: 3312345678).');
  const payload: { full_name: string; phone: string; university?: string } = {
    full_name: fullName,
    phone,
  };
  if (params.university !== undefined) payload.university = params.university;
  const { data, error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', userId)
    .select()
    .single();
  if (error || !data) {
    console.error('Error updating profile:', error);
    throw new Error('No se pudo actualizar tu perfil. Intenta nuevamente.');
  }
  return data as FullProfile;
};

/** Resumen de rating desde profiles (valor real del sistema existente). */
export const getUserRatingSummary = async (
  userId: string
): Promise<{ rating: number; totalRatings: number }> => {
  const profile = await getPublicProfile(userId);
  return { rating: profile.rating ?? 0, totalRatings: profile.total_ratings ?? 0 };
};

export const getUserTripStats = async (userId: string): Promise<UserTripStats> => {
  const { data, error } = await supabase.rpc('get_user_trip_stats', { p_user_id: userId });
  if (error) {
    console.error('Error getting user trip stats:', error);
    throw new Error('No se pudieron cargar las estadísticas de viajes.');
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    offered_trips: number | string;
    passenger_trips: number | string;
  } | null;
  return {
    offeredTrips: Number(row?.offered_trips ?? 0),
    passengerTrips: Number(row?.passenger_trips ?? 0),
  };
};

/** Auto publico mas reciente (o null si no tiene). */
export const getUserPublicCar = async (userId: string): Promise<PublicCar | null> => {
  const { data, error } = await supabase.rpc('get_user_public_car', { p_user_id: userId });
  if (error) {
    console.error('Error getting user public car:', error);
    throw new Error('No se pudo cargar el automóvil.');
  }
  const row = (Array.isArray(data) ? data[0] : data) as PublicCar | null;
  return row ?? null;
};

/** Ultimas calificaciones RECIBIDAS (reutiliza tabla ratings, sin duplicar sistema). */
export const getUserRatings = async (userId: string, limit = 20): Promise<ReceivedRating[]> => {
  const { data, error } = await supabase.rpc('get_user_received_ratings', {
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) {
    console.error('Error getting user ratings:', error);
    throw new Error('No se pudieron cargar las calificaciones.');
  }
  return ((Array.isArray(data) ? data : []) as ReceivedRating[]);
};

/** Autos propios completos (reexporta carService para no duplicar logica). */
export { getMyCars } from './carService';
export type { Car };
