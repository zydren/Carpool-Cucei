/**
 * Servicio de rutas usando OSRM (Open Source Routing Machine)
 * Documentación: http://project-osrm.org/docs/v5.24.0/api/
 */

export interface RouteResult {
  distance: number; // en metros
  duration: number; // en segundos
  geometry: LineStringGeometry;
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][]; // [longitude, latitude]
}

/**
 * Calcula la ruta entre dos puntos usando OSRM
 * @param originLon Longitud del origen
 * @param originLat Latitud del origen
 * @param destLon Longitud del destino
 * @param destLat Latitud del destino
 * @returns Objeto con distancia, duración y geometría de la ruta
 */
export const calculateRoute = async (
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number
): Promise<RouteResult> => {
  const url = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${destLon},${destLat}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Error en la petición a OSRM: ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No se pudo calcular una ruta entre los puntos especificados');
    }

    const route = data.routes[0];
    
    return {
      distance: route.distance, // metros
      duration: route.duration, // segundos
      geometry: route.geometry, // GeoJSON LineString
    };
  } catch (error) {
    console.error('Error en cálculo de ruta:', error);
    throw error;
  }
};

/**
 * Formatea la distancia para mostrarla al usuario
 * @param distanceInMeters Distancia en metros
 * @returns String formateado (ej: "8.4 km")
 */
export const formatDistance = (distanceInMeters: number): string => {
  const km = distanceInMeters / 1000;
  if (km < 1) {
    return `${Math.round(distanceInMeters)} m`;
  }
  return `${km.toFixed(1)} km`;
};

/**
 * Formatea la duración para mostrarla al usuario
 * @param durationInSeconds Duración en segundos
 * @returns String formateado (ej: "21 min")
 */
export const formatDuration = (durationInSeconds: number): string => {
  const minutes = Math.round(durationInSeconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${remainingMinutes} min`;
};
