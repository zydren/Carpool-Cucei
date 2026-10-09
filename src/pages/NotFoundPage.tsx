import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Button from '../components/ui/Button';

const NotFoundPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar />
      
      <div className="flex-grow flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-lg w-full text-center">
          <div className="mb-8">
            <h1 className="text-9xl font-bold text-teal-700 mb-4">404</h1>
            <div className="w-24 h-1 bg-slate-900 mx-auto mb-8"></div>
          </div>
          
          <h2 className="text-3xl font-bold text-slate-900 mb-4">
            Página No Encontrada
          </h2>
          
          <p className="text-xl text-slate-600 mb-8">
            Lo sentimos, la página que estás buscando no existe o ha sido movida.
          </p>
          
          <div className="space-y-4">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => navigate('/')}
            >
              Volver al Inicio
            </Button>
            
            <Button
              variant="outline"
              size="lg"
              fullWidth
              onClick={() => navigate(-1)}
            >
              Volver Atrás
            </Button>
          </div>

          <div className="mt-12">
            <svg className="w-48 h-48 mx-auto text-teal-500/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default NotFoundPage;
