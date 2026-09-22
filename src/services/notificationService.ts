import { supabase } from '../lib/supabase';

/**
 * Tipos de notificación que generan los triggers de la base de datos
 * (ver supabase/migrations/add_notifications.sql).
 *
 * El frontend NUNCA crea notificaciones: solo las lee, las marca como leídas
 * (o las elimina). La inserción es exclusiva de los triggers SECURITY DEFINER
 * sobre trip_requests, así que no existe permiso INSERT para la API.
 */
export type NotificationType =
  | 'request_created'
  | 'request_accepted'
  | 'request_rejected'
  | 'request_cancelled';

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  related_trip_id: string | null;
  related_request_id: string | null;
  read: boolean;
  created_at: string;
}

const NOT_AUTHENTICATED_MESSAGE = 'Debes iniciar sesión para ver tus notificaciones.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar tus notificaciones.';

/**
 * Ruta de "Mis viajes" a la que lleva cada tipo de notificación.
 * El destinatario (conductor o pasajero) lo decide el trigger; aquí solo se
 * traduce el tipo a la pestaña correcta de la página.
 */
export const notificationTargetPath: Record<NotificationType, string> = {
  request_created: '/mis-viajes?tab=driver',
  request_accepted: '/mis-viajes?tab=passenger',
  request_rejected: '/mis-viajes?tab=passenger',
  request_cancelled: '/mis-viajes?tab=driver',
};

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
 * Obtiene las notificaciones del usuario autenticado, de la más reciente a la
 * más antigua. El límite evita listados enormes en el desplegable del navbar.
 */
export const getMyNotifications = async (limit = 20): Promise<AppNotification[]> => {
  const userId = await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error getting notifications:', error);
    throw new Error(LOAD_ERROR_MESSAGE);
  }

  return (data || []) as AppNotification[];
};

/**
 * Cantidad de notificaciones sin leer del usuario autenticado.
 * Se usa únicamente para el contador de la campana del navbar.
 */
export const getUnreadNotificationsCount = async (): Promise<number> => {
  const userId = await getAuthenticatedUserId();

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) {
    console.error('Error counting unread notifications:', error);
    throw new Error(LOAD_ERROR_MESSAGE);
  }

  return count ?? 0;
};


/**
 * Marca una notificación propia como leída.
 * Se filtra también por user_id: la política RLS ya lo garantiza, pero así el
 * UPDATE no puede tocar la notificación de otra persona ni por error.
 */
export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  const userId = await getAuthenticatedUserId();

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error marking notification as read:', error);
    throw new Error('No se pudo marcar la notificación como leída.');
  }
};

/**
 * Marca todas las notificaciones propias sin leer como leídas.
 */
export const markAllMyNotificationsAsRead = async (): Promise<void> => {
  const userId = await getAuthenticatedUserId();

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) {
    console.error('Error marking all notifications as read:', error);
    throw new Error('No se pudieron marcar las notificaciones como leídas.');
  }
};

/**
 * Elimina una notificación propia.
 * Disponible para un uso futuro (la política RLS "Users can delete own
 * notifications" ya lo permite); la Etapa 1 no muestra esta acción en la UI.
 */
export const deleteNotification = async (notificationId: string): Promise<void> => {
  const userId = await getAuthenticatedUserId();

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting notification:', error);
    throw new Error('No se pudo eliminar la notificación.');
  }
};

/**
 * Formatea la fecha/hora de una notificación para mostrarla en la lista.
 * @returns Cadena vacía si la fecha almacenada no es válida.
 */
export const formatNotificationDate = (createdAt: string): string => {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};
