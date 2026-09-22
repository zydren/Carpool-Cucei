import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getCurrentUser, logout } from '../services/authService';
import NotificationBell from './NotificationBell';
import { getShortDisplayName } from '../utils/displayName';

const NAV_LINK_BASE =
  'px-2 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

/** Enlaces públicos principales (visibles siempre en desktop). */
const PUBLIC_LINKS = [
  { to: '/', label: 'Inicio' },
  { to: '/como-funciona', label: 'Cómo funciona' },
  { to: '/seguridad', label: 'Seguridad' },
  { to: '/preguntas-frecuentes', label: 'FAQ' },
  { to: '/contacto', label: 'Contacto' },
] as const;

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [user, setUser] = useState<{ email?: string; full_name?: string } | null>(null);
  const location = useLocation();
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const checkUser = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (currentUser) {
          setUser({
            email: currentUser.email,
            full_name: currentUser.user_metadata.full_name,
          });
        }
      } catch (error) {
        console.error('Error checking user:', error);
      }
    };

    checkUser();
  }, []);

  // Cierra el menú de usuario al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsUserMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUserMenuOpen]);

  // Al cambiar de ruta se cierran los menús (sin setState en efecto:
  // cada enlace/botón ya cierra su menú en su propio onClick).
  const closeAllMenus = () => {
    setIsMenuOpen(false);
    setIsUserMenuOpen(false);
  };

  const isActive = (path: string) => location.pathname === path;

  /** Nombre corto: dos primeros nombres, sin "Hola,". */
  const shortName = getShortDisplayName(user?.full_name, user?.email);

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      window.location.href = '/';
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const publicLinkClass = (path: string) =>
    `${NAV_LINK_BASE} ${isActive(path) ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'}`;

  // Nota: location.pathname se lee en cada render para `isActive`, sin efectos.

  return (
    <nav className="bg-white shadow-md fixed w-full top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16">
          <div className="flex items-center flex-shrink-0 min-w-0">
            <Link to="/" className="flex-shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" onClick={closeAllMenus}>
              <h1 className="text-lg xl:text-2xl font-bold text-indigo-600 hover:text-indigo-700 transition-colors whitespace-nowrap">
                Carpool Universitario
              </h1>
            </Link>
          </div>
          
          <div className="hidden lg:flex flex-1 items-center justify-between gap-4 min-w-0">
            <nav className="flex flex-1 items-center justify-evenly gap-1 min-w-0" aria-label="Navegación principal">
              {PUBLIC_LINKS.map((link) => (
                <Link key={link.to} to={link.to} className={publicLinkClass(link.to)}>
                  {link.label}
                </Link>
              ))}
              {user && (
                <Link to="/mis-viajes" className={publicLinkClass('/mis-viajes')}>
                  Mis viajes
                </Link>
              )}
              {user && (
                <Link to="/registrar-auto" className={publicLinkClass('/registrar-auto')}>
                  Mi auto
                </Link>
              )}
            </nav>
            {/* Grupo 2b: acciones de viaje */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                to="/buscar-viaje"
                className="bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Buscar viaje
              </Link>
              <Link
                to="/ofrecer-viaje"
                className="bg-transparent border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Ofrecer viaje
              </Link>
            </div>

            {/* Grupo 3: usuario */}
            {user ? (
              <div className="flex items-center gap-3 flex-shrink-0 pl-3 border-l border-gray-200">
                <NotificationBell />
                <div className="relative" ref={userMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsUserMenuOpen((open) => !open)}
                    aria-expanded={isUserMenuOpen}
                    aria-haspopup="menu"
                    aria-label="Abrir menú de usuario"
                    title={user.full_name || user.email}
                    className="max-w-32 truncate text-sm font-semibold text-gray-800 hover:text-indigo-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md px-1 py-1"
                  >
                    {shortName}
                  </button>
                  {isUserMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                    >
                      <Link
                        to="/perfil"
                        role="menuitem"
                        onClick={() => setIsUserMenuOpen(false)}
                        className={`block px-4 py-2 text-sm ${isActive('/perfil') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:bg-gray-50 hover:text-indigo-600'}`}
                      >
                        Mi perfil
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          void handleLogout();
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-indigo-600"
                      >
                        Cerrar sesión
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-shrink-0 pl-3 border-l border-gray-200">
                <Link
                  to="/login"
                  className="text-sm text-gray-700 hover:text-indigo-600 font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md px-1 py-1"
                >
                  Iniciar sesión
                </Link>
                <Link
                  to="/registro"
                  className="bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Registrarse
                </Link>
              </div>
            )}
          </div>

          {/* Tablet (md hasta lg): versión compacta sin encimados */}
          <div className="hidden md:flex lg:hidden flex-1 items-center justify-end gap-2 min-w-0">
            <Link
              to="/buscar-viaje"
              className="bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Buscar viaje
            </Link>
            <Link
              to="/ofrecer-viaje"
              className="bg-transparent border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Ofrecer viaje
            </Link>
            {user && (
              <div className="flex items-center gap-2 pl-2 border-l border-gray-200 min-w-0">
                <NotificationBell />
                <Link
                  to="/perfil"
                  title={user.full_name || user.email}
                  className="max-w-28 truncate text-sm font-semibold text-gray-800 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md px-1 py-1"
                >
                  {shortName}
                </Link>
              </div>
            )}
          </div>

          <div className="md:hidden flex items-center gap-2">
            {user && (
              <NotificationBell align="left" onNavigate={() => setIsMenuOpen(false)} />
            )}
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-gray-700 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md p-1"
              aria-label={isMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={isMenuOpen}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isMenuOpen && (
        <div className="md:hidden overflow-x-hidden bg-white border-t">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 max-w-full">
            <Link 
              to="/" 
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
              }`}
              onClick={() => setIsMenuOpen(false)}
            >
              Inicio
            </Link>
            <Link 
              to="/como-funciona" 
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/como-funciona') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
              }`}
              onClick={() => setIsMenuOpen(false)}
            >
              Cómo funciona
            </Link>
            <Link 
              to="/seguridad" 
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/seguridad') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
              }`}
              onClick={() => setIsMenuOpen(false)}
            >
              Seguridad
            </Link>
            <Link 
              to="/preguntas-frecuentes" 
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/preguntas-frecuentes') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
              }`}
              onClick={() => setIsMenuOpen(false)}
            >
              FAQ
            </Link>
            <Link 
              to="/contacto" 
              className={`block px-3 py-2 rounded-md text-base font-medium ${
                isActive('/contacto') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
              }`}
              onClick={() => setIsMenuOpen(false)}
            >
              Contacto
            </Link>
            <Link 
              to="/buscar-viaje" 
              className="w-full text-left bg-indigo-600 text-white hover:bg-indigo-700 block px-3 py-2 rounded-md text-base font-medium mt-2"
              onClick={() => setIsMenuOpen(false)}
            >
              Buscar viaje
            </Link>
            <Link 
              to="/ofrecer-viaje" 
              className="w-full text-left bg-transparent border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 block px-3 py-2 rounded-md text-base font-medium mt-2"
              onClick={() => setIsMenuOpen(false)}
            >
              Ofrecer viaje
            </Link>
            {user && (
              <Link 
                to="/mis-viajes" 
                className={`w-full text-left block px-3 py-2 rounded-md text-base font-medium ${
                  isActive('/mis-viajes') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                }`}
                onClick={() => setIsMenuOpen(false)}
              >
                Mis viajes
              </Link>
            )}
            {user && (
              <Link
                to="/registrar-auto"
                className={`w-full text-left block px-3 py-2 rounded-md text-base font-medium ${
                  isActive('/registrar-auto') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                }`}
                onClick={() => setIsMenuOpen(false)}
              >
                Mi auto
              </Link>
            )}
            
            {user ? (
              <>
                <div className="mt-4 pt-4 border-t min-w-0">
                  <Link
                    to="/perfil"
                    className="block truncate text-sm text-gray-700 hover:text-indigo-600 font-medium mb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md px-1 py-1"
                    onClick={() => setIsMenuOpen(false)}
                    title={user.full_name || user.email}
                  >
                    {shortName}
                  </Link>
                  <Link
                    to="/perfil"
                    className={`block px-3 py-2 rounded-md text-base font-medium ${
                      isActive('/perfil') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                    }`}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Mi perfil
                  </Link>
                  <button
                    onClick={() => {
                      closeAllMenus();
                      void handleLogout();
                    }}
                    className="w-full text-left text-sm text-gray-600 hover:text-indigo-600 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md px-1 py-1"
                  >
                    Cerrar sesión
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link 
                  to="/login" 
                  className="w-full text-left text-sm text-gray-700 hover:text-indigo-600 font-medium mt-2"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Iniciar sesión
                </Link>
                <Link 
                  to="/registro" 
                  className="w-full text-left bg-indigo-600 text-white hover:bg-indigo-700 block px-3 py-2 rounded-md text-base font-medium mt-2"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Registrarse
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
