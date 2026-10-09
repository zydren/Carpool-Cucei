import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import type { CSSProperties } from 'react';
import L, { type LeafletMouseEvent } from 'leaflet';
import type { LineStringGeometry } from '../services/routingService';
import 'leaflet/dist/leaflet.css';

/** Punto geográfico seleccionado por el usuario en el mapa. */
export interface MapPick {
  lat: number;
  lng: number;
}

/**
 * Punto intermedio (punto de paso) dibujado en el mapa con marcador
 * numerado. Es solo referencia visual: no participa en la selección del
 * origen ni dispara onPick.
 */
export interface WaypointMarker {
  lat: number;
  lng: number;
  /** Número de visita mostrado en el marcador (1, 2, 3...). */
  index: number;
  /** Etiqueta legible aproximada del punto (o null si no hay dirección). */
  label?: string | null;
}

/** Origen de un viaje disponible, dibujado en el mapa como referencia (●). */
export interface TripOriginMarker {
  /** Id del viaje al que pertenece este origen. */
  id: string;
  lat: number;
  lng: number;
  /** Etiqueta mostrada al pasar el cursor (por ejemplo, el nombre del origen). */
  label?: string;
  /** true cuando el viaje es el actualmente seleccionado (se resalta con anillo). */
  highlighted?: boolean;
}

interface LocationPickerMapProps {
  /** Latitud del centro inicial del mapa. */
  centerLat: number;
  /** Longitud del centro inicial del mapa. */
  centerLng: number;
  /** Zoom inicial del mapa (por defecto 12). */
  zoom?: number;
  /** Punto seleccionado por el usuario (null = sin selección). */
  selected?: MapPick | null;
  /**
   * Punto al que el mapa debe desplazarse para confirmar una ubicación
   * escrita por el usuario (por ejemplo, el texto geocodificado).
   * No se usa en los clics, porque ahí el punto ya está a la vista.
   */
  focus?: MapPick | null;
  /**
   * Se llama con las coordenadas al hacer clic en el mapa. Si no se pasa, el
   * mapa es solo de lectura (no captura clics).
   */
  onPick?: (pick: MapPick) => void;
  /** Ruta del conductor: se dibuja completa (LineString origen -> CUCEI). */
  routeGeometry?: LineStringGeometry | null;
  /**
   * Punto de partida ORIGINAL del pasajero. Nunca se sustituye por el punto de
   * recogida ajustado: se dibuja con su propio marcador (verde).
   */
  passengerOrigin?: MapPick | null;
  /** Etiqueta del marcador del punto de partida (opcional). */
  passengerLabel?: string;
  /**
   * Punto de recogida ajustado sobre la ruta (el punto de la ruta más cercano
   * al punto original del pasajero). Se dibuja con otro marcador (ámbar) y se
   * une al punto original con una línea discontinua.
   */
  pickupPoint?: MapPick | null;
  /** Etiqueta del marcador del punto de recogida (opcional). */
  pickupLabel?: string;
  /**
   * Etiqueta permanente junto al punto seleccionado por el usuario
   * (por ejemplo, "Mi punto de salida"). Si no se pasa, el marcador
   * conserva su aspecto actual.
   */
  selectedLabel?: string;
  /**
   * Orígenes de los viajes disponibles que se muestran como referencia (●).
   * No participan en la selección del origen del usuario.
   */
  tripOrigins?: TripOriginMarker[];
  /** Se llama con el id de un viaje cuando se hace clic en su origen (●). */
  onTripOriginClick?: (id: string) => void;
  /**
   * Destino fijo dibujado como referencia (por ejemplo, CUCEI en
   * OfferTripPage). No participa en la selección ni dispara onPick.
   */
  destination?: MapPick | null;
  /**
   * Puntos intermedios (puntos de paso) ya elegidos por el conductor, con
   * marcadores numerados diferenciados. Solo lectura: no modifican el
   * origen, el destino ni disparan onPick.
   */
  waypoints?: WaypointMarker[];
  className?: string;
  style?: CSSProperties;
}

// Icono del marcador de búsqueda (mismo estilo que el usado en OfferTripPage)
const pickIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #0F766E; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Icono de "Mi punto de salida" (★): solo cuando la página etiqueta el punto
// del usuario, para diferenciarlo claramente de los orígenes de los viajes (●).
const myOriginIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #0F766E; width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; line-height: 1;">★</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

// Icono del origen de un viaje disponible (● índigo: conductor, no pasajero)
const tripOriginIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #4F46E5; width: 18px; height: 18px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Origen del viaje actualmente seleccionado (mismo ● índigo, con anillo)
const tripOriginHighlightedIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #4F46E5; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 4px rgba(79,70,229,0.35), 0 1px 3px rgba(0,0,0,0.3);"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// Icono del destino fijo del viaje (CUCEI en OfferTripPage): círculo navy
// para diferenciarlo del ★ teal del origen y de los ● índigo de los viajes.
const destinationIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #0F172A; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/**
 * Icono de punto intermedio (punto de paso): círculo ámbar numerado con el
 * orden de visita, para diferenciarlo del origen (★ teal), de CUCEI (navy),
 * de los viajes (● índigo) y de los puntos del pasajero (verde/ámbar).
 */
const waypointIcon = (visitNumber: number) =>
  L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: #D97706; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 700; line-height: 1;">${visitNumber}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

// Icono del punto de partida original del pasajero (verde)
const passengerIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #16A34A; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Icono del punto de recogida ajustado sobre la ruta (ámbar)
const pickupIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #F59E0B; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Colores compartidos entre la polilínea y la leyenda de la página.
const ROUTE_COLOR = '#0F766E';
const CONNECTOR_COLOR = '#F59E0B';

/**
 * Captura el clic del usuario sobre el mapa y llama a onPick con las
 * coordenadas del punto. Se monta como hijo del MapContainer.
 */
const MapClickHandler = ({ onPick }: { onPick: (lat: number, lng: number) => void }) => {
  const map = useMap();

  useEffect(() => {
    const handler = (e: LeafletMouseEvent) => {
      // Leaflet expone las coordenadas del clic en event.latlng
      onPick(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [map, onPick]);

  return null;
};

/** Zoom al que se acerca el mapa cuando se confirma una ubicación escrita. */
const FOCUS_ZOOM = 14;

/**
 * Desplaza el mapa al punto confirmado (texto geocodificado) para que el
 * usuario compruebe visualmente la ubicación. Se monta como hijo del
 * MapContainer y solo actúa cuando el punto cambia.
 */
const MapFocus = ({ point }: { point: MapPick | null }) => {
  const map = useMap();

  useEffect(() => {
    if (!point) return;
    const lat = point.lat;
    const lng = point.lng;
    map.setView([lat, lng], Math.max(map.getZoom(), FOCUS_ZOOM), { animate: true });
  }, [map, point]);

  return null;
};

interface MapRouteLayerProps {
  /** Ruta en formato Leaflet ([lat, lng]) ya convertida y memoizada. */
  positions: [number, number][];
  passengerOrigin: MapPick | null;
  passengerLabel: string;
  pickupPoint: MapPick | null;
  pickupLabel: string;
}

/**
 * Dibuja la ruta del viaje seleccionado junto con el punto de partida original
 * del pasajero y, si existe, el punto de recogida ajustado sobre la ruta
 * (unidos por una línea discontinua que representa la distancia de ajuste).
 *
 * Se monta como hijo del MapContainer: al recibir la ruta encuadra el mapa
 * para que se vea completa, sin necesidad de repetir la búsqueda.
 */
const MapRouteLayer = ({
  positions,
  passengerOrigin,
  passengerLabel,
  pickupPoint,
  pickupLabel,
}: MapRouteLayerProps) => {
  const map = useMap();

  useEffect(() => {
    if (positions.length < 2) return;
    map.fitBounds(L.latLngBounds(positions), { padding: [24, 24] });
  }, [map, positions]);

  return (
    <>
      <Polyline positions={positions} pathOptions={{ color: ROUTE_COLOR, weight: 5, opacity: 0.85 }} />

      {passengerOrigin && (
        <Marker position={[passengerOrigin.lat, passengerOrigin.lng]} icon={passengerIcon}>
          <Tooltip permanent direction="top" offset={[0, -12]}>
            {passengerLabel}
          </Tooltip>
        </Marker>
      )}

      {pickupPoint && passengerOrigin && (
        <>
          {/* Línea de ajuste: del punto original al punto sobre la ruta. */}
          <Polyline
            positions={[
              [passengerOrigin.lat, passengerOrigin.lng],
              [pickupPoint.lat, pickupPoint.lng],
            ]}
            pathOptions={{ color: CONNECTOR_COLOR, weight: 3, dashArray: '6 6' }}
          />
          <Marker position={[pickupPoint.lat, pickupPoint.lng]} icon={pickupIcon}>
            <Tooltip permanent direction="top" offset={[0, -12]}>
              {pickupLabel}
            </Tooltip>
          </Marker>
        </>
      )}
    </>
  );
};

/**
 * Mapa interactivo (Leaflet + OpenStreetMap) que permite al usuario elegir
 * un punto con un clic. Mantiene UN solo marcador: si se hace clic en otro
 * lugar, el marcador se mueve.
 *
 * Además puede mostrar la ruta del conductor de un viaje seleccionado, el
 * punto de partida original del pasajero y el punto de recogida ajustado sobre
 * esa ruta (sin sustituir nunca el punto original).
 */
const LocationPickerMap = ({
  centerLat,
  centerLng,
  zoom = 12,
  selected = null,
  selectedLabel,
  focus = null,
  onPick,
  tripOrigins = [],
  onTripOriginClick,
  destination = null,
  waypoints = [],
  routeGeometry = null,
  passengerOrigin = null,
  passengerLabel = 'Tu punto de partida',
  pickupPoint = null,
  pickupLabel = 'Punto de recogida sobre la ruta',
  className,
  style,
}: LocationPickerMapProps) => {
  // La geometría guardada está en [lng, lat]; Leaflet espera [lat, lng].
  // Se memoiza para que el encuadre solo se reejecute si cambia la ruta.
  const routePositions = useMemo<[number, number][]>(
    () => (routeGeometry?.coordinates ?? []).map(([lng, lat]) => [lat, lng] as [number, number]),
    [routeGeometry]
  );

  return (
    <MapContainer center={[centerLat, centerLng]} zoom={zoom} className={className} style={style}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {onPick && <MapClickHandler onPick={(lat, lng) => onPick({ lat, lng })} />}
      <MapFocus point={focus} />
      {selected && (
        <Marker
          position={[selected.lat, selected.lng]}
          icon={selectedLabel ? myOriginIcon : pickIcon}
        >
          {selectedLabel && (
            <Tooltip permanent direction="top" offset={[0, -14]}>
              {selectedLabel}
            </Tooltip>
          )}
        </Marker>
      )}
      {/* Orígenes de los viajes (●): el clic resalta el viaje, pero nunca fija
          el origen del usuario (en Leaflet los marcadores no propagan el clic
          al mapa, así que no disparan onPick). */}
      {tripOrigins.map((origin) => (
        <Marker
          key={origin.id}
          position={[origin.lat, origin.lng]}
          icon={origin.highlighted ? tripOriginHighlightedIcon : tripOriginIcon}
          eventHandlers={{
            click: () => onTripOriginClick?.(origin.id),
          }}
        >
          {origin.label && <Tooltip direction="top">{origin.label}</Tooltip>}
        </Marker>
      ))}
      {/* Destino fijo (si la página lo pasa): solo referencia visual. */}
      {destination && (
        <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} />
      )}
      {/* Puntos intermedios (puntos de paso) con número de visita. El clic
          en un marcador NO se propaga al mapa (Leaflet), así que nunca
          disparan onPick ni alteran el origen. */}
      {waypoints.map((waypoint) => (
        <Marker
          key={`waypoint-${waypoint.index}-${waypoint.lat},${waypoint.lng}`}
          position={[waypoint.lat, waypoint.lng]}
          icon={waypointIcon(waypoint.index)}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            {waypoint.label ?? `Punto de paso ${waypoint.index}`}
          </Tooltip>
        </Marker>
      ))}
      {routePositions.length >= 2 && (
        <MapRouteLayer
          positions={routePositions}
          passengerOrigin={passengerOrigin}
          passengerLabel={passengerLabel}
          pickupPoint={pickupPoint}
          pickupLabel={pickupLabel}
        />
      )}
    </MapContainer>
  );
};

export default LocationPickerMap;