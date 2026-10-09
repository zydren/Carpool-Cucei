import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import HomePage from './HomePage';
import DashboardPage from './DashboardPage';
import { getSession } from '../services/authService';

type SessionState = 'checking' | 'anonymous' | 'authenticated';

/**
 * Ruta raíz (`/`).
 *
 * - Usuario con sesión: muestra el Dashboard (pantalla principal).
 * - Visitante sin sesión: muestra la landing pública existente (HomePage).
 *
 * No modifica la autenticación: solo lee la sesión actual con el servicio
 * existente. La comprobación es local (no altera la sesión ni sus datos).
 */
const HomeRoute = () => {
  const [sessionState, setSessionState] = useState<SessionState>('checking');

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const session = await getSession();
        if (!cancelled) {
          setSessionState(session ? 'authenticated' : 'anonymous');
        }
      } catch (error) {
        console.error('[HomeRoute] No se pudo comprobar la sesión:', error);
        if (!cancelled) {
          setSessionState('anonymous');
        }
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, []);

  if (sessionState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center" role="status">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-500">Cargando…</p>
        </div>
      </div>
    );
  }

  return sessionState === 'authenticated' ? <DashboardPage /> : <HomePage />;
};

export default HomeRoute;
