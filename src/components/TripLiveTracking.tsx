import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Navigation, Play, Satellite, Square, TriangleAlert, Users } from 'lucide-react';
import Button from './ui/Button';
import LiveLocationMap, { type LiveParticipant } from './LiveLocationMap';
import { useGeolocationWatcher } from '../hooks/useGeolocationWatcher';
import { formatGeoAge } from '../services/geolocationService';
import {
  getTripLiveLocations,
  publishMyTripLocation,
  setMyTripLocationSharing,
  startMyTrip,
  subscribeToTripLiveLocations,
  type TripLiveLocation,
} from '../services/tripLocationService';

/**
 * Seguimiento GPS compartido de UN viaje en curso.
 *
 * Se muestra SOLO cuando el viaje está 'in_progress' (lo decide la página que
 * lo monta). Requiere que el usuario ACEPTE EXPLÍCITAMENTE compartir: nunca se
 * publica sola. Al pulsar «Compartir mi ubicación» se enciende el watcher local
 * y cada lectura se publica por el RPC (la base de datos valida sesión,
 * participación y estado del viaje). «Detener» apaga el watcher y marca el
 * consentimiento en false.
 *
 * NO publica nada la prueba GPS del perfil: este componente es el único que
 * escribe en Supabase. Al desmontar se limpian el watcher y la suscripción.
 *
 * Limitación real (documentada): con la pestaña en segundo plano o el dispositivo
 * en ahorro de energía el navegador SUSPENDE la geolocalización. No hay GPS en
 * segundo plano y no se simula ninguna actualización.
 */

interface TripLiveTrackingProps {
  tripId: string;
  /** true si quien mira es el conductor (puede iniciar el viaje). */
  isDriver: boolean;
  /** Origen y destino, para el encabezado del panel. */
  origin: string;
  destination: string;
}

export default function TripLiveTracking({
  tripId,
  isDriver,
  origin,
  destination,
}: TripLiveTrackingProps) {
  // ¿Estoy compartiendo ahora mismo? (consentimiento activo del usuario).
  const [isSharing, setIsSharing] = useState(false);
  // Ubicaciones de TODOS los participantes del viaje (vistas por el RPC/Realtime).
  const [locations, setLocations] = useState<TripLiveLocation[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Watcher LOCAL de mi dispositivo (no publica por sí solo: ver efecto de abajo).
  const { position, status, errorMessage, errorName, start, stop } =
    useGeolocationWatcher();

  /** Refresca la lista de participantes leyendo el RPC (respeta RLS). */
  const refreshLocations = useCallback(async () => {
    try {
      setLocations(await getTripLiveLocations(tripId));
    } catch (error) {
      console.warn('No se pudieron cargar las ubicaciones del viaje:', error);
    }
  }, [tripId]);

  // Carga inicial + suscripción Realtime. Se limpia al desmontar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial asíncrona de las ubicaciones del viaje
    void refreshLocations();
    const unsubscribe = subscribeToTripLiveLocations(tripId, () => {
      void refreshLocations();
    });
    return unsubscribe;
  }, [refreshLocations, tripId]);

  // Publica mi lectura SOLO mientras comparto y hay una posición nueva.
  // La base de datos rechaza publicar si el viaje ya no está 'in_progress'.
  useEffect(() => {
    if (!isSharing || !position) return;
    let cancelled = false;
    void publishMyTripLocation(tripId, position.lat, position.lng, position.accuracy).catch(
      (error) => {
        if (!cancelled) {
          setActionError(
            error instanceof Error
              ? error.message
              : 'No se pudo compartir tu ubicación.'
          );
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [isSharing, position, tripId]);


  /** Enciende el watcher local y activa el consentimiento en la base de datos. */
  const handleStartSharing = async () => {
    setIsStarting(true);
    setActionError(null);
    try {
      // Si soy conductor y el viaje aún no está en curso, lo marco. Idempotente.
      if (isDriver) {
        await startMyTrip(tripId);
      }
      await setMyTripLocationSharing(tripId, true);
      setIsSharing(true);
      start();
    } catch (error) {
      console.error('Error al iniciar el seguimiento GPS:', error);
      setActionError(
        error instanceof Error
          ? error.message
          : 'No se pudo iniciar el seguimiento. Intenta nuevamente.'
      );
    } finally {
      setIsStarting(false);
    }
  };

  /** Detiene el watcher y desactiva el consentimiento (reversible). */
  const handleStopSharing = async () => {
    stop();
    setIsSharing(false);
    setActionError(null);
    try {
      await setMyTripLocationSharing(tripId, false);
      await refreshLocations();
    } catch (error) {
      console.error('Error al detener el seguimiento GPS:', error);
      // Aunque falle el RPC, el usuario YA dejó de compartir en el cliente:
      // el watcher está apagado, así que no se siguen publicando coordenadas.
      setActionError(
        error instanceof Error
          ? error.message
          : 'Se detuvo el seguimiento, pero no se pudo actualizar tu estado.'
      );
    }
  };

  // Participantes para el mapa: solo los que comparten y con coordenadas.
  const mapParticipants: LiveParticipant[] = useMemo(
    () =>
      locations
        .filter((loc) => loc.is_sharing)
        .map((loc) => ({
          userId: loc.user_id,
          name: loc.role === 'driver' ? `${loc.full_name} (conductor)` : loc.full_name,
          lat: loc.lat,
          lng: loc.lng,
          role: loc.role,
          updatedAt: loc.shared_at,
        })),
    [locations]
  );

  const [recenterToken, setRecenterToken] = useState(-1);
  const activeCenter = mapParticipants[0];


  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5">
      <h4 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <Navigation className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
        Ubicación en vivo
      </h4>

      <p className="mt-2 text-sm text-slate-600">
        {origin} → {destination}. Comparte tu posición en tiempo real con los demás
        participantes <strong>solo si lo decides tú</strong>. Nadie ve tu ubicación
        hasta que la compartas, y puedes detenerla cuando quieras.
      </p>

      {/* Estado de mi GPS + botón de consentimiento */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!isSharing ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleStartSharing()}
            disabled={isStarting}
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {isStarting ? 'Activando…' : 'Compartir mi ubicación'}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void handleStopSharing()}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Dejar de compartir
          </Button>
        )}

        {mapParticipants.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setRecenterToken((t) => t + 1)}>
            <Satellite className="h-4 w-4" aria-hidden="true" />
            Centrar en el grupo
          </Button>
        )}

        {isSharing && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
              status === 'active'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                status === 'active' ? 'bg-green-500' : 'bg-amber-500'
              }`}
            />
            {status === 'active'
              ? 'Compartiendo'
              : status === 'locating'
                ? 'Buscando señal…'
                : status === 'prompt'
                  ? 'Esperando permiso…'
                  : 'GPS del dispositivo'}
          </span>
        )}
      </div>

      {/* Aviso mientras no hay primera lectura */}
      {isSharing && !position && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Activando el GPS y publicando tu ubicación. Si estás bajo techo, acércate a
          una ventana.
        </p>
      )}

      {/* Error de acción (RPC o de consentimiento) */}
      {actionError && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {actionError}
        </p>
      )}

      {/* Error del watcher de geolocalización */}
      {isSharing && errorMessage && !actionError && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {errorMessage}
          {errorName === 'denied' && ' Revisa el permiso de ubicación del navegador.'}
        </p>
      )}


      {/* Mapa compartido */}
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <LiveLocationMap
          participants={mapParticipants}
          centerLat={activeCenter?.lat ?? 20.6597}
          centerLng={activeCenter?.lng ?? -103.3256}
          zoom={14}
          recenterToken={recenterToken}
          className="h-64 w-full sm:h-80"
        />
      </div>

      {/* Quién comparte y quién no */}
      <ul className="mt-3 space-y-1.5">
        {locations.length === 0 && (
          <li className="text-sm text-slate-500">
            Nadie está compartiendo su ubicación todavía.
          </li>
        )}
        {locations.map((loc) => (
          <li
            key={loc.user_id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <Users className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              {loc.role === 'driver' ? `${loc.full_name} (conductor)` : loc.full_name}
            </span>
            {loc.is_sharing ? (
              <span className="text-xs text-slate-500">
                compartió {formatGeoAge(loc.shared_at)}
              </span>
            ) : (
              <span className="text-xs font-medium text-slate-400">
                dejó de compartir
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* Limitación real de la web */}
      <p className="mt-3 text-xs text-slate-500">
        Nota: con la pestaña en segundo plano o el dispositivo en ahorro de energía, el
        navegador limita el GPS. Mantén la app visible para que tu ubicación se
        actualice.
      </p>
    </div>
  );
}

