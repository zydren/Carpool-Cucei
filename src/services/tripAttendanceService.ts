import { supabase } from '../lib/supabase';
import { parseTripDateTime } from '../utils/dateTime';

/**
 * Servicio de la ETAPA de confirmación de asistencia (20 minutos antes).
 *
 * Toda la validación vive en la base de datos
 * (supabase/migrations/add_trip_attendance_confirmations.sql):
 *   - El proceso programado del servidor (pg_cron, con respaldo perezoso)
 *     crea una fila 'pending' por participante y UNA notificación
 *     'attendance_request' en public.notifications.
 *   - La respuesta se escribe SOLO por el RPC respond_trip_attendance():
 *     la tabla no tiene INSERT/UPDATE/DELETE para la API y cada persona ve
 *     únicamente su propia fila (RLS user_id = auth.uid()).
 *
 * Este servicio no decide ventanas ni permisos: consulta y delega. Lo único
 * que calcula en cliente son los minutos que faltan para la salida, para
 * mostrar (o no) la tarjeta de confirmación.
 *
 * NO hay seguimiento GPS ni permisos de geolocalización en esta etapa.
 */

/** Respuesta posible de un participante. */
export type TripAttendanceResponse = 'pending' | 'confirmed' | 'declined';

/** Rol del usuario en el viaje (lo calcula la base de datos). */
export type TripAttendanceRole = 'driver' | 'passenger';

/** Minutos antes de la salida en los que se abre la confirmación. */
export const TRIP_ATTENDANCE_LEAD_MINUTES = 20;

/** Mensaje de "migración pendiente": no se muestra como error al usuario. */
export const TRIP_ATTENDANCE_NOT_READY_MESSAGE =
  'La confirmación de asistencia todavía no está disponible.';

/** Etiquetas del estado de MI confirmación. */
export const TRIP_ATTENDANCE_STATUS_LABELS: Record<TripAttendanceResponse, string> = {
  pending: 'Pendiente de responder',
  confirmed: 'Asistencia confirmada',
  declined: 'No asistirás',
};

/** Explicación corta de cada estado (para title/aria). */
export const TRIP_ATTENDANCE_STATUS_DESCRIPTIONS: Record<
  TripAttendanceResponse,
  string
> = {
  pending: 'Todavía no respondiste si asistirás a este viaje.',
  confirmed: 'Confirmaste que asistirás a este viaje.',
  declined: 'Informaste que no podrás asistir a este viaje.',
};

/** Fila devuelta por el RPC get_my_trip_attendance_requests(). */
export interface TripAttendanceRow {
  trip_id: string;
  response: TripAttendanceResponse;
  requested_at: string | null;
  responded_at: string | null;
  /** Salida del viaje como instante absoluto (America/Mexico_City). */
  departure_at: string | null;
  origin: string;
  destination: string;
  /** Fecha del viaje en formato 'YYYY-MM-DD'. */
  trip_date: string;
  /** Hora del viaje en formato 'HH:MM' o 'HH:MM:SS'. */
  trip_time: string;
  trip_status: string;
  my_role: TripAttendanceRole;
}

/** Confirmaciones propias indexadas por viaje. */
export type TripAttendanceByTrip = Record<string, TripAttendanceRow>;

const logSupabaseError = (operation: string, error: unknown): void => {
  console.error(`[SUPABASE][${operation}]`, error);
};

/** ¿El error indica que la migración todavía no está aplicada? */
const isMissingRelationError = (
  error: { message?: string; code?: string } | null
): boolean => {
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

/**
 * Minutos que faltan para la salida del viaje (negativo si ya salió).
 * Usa el MISMO parseo local que el resto del proyecto (utils/dateTime):
 * `date` y `time` son la hora local de México, sin zona horaria.
 * @returns null si la fecha/hora no es interpretable.
 */
export const minutesUntilDeparture = (
  date: string,
  time: string,
  now: Date = new Date()
): number | null => {
  const departure = parseTripDateTime(date, time);
  if (!departure) return null;
  return (departure.getTime() - now.getTime()) / 60_000;
};

/**
 * ¿La ventana de confirmación está abierta AHORA?
 * Es decir: la salida aún NO ocurrió y faltan 20 minutos o menos. Es la MISMA
 * regla que aplica la base de datos (el RPC rechaza la respuesta en cuanto
 * NOW() >= hora de salida), así que el cliente nunca ofrece un botón que el
 * servidor vaya a rechazar.
 *
 * Es la condición con la que la interfaz muestra la tarjeta de confirmación;
 * la autoridad real es la fila creada por el proceso del servidor.
 */
export const hasAttendanceWindowOpened = (
  date: string,
  time: string,
  now: Date = new Date()
): boolean => {
  const minutes = minutesUntilDeparture(date, time, now);
  return minutes !== null && minutes > 0 && minutes <= TRIP_ATTENDANCE_LEAD_MINUTES;
};

/**
 * Despachador perezoso: pide a la base de datos que genere las solicitudes
 * (y notificaciones) de mis viajes que ya entraron en la ventana de 20
 * minutos. Es idempotente: llamarlo varias veces no duplica nada.
 * Devuelve 0 si la migración no está aplicada (la app sigue funcionando).
 */
export const ensureMyTripAttendanceRequests = async (): Promise<number> => {
  const { data, error } = await supabase.rpc('ensure_my_trip_attendance_requests');

  if (error) {
    logSupabaseError('ensureMyTripAttendanceRequests', error);
    return 0;
  }

  return typeof data === 'number' ? data : 0;
};

/**
 * Mis solicitudes de asistencia indexadas por viaje (una sola fila propia
 * por viaje). La respuesta viene persistida desde Supabase, así que se
 * conserva al recargar la página.
 */
export const getMyTripAttendanceRequests = async (): Promise<TripAttendanceByTrip> => {
  const { data, error } = await supabase.rpc('get_my_trip_attendance_requests');

  if (error) {
    logSupabaseError('getMyTripAttendanceRequests', error);
    if (isMissingRelationError(error)) {
      return {};
    }
    throw new Error('No se pudieron cargar tus confirmaciones de asistencia.');
  }

  const byTrip: TripAttendanceByTrip = {};
  for (const row of (data ?? []) as TripAttendanceRow[]) {
    if (row?.trip_id) {
      byTrip[row.trip_id] = row;
    }
  }
  return byTrip;
};

/**
 * Registra mi respuesta ('confirmed' | 'declined') y devuelve la respuesta
 * guardada. La base de datos valida sesión, participación, que el viaje no
 * esté cancelado/finalizado y que aún no haya salido.
 */
export const respondTripAttendance = async (
  tripId: string,
  response: Exclude<TripAttendanceResponse, 'pending'>
): Promise<TripAttendanceResponse> => {
  const { data, error } = await supabase.rpc('respond_trip_attendance', {
    p_trip_id: tripId,
    p_response: response,
  });

  if (error) {
    throw new Error(mapTripAttendanceError(error));
  }

  return (data ?? response) as TripAttendanceResponse;
};

/** Traduce los errores de la base de datos a mensajes en español. */
export const mapTripAttendanceError = (
  error: { message?: string; details?: string; code?: string } | null
): string => {
  if (error) {
    logSupabaseError('tripAttendance.rpc', error);
  }

  if (isMissingRelationError(error)) {
    return TRIP_ATTENDANCE_NOT_READY_MESSAGE;
  }

  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();

  if (message.includes('iniciar sesión')) {
    return 'Debes iniciar sesión para confirmar tu asistencia.';
  }
  if (message.includes('no existe')) {
    return 'El viaje no existe o ya no está disponible.';
  }
  if (message.includes('cancelado')) {
    return 'Este viaje fue cancelado: ya no requiere confirmación de asistencia.';
  }
  if (message.includes('ya está finalizado')) {
    return 'Este viaje ya está finalizado: la confirmación de asistencia quedó cerrada.';
  }
  if (message.includes('ya salió')) {
    return 'El viaje ya salió: no se puede modificar tu confirmación de asistencia.';
  }
  if (message.includes('solo pueden confirmar')) {
    return 'Solo el conductor y los pasajeros aceptados pueden confirmar asistencia.';
  }
  if (message.includes('respuesta no válida')) {
    return 'La respuesta enviada no es válida.';
  }
  return 'No se pudo registrar tu respuesta. Intenta nuevamente.';
};
