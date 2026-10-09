import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { AppShell, PageHeader } from '../components/layout/AppShell';
import { EmptyState, Alert } from '../components/ui/PageBlocks';
import {
  searchTripsByLocation,
  getAllPublishedTrips,
  SEARCH_RADIUS_KM,
  ORIGIN_RADIUS_KM,
} from '../services/geoSearchService';
import { nearestPointOnRoute } from '../services/tripService';
import type { TripSearchResult } from '../services/tripService';
import { formatDistance } from '../services/routingService';
import { getCurrentUser } from '../services/authService';
import { getMyTripRequests, createTripRequest } from '../services/tripRequestService';
import type { TripRequestStatus } from '../services/tripRequestService';
import {
  geocodeQuery,
  reverseGeocode,
  searchLocationSuggestions,
} from '../services/geocodingService';
import type { GeocodedLocation } from '../services/geocodingService';
import LocationPickerMap from '../components/LocationPickerMap';
import type { MapPick, TripOriginMarker } from '../components/LocationPickerMap';
import {
  Car,
  CheckCircle2,
  Eraser,
  Eye,
  Info,
  List,
  Loader2,
  MapPin,
  Route,
  Search,
  Type,
  X,
} from 'lucide-react';

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
  /**
   * Punto de partida original del pasajero usado en la última búsqueda.
   * Se conserva tal cual: nunca se sustituye por el punto de recogida ajustado.
   */
  const [searchPoint, setSearchPoint] = useState<MapPick | null>(null);
  /** Viaje seleccionado en los resultados: su ruta se dibuja en el mapa. */
  const [mapTrip, setMapTrip] = useState<TripSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [geoSearchInfo, setGeoSearchInfo] = useState<
    { type: 'text' | 'map'; name: string } | null
  >(null);
  const [geocodingNotice, setGeocodingNotice] = useState<string | null>(null);
  /**
   * Dirección (geocodificación inversa) del punto elegido en el mapa.
   * null mientras carga o si Nominatim no respondió: el punto sigue siendo
   * válido con sus coordenadas.
   */
  const [mapPickAddress, setMapPickAddress] = useState<string | null>(null);
  /**
   * Aviso de "elige primero tu punto en el mapa" cuando se intenta solicitar
   * un viaje sin origen seleccionado.
   */
  const [originRequiredNotice, setOriginRequiredNotice] = useState<string | null>(null);
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
  /**
   * Token de la búsqueda más reciente: descarta los resultados de una búsqueda
   * que ya fue superada (por ejemplo, al cambiar el punto en el mapa).
   */
  const searchRequestRef = useRef(0);
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

  // Modal de solicitud de lugar: el origen YA está elegido en el mapa, así que
  // el modal solo confirma y envía (no vuelve a preguntar "¿de dónde sales?").
  const [selectedTrip, setSelectedTrip] = useState<TripSearchResult | null>(null);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
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

  /**
   * El clic en el mapa es la acción más reciente y precisa: pasa a ser el origen
   * ("Mi punto de salida"). Se geocodifica la dirección inversa de forma
   * opcional (si falla, quedan solo las coordenadas) y, si ya hay resultados en
   * pantalla, se vuelve a ejecutar el matching con el nuevo punto: un solo
   * disparo por clic, nunca por arrastre del mapa.
   */
  const handleMapPick = (pick: MapPick) => {
    locationActionRef.current += 1;
    const action = locationActionRef.current;
    setMapPick(pick);
    setMapPickAddress(null);
    setOriginRequiredNotice(null);
    setGeocodingNotice(null);

    // Dirección del punto (opcional): el error se ignora y quedan coordenadas.
    void (async () => {
      try {
        const address = await reverseGeocode(pick.lat, pick.lng);
        // Si mientras tanto ocurrió otra acción de ubicación, ésta queda vieja.
        if (address !== null && action === locationActionRef.current) {
          setMapPickAddress(address);
        }
      } catch {
        // Sin dirección: el punto sigue siendo válido con sus coordenadas.
      }
    })();

    // Re-búsqueda automática solo cuando hay resultados con filtros activos
    // (la vista "ver todos los viajes" no se sustituye con esto).
    if (hasSearched && !isShowingAllTrips) {
      void runSearch(pick);
    }
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

  /**
   * Ejecuta la búsqueda de viajes. Si se pasa `pointOverride` se usa ese punto
   * como origen (por ejemplo, un clic más reciente en el mapa); si no, se
   * resuelve el punto actual: el clic en el mapa con prioridad y, en su defecto,
   * el texto geocodificado con Nominatim. Un único flujo para el botón
   * "Buscar Viajes" y para cambiar el origen directamente en el mapa.
   */
  const runSearch = async (pointOverride?: MapPick) => {
    const request = searchRequestRef.current + 1;
    searchRequestRef.current = request;
    setHasSearched(true);
    // Una búsqueda normal sustituye la vista "todos los viajes".
    setIsShowingAllTrips(false);
    // Una nueva búsqueda reemplaza los resultados: se retira la ruta mostrada.
    setMapTrip(null);
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    // El aviso de geocodificación es por búsqueda: nunca debe quedar pegado
    setGeocodingNotice(null);
    setOriginRequiredNotice(null);

    try {
      const originText = locationText.trim();

      // Resolver el punto de búsqueda:
      // 1. El punto indicado (clic más reciente en el mapa) tiene prioridad.
      // 2. Si no, se geocodifica el texto con Nominatim.
      let originLatitude: number | undefined;
      let originLongitude: number | undefined;
      let searchInfo: { type: 'text' | 'map'; name: string } | null = null;

      if (pointOverride) {
        originLatitude = pointOverride.lat;
        originLongitude = pointOverride.lng;
        searchInfo = { type: 'map', name: 'tu punto seleccionado en el mapa' };
      } else if (mapPick) {
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

      // Si esta búsqueda ya fue superada por otra más reciente, se descarta.
      if (request !== searchRequestRef.current) {
        return;
      }

      // El punto original del pasajero se conserva aparte (searchPoint): el
      // punto de recogida ajustado sobre la ruta se calcula a partir de él y
      // nunca lo reemplaza.
      setSearchPoint(
        originLatitude !== undefined && originLongitude !== undefined
          ? { lat: originLatitude, lng: originLongitude }
          : null
      );

      // Todos los viajes del sistema terminan en CUCEI, por eso no hay
      // filtro de destino: solo se filtra por texto/proximidad de origen y fecha.
      const results = await searchTripsByLocation({
        origin: originText,
        date: date.trim(),
        originLatitude,
        originLongitude,
      });

      if (request !== searchRequestRef.current) {
        return;
      }
      setTrips(results);
      setGeoSearchInfo(searchInfo);
    } catch (err) {
      if (request !== searchRequestRef.current) {
        return;
      }
      console.error('Error searching trips:', err);
      setError('Error al buscar viajes. Por favor intenta nuevamente.');
      setTrips([]);
      setGeoSearchInfo(null);
    } finally {
      if (request === searchRequestRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch();
  };

  /**
   * Muestra todos los viajes activos publicados, sin aplicar los filtros del
   * formulario (origen ni fecha). Reutiliza la sección de resultados: solo
   * cambia el aviso mostrado sobre el listado.
   */
  const handleShowAllTrips = async () => {
    setHasSearched(true);
    setIsShowingAllTrips(true);
    // La vista "todos los viajes" no tiene punto de búsqueda ni ruta asociada.
    setMapTrip(null);
    setSearchPoint(null);
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
    setMapPickAddress(null);
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

  /**
   * El usuario hace clic en un resultado: se guarda el viaje seleccionado y su
   * ruta se dibuja inmediatamente en el mapa (sin repetir la búsqueda). Si se
   * vuelve a hacer clic en el mismo viaje, se oculta la ruta.
   */
  const handleSelectTripOnMap = (trip: TripSearchResult) => {
    setMapTrip((current) => (current?.id === trip.id ? null : trip));
  };

  /**
   * Punto de recogida ajustado: punto de la ruta del viaje seleccionado más
   * cercano al punto ORIGINAL del pasajero. Reutiliza la proyección de
   * nearestPointOnRoute / distancePointToRouteKm (misma matemática en km).
   */
  const pickupInfo = useMemo(() => {
    if (!mapTrip || !searchPoint || !mapTrip.routeGeometry) {
      return null;
    }
    return nearestPointOnRoute(searchPoint, mapTrip.routeGeometry);
  }, [mapTrip, searchPoint]);

  /**
   * El punto de recogida solo se marca si está realmente despegado del punto
   * original (más de 20 m); si el pasajero ya está sobre la ruta, no aporta.
   */
  const pickupPoint =
    pickupInfo && pickupInfo.distanceKm * 1000 > 20
      ? { lat: pickupInfo.lat, lng: pickupInfo.lng }
      : null;

  /**
   * Origen único del pasajero (fuente de verdad): el punto elegido con clic en
   * el mapa; si el usuario prefirió escribir, el texto ya confirmado. Es el
   * punto que se usa automáticamente al solicitar un viaje: no se vuelve a
   * preguntar "¿de dónde sales?".
   */
  const selectedOrigin: MapPick | null = mapPick ?? textPick;

  /** Etiqueta legible del origen: dirección si existe; si no, coordenadas. */
  const selectedOriginLabel = useMemo(() => {
    if (selectedOrigin === null) {
      return '';
    }
    const coords = `Lat ${selectedOrigin.lat.toFixed(5)} · Lng ${selectedOrigin.lng.toFixed(5)}`;
    if (mapPick) {
      return mapPickAddress ?? coords;
    }
    return textPick?.name ?? coords;
  }, [selectedOrigin, mapPick, mapPickAddress, textPick]);

  /**
   * Orígenes de los viajes listados, dibujados en el mapa con las coordenadas
   * ya guardadas (origin_lat/origin_lng): sin geocodificación adicional.
   */
  const tripOriginMarkers = useMemo<TripOriginMarker[]>(
    () =>
      trips.flatMap((trip) =>
        trip.originLat !== null && trip.originLng !== null
          ? [
              {
                id: trip.id,
                lat: trip.originLat,
                lng: trip.originLng,
                label: trip.origin,
                highlighted: mapTrip?.id === trip.id,
              },
            ]
          : []
      ),
    [trips, mapTrip]
  );

  /** Clic en el origen de un viaje (●): resalta ese viaje y muestra su ruta. */
  const handleTripOriginClick = (tripId: string) => {
    const trip = trips.find((item) => item.id === tripId);
    if (trip) {
      handleSelectTripOnMap(trip);
    }
  };

  const handleRequestClick = (trip: TripSearchResult) => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    // Sin punto elegido en el mapa no se abre el modal: se pide volver al mapa
    // y elegirlo (el formulario de origen ya no existe).
    if (selectedOrigin === null) {
      setOriginRequiredNotice('Selecciona primero en el mapa desde dónde vas a salir.');
      return;
    }

    setOriginRequiredNotice(null);
    setSelectedTrip(trip);
    setModalError(null);
  };

  const closeModal = () => {
    setSelectedTrip(null);
    setModalError(null);
  };

  const handleSubmitRequest = async () => {
    // El origen viene del mapa (selectedOrigin): no se vuelve a pedir.
    if (!selectedTrip || !selectedOrigin) {
      setModalError('Selecciona primero en el mapa desde dónde vas a salir.');
      return;
    }

    setIsSubmittingRequest(true);
    setModalError(null);

    try {
      await createTripRequest({
        tripId: selectedTrip.id,
        pickupAddress: selectedOriginLabel,
        pickupLat: selectedOrigin.lat,
        pickupLng: selectedOrigin.lng,
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
        <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-slate-100 text-slate-500 border border-slate-200">
          Viaje completo
        </span>
      );
    }

    return (
      <Button
        variant="primary"
        size="sm"
        onClick={(e) => {
          // No debe seleccionar además la tarjeta (eso ocultaría la ruta).
          e.stopPropagation();
          handleRequestClick(trip);
        }}
      >
        Solicitar lugar
      </Button>
    );
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Buscar"
        title="Encuentra tu viaje a CUCEI"
        description="Busca por ubicación, revisa la ruta en el mapa y solicita tu lugar."
      />
      <div className="app-animate-fade-up">

          {successMessage && (
            <div className="mb-6">
              <Alert type="success">{successMessage}</Alert>
            </div>
          )}

          <Card className="p-6 sm:p-8 mb-8">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-slate-900">Tu punto de partida</h2>
              <p className="mt-1 text-sm text-slate-500">
                Escribe tu ubicación, elígela en el mapa o combina ambas opciones.
              </p>
            </div>
            <form onSubmit={handleSearch}>
              <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <h3 className="text-base font-bold text-slate-900 mb-1">
                  ¿Desde dónde buscas tu viaje?{' '}
                  <span className="text-sm text-slate-400 font-medium">(opcional)</span>
                </h3>
                <p className="text-xs text-slate-500 mb-3">
                  Escribe tu ubicación y elige entre las sugerencias que aparecen (aunque no
                  escribas el nombre exacto), selecciona un punto en el mapa, o ambos. Al
                  escribirla la marcamos en el mapa para que la confirmes; si además haces clic
                  en el mapa, el punto del mapa es el que se usa.
                </p>

                <div className="relative z-20">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
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
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />

                  {showSuggestions &&
                    suggestions.length > 0 &&
                    // Solo se muestran si corresponden al texto actual (evita
                    // que quede a la vista una lista de lo escrito antes).
                    suggestionsForQuery === locationText.trim() && (
                      <ul className="absolute left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                        {suggestions.map((suggestion) => (
                          <li key={`${suggestion.displayName}-${suggestion.lat}`}>
                            <button
                              type="button"
                              // Evita que el input pierda el foco antes del clic,
                              // para que el desplegable no se cierre solo.
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => handleSuggestionSelect(suggestion)}
                              className="flex w-full items-center gap-2 text-left px-4 py-2 text-sm text-slate-700 hover:bg-teal-500/15 focus:bg-teal-500/15 focus:outline-none"
                            >
                              <MapPin className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
                              <span>{suggestion.displayName}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>

                {isLocatingText && (
                  <p className="flex items-center gap-1.5 text-xs text-teal-700 mt-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Ubicando tu texto en el mapa...
                  </p>
                )}

                {!isLocatingText && isLoadingSuggestions && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-500 mt-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    Buscando lugares parecidos...
                  </p>
                )}

                <div className="flex items-center my-4">
                  <span className="flex-1 border-t border-slate-200"></span>
                  <span className="text-sm text-slate-400 px-3">o</span>
                  <span className="flex-1 border-t border-slate-200"></span>
                </div>

                <LocationPickerMap
                  centerLat={20.66}
                  centerLng={-103.35}
                  zoom={12}
                  selected={mapPick ?? textPick}
                  selectedLabel="Mi punto de salida"
                  focus={focusPoint}
                  onPick={handleMapPick}
                  tripOrigins={tripOriginMarkers}
                  onTripOriginClick={handleTripOriginClick}
                  className="rounded-lg border border-slate-300"
                  style={{ height: '280px', width: '100%' }}
                />
                <p className="flex items-start gap-1.5 text-xs text-slate-500 mt-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Haz clic en el mapa para marcar ★ tu punto de salida: la búsqueda y las
                    solicitudes lo usan automáticamente. Los puntos ● son los orígenes de los
                    viajes disponibles. La ubicación que escribas también se marca aquí.
                  </span>
                </p>

                {mapPick ? (
                  <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="flex items-center gap-1.5 text-sm text-green-800 font-medium">
                      <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Mi punto de salida
                    </p>
                    <p className="text-xs text-green-700 mt-1">
                      Lat {mapPick.lat.toFixed(5)} · Lng {mapPick.lng.toFixed(5)}
                    </p>
                    {mapPickAddress && (
                      <p className="text-xs text-green-700 mt-1">
                        Ubicación seleccionada: {mapPickAddress}
                      </p>
                    )}
                    <p className="text-xs text-green-700 mt-1">
                      Se usará automáticamente al solicitar un viaje.
                      {textPick && ' El punto del mapa tiene prioridad sobre el texto escrito.'}
                    </p>
                  </div>
                ) : textPick ? (
                  <div className="mt-3 rounded-xl border border-teal-500/30 bg-teal-50 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-700">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Confirmamos tu texto en el mapa
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{textPick.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Lat {textPick.lat.toFixed(5)} · Lng {textPick.lng.toFixed(5)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
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
                <div className="flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-50 px-4 py-3 text-sm text-teal-700">
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
              <div className="mb-6">
                <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
                  Viajes disponibles{' '}
                  <span className="text-teal-700">({trips.length})</span>
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Haz clic en un viaje para ver su ruta en el mapa y solicitar tu lugar.
                </p>
              </div>

              {isShowingAllTrips && (
                <div className="mb-4">
                  <Alert type="info">Mostrando todos los viajes publicados, ordenados por fecha.</Alert>
                </div>
              )}
              {geoSearchInfo && (
                <div className="mb-4">
                  <Alert type="info">
                    Buscando viajes cerca de «{geoSearchInfo.name}» (ruta a {SEARCH_RADIUS_KM} km · origen a {ORIGIN_RADIUS_KM} km).
                  </Alert>
                </div>
              )}
              {geocodingNotice && (
                <div className="mb-4">
                  <Alert type="warning">{geocodingNotice}</Alert>
                </div>
              )}
              {originRequiredNotice && selectedOrigin === null && (
                <div className="mb-4">
                  <Alert type="warning">{originRequiredNotice}</Alert>
                </div>
              )}

              {/* Ruta del viaje seleccionado: aparece al hacer clic en un resultado, sin
                  repetir la búsqueda. Conserva el punto original del pasajero y, si
                  procede, marca el punto de recogida ajustado sobre la ruta. */}
              {!isLoading && trips.length > 0 && mapTrip && (
                <Card className="p-4 sm:p-5 mb-6">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                        <Route className="w-4 h-4 text-teal-700" aria-hidden="true" />
                        Ruta del viaje seleccionado
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">
                        {mapTrip.origin} → {mapTrip.destination}
                      </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setMapTrip(null)}>
                      <span className="inline-flex items-center gap-2">
                        <X className="w-4 h-4" aria-hidden="true" />
                        Ocultar
                      </span>
                    </Button>
                  </div>

                  {mapTrip.routeGeometry ? (
                    <LocationPickerMap
                      centerLat={mapTrip.routeGeometry.coordinates[0]?.[1] ?? 20.66}
                      centerLng={mapTrip.routeGeometry.coordinates[0]?.[0] ?? -103.35}
                      zoom={11}
                      routeGeometry={mapTrip.routeGeometry}
                      passengerOrigin={searchPoint}
                      passengerLabel="Tu punto de partida"
                      pickupPoint={pickupPoint}
                      pickupLabel={
                        pickupInfo
                          ? `Punto de recogida (a ${formatDistance(pickupInfo.distanceKm * 1000)})`
                          : 'Punto de recogida sobre la ruta'
                      }
                      tripOrigins={tripOriginMarkers}
                      onTripOriginClick={handleTripOriginClick}
                      className="rounded-lg border border-slate-300"
                      style={{ height: '320px', width: '100%' }}
                    />
                  ) : (
                    <p className="text-sm text-slate-500">
                      Este viaje no tiene la geometría de la ruta guardada, así que solo se pueden
                      mostrar tu punto de partida y los datos del viaje.
                    </p>
                  )}

                  {/* Leyenda: punto original → distancia de ajuste → punto sobre la ruta */}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs text-slate-500">
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 h-3 w-3 shrink-0 rounded-full bg-indigo-500 border-2 border-white shadow"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-medium text-slate-900">Origen de los viajes</p>
                        <p>Punto de salida del conductor (●)</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 h-3 w-3 shrink-0 rounded-full bg-green-600 border-2 border-white shadow"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-medium text-slate-900">Tu punto de partida</p>
                        <p>
                          {searchPoint
                            ? `Lat ${searchPoint.lat.toFixed(5)} · Lng ${searchPoint.lng.toFixed(5)}`
                            : 'No señalaste un punto en el mapa'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1 h-3 w-3 shrink-0 rounded-full bg-amber-500 border-2 border-white shadow"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-medium text-slate-900">Punto de recogida sobre la ruta</p>
                        <p>
                          {pickupInfo
                            ? pickupPoint
                              ? `A ${formatDistance(pickupInfo.distanceKm * 1000)} de tu punto`
                              : 'Tu punto ya está sobre la ruta del conductor'
                            : 'No disponible para este viaje'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="mt-2 h-1 w-5 shrink-0 rounded bg-slate-900" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-slate-900">Ruta del conductor</p>
                        <p>
                          {mapTrip.routeGeometry
                            ? `${mapTrip.routeGeometry.coordinates.length} puntos de la ruta origen → CUCEI`
                            : 'Sin geometría guardada'}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {!isLoading && trips.length > 0 && !mapTrip && (
                <p className="flex items-center gap-1.5 mb-4 text-sm text-slate-500">
                  <Route className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Haz clic en un viaje para ver su ruta en el mapa.
                </p>
              )}
              {isLoading ? (
                <Card className="p-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <svg className="animate-spin h-12 w-12 text-teal-700 mb-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-slate-500">Buscando viajes...</p>
                  </div>
                </Card>
              ) : error ? (
                <Card className="p-8 sm:p-10">
                  <Alert type="error">{error}</Alert>
                </Card>
              ) : trips.length === 0 ? (
                <EmptyState
                  icon={Car}
                  title="No se encontraron viajes"
                  description="Intenta con otra fecha u origen, o publica tu propio viaje para llegar a CUCEI."
                  actionLabel="Ofrecer un viaje"
                  actionTo="/ofrecer-viaje"
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {trips.map((trip) => (
                    <Card
                      key={trip.id}
                      className={`p-6 hover cursor-pointer ${
                        mapTrip?.id === trip.id ? 'ring-2 ring-teal-500' : ''
                      }`}
                      hover
                      onClick={() => handleSelectTripOnMap(trip)}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-slate-600">{trip.origin}</span>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-slate-600">{trip.destination}</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-slate-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm text-slate-600">
                            {new Date(trip.date).toLocaleDateString('es-MX', {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-slate-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm text-slate-600">{trip.time}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {trip.matchType === 'textual' && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-teal-500/15 text-teal-800 border border-teal-500/30">
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
                        {trip.matchType === 'routeNearby' && trip.distanceToRouteKm !== null && (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            <Route className="w-3.5 h-3.5" aria-hidden="true" />
                            Su ruta pasa a {formatDistance(trip.distanceToRouteKm * 1000)} de tu punto
                          </span>
                        )}
                      </div>

                      <div className="border-t pt-4 mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-teal-500/15 rounded-full flex items-center justify-center mr-3">
                              <span className="text-teal-700 font-semibold">
                                {trip.driver.name.charAt(0)}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{trip.driver.name}</p>
                              <p className="text-sm text-slate-500">{trip.driver.university}</p>
                              <Link
                                to={`/perfil/${trip.driver.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 mt-1 text-sm font-medium text-teal-700 hover:text-teal-800"
                              >
                                <Eye className="w-4 h-4" aria-hidden="true" /> Ver perfil
                              </Link>
                            </div>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-yellow-400 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                            <span className="font-medium text-slate-900">{trip.driver.rating}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t pt-4">
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-teal-700 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <span className="text-sm text-slate-600">
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
            <Card className="p-8 bg-gradient-to-r from-slate-50 to-teal-500/10 text-center">
              <h3 className="text-xl font-semibold text-slate-900 mb-2">
                ¿No encuentras lo que buscas?
              </h3>
              <p className="text-slate-600 mb-4">
                Considera ofrecer un viaje tú mismo y ayuda a otros estudiantes a llegar a su destino.
              </p>
              <Button variant="outline" size="lg">
                Ofrecer Viaje
              </Button>
            </Card>
          )}
        </div>

      {/* Modal de solicitud de lugar: usa el punto elegido en el mapa, sin
          volver a preguntar el origen. */}
      <Modal open={selectedTrip !== null} onClose={closeModal} title="Solicitar lugar">
        {selectedTrip && selectedOrigin && (
          <div>
            <p className="text-sm text-slate-500 mb-4">
              Viaje:{' '}
              <span className="font-bold text-slate-900">
                {selectedTrip.origin} → CUCEI
              </span>
            </p>

            {modalError && (
              <div className="mb-4">
                <Alert type="error">{modalError}</Alert>
              </div>
            )}

            {/* Origen tomado automáticamente del mapa: el formulario de
                "dirección de recogida" se eliminó para no volver a preguntar. */}
            <div className="rounded-xl border border-teal-500/30 bg-teal-50 p-4 mb-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-700">
                <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                Mi punto de salida
              </p>
              <p className="mt-1 text-sm text-slate-700">{selectedOriginLabel}</p>
              <p className="mt-1 text-xs text-slate-500">
                Lat {selectedOrigin.lat.toFixed(5)} · Lng {selectedOrigin.lng.toFixed(5)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Se usará automáticamente para esta solicitud. Para cambiarlo, cierra esta
                ventana y haz clic en otro punto del mapa.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
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
                disabled={isSubmittingRequest}
              >
                {isSubmittingRequest ? 'Enviando...' : 'Solicitar lugar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

    </AppShell>
  );
};

export default SearchTripPage;