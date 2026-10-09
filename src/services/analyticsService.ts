import { supabase } from '../lib/supabase';
import { parseTripDateTime } from '../utils/dateTime';
import { TRIP_STATUS } from './tripService';

/**
 * ============================================================
 * ETAPA 1 — MINERÍA DE DATOS Y PREPARACIÓN DEL DATASET
 * ============================================================
 * Este servicio NO entrena ningún modelo (eso es otra etapa). Solo:
 *   1. Obtiene un dataset limpio de viajes (una fila por viaje) reutilizando
 *      datos que ya existen (trips + trip_requests).
 *   2. Calcula estadísticas de movilidad a partir de ese dataset.
 *
 * De dónde salen los datos:
 *   * Vía preferente: RPC `get_trip_mobility_dataset()`
 *     (supabase/migrations/add_mobility_analytics.sql). Es SECURITY DEFINER y
 *     devuelve filas ANONIMIZADAS (sin ids, correos ni teléfonos) de TODOS los
 *     viajes, sin debilitar RLS. Requiere que la migración esté aplicada.
 *   * Vía de respaldo (fallback): si la migración aún no está aplicada, se leen
 *     los viajes que RLS permite ver (viajes 'active' para cualquiera + los
 *     propios del conductor). En ese caso las métricas de completados/
 *     cancelados y de solicitudes quedan restringidas y se marca `source`.
 *
 * No duplica lógica existente: el parseo de fecha/hora usa `parseTripDateTime`
 * (utils/dateTime) y los estados usan `TRIP_STATUS` (tripService).
 */

/** Nº mínimo de registros para considerar el análisis "completo". */
export const MIN_ANALYSIS_RECORDS = 35;

/** Origen del dataset. */
export type MobilityDataSource = 'dataset' | 'visible';

/**
 * Fila del dataset lista para analizar y, en una etapa posterior, para entrenar
 * un modelo. Los nombres de campo describen la variable (no la columna de BD).
 */
export interface MobilityRecord {
  /** 1 = domingo … 7 = sábado (0 si la fecha no es interpretable). */
  dayOfWeek: number;
  /** Hora de salida 0…23 (-1 si la hora no es interpretable). */
  hour: number;
  distanceKm: number | null;
  durationMinutes: number | null;
  availableSeats: number;
  /** Nº total de solicitudes recibidas por el viaje (0 en la vía 'visible'). */
  requestedSeats: number;
  completed: boolean;
  cancelled: boolean;
  /** Zona de recogida derivada del origen (primera parte de la dirección). */
  originZone: string;
}

export interface MobilityDataset {
  records: MobilityRecord[];
  source: MobilityDataSource;
}

export interface WeekdayBucket {
  dayOfWeek: number;
  label: string;
  count: number;
}

export interface HourBucket {
  hour: number;
  label: string;
  count: number;
}

export interface DistanceBucket {
  label: string;
  count: number;
}

export interface OriginZoneBucket {
  zone: string;
  count: number;
  /** Proporción sobre el total de registros con zona (0…1). */
  share: number;
}

export interface MobilityInsights {
  recordsAnalyzed: number;
  meetsMinimum: boolean;
  minimumRequired: number;
  source: MobilityDataSource;
  /** true si el dataset incluye el conteo real de solicitudes por viaje. */
  hasRequestsData: boolean;

  total: number;
  completed: number;
  cancelled: number;
  active: number;
  /** Porcentaje 0…100 de viajes completados. */
  completedShare: number;
  /** Porcentaje 0…100 de viajes cancelados. */
  cancelledShare: number;

  avgDistanceKm: number | null;
  avgDurationMinutes: number | null;
  avgAvailableSeats: number | null;
  avgRequestedSeats: number | null;

  byWeekday: WeekdayBucket[];
  byHour: HourBucket[];
  byDistance: DistanceBucket[];
  topOrigins: OriginZoneBucket[];
}

/** Etiqueta en español del día de la semana (1 = domingo … 7 = sábado). */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Domingo',
  2: 'Lunes',
  3: 'Martes',
  4: 'Miércoles',
  5: 'Jueves',
  6: 'Viernes',
  7: 'Sábado',
};

/** Orden de lunes a domingo para las gráficas (más natural en la semana laboral). */
export const WEEKDAY_ORDER: number[] = [2, 3, 4, 5, 6, 7, 1];

/** Buckets de distancia (km) para la distribución. */
const DISTANCE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0–5', min: 0, max: 5 },
  { label: '5–10', min: 5, max: 10 },
  { label: '10–15', min: 10, max: 15 },
  { label: '15–20', min: 15, max: 20 },
  { label: '20+', min: 20, max: Number.POSITIVE_INFINITY },
];

/**
 * Zona de recogida a partir del texto del origen.
 * Regla EXACTA compartida con `get_trip_mobility_dataset()` (SQL):
 * primera parte antes de la primera coma, recortada. Si no hay nada, se usa un
 * texto fijo para no dejar celdas vacías.
 */
export const normalizeOriginZone = (origin: string | null | undefined): string => {
  const first = (origin ?? '').split(',')[0]?.trim() ?? '';
  return first || 'Sin zona definida';
};

/** Número finito a partir de un valor de BD o `null`. */
const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Promedio de una lista de números (null si está vacía). */
const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

/** Redondeo con nº de decimales fijo y sin NaN. */
const round = (value: number | null, decimals = 2): number | null =>
  value === null ? null : Number(value.toFixed(decimals));

/** Fila cruda de la vía de respaldo (columnas de `trips`). */
interface VisibleTripRow {
  origin: string | null;
  date: string;
  time: string;
  status: string;
  seats_available: number | null;
  route_distance_km: number | null;
  route_duration_minutes: number | null;
}

/** Fila cruda devuelta por el RPC `get_trip_mobility_dataset()`. */
interface DatasetRow {
  day_of_week: number | string | null;
  hour_of_day: number | string | null;
  distance_km: number | string | null;
  duration_minutes: number | string | null;
  available_seats: number | string | null;
  requested_seats: number | string | null;
  is_completed: boolean | null;
  is_cancelled: boolean | null;
  origin_zone: string | null;
}

/**
 * ¿Debe usarse el respaldo por RLS en lugar del RPC?
 *   * La función/RPC todavía no existe (migración pendiente): 42883 / PGRST202.
 *   * Existe pero el rol actual no tiene permiso de ejecución (p. ej. un usuario
 *     anónimo, ya que el RPC se concede solo a 'authenticated'): 42501.
 * En ambos casos se cae con elegancia a los viajes visibles por RLS.
 */
const shouldUseVisibleFallback = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  if (error.code === '42883' || error.code === 'PGRST202' || error.code === '42501') return true;
  return /could not find the function|function .* does not exist|schema cache|permission denied/i.test(
    error.message ?? ''
  );
};

/** Construye una `MobilityRecord` de la vía de respaldo (RLS) a partir de una fila. */
const recordFromVisibleTrip = (row: VisibleTripRow): MobilityRecord => {
  const parsed = parseTripDateTime(row.date, row.time);
  return {
    dayOfWeek: parsed ? parsed.getDay() + 1 : 0,
    hour: parsed ? parsed.getHours() : -1,
    distanceKm: toFiniteNumberOrNull(row.route_distance_km),
    durationMinutes: toFiniteNumberOrNull(row.route_duration_minutes),
    availableSeats: toFiniteNumberOrNull(row.seats_available) ?? 0,
    requestedSeats: 0,
    completed: row.status === TRIP_STATUS.COMPLETED,
    cancelled: row.status === TRIP_STATUS.CANCELLED,
    originZone: normalizeOriginZone(row.origin),
  };
};

/** Construye una `MobilityRecord` de la vía RPC (dataset anonimizado). */
const recordFromDatasetRow = (row: DatasetRow): MobilityRecord => {
  const dayOfWeek = toFiniteNumberOrNull(row.day_of_week);
  const hour = toFiniteNumberOrNull(row.hour_of_day);
  return {
    dayOfWeek: dayOfWeek ?? 0,
    hour: hour ?? -1,
    distanceKm: toFiniteNumberOrNull(row.distance_km),
    durationMinutes: toFiniteNumberOrNull(row.duration_minutes),
    availableSeats: toFiniteNumberOrNull(row.available_seats) ?? 0,
    requestedSeats: toFiniteNumberOrNull(row.requested_seats) ?? 0,
    completed: row.is_completed === true,
    cancelled: row.is_cancelled === true,
    originZone: normalizeOriginZone(row.origin_zone),
  };
};

/**
 * Obtiene el dataset de movilidad.
 * 1º intenta el RPC anonimizado (visión de toda la plataforma, sin datos
 * personales). Si la migración aún no está aplicada, cae al respaldo por RLS.
 */
export const getMobilityDataset = async (): Promise<MobilityDataset> => {
  const rpcResult = await supabase.rpc('get_trip_mobility_dataset');

  if (!rpcResult.error) {
    const rows = (rpcResult.data ?? []) as DatasetRow[];
    return { records: rows.map(recordFromDatasetRow), source: 'dataset' };
  }

  if (!shouldUseVisibleFallback(rpcResult.error)) {
    console.error('Error obteniendo el dataset de movilidad:', rpcResult.error);
    throw new Error('No se pudieron cargar los datos para el análisis.');
  }

  // Respaldo: solo los viajes que RLS permite leer.
  console.warn(
    '[analyticsService] La función get_trip_mobility_dataset() no está disponible o no es ' +
      'ejecutable por el rol actual; se usa el respaldo por RLS (solo viajes visibles). ' +
      'Aplica add_mobility_analytics.sql (y accede con una sesión autenticada) para el análisis completo.'
  );

  const { data, error } = await supabase
    .from('trips')
    .select(
      'origin, date, time, status, seats_available, route_distance_km, route_duration_minutes'
    )
    .order('date', { ascending: false });

  if (error) {
    console.error('Error en el respaldo del dataset de movilidad:', error);
    throw new Error('No se pudieron cargar los datos para el análisis.');
  }

  const rows = (data ?? []) as VisibleTripRow[];
  return { records: rows.map(recordFromVisibleTrip), source: 'visible' };
};

/**
 * Calcula las estadísticas de movilidad a partir de un dataset.
 * Función PURA (sin acceso a red): facilita pruebas y reutilización.
 */
export const computeMobilityInsights = (dataset: MobilityDataset): MobilityInsights => {
  const { records, source } = dataset;
  const total = records.length;

  const completed = records.filter((r) => r.completed).length;
  const cancelled = records.filter((r) => r.cancelled).length;
  const active = Math.max(total - completed - cancelled, 0);

  const distanceValues = records
    .map((r) => r.distanceKm)
    .filter((v): v is number => v !== null);
  const durationValues = records
    .map((r) => r.durationMinutes)
    .filter((v): v is number => v !== null);
  const seatsValues = records.map((r) => r.availableSeats);

  // Los conteos de solicitudes solo son reales en la vía del dataset (RPC).
  const hasRequestsData = source === 'dataset';
  const requestedValues = records.map((r) => r.requestedSeats);

  // Viajes por día de la semana (de lunes a domingo).
  const weekdayCounts = new Map<number, number>();
  for (const r of records) {
    if (r.dayOfWeek >= 1 && r.dayOfWeek <= 7) {
      weekdayCounts.set(r.dayOfWeek, (weekdayCounts.get(r.dayOfWeek) ?? 0) + 1);
    }
  }
  const byWeekday: WeekdayBucket[] = WEEKDAY_ORDER.map((dayOfWeek) => ({
    dayOfWeek,
    label: WEEKDAY_LABELS[dayOfWeek],
    count: weekdayCounts.get(dayOfWeek) ?? 0,
  }));

  // Viajes por hora (0…23).
  const hourCounts = new Map<number, number>();
  for (const r of records) {
    if (r.hour >= 0 && r.hour <= 23) {
      hourCounts.set(r.hour, (hourCounts.get(r.hour) ?? 0) + 1);
    }
  }
  const byHour: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: String(hour).padStart(2, '0'),
    count: hourCounts.get(hour) ?? 0,
  }));

  // Distribución por rango de distancia.
  const byDistance: DistanceBucket[] = DISTANCE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: distanceValues.filter((v) => v >= bucket.min && v < bucket.max).length,
  }));

  // Principales zonas de origen (top 5 por nº de viajes).
  const zoneCounts = new Map<string, number>();
  for (const r of records) {
    zoneCounts.set(r.originZone, (zoneCounts.get(r.originZone) ?? 0) + 1);
  }
  const zonesTotal = records.length;
  const topOrigins: OriginZoneBucket[] = [...zoneCounts.entries()]
    .map(([zone, count]) => ({
      zone,
      count,
      share: zonesTotal > 0 ? count / zonesTotal : 0,
    }))
    .sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone))
    .slice(0, 5);

  return {
    recordsAnalyzed: total,
    meetsMinimum: total >= MIN_ANALYSIS_RECORDS,
    minimumRequired: MIN_ANALYSIS_RECORDS,
    source,
    hasRequestsData,

    total,
    completed,
    cancelled,
    active,
    completedShare: total > 0 ? (completed / total) * 100 : 0,
    cancelledShare: total > 0 ? (cancelled / total) * 100 : 0,

    avgDistanceKm: round(average(distanceValues), 1),
    avgDurationMinutes: round(average(durationValues), 0),
    avgAvailableSeats: round(average(seatsValues), 1),
    avgRequestedSeats: hasRequestsData ? round(average(requestedValues), 2) : null,

    byWeekday,
    byHour,
    byDistance,
    topOrigins,
  };
};

/** Obtiene el dataset y devuelve las estadísticas ya calculadas. */
export const getMobilityInsights = async (): Promise<MobilityInsights> =>
  computeMobilityInsights(await getMobilityDataset());

/**
 * Dataset + estadísticas en una SOLA llamada.
 *
 * La ETAPA 2 (modelo de árbol de decisión) necesita los registros crudos
 * para entrenar, mientras que la ETAPA 1 solo necesita los agregados. Esta
 * función evita duplicar la consulta a Supabase: descarga el dataset una vez
 * y devuelve ambas vistas calculadas en memoria.
 */
export interface MobilityAnalysis {
  dataset: MobilityDataset;
  insights: MobilityInsights;
}

/** Obtiene dataset y estadísticas compartiendo una única descarga de datos. */
export const getMobilityAnalysis = async (): Promise<MobilityAnalysis> => {
  const dataset = await getMobilityDataset();
  return { dataset, insights: computeMobilityInsights(dataset) };
};
