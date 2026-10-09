/**
 * Filtros del dashboard de demanda (día, tramo horario y zona).
 *
 * Componente controlado y puramente presentacional: no consulta datos ni
 * conoce Supabase. Los filtros se aplican al MISMO conjunto de datos y la
 * página actualiza indicadores, mapa y gráfica de forma coherente.
 * No incluye filtro de fecha exacta porque el dataset anonimizado no
 * proporciona fecha (solo día de la semana y hora).
 */

import { DAYPARTS, WEEKDAY_ORDER } from '../../services/demandDashboardService';
import type { DemandFilters } from '../../services/demandDashboardService';
import { WEEKDAY_LABELS } from '../../services/demandDashboardService';

const selectClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'transition-colors focus:border-teal-500 focus:outline-none';

interface DemandFiltersProps {
  filters: DemandFilters;
  onChange: (filters: DemandFilters) => void;
  zones: string[];
  disabled?: boolean;
}

export default function DemandFilters({
  filters,
  onChange,
  zones,
  disabled = false,
}: DemandFiltersProps) {
  const set = (patch: Partial<DemandFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div>
        <label
          htmlFor="demand-filter-day"
          className="mb-1.5 block text-xs font-semibold text-slate-700"
        >
          Día de la semana
        </label>
        <select
          id="demand-filter-day"
          className={selectClass}
          value={filters.dayOfWeek === 'all' ? 'all' : String(filters.dayOfWeek)}
          disabled={disabled}
          onChange={(e) =>
            set({ dayOfWeek: e.target.value === 'all' ? 'all' : Number(e.target.value) })
          }
        >
          <option value="all">Todos los días</option>
          {WEEKDAY_ORDER.map((day) => (
            <option key={day} value={day}>
              {WEEKDAY_LABELS[day]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="demand-filter-daypart"
          className="mb-1.5 block text-xs font-semibold text-slate-700"
        >
          Tramo horario
        </label>
        <select
          id="demand-filter-daypart"
          className={selectClass}
          value={filters.daypart}
          disabled={disabled}
          onChange={(e) => set({ daypart: e.target.value })}
        >
          <option value="all">Todo el día</option>
          {DAYPARTS.map((part) => (
            <option key={part.id} value={part.id}>
              {part.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="demand-filter-zone"
          className="mb-1.5 block text-xs font-semibold text-slate-700"
        >
          Zona de origen
        </label>
        <select
          id="demand-filter-zone"
          className={selectClass}
          value={filters.zone}
          disabled={disabled || zones.length === 0}
          onChange={(e) => set({ zone: e.target.value })}
        >
          <option value="all">Todas las zonas</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
