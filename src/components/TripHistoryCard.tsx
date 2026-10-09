import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Backpack,
  Calendar,
  Car,
  CheckCircle2,
  Clock,
  Eye,
  Star,
} from 'lucide-react';
import Card from './ui/Card';
import StarRating from './ui/StarRating';
import { formatTripTimeLabel, parseTripDateTime } from '../utils/dateTime';
import { formatRating } from '../utils/profileFormat';
import {
  TRIP_LIFECYCLE_DESCRIPTIONS,
  TRIP_LIFECYCLE_LABELS,
  TRIP_ROLE_LABELS,
} from '../services/tripService';
import type { TripLifecycleStatus } from '../services/tripService';

/** Participante del viaje histórico con la calificación que el usuario le dio. */
export interface TripHistoryParticipant {
  id: string;
  name: string;
  /** Calificación 1-5 emitida por el usuario en este viaje (null si no hay). */
  ratingGiven: number | null;
}

export interface TripHistoryCardProps {
  /** Rol del usuario en el viaje histórico. */
  role: 'driver' | 'passenger';
  origin: string;
  destination: string;
  date: string;
  time: string;
  /** Estado efectivo del viaje (siempre 'completed' o 'cancelled' aquí). */
  status: TripLifecycleStatus;
  /** Conductor del viaje (null si el propio usuario es el conductor). */
  driverName: string | null;
  /** Participantes relevantes: pasajeros aceptados (conductor) o el conductor (pasajero). */
  participants: TripHistoryParticipant[];
  /** Calificación RECIBIDA en este viaje, resumida (null si no existe). */
  ratingReceived: { average: number; count: number; fromName: string | null } | null;
  /** Estado de la solicitud del pasajero (solo se muestra en rol pasajero). */
  requestStatusLabel?: string | null;
  /** Acciones que decide la página (calificar, ver detalle, etc.). */
  actions?: ReactNode;
}

/** Fecha del viaje en texto largo, parseada como hora local (nunca UTC). */
const formatHistoryDate = (date: string, time: string): string => {
  const parsed = parseTripDateTime(date, time);
  if (!parsed) return date;
  return parsed.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

/**
 * Tarjeta de HISTORIAL de un viaje (etapa 3): solo lectura.
 *
 * Muestra fecha, hora, origen, destino, rol del usuario, conductor, pasajeros
 * relevantes, estado y las calificaciones reales del viaje (dadas y
 * recibidas), reutilizando Card, StarRating y los badges del ciclo de vida.
 * No ofrece acciones propias de un viaje activo (aceptar o rechazar
 * solicitudes, eliminar el viaje, confirmar finalización): esas viven en las
 * tarjetas de «Próximos» y en el detalle del viaje.
 *
 * Componente puramente presentacional: no consulta Supabase. Las acciones se
 * inyectan desde la página para no duplicar el sistema de calificaciones.
 */
const TripHistoryCard = ({
  role,
  origin,
  destination,
  date,
  time,
  status,
  driverName,
  participants,
  ratingReceived,
  requestStatusLabel,
  actions,
}: TripHistoryCardProps) => {
  const RoleIcon = role === 'driver' ? Car : Backpack;
  const ratingsGiven = participants.filter((participant) => participant.ratingGiven !== null);

  return (
    <Card className="p-5 sm:p-6 app-animate-fade-up">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          {/* Ruta con la misma jerarquía visual que las tarjetas de Próximos */}
          <div className="flex items-start gap-3">
            <div className="mt-1.5 flex flex-col items-center" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
              <span className="my-1 h-8 w-px bg-slate-200" />
              <span className="h-2.5 w-2.5 rounded-full border-2 border-slate-900" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold uppercase tracking-[0.1em] text-slate-900">
                {origin}
              </p>
              <p className="mt-6 truncate text-sm font-bold uppercase tracking-[0.1em] text-slate-900">
                {destination}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {formatHistoryDate(date, time)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {formatTripTimeLabel(time)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              <RoleIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {TRIP_ROLE_LABELS[role]}
            </span>
            {requestStatusLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                {requestStatusLabel}
              </span>
            )}
          </div>

          {/* Conductor: solo se muestra cuando el usuario NO es el conductor */}
          {driverName && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <Car className="h-4 w-4 shrink-0" aria-hidden="true" />
                Conductor: {driverName}
              </span>
            </div>
          )}

          {/* Participantes relevantes: pasajeros aceptados (rol conductor) */}
          {role === 'driver' && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
                Pasajeros ({participants.length})
              </p>
              {participants.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">
                  Este viaje se realizó sin pasajeros apuntados.
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {participants.map((participant) => (
                    <li
                      key={participant.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
                    >
                      <span className="font-semibold text-slate-900">{participant.name}</span>
                      {participant.ratingGiven !== null ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800">
                          <Star className="h-3.5 w-3.5" aria-hidden="true" fill="currentColor" />
                          {formatRating(participant.ratingGiven)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Sin calificar</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Calificaciones reales del viaje: emitida(s) y recibida */}
          {(ratingsGiven.length > 0 || ratingReceived) && (
            <div className="mt-4 space-y-2">
              {ratingsGiven.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
                    Tu calificación
                  </span>
                  {ratingsGiven.map((participant) => (
                    <span key={participant.id} className="inline-flex items-center gap-2">
                      <StarRating value={participant.ratingGiven ?? 0} readOnly size="sm" />
                      <span className="text-xs font-semibold text-slate-700">
                        {participant.name}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {ratingReceived && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
                    Recibida
                  </span>
                  <StarRating value={Math.round(ratingReceived.average)} readOnly size="sm" />
                  <span className="text-xs text-slate-500">
                    {formatRating(ratingReceived.average)}
                    {ratingReceived.count > 1
                      ? ` · ${ratingReceived.count} calificaciones`
                      : ratingReceived.fromName
                        ? ` · de ${ratingReceived.fromName}`
                        : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {participants.length > 0 && role === 'passenger' && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <Link
                to={`/perfil/${participants[0].id}`}
                className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-800"
              >
                <Eye className="h-4 w-4" aria-hidden="true" /> Ver perfil de {participants[0].name}
              </Link>
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-2 lg:items-end">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
              status === 'completed'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
            title={TRIP_LIFECYCLE_DESCRIPTIONS[status]}
          >
            {status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {TRIP_LIFECYCLE_LABELS[status]}
          </span>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </Card>
  );
};

export default TripHistoryCard;
