import { supabase } from '../lib/supabase';

export interface Rating {
  id: string;
  trip_id: string;
  rater_id: string;
  rated_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface SubmitRatingParams {
  tripId: string;
  ratedId: string;
  rating: number;
  comment?: string;
}

const logSupabaseError = (operation: string, error: unknown): void => {
  console.error(`[SUPABASE][${operation}]`, error);
};

/**
 * Mapea los errores de la base de datos (RAISE EXCEPTION / constraints)
 * a mensajes amigables para el usuario.
 */
const mapRatingError = (
  error: { message?: string; details?: string } | null
): string => {
  if (error) {
    logSupabaseError('submitRating.rpc', error);
  }

  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();

  if (message.includes('entre 1 y 5')) {
    return 'La calificación debe estar entre 1 y 5 estrellas.';
  }
  if (message.includes('comentario')) {
    return 'El comentario es demasiado largo (máximo 1000 caracteres).';
  }
  if (message.includes('calificarte a ti mismo')) {
    return 'No puedes calificarte a ti mismo.';
  }
  if (message.includes('cancelado')) {
    return 'Este viaje fue cancelado y no se puede calificar.';
  }
  if (message.includes('aún no ha terminado')) {
    return 'Aún no puedes calificar: el viaje no ha terminado.';
  }
  if (message.includes('no participaste')) {
    return 'No participaste en este viaje.';
  }
  if (message.includes('pasajeros aceptados') || message.includes('conductor de este viaje')) {
    return 'Solo puedes calificar a personas que participaron en el viaje.';
  }
  if (message.includes('ya calificaste')) {
    return 'Ya calificaste a esta persona en este viaje.';
  }
  if (message.includes('viaje no existe')) {
    return 'El viaje no existe o ya no está disponible.';
  }
  return 'No se pudo guardar la calificación. Intenta nuevamente.';
};

/**
 * Emite una calificación real.
 * La validación de integridad vive en la base de datos (RPC submit_rating):
 * viaje existente, viaje terminado, participación real, sin duplicados.
 */
export const submitRating = async (params: SubmitRatingParams): Promise<void> => {
  const { error } = await supabase.rpc('submit_rating', {
    p_trip_id: params.tripId,
    p_rated_id: params.ratedId,
    p_rating: params.rating,
    p_comment: params.comment?.trim() ? params.comment.trim() : null,
  });

  if (error) {
    throw new Error(mapRatingError(error));
  }
};

/** Calificaciones de un viaje concreto (RLS permite lectura pública). */
export const getTripRatings = async (tripId: string): Promise<Rating[]> => {
  const { data, error } = await supabase
    .from('ratings')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error getting trip ratings:', error);
    throw new Error('No se pudieron cargar las calificaciones.');
  }

  return (data || []) as Rating[];
};

/** Calificaciones emitidas por el usuario autenticado. */
export const getMyRatings = async (): Promise<Rating[]> => {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Debes iniciar sesión para ver tus calificaciones.');
  }

  const { data, error } = await supabase
    .from('ratings')
    .select('*')
    .eq('rater_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error getting my ratings:', error);
    throw new Error('No se pudieron cargar tus calificaciones.');
  }

  return (data || []) as Rating[];
};