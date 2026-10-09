/**
 * ============================================================
 * ETAPA DEMANDA — DASHBOARD DE PREDICCIÓN (servicio de datos)
 * ============================================================
 *
 * Prepara y agrega los datos de `/analitica/demanda`. Reutiliza el dataset de
 * la ETAPA 1 (`getMobilityDataset()` de analyticsService) y el modelo de la
 * ETAPA 2 (`trainDemandModel` / `predictDemand` de demandModel): este archivo
 * NO entrena nada propio ni duplica la lógica de etiquetado/clasificación.
 *
 * Fuentes de datos (ambas REALES, sin identificadores inventados):
 *   1. Viajes + solicitudes: `getMobilityDataset()` (RPC anonimizado o
 *      respaldo RLS). Una fila = un viaje.
 *   2. Coordenadas: tabla `trips` leída DIRECTAMENTE
 *      (`origin, origin_lat, origin_lng`), porque la vista
 *      `trips_with_driver` no expone las columnas geográficas. La consulta
 *      respeta RLS tal cual (viajes 'active' visibles + propios); nunca se
 *      intenta eludir restricciones.
 *
 * Reglas de integridad que aplica este servicio:
 *   - El dataset anonimizado NO trae identificadores de viaje: no se
 *     relacionan registros individuales; la unión se hace POR ZONA, usando en
 *     ambos lados la misma regla de normalización (`normalizeOriginZone`,
 *     idéntica a la del SQL de la migración).
 *   - Un viaje nunca se cuenta dos veces: cada agregado recorre la lista una
 *     sola vez y los conteos son sumas directas.
 *   - Las observaciones (reales) y las predicciones del modelo (estimadas)
 *     se mantienen separadas en todo momento.
 *   - Si una zona no tiene coordenadas, conserva sus estadísticas pero no se
 *     dibuja ningún marcador geográfico ficticio.
 */

import { supabase } from '../lib/supabase';
import {
  getMobilityDataset,
  normalizeOriginZone,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
} from './analyticsService';
import type {
  MobilityDataset,
  MobilityRecord,
  MobilityDataSource,
} from './analyticsService';
import {
  classifyDemand,
  DEMAND_CLASS_BADGE,
  DEMAND_CLASS_LABELS,
  DEMAND_CLASS_ORDER,
  MIN_TRAINING_RECORDS,
  predictDemand,
  trainDemandModel,
} from './demandModel';
import type {
  DemandClass,
  DemandFeatures,
  DemandModelResult,
} from './demandModel';

export {
  DEMAND_CLASS_BADGE,
  DEMAND_CLASS_LABELS,
  DEMAND_CLASS_ORDER,
  MIN_TRAINING_RECORDS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
};
export type {
  DemandClass,
  DemandFeatures,
  DemandModelResult,
  MobilityDataSource,
  MobilityDataset,
  MobilityRecord,
};

/** Nº mínimo de registros para el análisis (misma barrera que la ETAPA 1). */
export const MIN_DASHBOARD_RECORDS = 35;

/** Tramos horarios fijos para los filtros y agregados del dashboard. */
export interface Daypart {
  /** Identificador estable ('morning' | 'afternoon' | 'evening' | 'night'). */
  id: string;
  /** Etiqueta legible. */
  label: string;
  /** Rango de horas [inicio, fin), en hora local 0–23. */
  startHour: number;
  endHour: number;
}

export const DAYPARTS: Daypart[] = [
  { id: 'morning', label: 'Mañana (6–11)', startHour: 6, endHour: 12 },
  { id: 'afternoon', label: 'Tarde (12–17)', startHour: 12, endHour: 18 },
  { id: 'evening', label: 'Noche (18–23)', startHour: 18, endHour: 24 },
  { id: 'night', label: 'Madrugada (0–5)', startHour: 0, endHour: 6 },
];

/** Filtros del dashboard (todos opcionales; 'all' = sin filtrar). */
export interface DemandFilters {
  /** Día de la semana 1–7 (convención del dataset) o 'all'. */
  dayOfWeek: number | 'all';
  /** Tramo horario o 'all'. */
  daypart: string | 'all';
  /** Zona normalizada o 'all'. */
  zone: string | 'all';
}

export const ALL_DEMAND_FILTERS: DemandFilters = {
  dayOfWeek: 'all',
  daypart: 'all',
  zone: 'all',
};

/** Devuelve el tramo al que pertenece una hora 0–23, o null si es inválida. */
export const daypartOfHour = (hour: number): Daypart | null => {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return DAYPARTS.find((part) => hour >= part.startHour && hour < part.endHour) ?? null;
};

/**
 * Filtra registros con los filtros del dashboard. Función PURA.
 * Un registro con día/hora no interpretables solo sobrevive si no se filtra
 * por día ni por tramo (nunca se inventa su ubicación temporal).
 */
export const filterRecords = (
  records: MobilityRecord[],
  filters: DemandFilters
): MobilityRecord[] =>
  records.filter((record) => {
    if (filters.dayOfWeek !== 'all' && record.dayOfWeek !== filters.dayOfWeek) {
      return false;
    }
    if (filters.daypart !== 'all') {
      const part = daypartOfHour(record.hour);
      if (!part || part.id !== filters.daypart) {
        return false;
      }
    }
    if (filters.zone !== 'all' && record.originZone !== filters.zone) {
      return false;
    }
    return true;
  });

/** Zonas disponibles en un conjunto de registros (orden alfabético). */
export const availableZones = (records: MobilityRecord[]): string[] => {
  const zones = new Set<string>();
  for (const record of records) {
    if (record.originZone) {
      zones.add(record.originZone);
    }
  }
  return [...zones].sort((a, b) => a.localeCompare(b, 'es-MX'));
};



/** Conteo de registros analizados (un registro = un viaje). */
export const countTrips = (records: MobilityRecord[]): number => records.length;

/**
 * Solicitudes observadas en los registros. Cada registro ya trae el total de
 * solicitudes de SU viaje, por lo que la suma NO duplica viajes. Devuelve
 * null si la fuente no incluye conteos reales (vía 'visible').
 */
export const sumObservedRequests = (
  records: MobilityRecord[],
  source: MobilityDataSource
): number | null => {
  if (source !== 'dataset') {
    return null;
  }
  return records.reduce((sum, record) => sum + Math.max(0, record.requestedSeats), 0);
};

/** Clase de demanda observada de un registro, o null si no es etiquetable. */
export const observedClassOf = (record: MobilityRecord): DemandClass | null =>
  classifyDemand(record.requestedSeats, record.availableSeats);

/** Distribución de clases observadas en los registros (función PURA). */
export const observedClassDistribution = (
  records: MobilityRecord[]
): Record<DemandClass, number> => {
  const distribution: Record<DemandClass, number> = { low: 0, medium: 0, high: 0 };
  for (const record of records) {
    const label = observedClassOf(record);
    if (label !== null) {
      distribution[label] += 1;
    }
  }
  return distribution;
};

/** Features del modelo para un registro; null si el registro no es predecible. */
export const featuresOf = (record: MobilityRecord): DemandFeatures | null => {
  if (
    !Number.isInteger(record.dayOfWeek) ||
    record.dayOfWeek < 1 ||
    record.dayOfWeek > 7 ||
    !Number.isInteger(record.hour) ||
    record.hour < 0 ||
    record.hour > 23
  ) {
    return null;
  }
  if (!Number.isFinite(record.availableSeats) || record.availableSeats < 0) {
    return null;
  }
  const distanceKm = record.distanceKm === null ? 0 : record.distanceKm;
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return null;
  }
  return {
    hour: record.hour,
    dayOfWeek: record.dayOfWeek,
    distanceKm,
    availableSeats: record.availableSeats,
  };
};

/**
 * Predicción in-sample de cada registro predecible con el árbol ENTRENADO.
 * Se limita a registros etiquetables para comparar solo magnitudes
 * compatibles (clase observada vs. clase predicha). Devuelve la lista de
 * pares {observed, predicted}.
 */
export const inSamplePredictions = (
  records: MobilityRecord[],
  model: DemandModelResult
): { observed: DemandClass; predicted: DemandClass }[] => {
  if (!model.trained || model.tree === null) return [];
  const pairs: { observed: DemandClass; predicted: DemandClass }[] = [];
  for (const record of records) {
    const observed = observedClassOf(record);
    const features = featuresOf(record);
    if (observed === null || features === null) continue;
    pairs.push({ observed, predicted: predictDemand(model.tree, features).demand });
  }
  return pairs;
};

/** Conteo por clase de los observados de los pares (para la gráfica). */
export const observedCountsFromPairs = (
  pairs: { observed: DemandClass; predicted: DemandClass }[]
): Record<DemandClass, number> => {
  const counts: Record<DemandClass, number> = { low: 0, medium: 0, high: 0 };
  for (const pair of pairs) {
    counts[pair.observed] += 1;
  }
  return counts;
};

/** Conteo por clase de los predichos de los pares (para la gráfica). */
export const predictedCountsFromPairs = (
  pairs: { observed: DemandClass; predicted: DemandClass }[]
): Record<DemandClass, number> => {
  const counts: Record<DemandClass, number> = { low: 0, medium: 0, high: 0 };
  for (const pair of pairs) {
    counts[pair.predicted] += 1;
  }
  return counts;
};

/** Estadísticas de una zona para la tabla/leyenda del dashboard. */
export interface ZoneDemandStats {
  zone: string;
  /** Viajes (registros) de la zona. */
  trips: number;
  /** Solicitudes observadas (null si la fuente no las trae). */
  observedRequests: number | null;
  /** Clase observada mayoritaria (null si no hay registros etiquetables). */
  observedClass: DemandClass | null;
  /** Clase predicha mayoritaria (null si el modelo no está entrenado). */
  predictedClass: DemandClass | null;
  /** ¿Tiene coordenadas reales para el mapa? */
  hasCoordinates: boolean;
  lat: number | null;
  lng: number | null;
}

/** Clase mayoritaria de una lista, con el mismo criterio de desempate estable
 *  que el modelo (orden low → medium → high). */
const majorityOf = (labels: DemandClass[]): DemandClass | null => {
  if (labels.length === 0) return null;
  const counts = new Map<DemandClass, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best: DemandClass | null = null;
  let bestCount = -1;
  for (const cls of DEMAND_CLASS_ORDER) {
    const count = counts.get(cls) ?? 0;
    if (count > bestCount) {
      best = cls;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Coordenada promedio (centroide) de una zona. Función PURA: recibe puntos
 * ya normalizados por zona y devuelve el promedio solo si hay ≥1 punto real.
 */
export const centroidOf = (points: { lat: number; lng: number }[]): { lat: number; lng: number } | null => {
  const valid = points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
  );
  if (valid.length === 0) return null;
  const sum = valid.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / valid.length, lng: sum.lng / valid.length };
};
/**
 * Estadísticas por zona a partir de los registros filtrados.
 * - `zonePoints`: mapa zona → puntos reales (lat/lng) obtenidos de `trips`.
 * - `model`: si está entrenado se calcula la clase predicha mayoritaria con
 *   sus features reales; si no, `predictedClass` queda en null (no se
 *   inventa ninguna predicción).
 * - Las zonas sin coordenadas conservan sus estadísticas
 *   (`hasCoordinates: false`) para la tabla, pero sin marcador en el mapa.
 */
export const aggregateZones = (
  records: MobilityRecord[],
  zonePoints: Map<string, { lat: number; lng: number }[]>,
  model: DemandModelResult,
  source: MobilityDataSource
): ZoneDemandStats[] => {
  const byZone = new Map<string, MobilityRecord[]>();
  for (const record of records) {
    const list = byZone.get(record.originZone) ?? [];
    list.push(record);
    byZone.set(record.originZone, list);
  }

  const stats: ZoneDemandStats[] = [];
  for (const [zone, zoneRecords] of byZone) {
    const observedLabels: DemandClass[] = [];
    const predictedLabels: DemandClass[] = [];
    for (const record of zoneRecords) {
      const observed = observedClassOf(record);
      if (observed !== null) {
        observedLabels.push(observed);
      }
      if (model.trained && model.tree !== null) {
        const features = featuresOf(record);
        if (features !== null) {
          predictedLabels.push(predictDemand(model.tree, features).demand);
        }
      }
    }

    const centroid = centroidOf(zonePoints.get(zone) ?? []);
    stats.push({
      zone,
      trips: zoneRecords.length,
      observedRequests:
        source === 'dataset'
          ? zoneRecords.reduce((sum, record) => sum + Math.max(0, record.requestedSeats), 0)
          : null,
      observedClass: majorityOf(observedLabels),
      predictedClass: majorityOf(predictedLabels),
      hasCoordinates: centroid !== null,
      lat: centroid?.lat ?? null,
      lng: centroid?.lng ?? null,
    });
  }

  return stats.sort((a, b) => b.trips - a.trips || a.zone.localeCompare(b.zone, 'es-MX'));
};
/**
 * Agregado por tramo horario: solicitudes observadas y viajes.
 * Función PURA (para la gráfica de demanda observada por horario).
 */
export interface DaypartDemand {
  id: string;
  label: string;
  trips: number;
  /** Solicitudes observadas (null si la fuente no las trae). */
  observedRequests: number | null;
}

export const aggregateByDaypart = (
  records: MobilityRecord[],
  source: MobilityDataSource
): DaypartDemand[] => {
  const tripsByPart = new Map<string, number>();
  const requestsByPart = new Map<string, number>();
  for (const record of records) {
    const part = daypartOfHour(record.hour);
    if (!part) {
      continue;
    }
    tripsByPart.set(part.id, (tripsByPart.get(part.id) ?? 0) + 1);
    if (source === 'dataset') {
      requestsByPart.set(
        part.id,
        (requestsByPart.get(part.id) ?? 0) + Math.max(0, record.requestedSeats)
      );
    }
  }
  return DAYPARTS.map((part) => ({
    id: part.id,
    label: part.label,
    trips: tripsByPart.get(part.id) ?? 0,
    observedRequests: source === 'dataset' ? (requestsByPart.get(part.id) ?? 0) : null,
  }));
};

/**
 * Estado agregado del dashboard para una carga concreta. Función PURA que la
 * página usa para decidir qué mostrar sin lógica dispersa.
 */
export interface DashboardReadiness {
  /** Registros analizados (dataset completo, sin filtrar). */
  totalRecords: number;
  /** ¿Alcanza el mínimo para un análisis fiable? */
  meetsMinimum: boolean;
  /** ¿El modelo está entrenado y es evaluable? */
  modelReady: boolean;
  /** ¿El dataset trae conteos reales de solicitudes? */
  hasRequestsData: boolean;
}

export const dashboardReadiness = (
  dataset: MobilityDataset,
  model: DemandModelResult
): DashboardReadiness => ({
  totalRecords: dataset.records.length,
  meetsMinimum: dataset.records.length >= MIN_DASHBOARD_RECORDS,
  modelReady: model.trained && model.tree !== null,
  hasRequestsData: dataset.source === 'dataset',
});

/**
 * Carga los datos del dashboard en UNA llamada:
 *   1. dataset (+ modelo sobre el mismo dataset, sin duplicar consultas),
 *   2. coordenadas de `trips` (solo campos necesarios) agrupadas por zona.
 *
 * Errores:
 *   - Si falla el dataset, lanza (la página muestra error + reintento).
 *   - Si fallan las coordenadas, devuelve `coordinatesError` y un mapa vacío:
 *     datos parciales, nunca marcadores inventados.
 */
export interface DashboardData {
  dataset: MobilityDataset;
  model: DemandModelResult;
  zonePoints: Map<string, { lat: number; lng: number }[]>;
  /** null cuando las coordenadas se cargaron bien. */
  coordinatesError: string | null;
}

export const getDashboardData = async (): Promise<DashboardData> => {
  const dataset = await getMobilityDataset();
  const model = trainDemandModel(dataset);

  const zonePoints = new Map<string, { lat: number; lng: number }[]>();
  let coordinatesError: string | null = null;

  try {
    const { data, error } = await supabase
      .from('trips')
      .select('origin, origin_lat, origin_lng');

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as {
      origin: string | null;
      origin_lat: number | null;
      origin_lng: number | null;
    }[]) {
      const lat = typeof row.origin_lat === 'number' ? row.origin_lat : Number(row.origin_lat);
      const lng = typeof row.origin_lng === 'number' ? row.origin_lng : Number(row.origin_lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      const zone = normalizeOriginZone(row.origin);
      const list = zonePoints.get(zone) ?? [];
      list.push({ lat, lng });
      zonePoints.set(zone, list);
    }
  } catch (error: unknown) {
    console.error('Error cargando coordenadas de viajes para el dashboard:', error);
    coordinatesError =
      'No se pudieron cargar las coordenadas de los viajes. Las estadísticas se muestran sin mapa.';
  }

  return { dataset, model, zonePoints, coordinatesError };
}
