import { Link } from 'react-router-dom';
import { Car, CalendarCheck, UserRound, Search } from 'lucide-react';
import Card from '../components/ui/Card';
import { SectionHeader } from '../components/ui/PageBlocks';

const quickActions = [
  {
    to: '/buscar-viaje',
    icon: Search,
    title: 'Buscar viaje',
    description: 'Encuentra lugares disponibles hacia CUCEI.',
  },
  {
    to: '/ofrecer-viaje',
    icon: Car,
    title: 'Ofrecer viaje',
    description: 'Publica tu ruta y comparte el trayecto.',
  },
  {
    to: '/mis-viajes',
    icon: CalendarCheck,
    title: 'Mis viajes',
    description: 'Solicitudes, pasajeros y viajes aceptados.',
  },
  {
    to: '/registrar-auto',
    icon: UserRound,
    title: 'Mi auto',
    description: 'Mantén tu vehículo y seguro al día.',
  },
];

const DashboardHome = () => {
  return (
    <section className="bg-slate-50 py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Panel principal"
          title="Tu movilidad universitaria, más simple."
          description="Encuentra o comparte viajes hacia CUCEI desde un solo lugar."
        />
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className="group">
              <Card hover className="h-full p-6 app-animate-fade-up">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors duration-200 group-hover:bg-teal-700">
                  <action.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-slate-900">{action.title}</h3>
                <p className="mt-1 text-sm text-slate-500 leading-relaxed">{action.description}</p>
                <p className="mt-4 text-sm font-semibold text-teal-700">
                  Ir ahora <span aria-hidden="true">→</span>
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

export default DashboardHome;
