/**
 * Gráfica de demanda observada vs. predicha (in-sample).
 *
 * Compara dos magnitudes COMPATIBLES del mismo conjunto de viajes:
 *   - clase observada: `classifyDemand(solicitudes, asientos)`;
 *   - clase predicha: `predictDemand(árbol, features)` del modelo entrenado.
 * Ambas son conteos de viajes por categoría (low / medium / high).
 *
 * Cuando el modelo NO está entrenado:
 *   - no se genera ninguna serie predictiva;
 *   - si los datos observados son válidos, se muestran por separado con un
 *     aviso de que faltan datos para entrenar y evaluar el modelo.
 *
 * Cuando el modelo SÍ está entrenado, la gráfica se etiqueta explícitamente
 * como evaluación in-sample: las predicciones se calculan sobre los mismos
 * datos usados para entrenar, por lo que NO prueban capacidad predictiva
 * sobre datos nuevos.
 */

import { BarChart } from './Charts';
import { Alert } from '../ui/PageBlocks';
import {
  DEMAND_CLASS_LABELS,
  DEMAND_CLASS_ORDER,
  MIN_TRAINING_RECORDS,
} from '../../services/demandDashboardService';
import type { DemandClass } from '../../services/demandDashboardService';

export interface ObservedPredictedCounts {
  observed: Record<DemandClass, number>;
  predicted: Record<DemandClass, number>;
  /** Viajes incluidos en la comparación (con clase observada y predecible). */
  comparedTrips: number;
}

interface ObservedVsPredictedChartProps {
  /** null cuando el modelo no está entrenado (no hay predicciones). */
  comparison: ObservedPredictedCounts | null;
  /** Motivo del modelo sin entrenar (se muestra tal cual). */
  notTrainedReason: string | null;
  /** Viajes etiquetables para observaciones por separado (puede ser 0). */
  observedOnly: Record<DemandClass, number>;
}

export default function ObservedVsPredictedChart({
  comparison,
  notTrainedReason,
  observedOnly,
}: ObservedVsPredictedChartProps) {
  if (!comparison) {
    return (
      <div className="space-y-4">
        <Alert type="warning">
          <p className="font-semibold">Sin predicciones: faltan datos reales.</p>
          <p className="mt-1 font-normal">
            {notTrainedReason ??
              `Se requieren al menos ${MIN_TRAINING_RECORDS} registros para entrenar y evaluar el modelo.`}
          </p>
          <p className="mt-2 font-normal text-xs">
            No se dibuja ninguna serie predictiva. Las observaciones reales se muestran por
            separado.
          </p>
        </Alert>
        <BarChart
          ariaLabel="Demanda observada por categoría"
          data={DEMAND_CLASS_ORDER.map((cls) => ({
            label: DEMAND_CLASS_LABELS[cls],
            value: observedOnly[cls] ?? 0,
          }))}
          valueFormatter={(value) => `${value} viajes`}
          emptyLabel="Sin datos observados para mostrar"
        />
      </div>
    );
  }
  return <ObservedVsPredictedBars comparison={comparison} />;
}

/** Comparación entrenada: barras pareadas observado/predicho por categoría. */
function ObservedVsPredictedBars({
  comparison,
}: {
  comparison: ObservedPredictedCounts;
}) {
  const rows = DEMAND_CLASS_ORDER.map((cls) => ({
    label: DEMAND_CLASS_LABELS[cls],
    observed: comparison.observed[cls] ?? 0,
    predicted: comparison.predicted[cls] ?? 0,
  }));
  const max = rows.reduce((current, row) => Math.max(current, row.observed, row.predicted), 0);

  return (
    <div className="space-y-4">
      <Alert type="info">
        <p className="font-semibold">Evaluación in-sample (mismos datos de entrenamiento).</p>
        <p className="mt-1">
          Las clases predichas se calculan aplicando el árbol a los{' '}
          {comparison.comparedTrips} viajes con los que se entrenó. Esta comparación describe
          el ajuste al histórico, no la capacidad de predecir viajes nuevos: una clase no
          equivale a un número exacto de viajes esperados.
        </p>
      </Alert>
      {max === 0 ? (
        <BarChart
          ariaLabel="Comparación de demanda observada y predicha"
          data={[]}
          emptyLabel="Sin datos para comparar"
        />
      ) : (
        <div className="space-y-3" role="img" aria-label="Comparación de demanda observada y predicha por categoría">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700">{row.label}</span>
                <span className="text-slate-500 tabular-nums">
                  obs. {row.observed} · pred. {row.predicted}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex h-3.5 w-full items-center overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-900"
                    style={{ width: `${(row.observed / max) * 100}%` }}
                    title={`Observado: ${row.observed}`}
                  />
                </div>
                <div className="flex h-3.5 w-full items-center overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-teal-600"
                    style={{ width: `${(row.predicted / max) * 100}%` }}
                    title={`Predicho: ${row.predicted}`}
                  />
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-900" />
              Observado (etiqueta real)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-600" />
              Predicho por el modelo
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
