import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField, TextAreaField } from '../components/ui/FormField';
import { getCurrentUser } from '../services/authService';
import { searchAddress, type GeocodingResult } from '../services/geocodingService';
import { calculateRoute, formatDistance, formatDuration, type RouteResult } from '../services/routingService';
import { createTrip, type CreateTripParams } from '../services/tripService';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Coordenadas de CUCEI (Centro Universitario de Ciencias Exactas e Ingenierías)
const CUCEI_COORDS = {
  lat: 20.6586,
  lng: -103.3254,
  address: 'CUCEI - Centro Universitario de Ciencias Exactas e Ingenierías, Blvd. Marcelino García Barragán #1421, Guadalajara, Jalisco, México'
};

// Icono personalizado para marcadores
const createIcon = (color: string) => L.divIcon({
  className: 'custom-marker',
  html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const originIcon = createIcon('#4F46E5'); // Indigo
const destinationIcon = createIcon('#10B981'); // Green

// Componente para ajustar el mapa a los bounds
const MapBounds = ({ bounds }: { bounds: L.LatLngBounds }) => {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [bounds, map]);
  return null;
};

const OfferTripPage = () => {
  const navigate = useNavigate();
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const [formData, setFormData] = useState({
    origin: '',
    date: '',
    time: '',
    seatsAvailable: '',
    price: '',
    notes: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Estados para geocodificación y ruta
  const [addressQuery, setAddressQuery] = useState('');
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [addressResults, setAddressResults] = useState<GeocodingResult[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<GeocodingResult | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Verificar autenticación al cargar
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          navigate('/login');
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
    setRouteResult(null);
    setRouteError(null);

    try {
      const results = await searchAddress(addressQuery);
      setAddressResults(results);
    } catch (error: any) {
      console.error('Error searching address:', error);
      setErrors({ origin: error.message || 'No encontramos esa dirección. Intenta escribirla de otra manera.' });
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleSelectAddress = async (result: GeocodingResult) => {
    setSelectedOrigin(result);
    setAddressResults([]);
    setAddressQuery(result.display_name);
    setFormData({ ...formData, origin: result.display_name });
    setRouteError(null);

    // Calcular ruta hacia CUCEI
    setIsCalculatingRoute(true);
    try {
      const route = await calculateRoute(
        parseFloat(result.lon),
        parseFloat(result.lat),
        CUCEI_COORDS.lng,
        CUCEI_COORDS.lat
      );
      setRouteResult(route);
    } catch (error: any) {
      console.error('Error calculating route:', error);
      setRouteError('No pudimos calcular una ruta desde esa ubicación hasta CUCEI. Selecciona otra dirección.');
      setRouteResult(null);
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!selectedOrigin) {
      newErrors.origin = 'Debes seleccionar una dirección válida usando "Buscar dirección"';
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

    if (!formData.price) {
      newErrors.price = 'El precio es requerido';
    } else {
      const price = parseFloat(formData.price);
      if (price < 0) {
        newErrors.price = 'El precio no puede ser negativo';
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

    if (!selectedOrigin || !routeResult) {
      return;
    }

    setIsSubmitted(true);

    try {
      const params: CreateTripParams = {
        origin: selectedOrigin.display_name,
        destination: CUCEI_COORDS.address,
        origin_lat: parseFloat(selectedOrigin.lat),
        origin_lng: parseFloat(selectedOrigin.lon),
        route_distance_km: routeResult.distance / 1000,
        route_duration_minutes: Math.round(routeResult.duration / 60),
        date: formData.date,
        time: formData.time,
        seats_available: parseInt(formData.seatsAvailable),
        price: parseFloat(formData.price),
        notes: formData.notes || undefined,
      };

      await createTrip(params);

      // Reset form after successful submission
      setFormData({
        origin: '',
        date: '',
        time: '',
        seatsAvailable: '',
        price: '',
        notes: '',
      });
      setAddressQuery('');
      setSelectedOrigin(null);
      setRouteResult(null);
      setAddressResults([]);

      setTimeout(() => {
        setIsSubmitted(false);
        navigate('/');
      }, 3000);
    } catch (error: any) {
      console.error('Error creating trip:', error);
      setErrors({ general: error.message || 'Error al publicar el viaje. Intenta nuevamente.' });
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Verificando autenticación...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Ofrecer Viaje
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Comparte tu viaje a CUCEI y ayuda a otros estudiantes mientras ahorras en gastos.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Información lateral */}
            <div className="lg:col-span-1">
              <Card className="p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Consejos para conductores</h3>
                <ul className="space-y-3">
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Sé específico con los puntos de encuentro
                  </li>
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Establece un precio justo y transparente
                  </li>
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Mantén tu vehículo limpio y seguro
                  </li>
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Sé puntual y respeta los horarios
                  </li>
                </ul>
              </Card>

              <Card className="p-6 bg-gradient-to-br from-green-50 to-teal-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Beneficios de ofrecer viajes</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Reduce tus costos de viaje
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Conoce a otros estudiantes
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Contribuye al medio ambiente
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Construye tu reputación
                  </li>
                </ul>
              </Card>
            </div>

            {/* Formulario principal */}
            <div className="lg:col-span-2">
              <Card className="p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Detalles del Viaje</h2>

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
                    {/* Búsqueda de dirección */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        ¿Dónde sales?
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={addressQuery}
                          onChange={(e) => setAddressQuery(e.target.value)}
                          placeholder="Ej: Av. Vallarta 1234, Guadalajara, Jalisco"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <Button
                          type="button"
                          onClick={handleSearchAddress}
                          disabled={isSearchingAddress || isCalculatingRoute}
                          variant="primary"
                        >
                          {isSearchingAddress ? 'Buscando...' : 'Buscar dirección'}
                        </Button>
                      </div>
                      {errors.origin && (
                        <p className="mt-1 text-sm text-red-600">{errors.origin}</p>
                      )}
                    </div>

                    {/* Resultados de búsqueda */}
                    {addressResults.length > 0 && (
                      <div className="mb-6 bg-white border border-gray-200 rounded-lg shadow-sm max-h-60 overflow-y-auto">
                        <p className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50">
                          Selecciona una dirección:
                        </p>
                        {addressResults.map((result) => (
                          <button
                            key={result.place_id}
                            type="button"
                            onClick={() => handleSelectAddress(result)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                          >
                            <p className="text-sm text-gray-800">{result.display_name}</p>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Mapa y ruta */}
                    {selectedOrigin && (
                      <div className="mb-6">
                        <div className="h-96 rounded-lg overflow-hidden border border-gray-300 mb-4">
                          <MapContainer
                            center={[parseFloat(selectedOrigin.lat), parseFloat(selectedOrigin.lon)]}
                            zoom={13}
                            style={{ height: '100%', width: '100%' }}
                          >
                            <TileLayer
                              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <Marker
                              position={[parseFloat(selectedOrigin.lat), parseFloat(selectedOrigin.lon)]}
                              icon={originIcon}
                            />
                            <Marker
                              position={[CUCEI_COORDS.lat, CUCEI_COORDS.lng]}
                              icon={destinationIcon}
                            />
                            {routeResult && (
                              <>
                                <Polyline
                                  positions={routeResult.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
                                  color="#4F46E5"
                                  weight={4}
                                />
                                <MapBounds
                                  bounds={L.latLngBounds([
                                    [parseFloat(selectedOrigin.lat), parseFloat(selectedOrigin.lon)],
                                    [CUCEI_COORDS.lat, CUCEI_COORDS.lng],
                                  ])}
                                />
                              </>
                            )}
                          </MapContainer>
                        </div>

                        {isCalculatingRoute && (
                          <div className="flex items-center text-indigo-600">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 mr-2"></div>
                            <span className="text-sm">Calculando ruta...</span>
                          </div>
                        )}

                        {routeResult && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <div className="flex items-center justify-around">
                              <div className="text-center">
                                <p className="text-sm text-blue-600 font-medium">📍 Distancia</p>
                                <p className="text-lg font-bold text-blue-800">{formatDistance(routeResult.distance)}</p>
                              </div>
                              <div className="text-center">
                                <p className="text-sm text-blue-600 font-medium">🚗 Tiempo estimado</p>
                                <p className="text-lg font-bold text-blue-800">{formatDuration(routeResult.duration)}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {routeError && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                            <p className="text-sm text-red-700">{routeError}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Destino fijo */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Destino
                      </label>
                      <input
                        type="text"
                        value={CUCEI_COORDS.address}
                        disabled
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
                      />
                      <p className="mt-1 text-xs text-gray-500">El destino es siempre CUCEI</p>
                    </div>

                    {/* Campos adicionales */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      <FormField
                        label="Lugares Disponibles"
                        name="seatsAvailable"
                        type="number"
                        min="1"
                        max="8"
                        value={formData.seatsAvailable}
                        onChange={handleChange}
                        error={errors.seatsAvailable}
                        placeholder="Número de pasajeros"
                      />
                      <FormField
                        label="Precio por Persona (MXN)"
                        name="price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.price}
                        onChange={handleChange}
                        error={errors.price}
                        placeholder="0.00"
                      />
                    </div>

                    <TextAreaField
                      label="Notas Adicionales (Opcional)"
                      name="notes"
                      value={formData.notes}
                      onChange={handleChange}
                      placeholder="Información adicional como puntos de encuentro, preferencias, etc."
                      rows={4}
                    />

                    {errors.general && (
                      <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-700">{errors.general}</p>
                      </div>
                    )}

                    {errors.route && (
                      <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-700">{errors.route}</p>
                      </div>
                    )}

                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      fullWidth
                      disabled={!selectedOrigin || !routeResult || isCalculatingRoute}
                    >
                      Publicar Viaje
                    </Button>
                  </form>
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
