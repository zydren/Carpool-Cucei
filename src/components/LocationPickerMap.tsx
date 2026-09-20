import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import type { CSSProperties } from 'react';
import L, { type LeafletMouseEvent } from 'leaflet';
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
  selected: MapPick | null;
  /**
   * Punto al que el mapa debe desplazarse para confirmar una ubicación
   * escrita por el usuario (por ejemplo, el texto geocodificado).
   * No se usa en los clics, porque ahí el punto ya está a la vista.
   */
  focus?: MapPick | null;
  /** Se llama con las coordenadas al hacer clic en el mapa. */
  onPick: (pick: MapPick) => void;
  className?: string;
  style?: CSSProperties;
}

// Icono del marcador (mismo estilo que el usado en OfferTripPage)
const pickIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #4F46E5; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

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

/**
 * Mapa interactivo (Leaflet + OpenStreetMap) que permite al usuario elegir
 * un punto con un clic. Mantiene UN solo marcador: si se hace clic en otro
 * lugar, el marcador se mueve.
 */
const LocationPickerMap = ({
  centerLat,
  centerLng,
  zoom = 12,
  selected,
  focus = null,
  onPick,
  className,
  style,
}: LocationPickerMapProps) => {
  return (
    <MapContainer center={[centerLat, centerLng]} zoom={zoom} className={className} style={style}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickHandler onPick={(lat, lng) => onPick({ lat, lng })} />
      <MapFocus point={focus} />
      {selected && <Marker position={[selected.lat, selected.lng]} icon={pickIcon} />}
    </MapContainer>
  );
};

export default LocationPickerMap;