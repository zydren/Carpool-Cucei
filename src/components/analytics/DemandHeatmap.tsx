/**
 * Mapa geográfico de demanda por zona (react-leaflet, sin dependencias nuevas).
 *
 * Cada zona con coordenadas REALES se representa con un CircleMarker:
 *   - el RADIO crece con el volumen (solicitudes observadas si las hay,
 *     viajes publicados en caso contrario);
 *   - el COLOR indica la clase predicha MAYORITARIA solo cuando el modelo
 *     está entrenado; sin modelo, todos los marcadores usan el color de
 *     observación para no aparentar predicciones.
 *
 * No es una estimación continua de densidad (kernel): se presenta como
 * visualización geográfica de la demanda por zona. Las zonas SIN coordenadas
 * conservan sus estadísticas en la tabla pero NO dibujan marcadores
 * ficticios.
 */

import { useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip } from 'react-leaflet';
import { MapPinOff } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import {
  DEMAND_CLASS_BADGE,
  DEMAND_CLASS_LABELS,
} from '../../services/demandDashboardService';
import type { DemandClass, ZoneDemandStats } from '../../services/demandDashboardService';

const OBSERVED_COLOR = '#0f766e';

const PREDICTED_COLORS: Record<DemandClass, string> = {
  low: '#94a3b8',
  medium: '#f59e0b',
  high: '#ef4444',
};

const PREDICTED_FILL: Record<DemandClass, string> = {
  low: '#cbd5e1',
  medium: '#fde68a',
  high: '#fecaca',
};

/** Radio del marcador (px): crece con el volumen, con un mínimo visible. */
const markerRadius = (volume: number): number => 8 + Math.min(24, volume * 6);

interface DemandHeatmapProps {
  zones: ZoneDemandStats[];
  /** ¿El modelo está entrenado? Solo entonces el color significa predicción. */
  modelReady: boolean;
  /** ¿El volumen es de solicitudes reales (true) o de viajes (false)? */
  hasRequestsData: boolean;
}

interface MappedZone {
  zone: ZoneDemandStats;
  center: [number, number];
  radius: number;
  color: string;
  fillColor: string;
  volumeLabel: string;
}
export default function DemandHeatmap({
  zones,
  modelReady,
  hasRequestsData,
}: DemandHeatmapProps) {
  const mapped = useMemo<MappedZone[]>(
    () =>
      zones
        .filter((zone) => zone.hasCoordinates && zone.lat !== null && zone.lng !== null)
        .map((zone) => {
          const volume = hasRequestsData ? zone.observedRequests ?? 0 : zone.trips;
          const predicted = modelReady ? zone.predictedClass : null;
          return {
            zone,
            center: [zone.lat as number, zone.lng as number] as [number, number],
            radius: markerRadius(volume),
            color: predicted ? PREDICTED_COLORS[predicted] : OBSERVED_COLOR,
            fillColor: predicted ? PREDICTED_FILL[predicted] : OBSERVED_COLOR,
            volumeLabel: hasRequestsData
              ? (zone.observedRequests ?? 0) + ' solicitudes observadas'
              : zone.trips + ' viajes publicados',
          };
        }),
    [zones, modelReady, hasRequestsData]
  );

  if (mapped.length === 0) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
        <MapPinOff className="h-8 w-8 text-slate-300" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-600">Sin coordenadas para mostrar</p>
        <p className="max-w-md text-xs text-slate-500">
          Ninguna zona tiene coordenadas reales disponibles. Las estadísticas por zona se
          conservan en la tabla; no se dibuja ningún punto ficticio.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="h-80 overflow-hidden rounded-2xl border border-slate-200 sm:h-96">
        <MapContainer
          center={mapped[0].center}
          zoom={11}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mapped.map((item) => (
            <CircleMarker
              key={item.zone.zone}
              center={item.center}
              radius={item.radius}
              pathOptions={{
                color: item.color,
                weight: 2,
                opacity: 0.9,
                fillColor: item.fillColor,
                fillOpacity: 0.55,
              }}
            >
              <Tooltip direction="top" offset={[0, -item.radius]}>
                <span className="font-semibold">{item.zone.zone}</span>
                {' - '}
                {item.volumeLabel}
              </Tooltip>
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-slate-900">{item.zone.zone}</p>
                  <p className="mt-1 text-slate-600">{item.zone.trips} viajes analizados</p>
                  <p className="text-slate-600">{item.volumeLabel}</p>
                  <p className="mt-1 text-slate-600">
                    Demanda observada:{' '}
                    <strong className="text-slate-900">
                      {item.zone.observedClass
                        ? DEMAND_CLASS_LABELS[item.zone.observedClass]
                        : 'sin datos'}
                    </strong>
                  </p>
                  {modelReady && (
                    <p className="text-slate-600">
                      Demanda predicha:{' '}
                      <strong className="text-slate-900">
                        {item.zone.predictedClass
                          ? DEMAND_CLASS_LABELS[item.zone.predictedClass]
                          : 'sin datos'}
                      </strong>
                    </p>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <HeatmapLegend modelReady={modelReady} />
    </div>
  );
}
/** Leyenda: qué significa cada canal visual, sin ambigüedad. */
function HeatmapLegend({ modelReady }: { modelReady: boolean }) {
  return (
    <div className="mt-4 grid gap-3 text-xs text-slate-600 sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="font-bold uppercase tracking-wide text-slate-500">Tamaño</p>
        <p className="mt-1">
          Radio proporcional al volumen de cada zona (solicitudes observadas cuando el
          dataset las trae; viajes publicados en caso contrario).
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="font-bold uppercase tracking-wide text-slate-500">
          {modelReady ? 'Color: clase predicha (mayoría de la zona)' : 'Color: solo observación'}
        </p>
        {modelReady ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['low', 'medium', 'high'] as DemandClass[]).map((cls) => (
              <span
                key={cls}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${DEMAND_CLASS_BADGE[cls]}`}
              >
                {DEMAND_CLASS_LABELS[cls]}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1">
            Sin modelo entrenado: todos los puntos usan el mismo color porque solo se muestra
            demanda observada.
          </p>
        )}
      </div>
    </div>
  );
}