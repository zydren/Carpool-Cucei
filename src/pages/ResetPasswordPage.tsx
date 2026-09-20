import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { updatePassword } from '../services/authService';
import { ArrowLeft } from 'lucide-react';

/**
 * Página de destino del enlace de recuperación enviado por correo.
 * Supabase procesa el token del enlace (#access_token=...) automáticamente
 * y deja al usuario con una sesión en modo "recovery", lo que permite
 * actualizar la contraseña con updatePassword().
 */
const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.password) {
      newErrors.password = 'La contraseña es requerida';
    } else if (formData.password.length < 10) {
      newErrors.password = 'La contraseña debe tener al menos 10 caracteres';
    } else if (!/[A-Z]/.test(formData.password)) {
      newErrors.password = 'La contraseña debe tener al menos una letra mayúscula';
    } else if (!/[a-z]/.test(formData.password)) {
      newErrors.password = 'La contraseña debe tener al menos una letra minúscula';
    } else if (!/[0-9]/.test(formData.password)) {
      newErrors.password = 'La contraseña debe tener al menos un número';
    } else if (!/[!@#$%^&*(),.?":{}|<>]/.test(formData.password)) {
      newErrors.password = 'La contraseña debe tener al menos un carácter especial (!@#$%^&*(),.?":{}|<>)';
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    if (errors[name]) {
      setErrors({ ...errors, [name]: '' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      await updatePassword(formData.password);
      setSuccessMessage('¡Contraseña actualizada correctamente!');
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (error: unknown) {
      console.error('Error updating password:', error);
      const message = error instanceof Error ? error.message : '';
      const rawMessage = message.toLowerCase();
      if (
        rawMessage.includes('expired') ||
        rawMessage.includes('invalid') ||
        rawMessage.includes('missing') ||
        rawMessage.includes('session')
      ) {
        setErrors({
          general:
            'El enlace de recuperación no es válido o ya expiró. Solicita uno nuevo desde el inicio de sesión.',
        });
      } else if (message) {
        setErrors({ general: message });
      } else {
        setErrors({ general: 'No se pudo actualizar la contraseña. Intenta nuevamente.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Restablecer Contraseña
            </h1>
            <p className="text-gray-600">
              Elige una nueva contraseña para tu cuenta
            </p>
          </div>

          <Card className="p-8">
            {successMessage && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-800 text-sm">{successMessage}</p>
              </div>
            )}

            {errors.general && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm">{errors.general}</p>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <FormField
                label="Nueva contraseña"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Mínimo 10 caracteres con mayúscula, minúscula, número y especial"
                error={errors.password}
              />

              <FormField
                label="Confirmar contraseña"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Repite tu nueva contraseña"
                error={errors.confirmPassword}
              />

              <div className="mt-2 mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                La contraseña debe contener:
                <ul className="list-disc pl-4 mt-1">
                  <li>Al menos 10 caracteres</li>
                  <li>Al menos una letra mayúscula</li>
                  <li>Al menos una letra minúscula</li>
                  <li>Al menos un número</li>
                  <li>Al menos un carácter especial (!@#$%^&*(),.?&quot;:{}|&lt;&gt;)</li>
                </ul>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                disabled={isLoading}
                className="mt-2"
              >
                {isLoading ? 'Guardando...' : 'Actualizar Contraseña'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 font-medium"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Volver a Iniciar Sesión
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default ResetPasswordPage;