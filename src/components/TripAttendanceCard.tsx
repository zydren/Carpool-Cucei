import { useState } from 'react';
import { CheckCircle2, Clock, Loader2, MapPin, UserCheck, UserX } from 'lucide-react';
import Button from './ui/Button';
import { formatTripDayLabel, formatTripTimeLabel } from '../utils/dateTime';
import {
  respondTripAttendance,
  TRIP_ATTENDANCE_STATUS_DESCRIPTIONS,
  TRIP_ATTENDANCE_STATUS_LABELS,
} from '../services/tripAttendanceService';
import type {
  TripAttendanceResponse,
  TripAttendanceRow,
} from '../services/tripAttendanceService';

/**
 * Tarjeta de confirmación de asistencia (20 minutos antes de la salida).
 *
 * Se muestra SOLO cuando el proceso del servidor ya creó la solicitud para
 * este usuario (existe la fila en trip_attendance_confirmations) y su
 * respuesta sigue 'pending'. La respuesta se guarda en Supabase mediante el
 * RPC respond_trip_attendance(), por lo que persiste al recargar la página.
 *
 * Reglas que respeta:
 *   * Cada persona responde por sí misma: nunca se envía un user_id.
 *   * Contestar «No podré asistir» NO cancela el viaje ni elimina la
 *     solicitud aceptada del pasajero: solo queda registrado.
 *   * No hay GPS ni permisos de geolocalización: la confirmación de asistencia
 *     es independiente de compartir la ubicación.
 */

interface TripAttendanceCardProps {
  tripId: string;
  origin: string;
  destination: string;
  /** Fecha del viaje ('YYYY-MM-DD'). */
  date: string;
  /** Hora del viaje ('HH:MM'). */
  time: string;
  /** Mi fila de confirmación; null = todavía no se solicitó. */
  attendance: TripAttendanceRow | null;
  /** Avisa a la página para guardar la respuesta en su estado (ya persistida). */
  onResponded?: (tripId: string, response: TripAttendanceResponse) => void;
}

const statusBadgeClass: Record<TripAttendanceResponse, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  declined: 'bg-slate-100 text-slate-700 border-slate-300',
};

export default function TripAttendanceCard({
  tripId,
  origin,
  destination,
  date,
  time,
  attendance,
  onResponded,
}: TripAttendanceCardProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin fila no hay nada que confirmar: el proceso programado aún no actuó.
  if (!attendance) return null;

  const { response } = attendance;
  const isPending = response === 'pending';
  const dayLabel = formatTripDayLabel(date);
  const timeLabel = formatTripTimeLabel(time);

  const handleRespond = async (next: Exclude<TripAttendanceResponse, 'pending'>) => {
    // Evita envíos dobles (doble clic o dos pulsaciones rápidas).
    if (isSaving || !isPending) return;

    setIsSaving(true);
    setError(null);

    try {
      await respondTripAttendance(tripId, next);
      onResponded?.(tripId, next);
    } catch (err) {
      console.error('Error al registrar la confirmación de asistencia:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo registrar tu respuesta. Intenta nuevamente.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Clock className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
            Confirma tu asistencia
          </h4>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              {origin} → {destination}
            </span>
            <span>
              {dayLabel ? `${dayLabel}, ` : ''}
              {timeLabel}
            </span>
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass[response]}`}
          title={TRIP_ATTENDANCE_STATUS_DESCRIPTIONS[response]}
        >
          {TRIP_ATTENDANCE_STATUS_LABELS[response]}
        </span>
      </div>

      {isPending ? (
        <>
          <p className="mt-3 text-sm text-slate-600">
            Faltan 20 minutos o menos para la salida. Indica si asistirás para que el
            conductor y tus compañeros sepan quién va en el viaje.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isSaving}
              onClick={() => handleRespond('confirmed')}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <UserCheck className="h-4 w-4" aria-hidden="true" />
              )}
              {isSaving ? 'Guardando...' : 'Confirmar asistencia'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isSaving}
              onClick={() => handleRespond('declined')}
            >
              <UserX className="h-4 w-4" aria-hidden="true" />
              No podré asistir
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Esta confirmación no comparte tu ubicación: el GPS no se activa al
            responder.
          </p>
        </>
      ) : (
        <p
          className={`mt-3 inline-flex items-start gap-1.5 text-sm ${
            response === 'confirmed' ? 'text-green-700' : 'text-slate-600'
          }`}
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {response === 'confirmed'
            ? 'Confirmaste tu asistencia a este viaje. Ya registramos tu respuesta.'
            : 'Registramos que no podrás asistir. El viaje continúa igual y tu solicitud aceptada se mantiene: si finalmente puedes ir, avísale al conductor.'}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
