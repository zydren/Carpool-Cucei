import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getCurrentUser } from '../services/authService';

/**
 * Guardián de rutas privadas (único punto de protección).
 *
 * Reutiliza el authService existente (no crea un segundo sistema de auth):
 *   - 'checking': mientras se verifica la sesión, muestra el estado de carga y
 *     NO redirige (evita expulsar a un usuario con sesión válida que aún carga).
 *   - 'authed'  : renderiza la ruta solicitada (Outlet).
 *   - 'anon'    : redirige a /login conservando el destino en location.state.from,
 *     para que tras iniciar sesión el usuario vuelva a donde iba.
 *
 * Se aplica envolviendo rutas en App.tsx, así el comportamiento es idéntico al
 * entrar por menú, por botones de tarjetas o escribiendo la URL directamente.
 */

type AuthStatus = 'checking' | 'authed' | 'anon';

const ProtectedRoute = () => {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setStatus(user ? 'authed' : 'anon');
      } catch {
        // Un error al leer la sesión se trata como "no autenticado": se manda a
        // /login en lugar de mostrar una página rota.
        if (!cancelled) setStatus('anon');
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50" role="status">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-500">Cargando…</p>
        </div>
      </div>
    );
  }

  if (status === 'anon') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
