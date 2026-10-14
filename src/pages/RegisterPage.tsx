import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/PageBlocks';
import { AuthShell } from '../components/layout/AuthShell';
import { register, type RegisterParams } from '../services/authService';

const RegisterPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'El nombre completo es requerido';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'El correo es requerido';
    } else if (!formData.email.endsWith('@alumnos.udg.mx')) {
      newErrors.email = 'Debes utilizar tu correo institucional de estudiante @alumnos.udg.mx';
    }

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

    if (!formData.phone.trim()) {
      newErrors.phone = 'El teléfono es requerido';
    } else if (!/^\d{10}$/.test(formData.phone.replace(/\s/g, ''))) {
      newErrors.phone = 'El teléfono debe tener 10 dígitos (ej: 3312345678)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const params: RegisterParams = {
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        phone: formData.phone,
      };

      const data = await register(params);

      if (data.session) {
        // Usuario autenticado automáticamente (confirmación de email desactivada)
        setSuccessMessage('¡Registro exitoso! Redirigiendo...');
        setTimeout(() => {
          navigate('/');
        }, 1500);
      } else {
        // Requiere confirmación de email
        setSuccessMessage('¡Registro exitoso! Por favor confirma tu correo electrónico.');
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    } catch (error: unknown) {
      console.error('Registration error:', error);
      const message = error instanceof Error ? error.message : null;
      setErrors({ general: message || 'Error al registrar. Por favor intenta nuevamente.' });
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

  return (
    <AuthShell
      eyebrow="Nuevo en Carpool"
      title="Crear cuenta"
      description="Únete a Carpool Universitario y comienza a compartir viajes hacia CUCEI."
      footer={
        <p className="text-sm text-slate-500">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-semibold text-teal-700 hover:text-teal-800">
            Inicia sesión
          </Link>
        </p>
      }
    >
      <div className="mb-6 rounded-xl border border-teal-100 bg-teal-50/70 p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-teal-900">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Requisitos de contraseña
        </p>
        <ul className="list-inside list-disc space-y-1 text-xs text-slate-600">
          <li>Mínimo 10 caracteres</li>
          <li>Al menos una letra mayúscula</li>
          <li>Al menos una letra minúscula</li>
          <li>Al menos un número</li>
          <li>Al menos un carácter especial (!@#$%^&*(),.?":{}|&lt;&gt;)</li>
        </ul>
      </div>

      {successMessage && (
        <div className="mb-6">
          <Alert type="success">{successMessage}</Alert>
        </div>
      )}

      {errors.general && (
        <div className="mb-6">
          <Alert type="error">{errors.general}</Alert>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <FormField
          label="Nombre completo"
          name="fullName"
          type="text"
          value={formData.fullName}
          onChange={handleChange}
          placeholder="Tu nombre completo"
          error={errors.fullName}
          autoComplete="name"
          autoCapitalize="words"
        />

        <FormField
          label="Correo institucional"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="tu.correo@alumnos.udg.mx"
          error={errors.email}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        <FormField
          label="Contraseña"
          name="password"
          type="password"
          value={formData.password}
          onChange={handleChange}
          placeholder="Mínimo 10 caracteres con mayúscula, minúscula, número y especial"
          error={errors.password}
          autoComplete="new-password"
        />

        <FormField
          label="Confirmar contraseña"
          name="confirmPassword"
          type="password"
          value={formData.confirmPassword}
          onChange={handleChange}
          placeholder="Repite tu contraseña"
          error={errors.confirmPassword}
          autoComplete="new-password"
        />

        <FormField
          label="Teléfono"
          name="phone"
          type="tel"
          value={formData.phone}
          onChange={handleChange}
          placeholder="10 dígitos (ej: 3312345678)"
          error={errors.phone}
          autoComplete="tel"
          inputMode="tel"
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={isLoading}
          className="mt-2"
        >
          {isLoading ? 'Registrando...' : 'Crear cuenta'}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al inicio
        </Link>
      </div>
    </AuthShell>
  );
};

export default RegisterPage;
