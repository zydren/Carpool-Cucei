import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { searchTripsByLocation, getAllPublishedTrips, SEARCH_RADIUS_KM } from '../services/geoSearchService';
import type { TripSearchResult } from '../services/tripService';
import { formatDistance } from '../services/routingService';
import { getCurrentUser } from '../services/authService';
import { getMyTripRequests, createTripRequest } from '../services/tripRequestService';
import type { TripRequestStatus } from '../services/tripRequestService';
import {
  searchAddress,
  geocodeQuery,
  searchLocationSuggestions,
} from '../services/geocodingService';
import type { GeocodingResult, GeocodedLocation } from '../services/geocodingService';
import LocationPickerMap from '../components/LocationPickerMap';
import type { MapPick } from '../components/LocationPickerMap';
import {
  AlertTriangle,
  CheckCircle2,
  Eraser,
  Info,
  List,
  Loader2,
  MapPin,
  Search,
  Type,
} from 'lucide-react';

interface SelectedPickup {
  address: string;
  lat: number;
  lng: number;
}

/** Mínimo de caracteres escritos antes de pedir sugerencias a Nominatim. */
const MIN_SUGGESTION_CHARS = 3;

/** Espera tras la última tecla antes de consultar (Nominatim pide moderación). */
const SUGGESTIONS_DEBOUNCE_MS = 500;

/** Máximo de sugerencias parecidas que se muestran bajo el campo de texto. */
const MAX_SUGGESTIONS = 5;

/**
 * Ubicación escrita por el usuario y ya geocodificada con Nominatim.
 * Extiende MapPick para poder dibujar el mismo punto (marcador) en el mapa.
 */
interface TextLocationPick extends MapPick {
  /** Texto tal como lo escribió el usuario (evita repetir la geocodificación). */
  query: string;
  /** Dirección normalizada que devolvió Nominatim. */
  name: string;
}

const SearchTripPage = () => {
  const navigate = useNavigate();

  const [locationText, setLocationText] = useState('');
  const [mapPick, setMapPick] = useState<MapPick | null>(null);
  const [date, setDate] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  /** true mientras el listado muestra TODOS los viajes publicados (sin filtros). */
  const [isShowingAllTrips, setIsShowingAllTrips] = useState(false);
  const [trips, setTrips] = useState<TripSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [geoSearchInfo, setGeoSearchInfo] = useState<
    { type: 'text' | 'map'; name: string } | null
  >(null);
  const [geocodingNotice, setGeocodingNotice] = useState<string | null>(null);
  /** Punto confirmado desde el texto escrito (marcador de confirmación). */
  const [textPick, setTextPick] = useState<TextLocationPick | null>(null);
  /** Punto al que el mapa debe desplazarse al confirmar el texto escrito. */
  const [focusPoint, setFocusPoint] = useState<MapPick | null>(null);
  /** Geocodificación del texto en curso (al salir del campo de texto). */
  const [isLocatingText, setIsLocatingText] = useState(false);
  /**
   * Contador de acciones sobre la ubicación: permite descartar el resultado de
   * una geocodificación que terminó después de un clic más reciente en el mapa.
   */
  const locationActionRef = useRef(0);
  /** Sugerencias de lugares parecidos al texto escrito (autocompletado). */
  const [suggestions, setSuggestions] = useState<GeocodedLocation[]>([]);
  /** Texto al que corresponden las sugerencias que hay en pantalla. */
  const [suggestionsForQuery, setSuggestionsForQuery] = useState('');
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  /** Temporizador del autocompletado (para agrupar las pulsaciones). */
  const suggestionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Token para descartar respuestas de un texto que ya quedó obsoleto. */
  const suggestionsRequestRef = useRef(0);
  /**
   * Última lista de sugerencias *ya recibida*, junto al texto que la produjo.
   * Se guarda en un ref para poder reutilizarla al confirmar el texto sin
   * depender del estado de React ni exponerse a condiciones de carrera.
   */
  const loadedSuggestionsRef = useRef<{ query: string; items: GeocodedLocation[] }>({
    query: '',
    items: [],
  });

  // Autenticación y solicitudes del usuario
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [requestStatusByTrip, setRequestStatusByTrip] = useState<
    Record<string, TripRequestStatus>
  >({});

  // Modal de solicitud de lugar
  const [selectedTrip, setSelectedTrip] = useState<TripSearchResult | null>(null);
  const [pickupQuery, setPickupQuery] = useState('');
  const [pickupResults, setPickupResults] = useState<GeocodingResult[]>([]);
  const [selectedPickup, setSelectedPickup] = useState<SelectedPickup | null>(null);
  const [isSearchingPickup, setIsSearchingPickup] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Cargar el usuario y el estado de sus solicitudes al montar
  useEffect(() => {
    let cancelled = false;

    const loadUserAndRequests = async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;

        if (!user) {
          setIsAuthenticated(false);
          return;
        }

        setIsAuthenticated(true);
        const requests = await getMyTripRequests();
        if (cancelled) return;

        const statusMap: Record<string, TripRequestStatus> = {};
        for (const request of requests) {
          if (!(request.trip_id in statusMap)) {
            statusMap[request.trip_id] = request.status;
          }
        }
        setRequestStatusByTrip(statusMap);
      } catch (error) {
        console.error('Error cargando solicitudes del usuario:', error);
        if (!cancelled) {
          setIsAuthenticated(false);
        }
      }
    };

    loadUserAndRequests();
    return () => {
      cancelled = true;
    };
  }, []);
  /**
   * Geocodifica el texto de ubicación con el servicio existente (Nominatim) y
   * marca el punto en el mapa para que el usuario confirme dónde lo ubicamos.
   * Devuelve el punto confirmado, o null si el texto está vacío o no se pudo
   * ubicar (en ese caso muestra un aviso, sin bloquear la búsqueda).
   */
  const confirmTextLocation = async (
    rawText: string
  ): Promise<TextLocationPick | null> => {
    const query = rawText.trim();

    if (query === '') {
      setTextPick(null);
      return null;
    }

    // Si el texto no cambió desde la última confirmación, se reutiliza el punto
    // ya geocodificado para no repetir la llamada a Nominatim.
    if (textPick && textPick.query === query) {
      return textPick;
    }

    const action = ++locationActionRef.current;
    setIsLocatingText(true);

    try {
      const geo = await geocodeQuery(query);

      // Si mientras geocodificábamos el usuario hizo clic en el mapa (o limpió
      // la ubicación), esa acción es más reciente: se descarta este resultado
      // para no pisar el marcador ni repoblar lo que el usuario acaba de limpiar.
      if (action !== locationActionRef.current) {
        return null;
      }

      if (!geo) {
        // Respaldo tolerante: si el usuario escribió algo parecido a un lugar
        // real ("perfeco belenes" → "Periférico Belenes"), se confirma el
        // lugar más parecido en vez de fallar.
        const loaded = loadedSuggestionsRef.current;
        let similar = loaded.query === query && loaded.items.length > 0 ? loaded.items[0] : null;

        if (!similar) {
          // No había sugerencias cargadas para este texto (por ejemplo, el
          // usuario salió del campo antes de que llegaran): una única búsqueda
          // aproximada acotada. Se omiten los intentos exactos porque
          // geocodeQuery ya los hizo y falló.
          const approximate = await searchLocationSuggestions(query, 1, {
            approximateOnly: true,
          });

          // Si mientras tanto el usuario hizo clic en el mapa o limpió la
          // ubicación, esa acción manda: se descarta este resultado.
          if (action !== locationActionRef.current) {
            return null;
          }

          similar = approximate[0] ?? null;
        }

        if (similar) {
          const fromSuggestion: TextLocationPick = {
            query,
            name: similar.displayName,
            lat: similar.lat,
            lng: similar.lng,
          };
          setTextPick(fromSuggestion);
          setGeocodingNotice(
            `No encontramos "${query}" exactamente, así que usamos el lugar más parecido: ${similar.displayName}`
          );
          setMapPick(null);
          setFocusPoint({ lat: similar.lat, lng: similar.lng });
          return fromSuggestion;
        }

        setTextPick(null);
        setGeocodingNotice(
          'No pudimos ubicar tu texto en el mapa. Revisa la dirección o marca el punto directamente en el mapa.'
        );
        return null;
      }

      const confirmed: TextLocationPick = {
        query,
        name: geo.displayName,
        lat: geo.lat,
        lng: geo.lng,
      };
      setTextPick(confirmed);
      setGeocodingNotice(null);
      // El texto es la acción más reciente: el marcador se mueve a ese punto
      // para confirmarlo (si el usuario vuelve a hacer clic, manda el clic).
      setMapPick(null);
      setFocusPoint({ lat: confirmed.lat, lng: confirmed.lng });
      return confirmed;
    } finally {
      setIsLocatingText(false);
    }
  };

  /** El clic en el mapa es la acción más reciente y precisa: pasa a ser el origen. */
  const handleMapPick = (pick: MapPick) => {
    locationActionRef.current += 1;
    setMapPick(pick);
    setGeocodingNotice(null);
  };

  /**
   * Autocompletado: cada vez que el usuario escribe se piden a Nominatim
   * lugares parecidos y se muestran bajo el campo. Se espera
   * SUGGESTIONS_DEBOUNCE_MS tras la última tecla para no consultar de más, y
   * se descartan las respuestas que llegan cuando el texto ya cambió.
   */
  const scheduleSuggestionSearch = (rawText: string) => {
    const query = rawText.trim();

    if (suggestionsTimerRef.current !== null) {
      clearTimeout(suggestionsTimerRef.current);
      suggestionsTimerRef.current = null;
    }

    // Texto vacío o demasiado corto: no hay nada que sugerir.
    if (query.length < MIN_SUGGESTION_CHARS) {
      suggestionsRequestRef.current += 1;
      loadedSuggestionsRef.current = { query: '', items: [] };
      setIsLoadingSuggestions(false);
      setSuggestions([]);
      setSuggestionsForQuery('');
      return;
    }

    suggestionsTimerRef.current = setTimeout(() => {
      suggestionsTimerRef.current = null;
      const request = suggestionsRequestRef.current + 1;
      suggestionsRequestRef.current = request;
      setIsLoadingSuggestions(true);

      void (async () => {
        try {
          const results = await searchLocationSuggestions(query, MAX_SUGGESTIONS);

          // Si el usuario siguió escribiendo (o eligió una sugerencia), esta
          // respuesta ya es vieja: se descarta para no mostrar otros lugares.
          if (request !== suggestionsRequestRef.current) {
            return;
          }

          loadedSuggestionsRef.current = { query, items: results };
          setSuggestions(results);
          setSuggestionsForQuery(query);
          setShowSuggestions(results.length > 0);
        } finally {
          if (request === suggestionsRequestRef.current) {
            setIsLoadingSuggestions(false);
          }
        }
      })();
    }, SUGGESTIONS_DEBOUNCE_MS);
  };

  /** El usuario escribió: actualiza el texto y programa el autocompletado. */
  const handleLocationTextChange = (value: string) => {
    setLocationText(value);
    scheduleSuggestionSearch(value);
  };

  /** El usuario eligió una sugerencia: pasa a ser la ubicación confirmada. */
  const handleSuggestionSelect = (suggestion: GeocodedLocation) => {
    // Invalida cualquier geocodificación o sugerencia en vuelo.
    locationActionRef.current += 1;
    suggestionsRequestRef.current += 1;
    if (suggestionsTimerRef.current !== null) {
      clearTimeout(suggestionsTimerRef.current);
      suggestionsTimerRef.current = null;
    }
    loadedSuggestionsRef.current = { query: suggestion.displayName, items: [] };
    setLocationText(suggestion.displayName);
    setSuggestions([]);
    setSuggestionsForQuery('');
    setShowSuggestions(false);
    setIsLoadingSuggestions(false);
    setGeocodingNotice(null);
    // Elegir del texto es la acción más reciente: manda sobre un clic anterior.
    setMapPick(null);

    const confirmed: TextLocationPick = {
      query: suggestion.displayName,
      name: suggestion.displayName,
      lat: suggestion.lat,
      lng: suggestion.lng,
    };
    setTextPick(confirmed);
    setFocusPoint({ lat: suggestion.lat, lng: suggestion.lng });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasSearched(true);
    // Una búsqueda normal sustituye la vista "todos los viajes".
    setIsShowingAllTrips(false);
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    // El aviso de geocodificación es por búsqueda: nunca debe quedar pegado
    setGeocodingNotice(null);

    try {
      const originText = locationText.trim();

      // Resolver el punto de búsqueda:
      // 1. El punto del mapa tiene prioridad (es el más preciso).
      // 2. Si no hay punto en el mapa, se geocodifica el texto con Nominatim.
      let originLatitude: number | undefined;
      let originLongitude: number | undefined;
      let searchInfo: { type: 'text' | 'map'; name: string } | null = null;

      if (mapPick) {
        originLatitude = mapPick.lat;
        originLongitude = mapPick.lng;
        searchInfo = { type: 'map', name: 'tu punto seleccionado en el mapa' };
      } else if (originText !== '') {
        // Se reutiliza el punto ya confirmado en el mapa si el texto no cambió.
        const confirmed = await confirmTextLocation(originText);
        if (confirmed) {
          originLatitude = confirmed.lat;
          originLongitude = confirmed.lng;
          searchInfo = { type: 'text', name: confirmed.name };
        }
      }

      // Todos los viajes del sistema terminan en CUCEI, por eso no hay
      // filtro de destino: solo se filtra por texto/proximidad de origen y fecha.
      const results = await searchTripsByLocation({
        origin: originText,
        date: date.trim(),
        originLatitude,
        originLongitude,
      });
      setTrips(results);
      setGeoSearchInfo(searchInfo);
    } catch (err) {
      console.error('Error searching trips:', err);
      setError('Error al buscar viajes. Por favor intenta nuevamente.');
      setTrips([]);
      setGeoSearchInfo(null);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Muestra todos los viajes activos publicados, sin aplicar los filtros del
   * formulario (origen ni fecha). Reutiliza la sección de resultados: solo
   * cambia el aviso mostrado sobre el listado.
   */
  const handleShowAllTrips = async () => {
    setHasSearched(true);
    setIsShowingAllTrips(true);
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    setGeocodingNotice(null);
    setGeoSearchInfo(null);

    try {
      const results = await getAllPublishedTrips();
      setTrips(results);
    } catch (err) {
      console.error('Error fetching all published trips:', err);
      setError('Error al cargar los viajes. Por favor intenta nuevamente.');
      setTrips([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearLocation = () => {
    locationActionRef.current += 1;
    setLocationText('');
    setMapPick(null);
    setTextPick(null);
    setFocusPoint(null);
    setGeoSearchInfo(null);
    setGeocodingNotice(null);
    // Limpia también el autocompletado en pantalla.
    if (suggestionsTimerRef.current !== null) {
      clearTimeout(suggestionsTimerRef.current);
      suggestionsTimerRef.current = null;
    }
    suggestionsRequestRef.current += 1;
    loadedSuggestionsRef.current = { query: '', items: [] };
    setSuggestions([]);
    setSuggestionsForQuery('');
    setShowSuggestions(false);
    setIsLoadingSuggestions(false);
  };

  const handleRequestClick = (trip: TripSearchResult) => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    setSelectedTrip(trip);
    setPickupQuery('');
    setPickupResults([]);
    setSelectedPickup(null);
    setPickupError(null);
    setModalError(null);
  };

  const closeModal = () => {
    setSelectedTrip(null);
    setPickupQuery('');
    setPickupResults([]);
    setSelectedPickup(null);
    setPickupError(null);
    setModalError(null);
  };

  const handleSearchPickup = async () => {
    if (!pickupQuery.trim()) {
      setPickupError('Ingresa una dirección de recogida para buscar.');
      return;
    }

    setIsSearchingPickup(true);
    setPickupError(null);
    setModalError(null);
    setPickupResults([]);
    setSelectedPickup(null);

    try {
      const results = await searchAddress(pickupQuery);
      setPickupResults(results);
      if (results.length === 0) {
        setPickupError('No encontramos esa dirección. Intenta escribirla de otra manera.');
      }
    } catch (error) {
      console.error('Error buscando dirección de recogida:', error);
      setPickupError('No encontramos esa dirección. Intenta escribirla de otra manera.');
    } finally {
      setIsSearchingPickup(false);
    }
  };

  const handleSelectPickup = (result: GeocodingResult) => {
    setSelectedPickup({
      address: result.display_name,
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
    });
    setPickupQuery(result.display_name);
    setPickupResults([]);
    setPickupError(null);
  };

  const handleSubmitRequest = async () => {
    if (!selectedTrip || !selectedPickup) {
      setModalError('Selecciona una dirección de recogida válida.');
      return;
    }

    setIsSubmittingRequest(true);
    setModalError(null);

    try {
      await createTripRequest({
        tripId: selectedTrip.id,
        pickupAddress: selectedPickup.address,
        pickupLat: selectedPickup.lat,
        pickupLng: selectedPickup.lng,
      });

      setRequestStatusByTrip((prev) => ({
        ...prev,
        [selectedTrip.id]: 'pending',
      }));
      setSuccessMessage('¡Solicitud enviada! El conductor revisará tu solicitud.');
      closeModal();
    } catch (error) {
      console.error('Error creating trip request:', error);
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar la solicitud. Intenta nuevamente.';
      setModalError(message);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const renderRequestArea = (trip: TripSearchResult) => {
    const status = requestStatusByTrip[trip.id];

    if (status === 'pending') {
      return (
        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
          Solicitud pendiente
        </span>
      );
    }

    if (status === 'accepted') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-green-50 text-green-700 border border-green-200">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          Viaje aceptado
        </span>
      );
    }

    if (status === 'rejected') {
      return (
        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          Solicitud rechazada
        </span>
      );
    }

    if (trip.seatsAvailable <= 0) {
      return (
        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-500 border border-gray-200">
          Viaje completo
        </span>
      );
    }

    return (
      <Button variant="primary" size="sm" onClick={() => handleRequestClick(trip)}>
        Solicitar lugar
      </Button>
    );
  };

  return (
<div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Buscar Viaje
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Encuentra el viaje perfecto para tu próximo destino. Comparte gastos y conoce a otros estudiantes.
            </p>
          </div>

          {successMessage && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 text-sm">{successMessage}</p>
            </div>
          )}

          <Card className="p-6 mb-8">
            <form onSubmit={handleSearch}>
              <div className="mb-6 border border-gray-200 rounded-lg p-4">
                <h3 className="text-base font-semibold text-gray-900 mb-1">
                  ¿Desde dónde buscas tu viaje?{' '}
                  <span className="text-sm text-gray-400 font-normal">(opcional)</span>
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  Escribe tu ubicación y elige entre las sugerencias que aparecen (aunque no
                  escribas el nombre exacto), selecciona un punto en el mapa, o ambos. Al
                  escribirla la marcamos en el mapa para que la confirmes; si además haces clic
                  en el mapa, el punto del mapa es el que se usa.
                </p>

                <div className="relative z-20">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={locationText}
                    onChange={(e) => handleLocationTextChange(e.target.value)}
                    // Al salir del campo se geocodifica el texto y se marca en el
                    // mapa para que el usuario confirme la ubicación detectada.
                    onBlur={() => {
                      setShowSuggestions(false);
                      void confirmTextLocation(locationText);
                    }}
                    placeholder="Escribe tu ubicación (ej: Arcos de Zapopan)"
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />

                  {showSuggestions &&
                    suggestions.length > 0 &&
                    // Solo se muestran si corresponden al texto actual (evita
                    // que quede a la vista una lista de lo escrito antes).
                    suggestionsForQuery === locationText.trim() && (
                      <ul className="absolute left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                        {suggestions.map((suggestion) => (
                          <li key={`${suggestion.displayName}-${suggestion.lat}`}>
                            <button
                              type="button"
                              // Evita que el input pierda el foco antes del clic,
                              // para que el desplegable no se cierre solo.
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSuggestionSelect(suggestion)}
                              className="flex w-full items-center gap-2 text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
                            >
                              <MapPin className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />
                              <span>{suggestion.displayName}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>

                {isLocatingText && (
                  <p className="flex items-center gap-1.5 text-xs text-indigo-600 mt-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Ubicando tu texto en el mapa...
                  </p>
                )}

                {!isLocatingText && isLoadingSuggestions && (
                  <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Buscando lugares parecidos...
                  </p>
                )}

                <div className="flex items-center my-4">
                  <span className="flex-1 border-t border-gray-200"></span>
                  <span className="text-sm text-gray-400 px-3">o</span>
                  <span className="flex-1 border-t border-gray-200"></span>
                </div>

                <LocationPickerMap
                  centerLat={20.66}
                  centerLng={-103.35}
                  zoom={12}
                  selected={mapPick ?? textPick}
                  focus={focusPoint}
                  onPick={handleMapPick}
                  className="rounded-lg border border-gray-300"
                  style={{ height: '280px', width: '100%' }}
                />
                <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Haz clic en el mapa para señalar tu punto de partida. La ubicación que
                    escribas también se marca aquí para que la confirmes.
                  </span>
                </p>

                {mapPick ? (
                  <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="flex items-center gap-1.5 text-sm text-green-800 font-medium">
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Ubicación seleccionada en el mapa
                    </p>
                    <p className="text-xs text-green-700 mt-1">
                      Lat {mapPick.lat.toFixed(5)} · Lng {mapPick.lng.toFixed(5)}
                    </p>
                    {textPick && (
                      <p className="text-xs text-green-700 mt-1">
                        El punto del mapa tiene prioridad sobre el texto escrito.
                      </p>
                    )}
                  </div>
                ) : textPick ? (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="flex items-center gap-1.5 text-sm text-blue-800 font-medium">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Confirmamos tu texto en el mapa
                    </p>
                    <p className="text-xs text-blue-700 mt-1">{textPick.name}</p>
                    <p className="text-xs text-blue-700 mt-1">
                      Lat {textPick.lat.toFixed(5)} · Lng {textPick.lng.toFixed(5)}
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      Si el punto no es correcto, haz clic en el mapa para ajustarlo.
                    </p>
                  </div>
                ) : null}

                {(locationText.trim() !== '' || mapPick !== null || textPick !== null) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearLocation}
                    className="mt-3"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Eraser className="w-4 h-4" aria-hidden="true" />
                      Limpiar ubicación
                    </span>
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  label="Fecha"
                  name="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                  <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Todos los viajes tienen como destino CUCEI.
                </div>
              </div>
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  className="flex-1"
                  disabled={isLoading}
                >
                  Buscar Viajes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={handleShowAllTrips}
                  disabled={isLoading}
                >
                  <span className="inline-flex items-center gap-2">
                    <List className="w-4 h-4" aria-hidden="true" />
                    Ver todos los viajes
                  </span>
                </Button>
              </div>
            </form>
          </Card>

          {/* Resultados de búsqueda */}
          {hasSearched && (
<div>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                Viajes Disponibles
                <span className="text-indigo-600 ml-2">({trips.length})</span>
              </h2>

              {isShowingAllTrips && (
                <p className="flex items-center gap-1.5 mb-3 text-sm text-indigo-600">
                  <List className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Mostrando todos los viajes publicados, ordenados por fecha.
                </p>
              )}
              {geoSearchInfo && (
                <p className="flex items-center gap-1.5 mb-3 text-sm text-indigo-600">
                  {geoSearchInfo.type === 'map' ? (
                    <>
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Buscando viajes cerca de {geoSearchInfo.name} (radio de {SEARCH_RADIUS_KM} km).
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Buscando viajes cerca de «{geoSearchInfo.name}» (radio de {SEARCH_RADIUS_KM} km).
                    </>
                  )}
                </p>
              )}
              {geocodingNotice && (
                <p className="flex items-start gap-1.5 mb-3 text-sm text-yellow-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{geocodingNotice}</span>
                </p>
              )}

              {isLoading ? (
                <Card className="p-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <svg className="animate-spin h-12 w-12 text-indigo-600 mb-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-gray-600">Buscando viajes...</p>
                  </div>
                </Card>
              ) : error ? (
                <Card className="p-12 text-center bg-red-50">
                  <svg className="w-16 h-16 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    Error en la búsqueda
                  </h3>
                  <p className="text-gray-600">{error}</p>
                </Card>
              ) : trips.length === 0 ? (
                <Card className="p-12 text-center">
                  <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    No se encontraron viajes
                  </h3>
                  <p className="text-gray-600">
                    Intenta con otra fecha o con otra ubicación de origen. ¡O considera ofrecer un viaje tú mismo!
                  </p>
                </Card>
              ) : (
<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {trips.map((trip) => (
                    <Card key={trip.id} className="p-6 hover" hover>
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-gray-600">{trip.origin}</span>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-gray-600">{trip.destination}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-indigo-600">${trip.price}</p>
                          <p className="text-sm text-gray-500">por persona</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm text-gray-600">
                            {new Date(trip.date).toLocaleDateString('es-MX', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm text-gray-600">{trip.time}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {trip.matchType === 'textual' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <Type className="w-3.5 h-3.5" aria-hidden="true" />
                            Coincidencia por texto
                          </span>
                        )}
                        {trip.matchType === 'origin' && trip.distanceToOriginKm !== null && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                            Origen a {formatDistance(trip.distanceToOriginKm * 1000)} de tu búsqueda
                          </span>
                        )}
                      </div>

                      <div className="border-t pt-4 mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center mr-3">
                              <span className="text-indigo-600 font-semibold">
                                {trip.driver.name.charAt(0)}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{trip.driver.name}</p>
                              <p className="text-sm text-gray-500">{trip.driver.university}</p>
                            </div>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-yellow-400 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                            <span className="font-medium text-gray-900">{trip.driver.rating}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t pt-4">
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-indigo-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <span className="text-sm text-gray-600">
                            {trip.seatsAvailable} {trip.seatsAvailable === 1 ? 'lugar disponible' : 'lugares disponibles'}
                          </span>
                        </div>
                        {renderRequestArea(trip)}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
{/* Información adicional */}
          {!hasSearched && (
            <Card className="p-8 bg-gradient-to-r from-indigo-50 to-purple-50 text-center">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                ¿No encuentras lo que buscas?
              </h3>
              <p className="text-gray-600 mb-4">
                Considera ofrecer un viaje tú mismo y ayuda a otros estudiantes a llegar a su destino.
              </p>
              <Button variant="outline" size="lg">
                Ofrecer Viaje
              </Button>
            </Card>
          )}
        </div>
      </div>

      {/* Modal de solicitud de lugar */}
      <Modal open={selectedTrip !== null} onClose={closeModal} title="Solicitar lugar">
        {selectedTrip && (
          <div>
            <p className="text-sm text-gray-600 mb-4">
              Viaje:{' '}
              <span className="font-semibold text-gray-900">
                {selectedTrip.origin} → CUCEI
              </span>
            </p>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{modalError}</p>
              </div>
            )}

            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dirección de recogida
            </label>
            <div className="flex gap-2 mb-1">
              <input
                type="text"
                value={pickupQuery}
                onChange={(e) => setPickupQuery(e.target.value)}
                placeholder="Ej: Av. Vallarta 1234, Guadalajara, Jalisco"
                disabled={isSubmittingRequest}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <Button
                type="button"
                onClick={handleSearchPickup}
                disabled={isSearchingPickup || isSubmittingRequest}
                variant="primary"
              >
                {isSearchingPickup ? 'Buscando...' : 'Buscar'}
              </Button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Buscamos tu dirección en OpenStreetMap para que el conductor sepa dónde recogerte.
            </p>

            {pickupError && (
              <p className="mt-1 text-sm text-red-600">{pickupError}</p>
            )}

            {pickupResults.length > 0 && (
              <div className="mt-2 mb-3 bg-white border border-gray-200 rounded-lg shadow-sm max-h-48 overflow-y-auto">
                <p className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50">
                  Selecciona tu dirección:
                </p>
                {pickupResults.map((result) => (
                  <button
                    key={result.place_id}
                    type="button"
                    onClick={() => handleSelectPickup(result)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                  >
                    <p className="text-sm text-gray-800">{result.display_name}</p>
                  </button>
                ))}
              </div>
            )}

            {selectedPickup && (
              <div className="mt-3 mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="flex items-start gap-1.5 text-sm text-green-800">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>Dirección seleccionada: {selectedPickup.address}</span>
                </p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={closeModal}
                disabled={isSubmittingRequest}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSubmitRequest}
                disabled={!selectedPickup || isSubmittingRequest || isSearchingPickup}
              >
                {isSubmittingRequest ? 'Enviando...' : 'Solicitar lugar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Footer />
    </div>
  );
};

export default SearchTripPage;