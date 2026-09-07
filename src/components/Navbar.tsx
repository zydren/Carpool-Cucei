import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getCurrentUser, logout } from '../services/authService';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState<{ email?: string; full_name?: string } | null>(null);
  const location = useLocation();

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

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      window.location.href = '/';
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <nav className="bg-white shadow-md fixed w-full top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0">
              <h1 className="text-2xl font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
                Carpool Universitario
              </h1>
            </Link>
          </div>
          
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-4">
              <Link 
                to="/" 
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                }`}
              >
                Inicio
              </Link>
              <Link 
                to="/como-funciona" 
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/como-funciona') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                }`}
              >
                Cómo funciona
              </Link>
              <Link 
                to="/seguridad" 
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/seguridad') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                }`}
              >
                Seguridad
              </Link>
              <Link 
                to="/preguntas-frecuentes" 
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/preguntas-frecuentes') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                }`}
              >
                FAQ
              </Link>
              <Link 
                to="/contacto" 
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive('/contacto') ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700 hover:text-indigo-600'
                }`}
              >
                Contacto
              </Link>
              <Link 
                to="/buscar-viaje" 
                className="bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Buscar viaje
              </Link>
              <Link 
                to="/ofrecer-viaje" 
                className="bg-transparent border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Ofrecer viaje
              </Link>
              
              {user ? (
                <>
                  <div className="ml-4 flex items-center space-x-3">
                    <span className="text-sm text-gray-700">
                      Hola, {user.full_name || user.email}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="text-sm text-gray-600 hover:text-indigo-600 font-medium"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <Link 
                    to="/login" 
                    className="text-sm text-gray-700 hover:text-indigo-600 font-medium transition-colors"
                  >
                    Iniciar sesión
                  </Link>
                  <Link 
                    to="/registro" 
                    className="bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Registrarse
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="md:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-gray-700 hover:text-indigo-600 focus:outline-none"
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
        <div className="md:hidden bg-white border-t">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
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
            
            {user ? (
              <>
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm text-gray-700 mb-2">
                    Hola, {user.full_name || user.email}
                  </p>
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsMenuOpen(false);
                    }}
                    className="w-full text-left text-sm text-gray-600 hover:text-indigo-600 font-medium"
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
