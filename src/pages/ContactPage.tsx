import { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField, TextAreaField } from '../components/ui/FormField';

const ContactPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'El nombre es requerido';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'El correo electrónico es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'El correo electrónico no es válido';
    }

    if (!formData.subject.trim()) {
      newErrors.subject = 'El asunto es requerido';
    }

    if (!formData.message.trim()) {
      newErrors.message = 'El mensaje es requerido';
    } else if (formData.message.trim().length < 10) {
      newErrors.message = 'El mensaje debe tener al menos 10 caracteres';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      setIsSubmitted(true);
      // Simulación de envío
      setTimeout(() => {
        setIsSubmitted(false);
        setFormData({ name: '', email: '', subject: '', message: '' });
      }, 3000);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    // Limpiar error del campo cuando el usuario empieza a escribir
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="pt-24 pb-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Contacto
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              ¿Tienes preguntas o sugerencias? Estamos aquí para ayudarte. Envíanos un mensaje y te responderemos lo antes posible.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Información de contacto */}
            <div>
              <Card className="p-8 mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Información de Contacto</h2>
                
                <div className="space-y-6">
                  <div className="flex items-start">
                    <div className="flex-shrink-0 w-12 h-12 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center mr-4">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Correo Electrónico</h3>
                      <p className="text-gray-600">contacto@carpool-universitario.com</p>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <div className="flex-shrink-0 w-12 h-12 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center mr-4">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Ubicación</h3>
                      <p className="text-gray-600">Plataforma web disponible para estudiantes universitarios de todo el país</p>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <div className="flex-shrink-0 w-12 h-12 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center mr-4">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Horario de Respuesta</h3>
                      <p className="text-gray-600">Lunes a Viernes: 9:00 AM - 6:00 PM</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-8 bg-gradient-to-br from-indigo-50 to-purple-50">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">¿Por qué contactarnos?</h3>
                <ul className="space-y-3">
                  <li className="flex items-center text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Reportar problemas técnicos
                  </li>
                  <li className="flex items-center text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Sugerencias de mejora
                  </li>
                  <li className="flex items-center text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Preguntas sobre la plataforma
                  </li>
                  <li className="flex items-center text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Colaboraciones universitarias
                  </li>
                </ul>
              </Card>
            </div>

            {/* Formulario de contacto */}
            <div>
              <Card className="p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Envíanos un Mensaje</h2>
                
                {isSubmitted ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                    <svg className="w-16 h-16 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h3 className="text-xl font-semibold text-green-800 mb-2">¡Mensaje Enviado!</h3>
                    <p className="text-green-700">
                      Gracias por contactarnos. Hemos recibido tu mensaje y te responderemos lo antes posible.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
                    <FormField
                      label="Nombre"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      error={errors.name}
                      placeholder="Tu nombre completo"
                    />

                    <FormField
                      label="Correo Electrónico"
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleChange}
                      error={errors.email}
                      placeholder="tu.correo@universidad.edu"
                    />

                    <FormField
                      label="Asunto"
                      name="subject"
                      value={formData.subject}
                      onChange={handleChange}
                      error={errors.subject}
                      placeholder="¿Cuál es el motivo de tu mensaje?"
                    />

                    <TextAreaField
                      label="Mensaje"
                      name="message"
                      value={formData.message}
                      onChange={handleChange}
                      error={errors.message}
                      placeholder="Escribe tu mensaje aquí..."
                      rows={6}
                    />

                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      fullWidth
                      className="mt-4"
                    >
                      Enviar Mensaje
                    </Button>
                  </form>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default ContactPage;
