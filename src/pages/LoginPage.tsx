import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { login, resetPassword, type LoginParams } from '../services/authService';
import Modal from '../components/ui/Modal';
import { ArrowLeft } from 'lucide-react';

const LoginPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Recuperación de contraseña
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.email.trim()) {
      newErrors.email = 'El correo es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'El correo no es válido';
    }

    if (!formData.password) {
      newErrors.password = 'La contraseña es requerida';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const params: LoginParams = {
        email: formData.email,
        password: formData.password,
      };

      await login(params);
      navigate('/');
    } catch (error: unknown) {
      console.error('Login error:', error);
      const message = error instanceof Error ? error.message : null;
      setErrors({ general: message || 'Error al iniciar sesión. Por favor verifica tus credenciales.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' });
    }
  };

  const handleOpenForgot = () => {
    setForgotEmail(formData.email);
    setForgotError(null);
    setForgotMessage(null);
    setIsForgotModalOpen(true);
  };

  const handleCloseForgot = () => {
    setIsForgotModalOpen(false);
    setForgotError(null);
    setForgotMessage(null);
  };

  const handleForgotEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForgotEmail(e.target.value);
    if (forgotError) {
      setForgotError(null);
    }
  };

  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!forgotEmail.trim()) {
      setForgotError('Escribe tu correo electrónico para enviarte el enlace.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail.trim())) {
      setForgotError('El correo no es válido.');
      return;
    }

    setIsSendingReset(true);
    setForgotError(null);

    try {
      await resetPassword(forgotEmail.trim());
      setForgotMessage(
        'Si el correo está registrado, te hemos enviado un enlace para restablecer tu contraseña. Revisa también la carpeta de spam.'
      );
    } catch (error: unknown) {
      console.error('Error enviando enlace de restablecimiento:', error);
      const message = error instanceof Error ? error.message : null;
      setForgotError(message || 'No se pudo enviar el enlace. Intenta nuevamente.');
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="pt-24 pb-16">
        <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Iniciar Sesión
            </h1>
            <p className="text-gray-600">
              Accede a tu cuenta para buscar y ofrecer viajes
            </p>
          </div>

          <Card className="p-8">
            {errors.general && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm">{errors.general}</p>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <FormField
                label="Correo electrónico"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="tu.correo@alumnos.udg.mx"
                error={errors.email}
              />

              <FormField
                label="Contraseña"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Tu contraseña"
                error={errors.password}
              />

              <button
                type="button"
                onClick={handleOpenForgot}
                className="text-sm text-indigo-600 hover:text-indigo-700 mt-1"
              >
                ¿Olvidaste tu contraseña?
              </button>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                disabled={isLoading}
                className="mt-6"
              >
                {isLoading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-gray-600">
                ¿No tienes cuenta?{' '}
                <Link to="/registro" className="text-indigo-600 hover:text-indigo-700 font-medium">
                  Regístrate
                </Link>
              </p>
            </div>
          </Card>

          <Modal
            open={isForgotModalOpen}
            onClose={handleCloseForgot}
            title="Recuperar contraseña"
          >
            {forgotMessage && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-800 text-sm">{forgotMessage}</p>
              </div>
            )}

            {forgotError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm">{forgotError}</p>
              </div>
            )}

            <form onSubmit={handleSendReset}>
              <FormField
                label="Correo electrónico"
                name="forgotEmail"
                type="email"
                value={forgotEmail}
                onChange={handleForgotEmailChange}
                placeholder="tu.correo@alumnos.udg.mx"
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                disabled={isSendingReset || !!forgotMessage}
                className="mt-2"
              >
                {isSendingReset ? 'Enviando...' : 'Enviar enlace de recuperación'}
              </Button>
            </form>

            <p className="mt-4 text-xs text-gray-500">
              Si el correo está registrado, recibirás un enlace para crear una nueva
              contraseña. No compartas tus contraseñas con nadie.
            </p>
          </Modal>

          <div className="mt-6 text-center">
            <Link to="/" className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-700 text-sm">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Volver al inicio
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default LoginPage;
