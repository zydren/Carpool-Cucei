import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  Armchair,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  GraduationCap,
  MapPin,
  Star,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { InlineEmptyState } from '../components/ui/PageBlocks';
import { getCurrentUser } from '../services/authService';
import {
  getTripsByDriver,
  canRateFinishedTrip,
  getTripLifecycleStatus,
  canConfirmTripCompletion,
  getTripScheduledEnd,
  getTripCompletionDeadline,
  isTripLifecycleFinished,
  TRIP_LIFECYCLE_LABELS,
  TRIP_LIFECYCLE_DESCRIPTIONS,
} from '../services/tripService';
import type { TripFromDB, TripLifecycleStatus } from '../services/tripService';
import { getTripRequestsForDriver } from '../services/tripRequestService';
import type { TripRequestDetails } from '../services/tripRequestService';
import { getTripRatings, submitRating } from '../services/ratingService';
import {
  confirmTripCompletion,
  getTripCompletionSummary,
} from '../services/tripCompletionService';
import type { TripCompletionSummary } from '../services/tripCompletionService';
import TripAttendanceCard from '../components/TripAttendanceCard';
import TripLiveTracking from '../components/TripLiveTracking';
import {
  ensureMyTripAttendanceRequests,
  getMyTripAttendanceRequests,
  hasAttendanceWindowOpened,
} from '../services/tripAttendanceService';
import type {
  TripAttendanceByTrip,
  TripAttendanceResponse,
} from '../services/tripAttendanceService';
import Modal from '../components/ui/Modal';
import RatingModal from '../components/RatingModal';

/** Estilos del estado del viaje (mismo criterio que Mis Viajes). */
const lifecycleBadgeClass: Record<TripLifecycleStatus, string> = {
  scheduled: 'bg-green-50 text-green-700 border-green-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  pending_completion: 'bg-amber-50 text-amber-800 border-amber-200',
  completed: 'bg-slate-100 text-slate-700 border-slate-300',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200',
};

/** Fecha y hora legibles a partir de un instante ISO (zona local del usuario). */
const formatDateTimeLabel = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Detalle de un viaje publicado por el conductor.
 * Muestra quiénes están apuntados (solicitudes ACEPTADAS) y una
 * descripción del perfil de cada pasajero (universidad, calificación,
 * correo y dirección de recogida).
 */
const TripDetailPage = () => {
  const navigate = useNavigate();
  const { tripId } = useParams();

  const [isLoading, setIsLoading] = useState(true);
  const [trip, setTrip] = useState<TripFromDB | null>(null);
  const [acceptedPassengers, setAcceptedPassengers] = useState<TripRequestDetails[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<{
    passengerId: string;
    passengerName: string;
  } | null>(null);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratedPassengers, setRatedPassengers] = useState<Record<string, boolean>>({});
  // Etapa 2: resumen de finalización (estado efectivo + confirmaciones)
  const [completionSummary, setCompletionSummary] = useState<TripCompletionSummary | null>(null);
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState(false);
  const [isConfirmingCompletion, setIsConfirmingCompletion] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  // Confirmación de asistencia (20 min antes): mis filas por viaje.
  const [attendanceByTrip, setAttendanceByTrip] = useState<TripAttendanceByTrip>({});
  // Id del usuario que mira, para saber si es el conductor (seguimiento GPS).
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadTripDetail = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        navigate('/login');
        return;
      }
      setCurrentUserId(user.id);

      if (!tripId) {
        setError('Viaje no encontrado.');
        return;
      }

      const myTrips = await getTripsByDriver();
      const myTrip = myTrips.find((t) => t.id === tripId);

      if (!myTrip) {
        setError('Viaje no encontrado o no tienes permiso para verlo.');
        return;
      }

      const allRequests = await getTripRequestsForDriver();
      const tripRequests = allRequests.filter((r) => r.trip_id === tripId);

      // Calificaciones del viaje para saber a quién ya calificó este conductor
      const ratings = await getTripRatings(tripId);
      const rated: Record<string, boolean> = {};
      for (const rating of ratings) {
        if (rating.rater_id === user.id) {
          rated[rating.rated_id] = true;
        }
      }

      setTrip(myTrip);
      setAcceptedPassengers(
        tripRequests.filter((r) => r.status === 'accepted')
      );
      setPendingCount(
        tripRequests.filter((r) => r.status === 'pending').length
      );
      // Etapa 2: resumen de finalización del viaje. Este RPC aplica además el
      // cierre automático de cortesía (48 h) si ya venció, así que el estado
      // que ve el conductor siempre coincide con el de la base de datos.
      let summary: TripCompletionSummary | null = null;
      try {
        summary = await getTripCompletionSummary(tripId);
      } catch (summaryError) {
        console.warn('No se pudo cargar el estado de finalización del viaje:', summaryError);
      }

      setCompletionSummary(summary);
      setRatedPassengers(rated);
      // Confirmación de asistencia (20 minutos antes): respaldo perezoso del
      // proceso programado + lectura de MIS filas (ya persistidas).
      try {
        await ensureMyTripAttendanceRequests();
        setAttendanceByTrip(await getMyTripAttendanceRequests());
      } catch (attendanceError) {
        console.warn(
          'No se pudo cargar la confirmación de asistencia:',
          attendanceError
        );
      }
      setError(null);
    } catch (err) {
      console.error('Error cargando detalle del viaje:', err);
      setError('No se pudieron cargar los datos del viaje. Intenta nuevamente.');
    } finally {
      setIsLoading(false);
    }
  }, [navigate, tripId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial de datos del viaje (asíncrono)
    loadTripDetail();
  }, [loadTripDetail]);

  const handleSubmitRating = async (userRating: number, comment: string) => {
    if (!ratingTarget || !tripId) return;

    setIsSubmittingRating(true);
    setRatingError(null);

    try {
      await submitRating({
        tripId,
        ratedId: ratingTarget.passengerId,
        rating: userRating,
        comment,
      });

      setRatingTarget(null);
      // Recarga los datos del viaje para reflejar "Ya calificado" y el promedio
      await loadTripDetail();
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

  /** Etapa 2: registra la confirmación del conductor y recarga el detalle. */
  const handleConfirmCompletion = async () => {
    if (!tripId) return;

    setIsConfirmingCompletion(true);
    setCompletionError(null);

    try {
      await confirmTripCompletion(tripId);
      setIsCompletionModalOpen(false);
      // Recarga el detalle: refleja el estado nuevo del viaje y las
      // confirmaciones de los demás participantes.
      await loadTripDetail();
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

  /**
   * Confirmación de asistencia (20 minutos antes): la respuesta ya está
   * guardada en Supabase; aquí solo se refleja en la interfaz. No cambia el
   * estado del viaje ni libera asientos.
   */
  const handleAttendanceResponded = (
    tripId: string,
    response: TripAttendanceResponse
  ) => {
    setAttendanceByTrip((prev) => {
      const current = prev[tripId];
      if (!current) return prev;
      return {
        ...prev,
        [tripId]: { ...current, response, responded_at: new Date().toISOString() },
      };
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-300 mx-auto mb-4"></div>
          <p className="text-slate-600">Cargando detalle del viaje...</p>
        </div>
      </div>
    );
  }

  // Etapa 2: estado del ciclo de vida del viaje y datos de su finalización.
  const lifecycleInput = trip
    ? {
        date: trip.date,
        time: trip.time,
        status: trip.status,
        durationMinutes: trip.route_duration_minutes,
      }
    : null;
  const lifecycle: TripLifecycleStatus | null = lifecycleInput
    ? getTripLifecycleStatus(lifecycleInput)
    : null;
  const scheduledEnd = lifecycleInput ? getTripScheduledEnd(lifecycleInput) : null;
  const completionDeadline = lifecycleInput
    ? getTripCompletionDeadline(lifecycleInput)
    : null;
  const myConfirmedAt = completionSummary?.confirmed_at_by_me ?? null;
  const canConfirmCompletion =
    lifecycle !== null && canConfirmTripCompletion(lifecycle, myConfirmedAt !== null);
  const confirmedCount = completionSummary?.confirmations_count ?? 0;
  const expectedCount = completionSummary?.expected_count ?? 0;

  // Confirmación de asistencia de ESTE viaje: se muestra si ya respondí o si
  // la ventana de 20 minutos está abierta (misma regla que en Mis Viajes).
  const myAttendanceRow = tripId ? (attendanceByTrip[tripId] ?? null) : null;
  const myAttendance =
    myAttendanceRow &&
    trip &&
    (myAttendanceRow.response !== 'pending' ||
      hasAttendanceWindowOpened(trip.date, trip.time))
      ? myAttendanceRow
      : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            to="/mis-viajes"
            className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-700 text-sm mb-6"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Volver a Mis Viajes
          </Link>

          {error ? (
            <Card className="p-12 text-center bg-red-50">
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                Ocurrió un error
              </h3>
              <p className="text-slate-600 mb-4">{error}</p>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reintentar
              </Button>
            </Card>
          ) : trip ? (
            <>
              {lifecycle === 'completed' && (
                <div
                  className="mb-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800"
                  role="status"
                >
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                  ✅ Viaje finalizado — información histórica de solo lectura.
                </div>
              )}
              {lifecycle === 'cancelled' && (
                <div
                  className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600"
                  role="status"
                >
                  <X className="h-5 w-5 shrink-0" aria-hidden="true" />
                  Viaje cancelado — información histórica de solo lectura.
                </div>
              )}
              <Card className="p-6 mb-8">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-slate-900 mb-1">
                      {trip.origin} → {trip.destination}
                    </h2>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" aria-hidden="true" />
                        {new Date(trip.date).toLocaleDateString('es-MX', {
                          weekday: 'short',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-4 h-4" aria-hidden="true" />
                        {trip.time}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Armchair className="w-4 h-4" aria-hidden="true" />
                        {trip.seats_available} asientos
                      </span>
                    </div>
                    {trip.notes && (
                      <p className="flex items-start gap-1.5 text-sm text-slate-600 mt-2">
                        <StickyNote className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                        {trip.notes}
                      </p>
                    )}
                  </div>
                  {lifecycle && (
                    <span
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border ${lifecycleBadgeClass[lifecycle]}`}
                      title={TRIP_LIFECYCLE_DESCRIPTIONS[lifecycle]}
                    >
                      {TRIP_LIFECYCLE_LABELS[lifecycle]}
                    </span>
                  )}
                </div>

                {/* Etapa 2: ciclo de vida y confirmación de finalización */}
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
                    Ciclo de vida del viaje
                  </h3>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Fin programado:{' '}
                      {scheduledEnd
                        ? formatDateTimeLabel(scheduledEnd.toISOString())
                        : 'sin datos de duración'}
                    </span>
                    {completionSummary && (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
                        Confirmaciones: {confirmedCount} de {expectedCount}
                      </span>
                    )}
                  </div>

                  {lifecycle && (
                    <p className="mt-2 text-sm text-slate-600">
                      {TRIP_LIFECYCLE_DESCRIPTIONS[lifecycle]}
                    </p>
                  )}

                  {canConfirmCompletion && (
                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setCompletionError(null);
                          setIsCompletionModalOpen(true);
                        }}
                      >
                        <Check className="w-4 h-4" aria-hidden="true" />
                        Confirmar que el viaje terminó
                      </Button>
                      <p className="mt-2 text-xs text-slate-500">
                        El viaje queda «Finalizado» cuando confirman todos los participantes
                        (conductor y pasajeros aceptados). Si alguien no confirma, se cierra
                        automáticamente{' '}
                        {completionDeadline
                          ? `el ${formatDateTimeLabel(completionDeadline.toISOString())}`
                          : '48 h después de su hora de fin'}
                        .
                      </p>
                    </div>
                  )}

                  {myConfirmedAt && lifecycle === 'pending_completion' && (
                    <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-green-700">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Confirmaste la finalización el {formatDateTimeLabel(myConfirmedAt)}.
                    </p>
                  )}

                  {lifecycle && isTripLifecycleFinished(lifecycle) && (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      ✅ Viaje finalizado: esta es la información histórica del viaje. Ya no admite acciones de un viaje activo.
                    </p>
                  )}

                  {lifecycle && lifecycle === 'cancelled' && (
                    <p className="mt-2 text-xs text-slate-500">El viaje fue cancelado.</p>
                  )}

                  {lifecycle === 'pending_completion' && (
                    <p className="mt-2 text-xs text-amber-700">
                      El viaje ya comenzó: las solicitudes pendientes ya no se pueden aceptar ni
                      rechazar.
                    </p>
                  )}

                  {!completionSummary && (
                    <p className="mt-3 text-xs text-slate-400">
                      La confirmación de finalización todavía no está disponible en este entorno.
                    </p>
                  )}

                  {/* Confirmación de asistencia (20 minutos antes de la salida) */}
                  {trip && (
                    <TripAttendanceCard
                      tripId={trip.id}
                      origin={trip.origin}
                      destination={trip.destination}
                      date={trip.date}
                      time={trip.time}
                      attendance={myAttendance}
                      onResponded={handleAttendanceResponded}
                    />
                  )}

                  {/* Seguimiento GPS compartido: SOLO con el viaje en curso.
                      Compartir exige una acción explícita del usuario (nunca
                      automática) y la base de datos valida participación y
                      estado. No aparece en viajes finalizados ni cancelados. */}
                  {trip && lifecycle === 'in_progress' && (
                    <TripLiveTracking
                      tripId={trip.id}
                      isDriver={trip.driver_id === currentUserId}
                      origin={trip.origin}
                      destination={trip.destination}
                    />
                  )}
                </div>
              </Card>

              <div className="flex items-center justify-between mb-6">
                <h2 className="flex items-center text-2xl font-bold text-slate-900">
                  <Users className="w-6 h-6 mr-2 shrink-0" aria-hidden="true" />
                  Pasajeros apuntados
                  <span className="ml-2 px-2.5 py-0.5 rounded-full text-sm font-medium bg-teal-500/15 text-teal-800 border border-teal-500/30">
                    {acceptedPassengers.length}
                  </span>
                </h2>
                {pendingCount > 0 && (
                  <p className="text-sm text-slate-500">
                    {pendingCount}{' '}
                    {pendingCount === 1
                      ? 'solicitud pendiente por revisar'
                      : 'solicitudes pendientes por revisar'}
                  </p>
                )}
              </div>

              {acceptedPassengers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                  <InlineEmptyState
                    icon={Users}
                    title="Aún no hay pasajeros apuntados"
                    description="Cuando aceptes solicitudes desde Mis Viajes, los pasajeros aparecerán aquí."
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  {acceptedPassengers.map((passenger) => (
                    <Card key={passenger.id} className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-full bg-teal-500/15 flex items-center justify-center text-xl font-bold text-teal-800 flex-shrink-0">
                          {passenger.passenger_name.trim().charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-slate-900">
                            {passenger.passenger_name}
                          </h3>
                          <Link
                            to={`/perfil/${passenger.passenger_id}`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800 mt-0.5"
                          >
                            <Eye className="w-4 h-4" aria-hidden="true" /> Ver perfil
                          </Link>
                          <div className="text-sm text-slate-600 mt-1 space-y-1">
                            <p className="flex items-center gap-1.5">
                              <GraduationCap className="w-4 h-4 shrink-0" aria-hidden="true" />
                              Universidad: {passenger.passenger_university}
                            </p>
                            <p className="flex items-center gap-1.5">
                              <Star className="w-4 h-4 shrink-0" aria-hidden="true" />
                              Calificación:{' '}
                              {passenger.passenger_rating > 0
                                ? `${passenger.passenger_rating} / 5`
                                : 'Sin calificaciones aún'}
                            </p>
                            {passenger.pickup_address && (
                              <p className="flex items-start gap-1.5">
                                <MapPin className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                                Recogida: {passenger.pickup_address}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {lifecycle !== null && canRateFinishedTrip(lifecycle) ? (
                        ratedPassengers[passenger.passenger_id] ? (
                          <p className="mt-3 text-sm text-green-700 inline-flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            Ya calificaste a este pasajero.
                          </p>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            className="mt-3"
                            onClick={() =>
                              setRatingTarget({
                                passengerId: passenger.passenger_id,
                                passengerName: passenger.passenger_name,
                              })
                            }
                          >
                            <Star className="w-4 h-4" aria-hidden="true" />
                            Calificar pasajero
                          </Button>
                        )
                      ) : (
                        <p className="mt-3 text-xs text-slate-400">
                          Podrás calificar a los pasajeros cuando el viaje haya terminado.
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : null}
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
          title="Calificar pasajero"
          ratedPersonName={ratingTarget.passengerName}
          isSubmitting={isSubmittingRating}
          error={ratingError}
          onSubmit={handleSubmitRating}
        />
      )}

      {/* Etapa 2: modal de confirmación de finalización (sin window.confirm) */}
      {isCompletionModalOpen && trip && (
        <Modal
          open
          onClose={() => {
            if (!isConfirmingCompletion) {
              setIsCompletionModalOpen(false);
              setCompletionError(null);
            }
          }}
          title="Confirmar finalización del viaje"
        >
          <div>
            <p className="text-sm text-slate-600">
              ¿Confirmas que el viaje{' '}
              <span className="font-semibold text-slate-900">
                {trip.origin} → {trip.destination}
              </span>{' '}
              ya terminó?
            </p>
            <p className="mt-3 text-xs text-slate-500">
              El viaje queda «Finalizado» cuando confirmamos todos los participantes. Si alguien no
              confirma, se cierra automáticamente{' '}
              {completionDeadline
                ? `el ${formatDateTimeLabel(completionDeadline.toISOString())}`
                : '48 h después de su hora de fin'}
              .
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
                  setIsCompletionModalOpen(false);
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

export default TripDetailPage;