import { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField, TextAreaField } from '../components/ui/FormField';

const OfferTripPage = () => {
  const [formData, setFormData] = useState({
    origin: '',
    destination: '',
    date: '',
    time: '',
    seatsAvailable: '',
    price: '',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.origin.trim()) {
      newErrors.origin = 'El origen es requerido';
    }

    if (!formData.destination.trim()) {
      newErrors.destination = 'El destino es requerido';
    }

    if (!formData.date) {
      newErrors.date = 'La fecha es requerida';
    } else {
      const selectedDate = new Date(formData.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (selectedDate < today) {
        newErrors.date = 'La fecha debe ser hoy o futura';
      }
    }

    if (!formData.time) {
      newErrors.time = 'La hora es requerida';
    }

    if (!formData.seatsAvailable) {
      newErrors.seatsAvailable = 'El número de lugares es requerido';
    } else {
      const seats = parseInt(formData.seatsAvailable);
      if (seats < 1 || seats > 8) {
        newErrors.seatsAvailable = 'Debe ser entre 1 y 8 lugares';
      }
    }

    if (!formData.price) {
      newErrors.price = 'El precio es requerido';
    } else {
      const price = parseFloat(formData.price);
      if (price < 0) {
        newErrors.price = 'El precio no puede ser negativo';
      }
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
        setFormData({
          origin: '',
          destination: '',
          date: '',
          time: '',
          seatsAvailable: '',
          price: '',
          notes: '',
        });
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Ofrecer Viaje
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Comparte tu viaje y ayuda a otros estudiantes a llegar a su destino mientras ahorras en gastos.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Información lateral */}
            <div className="lg:col-span-1">
              <Card className="p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Consejos para conductores</h3>
                <ul className="space-y-3">
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Sé específico con los puntos de encuentro
                  </li>
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Establece un precio justo y transparente
                  </li>
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Mantén tu vehículo limpio y seguro
                  </li>
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Sé puntual y respeta los horarios
                  </li>
                  <li className="flex items-start text-sm text-gray-600">
                    <svg className="w-5 h-5 text-indigo-600 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Comunica cualquier cambio con anticipación
                  </li>
                </ul>
              </Card>

              <Card className="p-6 bg-gradient-to-br from-green-50 to-teal-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Beneficios de ofrecer viajes</h3>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Reduce tus costos de viaje
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Conoce a otros estudiantes
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Contribuye al medio ambiente
                  </li>
                  <li className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Construye tu reputación
                  </li>
                </ul>
              </Card>
            </div>

            {/* Formulario principal */}
            <div className="lg:col-span-2">
              <Card className="p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Detalles del Viaje</h2>
                
                {isSubmitted ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
                    <svg className="w-16 h-16 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h3 className="text-xl font-semibold text-green-800 mb-2">¡Viaje Publicado!</h3>
                    <p className="text-green-700 mb-4">
                      Tu viaje ha sido publicado exitosamente. Los estudiantes interesados podrán ver tu viaje y enviar solicitudes.
                    </p>
                    <p className="text-sm text-green-600">
                      Esta funcionalidad estará completamente disponible cuando conectemos la base de datos.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        label="Origen"
                        name="origin"
                        value={formData.origin}
                        onChange={handleChange}
                        error={errors.origin}
                        placeholder="Ciudad de origen"
                      />
                      <FormField
                        label="Destino"
                        name="destination"
                        value={formData.destination}
                        onChange={handleChange}
                        error={errors.destination}
                        placeholder="Ciudad de destino"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        label="Fecha"
                        name="date"
                        type="date"
                        value={formData.date}
                        onChange={handleChange}
                        error={errors.date}
                      />
                      <FormField
                        label="Hora"
                        name="time"
                        type="time"
                        value={formData.time}
                        onChange={handleChange}
                        error={errors.time}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        label="Lugares Disponibles"
                        name="seatsAvailable"
                        type="number"
                        min="1"
                        max="8"
                        value={formData.seatsAvailable}
                        onChange={handleChange}
                        error={errors.seatsAvailable}
                        placeholder="Número de pasajeros"
                      />
                      <FormField
                        label="Precio por Persona (MXN)"
                        name="price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.price}
                        onChange={handleChange}
                        error={errors.price}
                        placeholder="0.00"
                      />
                    </div>

                    <TextAreaField
                      label="Notas Adicionales (Opcional)"
                      name="notes"
                      value={formData.notes}
                      onChange={handleChange}
                      placeholder="Información adicional como puntos de encuentro, preferencias, etc."
                      rows={4}
                    />

                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                      <div className="flex">
                        <div className="flex-shrink-0">
                          <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="ml-3">
                          <p className="text-sm text-yellow-700">
                            El viaje publicado será visible para otros estudiantes. Actualmente esta es una simulación. Cuando conectemos la base de datos, los viajes se guardarán realmente.
                          </p>
                        </div>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      fullWidth
                    >
                      Publicar Viaje
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

export default OfferTripPage;
