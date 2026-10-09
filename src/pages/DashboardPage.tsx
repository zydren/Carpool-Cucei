import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Armchair,
  BarChart3,
  BellRing,
  Calendar,
  CalendarCheck,
  Car,
  Clock,
  GraduationCap,
  Mail,
  MapPin,
  Search,
  Star,
  UserRound,
} from 'lucide-react';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StarRating from '../components/ui/StarRating';
import {
  Alert,
  InlineEmptyState,
  SectionHeader,
  StatCard,
} from '../components/ui/PageBlocks';
import { getCurrentUser } from '../services/authService';
import { getMyProfile, getUserTripStats } from '../services/profileService';
import type { FullProfile, UserTripStats } from '../services/profileService';
import { getTripsByDriver, isTripOver } from '../services/tripService';
import type { TripFromDB } from '../services/tripService';
import {
  getMyRequestedTrips,
  getTripRequestsForDriver,
  tripRequestStatusLabel,
} from '../services/tripRequestService';
import type {
  MyRequestedTrip,
  TripRequestDetails,
  TripRequestStatus,
} from '../services/tripRequestService';
import {
  formatNotificationDate,
  getMyNotifications,
  getUnreadNotificationsCount,
  notificationTargetPath,
} from '../services/notificationService';
import type { AppNotification } from '../services/notificationService';
import { getShortDisplayName } from '../utils/displayName';
import { formatRating, initialOf } from '../utils/profileFormat';
import {
  formatTripDayLabel,
  formatTripTimeLabel,
  greetingForHour,
  parseTripDateTime,
} from '../utils/dateTime';

/** Máximo de notificaciones que se leen para el resumen (no todas). */
const NOTIFICATIONS_LIMIT = 10;

/** Máximo de viajes que se listan en "Actividad reciente". */
const ACTIVITY_LIMIT = 5;

type DashboardRole = 'driver' | 'passenger';
type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Estilos de las etiquetas de estado (misma paleta que "Mis viajes"). */
const toneClass: Record<StatusTone, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  neutral: 'bg-slate-50 text-slate-600 border-slate-200',
};

/** Estado de un viaje publicado (columna trips.status). */
const tripStatusTone: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: 'Activo', tone: 'success' },
  completed: { label: 'Completado', tone: 'neutral' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
};

/** Estado de una solicitud como pasajero (reutiliza las etiquetas del servicio). */
const requestStatusTone: Record<TripRequestStatus, StatusTone> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** Texto del cupo disponible de un viaje. */
const describeSeats = (count: number): string =>
  count === 1 ? '1 lugar disponible' : `${count} lugares disponibles`;

interface TripSchedule {
  date: string;
  time: string;
}

/** Valor numérico de la fecha/hora de un viaje; `null` si no es válida. */
const tripDateTimeValue = (trip: TripSchedule): number | null =>
  parseTripDateTime(trip.date, trip.time)?.getTime() ?? null;

/** Compara dos viajes por fecha/hora: el más próximo/antiguo primero. */
const byTripDateAsc = (a: TripSchedule, b: TripSchedule): number => {
  const valueA = tripDateTimeValue(a);
  const valueB = tripDateTimeValue(b);
  if (valueA === null && valueB === null) return 0;
  if (valueA === null) return 1;
  if (valueB === null) return -1;
  return valueA - valueB;
};

/** Compara dos viajes por fecha/hora: el más reciente primero. */
const byTripDateDesc = (a: TripSchedule, b: TripSchedule): number =>
  byTripDateAsc(b, a);
/**
 * Dashboard principal del usuario autenticado (`/`).
 *
 * Reutiliza únicamente consultas y servicios ya existentes:
 * - profileService: getMyProfile (perfil propio) y getUserTripStats (RPC real).
 * - tripService: getTripsByDriver (viajes publicados) e isTripOver.
 * - tripRequestService: getTripRequestsForDriver y getMyRequestedTrips.
 * - notificationService: contador y lista de notificaciones sin leer.
 *
 * No crea tablas, columnas, RPCs ni servicios nuevos, y no modifica la lógica
 * de autenticación, búsqueda, solicitudes, calificaciones ni notificaciones.
 * Si una consulta falla, el resto del Dashboard sigue siendo utilizable.
 */
const DashboardPage = () => {
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [hasPartialError, setHasPartialError] = useState(false);
  const [greeting, setGreeting] = useState('Hola');
  const [authFallback, setAuthFallback] = useState<{ fullName: string; email: string }>({
    fullName: '',
    email: '',
  });
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [stats, setStats] = useState<UserTripStats>({ offeredTrips: 0, passengerTrips: 0, completedTrips: 0 });
  const [driverTrips, setDriverTrips] = useState<TripFromDB[]>([]);
  const [driverRequests, setDriverRequests] = useState<TripRequestDetails[]>([]);
  const [passengerRequests, setPassengerRequests] = useState<MyRequestedTrip[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasPartialError(false);
    setGreeting(greetingForHour());

    let user;
    try {
      user = await getCurrentUser();
    } catch (error) {
      console.error('[Dashboard] No se pudo comprobar la sesión:', error);
      navigate('/login');
      return;
    }

    if (!user) {
      navigate('/login');
      return;
    }

    // Nombre de respaldo (metadatos de Auth) por si el perfil no se puede leer.
    setAuthFallback({
      fullName: (user.user_metadata?.full_name as string | undefined) ?? '',
      email: user.email ?? '',
    });

    // Consultas en paralelo: cada fallo se aísla para no romper todo el panel.
    const results = await Promise.allSettled([
      getMyProfile(),
      getUserTripStats(user.id),
      getTripsByDriver(),
      getTripRequestsForDriver(),
      getMyRequestedTrips(),
      getUnreadNotificationsCount(),
      getMyNotifications(NOTIFICATIONS_LIMIT),
    ]);

    let failed = false;

    const unwrap = <T,>(result: PromiseSettledResult<T>, fallback: T, label: string): T => {
      if (result.status === 'fulfilled') return result.value;
      failed = true;
      console.error(`[Dashboard] No se pudo cargar ${label}:`, result.reason);
      return fallback;
    };

    setProfile(unwrap<FullProfile | null>(results[0], null, 'el perfil'));
    setStats(
      unwrap<UserTripStats>(
        results[1],
        { offeredTrips: 0, passengerTrips: 0, completedTrips: 0 },
        'el resumen de viajes'
      )
    );
    setDriverTrips(unwrap<TripFromDB[]>(results[2], [], 'los viajes publicados'));
    setDriverRequests(unwrap<TripRequestDetails[]>(results[3], [], 'las solicitudes recibidas'));
    setPassengerRequests(unwrap<MyRequestedTrip[]>(results[4], [], 'las solicitudes enviadas'));
    setUnreadCount(unwrap<number>(results[5], 0, 'las notificaciones sin leer'));
    setUnreadNotifications(
      unwrap<AppNotification[]>(results[6], [], 'la lista de notificaciones').filter(
        (notification) => !notification.read
      )
    );

    setHasPartialError(failed);
    setIsLoading(false);
  }, [navigate]);

  // Fetch inicial diferido (evita el setState síncrono dentro del efecto).
  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  /** Solicitudes recibidas como conductor que siguen pendientes de respuesta. */
  const pendingRequests = useMemo(
    () => driverRequests.filter((request) => request.status === 'pending'),
    [driverRequests]
  );


/** Próximo viaje relevante para el usuario (conductor o pasajero). */
interface NextTrip {
  key: string;
  role: DashboardRole;
  origin: string;
  destination: string;
  date: string;
  time: string;
  seatsAvailable: number;
  /** Nombre del conductor solo cuando el usuario viaja como pasajero. */
  driverName: string | null;
  /** Ruta interna con el detalle del viaje. */
  to: string;
  actionLabel: string;
}

/** Elemento de la lista "Actividad reciente". */
interface ActivityItem {
  key: string;
  role: DashboardRole;
  origin: string;
  destination: string;
  date: string;
  time: string;
  meta: string;
  /** Calificación del conductor (solo en viajes como pasajero). */
  rating: number | null;
  statusLabel: string;
  statusTone: StatusTone;
  to: string;
}

  /** Próximo viaje del usuario, ya sea como conductor o como pasajero. */
  const nextTrip = useMemo<NextTrip | null>(() => {
    const nextAsDriver = driverTrips
      .filter((trip) => trip.status === 'active' && !isTripOver(trip))
      .sort(byTripDateAsc)[0];

    const nextAsPassenger = passengerRequests
      .filter((request) => request.status === 'accepted' && !isTripOver(request))
      .sort(byTripDateAsc)[0];

    const candidates: NextTrip[] = [];

    if (nextAsDriver) {
      candidates.push({
        key: `driver-${nextAsDriver.id}`,
        role: 'driver',
        origin: nextAsDriver.origin,
        destination: nextAsDriver.destination,
        date: nextAsDriver.date,
        time: nextAsDriver.time,
        seatsAvailable: nextAsDriver.seats_available,
        driverName: null,
        to: `/mis-viajes/${nextAsDriver.id}`,
        actionLabel: 'Ver viaje',
      });
    }

    if (nextAsPassenger) {
      candidates.push({
        key: `passenger-${nextAsPassenger.id}`,
        role: 'passenger',
        origin: nextAsPassenger.origin,
        destination: nextAsPassenger.destination,
        date: nextAsPassenger.date,
        time: nextAsPassenger.time,
        seatsAvailable: nextAsPassenger.trip_seats_available,
        driverName: nextAsPassenger.driver_name,
        to: '/mis-viajes?tab=passenger',
        actionLabel: 'Ver en Mis viajes',
      });
    }

    if (candidates.length === 0) return null;
    return candidates.sort(byTripDateAsc)[0];
  }, [driverTrips, passengerRequests]);

  /** Viajes recientes (conductor + pasajero) del más nuevo al más antiguo. */
  const activity = useMemo<ActivityItem[]>(() => {
    const driverItems: ActivityItem[] = driverTrips.map((trip) => {
      const status = tripStatusTone[trip.status];
      return {
        key: `driver-${trip.id}`,
        role: 'driver',
        origin: trip.origin,
        destination: trip.destination,
        date: trip.date,
        time: trip.time,
        meta: describeSeats(trip.seats_available),
        rating: null,
        statusLabel: status ? status.label : trip.status,
        statusTone: status ? status.tone : 'neutral',
        to: `/mis-viajes/${trip.id}`,
      };
    });

    const passengerItems: ActivityItem[] = passengerRequests.map((request) => ({
      key: `passenger-${request.id}`,
      role: 'passenger',
      origin: request.origin,
      destination: request.destination,
      date: request.date,
      time: request.time,
      meta: `Conductor: ${request.driver_name}`,
      rating: request.driver_rating > 0 ? request.driver_rating : null,
      statusLabel: tripRequestStatusLabel[request.status],
      statusTone: requestStatusTone[request.status],
      to: '/mis-viajes?tab=passenger',
    }));

    return [...driverItems, ...passengerItems].sort(byTripDateDesc).slice(0, ACTIVITY_LIMIT);
  }, [driverTrips, passengerRequests]);

  /** Destino del botón "Ver notificaciones": donde apunta la más reciente. */
  const notificationsTarget = unreadNotifications[0]
    ? notificationTargetPath[unreadNotifications[0].type]
    : '/mis-viajes';

  const displayName = getShortDisplayName(
    profile?.full_name ?? authFallback.fullName,
    authFallback.email
  );
  const university = profile?.university ?? null;
  const rating = profile?.rating ?? 0;
  const totalRatings = profile?.total_ratings ?? 0;

  /** Solicitudes pendientes del viaje que se muestra como "próximo viaje". */
  const pendingRequestsForNextTrip =
    nextTrip && nextTrip.role === 'driver'
      ? pendingRequests.filter(
          (request) => request.trip_id === nextTrip.key.slice('driver-'.length)
        ).length
      : 0;


  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main className="pt-24 pb-16">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <DashboardSkeleton />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="pt-24 pb-16">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Panel principal"
            title={`${greeting}, ${displayName} 👋`}
            description="Esto es lo que está pasando con tus viajes."
          />

          {hasPartialError && (
            <div className="mt-6">
              <Alert type="warning">
                No pudimos cargar toda tu información. Puedes seguir buscando u ofreciendo viajes y
                volver a cargar la página para intentarlo de nuevo.
              </Alert>
            </div>
          )}

          {/* Acciones principales */}
          <section
            aria-label="Acciones principales"
            className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6"
          >
            <Link
              to="/buscar-viaje"
              className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              <Card hover className="h-full p-6 app-animate-fade-up">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <Search className="h-6 w-6" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-lg font-bold text-slate-900">Buscar un viaje</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  Encuentra lugares disponibles hacia CUCEI por ruta, ubicación o fecha.
                </p>
                <p className="mt-4 text-sm font-semibold text-teal-700">
                  Ver viajes disponibles <span aria-hidden="true">→</span>
                </p>
              </Card>
            </Link>

            <Link
              to="/ofrecer-viaje"
              className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              <Card hover className="h-full p-6 app-animate-fade-up">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500 text-slate-950">
                  <Car className="h-6 w-6" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-lg font-bold text-slate-900">Ofrecer un viaje</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  Publica tu ruta, define tus cupos y comparte el trayecto con otros estudiantes.
                </p>
                <p className="mt-4 text-sm font-semibold text-teal-700">
                  Publicar mi ruta <span aria-hidden="true">→</span>
                </p>
              </Card>
            </Link>
          </section>

          {/* Acceso a la analítica de movilidad (módulo de minería de datos) */}
          <Link
            to="/analitica"
            className="mt-6 block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
          >
            <Card hover className="flex items-center justify-between gap-4 p-6 app-animate-fade-up">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-slate-950">
                  <BarChart3 className="h-6 w-6" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-900">Analítica de movilidad</h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Estadísticas de los viajes registrados: patrones, distancias y zonas de origen.
                  </p>
                </div>
              </div>
              <span className="hidden shrink-0 text-sm font-semibold text-teal-700 sm:block">
                Ver análisis <span aria-hidden="true">→</span>
              </span>
            </Card>
          </Link>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">

              {/* Próximo viaje */}
              <Card className="p-6 sm:p-7 app-animate-fade-up">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-slate-900">Tu próximo viaje</h2>
                  {nextTrip && (
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                        nextTrip.role === 'driver'
                          ? 'border-teal-500/30 bg-teal-500/15 text-teal-800'
                          : 'border-slate-200 bg-slate-100 text-slate-700'
                      }`}
                    >
                      {nextTrip.role === 'driver' ? 'Como conductor' : 'Como pasajero'}
                    </span>
                  )}
                </div>

                {!nextTrip ? (
                  <div className="py-6 text-center">
                    <InlineEmptyState
                      icon={CalendarCheck}
                      title="No tienes viajes próximos"
                      description="Cuando publiques un viaje o te acepten una solicitud, aparecerá aquí con su fecha y hora."
                      actionLabel="Buscar un viaje"
                      actionTo="/buscar-viaje"
                    />
                  </div>
                ) : (
                  <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      {/* Ruta con jerarquía origen → destino */}
                      <div className="flex items-start gap-3">
                        <div className="mt-1 flex flex-col items-center" aria-hidden="true">
                          <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
                          <span className="my-1 h-10 w-px bg-slate-200" />
                          <span className="h-2.5 w-2.5 rounded-full border-2 border-slate-900" />
                        </div>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-base font-bold text-slate-900">
                            <MapPin className="h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
                            <span className="truncate">{nextTrip.origin}</span>
                          </p>
                          <p className="mt-7 flex items-center gap-2 text-base font-bold text-slate-900">
                            <GraduationCap
                              className="h-4 w-4 shrink-0 text-teal-700"
                              aria-hidden="true"
                            />
                            <span className="truncate">{nextTrip.destination}</span>
                          </p>
                        </div>
                      </div>

                      <p className="mt-5 text-base font-semibold text-slate-900">
                        {[formatTripDayLabel(nextTrip.date), formatTripTimeLabel(nextTrip.time)]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                          <Armchair className="h-3.5 w-3.5" aria-hidden="true" />
                          {describeSeats(nextTrip.seatsAvailable)}
                        </span>
                        <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-green-700">
                          {nextTrip.role === 'driver' ? 'Activo' : 'Confirmado'}
                        </span>
                      </div>

                      {nextTrip.role === 'passenger' && nextTrip.driverName && (
                        <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600">
                          <Car className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                          <span className="truncate">Viaje con {nextTrip.driverName}</span>
                        </p>
                      )}

                      {pendingRequestsForNextTrip > 0 && (
                        <p className="mt-3 text-sm font-medium text-teal-800">
                          {pendingRequestsForNextTrip === 1
                            ? 'Tienes 1 solicitud pendiente en este viaje.'
                            : `Tienes ${pendingRequestsForNextTrip} solicitudes pendientes en este viaje.`}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">
                      <Button variant="primary" onClick={() => navigate(nextTrip.to)}>
                        {nextTrip.actionLabel}
                      </Button>
                    </div>
                  </div>
                )}
              </Card>


              {/* Actividad reciente */}
              <Card className="p-6 sm:p-7 app-animate-fade-up">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-bold text-slate-900">Actividad reciente</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start sm:self-auto"
                    onClick={() => navigate('/mis-viajes')}
                  >
                    <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                    Ver todos mis viajes
                  </Button>
                </div>

                {activity.length === 0 ? (
                  <div className="py-6 text-center">
                    <InlineEmptyState
                      icon={Car}
                      title="Todavía no tienes viajes"
                      description="Cuando publiques un viaje o solicites un lugar, aquí verás tu actividad con su estado."
                      actionLabel="Ofrecer mi primer viaje"
                      actionTo="/ofrecer-viaje"
                    />
                  </div>
                ) : (
                  <ul className="mt-3 -mx-2 divide-y divide-slate-100">
                    {activity.map((item) => (
                      <li key={item.key}>
                        <Link
                          to={item.to}
                          className="flex flex-col gap-2 rounded-xl px-2 py-4 transition-colors duration-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-slate-900">
                                {item.origin} <span aria-hidden="true">→</span> {item.destination}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                                  item.role === 'driver'
                                    ? 'border-slate-200 bg-slate-100 text-slate-700'
                                    : 'border-teal-500/30 bg-teal-500/15 text-teal-800'
                                }`}
                              >
                                {item.role === 'driver' ? 'Conductor' : 'Pasajero'}
                              </span>
                              <span
                                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${toneClass[item.statusTone]}`}
                              >
                                {item.statusLabel}
                              </span>
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span className="inline-flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                                {formatTripDayLabel(item.date) || 'Fecha por confirmar'}
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                {formatTripTimeLabel(item.time)}
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                                {item.meta}
                              </span>
                              {item.rating !== null && (
                                <span className="inline-flex items-center gap-1.5">
                                  <Star className="h-3.5 w-3.5" aria-hidden="true" />
                                  {formatRating(item.rating)}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-teal-700">
                            Ver detalle <span aria-hidden="true">→</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* Columna lateral: resumen, pendientes, perfil y notificaciones */}
            <div className="space-y-6">

              {/* Resumen de viajes y reputación */}
              <Card className="p-6 app-animate-fade-up">
                <h2 className="text-lg font-bold text-slate-900">Tu resumen</h2>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <StatCard
                    label="Viajes como conductor"
                    value={String(stats.offeredTrips)}
                    sub="Publicados por ti"
                  />
                  <StatCard
                    label="Viajes como pasajero"
                    value={String(stats.passengerTrips)}
                    sub="Solicitudes aceptadas"
                  />
                  <StatCard
                    label="Calificación"
                    value={totalRatings > 0 ? `⭐ ${formatRating(rating)}` : 'Sin evaluar'}
                    sub={
                      totalRatings > 0
                        ? `${totalRatings} ${totalRatings === 1 ? 'evaluación' : 'evaluaciones'}`
                        : 'Aún no tienes evaluaciones'
                    }
                  />
                </div>
              </Card>

              {/* Solicitudes pendientes del conductor */}
              {pendingRequests.length > 0 && (
                <Card className="p-6 app-animate-fade-up">
                  <h2 className="flex items-start gap-2 text-base font-bold text-slate-900">
                    <Mail className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
                    <span>
                      {pendingRequests.length === 1
                        ? '1 solicitud pendiente'
                        : `${pendingRequests.length} solicitudes pendientes`}
                    </span>
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Hay pasajeros esperando tu respuesta en tus viajes publicados.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    className="mt-4"
                    onClick={() => navigate('/mis-viajes?tab=driver')}
                  >
                    Revisar solicitudes
                  </Button>
                </Card>
              )}

              {/* Perfil y reputación */}
              <Card className="p-6 app-animate-fade-up">
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-xl font-extrabold text-white"
                    aria-hidden="true"
                  >
                    {initialOf(displayName)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-extrabold text-slate-900">
                      {displayName}
                    </p>
                    {university && (
                      <p className="flex items-center gap-1.5 text-sm text-slate-500">
                        <GraduationCap
                          className="h-4 w-4 shrink-0 text-teal-700"
                          aria-hidden="true"
                        />
                        <span className="truncate">{university}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {totalRatings > 0 ? (
                    <>
                      <StarRating value={Math.round(rating)} readOnly size="sm" />
                      <span className="text-sm font-semibold text-slate-700">
                        {formatRating(rating)} · {totalRatings}{' '}
                        {totalRatings === 1 ? 'evaluación' : 'evaluaciones'}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-slate-500">Sin evaluaciones todavía</span>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  fullWidth
                  className="mt-4"
                  onClick={() => navigate('/perfil')}
                >
                  Ver mi perfil
                </Button>
              </Card>


              {/* Notificaciones sin leer (el sistema existente no se modifica) */}
              {unreadCount > 0 && (
                <Card className="p-6 app-animate-fade-up">
                  <h2 className="flex items-start gap-2 text-base font-bold text-slate-900">
                    <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
                    <span>
                      {unreadCount === 1
                        ? '1 notificación pendiente'
                        : `${unreadCount} notificaciones pendientes`}
                    </span>
                  </h2>

                  {unreadNotifications.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {unreadNotifications.slice(0, 2).map((notification) => (
                        <li
                          key={notification.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <p className="text-sm font-semibold text-slate-900">
                            {notification.title}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                            {notification.message}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {formatNotificationDate(notification.created_at)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    className="mt-4"
                    onClick={() => navigate(notificationsTarget)}
                  >
                    Ver notificaciones
                  </Button>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

/** Bloque de carga (skeleton) coherente con las tarjetas del Dashboard. */
const SkeletonBlock = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} aria-hidden="true" />
);

/** Estado de carga general: evita mostrar una pantalla vacía. */
const DashboardSkeleton = () => (
  <div role="status" aria-live="polite">
    <span className="sr-only">Cargando tu panel principal…</span>

    <div className="flex flex-col gap-3">
      <SkeletonBlock className="h-4 w-28 rounded-full" />
      <SkeletonBlock className="h-9 w-72 max-w-full" />
      <SkeletonBlock className="h-4 w-64 max-w-full rounded-full" />
    </div>

    <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
      <SkeletonBlock className="h-40" />
      <SkeletonBlock className="h-40" />
    </div>

    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-56" />
      </div>
      <div className="space-y-6">
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-56" />
      </div>
    </div>
  </div>
);

export default DashboardPage;

