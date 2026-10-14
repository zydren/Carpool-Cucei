import { NavLink, useLocation } from 'react-router-dom';
import { CalendarCheck, Home, Search, UserRound } from 'lucide-react';

/**
 * Barra de navegación inferior para MÓVIL (fija).
 *
 * Se monta una sola vez, dentro de <BrowserRouter> en App.tsx, como elemento
 * fijo: la heredan todas las páginas sin tocar cada una. Visible solo por debajo
 * del breakpoint `md` (mismo corte que el menú hamburguesa del Navbar); en
 * escritorio se oculta y se conserva la navegación actual.
 *
 * Decisiones:
 *   - Cuatro destinos (Inicio, Buscar, Mis viajes, Perfil). «Ofrecer viaje» NO
 *     se duplica aquí: sigue siendo una acción destacada en Inicio y en Mis
 *     viajes (acciones del conductor).
 *   - Se oculta en las pantallas de autenticación (/login, /registro,
 *     /reset-password): son flujos enfocados y no debe distraer la navegación.
 *   - Rutas protegidas (/buscar-viaje, /mis-viajes, /perfil) ya están envueltas
 *     por ProtectedRoute: si no hay sesión, llevan a /login conservando el
 *     destino. No se replica esa lógica aquí.
 *   - NavLink (no <a>) para resaltar la sección activa sin recargar la SPA.
 *   - Respeta env(safe-area-inset-bottom) para el notch de iOS/Android.
 */

/** Rutas donde la barra inferior NO debe mostrarse. */
const HIDDEN_ROUTES = ['/login', '/registro', '/reset-password'];

interface BottomNavItem {
  to: string;
  label: string;
  icon: typeof Home;
}

const ITEMS: BottomNavItem[] = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/buscar-viaje', label: 'Buscar', icon: Search },
  { to: '/mis-viajes', label: 'Mis viajes', icon: CalendarCheck },
  { to: '/perfil', label: 'Perfil', icon: UserRound },
];

const BottomNav = () => {
  const { pathname } = useLocation();
  if (HIDDEN_ROUTES.includes(pathname)) {
    return null;
  }

  return (
    <nav
      aria-label="Navegación principal"
      data-bottom-nav
      className="app-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-sm md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between px-2 pt-1.5 pb-1.5">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'flex min-h-[3rem] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  isActive ? 'text-teal-700' : 'text-slate-500 hover:text-slate-800',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className="h-6 w-6 shrink-0"
                    strokeWidth={isActive ? 2.4 : 1.9}
                    aria-hidden="true"
                  />
                  <span className="leading-none">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default BottomNav;
