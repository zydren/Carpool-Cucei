import { supabase } from '../lib/supabase';
import type { TripLifecycleStatus } from './tripService';

/**
 * Servicio de la ETAPA 2 del ciclo de vida: confirmación de finalización.
 *
 * Toda la validación vive en la base de datos
 * (supabase/migrations/add_trip_completion.sql):
 *   - RLS: solo los participantes (conductor o pasajero 'accepted') ven las
 *     confirmaciones de sus viajes.
 *   - Sin INSERT/UPDATE/DELETE para la API: la única vía de escritura es el
 *     RPC SECURITY DEFINER confirm_trip_completion(), que comprueba sesión,
 *     participación, que el viaje ya terminó y que no se confirme dos veces.
 *
 * Este servicio NO decide si un viaje terminó: consulta y delega.
 */

/** Resumen de finalización devuelto por el RPC get_trip_completion_summary. */
export interface TripCompletionSummary {
  /** Status almacenado en trips ('active', 'pending_completion', ...). */
  raw_status: string;
  /** Estado efectivo del ciclo de vida (incluye el cierre de cortesía). */
  effective_status: TripLifecycleStatus;
  /** Fin programado del viaje (ISO). */
  scheduled_end: string;
  /** Fecha límite del cierre automático de 48 h (ISO). */
  completion_deadline: string;
  confirmations_count: number;
  /** Participantes con voto: conductor + pasajeros aceptados. */
  expected_count: number;
  confirmed_by_me: boolean;
  confirmed_at_by_me: string | null;
  /** Si el usuario puede confirmar AHORA (participante y viaje terminado). */
  can_confirm: boolean;
  my_role: 'driver' | 'passenger';
}

/** Fila de la tabla trip_completion_confirmations. */
export interface TripCompletionConfirmation {
  id: string;
  trip_id: string;
  user_id: string;
  confirmed_at: string;
}

/** Mensaje de "migración pendiente": no se muestra como error al usuario. */
export const TRIP_COMPLETION_NOT_READY_MESSAGE =
  'La confirmación de finalización todavía no está disponible.';

const logSupabaseError = (operation: string, error: unknown): void => {
  console.error(`[SUPABASE][${operation}]`, error);
};

const isMissingRelationError = (error: { message?: string; code?: string } | null): boolean => {
  const message = (error?.message ?? '').toLowerCase();
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the function') ||
    message.includes('schema cache')
  );
};

/** Traduce los errores de la BD (RAISE EXCEPTION) a mensajes para el usuario. */
export const mapTripCompletionError = (
  error: { message?: string; details?: string } | null
): string => {
  if (error) {
    logSupabaseError('tripCompletion.rpc', error);
  }

  if (isMissingRelationError(error)) {
    return TRIP_COMPLETION_NOT_READY_MESSAGE;
  }

  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();

  if (message.includes('iniciar sesión')) {
    return 'Debes iniciar sesión para confirmar la finalización del viaje.';
  }
  if (message.includes('no existe')) {
    return 'El viaje no existe o ya no está disponible.';
  }
  if (message.includes('cancelado')) {
    return 'Este viaje fue cancelado: no requiere confirmación de finalización.';
  }
  if (message.includes('ya está finalizado')) {
    return 'Este viaje ya está finalizado.';
  }
  if (message.includes('no participaste')) {
    return 'Solo los participantes del viaje pueden confirmar su finalización.';
  }
  if (message.includes('aún no ha terminado')) {
    return 'El viaje aún no ha terminado según su horario. Podrás confirmarlo cuando llegue su hora de fin.';
  }
  if (message.includes('ya confirmaste')) {
    return 'Ya confirmaste que este viaje terminó.';
  }
  return 'No se pudo registrar la confirmación. Intenta nuevamente.';
};

/** ID del usuario autenticado o error legible. */
const getAuthenticatedUserId = async (): Promise<string> => {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Debes iniciar sesión para continuar.');
  }

  return user.id;
};

/**
 * Confirmaciones emitidas por el usuario autenticado, indexadas por viaje.
 * Sirve para mostrar "Ya confirmaste" y para no repetir el botón.
 * Si la migración aún no está aplicada devuelve un objeto vacío (la interfaz
 * sigue siendo utilizable sin la etapa 2).
 */
export const getMyTripCompletionConfirmations = async (): Promise<
  Record<string, string>
> => {
  const userId = await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from('trip_completion_confirmations')
    .select('trip_id, confirmed_at')
    .eq('user_id', userId);

  if (error) {
    logSupabaseError('getMyTripCompletionConfirmations', error);
    if (isMissingRelationError(error)) {
      return {};
    }
    throw new Error('No se pudieron cargar tus confirmaciones de finalización.');
  }

  const byTrip: Record<string, string> = {};
  for (const row of (data ?? []) as { trip_id: string; confirmed_at: string }[]) {
    byTrip[row.trip_id] = row.confirmed_at;
  }
  return byTrip;
};

/**
 * Cierre automático de cortesía de los viajes del usuario (48 h vencidas).
 * Devuelve cuántos viajes se finalizaron. Es el "reaper" perezoso: no hay
 * cron; la BD se pone al día cuando el usuario abre Mis Viajes.
 */
export const reapMyTripCompletions = async (): Promise<number> => {
  const { data, error } = await supabase.rpc('reap_my_trip_completions');

  if (error) {
    logSupabaseError('reapMyTripCompletions', error);
    return 0;
  }

  return typeof data === 'number' ? data : 0;
};

/**
 * Resumen de finalización de un viaje (estado efectivo, confirmaciones y si
 * el usuario puede confirmar). Solo para participantes: la BD rechaza al resto.
 * Devuelve null si la migración todavía no está aplicada.
 */
export const getTripCompletionSummary = async (
  tripId: string
): Promise<TripCompletionSummary | null> => {
  const { data, error } = await supabase.rpc('get_trip_completion_summary', {
    p_trip_id: tripId,
  });

  if (error) {
    if (isMissingRelationError(error)) {
      logSupabaseError('getTripCompletionSummary', error);
      return null;
    }
    throw new Error(mapTripCompletionError(error));
  }

  const rows = (data ?? []) as TripCompletionSummary[];
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Confirma que el viaje terminó y devuelve el estado efectivo resultante
 * ('pending_completion' si aún faltan participantes, 'completed' si con esta
 * confirmación se cerró el viaje).
 */
export const confirmTripCompletion = async (
  tripId: string
): Promise<TripLifecycleStatus> => {
  const { data, error } = await supabase.rpc('confirm_trip_completion', {
    p_trip_id: tripId,
  });

  if (error) {
    throw new Error(mapTripCompletionError(error));
  }

  return (data ?? 'pending_completion') as TripLifecycleStatus;
};
