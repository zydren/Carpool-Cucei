/**
 * Gráficos ligeros para la sección "Analítica de movilidad".
 *
 * No usan ninguna librería de gráficas (el proyecto no incluye una y no se
 * instalan dependencias nuevas): se construyen con HTML/CSS (divs con altura
 * relativa), respetando la paleta actual (slate + teal).
 */

export interface BarChartDatum {
  label: string;
  value: number;
  /** Color destacado (teal) en lugar del color base (slate). */
  highlight?: boolean;
}

interface BarChartProps {
  data: BarChartDatum[];
  ariaLabel: string;
  /** Formateo del valor mostrado (por defecto, el número tal cual). */
  valueFormatter?: (value: number) => string;
  /** Ancho mínimo de cada barra en px (permite scroll horizontal en móvil). */
  minBarWidthPx?: number;
  /** Texto mostrado cuando no hay datos. */
  emptyLabel?: string;
}

const DEFAULT_BAR_VALUE_FORMATTER = (value: number): string => String(value);

/**
 * Gráfico de barras verticales responsivo. Cada barra escala su altura respecto
 * al valor máximo del conjunto. Si hay demasiadas barras (p. ej. 24 horas), el
 * contenedor permite desplazamiento horizontal en pantallas pequeñas.
 */
export function BarChart({
  data,
  ariaLabel,
  valueFormatter = DEFAULT_BAR_VALUE_FORMATTER,
  minBarWidthPx = 30,
  emptyLabel = 'Sin datos para mostrar',
}: BarChartProps) {
  const max = data.reduce((current, item) => Math.max(current, item.value), 0);
  const hasData = data.length > 0 && max > 0;

  if (!hasData) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="flex items-end gap-1.5"
        style={{ minWidth: data.length * minBarWidthPx }}
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((item) => {
          const pct = max > 0 ? (item.value / max) * 100 : 0;
          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="h-4 text-[10px] font-semibold text-slate-500 tabular-nums">
                {item.value > 0 ? valueFormatter(item.value) : ''}
              </span>
              <div className="flex h-36 w-full items-end">
                <div
                  className={`w-full rounded-t-md transition-all duration-300 ${
                    item.highlight ? 'bg-teal-600' : 'bg-slate-900'
                  }`}
                  style={{ height: `${item.value > 0 ? Math.max(pct, 4) : 0}%` }}
                  title={`${item.label}: ${valueFormatter(item.value)}`}
                />
              </div>
              <span className="w-full truncate text-center text-[10px] text-slate-500">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface SegmentedBarSegment {
  label: string;
  value: number;
  /** Clase Tailwind del color del segmento (p. ej. 'bg-green-500'). */
  className: string;
}

interface SegmentedBarProps {
  segments: SegmentedBarSegment[];
  ariaLabel: string;
}

/**
 * Barra horizontal segmentada (100% de ancho) para mostrar proporciones, p. ej.
 * el reparto entre viajes completados / cancelados / activos.
 */
export function SegmentedBar({ segments, ariaLabel }: SegmentedBarProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div
      className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100"
      role="img"
      aria-label={ariaLabel}
    >
      {total > 0 &&
        segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
    </div>
  );
}