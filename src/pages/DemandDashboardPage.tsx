/**
 * Dashboard de predicción de demanda (`/analitica/demanda`).
 *
 * Explora la demanda OBSERVADA por zona, día y horario e integra el modelo
 * existente solo cuando está entrenado y es evaluable. Útil incluso sin datos
 * suficientes: en ese caso muestra observaciones reales y avisa que no hay
 * predicciones, sin inventar ninguna cifra.
 *
 * Patrones reutilizados de MobilityAnalyticsPage: Navbar/Footer, SectionHeader,
 * Card, Button, Alert, StatCard, efecto con `cancelled` y `reloadKey`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BarChart3, MapPin, RefreshCw, Users } from 'lucide-react';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { Alert, SectionHeader, StatCard } from '../components/ui/PageBlocks';
import DemandFilters from '../components/analytics/DemandFilters';
import DemandHeatmap from '../components/analytics/DemandHeatmap';
import DemandModelSection from '../components/analytics/DemandModelSection';
import ObservedVsPredictedChart from '../components/analytics/ObservedVsPredictedChart';
import type { ObservedPredictedCounts } from '../components/analytics/ObservedVsPredictedChart';
import { BarChart } from '../components/analytics/Charts';
import {
  aggregateByDaypart,
  aggregateZones,
  ALL_DEMAND_FILTERS,
  availableZones,
  countTrips,
  dashboardReadiness,
  DEMAND_CLASS_LABELS,
  filterRecords,
  getDashboardData,
  inSamplePredictions,
  MIN_DASHBOARD_RECORDS,
  MIN_TRAINING_RECORDS,
  observedClassDistribution,
  observedCountsFromPairs,
  predictedCountsFromPairs,
  sumObservedRequests,
} from '../services/demandDashboardService';
import type { DashboardData, DemandFilters as DemandFiltersState } from '../services/demandDashboardService';

const intFormatter = new Intl.NumberFormat('es-MX');
const formatInt = (value: number): string => intFormatter.format(value);

const DemandDashboardPage = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DemandFiltersState>(ALL_DEMAND_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const loaded = await getDashboardData();
        if (cancelled) return;
        setData(loaded);
      } catch (err) {
        if (cancelled) return;
        console.error('Error cargando el dashboard de demanda:', err);
        setError(
          err instanceof Error ? err.message : 'No se pudo cargar el dashboard de demanda.'
        );
        setData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Zonas de TODO el dataset (las opciones del filtro no cambian al filtrar).
  const allZones = useMemo(
    () => (data ? availableZones(data.dataset.records) : []),
    [data]
  );

  // Registros con los filtros aplicados: una sola fuente para indicadores,
  // mapa y gráficas (resultados coherentes entre sí).
  const filtered = useMemo(
    () => (data ? filterRecords(data.dataset.records, filters) : []),
    [data, filters]
  );

  const readiness = useMemo(
    () =>
      data
        ? dashboardReadiness(data.dataset, data.model)
        : { totalRecords: 0, meetsMinimum: false, modelReady: false, hasRequestsData: false },
    [data]
  );

  const zoneStats = useMemo(
    () =>
      data
        ? aggregateZones(filtered, data.zonePoints, data.model, data.dataset.source)
        : [],
    [data, filtered]
  );

  const dayparts = useMemo(
    () => (data ? aggregateByDaypart(filtered, data.dataset.source) : []),
    [data, filtered]
  );

  const chartComparison: ObservedPredictedCounts | null = useMemo(() => {
    if (!data || !readiness.modelReady) return null;
    const pairs = inSamplePredictions(filtered, data.model);
    if (pairs.length === 0) return null;
    return {
      observed: observedCountsFromPairs(pairs),
      predicted: predictedCountsFromPairs(pairs),
      comparedTrips: pairs.length,
    };
  }, [data, filtered, readiness.modelReady]);

  const observedOnly = useMemo(() => observedClassDistribution(filtered), [filtered]);

  const tripsCount = countTrips(filtered);
  const requestsCount = data ? sumObservedRequests(filtered, data.dataset.source) : null;
  const zonesWithoutCoords = zoneStats.filter((zone) => !zone.hasCoordinates).length;

  const handleRefresh = () => {
    setFilters(ALL_DEMAND_FILTERS);
    setReloadKey((key) => key + 1);
  };
  const renderStates = () => {
    if (isLoading) {
      return (
        <Card className="p-10 text-center app-animate-fade-up">
          <p className="text-sm font-semibold text-slate-600">Cargando dashboard de demanda...</p>
          <p className="mt-1 text-xs text-slate-500">
            Descargando el dataset y las coordenadas de los viajes.
          </p>
        </Card>
      );
    }

    if (error || !data) {
      return (
        <Card className="p-6 app-animate-fade-up">
          <Alert type="error">
            <p className="font-semibold">No se pudo cargar el dashboard.</p>
            <p className="mt-1 font-normal">{error ?? 'Intenta nuevamente.'}</p>
          </Alert>
          <div className="mt-4">
            <Button variant="primary" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        </Card>
      );
    }

    if (readiness.totalRecords === 0) {
      return (
        <Card className="p-6 app-animate-fade-up">
          <Alert type="info">
            <p className="font-semibold">Aún no hay viajes registrados.</p>
            <p className="mt-1">
              El dashboard se activará cuando existan viajes publicados en la plataforma.
            </p>
          </Alert>
          <div className="mt-4">
            <Link
              to="/ofrecer-viaje"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Ofrecer un viaje
            </Link>
          </div>
        </Card>
      );
    }

    return null;
  };

  const earlyContent = renderStates();

  const filtersActive =
    filters.dayOfWeek !== 'all' || filters.daypart !== 'all' || filters.zone !== 'all';
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Analítica · ETAPA demanda"
            title="Predicción de demanda"
            description="Demanda observada por zona, día y tramo horario, con la evaluación del modelo de predicción cuando existen datos suficientes."
            action={
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/analitica"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:border-teal-600 hover:text-teal-800 hover:bg-teal-50"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Volver a analítica
                </Link>
                <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
                  <RefreshCw
                    className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  Actualizar
                </Button>
              </div>
            }
          />

          <div className="mt-8 space-y-6">
            {earlyContent ?? (
              <>
                {!readiness.meetsMinimum && (
                  <Alert type="warning">
                    <p className="font-semibold">Datos insuficientes para un análisis fiable.</p>
                    <p className="mt-1 font-normal">
                      Hay {formatInt(readiness.totalRecords)} registros y se requieren al menos{' '}
                      {formatInt(MIN_DASHBOARD_RECORDS)}. Se muestran observaciones reales; no
                      se generan predicciones nuevas.
                    </p>
                  </Alert>
                )}

                {data?.coordinatesError && (
                  <Alert type="warning">
                    <p className="font-semibold">Datos parciales.</p>
                    <p className="mt-1 font-normal">{data.coordinatesError}</p>
                  </Alert>
                )}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label="Viajes analizados"
                    value={formatInt(tripsCount)}
                    sub={`de ${formatInt(readiness.totalRecords)} registros`}
                  />
                  <StatCard
                    label="Solicitudes observadas"
                    value={requestsCount !== null ? formatInt(requestsCount) : 'No disponible'}
                    sub={
                      requestsCount !== null
                        ? 'suma de asientos solicitados'
                        : 'la fuente no incluye conteos reales'
                    }
                  />
                  <StatCard
                    label="Zonas con demanda"
                    value={formatInt(zoneStats.length)}
                    sub={
                      zonesWithoutCoords > 0
                        ? `${zonesWithoutCoords} sin coordenadas en el mapa`
                        : 'todas con coordenadas'
                    }
                  />
                  <StatCard
                    label="Modelo"
                    value={readiness.modelReady ? 'Entrenado' : 'Sin entrenar'}
                    sub={
                      readiness.modelReady
                        ? 'evaluación in-sample disponible'
                        : 'faltan datos reales'
                    }
                  />
                </div>
                {/* Filtros: afectan a indicadores, mapa y graficas por igual. */}
                <Card className="p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Filtros</h2>
                      <p className="text-sm text-slate-500">
                        Todas las secciones usan el mismo conjunto filtrado.
                      </p>
                    </div>
                    {filtersActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFilters(ALL_DEMAND_FILTERS)}
                      >
                        Limpiar filtros
                      </Button>
                    )}
                  </div>
                  <DemandFilters
                    filters={filters}
                    onChange={setFilters}
                    zones={allZones}
                    disabled={isLoading}
                  />
                  <p className="mt-3 text-xs text-slate-500">
                    {formatInt(tripsCount)} viaje{tripsCount === 1 ? '' : 's'} coincide
                    {tripsCount === 1 ? '' : 'n'} con los filtros actuales.
                  </p>
                </Card>

                {/* Mapa geográfico de demanda por zona. */}
                <Card className="p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-teal-700" aria-hidden="true" />
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Mapa de demanda por zona
                      </h2>
                      <p className="text-sm text-slate-500">
                        Tamaño según el volumen observado; color según la clase predicha solo
                        cuando el modelo está entrenado.
                      </p>
                    </div>
                  </div>
                  <DemandHeatmap
                    zones={zoneStats}
                    modelReady={readiness.modelReady}
                    hasRequestsData={readiness.hasRequestsData}
                  />
                </Card>

                {/* Demanda observada por tramo horario. */}
                <Card className="p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-teal-700" aria-hidden="true" />
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Demanda observada por tramo horario
                      </h2>
                      <p className="text-sm text-slate-500">
                        {readiness.hasRequestsData
                          ? 'Solicitudes reales acumuladas por tramo.'
                          : 'Viajes publicados por tramo (la fuente no trae conteos de solicitudes).'}
                      </p>
                    </div>
                  </div>
                  <BarChart
                    ariaLabel="Demanda observada por tramo horario"
                    data={dayparts.map((part) => ({
                      label: part.label,
                      value:
                        part.observedRequests !== null ? part.observedRequests : part.trips,
                      highlight: true,
                    }))}
                    valueFormatter={(value) =>
                      readiness.hasRequestsData ? `${value} sol.` : `${value} viajes`
                    }
                    emptyLabel="Sin datos para el rango filtrado"
                  />
                </Card>
                {/* Observado vs. predicho (solo con modelo entrenado). */}
                <Card className="p-5">
                  <h2 className="mb-4 text-base font-bold text-slate-900">
                    Observado vs. predicho
                  </h2>
                  <ObservedVsPredictedChart
                    comparison={chartComparison}
                    notTrainedReason={
                      readiness.modelReady
                        ? null
                        : `Se requieren al menos ${formatInt(MIN_TRAINING_RECORDS)} registros para entrenar y evaluar el modelo.`
                    }
                    observedOnly={observedOnly}
                  />
                </Card>

                {/* Tabla de zonas: incluye las zonas sin coordenadas. */}
                <Card className="p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Users className="h-5 w-5 text-teal-700" aria-hidden="true" />
                    <div>
                      <h2 className="text-base font-bold text-slate-900">Detalle por zona</h2>
                      <p className="text-sm text-slate-500">
                        Las zonas sin coordenadas se listan aqui aunque no aparezcan en el mapa.
                      </p>
                    </div>
                  </div>
                  {zoneStats.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                      Ninguna zona coincide con los filtros actuales.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                            <th className="py-2 pr-4 font-bold">Zona</th>
                            <th className="py-2 pr-4 font-bold">Viajes</th>
                            <th className="py-2 pr-4 font-bold">Solicitudes</th>
                            <th className="py-2 pr-4 font-bold">Observada</th>
                            <th className="py-2 pr-4 font-bold">Predicha</th>
                            <th className="py-2 font-bold">Mapa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {zoneStats.map((zone) => (
                            <tr
                              key={zone.zone}
                              className="border-b border-slate-100 last:border-b-0"
                            >
                              <td className="py-2 pr-4 font-semibold text-slate-900">
                                {zone.zone}
                              </td>
                              <td className="py-2 pr-4 tabular-nums text-slate-700">
                                {formatInt(zone.trips)}
                              </td>
                              <td className="py-2 pr-4 tabular-nums text-slate-700">
                                {zone.observedRequests !== null
                                  ? formatInt(zone.observedRequests)
                                  : 'No disponible'}
                              </td>
                              <td className="py-2 pr-4 text-slate-700">
                                {zone.observedClass
                                  ? DEMAND_CLASS_LABELS[zone.observedClass]
                                  : 'Sin datos'}
                              </td>
                              <td className="py-2 pr-4 text-slate-700">
                                {readiness.modelReady
                                  ? zone.predictedClass
                                    ? DEMAND_CLASS_LABELS[zone.predictedClass]
                                    : 'Sin datos'
                                  : 'Modelo sin entrenar'}
                              </td>
                              <td className="py-2 text-slate-700">
                                {zone.hasCoordinates ? 'Si' : 'Sin coordenadas'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                {/* Panel del modelo existente (ETAPA 2), solo si está entrenado. */}
                <DemandModelSection model={data?.model ?? null} />
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default DemandDashboardPage;