/**
 * Acceso a la geolocalización del NAVEGADOR (API `navigator.geolocation`).
 *
 * Responsabilidad única: envolver la API del navegador con tipos y mensajes de
 * error en español. NO consulta Supabase ni persiste nada: la ubicación se
 * queda en el cliente salvo que otro servicio (tripLocationService) decida
 * publicarla de forma EXPLÍCITA.
 *
 * Limitación real de la web (documentada a propósito): los navegadores
 * SUSPENDEN la geolocalización cuando la pestaña pasa a segundo plano, el
 * dispositivo entra en ahorro de energía o se cierra la página. Por eso no se
 * promete seguimiento en segundo plano: solo funciona con la pestaña visible.
 * Este servicio nunca simula ni inventa actualizaciones.
 */

/** Lectura de posición ya normalizada para la interfaz. */
export interface GeoPosition {
  lat: number;
  lng: number;
  /** Precisión estimada en metros (radio de 68 % de confianza). */
  accuracy: number | null;
  /** Instante de la lectura (ISO). */
  timestamp: string;
}

/**
 * Estado del GPS para la interfaz.
 * - 'unsupported': el navegador no tiene geolocalización.
 * - 'idle'       : todavía no se pidió nada.
 * - 'prompt'     : el navegador está pidiendo permiso al usuario.
 * - 'locating'   : permiso concedido, esperando la primera lectura.
 * - 'active'     : se reciben lecturas.
 * - 'denied'     : el usuario (o el navegador) negó el permiso.
 * - 'error'      : otro error (no disponible, tiempo agotado, etc.).
 */
export type GeoStatus =
  | 'unsupported'
  | 'idle'
  | 'prompt'
  | 'locating'
  | 'active'
  | 'denied'
  | 'error';

/** ¿Este navegador expone la API de geolocalización? */
export const isGeolocationSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'geolocation' in navigator;

/**
 * Permiso actual según la Permissions API, cuando el navegador la expone.
 * Devuelve 'unknown' si no se puede consultar (Safari, Firefox antiguos o
 * contexto no seguro): la interfaz no debe bloquearse por eso.
 */
export const queryGeolocationPermission = async (): Promise<
  'granted' | 'denied' | 'prompt' | 'unknown'
> => {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unknown';
  }

  try {
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName,
    });
    return status.state;
  } catch {
    // Algunos navegadores lanzan TypeError si no reconocen el nombre.
    return 'unknown';
  }
};

/**
 * Una sola lectura de la posición actual.
 * @param timeoutMs Milisegundos máximos de espera (por defecto 15 s).
 */
export const getCurrentPosition = (timeoutMs = 15_000): Promise<GeoPosition> =>
  new Promise((resolve, reject) => {
    if (!isGeolocationSupported()) {
      reject(makeGeoError('unsupported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve(toGeoPosition(position));
      },
      (error) => {
        reject(mapGeoError(error));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });

/** Convierte la lectura nativa en nuestro tipo normalizado. */
const toGeoPosition = (position: GeolocationPosition): GeoPosition => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
  accuracy: Number.isFinite(position.coords.accuracy)
    ? position.coords.accuracy
    : null,
  timestamp: new Date(position.timestamp || Date.now()).toISOString(),
});

/** Opciones del seguimiento continuo. */
export interface WatchOptions {
  /** Se llama con cada lectura nueva. */
  onUpdate: (position: GeoPosition) => void;
  /** Se llama si falla el permiso o la lectura. */
  onError?: (error: Error) => void;
  /**
   * Intervalo MÍNIMO entre lecturas forzadas (ms). No es un periodo
   * garantizado: el navegador decide la frecuencia real y puede espaciarla más.
   */
  minIntervalMs?: number;
}

/** Controlador devuelto por watchPosition: permite detener el seguimiento. */
export interface GeoWatcher {
  /** Id nativo devuelto por navigator.geolocation.watchPosition. */
  readonly nativeId: number;
  /** Detiene el seguimiento y libera el recurso. Es idempotente. */
  stop: () => void;
  /** true si el seguimiento sigue activo. */
  isActive: () => boolean;
}

/**
 * Seguimiento continuo con `watchPosition` (no una lectura única).
 *
 * Detalles de implementación:
 *   * Se conserva el id nativo para llamar a `clearWatch` al desmontar.
 *   * `stop()` es idempotente: llamarlo dos veces no rompe nada.
 *   * Se filtran lecturas idénticas seguidas para no saturar la interfaz,
 *     pero NUNCA se interpolan ni inventan posiciones intermedias.
 */
export const watchPosition = ({
  onUpdate,
  onError,
  minIntervalMs = 3_000,
}: WatchOptions): GeoWatcher => {
  if (!isGeolocationSupported()) {
    const error = makeGeoError('unsupported');
    // Se notifica de forma asíncrona para no lanzar dentro del render.
    window.setTimeout(() => onError?.(error), 0);
    return { nativeId: -1, stop: () => {}, isActive: () => false };
  }

  let active = true;
  let lastEmit = 0;
  let lastKey = '';

  const nativeId = navigator.geolocation.watchPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const now = Date.now();

      // Descarta lecturas idénticas muy seguidas (el navegador las repite).
      const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      if (key === lastKey && now - lastEmit < minIntervalMs) {
        return;
      }
      lastKey = key;
      lastEmit = now;

      if (!active) return;
      onUpdate(toGeoPosition(position));
    },
    (error) => {
      if (!active) return;
      onError?.(mapGeoError(error));
    },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
  );

  return {
    nativeId,
    stop: () => {
      if (!active) return;
      active = false;
      navigator.geolocation.clearWatch(nativeId);
    },
    isActive: () => active,
  };
};

/** Error del navegador sin soporte de geolocalización. */
const makeGeoError = (name: string): Error => {
  const error = new Error(
    'Tu navegador no permite acceder a la ubicación. Usa HTTPS y un navegador actualizado.'
  );
  error.name = name;
  return error;
};

/**
 * Traduce los errores nativos de la API a mensajes accionables EN ESPAÑOL.
 * El código nativo se conserva en `name` para que la interfaz pueda decidir si
 * debe mostrar instrucciones para habilitar el permiso.
 */
export const mapGeoError = (error: GeolocationPositionError): Error => {
  const mapped = new Error('');
  switch (error.code) {
    case error.PERMISSION_DENIED:
      mapped.name = 'denied';
      mapped.message =
        'Permiso de ubicación denegado. Habilítalo en el candado de la barra de direcciones.';
      break;
    case error.POSITION_UNAVAILABLE:
      mapped.name = 'unavailable';
      mapped.message =
        'No se pudo obtener tu ubicación. Activa la ubicación del dispositivo y vuelve a intentarlo.';
      break;
    case error.TIMEOUT:
      mapped.name = 'timeout';
      mapped.message =
        'El GPS tardó demasiado en responder. Acércate a una ventana o inténtalo de nuevo.';
      break;
    default:
      mapped.name = 'error';
      mapped.message = 'Ocurrió un error inesperado al obtener tu ubicación.';
  }
  return mapped;
};

/** Instrucciones para volver a habilitar el permiso tras denegarlo. */
export const GEO_PERMISSION_HELP: string[] = [
  'Haz clic en el icono del candado que aparece junto a la dirección del sitio.',
  'Busca el permiso «Ubicación» y cámbialo a «Permitir».',
  'Recarga la página y vuelve a pulsar «Probar GPS».',
  'En teléfono: activa la ubicación del sistema para este navegador.',
];

/** Antigüedad legible de una lectura («hace 12 s»), en español. */
export const formatGeoAge = (isoTimestamp: string, now: Date = new Date()): string => {
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return 'hora desconocida';

  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 5) return 'hace unos segundos';
  if (seconds < 60) return `hace ${seconds} s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  return `hace ${hours} h`;
};
