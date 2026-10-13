/**
 * Utilidades de fecha/hora: presentación en la interfaz y parseo local
 * compartido (parseTripDateTime también lo usa tripService para detectar
 * viajes pasados).
 *
 * No consultan la base de datos ni modifican datos de los viajes: reciben las
 * columnas `date` ('YYYY-MM-DD') y `time` ('HH:MM' o 'HH:MM:SS') que ya
 * devuelven los servicios existentes y las convierten a texto legible.
 *
 * Nota importante: se parsea a mano en lugar de usar `new Date('YYYY-MM-DD')`
 * porque el constructor interpreta las fechas sin hora como UTC y en México
 * (UTC-6) eso mostraría el día anterior.
 */

/** Saludo según la hora local del usuario. */
export const greetingForHour = (date: Date = new Date()): string => {
  const hour = date.getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

/**
 * Fecha/hora local de un viaje a partir de las columnas `date` y `time`.
 * @returns `null` si los valores no son válidos.
 */
export const parseTripDateTime = (date: string, time: string): Date | null => {
  const [year, month, day] = (date ?? '').slice(0, 10).split('-').map(Number);
  const [hour, minute] = (time || '00:00').slice(0, 5).split(':').map(Number);

  if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Milisegundos de inicio del día local (para comparar días sin hora). */
const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * Fecha de HOY en formato 'YYYY-MM-DD' usando la hora LOCAL del dispositivo.
 *
 * Existe para validar formularios (por ejemplo «la fecha del viaje debe ser
 * hoy o futura») comparando cadenas, sin construir objetos Date.
 *
 * NO uses `new Date().toISOString().slice(0, 10)`: eso devuelve el día en UTC
 * y en México (UTC-6) daría el día siguiente durante las 6 primeras horas de
 * la madrugada, o el anterior por la tarde-noche. Se compone con los
 * componentes locales, igual que parseTripDateTime.
 *
 * @returns Cadena 'YYYY-MM-DD' (la que espera un `<input type="date">`).
 */
export const todayDateInputValue = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Etiqueta corta del día del viaje: "Hoy", "Mañana" o "vie 26 sep".
 * @returns Cadena vacía si la fecha no es válida.
 */
export const formatTripDayLabel = (date: string): string => {
  const parsed = parseTripDateTime(date, '00:00');
  if (!parsed) return '';

  const diffDays = Math.round(
    (startOfLocalDay(parsed) - startOfLocalDay(new Date())) / 86_400_000
  );

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Mañana';

  return parsed.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
};

/**
 * Hora del viaje en formato local de 12 horas (p. ej. "7:00 a.m.").
 * @returns El valor original si no se puede interpretar.
 */
export const formatTripTimeLabel = (time: string): string => {
  const parsed = parseTripDateTime('2000-01-01', time);
  if (!parsed) return time;

  return parsed.toLocaleTimeString('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};
