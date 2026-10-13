import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import Modal from '../components/ui/Modal';
import { Alert } from '../components/ui/PageBlocks';
import { AuthShell } from '../components/layout/AuthShell';
import { login, resetPassword, type LoginParams } from '../services/authService';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Destino original al que el usuario iba antes de ser enviado a /login
  // (lo guarda ProtectedRoute en location.state.from). Si no existe, va a '/'.
  const fromPathname = (location.state as { from?: string } | null)?.from ?? '/';
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
      navigate(fromPathname, { replace: true });
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
    <AuthShell
      eyebrow="Bienvenido de nuevo"
      title="Iniciar sesión"
      description="Accede a tu cuenta para buscar y ofrecer viajes hacia CUCEI."
      footer={
        <p className="text-sm text-slate-600">
          ¿No tienes cuenta?{' '}
          <Link
            to="/registro"
            className="font-semibold text-teal-700 hover:text-teal-800"
          >
            Regístrate
          </Link>
        </p>
      }
    >
      {errors.general && (
        <div className="mb-6">
          <Alert type="error">{errors.general}</Alert>
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

        <div className="mb-6 text-right">
          <button
            type="button"
            onClick={handleOpenForgot}
            className="-mt-2 rounded text-sm font-medium text-teal-700 transition-colors hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={isLoading}
        >
          {isLoading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
        </Button>
      </form>

      <Modal
        open={isForgotModalOpen}
        onClose={handleCloseForgot}
        title="Recuperar contraseña"
        description="Te enviaremos un enlace para restablecer tu contraseña."
      >
        {forgotMessage && (
          <div className="mb-4">
            <Alert type="success">{forgotMessage}</Alert>
          </div>
        )}

        {forgotError && (
          <div className="mb-4">
            <Alert type="error">{forgotError}</Alert>
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
            fullWidth
            disabled={isSendingReset || !!forgotMessage}
          >
            {isSendingReset ? 'Enviando...' : 'Enviar enlace de recuperación'}
          </Button>
        </form>

        <p className="mt-4 text-xs text-slate-500">
          Si el correo está registrado, recibirás un enlace para crear una nueva
          contraseña. No compartas tus contraseñas con nadie.
        </p>
      </Modal>
    </AuthShell>
  );
};

export default LoginPage;
