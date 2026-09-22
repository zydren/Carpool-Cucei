import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Armchair,
  Backpack,
  Banknote,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Mail,
  MapPin,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { getCurrentUser } from '../services/authService';
import { getTripsByDriver, deleteTrip, isTripOver } from '../services/tripService';
import type { TripFromDB } from '../services/tripService';
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
import RatingModal from '../components/RatingModal';

const statusBadgeClass: Record<TripRequestStatus, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-50 text-gray-600 border-gray-200',
};

interface Notice {
  type: 'success' | 'error';
  text: string;
}

const MyTripsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link desde la campana de notificaciones (?tab=driver | ?tab=passenger).
  // La pestaña se deriva directamente de la URL (por defecto 'driver') para que
  // los enlaces de las notificaciones abran la vista correcta sin lógica extra.
  const activeTab: 'driver' | 'passenger' =
    searchParams.get('tab') === 'passenger' ? 'passenger' : 'driver';

  const handleTabChange = (tab: 'driver' | 'passenger') => {
    if (tab === activeTab) return;
    setSearchParams(tab === 'passenger' ? { tab } : {});
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

        const ratedDriversByTrip: Record<string, boolean> = {};
        for (const rating of myRatings) {
          ratedDriversByTrip[rating.trip_id] = true;
        }

        setTrips(myTrips);
        setRequests(myRequests);
        setPassengerTrips(myRequestedTrips);
        setRatedDriversByTrip(ratedDriversByTrip);
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

      // Refresca las solicitudes para mostrar la calificación promedio actualizada
      try {
        const refreshed = await getMyRequestedTrips();
        setPassengerTrips(refreshed);
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando tus viajes...</p>
        </div>
      </div>
    );
  }

  return (
<div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-10">
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-2">
                Mis Viajes
              </h1>
              <p className="text-xl text-gray-600">
                Consulta tus viajes como conductor y las solicitudes que enviaste como pasajero.
              </p>
            </div>
            <Link to="/ofrecer-viaje">
              <Button variant="primary" size="lg" className="mt-4 md:mt-0">
                + Publicar viaje
              </Button>
            </Link>
          </div>

          <div className="flex bg-gray-100 rounded-lg p-1 mb-8" role="tablist" aria-label="Vista de mis viajes">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'driver'}
              onClick={() => handleTabChange('driver')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'driver'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Car className="w-4 h-4" aria-hidden="true" />
                Como Conductor
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'passenger'}
              onClick={() => handleTabChange('passenger')}
              className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'passenger'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Backpack className="w-4 h-4" aria-hidden="true" />
                Como Pasajero
              </span>
            </button>
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

          {activeTab === 'driver' && (error ? (
            <Card className="p-12 text-center bg-red-50">
              <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Ocurrió un error
              </h3>
              <p className="text-gray-600 mb-4">{error}</p>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reintentar
              </Button>
            </Card>
          ) : trips.length === 0 ? (
            <Card className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Aún no has publicado viajes
              </h3>
              <p className="text-gray-600 mb-4">
                Publica tu primer viaje a CUCEI para que otros estudiantes puedan solicitarte un lugar.
              </p>
              <Link to="/ofrecer-viaje">
                <Button variant="primary" size="lg">
                  Publicar mi primer viaje
                </Button>
              </Link>
            </Card>
          ) : (
            <div className="space-y-8">
              {trips.map((trip) => {
                const tripRequests = requests.filter((r) => r.trip_id === trip.id);
                const pendingRequests = tripRequests.filter((r) => r.status === 'pending');
                const processedRequests = tripRequests.filter(
                  (r) => r.status === 'accepted' || r.status === 'rejected'
                );

                return (
                  <Card key={trip.id} className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                      <div className="mb-3 md:mb-0">
                        <h2 className="text-xl font-bold text-gray-900 mb-1">
                          {trip.origin} → {trip.destination}
                        </h2>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
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
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                            trip.status === 'active'
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}
                        >
                          {trip.status === 'active' ? 'Activo' : trip.status}
                        </span>
                        <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {pendingRequests.length}{' '}
                          {pendingRequests.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/mis-viajes/${trip.id}`)}
                        >
                          <Eye className="w-4 h-4" aria-hidden="true" /> Ver viaje
                        </Button>
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
                              <Trash2 className="w-4 h-4" aria-hidden="true" /> Eliminar
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
{tripRequests.length === 0 ? (
                      <p className="text-sm text-gray-500 py-2">
                        Aún no recibes solicitudes para este viaje.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {tripRequests.map((request) => (
                          <div
                            key={request.id}
                            className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                          >
                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <p className="font-semibold text-gray-900">
                                    {request.passenger_name}
                                  </p>
                                  <span
                                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusBadgeClass[request.status]}`}
                                  >
                                    {tripRequestStatusLabel[request.status]}
                                  </span>
                                </div>
                                <p className="flex items-center gap-1.5 text-sm text-gray-600 mb-1">
                                  <Star className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                  {request.passenger_rating > 0
                                    ? `${request.passenger_rating} / 5`
                                    : 'Sin calificaciones todavía'}
                                </p>
                                <Link
                                  to={`/perfil/${request.passenger_id}`}
                                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 mb-1"
                                >
                                  <Eye className="w-4 h-4" aria-hidden="true" /> Ver perfil
                                </Link>

                                {request.passenger_email && (
                                  <p className="flex items-center gap-1.5 text-sm text-gray-600 mb-1">
                                    <Mail className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                                    {request.passenger_email}
                                  </p>
                                )}
                                {request.pickup_address && (
                                  <p className="flex items-start gap-1.5 text-sm text-gray-600 mb-1">
                                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                                    <span>Recogida: {request.pickup_address}</span>
                                  </p>
                                )}
                                <p className="text-xs text-gray-400">
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

                              {request.status === 'pending' && (
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

                            {request.status === 'pending' && trip.seats_available <= 0 && (
                              <p className="text-xs text-red-600 mt-1">
                                No quedan asientos disponibles para aceptar esta solicitud.
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {processedRequests.length > 0 && (
                      <p className="text-xs text-gray-400 mt-3">
                        Muestra de solicitudes procesadas: se conservan para referencia.
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          ))}

          {activeTab === 'passenger' && (
            passengerTrips.length === 0 ? (
              <Card className="p-12 text-center">
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Aún no has solicitado viajes
                </h3>
                <p className="text-gray-600 mb-4">
                  Cuando solicites un lugar en un viaje desde la búsqueda, aparecerá aquí con su estado.
                </p>
                <Link to="/buscar-viaje">
                  <Button variant="primary" size="lg">
                    Buscar viajes
                  </Button>
                </Link>
              </Card>
            ) : (
              <div className="space-y-6">
                {passengerTrips.map((request) => (
                  <Card key={request.id} className="p-6">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900">
                          {request.origin} → {request.destination}
                        </h3>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mt-1">
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
                          <span className="inline-flex items-center gap-1.5">
                            <Banknote className="w-4 h-4" aria-hidden="true" />${request.price}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 mt-1">
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
                            className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            <Eye className="w-4 h-4" aria-hidden="true" /> Ver perfil
                          </Link>
                        </div>
                        {request.pickup_address && (
                          <p className="text-sm text-gray-600 mt-1 flex items-center gap-1.5">
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
                      <span
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border ${statusBadgeClass[request.status]}`}
                      >
                        {tripRequestStatusLabel[request.status]}
                      </span>
                    </div>

                    {request.status === 'accepted' && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        {isTripOver(request) ? (
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
                          <p className="text-xs text-gray-400">
                            Podrás calificar al conductor cuando el viaje haya terminado.
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )
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

      <Footer />
    </div>
  );
};

export default MyTripsPage;