import type { ReactNode } from 'react';
import Footer from '../Footer';
import Navbar from '../Navbar';

/**
 * Marca de la aplicación (mismo isotipo que la Navbar) para composiciones
 * centradas como las pantallas de autenticación.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center gap-3 ${className}`}>
      <span
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-lg font-extrabold text-white"
        aria-hidden="true"
      >
        C
      </span>
      <span className="text-left leading-tight">
        <span className="block text-base font-extrabold tracking-tight text-slate-900">
          Carpool Universitario
        </span>
        <span className="block text-xs font-medium text-slate-500">
          Movilidad hacia CUCEI
        </span>
      </span>
    </span>
  );
}

/**
 * Shell de presentación para pantallas centradas (login, registro,
 * recuperación de contraseña). No contiene lógica.
 */
export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8">
          <div className="mb-8 text-center app-animate-fade-up">
            <BrandMark className="justify-center" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.05)] sm:p-8 app-animate-fade-up">
            <div className="mb-6">
              {eyebrow && (
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
                  {eyebrow}
                </p>
              )}
              <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900">
                {title}
              </h1>
              {description && (
                <p className="mt-1.5 text-sm text-slate-500">{description}</p>
              )}
            </div>

            {children}
          </div>

          {footer && <div className="mt-6 text-center">{footer}</div>}
        </div>
      </div>

      <Footer />
    </div>
  );
}
