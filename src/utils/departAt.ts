/**
 * Utilidad para construir `departAt` (hora de salida) de la API de rutas de
 * TomTom a partir de las cadenas LOCALES del formulario:
 *   date: 'YYYY-MM-DD' (<input type="date">)
 *   time: 'HH:MM'      (<input type="time">)
 *
 * Contrato:
 * - Función PURA: no lee el reloj del dispositivo, no hace I/O y NO depende de
 *   la zona horaria del dispositivo: la hora recibida se interpreta SIEMPRE
 *   como hora de pared en `America/Mexico_City` (zona de los viajes).
 * - La salida es RFC 3339 con segundos explícitos y offset calculado para la
 *   fecha pedida, p. ej. '2026-10-15T08:00:00-06:00'. El offset NUNCA está
 *   hardcodeado: se resuelve con `Intl.DateTimeFormat` sobre la base tzdata del
 *   runtime, de modo que si las reglas de México cambian en el futuro, las
 *   fechas afectadas usarán el offset correcto (ver pruebas con fechas del
 *   periodo con DST: mayo-2021 → -05:00, mayo-2023 → -06:00).
 * - Valida estrictamente y devuelve `null` en cualquier entrada inválida. NO
 *   normaliza nunca: '2026-02-30' (día imposible), '25:90', '8:00' o cadenas
 *   vacías producen `null` para que el llamador (formulario) notifique el
 *   error. La entrada de hora es solo 'HH:MM': los segundos se rechazan (la
 *   precisión del formulario es de minutos) y siempre se emiten ':00'.
 *
 * Política ante horas inexistentes/ambiguas (transiciones de horario):
 * - La hora de pared escrita por el usuario se conserva tal cual; solo se le
 *   adjunta el offset resultante de un algoritmo iterativo (tope de pasadas)
 *   que converge al offset vigente en esa fecha. Con las reglas actuales de
 *   America/Mexico_City (UTC-06:00 permanente desde oct-2022) no existen horas
 *   inexistentes ni ambiguas; la política queda probada contra fechas
 *   históricas con transición para que el resultado sea determinista.
 *
 * No modifica `parseTripDateTime` (dateTime.ts): ese helper sigue parseando a
 * hora local del dispositivo con otros consumidores y su contrato es distinto.
 */

/** Zona horaria de los viajes del proyecto (Guadalajara/México). */
export const TRIP_TIME_ZONE = 'America/Mexico_City';

const RFC_3339_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC_3339_TIME = /^(\d{2}):(\d{2})$/;

/** Máximo de pasadas del algoritmo que resuelve el offset. */
const MAX_OFFSET_ITERATIONS = 3;

/** Hora de pared validada (componentes numéricos). */
interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31 (válido para el mes/año)
  hour: number; // 0-23
  minute: number; // 0-59
}

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
};

/**
 * Instante UTC que resulta de leer los componentes de la hora de pared como si
 * fueran UTC (candidato inicial del cálculo del offset). Se construye con
 * setUTCFullYear para no caer en el mapeo años 0-99 → 19xx de `Date.UTC`.
 */
const wallAsUtcInstant = (wall: WallClock): Date => {
  const instant = new Date(0);
  instant.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  instant.setUTCHours(wall.hour, wall.minute, 0, 0);
  return instant;
};

/** Instante UTC (ms) formado por los componentes dados. */
const utcFromParts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): number => {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, 0);
  return instant.getTime();
};

/**
 * Offset (ms) de `timeZone` en el instante dado, definido como
 * `horaLocal = horaUTC + offset` (America/Mexico_City: -6h en invierno).
 */
const offsetMsAt = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: string): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : Number.NaN;
  };

  const asUtc = utcFromParts(
    read('year'),
    read('month'),
    read('day'),
    read('hour'),
    read('minute'),
    read('second')
  );
  return asUtc - instant.getTime();
};

/**
 * Resuelve el offset de `timeZone` para una hora de pared concreta con un
 * algoritmo iterativo: parte del instante «pared leída como UTC», corrige con
 * el offset medido y repite hasta converger (o agotar MAX_OFFSET_ITERATIONS).
 * Determinista incluso en fechas con transiciones de horario.
 */
const resolveOffsetMs = (wall: WallClock, timeZone: string): number => {
  const asUtc = wallAsUtcInstant(wall);
  let offset = offsetMsAt(asUtc, timeZone);

  for (let i = 1; i < MAX_OFFSET_ITERATIONS; i += 1) {
    const next = offsetMsAt(new Date(asUtc.getTime() - offset), timeZone);
    if (next === offset) break;
    offset = next;
  }

  return offset;
};

/** Offset en milisegundos → sufijo RFC 3339 '±HH:MM'. */
const formatOffset = (offsetMs: number): string => {
  const sign = offsetMs < 0 ? '-' : '+';
  const totalMinutes = Math.round(Math.abs(offsetMs) / 60_000);
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
};

/**
 * Compone `departAt` RFC 3339 para TomTom a partir de las cadenas locales del
 * formulario.
 *
 * @param date  'YYYY-MM-DD' estricto (fecha real; rechaza '2026-02-30').
 * @param time  'HH:MM' estricto (00:00-23:59; rechaza segundos y '25:90').
 * @returns     p. ej. '2026-10-15T08:00:00-06:00', o `null` si algo no vale
 *              (nunca normaliza la entrada).
 */
export const buildDepartAt = (date: string, time: string): string | null => {
  const dateParts = RFC_3339_DATE.exec(date);
  const timeParts = RFC_3339_TIME.exec(time);
  if (!dateParts || !timeParts) return null;

  const year = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const day = Number(dateParts[3]);
  const hour = Number(timeParts[1]);
  const minute = Number(timeParts[2]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59) return null;

  const offsetMs = resolveOffsetMs({ year, month, day, hour, minute }, TRIP_TIME_ZONE);

  // Conserva la hora de pared tal cual el usuario la escribió; solo adjunta
  // segundos explícitos y el offset calculado para esa fecha.
  return `${date}T${time}:00${formatOffset(offsetMs)}`;
};
