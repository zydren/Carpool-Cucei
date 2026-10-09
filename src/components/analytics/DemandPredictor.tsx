/**
 * Formulario de viaje hipotético + predicción de demanda.
 *
 * IMPORTANTE: el campo "solicitudes" NO es una entrada del modelo. Como
 * define la etiqueta de entrenamiento (`requestedSeats`), incluirlo
 * provocaría fuga de información (data leakage). Aparece deshabilitado y
 * explicado para dejar claro el diseño del problema.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Brain, Info, RotateCcw, Sparkles } from 'lucide-react';

import Card from '../ui/Card';
import Button from '../ui/Button';
import { Alert } from '../ui/PageBlocks';
import {
  DEMAND_CLASS_BADGE,
  DEMAND_CLASS_LABELS,
  DEMAND_THRESHOLDS,
  predictDemand,
} from '../../services/demandModel';
import type { DecisionNode, DemandFeatures } from '../../services/demandModel';

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 2, label: 'Lunes' },
  { value: 3, label: 'Martes' },
  { value: 4, label: 'Miércoles' },
  { value: 5, label: 'Jueves' },
  { value: 6, label: 'Viernes' },
  { value: 7, label: 'Sábado' },
  { value: 1, label: 'Domingo' },
];

const DEFAULT_FEATURES: DemandFeatures = {
  hour: 8,
  dayOfWeek: 2,
  distanceKm: 8,
  availableSeats: 4,
};

const fieldClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 ' +
  'transition-all focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500';

interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}

function Field({ label, htmlFor, children, hint }: FieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-slate-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

interface DemandPredictorProps {
  tree: DecisionNode;
}

export default function DemandPredictor({ tree }: DemandPredictorProps) {
  const [features, setFeatures] = useState<DemandFeatures>(DEFAULT_FEATURES);

  // La predicción es determinista: se deriva del estado del formulario.
  const prediction = predictDemand(tree, features);

  const setValue = (key: keyof DemandFeatures, value: number) =>
    setFeatures((current) => ({ ...current, [key]: value }));

  return (
    <Card className="p-6 app-animate-fade-up">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-900">Predicción de demanda</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Introduce los datos de un viaje hipotético y obtén la categoría de demanda estimada.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Día de la semana" htmlFor="demand-day">
          <select
            id="demand-day"
            className={fieldClass}
            value={features.dayOfWeek}
            onChange={(e) => setValue('dayOfWeek', Number(e.target.value))}
          >
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Hora de salida" htmlFor="demand-hour">
          <input
            id="demand-hour"
            type="number"
            min={0}
            max={23}
            className={fieldClass}
            value={features.hour}
            onChange={(e) => setValue('hour', Number(e.target.value))}
          />
        </Field>

        <Field label="Distancia (km)" htmlFor="demand-distance">
          <input
            id="demand-distance"
            type="number"
            min={0}
            step={0.5}
            className={fieldClass}
            value={features.distanceKm}
            onChange={(e) => setValue('distanceKm', Number(e.target.value))}
          />
        </Field>

        <Field label="Asientos disponibles" htmlFor="demand-seats">
          <input
            id="demand-seats"
            type="number"
            min={1}
            max={12}
            className={fieldClass}
            value={features.availableSeats}
            onChange={(e) => setValue('availableSeats', Number(e.target.value))}
          />
        </Field>

        <Field
          label="Solicitudes recibidas"
          htmlFor="demand-requests"
          hint="No es una variable de entrada: define la etiqueta."
        >
          <input
            id="demand-requests"
            type="number"
            className={`${fieldClass} cursor-not-allowed bg-slate-50 text-slate-400`}
            value="—"
            disabled
            readOnly
          />
        </Field>
      </div>

      {/* Resultado de la predicción */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <Brain className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Demanda estimada
          </div>
          <span
            className={`rounded-full border px-4 py-1.5 text-lg font-extrabold ${DEMAND_CLASS_BADGE[prediction.demand]}`}
          >
            {DEMAND_CLASS_LABELS[prediction.demand]}
          </span>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Estimación producida por el árbol de decisión entrenado con los viajes registrados. Es una
          predicción del modelo, no un dato de un viaje existente.
        </p>

        {prediction.path.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
              Ruta de decisión
            </p>
            <ol className="mt-2 space-y-1.5">
              {prediction.path.map((step, index) => (
                <li key={`${step.label}-${index}`} className="flex items-center gap-2 text-xs">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="text-slate-600">
                    {step.label}: <strong className="text-slate-900">{step.value}</strong>
                  </span>
                  <span className="text-slate-400">
                    {step.value} ≤ {step.threshold} → rama {step.branch}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-slate-400">
              Hoja alcanzada, sostenida por {prediction.support} ejemplos de entrenamiento.
            </p>
          </div>
        )}
      </div>

      <div className="mt-5">
        <Alert type="info">
          <p className="font-semibold">Sobre la etiqueta de demanda</p>
          <p className="mt-1">
            La categoría se calcula con el índice de ocupación (solicitudes ÷ asientos): menor de{' '}
            {DEMAND_THRESHOLDS.medium.toFixed(2)} es <strong>Baja</strong>, entre{' '}
            {DEMAND_THRESHOLDS.medium.toFixed(2)} y {DEMAND_THRESHOLDS.high.toFixed(2)} es{' '}
            <strong>Media</strong>, y {DEMAND_THRESHOLDS.high.toFixed(2)} o más es{' '}
            <strong>Alta</strong>. Las solicitudes no se introducen porque serían justamente la
            respuesta que el modelo debe predecir.
          </p>
          <p className="mt-2 flex items-start gap-1.5 text-xs">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Variables utilizadas: día de la semana, hora, distancia y asientos disponibles
            (todas conocidas al publicar el viaje).
          </p>
        </Alert>
      </div>

      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={() => setFeatures(DEFAULT_FEATURES)}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Restablecer valores
        </Button>
      </div>
    </Card>
  );
}
