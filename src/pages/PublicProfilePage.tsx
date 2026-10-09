import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, MapPin, Users } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { AppShell, PageHeader } from '../components/layout/AppShell';
import { EmptyState, Alert } from '../components/ui/PageBlocks';
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
  const [stats, setStats] = useState<UserTripStats>({ offeredTrips: 0, passengerTrips: 0, completedTrips: 0 });
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
    <AppShell narrow>
      <PageHeader
        eyebrow="Perfil público"
        title="Perfil del viajero"
        description="Información pública, experiencia y calificaciones reales."
        back={
          <Link to="/mis-viajes" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a Mis Viajes
          </Link>
        }
      />
      {content}
    </AppShell>
  );

  if (state.status === 'loading') {
    return shell(<p className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Cargando perfil...</p>);
  }
  if (state.status === 'not-found') {
    return shell(
      <EmptyState
        icon={Users}
        title="Usuario no encontrado"
        description="El perfil que buscas no existe o no está disponible."
        actionLabel="Ir a Mis viajes"
        actionTo="/mis-viajes"
      />
    );
  }
  if (state.status === 'error' || !profile) {
    return shell(
      <Card className="p-8 sm:p-10">
        <Alert type="error">{state.status === 'error' ? state.message : 'No se pudo cargar el perfil.'}</Alert>
        <div className="mt-5">
          <Button variant="primary" onClick={() => void load()}>Reintentar</Button>
        </div>
      </Card>
    );
  }

  return shell(
    <Card className="p-6 sm:p-8 app-animate-fade-up">
      <ProfileHeader name={profile.full_name} university={profile.university} rating={profile.rating} totalRatings={profile.total_ratings} />
      <p className="flex items-center gap-1.5 text-xs text-slate-400 mt-4">
        <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Miembro desde {formatDate(profile.created_at)}
      </p>
      <StatsGrid stats={stats} />
      <PublicCarCard car={car} />
      <RatingsList ratings={ratings} />
    </Card>
  );
};

export default PublicProfilePage;

