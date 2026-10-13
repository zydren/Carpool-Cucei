import { supabase } from '../lib/supabase';

/**
 * Servicio de la ETAPA de seguimiento GPS compartido durante los viajes.
 *
 * Toda la validación de negocio vive en la base de datos
 * (supabase/migrations/add_trip_live_locations.sql):
 *   - El frontend NO puede insertar/actualizar filas directamente (la tabla no
 *     tiene INSERT/UPDATE/DELETE para la API). La única vía de escritura son los
 *     RPC SECURITY DEFINER, que validan EN EL SERVIDOR: sesión (auth.uid(),
 *     jamás un user_id del cliente), que el viaje esté 'in_progress' y que el
 *     llamador sea participante (conductor o pasajero aceptado).
 *   - RLS de lectura: solo los participantes del viaje ven esas ubicaciones, y
 *     Realtime respeta esas mismas políticas (cada cliente recibe únicamente lo
 *     que le corresponde).
 *
 * Responsabilidad de este servicio: envolver los RPC y la suscripción Realtime
 * con tipos y mensajes en español. NO calcula permisos ni ventanas: delega.
 *
 * NO se almacena historial: solo la ÚLTIMA posición por (viaje, usuario).
 * La confirmación de asistencia NO activa el GPS: compartir ubicación exige una
 * acción propia y explícita del usuario.
 */

/** Rol del usuario dentro del viaje (lo calcula la base de datos). */
export type TripLiveRole = 'driver' | 'passenger';

/** Fila devuelta por el RPC get_trip_live_locations(). */
export interface TripLiveLocation {
  user_id: string;
  full_name: string;
  role: TripLiveRole;
  lat: number;
  lng: number;
  accuracy: number | null;
  /** Instante (servidor) de la última lectura compartida (ISO). */
  shared_at: string;
  /** false si esa persona dejó de compartir (se conserva la última lectura). */
  is_sharing: boolean;
}

/** Mensaje de "migración pendiente": no se muestra como error al usuario. */
export const TRIP_LIVE_NOT_READY_MESSAGE =
  'El seguimiento en vivo todavía no está disponible.';

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

/** Traduce los errores de la base de datos a mensajes accionables en español. */
export const mapTripLocationError = (
  error: { message?: string; details?: string; code?: string } | null
): string => {
  if (error) {
    logSupabaseError('tripLocation.rpc', error);
  }

  if (isMissingRelationError(error)) {
    return TRIP_LIVE_NOT_READY_MESSAGE;
  }

  const message = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();

  if (message.includes('iniciar sesión')) {
    return 'Debes iniciar sesión para compartir tu ubicación.';
  }
  if (message.includes('no está en curso')) {
    return 'El viaje debe estar en curso para compartir la ubicación.';
  }
  if (message.includes('no existe')) {
    return 'El viaje no existe o ya no está disponible.';
  }
  if (message.includes('solo los participantes')) {
    return 'Solo el conductor y los pasajeros aceptados pueden compartir su ubicación.';
  }
  if (message.includes('solo el conductor')) {
    return 'Solo el conductor puede iniciar el viaje.';
  }
  if (message.includes('no se puede iniciar')) {
    return 'El viaje no se puede iniciar en su estado actual.';
  }
  if (message.includes('inválidas') || message.includes('invalid')) {
    return 'No se pudo leer una ubicación válida del GPS.';
  }
  return 'No se pudo actualizar tu ubicación. Intenta nuevamente.';
};


/**
 * Marca el viaje como EN CURSO ('in_progress'). Solo el conductor (lo valida el
 * RPC). Idempotente: si ya está en curso, no hace nada. No completa ni cancela
 * nada: respeta el ciclo de vida existente.
 */
export const startMyTrip = async (tripId: string): Promise<string> => {
  const { data, error } = await supabase.rpc('start_my_trip', {
    p_trip_id: tripId,
  });

  if (error) {
    throw new Error(mapTripLocationError(error));
  }

  return (data ?? 'in_progress') as string;
};

/**
 * Publica MI ubicación en un viaje en curso. La base de datos valida sesión,
 * estado 'in_progress' y participación; solo escribe mi propia fila.
 * @param accuracy Precisión GPS en metros (opcional).
 */
export const publishMyTripLocation = async (
  tripId: string,
  lat: number,
  lng: number,
  accuracy: number | null
): Promise<void> => {
  const { error } = await supabase.rpc('upsert_my_trip_location', {
    p_trip_id: tripId,
    p_lat: lat,
    p_lng: lng,
    p_accuracy: accuracy,
  });

  if (error) {
    throw new Error(mapTripLocationError(error));
  }
};

/**
 * Activa o desactiva MI consentimiento de compartir ubicación. Apagar el
 * interruptor NO borra la última lectura (queda marcada como "dejó de
 * compartir"), es reversible y solo afecta a mi propia fila.
 */
export const setMyTripLocationSharing = async (
  tripId: string,
  isSharing: boolean
): Promise<void> => {
  const { error } = await supabase.rpc('set_my_trip_location_sharing', {
    p_trip_id: tripId,
    p_is_sharing: isSharing,
  });

  if (error) {
    throw new Error(mapTripLocationError(error));
  }
};

/**
 * Lee las ubicaciones compartidas de un viaje (solo para participantes, lo
 * valida el RPC). Devuelve una lista vacía si la migración no está aplicada,
 * para que la app siga funcionando.
 */
export const getTripLiveLocations = async (
  tripId: string
): Promise<TripLiveLocation[]> => {
  const { data, error } = await supabase.rpc('get_trip_live_locations', {
    p_trip_id: tripId,
  });

  if (error) {
    logSupabaseError('getTripLiveLocations', error);
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(mapTripLocationError(error));
  }

  return (data ?? []) as TripLiveLocation[];
};

/**
 * Se suscribe a los cambios de ubicación de UN viaje concreto por Realtime.
 *
 * Cada vez que hay un INSERT/UPDATE/DELETE en las filas de ese viaje se llama a
 * `onChanged` para que la interfaz refresque (re-consulta el RPC, que devuelve
 * nombre y rol). No se intenta mapear el payload crudo: la RLS ya filtra lo que
 * recibe cada cliente, de modo que un usuario ajeno al viaje no recibe nada.
 *
 * @returns Función para cancelar la suscripción (idempotente). Debe llamarse al
 *          desmontar para no dejar canales ni watchers activos.
 */
export const subscribeToTripLiveLocations = (
  tripId: string,
  onChanged: () => void
): (() => void) => {
  const channel = supabase
    .channel(`trip-live:${tripId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'trip_live_locations',
        filter: `trip_id=eq.${tripId}`,
      },
      () => onChanged()
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};
