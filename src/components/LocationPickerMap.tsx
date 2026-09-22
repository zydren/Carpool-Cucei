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
  className?: string;
  style?: CSSProperties;
}

// Icono del marcador de búsqueda (mismo estilo que el usado en OfferTripPage)
const pickIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #4F46E5; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
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
const ROUTE_COLOR = '#4F46E5';
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
  focus = null,
  onPick,
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
      {selected && <Marker position={[selected.lat, selected.lng]} icon={pickIcon} />}
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