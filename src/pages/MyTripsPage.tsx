import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Armchair,
  Backpack,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Mail,
  MapPin,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { EmptyState, GroupHeading, InlineEmptyState } from '../components/ui/PageBlocks';
import { PageHeader } from '../components/layout/AppShell';
import TripHistoryCard from '../components/TripHistoryCard';
import { getCurrentUser } from '../services/authService';
import {
  getTripsByDriver,
  deleteTrip,
  getTripLifecycleStatus,
  canConfirmTripCompletion,
  canRateFinishedTrip,
  isTripLifecycleFinished,
  TRIP_STATUS,
  TRIP_LIFECYCLE_LABELS,
  TRIP_LIFECYCLE_DESCRIPTIONS,
} from '../services/tripService';
import type { TripFromDB, TripLifecycleStatus } from '../services/tripService';
import {
  getTripRequestsForDriver,
  getMyRequestedTrips,
  acceptTripRequest,
  rejectTripRequest,
  cancelTripRequest,
  tripRequestStatusLabel,
} from '../services/tripRequestService';
import type {
  TripRequestDetails,
  TripRequestStatus,
  MyRequestedTrip,
} from '../services/tripRequestService';
import { getMyRatings, submitRating } from '../services/ratingService';
import type { Rating } from '../services/ratingService';
import { getUserRatings } from '../services/profileService';
import type { ReceivedRating } from '../services/profileService';
import RatingModal from '../components/RatingModal';
import Modal from '../components/ui/Modal';
import {
  confirmTripCompletion,
  getMyTripCompletionConfirmations,
  reapMyTripCompletions,
} from '../services/tripCompletionService';

/**
 * Mis Viajes (etapas 2 y 3 del ciclo de vida).
 *
 * Estructura de la vista:
 *   - Filtro (en la URL, parámetro 'tab'): Todos / Como conductor /
 *     Como pasajero / Completados / Cancelados. Los valores 'driver' y
 *     'passenger' son los mismos que ya usaban las notificaciones.
 *   - Cada rol se divide en dos grupos explícitos:
 *       · Próximos  = futuros, en curso y pendientes de finalizar;
 *       · Historial = completados (y cancelados, cuando corresponde),
 *                     en tarjetas de solo lectura (TripHistoryCard).
 *   - Las calificaciones siguen siendo el MISMO sistema existente
 *     (ratingService + RPC submit_rating / RatingModal): aquí solo se muestra
 *     lo que ya existe y se ofrece calificar a participantes reales.
 */

const statusBadgeClass: Record<TripRequestStatus, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-slate-50 text-slate-600 border-slate-200',
};

/**
 * Estilos del estado del CICLO DE VIDA del viaje (etapa 2). Son distintos de
 * los de la solicitud: aquí se distingue si el viaje está publicado, en curso,
 * pendiente de finalizar, finalizado o cancelado.
 */
const lifecycleBadgeClass: Record<TripLifecycleStatus, string> = {
  scheduled: 'bg-green-50 text-green-700 border-green-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  pending_completion: 'bg-amber-50 text-amber-800 border-amber-200',
  completed: 'bg-slate-100 text-slate-700 border-slate-300',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200',
};

interface Notice {
  type: 'success' | 'error';
  text: string;
}

/** Viaje pendiente de confirmación de finalización (abre el modal). */
interface CompletionTarget {
  tripId: string;
  routeLabel: string;
  role: 'driver' | 'passenger';
}

// ============================================================
// ETAPA 3: FILTROS Y AGRUPACIÓN DEL HISTORIAL
// ============================================================

/** Filtros disponibles (se guardan en ?tab= para no romper los deep-links). */
type TripsView = 'all' | 'driver' | 'passenger' | 'completed' | 'cancelled';

const TRIPS_VIEW_OPTIONS: { value: TripsView; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'Todos', icon: Calendar },
  { value: 'driver', label: 'Como conductor', icon: Car },
  { value: 'passenger', label: 'Como pasajero', icon: Backpack },
  { value: 'completed', label: 'Completados', icon: CheckCircle2 },
  { value: 'cancelled', label: 'Cancelados', icon: X },
];

/** Cualquier valor desconocido o ausente cae en «Todos» (vista completa). */
const parseTripsView = (raw: string | null): TripsView =>
  TRIPS_VIEW_OPTIONS.some((option) => option.value === raw) ? (raw as TripsView) : 'all';

/** Ámbito de estado que impone el filtro activo. */
type TripsStatusScope = 'all' | 'completed' | 'cancelled';

const statusScopeOf = (view: TripsView): TripsStatusScope =>
  view === 'completed' || view === 'cancelled' ? view : 'all';

/** Grupo al que pertenece una tarjeta dentro de cada rol. */
type TripGroup = 'upcoming' | 'history';

/** Orden por salida programada: próximos ascendente, historial descendente. */
const sortByScheduledStart = <T,>(
  items: T[],
  read: (item: T) => { date: string; time: string },
  direction: 'asc' | 'desc'
): T[] =>
  [...items].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    const leftKey = `${left.date}T${(left.time ?? '').slice(0, 5)}`;
    const rightKey = `${right.date}T${(right.time ?? '').slice(0, 5)}`;
    return direction === 'asc'
      ? leftKey.localeCompare(rightKey)
      : rightKey.localeCompare(leftKey);
  });

/** Estado efectivo del ciclo de vida de un viaje publicado por el conductor. */
const driverLifecycleOf = (trip: TripFromDB): TripLifecycleStatus =>
  getTripLifecycleStatus({
    date: trip.date,
    time: trip.time,
    status: trip.status,
    durationMinutes: trip.route_duration_minutes,
  });

/** Estado efectivo del ciclo de vida de un viaje solicitado como pasajero. */
const passengerLifecycleOf = (request: MyRequestedTrip): TripLifecycleStatus =>
  getTripLifecycleStatus({
    date: request.date,
    time: request.time,
    status: request.trip_status,
    durationMinutes: request.trip_route_duration_minutes,
  });

/**
 * Grupo de una solicitud como pasajero.
 * Próximos: el viaje todavía no terminó y la solicitud sigue viva
 * (pendiente o aceptada). Historial: el viaje ya terminó o se canceló, o la
 * solicitud quedó cerrada (rechazada o cancelada), por lo que ya no llevará a
 * ningún viaje futuro.
 */
const passengerGroupOf = (
  request: MyRequestedTrip,
  lifecycle: TripLifecycleStatus
): TripGroup =>
  !isTripLifecycleFinished(lifecycle) &&
  (request.status === 'pending' || request.status === 'accepted')
    ? 'upcoming'
    : 'history';

/**
 * Calificación recibida en un viaje, resumida para la tarjeta histórica.
 * Con una sola calificación se muestra quién la emitió; con varias se muestra
 * el promedio y el número de participantes (sin exponer datos privados).
 */
const summarizeReceivedRating = (
  ratings: ReceivedRating[] | undefined
): { average: number; count: number; fromName: string | null } | null => {
  if (!ratings || ratings.length === 0) return null;
  const total = ratings.reduce((sum, item) => sum + item.rating, 0);
  return {
    average: total / ratings.length,
    count: ratings.length,
    fromName: ratings.length === 1 ? ratings[0].rater_name ?? null : null,
  };
};

/** Índice por viaje de una lista de calificaciones (para el historial). */
const indexRatingsByTrip = <T extends { trip_id: string }>(
  ratings: T[]
): Record<string, T[]> => {
  const byTrip: Record<string, T[]> = {};
  for (const rating of ratings) {
    (byTrip[rating.trip_id] ??= []).push(rating);
  }
  return byTrip;
};

/** Nota de un grupo vacío (Próximos o Historial sin elementos). */
const GroupEmptyNote = ({ children }: { children: string }) => (
  <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-500">
    {children}
  </p>
);

const MyTripsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // El filtro vive en la URL con el MISMO parámetro 'tab' que ya usaban las
  // notificaciones y el panel del estudiante (?tab=driver | ?tab=passenger),
  // así esos enlaces siguen abriendo la vista correcta. La etapa 3 añade los
  // valores 'all' (Todos), 'completed' (Completados) y 'cancelled'
  // (Cancelados); sin parámetro se muestra «Todos».
  const view = parseTripsView(searchParams.get('tab'));

  const handleViewChange = (next: TripsView) => {
    if (next === view) return;
    setSearchParams(next === 'all' ? {} : { tab: next });
  };

  const [isLoading, setIsLoading] = useState(true);
  const [trips, setTrips] = useState<TripFromDB[]>([]);
  const [requests, setRequests] = useState<TripRequestDetails[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);
  const [passengerTrips, setPassengerTrips] = useState<MyRequestedTrip[]>([]);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [ratedDriversByTrip, setRatedDriversByTrip] = useState<Record<string, boolean>>({});
  const [ratingTarget, setRatingTarget] = useState<MyRequestedTrip | null>(null);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  // Etapa 3: calificaciones reales por viaje — las que yo emití y las que
  // recibí (mismo sistema de ratings, solo indexado por viaje para el
  // historial).
  const [myRatingsByTrip, setMyRatingsByTrip] = useState<Record<string, Rating[]>>({});
  const [receivedRatingsByTrip, setReceivedRatingsByTrip] = useState<
    Record<string, ReceivedRating[]>
  >({});
  // Etapa 2: mis confirmaciones de finalización (trip_id -> confirmed_at).
  const [myConfirmations, setMyConfirmations] = useState<Record<string, string>>({});
  const [completionTarget, setCompletionTarget] = useState<CompletionTarget | null>(null);
  const [isConfirmingCompletion, setIsConfirmingCompletion] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;

        if (!user) {
          navigate('/login');
          return;
        }

        // Etapa 2: cierre automático de cortesía (48 h) de los viajes del
        // usuario ANTES de listarlos. Si la migración aún no está aplicada el
        // servicio devuelve 0 y la carga continúa con normalidad.
        try {
          await reapMyTripCompletions();
        } catch (reapError) {
          console.warn('No se pudo aplicar el cierre automático de viajes:', reapError);
        }

        const myTrips = await getTripsByDriver();
        const myRequests = await getTripRequestsForDriver();
        const myRequestedTrips = await getMyRequestedTrips();

        // Calificaciones que el usuario ya emitió (para marcar "Ya calificado")
        let myRatings: Rating[] = [];
        try {
          myRatings = await getMyRatings();
        } catch (ratingError) {
          console.error('Error cargando mis calificaciones:', ratingError);
          myRatings = [];
        }
        if (cancelled) return;

        // Etapa 3: calificaciones RECIBIDAS (con nombre de quién calificó y el
        // viaje), para poder mostrar el rating real de cada viaje del
        // historial. Reutiliza el RPC existente get_user_received_ratings.
        let receivedRatings: ReceivedRating[] = [];
        try {
          receivedRatings = await getUserRatings(user.id, 50);
        } catch (receivedError) {
          console.error('Error cargando las calificaciones recibidas:', receivedError);
          receivedRatings = [];
        }
        if (cancelled) return;

        // Etapa 2: confirmaciones de finalización que YA emití (para no volver
        // a mostrar el botón y para indicarlo en la tarjeta).
        let myConfirmationsByTrip: Record<string, string> = {};
        try {
          myConfirmationsByTrip = await getMyTripCompletionConfirmations();
        } catch (confirmationError) {
          console.warn('No se pudieron cargar tus confirmaciones:', confirmationError);
          myConfirmationsByTrip = {};
        }

        const ratedDriversByTrip: Record<string, boolean> = {};
        const myRatingsByTrip = indexRatingsByTrip(myRatings);
        for (const rating of myRatings) {
          ratedDriversByTrip[rating.trip_id] = true;
        }

        const receivedRatingsByTrip = indexRatingsByTrip(receivedRatings);

        setTrips(myTrips);
        setRequests(myRequests);
        setPassengerTrips(myRequestedTrips);
        setRatedDriversByTrip(ratedDriversByTrip);
        setMyRatingsByTrip(myRatingsByTrip);
        setReceivedRatingsByTrip(receivedRatingsByTrip);
        setMyConfirmations(myConfirmationsByTrip);
        setError(null);
      } catch (err) {
        console.error('Error cargando datos del conductor:', err);
        if (!cancelled) {
          setError('No se pudieron cargar tus viajes. Intenta nuevamente.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleAccept = async (request: TripRequestDetails) => {
    setProcessingRequestId(request.id);
    setNotice(null);

    try {
      await acceptTripRequest(request.id);

      setRequests((prev) =>
        prev.map((r) => (r.id === request.id ? { ...r, status: 'accepted' } : r))
      );
      setTrips((prev) =>
        prev.map((t) =>
          t.id === request.trip_id
            ? { ...t, seats_available: Math.max(0, t.seats_available - 1) }
            : t
        )
      );
      setNotice({
        type: 'success',
        text: `Solicitud de ${request.passenger_name} aceptada. Se asignó un asiento.`,
      });
    } catch (error) {
      console.error('Error al aceptar solicitud:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo aceptar la solicitud. Intenta nuevamente.';
      setNotice({
        type: 'error',
        text: message,
      });
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleReject = async (request: TripRequestDetails) => {
    setProcessingRequestId(request.id);
    setNotice(null);

    try {
      await rejectTripRequest(request.id);

      setRequests((prev) =>
        prev.map((r) => (r.id === request.id ? { ...r, status: 'rejected' } : r))
      );
      setNotice({
        type: 'success',
        text: `Solicitud de ${request.passenger_name} rechazada.`,
      });
    } catch (error) {
      console.error('Error al rechazar solicitud:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo rechazar la solicitud. Intenta nuevamente.';
      setNotice({
        type: 'error',
        text: message,
      });
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleDeleteTrip = async (trip: TripFromDB) => {
    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar el viaje "${trip.origin} → ${trip.destination}"?\nSe eliminarán también las solicitudes asociadas. Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;

    setDeletingTripId(trip.id);
    setNotice(null);

    try {
      await deleteTrip(trip.id);
      setTrips((prev) => prev.filter((t) => t.id !== trip.id));
      setRequests((prev) => prev.filter((r) => r.trip_id !== trip.id));
      setNotice({
        type: 'success',
        text: `Viaje "${trip.origin} → ${trip.destination}" eliminado correctamente.`,
      });
    } catch (error) {
      console.error('Error al eliminar viaje:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo eliminar el viaje. Intenta nuevamente.';
      setNotice({ type: 'error', text: message });
    } finally {
      setDeletingTripId(null);
    }
  };

  const handleCancelRequest = async (request: MyRequestedTrip) => {
    const confirmed = window.confirm(
      `¿Seguro que quieres cancelar tu solicitud para el viaje "${request.origin} → ${request.destination}"?\nEl conductor aún no la ha aceptado.`
    );
    if (!confirmed) return;

    setCancellingRequestId(request.id);
    setNotice(null);

    try {
      await cancelTripRequest(request.id);

      setPassengerTrips((prev) =>
        prev.map((r) => (r.id === request.id ? { ...r, status: 'cancelled' } : r))
      );
      setNotice({
        type: 'success',
        text: 'Tu solicitud fue cancelada correctamente.',
      });
    } catch (error) {
      console.error('Error al cancelar solicitud:', error);
      setNotice({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'No se pudo cancelar la solicitud. Intenta nuevamente.',
      });
    } finally {
      setCancellingRequestId(null);
    }
  };

  const handleSubmitRating = async (userRating: number, comment: string) => {
    if (!ratingTarget) return;

    setIsSubmittingRating(true);
    setRatingError(null);

    try {
      await submitRating({
        tripId: ratingTarget.trip_id,
        ratedId: ratingTarget.driver_id,
        rating: userRating,
        comment,
      });

      setRatedDriversByTrip((prev) => ({
        ...prev,
        [ratingTarget.trip_id]: true,
      }));
      setRatingTarget(null);
      setNotice({
        type: 'success',
        text: '¡Gracias! Tu calificación fue guardada.',
      });

      // Refresca las solicitudes y las calificaciones propias para mostrar el
      // estado real (ya calificado) y el promedio actualizado.
      try {
        const [refreshed, refreshedRatings] = await Promise.all([
          getMyRequestedTrips(),
          getMyRatings(),
        ]);
        setPassengerTrips(refreshed);
        setMyRatingsByTrip(indexRatingsByTrip(refreshedRatings));
        setRatedDriversByTrip((prev) => {
          const next = { ...prev };
          for (const rating of refreshedRatings) {
            next[rating.trip_id] = true;
          }
          return next;
        });
      } catch (refreshError) {
        console.error('Error refrescando solicitudes:', refreshError);
      }
    } catch (error) {
      console.error('Error al calificar:', error);
      setRatingError(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar la calificación. Intenta nuevamente.'
      );
    } finally {
      setIsSubmittingRating(false);
    }
  };

  /**
   * Etapa 2: confirma que el viaje terminó. La validación real (participación,
   * horario, duplicados) la hace la base de datos; aquí solo se refleja el
   * resultado en la interfaz.
   */
  const handleConfirmCompletion = async () => {
    if (!completionTarget) return;

    const { tripId, routeLabel } = completionTarget;
    setIsConfirmingCompletion(true);
    setCompletionError(null);

    try {
      const effectiveStatus = await confirmTripCompletion(tripId);

      // Confirmación propia registrada: el botón ya no debe reaparecer.
      setMyConfirmations((prev) => ({ ...prev, [tripId]: new Date().toISOString() }));

      const storedStatus =
        effectiveStatus === TRIP_STATUS.COMPLETED
          ? TRIP_STATUS.COMPLETED
          : TRIP_STATUS.PENDING_COMPLETION;

      setTrips((prev) =>
        prev.map((trip) => (trip.id === tripId ? { ...trip, status: storedStatus } : trip))
      );
      setPassengerTrips((prev) =>
        prev.map((request) =>
          request.trip_id === tripId ? { ...request, trip_status: storedStatus } : request
        )
      );

      setCompletionTarget(null);
      setNotice({
        type: 'success',
        text:
          effectiveStatus === TRIP_STATUS.COMPLETED
            ? `¡Viaje finalizado! El viaje "${routeLabel}" quedó cerrado con la confirmación de todos los participantes.`
            : `Gracias, registramos tu confirmación del viaje "${routeLabel}". Faltan las confirmaciones de los demás participantes.`,
      });
    } catch (error) {
      console.error('Error al confirmar la finalización del viaje:', error);
      setCompletionError(
        error instanceof Error
          ? error.message
          : 'No se pudo registrar la confirmación. Intenta nuevamente.'
      );
    } finally {
      setIsConfirmingCompletion(false);
    }
  };

  // ============================================================
  // ETAPA 3: filtro activo + grupos «Próximos» / «Historial»
  // ============================================================
  // Todo se deriva de los datos ya cargados (estado efectivo del ciclo de vida
  // de cada viaje): no hay consultas adicionales ni tablas de historial.
  const statusScope = statusScopeOf(view);
  const showDriverSection = view !== 'passenger';
  const showPassengerSection = view !== 'driver';

  // --- Como conductor ---
  const driverScoped = trips
    .map((trip) => ({ trip, lifecycle: driverLifecycleOf(trip) }))
    .filter((entry) => statusScope === 'all' || entry.lifecycle === statusScope)
    .map((entry) => ({
      ...entry,
      group: isTripLifecycleFinished(entry.lifecycle) ? 'history' : 'upcoming',
    }));
  const driverUpcoming = sortByScheduledStart(
    driverScoped.filter((entry) => entry.group === 'upcoming'),
    (entry) => ({ date: entry.trip.date, time: entry.trip.time }),
    'asc'
  );
  const driverHistory = sortByScheduledStart(
    driverScoped.filter((entry) => entry.group === 'history'),
    (entry) => ({ date: entry.trip.date, time: entry.trip.time }),
    'desc'
  );

  // --- Como pasajero ---
  const passengerScoped = passengerTrips
    .map((request) => ({ request, lifecycle: passengerLifecycleOf(request) }))
    .filter((entry) => {
      if (statusScope === 'completed') {
        // «Completados» = viajes en los que sí viajó: una solicitud rechazada o
        // cancelada sobre un viaje completado nunca cuenta como completada.
        return entry.lifecycle === 'completed' && entry.request.status === 'accepted';
      }
      if (statusScope === 'cancelled') {
        return (
          entry.lifecycle === 'cancelled' ||
          entry.request.status === 'rejected' ||
          entry.request.status === 'cancelled'
        );
      }
      return true;
    })
    .map((entry) => ({
      ...entry,
      group: passengerGroupOf(entry.request, entry.lifecycle),
    }));
  const passengerUpcoming = sortByScheduledStart(
    passengerScoped.filter((entry) => entry.group === 'upcoming'),
    (entry) => ({ date: entry.request.date, time: entry.request.time }),
    'asc'
  );
  const passengerHistory = sortByScheduledStart(
    passengerScoped.filter((entry) => entry.group === 'history'),
    (entry) => ({ date: entry.request.date, time: entry.request.time }),
    'desc'
  );

  /** Pasajeros aceptados de un viaje (participantes reales del conductor). */
  const acceptedPassengersOf = (tripId: string) =>
    requests.filter((request) => request.trip_id === tripId && request.status === 'accepted');

  /** Calificación que YO emití a una persona en un viaje (null si no existe). */
  const ratingGivenIn = (tripId: string, ratedId: string): number | null =>
    (myRatingsByTrip[tripId] ?? []).find((rating) => rating.rated_id === ratedId)?.rating ?? null;

  /** ¿Ya califiqué a esta persona en este viaje? (evita ofrecer duplicados) */
  const hasRatedIn = (tripId: string, ratedId: string): boolean =>
    (myRatingsByTrip[tripId] ?? []).some((rating) => rating.rated_id === ratedId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-300 mx-auto mb-4"></div>
          <p className="text-slate-600">Cargando tus viajes...</p>
        </div>
      </div>
    );
  }

  return (
<div className="min-h-screen bg-slate-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeader
            eyebrow="Tu actividad"
            title="Mis viajes"
            description="Tus viajes próximos y tu historial, como conductor y como pasajero."
            action={
              <Link to="/ofrecer-viaje">
                <Button variant="primary">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Publicar viaje
                </Button>
              </Link>
            }
          />

          {/* Filtros: rol (conductor/pasajero) + estado (completados/cancelados) */}
          <div
            className="mb-8 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            role="tablist"
            aria-label="Filtros de mis viajes"
          >
            {TRIPS_VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = option.value === view;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleViewChange(option.value)}
                  className={`inline-flex min-w-[9rem] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>

          {notice && (
            <div
              className={`mb-6 p-4 rounded-lg border ${
                notice.type === 'success'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <p
                className={`text-sm ${
                  notice.type === 'success' ? 'text-green-800' : 'text-red-800'
                }`}
              >
                {notice.text}
              </p>
            </div>
          )}

          {error ? (
            <Card className="p-12 text-center bg-red-50">
              <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                Ocurrió un error
              </h3>
              <p className="text-slate-600 mb-4">{error}</p>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reintentar
              </Button>
            </Card>
          ) : (
            <div className="space-y-12">
              {/* ==================== COMO CONDUCTOR ==================== */}
              {showDriverSection && (
                <section className="space-y-6">
                  <GroupHeading
                    icon={Car}
                    title="Como conductor"
                    description="Viajes que publicaste."
                    count={driverScoped.length}
                  />

                  {driverScoped.length === 0 ? (
                    statusScope === 'all' ? (
                      <EmptyState
                        icon={Calendar}
                        title="Aún no has publicado viajes"
                        description="Publica tu primer viaje a CUCEI para que otros estudiantes puedan solicitarte un lugar."
                        actionLabel="Publicar mi primer viaje"
                        actionTo="/ofrecer-viaje"
                      />
                    ) : (
                      <EmptyState
                        icon={statusScope === 'completed' ? CheckCircle2 : X}
                        title={
                          statusScope === 'completed'
                            ? 'Aún no tienes viajes completados como conductor'
                            : 'No tienes viajes cancelados como conductor'
                        }
                        description={
                          statusScope === 'completed'
                            ? 'Cuando un viaje que publicaste termine y se confirme su finalización, aparecerá aquí en tu historial.'
                            : 'Los viajes cancelados se conservan en tu historial; no se cuentan como viajes completados.'
                        }
                      />
                    )
                  ) : (
                    <>
                      {/* Próximos: futuros, en curso y pendientes de finalizar */}
                      <GroupHeading
                        icon={Calendar}
                        title="Próximos"
                        description="Futuros, en curso y pendientes de finalizar."
                        count={driverUpcoming.length}
                      />
                      {driverUpcoming.length === 0 ? (
                        <GroupEmptyNote>
                          No tienes viajes próximos como conductor con este filtro.
                        </GroupEmptyNote>
                      ) : (
                        <div className="space-y-6">
              {driverUpcoming.map(({ trip, lifecycle }) => {
                const tripRequests = requests.filter((r) => r.trip_id === trip.id);
                const pendingRequests = tripRequests.filter((r) => r.status === 'pending');
                const processedRequests = tripRequests.filter(
                  (r) => r.status === 'accepted' || r.status === 'rejected'
                );

                // Etapa 2: estado del ciclo de vida del viaje + si puedo confirmar
                const myConfirmationAt = myConfirmations[trip.id] ?? null;
                const canConfirmCompletion =
                  canConfirmTripCompletion(lifecycle, myConfirmationAt !== null);
                const isFinished = isTripLifecycleFinished(lifecycle);
                // Aceptar o rechazar solicitudes solo tiene sentido antes de salir.
                const canReviewRequests = lifecycle === 'scheduled';

                return (
                  <Card key={trip.id} className="p-6 sm:p-7 app-animate-fade-up">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        {/* Ruta con jerarquía origen → destino */}
                        <div className="flex items-start gap-3">
                          <div className="mt-1.5 flex flex-col items-center" aria-hidden="true">
                            <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                            <span className="my-1 h-8 w-px bg-slate-200" />
                            <span className="h-2.5 w-2.5 rounded-full border-2 border-slate-900" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold uppercase tracking-[0.1em] text-slate-900">
                              {trip.origin}
                            </p>
                            <p className="mt-6 truncate text-sm font-bold uppercase tracking-[0.1em] text-slate-900">
                              {trip.destination}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-4 w-4 text-slate-400" aria-hidden="true" />
                            {new Date(trip.date).toLocaleDateString('es-MX', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                            {trip.time}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Armchair className="h-4 w-4 text-slate-400" aria-hidden="true" />
                            {trip.seats_available}{' '}
                            {trip.seats_available === 1 ? 'lugar disponible' : 'lugares disponibles'}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${lifecycleBadgeClass[lifecycle]}`}
                          title={TRIP_LIFECYCLE_DESCRIPTIONS[lifecycle]}
                        >
                          {TRIP_LIFECYCLE_LABELS[lifecycle]}
                        </span>
                        <span className="rounded-full border border-teal-500/30 bg-teal-500/15 px-3 py-1 text-xs font-semibold text-teal-800">
                          {pendingRequests.length}{' '}
                          {pendingRequests.length === 1
                            ? 'solicitud pendiente'
                            : 'solicitudes pendientes'}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/mis-viajes/${trip.id}`)}
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" /> Ver viaje
                        </Button>
                        {canConfirmCompletion && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              setCompletionTarget({
                                tripId: trip.id,
                                routeLabel: `${trip.origin} → ${trip.destination}`,
                                role: 'driver',
                              })
                            }
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            Confirmar que terminó
                          </Button>
                        )}
                        {myConfirmationAt && !isFinished && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Confirmaste la finalización
                          </span>
                        )}
                        {isFinished ? (
                          <span className="text-xs text-slate-400">
                            {lifecycle === 'cancelled'
                              ? 'El viaje está cancelado.'
                              : 'El viaje finalizado se conserva en tu historial.'}
                          </span>
                        ) : (
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={deletingTripId === trip.id}
                            onClick={() => handleDeleteTrip(trip)}
                          >
                            {deletingTripId === trip.id ? (
                              'Eliminando...'
                            ) : (
                              <>
                                <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                    {tripRequests.length === 0 ? (
                      <div className="py-6 text-center">
                        <InlineEmptyState
                          compact
                          icon={Mail}
                          title="Aún no recibes solicitudes"
                          description="Cuando un pasajero solicite un lugar en este viaje, verás aquí su solicitud."
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {tripRequests.map((request) => (
                          <div
                            key={request.id}
                            className="border border-slate-200 rounded-lg p-4 bg-slate-50"
                          >
                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <p className="font-semibold text-slate-900">
                                    {request.passenger_name}
                                  </p>
                                  <span
                                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusBadgeClass[request.status]}`}
                                  >
                                    {tripRequestStatusLabel[request.status]}
                                  </span>
                                </div>
                                <p className="flex items-center gap-1.5 text-sm text-slate-600 mb-1">
                                  <Star className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                  {request.passenger_rating > 0
                                    ? `${request.passenger_rating} / 5`
                                    : 'Sin calificaciones todavía'}
                                </p>
                                <Link
                                  to={`/perfil/${request.passenger_id}`}
                                  className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800 mb-1"
                                >
                                  <Eye className="w-4 h-4" aria-hidden="true" /> Ver perfil
                                </Link>

                                {request.pickup_address && (
                                  <p className="flex items-start gap-1.5 text-sm text-slate-600 mb-1">
                                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                                    <span>Recogida: {request.pickup_address}</span>
                                  </p>
                                )}
                                <p className="text-xs text-slate-400">
                                  Solicitado el{' '}
                                  {new Date(request.created_at).toLocaleString('es-MX', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </p>
                              </div>

                              {request.status === 'pending' && canReviewRequests && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={
                                      trip.seats_available <= 0 ||
                                      processingRequestId === request.id
                                    }
                                    onClick={() => handleAccept(request)}
                                  >
                                    {processingRequestId === request.id ? (
                                      'Procesando...'
                                    ) : (
                                      <>
                                        <Check className="w-4 h-4" aria-hidden="true" /> Aceptar
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={processingRequestId === request.id}
                                    onClick={() => handleReject(request)}
                                  >
                                    <X className="w-4 h-4" aria-hidden="true" /> Rechazar
                                  </Button>
                                </div>
                              )}
                            </div>

                            {request.status === 'pending' && canReviewRequests && trip.seats_available <= 0 && (
                              <p className="text-xs text-red-600 mt-1">
                                No quedan asientos disponibles para aceptar esta solicitud.
                              </p>
                            )}
                            {request.status === 'pending' && !canReviewRequests && (
                              <p className="text-xs text-amber-700 mt-1">
                                El viaje ya comenzó: esta solicitud pendiente ya no se puede aceptar.
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {processedRequests.length > 0 && (
                      <p className="text-xs text-slate-400 mt-3">
                        Muestra de solicitudes procesadas: se conservan para referencia.
                      </p>
                    )}
                  </Card>
                );
              })}
                        </div>
                      )}

                      {/* Historial (etapa 3): solo lectura, con calificaciones reales */}
                      <GroupHeading
                        icon={CheckCircle2}
                        title="Historial"
                        description="Viajes completados y cancelados: se conservan como referencia."
                        count={driverHistory.length}
                        tone="history"
                      />
                      {driverHistory.length === 0 ? (
                        <GroupEmptyNote>
                          {statusScope === 'cancelled'
                            ? 'No tienes viajes cancelados como conductor con este filtro.'
                            : 'Aún no hay viajes completados en tu historial como conductor.'}
                        </GroupEmptyNote>
                      ) : (
                        <div className="space-y-6">
                          {driverHistory.map(({ trip, lifecycle }) => (
                            <TripHistoryCard
                              key={trip.id}
                              role="driver"
                              origin={trip.origin}
                              destination={trip.destination}
                              date={trip.date}
                              time={trip.time}
                              status={lifecycle}
                              driverName={null}
                              participants={acceptedPassengersOf(trip.id).map((passenger) => ({
                                id: passenger.passenger_id,
                                name: passenger.passenger_name,
                                ratingGiven: ratingGivenIn(trip.id, passenger.passenger_id),
                              }))}
                              ratingReceived={summarizeReceivedRating(
                                receivedRatingsByTrip[trip.id]
                              )}
                              actions={
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => navigate(`/mis-viajes/${trip.id}`)}
                                  >
                                    <Eye className="h-4 w-4" aria-hidden="true" /> Ver viaje
                                  </Button>
                                  {canRateFinishedTrip(lifecycle) &&
                                    acceptedPassengersOf(trip.id).some(
                                      (passenger) => !hasRatedIn(trip.id, passenger.passenger_id)
                                    ) && (
                                      <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => navigate(`/mis-viajes/${trip.id}`)}
                                      >
                                        <Star className="h-4 w-4" aria-hidden="true" />
                                        Calificar pasajeros
                                      </Button>
                                    )}
                                </>
                              }
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}

              {/* ==================== COMO PASAJERO ==================== */}
              {showPassengerSection && (
                <section className="space-y-6">
                  <GroupHeading
                    icon={Backpack}
                    title="Como pasajero"
                    description="Viajes que solicitaste."
                    count={passengerScoped.length}
                  />

                  {passengerScoped.length === 0 ? (
                    statusScope === 'all' ? (
                      <EmptyState
                        icon={Backpack}
                        title="Aún no has solicitado viajes"
                        description="Cuando solicites un lugar en un viaje desde la búsqueda, aparecerá aquí con su estado."
                        actionLabel="Buscar viajes"
                        actionTo="/buscar-viaje"
                      />
                    ) : (
                      <EmptyState
                        icon={statusScope === 'completed' ? CheckCircle2 : X}
                        title={
                          statusScope === 'completed'
                            ? 'Aún no tienes viajes completados como pasajero'
                            : 'No tienes viajes cancelados como pasajero'
                        }
                        description={
                          statusScope === 'completed'
                            ? 'Cuando viajes como pasajero y el viaje se confirme como finalizado, aparecerá aquí en tu historial.'
                            : 'Las solicitudes rechazadas o canceladas se conservan en tu historial; no se cuentan como viajes completados.'
                        }
                      />
                    )
                  ) : (
                    <>
                      <GroupHeading
                        icon={Calendar}
                        title="Próximos"
                        description="Solicitudes vivas de viajes que aún no terminan."
                        count={passengerUpcoming.length}
                      />
                      {passengerUpcoming.length === 0 ? (
                        <GroupEmptyNote>
                          No tienes viajes próximos como pasajero con este filtro.
                        </GroupEmptyNote>
                      ) : (
                        <div className="space-y-6">
                {passengerUpcoming.map(({ request, lifecycle }) => {
                  const myConfirmationAt = myConfirmations[request.trip_id] ?? null;
                  const canConfirmCompletion =
                    request.status === 'accepted' &&
                    canConfirmTripCompletion(lifecycle, myConfirmationAt !== null);

                  return (
                  <Card key={request.id} className="p-6">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-slate-900">
                          {request.origin} → {request.destination}
                        </h3>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 mt-1">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="w-4 h-4" aria-hidden="true" />
                            {new Date(request.date).toLocaleDateString('es-MX', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="w-4 h-4" aria-hidden="true" />
                            {request.time}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Armchair className="w-4 h-4" aria-hidden="true" />
                            {request.trip_seats_available} asientos
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 mt-1">
                          <span className="inline-flex items-center gap-1.5">
                            <Car className="w-4 h-4" aria-hidden="true" />
                            Conductor: {request.driver_name}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Star className="w-4 h-4" aria-hidden="true" />
                            {request.driver_rating > 0
                              ? `${request.driver_rating} / 5`
                              : 'Sin calificaciones aún'}
                          </span>
                          <Link
                            to={`/perfil/${request.driver_id}`}
                            className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-800"
                          >
                            <Eye className="w-4 h-4" aria-hidden="true" /> Ver perfil
                          </Link>
                        </div>
                        {request.pickup_address && (
                          <p className="text-sm text-slate-600 mt-1 flex items-center gap-1.5">
                            <MapPin className="w-4 h-4" aria-hidden="true" />
                            Recogida: {request.pickup_address}
                          </p>
                        )}
                        {request.status === 'pending' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            disabled={cancellingRequestId === request.id}
                            onClick={() => handleCancelRequest(request)}
                          >
                            {cancellingRequestId === request.id ? (
                              'Cancelando...'
                            ) : (
                              <>
                                <X className="w-4 h-4" aria-hidden="true" />
                                Cancelar solicitud
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <span
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border ${statusBadgeClass[request.status]}`}
                        >
                          {tripRequestStatusLabel[request.status]}
                        </span>
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${lifecycleBadgeClass[lifecycle]}`}
                          title={TRIP_LIFECYCLE_DESCRIPTIONS[lifecycle]}
                        >
                          {TRIP_LIFECYCLE_LABELS[lifecycle]}
                        </span>
                      </div>
                    </div>

                    {request.status === 'accepted' && (
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                        {/* Etapa 2: confirmación de finalización del viaje */}
                        {canConfirmCompletion && (
                          <div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                setCompletionTarget({
                                  tripId: request.trip_id,
                                  routeLabel: `${request.origin} → ${request.destination}`,
                                  role: 'passenger',
                                })
                              }
                            >
                              <Check className="w-4 h-4" aria-hidden="true" />
                              Confirmar que el viaje terminó
                            </Button>
                            <p className="mt-2 text-xs text-slate-500">
                              El viaje se marca como finalizado cuando confirman todos los
                              participantes; si alguien no confirma, se cierra automáticamente 48 h
                              después de su hora de fin.
                            </p>
                          </div>
                        )}
                        {myConfirmationAt && lifecycle === 'pending_completion' && (
                          <p className="inline-flex items-center gap-1.5 text-sm text-green-700">
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            Confirmaste que este viaje terminó. Falta la confirmación del resto de
                            los participantes.
                          </p>
                        )}
                        {isTripLifecycleFinished(lifecycle) && (
                          <p className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            {lifecycle === 'completed'
                              ? 'Este viaje ya está finalizado.'
                              : 'Este viaje fue cancelado.'}
                          </p>
                        )}
                        {canRateFinishedTrip(lifecycle) && request.status === 'accepted' ? (
                          ratedDriversByTrip[request.trip_id] ? (
                            <p className="inline-flex items-center gap-1.5 text-sm text-green-700">
                              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                              Ya calificaste al conductor de este viaje.
                            </p>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setRatingTarget(request)}
                            >
                              <Star className="w-4 h-4" aria-hidden="true" />
                              Calificar al conductor
                            </Button>
                          )
                        ) : (
                          <p className="text-xs text-slate-400">
                            Podrás calificar al conductor cuando el viaje haya terminado.
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                  );
                })}
                        </div>
                      )}

                      {/* Historial como pasajero (etapa 3): solo lectura */}
                      <GroupHeading
                        icon={CheckCircle2}
                        title="Historial"
                        description="Viajes completados y cancelados: se conservan como referencia."
                        count={passengerHistory.length}
                        tone="history"
                      />
                      {passengerHistory.length === 0 ? (
                        <GroupEmptyNote>
                          {statusScope === 'cancelled'
                            ? 'No tienes viajes cancelados como pasajero con este filtro.'
                            : 'Aún no hay viajes completados en tu historial como pasajero.'}
                        </GroupEmptyNote>
                      ) : (
                        <div className="space-y-6">
                          {passengerHistory.map(({ request, lifecycle }) => (
                            <TripHistoryCard
                              key={request.id}
                              role="passenger"
                              origin={request.origin}
                              destination={request.destination}
                              date={request.date}
                              time={request.time}
                              status={lifecycle}
                              driverName={request.driver_name}
                              participants={[
                                {
                                  id: request.driver_id,
                                  name: request.driver_name,
                                  ratingGiven: ratingGivenIn(request.trip_id, request.driver_id),
                                },
                              ]}
                              ratingReceived={summarizeReceivedRating(
                                receivedRatingsByTrip[request.trip_id]
                              )}
                              requestStatusLabel={tripRequestStatusLabel[request.status]}
                              actions={
                                canRateFinishedTrip(lifecycle) &&
                                request.status === 'accepted' ? (
                                  hasRatedIn(request.trip_id, request.driver_id) ? (
                                    <span className="inline-flex items-center gap-1.5 text-sm text-green-700">
                                      <CheckCircle2
                                        className="h-4 w-4 shrink-0"
                                        aria-hidden="true"
                                      />
                                      Ya calificaste al conductor
                                    </span>
                                  ) : (
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={() => setRatingTarget(request)}
                                    >
                                      <Star className="h-4 w-4" aria-hidden="true" />
                                      Calificar al conductor
                                    </Button>
                                  )
                                ) : null
                              }
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      {ratingTarget && (
        <RatingModal
          open
          onClose={() => {
            if (!isSubmittingRating) {
              setRatingTarget(null);
              setRatingError(null);
            }
          }}
          title={`Calificar al conductor · ${ratingTarget.origin} → ${ratingTarget.destination}`}
          ratedPersonName={ratingTarget.driver_name}
          isSubmitting={isSubmittingRating}
          error={ratingError}
          onSubmit={handleSubmitRating}
        />
      )}

      {/* Etapa 2: confirmación de finalización (Modal propio, sin window.confirm) */}
      {completionTarget && (
        <Modal
          open
          onClose={() => {
            if (!isConfirmingCompletion) {
              setCompletionTarget(null);
              setCompletionError(null);
            }
          }}
          title="Confirmar finalización del viaje"
        >
          <div>
            <p className="text-sm text-slate-600">
              {completionTarget.role === 'driver'
                ? 'Como conductor, ¿confirmas que este viaje ya terminó?'
                : 'Como pasajero, ¿confirmas que este viaje ya terminó?'}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {completionTarget.routeLabel}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              El viaje se marca como finalizado cuando confirman todos los participantes
              (conductor y pasajeros aceptados). Si alguien no confirma, se cierra
              automáticamente 48 horas después de su hora de fin.
            </p>

            {completionError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{completionError}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isConfirmingCompletion}
                onClick={() => {
                  setCompletionTarget(null);
                  setCompletionError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isConfirmingCompletion}
                onClick={handleConfirmCompletion}
              >
                {isConfirmingCompletion ? 'Registrando...' : 'Sí, el viaje terminó'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <Footer />
    </div>
  );
};

export default MyTripsPage;