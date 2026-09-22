import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, MapPin, Users } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { ProfileHeader, StatsGrid, PublicCarCard, RatingsList } from '../components/ProfileCard';
import { formatDate } from '../utils/profileFormat';
import { getCurrentUser } from '../services/authService';
import { getPublicProfile, getUserPublicCar, getUserRatings, getUserTripStats } from '../services/profileService';
import type { PublicProfile, PublicCar, ReceivedRating, UserTripStats } from '../services/profileService';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not-found' }
  | { status: 'ready' };

/** /perfil/:userId — perfil público de otro usuario (solo autenticados). */
const PublicProfilePage = () => {
  const navigate = useNavigate();
  const { userId } = useParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [stats, setStats] = useState<UserTripStats>({ offeredTrips: 0, passengerTrips: 0 });
  const [ratings, setRatings] = useState<ReceivedRating[]>([]);
  const [car, setCar] = useState<PublicCar | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const user = await getCurrentUser();
      if (!user) {
        navigate('/login');
        return;
      }
      if (!userId) {
        setState({ status: 'not-found' });
        return;
      }
      if (userId === user.id) {
        navigate('/perfil');
        return;
      }
      const [pub, tripStats, received, publicCar] = await Promise.all([
        getPublicProfile(userId),
        getUserTripStats(userId),
        getUserRatings(userId),
        getUserPublicCar(userId),
      ]);
      setProfile(pub);
      setStats(tripStats);
      setRatings(received);
      setCar(publicCar);
      setState({ status: 'ready' });
    } catch (error) {
      console.error('Error cargando perfil público:', error);
      if (error instanceof Error && error.message === 'Usuario no encontrado.') {
        setState({ status: 'not-found' });
      } else {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo cargar el perfil.' });
      }
    }
  }, [navigate, userId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link to="/mis-viajes" className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-700 text-sm mb-6">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a Mis Viajes
          </Link>
          {content}
        </div>
      </div>
      <Footer />
    </div>
  );

  if (state.status === 'loading') {
    return shell(<p className="flex items-center gap-2 text-gray-600"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Cargando perfil...</p>);
  }
  if (state.status === 'not-found') {
    return shell(
      <Card className="p-12 text-center">
        <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Usuario no encontrado</h2>
        <p className="text-sm text-gray-600 mb-4">El perfil que buscas no existe o no está disponible.</p>
        <Button variant="primary" onClick={() => navigate('/mis-viajes')}>Ir a Mis viajes</Button>
      </Card>
    );
  }
  if (state.status === 'error' || !profile) {
    return shell(
      <Card className="p-12 text-center bg-red-50">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Ocurrió un error</h3>
        <p className="text-gray-600 mb-4">{state.status === 'error' ? state.message : 'No se pudo cargar el perfil.'}</p>
        <Button variant="primary" onClick={() => void load()}>Reintentar</Button>
      </Card>
    );
  }

  return shell(
    <Card className="p-6">
      <ProfileHeader name={profile.full_name} university={profile.university} rating={profile.rating} totalRatings={profile.total_ratings} />
      <p className="flex items-center gap-1.5 text-xs text-gray-500 mt-3">
        <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Miembro desde {formatDate(profile.created_at)}
      </p>
      <StatsGrid stats={stats} />
      <PublicCarCard car={car} />
      <RatingsList ratings={ratings} />
    </Card>
  );
};

export default PublicProfilePage;

