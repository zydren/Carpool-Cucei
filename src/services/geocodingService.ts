/**
 * Servicio de geocodificación usando Nominatim (OpenStreetMap)
 * Documentación: https://nominatim.org/release-docs/develop/api/Search/
 */

export interface GeocodingResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
    postcode?: string;
    road?: string;
    house_number?: string;
  };
}

/**
 * Busca una dirección usando Nominatim
 * @param query Dirección a buscar
 * @param limit Número máximo de resultados (default: 5)
 * @returns Array de resultados de geocodificación
 */
export const searchAddress = async (
  query: string,
  limit: number = 5
): Promise<GeocodingResult[]> => {
  if (!query || query.trim().length === 0) {
    throw new Error('La dirección no puede estar vacía');
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedQuery}&limit=${limit}&addressdetails=1`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Carpool Universitario (carpool-universitario-app)', // Requerido por Nominatim
      },
    });

    if (!response.ok) {
      throw new Error(`Error en la petición a Nominatim: ${response.status}`);
    }

    const data: GeocodingResult[] = await response.json();

    if (!data || data.length === 0) {
      throw new Error('No se encontraron resultados para esa dirección');
    }

    return data;
  } catch (error) {
    console.error('Error en geocodificación:', error);
    throw error;
  }
};

/**
 * Obtiene coordenadas de una dirección específica (primer resultado)
 * @param query Dirección a buscar
 * @returns Objeto con lat, lon y display_name
 */
export const getCoordinates = async (query: string): Promise<{
  lat: number;
  lon: number;
  display_name: string;
}> => {
  const results = await searchAddress(query, 1);
  
  if (results.length === 0) {
    throw new Error('No se encontraron resultados');
  }

  const firstResult = results[0];
  return {
    lat: parseFloat(firstResult.lat),
    lon: parseFloat(firstResult.lon),
    display_name: firstResult.display_name,
  };
};
