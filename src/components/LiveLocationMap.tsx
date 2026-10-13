import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { CSSProperties } from 'react';
import 'leaflet/dist/leaflet.css';

/**
 * Mapa de posiciones en vivo (GPS).
 *
 * Se REUTILIZA el mismo stack que LocationPickerMap (react-leaflet + los tiles
 * de OpenStreetMap ya usados en el proyecto); no se añade ninguna biblioteca
 * nueva ni un segundo proveedor de mapas.
 *
 * Sirve para dos casos con el mismo componente:
 *   1. La prueba GPS del perfil (un solo punto: el usuario).
 *   2. El seguimiento compartido de un viaje (varios participantes).
 */

/** Participante posicionado en el mapa. */
export interface LiveParticipant {
  /** Id del usuario (profiles.id). */
  userId: string;
  /** Nombre visible en el marcador. */
  name: string;
  lat: number;
  lng: number;
  /** Rol en el viaje: cambia el color del marcador. */
  role: 'driver' | 'passenger';
  /** Instante de la última lectura (ISO) para mostrar su antigüedad. */
  updatedAt: string;
  /** true si esta posición es la del usuario que mira el mapa. */
  isMe?: boolean;
}

interface LiveLocationMapProps {
  /** Puntos a dibujar. */
  participants: LiveParticipant[];
  /** Centro inicial (se usa hasta que haya puntos que encuadrar). */
  centerLat: number;
  centerLng: number;
  /** Zoom inicial. */
  zoom?: number;
  /**
   * Contador que, al cambiar, fuerza un reencuadre automático del mapa para
   * que se vean todos los puntos. No se usa para cada lectura (sería molesto):
   * el usuario puede recentrar a mano cuando quiera.
   */
  recenterToken?: number;
  className?: string;
  style?: CSSProperties;
}

// Marcador del CONDUCTOR: círculo índigo con borde blanco.
const driverIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #4F46E5; width: 26px; height: 26px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35);"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// Marcador del PASAJERO: círculo teal.
const passengerIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #0F766E; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Marcador del usuario actual (prueba GPS): círculo teal con pulso, más grande.
const meIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background-color: #0F766E; width: 30px; height: 30px; border-radius: 50%; border: 4px solid white; box-shadow: 0 0 0 6px rgba(15,118,110,0.25), 0 2px 6px rgba(0,0,0,0.35);"></div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/**
 * Encuadra el mapa para que se vean todos los participantes.
 * Se monta como hijo del MapContainer y actúa cuando cambia el token.
 */
const RecenterController = ({
  participants,
  recenterToken,
}: {
  participants: LiveParticipant[];
  recenterToken: number;
}) => {
  const map = useMap();

  useEffect(() => {
    if (recenterToken < 0) return;

    const valid = participants.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    if (valid.length === 0) return;

    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lng], Math.max(map.getZoom(), 15), {
        animate: true,
      });
      return;
    }

    map.fitBounds(
      L.latLngBounds(valid.map((p) => [p.lat, p.lng] as [number, number])),
      { padding: [32, 32] }
    );
  }, [map, participants, recenterToken]);

  return null;
};

export default function LiveLocationMap({
  participants,
  centerLat,
  centerLng,
  zoom = 14,
  recenterToken = -1,
  className,
  style,
}: LiveLocationMapProps) {
  const valid = participants.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );

  return (
    <MapContainer
      center={[centerLat, centerLng]}
      zoom={zoom}
      className={className}
      style={style}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {valid.map((participant) => (
        <Marker
          key={participant.userId}
          position={[participant.lat, participant.lng]}
          icon={participant.isMe ? meIcon : participant.role === 'driver' ? driverIcon : passengerIcon}
        >
          {/* Etiqueta permanente: quién es y de qué hora es la lectura. */}
          <Tooltip permanent direction="top" offset={[0, -16]}>
            <span style={{ whiteSpace: 'nowrap' }}>
              {participant.name}
              {participant.isMe ? ' (tú)' : ''} ·{' '}
              {new Date(participant.updatedAt).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </Tooltip>
        </Marker>
      ))}

      <RecenterController participants={valid} recenterToken={recenterToken} />
    </MapContainer>
  );
}
