import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Armchair,
  CalendarDays,
  Car,
  CheckCircle2,
  Clock,
  Database,
  Info,
  MapPin,
  RefreshCw,
  Route,
  Timer,
  XCircle,
} from 'lucide-react';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Alert, SectionHeader, StatCard } from '../components/ui/PageBlocks';
import { BarChart, SegmentedBar } from '../components/analytics/Charts';
import type { BarChartDatum, SegmentedBarSegment } from '../components/analytics/Charts';
import DemandModelSection from '../components/analytics/DemandModelSection';
import { getMobilityAnalysis } from '../services/analyticsService';
import type { MobilityInsights } from '../services/analyticsService';
import { trainDemandModel } from '../services/demandModel';
import type { DemandModelResult } from '../services/demandModel';

/** Texto mostrado cuando un indicador no tiene datos. */
const DASH = '—';

const intFormatter = new Intl.NumberFormat('es-MX');

const formatInt = (value: number): string => intFormatter.format(value);

const formatDecimal = (value: number, decimals: number): string =>
  new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

/** Texto del origen del dataset (de dónde salen los datos). */
const sourceDescription: Record<MobilityInsights['source'], string> = {
  dataset: 'Datos de toda la plataforma (dataset anonimizado, sin datos personales).',
  visible:
    'Datos limitados a los viajes visibles con tu sesión. Aplica la migración add_mobility_analytics.sql para el análisis completo.',
};

/**
 * "Analítica de movilidad" — ETAPA 1 (minería de datos y preparación del
 * dataset). Presenta indicadores y gráficos de los viajes registrados y avisa
 * cuando todavía no hay registros suficientes para el análisis completo.
 */
const MobilityAnalyticsPage = () => {
  const [insights, setInsights] = useState<MobilityInsights | null>(null);
  // El dataset crudo alimenta el modelo de la ETAPA 2; los insights alimentan
  // los indicadores. Ambos provienen de la MISMA consulta (`getMobilityAnalysis`).
  const [model, setModel] = useState<DemandModelResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `reloadKey` permite recargar el análisis sin duplicar la lógica: los
  // botones "Recalcular"/"Reintentar" lo incrementan y el efecto se vuelve a
  // ejecutar. La función de carga se define DENTRO del efecto (como en el resto
  // de páginas del proyecto) para no llamar a setState de forma síncrona.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadInsights = async () => {
      try {
        // Una sola descarga: el dataset alimenta el modelo y las estadísticas.
        const { dataset, insights: stats } = await getMobilityAnalysis();
        if (cancelled) return;
        setInsights(stats);
        setModel(trainDemandModel(dataset));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'No se pudo cargar la analítica de movilidad.'
        );
        setInsights(null);
        setModel(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadInsights();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /** Recarga manual (botones "Recalcular" / "Reintentar"). */
  const handleRefresh = () => {
    setIsLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main className="pt-24 pb-16">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div
              className="flex min-h-[40vh] flex-col items-center justify-center gap-3"
              role="status"
              aria-live="polite"
            >
              <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-slate-300" />
              <p className="text-sm text-slate-500">Analizando los viajes registrados…</p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <main className="pt-24 pb-16">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Inteligencia de datos"
            title="Analítica de movilidad"
            description="Minería de datos de los viajes registrados: patrones de uso, distancias y zonas de origen."
            action={
              <Button variant="outline" onClick={handleRefresh} aria-label="Recalcular análisis">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Recalcular
              </Button>
            }
          />

          {error && (
            <div className="mt-8">
              <Alert type="error">{error}</Alert>
              <div className="mt-4">
                <Button variant="primary" onClick={handleRefresh}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Reintentar
                </Button>
              </div>
            </div>
          )}

          {!error && insights && <AnalyticsContent insights={insights} model={model} />}
        </div>
      </main>

      <Footer />
    </div>
  );
};

/** Tarjeta de gráfico con encabezado (icono + título + descripción). */
function ChartCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-6 app-animate-fade-up">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

/** Contenido principal una vez cargadas las estadísticas. */
function AnalyticsContent({
  insights,
  model,
}: {
  insights: MobilityInsights;
  model: DemandModelResult | null;
}) {
  const {
    recordsAnalyzed,
    meetsMinimum,
    minimumRequired,
    completed,
    cancelled,
    active,
    completedShare,
    cancelledShare,
    avgDistanceKm,
    avgDurationMinutes,
    avgAvailableSeats,
    avgRequestedSeats,
    hasRequestsData,
    byWeekday,
    byHour,
    byDistance,
    topOrigins,
  } = insights;

  const weekdayData: BarChartDatum[] = byWeekday.map((bucket) => ({
    label: bucket.label.slice(0, 3),
    value: bucket.count,
    highlight: bucket.count > 0,
  }));

  const hourData: BarChartDatum[] = byHour.map((bucket) => ({
    label: bucket.label,
    value: bucket.count,
  }));

  const distanceData: BarChartDatum[] = byDistance.map((bucket) => ({
    label: bucket.label,
    value: bucket.count,
  }));

  const statusSegments: SegmentedBarSegment[] = [
    { label: 'Completados', value: completed, className: 'bg-green-500' },
    { label: 'Cancelados', value: cancelled, className: 'bg-red-500' },
    { label: 'Activos', value: active, className: 'bg-slate-400' },
  ];

  const statusLegend = [
    { label: 'Completados', value: completed, share: completedShare, dot: 'bg-green-500' },
    { label: 'Cancelados', value: cancelled, share: cancelledShare, dot: 'bg-red-500' },
    {
      label: 'Activos / en curso',
      value: active,
      share: Math.max(100 - completedShare - cancelledShare, 0),
      dot: 'bg-slate-400',
    },
  ];
const statements = [
    { label: 'Viajes analizados', value: formatInt(recordsAnalyzed), sub: `Mínimo: ${minimumRequired}` },
    { label: 'Completados', value: formatInt(completed), sub: `${formatDecimal(completedShare, 1)}% del total` },
    { label: 'Cancelados', value: formatInt(cancelled), sub: `${formatDecimal(cancelledShare, 1)}% del total` },
    { label: 'Activos / en curso', value: formatInt(active), sub: 'Publicados y sin finalizar' },
    {
      label: 'Distancia promedio',
      value: avgDistanceKm === null ? DASH : `${formatDecimal(avgDistanceKm, 1)} km`,
      sub: 'Por viaje',
    },
    {
      label: 'Duración promedio',
      value: avgDurationMinutes === null ? DASH : `${formatDecimal(avgDurationMinutes, 0)} min`,
      sub: 'Por viaje',
    },
    {
      label: 'Asientos disponibles',
      value: avgAvailableSeats === null ? DASH : formatDecimal(avgAvailableSeats, 1),
      sub: 'Promedio por viaje',
    },
    {
      label: 'Solicitudes por viaje',
      value:
        hasRequestsData && avgRequestedSeats !== null ? formatDecimal(avgRequestedSeats, 2) : DASH,
      sub: hasRequestsData ? 'Promedio de solicitudes' : 'No disponible en modo respaldo',
    },
  ];

  const maxZoneCount = topOrigins.reduce((max, zone) => Math.max(max, zone.count), 0);

  return (
    <>
      {/* Muestra analizada */}
      <Card className="mt-8 p-6 app-animate-fade-up">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">
              Muestra analizada
            </p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">
              {formatInt(recordsAnalyzed)}{' '}
              <span className="text-base font-semibold text-slate-500">registros</span>
            </p>
          </div>
          <div className="flex items-start gap-2 text-sm text-slate-500">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span>{sourceDescription[insights.source]}</span>
          </div>
        </div>
      </Card>

      {!meetsMinimum && (
        <div className="mt-6">
          <Alert type="warning">
            <p className="font-semibold">
              Se requieren al menos {minimumRequired} registros para generar el análisis completo.
            </p>
            <p className="mt-1 font-normal">
              Actualmente hay {formatInt(recordsAnalyzed)}{' '}
              {recordsAnalyzed === 1 ? 'registro disponible' : 'registros disponibles'}. Los
              indicadores mostrados son reales, pero corresponden a una muestra insuficiente; el
              análisis completo se habilitará automáticamente al alcanzar {minimumRequired} viajes.
            </p>
          </Alert>
        </div>
      )}

      {/* Indicadores principales */}
      <section aria-label="Indicadores de movilidad" className="mt-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {statements.map((statement) => (
            <StatCard
              key={statement.label}
              label={statement.label}
              value={statement.value}
              sub={statement.sub}
            />
          ))}
        </div>
      </section>
{/* Gráficos */}
      <section
        aria-label="Gráficos de movilidad"
        className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2"
      >
        <ChartCard
          icon={CalendarDays}
          title="Viajes por día de la semana"
          description="Distribución de salidas a lo largo de la semana."
        >
          <BarChart data={weekdayData} ariaLabel="Viajes por día de la semana" />
        </ChartCard>

        <ChartCard
          icon={Clock}
          title="Viajes por hora"
          description="Franjas horarias con mayor número de salidas."
        >
          <BarChart data={hourData} ariaLabel="Viajes por hora del día" minBarWidthPx={26} />
        </ChartCard>

        <ChartCard
          icon={CheckCircle2}
          title="Estados de los viajes"
          description="Reparto entre viajes completados, cancelados y activos."
        >
          <SegmentedBar
            segments={statusSegments}
            ariaLabel={`Completados ${completed}, cancelados ${cancelled}, activos ${active}`}
          />
          <ul className="mt-5 space-y-3">
            {statusLegend.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} aria-hidden="true" />
                  {item.label}
                </span>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatInt(item.value)}{' '}
                  <span className="font-normal text-slate-400">
                    ({formatDecimal(item.share, 1)}%)
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
              <div>
                <dt className="text-xs text-slate-500">Tasa de cancelación</dt>
                <dd className="text-sm font-bold text-slate-900">
                  {formatDecimal(cancelledShare, 1)}%
                </dd>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <div>
                <dt className="text-xs text-slate-500">Tasa de finalización</dt>
                <dd className="text-sm font-bold text-slate-900">
                  {formatDecimal(completedShare, 1)}%
                </dd>
              </div>
            </div>
          </dl>
        </ChartCard>

        <ChartCard
          icon={Route}
          title="Distribución por distancia"
          description="Número de viajes según los kilómetros recorridos (km)."
        >
          <BarChart data={distanceData} ariaLabel="Viajes por rango de distancia" />
        </ChartCard>
      </section>
{/* Zonas de origen */}
      <section aria-label="Principales zonas de origen" className="mt-8">
        <Card className="p-6 app-animate-fade-up">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-slate-950">
              <MapPin className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">Principales zonas de origen</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Zonas de recogida con más viajes publicados.
              </p>
            </div>
          </div>

          {topOrigins.length === 0 ? (
            <div className="mt-5 flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
              Sin datos de origen para mostrar.
            </div>
          ) : (
            <ul className="mt-5 space-y-4">
              {topOrigins.map((zone) => (
                <li key={zone.zone}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="truncate">{zone.zone}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                      {formatInt(zone.count)}{' '}
                      <span className="font-normal text-slate-400">
                        ({formatDecimal(zone.share * 100, 0)}%)
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{
                        width: `${maxZoneCount > 0 ? (zone.count / maxZoneCount) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* ETAPA 2: predicción inteligente de demanda */}
      <DemandModelSection model={model} />

      {/* Acceso al dashboard de demanda (ETAPA 1 con mapa geográfico) */}
      <section className="mt-8">
        <Card className="p-6 app-animate-fade-up">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <MapPin className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900">
                  Dashboard de predicción de demanda
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  Explora la demanda observada por zona con mapa geográfico, filtros de día y
                  horario, y la comparación observado vs. predicho cuando hay datos
                  suficientes.
                </p>
              </div>
            </div>
            <Link to="/analitica/demanda" className="shrink-0">
              <Button variant="secondary" size="sm">
                Abrir dashboard
              </Button>
            </Link>
          </div>
        </Card>
      </section>

      {/* Preparación para la siguiente etapa */}
      <section className="mt-8">
        <Card className="p-6 app-animate-fade-up">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Info className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">
                Preparación para Machine Learning
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                El dataset normalizado (día de la semana, hora, distancia, duración,
                asientos, solicitudes, estado y zona de origen) alimenta el árbol de decisión de la
                sección anterior sin duplicar la consulta: ambas comparten una única descarga de
                datos.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-600">
            <span className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-slate-400" aria-hidden="true" />
              Duración:{' '}
              {avgDurationMinutes === null ? DASH : `${formatDecimal(avgDurationMinutes, 0)} min`}
            </span>
            <span className="flex items-center gap-2">
              <Armchair className="h-4 w-4 text-slate-400" aria-hidden="true" />
              Asientos: {avgAvailableSeats === null ? DASH : formatDecimal(avgAvailableSeats, 1)}
            </span>
            <span className="flex items-center gap-2">
              <Route className="h-4 w-4 text-slate-400" aria-hidden="true" />
              Distancia: {avgDistanceKm === null ? DASH : `${formatDecimal(avgDistanceKm, 1)} km`}
            </span>
          </div>

          <div className="mt-5">
            <Link to="/buscar-viaje">
              <Button variant="secondary" size="sm">
                Ver viajes disponibles
              </Button>
            </Link>
          </div>
        </Card>
      </section>
    </>
  );
}

export default MobilityAnalyticsPage;