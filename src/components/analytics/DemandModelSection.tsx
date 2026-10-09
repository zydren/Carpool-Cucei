/**
 * Sección "Predicción inteligente de demanda" (ETAPA 2 — árbol de decisión).
 *
 * Si el modelo no puede entrenarse (pocos registros, clases con muy pocos
 * ejemplos o fuente de datos sin conteo de solicitudes) NO se muestran
 * predicciones: se explica el motivo. Nunca se inventan datos ni se presenta
 * una estimación sin respaldo estadístico.
 */

import {
  AlertTriangle,
  Brain,
  GitBranch,
  Table2,
  Target,
} from 'lucide-react';

import Card from '../ui/Card';
import { Alert, StatCard } from '../ui/PageBlocks';
import DecisionTreeView from './DecisionTreeView';
import DemandPredictor from './DemandPredictor';
import {
  DEMAND_CLASS_BADGE,
  DEMAND_CLASS_LABELS,
  DEMAND_CLASS_ORDER,
  DEMAND_THRESHOLDS,
  MIN_TRAINING_RECORDS,
} from '../../services/demandModel';
import type { DemandModelResult } from '../../services/demandModel';

const intFormatter = new Intl.NumberFormat('es-MX');

/** Texto mostrado cuando un indicador no tiene datos. */
const DASH = '—';

const formatInt = (value: number): string => intFormatter.format(value);

const formatDecimal = (value: number, decimals: number): string =>
  new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

/** Distribución de clases de entrenamiento. */
function DistributionList({ model }: { model: DemandModelResult }) {
  const total = Math.max(model.usedRecords, 1);

  return (
    <ul className="space-y-2">
      {DEMAND_CLASS_ORDER.map((cls) => {
        const count = model.distribution[cls];
        const share = (count / total) * 100;
        return (
          <li key={cls} className="flex items-center gap-3">
            <span
              className={`w-20 shrink-0 rounded-full border px-2.5 py-0.5 text-center text-xs font-bold ${DEMAND_CLASS_BADGE[cls]}`}
            >
              {DEMAND_CLASS_LABELS[cls]}
            </span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${
                  cls === 'low' ? 'bg-slate-400' : cls === 'medium' ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${share}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs text-slate-500 tabular-nums">
              {formatInt(count)} · {formatDecimal(share, 1)}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Matriz de confusión: filas = categoría real, columnas = predicha. */
function ConfusionTable({ model }: { model: DemandModelResult }) {
  const confusion = model.confusion;
  if (!confusion) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] border-collapse text-sm">
        <caption className="sr-only">
          Matriz de confusión: filas = demanda real, columnas = demanda predicha
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-2 text-left text-xs font-semibold text-slate-500">
              Real \ Predicha
            </th>
            {DEMAND_CLASS_ORDER.map((cls) => (
              <th
                key={cls}
                scope="col"
                className="px-2 py-2 text-center text-xs font-semibold text-slate-500"
              >
                {DEMAND_CLASS_LABELS[cls]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DEMAND_CLASS_ORDER.map((real, rowIndex) => (
            <tr key={real} className="border-t border-slate-100">
              <th scope="row" className="px-2 py-2 text-left text-xs font-semibold text-slate-700">
                {DEMAND_CLASS_LABELS[real]}
              </th>
              {DEMAND_CLASS_ORDER.map((pred, colIndex) => {
                const value = confusion.matrix[rowIndex]?.[colIndex] ?? 0;
                const isCorrect = rowIndex === colIndex;
                return (
                  <td
                    key={pred}
                    className={`px-2 py-2 text-center text-xs font-semibold tabular-nums ${
                      isCorrect
                        ? value > 0
                          ? 'bg-green-50 text-green-800'
                          : 'bg-slate-50 text-slate-300'
                        : value > 0
                          ? 'bg-red-50 text-red-700'
                          : 'text-slate-300'
                    }`}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Métricas de evaluación del modelo (precisión y matriz de confusión). */
function ModelMetrics({ model }: { model: DemandModelResult }) {
  return (
    <div className="mt-5 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <StatCard
          label="Registros utilizados"
          value={formatInt(model.usedRecords)}
          sub={`Mínimo: ${MIN_TRAINING_RECORDS}`}
        />
        <StatCard
          label="Precisión (accuracy)"
          value={model.accuracy === null ? DASH : `${formatDecimal(model.accuracy * 100, 1)}%`}
          sub={model.accuracy === null ? 'Muestra insuficiente' : `Validación ${model.folds} pliegues`}
        />
        <StatCard
          label="Aciertos"
          value={model.confusion === null ? DASH : formatInt(model.confusion.correct)}
          sub={model.confusion === null ? 'No evaluable' : `de ${formatInt(model.confusion.total)}`}
        />
        <StatCard
          label="Nodos del árbol"
          value={formatInt(model.nodes)}
          sub={`Profundidad ${model.depth}`}
        />
      </div>

      {model.accuracy === null && model.accuracyNote && (
        <Alert type="info">
          <p className="font-semibold">Precisión no disponible</p>
          <p className="mt-1 font-normal">{model.accuracyNote}</p>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
            <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
            Matriz de confusión
          </p>
          {model.confusion ? (
            <>
              <ConfusionTable model={model} />
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                La diagonal son aciertos; las demás celdas indican confusiones del modelo entre
                categorías de demanda.
              </p>
            </>
          ) : (
            <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400">
              La muestra es demasiado pequeña para una evaluación fiable.
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Distribución de clases de entrenamiento
          </p>
          <DistributionList model={model} />
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            La etiqueta se obtiene del índice de ocupación (solicitudes ÷ asientos) con cortes en
            tercios: <strong>{DEMAND_THRESHOLDS.medium.toFixed(2)}</strong> y{' '}
            <strong>{DEMAND_THRESHOLDS.high.toFixed(2)}</strong>. La categoría Alta exige además al
            menos 2 solicitudes, para que un viaje de un solo asiento no quede como alta por
            construcción.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Panel principal de la sección "Predicción inteligente de demanda". */
export default function DemandModelSection({ model }: { model: DemandModelResult | null }) {
  if (!model) return null;

  const trained = model.trained && model.tree !== null;

  return (
    <section aria-label="Predicción inteligente de demanda" className="mt-10 space-y-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Brain className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-600">
            Inteligencia artificial
          </p>
          <h2 className="mt-0.5 text-lg font-bold text-slate-900">
            Predicción inteligente de demanda
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Árbol de decisión entrenado con los viajes registrados para clasificar la demanda como
            baja, media o alta.
          </p>
        </div>
      </div>

      <Card className="p-6 app-animate-fade-up">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              trained
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {trained ? 'Modelo entrenado' : 'Modelo no entrenado'}
          </span>
          <span className="text-sm text-slate-500">
            Registros utilizados:{' '}
            <strong className="text-slate-900">{formatInt(model.usedRecords)}</strong>
            {model.skippedRecords > 0 && (
              <span className="text-slate-400"> (de {formatInt(model.totalRecords)})</span>
            )}
          </span>
        </div>

        {trained ? (
          <ModelMetrics model={model} />
        ) : (
          <div className="mt-5">
            <Alert type="warning">
              <p className="font-semibold">Datos insuficientes para entrenar el modelo.</p>
              <p className="mt-1 font-normal">{model.reason}</p>
              <p className="mt-2 flex items-start gap-1.5 font-normal text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                No se generan predicciones hasta reunir suficientes registros reales. No se inventan
                datos ni se muestran estimaciones sin respaldo.
              </p>
            </Alert>

            {model.usedRecords > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Distribución de clases de la muestra actual
                </p>
                <DistributionList model={model} />
              </div>
            )}
          </div>
        )}
      </Card>

      {trained && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DemandPredictor tree={model.tree!} />
            <Card className="p-6 app-animate-fade-up">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-900">
                    Árbol de decisión entrenado
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Cada nodo muestra la variable, su umbral, la entropía H(S) y la ganancia de
                    información IG que justificaron la división.
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <DecisionTreeView tree={model.tree!} />
              </div>
            </Card>
          </div>

          <Card className="p-6 app-animate-fade-up">
            <h2 className="text-base font-bold text-slate-900">
              Cómo decide el modelo la categoría de demanda
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              En cada nodo el modelo elige la variable que más reduce la incertidumbre, es decir la
              de mayor ganancia de información IG(S, A) = H(S) − Σ (|Sᵥ| / |S|) · H(Sᵥ), donde la
              entropía de Shannon H(S) = −Σ pᵢ log₂ pᵢ mide el desorden de las clases del nodo. Las
              variables candidatas son el día de la semana, la hora de salida, la distancia y los
              asientos disponibles: todas conocidas al publicar el viaje. El número de
              solicitudes se excluye a propósito, porque es la respuesta que el modelo debe predecir
              (usarlo como entrada provocaría fuga de información).
            </p>
          </Card>
        </>
      )}
    </section>
  );
}


