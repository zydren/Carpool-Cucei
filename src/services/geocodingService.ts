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

/** Opciones extra para la búsqueda en Nominatim. */
export interface GeocodingSearchOptions {
  /**
   * Caja geográfica `left,top,right,bottom` (longitud/latitud) con la que
   * Nominatim *prioriza* los resultados cercanos sin descartar los lejanos
   * (se envía con `bounded=0`).
   */
  viewbox?: string;
}

/**
 * Busca una dirección usando Nominatim
 * @param query Dirección a buscar
 * @param limit Número máximo de resultados (default: 5)
 * @param options Opciones extra (por ejemplo, priorizar una zona geográfica)
 * @returns Array de resultados de geocodificación
 */
export const searchAddress = async (
  query: string,
  limit: number = 5,
  options: GeocodingSearchOptions = {}
): Promise<GeocodingResult[]> => {
  if (!query || query.trim().length === 0) {
    throw new Error('La dirección no puede estar vacía');
  }

  const encodedQuery = encodeURIComponent(query);
  const viewboxParam = options.viewbox
    ? `&viewbox=${encodeURIComponent(options.viewbox)}&bounded=0`
    : '';
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedQuery}&limit=${limit}&addressdetails=1${viewboxParam}`;

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

/** Ubicación geocodificada reutilizable por los buscadores del proyecto. */
export interface GeocodedLocation {
  lat: number;
  lng: number;
  displayName: string;
}

/**
 * Placeholder temporal (carácter de uso privado) que evita perder la "ñ"
 * mientras se eliminan los diacríticos. Se restaura al final.
 */
const N_TILDE_PLACEHOLDER = '\uE000';

/**
 * Puntuación típica de direcciones: se convierte en espacio al normalizar.
 * No se tocan guiones, números ni barras ("1200-A" se conserva).
 */
const ADDRESS_PUNCTUATION = /[.,;:#"'()[\]{}!?]/g;

/**
 * Normaliza una consulta de ubicación para reintentar la búsqueda cuando el
 * texto escrito no coincide literalmente con el nombre oficial del lugar:
 *
 * - pasa a minúsculas,
 * - elimina acentos y diacríticos (á → a, ó → o, ü → u),
 * - convierte la puntuación de direcciones en espacios ("Av." → "av"),
 * - colapsa espacios duplicados y recorta los extremos,
 * - conserva palabras, números y guiones útiles ("1200-A"),
 * - conserva la "ñ" (no es un acento decorativo: "Cañadas" ≠ "Canadas").
 *
 * No reemplaza palabras, no expande abreviaturas y nunca inventa direcciones.
 *
 * Ejemplos:
 *   "Áv. Vallarta"             → "av vallarta"
 *   "Arcos de Zapopán"         → "arcos de zapopan"
 *   "  Arcos   de   Zapopan  " → "arcos de zapopan"
 */
export const normalizeLocationQuery = (query: string): string => {
  return query
    .toLowerCase()
    .replace(/ñ/g, N_TILDE_PLACEHOLDER)
    .normalize('NFD') // separa cada letra de su diacrítico
    .replace(/[\u0300-\u036f]/g, '') // quita los diacríticos
    .replace(/\uE000/g, 'ñ')
    .replace(ADDRESS_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Un solo intento de geocodificación con manejo suave de errores: devuelve null
 * (en lugar de lanzar) si Nominatim no encuentra la ubicación o si hubo un
 * error de red/servicio, para poder reintentar o hacer fallback textual.
 */
const geocodeOnce = async (query: string): Promise<GeocodedLocation | null> => {
  try {
    const coords = await getCoordinates(query);
    return {
      lat: coords.lat,
      lng: coords.lon,
      displayName: coords.display_name,
    };
  } catch {
    return null;
  }
};

/**
 * Geocodifica una consulta con manejo "suave" de errores.
 *
 * Hace como máximo DOS intentos:
 *   1. el texto tal como lo escribió el usuario;
 *   2. solo si el primero no encontró nada, el mismo texto normalizado
 *      (minúsculas, sin acentos, sin espacios duplicados, sin puntuación).
 *
 * Si el texto ya estaba normalizado, no se repite la consulta. Si ninguno de
 * los dos intentos encuentra la ubicación, devuelve null para que el buscador
 * conserve su comportamiento de error/fallback actual.
 */
export const geocodeQuery = async (query: string): Promise<GeocodedLocation | null> => {
  if (!query || query.trim().length === 0) {
    return null;
  }

  const trimmed = query.trim();

  // 1) Intento normal: el texto tal cual lo escribió el usuario.
  const direct = await geocodeOnce(trimmed);
  if (direct) {
    return direct;
  }

  // 2) Segundo intento con el texto normalizado. Si normalizar no cambia nada
  //    relevante (por ejemplo, solo cambian las mayúsculas, que Nominatim ya
  //    ignora), se evita una llamada innecesaria al servicio.
  const normalized = normalizeLocationQuery(trimmed);
  if (normalized === '' || normalized === trimmed.toLowerCase()) {
    console.error('No se encontró la ubicación escrita (se usará fallback textual):', trimmed);
    return null;
  }

  const retry = await geocodeOnce(normalized);
  if (retry) {
    console.info(`Ubicación encontrada usando el texto normalizado: "${normalized}"`);
    return retry;
  }

  console.error('No se encontró la ubicación escrita (se usará fallback textual):', trimmed);
  return null;
};

/**
 * Caja geográfica aproximada de la zona metropolitana de Guadalajara, donde
 * está CUCEI y donde opera el carpool. Solo se usa como *prioridad* en la
 * búsqueda aproximada de sugerencias (nunca descarta resultados de fuera).
 */
const GUADALAJARA_VIEWBOX = '-104.2,21.2,-102.6,20.2';

/** Parecido mínimo (0..1) para mostrar una sugerencia de la búsqueda aproximada. */
const MIN_SUGGESTION_SIMILARITY = 0.5;

/** Longitud mínima de una palabra para usarla como ancla de la búsqueda aproximada. */
const MIN_ANCHOR_LENGTH = 4;

/** Distancia de edición (Levenshtein) entre dos palabras. */
const levenshteinDistance = (a: string, b: string): number => {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const saved = previous[j];
      previous[j] = Math.min(
        previous[j] + 1, // borrado
        previous[j - 1] + 1, // inserción
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1) // sustitución
      );
      diagonal = saved;
    }
  }

  return previous[b.length];
};

/**
 * Parecido (0..1) entre lo escrito y un candidato de Nominatim: para cada
 * palabra escrita se busca la palabra más parecida del candidato. Un valor
 * alto significa que la sugerencia se parece al texto aunque tenga letras de
 * más o de menos ("perfeco belenes" ≈ "Periférico Belenes").
 */
const locationSimilarity = (query: string, candidate: string): number => {
  const queryWords = normalizeLocationQuery(query).split(' ').filter(Boolean);
  const candidateWords = normalizeLocationQuery(candidate).split(' ').filter(Boolean);

  if (queryWords.length === 0 || candidateWords.length === 0) {
    return 0;
  }

  const total = queryWords.reduce((sum, word) => {
    const best = candidateWords.reduce((bestWord, candidateWord) => {
      const distance = levenshteinDistance(word, candidateWord);
      const score = 1 - distance / Math.max(word.length, candidateWord.length);
      return score > bestWord ? score : bestWord;
    }, 0);
    return sum + best;
  }, 0);

  return total / queryWords.length;
};

/**
 * Un intento de búsqueda de sugerencias (varios resultados) que nunca lanza:
 * devuelve [] si Nominatim no encuentra nada o si falla la red.
 */
const searchSuggestionsOnce = async (
  query: string,
  limit: number,
  viewbox?: string
): Promise<GeocodedLocation[]> => {
  try {
    const results = await searchAddress(query, limit, viewbox ? { viewbox } : {});
    return results.map((result) => ({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      displayName: result.display_name,
    }));
  } catch {
    return [];
  }
};

/**
 * Ordena los candidatos por parecido real con lo escrito, elimina repetidos y
 * descarta los que no se parecen lo suficiente.
 */
const rankSuggestions = (
  query: string,
  candidates: GeocodedLocation[],
  limit: number
): GeocodedLocation[] => {
  const seen = new Set<string>();

  return candidates
    .map((candidate) => ({
      candidate,
      score: locationSimilarity(query, candidate.displayName),
    }))
    .filter(({ candidate, score }) => {
      const key = normalizeLocationQuery(candidate.displayName);
      if (score < MIN_SUGGESTION_SIMILARITY || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
};

/** Opciones del autocompletado de ubicaciones. */
export interface SuggestionOptions {
  /**
   * Si es `true`, solo se hace la búsqueda aproximada (paso 3). Se usa cuando
   * el texto exacto ya se intentó antes en `geocodeQuery` y falló, para no
   * repetir las mismas consultas a Nominatim.
   */
  approximateOnly?: boolean;
}

/**
 * Sugerencias de ubicación para el autocompletado del buscador.
 *
 * Devuelve hasta `limit` lugares parecidos al texto escrito, en este orden:
 *   1. resultados literales del texto escrito (Nominatim ya los ordena por
 *      relevancia, así que se respeta su orden);
 *   2. si no hubo, resultados del texto normalizado (sin acentos ni
 *      puntuación, espacios colapsados);
 *   3. si tampoco hubo, una búsqueda aproximada que usa como ancla las dos
 *      palabras más largas del texto (priorizando la zona de Guadalajara) y
 *      ordena los candidatos por parecido real con lo escrito.
 *
 * Hace como máximo 4 consultas a Nominatim, y solo en el caso de que el texto
 * escrito no exista tal cual; en el caso normal basta una sola consulta.
 */
export const searchLocationSuggestions = async (
  query: string,
  limit: number = 5,
  options: SuggestionOptions = {}
): Promise<GeocodedLocation[]> => {
  const trimmed = query.trim();

  if (trimmed === '') {
    return [];
  }

  const normalized = normalizeLocationQuery(trimmed);

  if (!options.approximateOnly) {
    // 1) Texto literal.
    const direct = await searchSuggestionsOnce(trimmed, limit);
    if (direct.length > 0) {
      return direct;
    }

    // 2) Texto normalizado (solo si normalizar cambia algo relevante).
    if (normalized !== '' && normalized !== trimmed.toLowerCase()) {
      const retried = await searchSuggestionsOnce(normalized, limit);
      if (retried.length > 0) {
        return retried;
      }
    }
  }

  // 3) Búsqueda aproximada con las dos palabras más largas como ancla.
  const anchors = normalized
    .split(' ')
    .filter((word) => word.length >= MIN_ANCHOR_LENGTH)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);

  if (anchors.length < 2) {
    return [];
  }

  const candidates: GeocodedLocation[] = [];
  for (const anchor of anchors) {
    const found = await searchSuggestionsOnce(
      anchor,
      // Límite amplio a propósito: la sugerencia buscada ("Periférico Belenes"
      // para "perfeco belenes") puede aparecer más abajo en los resultados del
      // ancla, y es el ranking por parecido quien la sube al primer lugar.
      Math.max(limit * 4, 20),
      GUADALAJARA_VIEWBOX
    );
    candidates.push(...found);
  }

  return rankSuggestions(trimmed, candidates, limit);
};
