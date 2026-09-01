import { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';

interface FAQItem {
  question: string;
  answer: string;
}

const FAQPage = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs: FAQItem[] = [
    {
      question: '¿Qué es Carpool Universitario?',
      answer: 'Carpool Universitario es una plataforma de carpool diseñada exclusivamente para estudiantes universitarios. Conecta a conductores que tienen espacios disponibles en sus vehículos con pasajeros que necesitan transporte, permitiendo compartir gastos de viaje de manera segura y económica.',
    },
    {
      question: '¿Quién puede utilizar la plataforma?',
      answer: 'Actualmente, la plataforma está diseñada para estudiantes universitarios. Para registrarte, necesitas un correo electrónico institucional de tu universidad. Esto nos ayuda a mantener una comunidad segura y verificada.',
    },
    {
      question: '¿Cómo puedo buscar un viaje?',
      answer: 'Para buscar un viaje, ingresa a la sección "Buscar viaje", completa los campos de origen, destino y fecha deseada. El sistema te mostrará los viajes disponibles que coincidan con tu búsqueda. Luego puedes enviar una solicitud al conductor.',
    },
    {
      question: '¿Cómo puedo ofrecer un viaje?',
      answer: 'Para ofrecer un viaje, ve a la sección "Ofrecer viaje" y completa la información del viaje: origen, destino, fecha, hora, número de lugares disponibles y el costo estimado por pasajero. Una vez publicado, otros estudiantes podrán ver tu viaje y solicitar unirse.',
    },
    {
      question: '¿Tiene algún costo utilizar la plataforma?',
      answer: 'El uso de la plataforma es gratuito para estudiantes. Los únicos costos son los que se acuerden entre conductor y pasajeros para cubrir gastos como combustible, peajes y estacionamiento. Estos costos se dividen equitativamente entre todos los ocupantes del vehículo.',
    },
    {
      question: '¿Cómo funcionan las solicitudes?',
      answer: 'Cuando encuentras un viaje que te interesa, envías una solicitud al conductor. El conductor recibirá tu solicitud y podrá revisar tu perfil antes de aceptar o rechazar. Una vez aceptado, recibirás la confirmación y los detalles de contacto del conductor.',
    },
    {
      question: '¿Cómo funciona la seguridad?',
      answer: 'Implementamos varias medidas de seguridad: verificación de correo institucional, perfiles públicos, y en el futuro tendremos sistema de calificaciones, verificación de identidad y seguimiento en tiempo real. Además, ofrecemos recomendaciones para viajes seguros y tenemos políticas contra conductas prohibidas.',
    },
    {
      question: '¿Qué ocurre si un viaje se cancela?',
      answer: 'Si un viaje necesita cancelarse, se recomienda notificar con la mayor antelación posible a los pasajeros o conductor. Actualmente estamos desarrollando políticas de cancelación claras que incluirán reembolsos y penalizaciones para cancelaciones de última hora.',
    },
    {
      question: '¿Es obligatorio aceptar todas las solicitudes?',
      answer: 'No, como conductor tienes total libertad para aceptar o rechazar solicitudes según tu criterio. Te recomendamos revisar los perfiles de los solicitantes y calificaciones (cuando estén disponibles) antes de tomar una decisión.',
    },
    {
      question: '¿Puedo cancelar mi solicitud después de enviarla?',
      answer: 'Sí, puedes cancelar tu solicitud en cualquier momento antes de que el conductor la acepte. Una vez aceptada, se recomienda comunicarse directamente con el conductor para coordinar cualquier cambio.',
    },
  ];

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Preguntas Frecuentes
            </h1>
            <p className="text-xl text-gray-600">
              Encuentra respuestas a las preguntas más comunes sobre Carpool Universitario.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <Card key={index} className="overflow-hidden">
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between focus:outline-none"
                >
                  <span className="text-lg font-semibold text-gray-900 pr-4">
                    {faq.question}
                  </span>
                  <svg
                    className={`w-5 h-5 text-indigo-600 flex-shrink-0 transition-transform duration-200 ${
                      openIndex === index ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {openIndex === index && (
                  <div className="px-6 pb-4">
                    <p className="text-gray-600 leading-relaxed">
                      {faq.answer}
                    </p>
                  </div>
                )}
              </Card>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Card className="p-8 bg-gradient-to-r from-indigo-50 to-purple-50">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                ¿No encontraste tu respuesta?
              </h3>
              <p className="text-gray-600 mb-4">
                Estamos aquí para ayudarte. Contáctanos directamente.
              </p>
              <button className="bg-indigo-600 text-white hover:bg-indigo-700 font-medium py-2 px-6 rounded-lg transition-colors">
                Ir a Contacto
              </button>
            </Card>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default FAQPage;
