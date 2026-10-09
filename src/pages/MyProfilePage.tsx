import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Car as CarIcon, Loader2, Mail, Phone } from 'lucide-react';

import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { AppShell, PageHeader } from '../components/layout/AppShell';
import { Alert } from '../components/ui/PageBlocks';
import { ProfileHeader, StatsGrid, RatingsList } from '../components/ProfileCard';
import { formatDate } from '../utils/profileFormat';
import { getCurrentUser } from '../services/authService';
import {
  getMyProfile,
  getUserRatings,
  getUserTripStats,
  updateMyProfile,
} from '../services/profileService';
import type { FullProfile, ReceivedRating, UserTripStats } from '../services/profileService';
import { getMyCars, type Car } from '../services/carService';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

/** /perfil — perfil privado del usuario autenticado (editable). */
const MyProfilePage = () => {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [stats, setStats] = useState<UserTripStats>({ offeredTrips: 0, passengerTrips: 0, completedTrips: 0 });
  const [ratings, setRatings] = useState<ReceivedRating[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    setNotice(null);
    try {
      const user = await getCurrentUser();
      if (!user) {
        navigate('/login');
        return;
      }
      const [mine, tripStats, received, myCars] = await Promise.all([
        getMyProfile(),
        getUserTripStats(user.id),
        getUserRatings(user.id),
        getMyCars(),
      ]);
      setProfile(mine);
      setStats(tripStats);
      setRatings(received);
      setCars(myCars);
      setForm({ fullName: mine.full_name, phone: mine.phone ?? '' });
      setState({ status: 'ready' });
    } catch (error) {
      console.error('Error cargando mi perfil:', error);
      setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo cargar tu perfil.' });
    }
  }, [navigate]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});
    setNotice(null);
    const errors: Record<string, string> = {};
    if (!form.fullName.trim()) errors.fullName = 'El nombre completo es requerido.';
    if (!/^\d{10}$/.test(form.phone.replace(/\s/g, ''))) errors.phone = 'El teléfono debe tener 10 dígitos.';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setIsSaving(true);
    try {
      const updated = await updateMyProfile({ fullName: form.fullName, phone: form.phone });
      setProfile(updated);
      setIsEditing(false);
      setNotice({ type: 'success', text: 'Perfil actualizado correctamente.' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo actualizar.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <AppShell narrow>
        <div className="flex items-center justify-center py-16">
          <p className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Cargando tu perfil...</p>
        </div>
      </AppShell>
    );
  }

  if (state.status === 'error') {
    return (
      <AppShell narrow>
        <Card className="p-8 sm:p-10">
          <Alert type="error">{state.message}</Alert>
          <div className="mt-5">
            <Button variant="primary" onClick={() => void load()}>Reintentar</Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  if (!profile) return null;

  return (
    <AppShell narrow>
      <PageHeader
        eyebrow="Mi cuenta"
        title="Mi perfil"
        description="Tu información, tu auto y tus calificaciones en un solo lugar."
        back={
          <Link to="/mis-viajes" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a Mis Viajes
          </Link>
        }
      />
      {notice && (
        <div className="mb-6">
          <Alert type={notice.type === 'success' ? 'success' : 'error'}>{notice.text}</Alert>
        </div>
      )}
      <Card className="p-6 sm:p-8 app-animate-fade-up">
        <ProfileHeader
          name={profile.full_name}
          university={profile.university}
          rating={profile.rating}
          totalRatings={profile.total_ratings}
          subtitle={`Miembro desde ${formatDate(profile.created_at)}`}
        />
        <div className="mt-4 space-y-1.5 text-sm text-slate-500">
          <p className="flex items-center gap-1.5"><Mail className="w-4 h-4 shrink-0 text-teal-700" aria-hidden="true" /> {profile.email}</p>
          {profile.phone && (
            <p className="flex items-center gap-1.5"><Phone className="w-4 h-4 shrink-0 text-teal-700" aria-hidden="true" /> {profile.phone}</p>
          )}
        </div>
        {!isEditing ? (
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { setIsEditing(true); setForm({ fullName: profile.full_name, phone: profile.phone ?? '' }); }}>
            Editar perfil
          </Button>
        ) : (
          <form onSubmit={(e) => void handleSave(e)} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <FormField label="Nombre completo" name="fullName" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} error={formErrors.fullName} />
            <FormField label="Teléfono (10 dígitos)" name="phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="3312345678" error={formErrors.phone} />
            <p className="text-xs text-slate-500 mb-3">Solo puedes editar tu nombre y teléfono.</p>
            <div className="flex gap-2 flex-wrap">
              <Button type="submit" variant="primary" size="sm" disabled={isSaving}>{isSaving ? 'Guardando...' : 'Guardar cambios'}</Button>
              <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={() => setIsEditing(false)}>Cancelar</Button>
            </div>
          </form>
        )}
        <StatsGrid stats={stats} />
        <div className="mt-8">
          <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 mb-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <CarIcon className="w-4 h-4" aria-hidden="true" />
            </span>
            Mi automóvil
          </h3>
          {cars.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 sm:p-5">
              <p className="text-sm text-slate-500 mb-3">Sin automóvil registrado.</p>
              <Link to="/registrar-auto" className="text-sm font-semibold text-teal-700 hover:text-teal-800">Registrar mi auto</Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {cars.map((car) => (
                <li key={car.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                  <p className="font-bold text-slate-900">{car.brand} {car.model} <span className="text-sm font-medium text-slate-500">({car.year})</span></p>
                  <p className="text-sm text-slate-500 mt-1">{car.color} · Placas {car.plate} · {car.seats} asientos</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <RatingsList ratings={ratings} />
      </Card>
    </AppShell>
  );
};

export default MyProfilePage;


