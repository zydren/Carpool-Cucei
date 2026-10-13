import { useState } from 'react';
import {
  Crosshair,
  LocateFixed,
  MapPin,
  Play,
  ShieldQuestion,
  Square,
  TriangleAlert,
} from 'lucide-react';
import Button from './ui/Button';
import LiveLocationMap, { type LiveParticipant } from './LiveLocationMap';
import { useGeolocationWatcher } from '../hooks/useGeolocationWatcher';
import { formatGeoAge, GEO_PERMISSION_HELP } from '../services/geolocationService';

/**
 * Panel «Probar GPS» del perfil.
 *
 * Comprueba la geolocalización del dispositivo con `watchPosition`
 * (actualizaciones continuas, no una lectura única) y la dibuja en un mapa.
 *
 * Es INDEPENDIENTE de los viajes: funciona con o sin viaje programado y NO
 * publica nada en Supabase. El seguimiento compartido de viajes es otra
 * funcionalidad (tripLocationService) que exige consentimiento explícito.
 *
 * Al desmontarse, el hook detiene el watcher: no queda ningún recurso activo.
 */

/** Centro por defecto mientras no hay lectura: CUCEI (Guadalajara). */
const DEFAULT_CENTER = { lat: 20.6597, lng: -103.3256 };

/** Textos del estado del GPS para la interfaz. */
const STATUS_TEXT: Record<string, string> = {
  unsupported: 'No disponible en este navegador',
  idle: 'Sin iniciar',
  prompt: 'Esperando tu permiso…',
  locating: 'Buscando tu ubicación…',
  active: 'GPS activo',
  denied: 'Permiso denegado',
  error: 'Error de ubicación',
};

const statusClass: Record<string, string> = {
  unsupported: 'bg-slate-100 text-slate-600 border-slate-300',
  idle: 'bg-slate-100 text-slate-600 border-slate-300',
  prompt: 'bg-amber-50 text-amber-800 border-amber-200',
  locating: 'bg-amber-50 text-amber-800 border-amber-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  denied: 'bg-red-50 text-red-800 border-red-200',
  error: 'bg-red-50 text-red-800 border-red-200',
};

export default function GpsTestPanel() {
  const { position, status, errorMessage, errorName, start, stop, isWatching } =
    useGeolocationWatcher();

  // Contador para forzar el recentrado del mapa cuando el usuario lo pide.
  const [recenterToken, setRecenterToken] = useState(-1);

  const participants: LiveParticipant[] = position
    ? [
        {
          userId: 'me',
          name: 'Mi ubicación',
          lat: position.lat,
          lng: position.lng,
          role: 'driver',
          updatedAt: position.timestamp,
          isMe: true,
        },
      ]
    : [];

  const handleStart = () => {
    setRecenterToken(-1);
    start();
  };

  const handleRecenter = () => {
    setRecenterToken((token) => token + 1);
  };

  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4 sm:p-5">
      <h4 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <LocateFixed className="h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
        Prueba de GPS
      </h4>

      <p className="mt-2 text-sm text-slate-600">
        Comprueba que tu dispositivo comparte la ubicación correctamente. El navegador te
        pedirá permiso y, al concederlo, verás tu posición actualizarse en el mapa.
      </p>

      <p className="mt-1 text-xs text-slate-500">
        Esta prueba es solo para ti: no publica tu ubicación en Supabase ni la comparte
        con nadie.
      </p>

      {/* Estado del GPS */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass[status]}`}
          role="status"
        >
          {STATUS_TEXT[status] ?? status}
        </span>
        {position?.accuracy != null && status === 'active' && (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            Precisión ±{Math.round(position.accuracy)} m
          </span>
        )}
      </div>

      {/* Botones */}
      <div className="mt-3 flex flex-wrap gap-2">
        {!isWatching ? (
          <Button variant="secondary" size="sm" onClick={handleStart}>
            <Play className="h-4 w-4" aria-hidden="true" />
            {status === 'denied' || status === 'error' ? 'Reintentar' : 'Probar GPS'}
          </Button>
        ) : (
          <Button variant="danger" size="sm" onClick={stop}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Detener GPS
          </Button>
        )}

        <Button variant="outline" size="sm" disabled={!position} onClick={handleRecenter}>
          <Crosshair className="h-4 w-4" aria-hidden="true" />
          Centrar en mi posición
        </Button>
      </div>

      {/* Lectura actual */}
      {position && (
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Latitud
            </dt>
            <dd className="mt-0.5 font-bold text-slate-900">{position.lat.toFixed(6)}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Longitud
            </dt>
            <dd className="mt-0.5 font-bold text-slate-900">{position.lng.toFixed(6)}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Precisión
            </dt>
            <dd className="mt-0.5 font-bold text-slate-900">
              {position.accuracy != null ? `±${Math.round(position.accuracy)} m` : '—'}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Última lectura
            </dt>
            <dd className="mt-0.5 font-bold text-slate-900">
              {new Date(position.timestamp).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </dd>
          </div>
        </dl>
      )}

      {position && (
        <p className="mt-2 text-xs text-slate-500">
          Actualización {formatGeoAge(position.timestamp)}. Muévete y el marcador se
          desplazará sin recargar la página.
        </p>
      )}

      {/* Mapa */}
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <LiveLocationMap
          participants={participants}
          centerLat={position?.lat ?? DEFAULT_CENTER.lat}
          centerLng={position?.lng ?? DEFAULT_CENTER.lng}
          zoom={15}
          recenterToken={recenterToken}
          className="h-64 w-full sm:h-80"
        />
      </div>

      {/* Aviso mientras se espera la primera lectura */}
      {isWatching && !position && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Esperando la señal del GPS. Si estás bajo techo, acércate a una ventana.
        </p>
      )}

      {/* Permiso denegado: instrucciones claras */}
      {errorName === 'denied' && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-red-900">
            <ShieldQuestion className="h-4 w-4 shrink-0" aria-hidden="true" />
            Permiso de ubicación bloqueado
          </p>
          <p className="mt-1 text-sm text-red-800">
            El navegador tiene guardada la decisión de no compartir tu ubicación. Para
            volver a probar:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-red-800">
            {GEO_PERMISSION_HELP.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Otros errores */}
      {errorMessage && errorName !== 'denied' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {errorMessage}
        </p>
      )}

      {/* Limitación real de la web */}
      <p className="mt-3 text-xs text-slate-500">
        Nota: los navegadores limitan el GPS cuando la pestaña pasa a segundo plano o el
        dispositivo entra en ahorro de energía. Mantén esta ventana visible para ver las
        actualizaciones.
      </p>
    </div>
  );
}
