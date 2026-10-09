import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField, TextAreaField } from '../components/ui/FormField';
import { FormSection } from '../components/ui/PageBlocks';
import { PageHeader } from '../components/layout/AppShell';
import { getCurrentUser } from '../services/authService';
import { searchAddress, reverseGeocode, type GeocodingResult } from '../services/geocodingService';
import { calculateRoute, formatDistance, formatDuration, type RouteResult } from '../services/routingService';
import type { LineStringGeometry } from '../services/routingService';
import { createTrip, type CreateTripParams } from '../services/tripService';
import { getMyCars } from '../services/carService';
import LocationPickerMap, { type MapPick } from '../components/LocationPickerMap';
import { Car, CheckCircle2, Clock, MapPin, Route as RouteIcon, Ruler, Sparkles, ThumbsUp } from 'lucide-react';

// Coordenadas de CUCEI (Centro Universitario de Ciencias Exactas e Ingenierías)
const CUCEI_COORDS = {
  lat: 20.6586,
  lng: -103.3254,
  address: 'CUCEI - Centro Universitario de Ciencias Exactas e Ingenierías, Blvd. Marcelino García Barragán #1421, Guadalajara, Jalisco, México'
};

/**
 * Acorta la dirección devuelta por Nominatim a una versión legible
 * (calle + número y localidad) en lugar de mostrar toda la cadena de
 * país/estado/historial. Ej: "Av. Revolución 1234, Guadalajara".
 */
const formatAddressForDisplay = (displayName: string): string => {
  const parts = displayName.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 2 ? `${parts[0]}, ${parts[1]}` : parts.join(', ');
};

const OfferTripPage = () => {
  const navigate = useNavigate();
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const [formData, setFormData] = useState({
    origin: '',
    date: '',
    time: '',
    seatsAvailable: '',
    notes: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [hasRegisteredCar, setHasRegisteredCar] = useState(false);

  // Estados para geocodificación y ruta
  const [addressQuery, setAddressQuery] = useState('');
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [addressResults, setAddressResults] = useState<GeocodingResult[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<GeocodingResult | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Selección directa del origen en el mapa (mismo patrón que SearchTripPage)
  const [mapPick, setMapPick] = useState<MapPick | null>(null);
  const [mapPickAddress, setMapPickAddress] = useState<string | null>(null);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  /** Token anti-carrera: invalida respuestas (ruta o dirección) obsoletas. */
  const originActionRef = useRef(0);

  /**
   * Fuente única de verdad para el origen: el punto elegido en el mapa tiene
   * prioridad sobre la dirección buscada por texto. En la práctica nunca están
   * activos a la vez: cada selección limpia a la otra, así no se puede enviar
   * una dirección de un lugar con coordenadas de otro.
   */
  const originPoint = useMemo<MapPick | null>(() => {
    if (mapPick) {
      return mapPick;
    }
    if (selectedOrigin) {
      return { lat: parseFloat(selectedOrigin.lat), lng: parseFloat(selectedOrigin.lon) };
    }
    return null;
  }, [mapPick, selectedOrigin]);

  /**
   * Punto al que el mapa centra la vista: solo para orígenes elegidos por
   * texto. Un clic en el mapa no debe re-centrar (el usuario ya lo vio).
   */
  const focusPoint = useMemo<MapPick | null>(
    () => (mapPick ? null : originPoint),
    [mapPick, originPoint]
  );

  // Verificar autenticación al cargar
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          navigate('/login');
        } else {
          try {
            const userCars = await getMyCars();
            setHasRegisteredCar(userCars.length > 0);
          } catch (carError) {
            console.error('Error cargando autos:', carError);
            setHasRegisteredCar(false);
          }
        }
      } catch (error) {
        console.error('Error checking auth:', error);
        navigate('/login');
      } finally {
        setIsLoadingAuth(false);
      }
    };

    checkAuth();
  }, [navigate]);

  const handleSearchAddress = async () => {
    if (!addressQuery.trim()) {
      setErrors({ origin: 'Ingresa una dirección para buscar' });
      return;
    }

    setIsSearchingAddress(true);
    setErrors({ ...errors, origin: '' });
    setAddressResults([]);
    setSelectedOrigin(null);
    // Una nueva búsqueda por texto invalida cualquier acción de origen anterior
    // y descarta el punto del mapa (consistente con el reset existente).
    originActionRef.current += 1;
    setMapPick(null);
    setMapPickAddress(null);
    setIsReverseGeocoding(false);
    setIsCalculatingRoute(false);
    setRouteResult(null);
    setRouteError(null);

    try {
      const results = await searchAddress(addressQuery);
      setAddressResults(results);
    } catch (error: unknown) {
      console.error('Error searching address:', error);
      const message = error instanceof Error ? error.message : null;
      setErrors({ origin: message || 'No encontramos esa dirección. Intenta escribirla de otra manera.' });
    } finally {
      setIsSearchingAddress(false);
    }
  };

  /**
   * Recalcula la ruta OSRM desde un punto hasta CUCEI. Es exactamente el
   * flujo que ya usaba la selección por texto; ahora también lo utiliza el
   * clic en el mapa. `token` (cuando se pasa) evita que una respuesta vieja
   * sobrescriba la ruta de una selección más reciente.
   */
  const recalculateRoute = async (lat: number, lng: number, token?: number) => {
    const isStale = () => token !== undefined && token !== originActionRef.current;
    setIsCalculatingRoute(true);
    try {
      const route = await calculateRoute(lng, lat, CUCEI_COORDS.lng, CUCEI_COORDS.lat);
      if (!isStale()) {
        setRouteResult(route);
        setRouteError(null);
      }
    } catch (error: unknown) {
      console.error('Error calculating route:', error);
      if (!isStale()) {
        setRouteError('No pudimos calcular una ruta desde esa ubicación hasta CUCEI. Selecciona otra dirección.');
        setRouteResult(null);
      }
    } finally {
      if (!isStale()) {
        setIsCalculatingRoute(false);
      }
    }
  };

  const handleSelectAddress = async (result: GeocodingResult) => {
    const action = ++originActionRef.current;
    setSelectedOrigin(result);
    // La selección por texto sustituye al punto del mapa (fuente única).
    setMapPick(null);
    setMapPickAddress(null);
    setIsReverseGeocoding(false);
    setAddressResults([]);
    setAddressQuery(result.display_name);
    setFormData({ ...formData, origin: result.display_name });
    setRouteError(null);

    // Calcular ruta hacia CUCEI (flujo existente)
    await recalculateRoute(parseFloat(result.lat), parseFloat(result.lon), action);
  };

  /**
   * Selección del origen haciendo clic en el mapa (mismo patrón que en
   * SearchTripPage): guarda el punto, obtiene la dirección legible con
   * reverse geocoding de forma opcional y recalcula la ruta con el flujo
   * existente. La dirección nunca bloquea: si Nominatim no responde quedan
   * las coordenadas del punto.
   */
  const handleMapPick = (pick: MapPick) => {
    const action = ++originActionRef.current;
    setMapPick(pick);
    setMapPickAddress(null);
    // El mapa tiene prioridad: sustituye a la dirección de texto anterior.
    setSelectedOrigin(null);
    setAddressResults([]);
    setAddressQuery('');
    setRouteResult(null);
    setRouteError(null);
    setErrors((prev) => ({ ...prev, origin: '' }));

    // Dirección del punto (opcional): el error se ignora y quedan coordenadas.
    setIsReverseGeocoding(true);
    void (async () => {
      try {
        const address = await reverseGeocode(pick.lat, pick.lng);
        // Si mientras tanto hubo otra acción de origen, ésta queda vieja.
        if (action === originActionRef.current) {
          setMapPickAddress(address);
          setIsReverseGeocoding(false);
        }
      } catch {
        // reverseGeocode nunca lanza; se deja por simetría con SearchTripPage.
        if (action === originActionRef.current) {
          setIsReverseGeocoding(false);
        }
      }
    })();

    void recalculateRoute(pick.lat, pick.lng, action);
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!originPoint) {
      newErrors.origin = 'Selecciona tu punto de salida en el mapa o usa "Buscar dirección"';
    }

    if (!formData.date) {
      newErrors.date = 'La fecha es requerida';
    } else {
      const selectedDate = new Date(formData.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (selectedDate < today) {
        newErrors.date = 'La fecha debe ser hoy o futura';
      }
    }

    if (!formData.time) {
      newErrors.time = 'La hora es requerida';
    }

    if (!formData.seatsAvailable) {
      newErrors.seatsAvailable = 'El número de lugares es requerido';
    } else {
      const seats = parseInt(formData.seatsAvailable);
      if (seats < 1 || seats > 8) {
        newErrors.seatsAvailable = 'Debe ser entre 1 y 8 lugares';
      }
    }

    if (!routeResult) {
      newErrors.route = 'No se ha calculado la ruta correctamente';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    if (!hasRegisteredCar) {
      setErrors({ general: 'Debes registrar un auto antes de ofrecer un viaje.' });
      return;
    }

    if (!originPoint || !routeResult) {
      return;
    }

    setIsSubmitted(true);

    try {
    // Dirección guardada: la del mapa (o su fallback de coordenadas) o la
    // seleccionada por texto; las coordenadas salen de la fuente única
    // originPoint, así nunca se mezclan dos orígenes distintos.
    const coordsFallback = `Lat ${originPoint.lat.toFixed(4)} · Lng ${originPoint.lng.toFixed(4)}`;
    const params: CreateTripParams = {
        origin: mapPick ? (mapPickAddress ?? coordsFallback) : (selectedOrigin?.display_name ?? coordsFallback),
        destination: CUCEI_COORDS.address,
        origin_lat: originPoint.lat,
        origin_lng: originPoint.lng,
        route_distance_km: routeResult.distance / 1000,
        route_duration_minutes: Math.round(routeResult.duration / 60),
        /** Geometría GeoJSON LineString guardada para la fase futura de
          * "viajes cuya ruta pasa cerca". */
        route_geometry: routeResult.geometry as LineStringGeometry,
        date: formData.date,
        time: formData.time,
        seats_available: parseInt(formData.seatsAvailable),
        notes: formData.notes || undefined,
      };

      await createTrip(params);

      // Reset form after successful submission
      setFormData({
        origin: '',
        date: '',
        time: '',
        seatsAvailable: '',
        notes: '',
      });
      setAddressQuery('');
      setSelectedOrigin(null);
      setMapPick(null);
      setMapPickAddress(null);
      setIsReverseGeocoding(false);
      setRouteResult(null);
      setAddressResults([]);

      setTimeout(() => {
        setIsSubmitted(false);
        navigate('/');
      }, 3000);
    } catch (error: unknown) {
      console.error('Error creating trip:', error);
      const message = error instanceof Error ? error.message : null;
      setErrors({ general: message || 'Error al publicar el viaje. Intenta nuevamente.' });
      setIsSubmitted(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-300 mx-auto mb-4"></div>
          <p className="text-slate-600">Verificando autenticación...</p>
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
            eyebrow="Publicar"
            title="Ofrecer viaje"
            description="Comparte tu viaje a CUCEI y ayuda a otros estudiantes."
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Información lateral */}
            <div className="lg:col-span-1">
              <Card className="p-6 mb-6">
                <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-slate-900">
                  <Sparkles className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  Consejos para conductores
                </h3>
                <ul className="space-y-3">
                  {[
                    'Sé específico con los puntos de encuentro',
                    'Mantén tu vehículo limpio y seguro',
                    'Sé puntual y respeta los horarios',
                  ].map((tip) => (
                    <li key={tip} className="flex items-start gap-2 text-sm text-slate-600">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-teal-700"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">{tip}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="p-6 bg-teal-50/60">
                <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
                  <ThumbsUp className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  Beneficios de ofrecer viajes
                </h3>
                <ul className="space-y-2.5">
                  {[
                    'Aprovecha los asientos vacíos de tu auto',
                    'Conoce a otros estudiantes',
                    'Construye tu reputación',
                  ].map((benefit) => (
                    <li key={benefit} className="flex items-start gap-2 text-sm text-slate-600">
                      <CheckCircle2
                        className="mt-0.5 h-4 w-4 shrink-0 text-teal-700"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">{benefit}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* Formulario principal */}
            <div className="lg:col-span-2">
              <Card className="p-8">
                {hasRegisteredCar ? (
                  <>
                <h2 className="text-2xl font-bold text-slate-900 mb-6">Detalles del Viaje</h2>

                {isSubmitted ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
                    <svg className="w-16 h-16 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h3 className="text-xl font-semibold text-green-800 mb-2">¡Viaje Publicado!</h3>
                    <p className="text-green-700 mb-4">
                      Tu viaje ha sido publicado exitosamente. Los estudiantes interesados podrán ver tu viaje y enviar solicitudes.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
                    <FormSection
                      step="01"
                      title="Origen"
                      description="Indica el punto donde sales hacia CUCEI."
                    >
                      <div className="mb-2">
                        <label
                          className="mb-2 block text-sm font-semibold text-slate-700"
                          htmlFor="offer-origin"
                        >
                          ¿Dónde sales?
                        </label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            id="offer-origin"
                            type="text"
                            value={addressQuery}
                            onChange={(e) => setAddressQuery(e.target.value)}
                            placeholder="Ej: Av. Vallarta 1234, Guadalajara, Jalisco"
                            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 transition-colors placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                          />
                          <Button
                            type="button"
                            onClick={handleSearchAddress}
                            disabled={isSearchingAddress || isCalculatingRoute}
                            variant="secondary"
                            className="sm:w-auto"
                          >
                            {isSearchingAddress ? 'Buscando...' : 'Buscar dirección'}
                          </Button>
                        </div>
                        {errors.origin && (
                          <p className="mt-2 text-sm text-red-600">{errors.origin}</p>
                        )}
                      </div>

                      {/* Origen elegido en el mapa: dirección legible vía
                          reverse geocoding; las coordenadas solo aparecen
                          como fallback cuando Nominatim no responde. */}
                      {mapPick && (
                        <div className="mt-4 rounded-xl border border-teal-500/30 bg-teal-50 p-4">
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-700">
                            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                            Punto de salida
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {isReverseGeocoding
                              ? 'Obteniendo dirección...'
                              : mapPickAddress
                                ? formatAddressForDisplay(mapPickAddress)
                                : `Lat ${mapPick.lat.toFixed(4)} · Lng ${mapPick.lng.toFixed(4)}`}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Ubicación seleccionada en el mapa
                          </p>
                        </div>
                      )}
                    </FormSection>

                    {/* Resultados de búsqueda */}
                    {addressResults.length > 0 && (
                      <div className="mt-4 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                        <p className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                          Selecciona una dirección
                        </p>
                        {addressResults.map((result) => (
                          <button
                            key={result.place_id}
                            type="button"
                            onClick={() => handleSelectAddress(result)}
                            className="w-full border-b border-slate-100 px-4 py-3 text-left text-sm text-slate-700 transition-colors last:border-b-0 hover:bg-teal-50/60"
                          >
                            {result.display_name}
                          </button>
                        ))}
                      </div>
                    )}

                    <FormSection
                      step="02"
                      title="Ruta"
                      description="Visualiza tu trayecto hacia CUCEI y su distancia estimada."
                    >
                      <div className="mb-4 h-80 sm:h-96 overflow-hidden rounded-2xl border border-slate-200">
                        <LocationPickerMap
                          centerLat={originPoint?.lat ?? CUCEI_COORDS.lat}
                          centerLng={originPoint?.lng ?? CUCEI_COORDS.lng}
                          zoom={originPoint ? 13 : 12}
                          selected={originPoint}
                          selectedLabel={originPoint ? 'Mi punto de salida' : undefined}
                          focus={focusPoint}
                          onPick={handleMapPick}
                          routeGeometry={routeResult?.geometry ?? null}
                          destination={{ lat: CUCEI_COORDS.lat, lng: CUCEI_COORDS.lng }}
                          style={{ height: '100%', width: '100%' }}
                        />
                      </div>

                      <p className="mb-4 flex items-start gap-1.5 text-xs text-slate-500">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          Haz clic en el mapa para marcar tu punto de salida. También puedes
                          buscar una dirección en el paso anterior.
                        </span>
                      </p>

                      {originPoint ? (
                        <div>
                          {isCalculatingRoute && (
                            <p className="flex items-center gap-2 text-sm text-slate-500">
                              <span className="h-4 w-4 animate-spin rounded-full border-b-2 border-teal-700" />
                              Calculando ruta...
                            </p>
                          )}

                          {routeResult && (
                            <div className="rounded-2xl border border-teal-500/30 bg-teal-50 p-5">
                              <div className="flex flex-wrap items-center justify-around gap-6">
                                <div className="text-center">
                                  <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-teal-700">
                                    <Ruler className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    Distancia
                                  </p>
                                  <p className="mt-1 text-xl font-extrabold text-navy-950">
                                    {formatDistance(routeResult.distance)}
                                  </p>
                                </div>
                                <div className="text-center">
                                  <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-teal-700">
                                    <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                                    Tiempo estimado
                                  </p>
                                  <p className="mt-1 text-xl font-extrabold text-navy-950">
                                    {formatDuration(routeResult.duration)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {routeError && (
                            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                              {routeError}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
                          <RouteIcon className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
                          <p className="mt-2 text-sm font-semibold text-slate-700">
                            Aún no hay ruta que mostrar
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            Selecciona tu punto de salida en el mapa o busca una dirección
                            para trazar el trayecto a CUCEI.
                          </p>
                        </div>
                      )}
                    </FormSection>

                    <FormSection
                      step="03"
                      title="Detalles del viaje"
                      description="Destino, fecha y lugares del viaje."
                    >
                      <div className="mb-6">
                        <label
                          className="mb-2 block text-sm font-semibold text-slate-700"
                          htmlFor="offer-destination"
                        >
                          Destino
                        </label>
                        <input
                          id="offer-destination"
                          type="text"
                          value={CUCEI_COORDS.address}
                          disabled
                          className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-500"
                        />
                        <p className="mt-1.5 text-xs text-slate-500">
                          El destino es siempre CUCEI.
                        </p>
                      </div>

                      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                        <FormField
                          label="Fecha"
                          name="date"
                          type="date"
                          value={formData.date}
                          onChange={handleChange}
                          error={errors.date}
                        />
                        <FormField
                          label="Hora"
                          name="time"
                          type="time"
                          value={formData.time}
                          onChange={handleChange}
                          error={errors.time}
                        />
                      </div>

                      <div className="mb-6">
                        <FormField
                          label="Lugares disponibles"
                          name="seatsAvailable"
                          type="number"
                          min="1"
                          max="8"
                          value={formData.seatsAvailable}
                          onChange={handleChange}
                          error={errors.seatsAvailable}
                          placeholder="Número de pasajeros"
                        />
                      </div>

                      <TextAreaField
                        label="Notas adicionales (opcional)"
                        name="notes"
                        value={formData.notes}
                        onChange={handleChange}
                        placeholder="Información adicional como puntos de encuentro, preferencias, etc."
                        rows={4}
                      />
                    </FormSection>

                    <FormSection
                      step="04"
                      title="Confirmación"
                      description="Revisa los datos y publica tu viaje."
                    >
                      {errors.general && (
                        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                          {errors.general}
                        </div>
                      )}

                      {errors.route && (
                        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                          {errors.route}
                        </div>
                      )}

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        fullWidth
                        disabled={!originPoint || !routeResult || isCalculatingRoute}
                      >
                        Publicar Viaje
                      </Button>
                    </FormSection>
                  </form>
                  )}
                  </>
                ) : (
                  <div className="text-center py-12">
                    <Car className="w-12 h-12 mx-auto mb-4 text-teal-700" aria-hidden="true" />
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                      Necesitas registrar tu auto
                    </h2>
                    <p className="text-slate-600 mb-2">
                      Para ofrecer un viaje debes tener un auto registrado con los datos de tu seguro.
                    </p>
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => navigate('/registrar-auto')}
                    >
                      Registrar mi auto
                    </Button>
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default OfferTripPage;
