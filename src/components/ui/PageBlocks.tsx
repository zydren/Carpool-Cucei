/**
 * Bloques visuales reutilizables del rediseño (sin lógica de negocio).
 * - SectionHeader: título + descripción + acción opcional.
 * - EmptyState: estado vacío profesional con icono, título, descripción y acción.
 * - Alert: mensajes success/error/warning/info con estética consistente.
 * - StatCard: métrica pequeña para dashboards y perfiles.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import Card from './Card';
import Button from './Button';

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-base text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Sección numerada para formularios largos (flujos por pasos).
 * Mantiene agrupación visual y jerarquía sin alterar la lógica del form.
 */
export function FormSection({
  step,
  title,
  description,
  children,
}: {
  step?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-slate-100 pt-6 mt-6 first:border-t-0 first:pt-0 first:mt-0">
      <div className="mb-5 flex items-start gap-3">
        {step && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
            {step}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          {description && (
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  actionOnClick?: () => void;
  /** Versión reducida para contenedores pequeños (dropdowns, secciones internas). */
  compact?: boolean;
}

/**
 * Contenido de un estado vacío, sin tarjeta contenedora.
 * Úsalo dentro de un Card/sección ya existente.
 */
export function InlineEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionTo,
  actionOnClick,
  compact = false,
}: EmptyStateProps) {
  return (
    <>
      <div
        className={`mx-auto flex items-center justify-center bg-teal-50 text-teal-700 ${
          compact ? 'h-11 w-11 rounded-xl' : 'h-14 w-14 rounded-2xl'
        }`}
      >
        <Icon className={compact ? 'h-5 w-5' : 'h-7 w-7'} aria-hidden="true" />
      </div>
      <h3
        className={`font-bold text-slate-900 ${
          compact ? 'mt-3 text-sm' : 'mt-5 text-xl'
        }`}
      >
        {title}
      </h3>
      <p
        className={`mx-auto text-slate-500 ${
          compact ? 'mt-1 max-w-xs text-xs' : 'mt-2 max-w-md text-sm'
        }`}
      >
        {description}
      </p>
      {actionLabel && (actionTo || actionOnClick) && (
        <div className={`flex justify-center ${compact ? 'mt-3' : 'mt-6'}`}>
          {actionTo ? (
            <Link to={actionTo}>
              <Button variant="primary" size={compact ? 'sm' : 'md'}>
                {actionLabel}
              </Button>
            </Link>
          ) : (
            <Button
              variant="primary"
              size={compact ? 'sm' : 'md'}
              onClick={actionOnClick}
            >
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <Card className="p-10 sm:p-12 text-center app-animate-fade-up">
      <InlineEmptyState {...props} />
    </Card>
  );
}

const alertStyles: Record<string, string> = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const alertIcons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertCircle,
  info: Info,
} as const;

export function Alert({
  type,
  children,
}: {
  type: 'success' | 'error' | 'warning' | 'info';
  children: ReactNode;
}) {
  const Icon = alertIcons[type];
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border p-4 text-sm font-medium ${alertStyles[type]}`}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
      <p className="text-2xl font-extrabold text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-semibold text-slate-700">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/**
 * Encabezado de un grupo dentro de una lista (p. ej. «Próximos» e «Historial»
 * en Mis Viajes). Solo presentación: icono, título, contador opcional y
 * descripción corta. Reutiliza la estética de los encabezados de sección.
 */
export function GroupHeading({
  icon: Icon,
  title,
  description,
  count,
  tone = 'default',
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  count?: number;
  /** 'history' usa el gris del historial en lugar del teal de lo activo. */
  tone?: 'default' | 'history';
}) {
  const iconBoxClass =
    tone === 'history' ? 'bg-slate-200 text-slate-700' : 'bg-slate-900 text-white';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBoxClass}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        {title}
      </h3>
      {typeof count === 'number' && (
        <span className="rounded-full border border-teal-500/30 bg-teal-500/15 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
          {count}
        </span>
      )}
      {description && <p className="w-full text-sm text-slate-500 sm:w-auto">{description}</p>}
    </div>
  );
}
