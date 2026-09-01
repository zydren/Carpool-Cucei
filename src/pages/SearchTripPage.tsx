import { useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';

interface Trip {
  id: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  seatsAvailable: number;
  price: number;
  driver: {
    name: string;
    rating: number;
    university: string;
  };
}

const SearchTripPage = () => {
  const [searchParams, setSearchParams] = useState({
    origin: '',
    destination: '',
    date: '',
  });
  const [hasSearched, setHasSearched] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);

  // Datos simulados de viajes
  const mockTrips: Trip[] = [
    {
      id: '1',
      origin: 'Guadalajara, Jalisco',
      destination: 'Ciudad de México',
      date: '2024-09-15',
      time: '07:00',
      seatsAvailable: 3,
      price: 350,
      driver: {
        name: 'Carlos Martínez',
        rating: 4.8,
        university: 'Universidad de Guadalajara',
      },
    },
    {
      id: '2',
      origin: 'Guadalajara, Jalisco',
      destination: 'Morelia, Michoacán',
      date: '2024-09-16',
      time: '08:30',
      seatsAvailable: 2,
      price: 280,
      driver: {
        name: 'Ana Rodríguez',
        rating: 4.9,
        university: 'ITESO',
      },
    },
    {
      id: '3',
      origin: 'Guadalajara, Jalisco',
      destination: 'León, Guanajuato',
      date: '2024-09-15',
      time: '10:00',
      seatsAvailable: 4,
      price: 200,
      driver: {
        name: 'Miguel Ángel López',
        rating: 4.7,
        university: 'Universidad de Guadalajara',
      },
    },
    {
      id: '4',
      origin: 'Zapopan, Jalisco',
      destination: 'Ciudad de México',
      date: '2024-09-17',
      time: '06:00',
      seatsAvailable: 1,
      price: 380,
      driver: {
        name: 'Laura García',
        rating: 5.0,
        university: 'Panamericana',
      },
    },
  ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSearched(true);
    // Simular búsqueda - en un caso real filtraríamos por los parámetros
    setTrips(mockTrips);
  };

  const handleRequestTrip = (tripId: string) => {
    alert(`Solicitud enviada para el viaje ${tripId}. Esta funcionalidad estará disponible cuando conectemos la base de datos.`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <div className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Buscar Viaje
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Encuentra el viaje perfecto para tu próximo destino. Comparte gastos y conoce a otros estudiantes.
            </p>
          </div>

          {/* Formulario de búsqueda */}
          <Card className="p-8 mb-12">
            <form onSubmit={handleSearch}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  label="Origen"
                  name="origin"
                  value={searchParams.origin}
                  onChange={(e) => setSearchParams({ ...searchParams, origin: e.target.value })}
                  placeholder="¿De dónde sales?"
                />
                <FormField
                  label="Destino"
                  name="destination"
                  value={searchParams.destination}
                  onChange={(e) => setSearchParams({ ...searchParams, destination: e.target.value })}
                  placeholder="¿A dónde vas?"
                />
                <FormField
                  label="Fecha"
                  name="date"
                  type="date"
                  value={searchParams.date}
                  onChange={(e) => setSearchParams({ ...searchParams, date: e.target.value })}
                />
              </div>
              <Button type="submit" variant="primary" size="lg" fullWidth className="mt-6">
                Buscar Viajes
              </Button>
            </form>
          </Card>

          {/* Resultados de búsqueda */}
          {hasSearched && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                Viajes Disponibles
                <span className="text-indigo-600 ml-2">({trips.length})</span>
              </h2>

              {trips.length === 0 ? (
                <Card className="p-12 text-center">
                  <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    No se encontraron viajes
                  </h3>
                  <p className="text-gray-600">
                    Intenta con diferentes fechas o rutas. ¡O considera ofrecer un viaje tú mismo!
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {trips.map((trip) => (
                    <Card key={trip.id} className="p-6 hover" hover>
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-gray-600">{trip.origin}</span>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-gray-600">{trip.destination}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-indigo-600">${trip.price}</p>
                          <p className="text-sm text-gray-500">por persona</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm text-gray-600">
                            {new Date(trip.date).toLocaleDateString('es-MX', { 
                              weekday: 'short', 
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric' 
                            })}
                          </span>
                        </div>
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-gray-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm text-gray-600">{trip.time}</span>
                        </div>
                      </div>

                      <div className="border-t pt-4 mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center mr-3">
                              <span className="text-indigo-600 font-semibold">
                                {trip.driver.name.charAt(0)}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{trip.driver.name}</p>
                              <p className="text-sm text-gray-500">{trip.driver.university}</p>
                            </div>
                          </div>
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-yellow-400 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                            <span className="font-medium text-gray-900">{trip.driver.rating}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <svg className="w-5 h-5 text-indigo-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <span className="text-sm text-gray-600">
                            {trip.seatsAvailable} {trip.seatsAvailable === 1 ? 'lugar disponible' : 'lugares disponibles'}
                          </span>
                        </div>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleRequestTrip(trip.id)}
                        >
                          Solicitar Lugar
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Información adicional */}
          {!hasSearched && (
            <Card className="p-8 bg-gradient-to-r from-indigo-50 to-purple-50 text-center">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                ¿No encuentras lo que buscas?
              </h3>
              <p className="text-gray-600 mb-4">
                Considera ofrecer un viaje tú mismo y ayuda a otros estudiantes a llegar a su destino.
              </p>
              <Button variant="outline" size="lg">
                Ofrecer Viaje
              </Button>
            </Card>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default SearchTripPage;
