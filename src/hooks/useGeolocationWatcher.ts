import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isGeolocationSupported,
  watchPosition,
  type GeoPosition,
  type GeoStatus,
  type GeoWatcher,
} from '../services/geolocationService';

/**
 * Hook que envuelve `navigator.geolocation.watchPosition` para React.
 *
 * Responsabilidad: gestionar el CICLO DE VIDA del watcher para que nunca quede
 * activo tras desmontar el componente (fuga clásica de watchPosition). Toda la
 * lógica de bajo nivel vive en services/geolocationService.
 *
 * Reglas:
 *   - No publica nada en Supabase: es seguimiento LOCAL (prueba GPS del perfil).
 *   - Detiene el watcher al desmontar, al cambiar de pestaña a oculta NO se
 *     fuerza parada (el navegador ya lo limita por sí solo).
 *   - No simula posiciones: si no hay lectura, el estado es 'locating'.
 */

interface UseGeolocationWatcherResult {
  /** Última lectura recibida (null si aún no llegó ninguna). */
  position: GeoPosition | null;
  /** Estado para la interfaz. */
  status: GeoStatus;
  /** Mensaje de error en español (null si no hay error). */
  errorMessage: string | null;
  /** Nombre del error nativo ('denied', 'timeout', 'unsupported', ...). */
  errorName: string | null;
  /** Inicia el seguimiento continuo (pide permiso si hace falta). */
  start: () => void;
  /** Detiene el seguimiento y libera el watcher. Idempotente. */
  stop: () => void;
  /** true mientras el seguimiento está activo. */
  isWatching: boolean;
}

export const useGeolocationWatcher = (): UseGeolocationWatcherResult => {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorName, setErrorName] = useState<string | null>(null);
  const [isWatching, setIsWatching] = useState(false);

  // Ref (no estado) para que `stop` sea estable y no dependa del render.
  const watcherRef = useRef<GeoWatcher | null>(null);

  /** Detiene el watcher actual si existe. Idempotente. */
  const stop = useCallback(() => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setIsWatching(false);
    setStatus((current) => (current === 'denied' || current === 'error' ? current : 'idle'));
  }, []);

  /** Inicia el seguimiento continuo. */
  const start = useCallback(() => {
    // Evita watchers duplicados si se pulsa dos veces seguidas.
    watcherRef.current?.stop();
    watcherRef.current = null;

    setPosition(null);
    setErrorMessage(null);
    setErrorName(null);

    if (!isGeolocationSupported()) {
      setStatus('unsupported');
      setErrorName('unsupported');
      setErrorMessage(
        'Tu navegador no permite acceder a la ubicación. Usa HTTPS y un navegador actualizado.'
      );
      return;
    }

    setStatus('prompt');
    setIsWatching(true);

    watcherRef.current = watchPosition({
      onUpdate: (next) => {
        setPosition(next);
        setStatus('active');
        setErrorMessage(null);
        setErrorName(null);
      },
      onError: (error) => {
        setErrorName(error.name);
        setErrorMessage(error.message);
        setStatus(error.name === 'denied' ? 'denied' : 'error');
        setIsWatching(false);
        // Un fallo deja el watcher inservible: se libera el recurso.
        watcherRef.current?.stop();
        watcherRef.current = null;
      },
    });

    // Si el permiso ya estaba concedido, pasamos directamente a «buscando».
    setStatus((current) => (current === 'prompt' ? 'locating' : current));
  }, []);

  // Limpieza garantizada al desmontar el componente.
  useEffect(() => {
    return () => {
      watcherRef.current?.stop();
      watcherRef.current = null;
    };
  }, []);

  return {
    position,
    status,
    errorMessage,
    errorName,
    start,
    stop,
    isWatching,
  };
};
