import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  Armchair,
  ArrowLeft,
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  GraduationCap,
  Mail,
  MapPin,
  Star,
  StickyNote,
  Users,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { getCurrentUser } from '../services/authService';
import { getTripsByDriver, isTripOver } from '../services/tripService';
import type { TripFromDB } from '../services/tripService';
import { getTripRequestsForDriver } from '../services/tripRequestService';
import type { TripRequestDetails } from '../services/tripRequestService';
import { getTripRatings, submitRating } from '../services/ratingService';
import RatingModal from '../components/RatingModal';

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

  const loadTripDetail = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        navigate('/login');
        return;
      }

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
      setRatedPassengers(rated);
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando detalle del viaje...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            to="/mis-viajes"
            className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-700 text-sm mb-6"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Volver a Mis Viajes
          </Link>

          {error ? (
            <Card className="p-12 text-center bg-red-50">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Ocurrió un error
              </h3>
              <p className="text-gray-600 mb-4">{error}</p>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reintentar
              </Button>
            </Card>
          ) : trip ? (
            <>
              <Card className="p-6 mb-8">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex-1">
                    <h2 className="text-2xl font-bold text-gray-900 mb-1">
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
                      <span className="inline-flex items-center gap-1.5">
                        <Banknote className="w-4 h-4" aria-hidden="true" />
                        ${trip.price}
                      </span>
                    </div>
                    {trip.notes && (
                      <p className="flex items-start gap-1.5 text-sm text-gray-600 mt-2">
                        <StickyNote className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                        {trip.notes}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                      trip.status === 'active'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-gray-100 text-gray-600 border-gray-200'
                    }`}
                  >
                    {trip.status === 'active' ? 'Activo' : trip.status}
                  </span>
                </div>
              </Card>

              <div className="flex items-center justify-between mb-6">
                <h2 className="flex items-center text-2xl font-bold text-gray-900">
                  <Users className="w-6 h-6 mr-2 shrink-0" aria-hidden="true" />
                  Pasajeros apuntados
                  <span className="ml-2 px-2.5 py-0.5 rounded-full text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {acceptedPassengers.length}
                  </span>
                </h2>
                {pendingCount > 0 && (
                  <p className="text-sm text-gray-500">
                    {pendingCount}{' '}
                    {pendingCount === 1
                      ? 'solicitud pendiente por revisar'
                      : 'solicitudes pendientes por revisar'}
                  </p>
                )}
              </div>

              {acceptedPassengers.length === 0 ? (
                <div className="p-12 text-center bg-gray-50 border border-gray-200 rounded-xl">
                  <Users className="w-12 h-12 mx-auto mb-3 block text-gray-300" aria-hidden="true" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    Aún no hay pasajeros apuntados
                  </h3>
                  <p className="text-sm text-gray-600">
                    Cuando aceptes solicitudes desde Mis Viajes, los pasajeros aparecerán aquí.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {acceptedPassengers.map((passenger) => (
                    <Card key={passenger.id} className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center text-xl font-bold text-indigo-700 flex-shrink-0">
                          {passenger.passenger_name.trim().charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {passenger.passenger_name}
                          </h3>
                          <div className="text-sm text-gray-600 mt-1 space-y-1">
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
                            {passenger.passenger_email && (
                              <p className="flex items-center gap-1.5">
                                <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
                                {passenger.passenger_email}
                              </p>
                            )}
                            {passenger.pickup_address && (
                              <p className="flex items-start gap-1.5">
                                <MapPin className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                                Recogida: {passenger.pickup_address}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {isTripOver(trip) ? (
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
                        <p className="mt-3 text-xs text-gray-400">
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

      <Footer />
    </div>
  );
};

export default TripDetailPage;