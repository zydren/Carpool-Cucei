import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Car as CarIcon, Loader2, Mail, Phone, User } from 'lucide-react';

import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
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
  const [stats, setStats] = useState<UserTripStats>({ offeredTrips: 0, passengerTrips: 0 });
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
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="pt-24 pb-16 flex items-center justify-center">
          <p className="flex items-center gap-2 text-gray-600"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Cargando tu perfil...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="pt-24 pb-16 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="p-12 text-center bg-red-50">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Ocurrió un error</h3>
            <p className="text-gray-600 mb-4">{state.message}</p>
            <Button variant="primary" onClick={() => void load()}>Reintentar</Button>
          </Card>
        </div>
        <Footer />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link to="/mis-viajes" className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-700 text-sm mb-6">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a Mis Viajes
          </Link>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-gray-900 mb-6">
            <User className="w-7 h-7 shrink-0" aria-hidden="true" /> Mi perfil
          </h1>
          {notice && (
            <div className={`mb-6 p-4 rounded-lg border ${notice.type === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className={`text-sm ${notice.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>{notice.text}</p>
            </div>
          )}
          <Card className="p-6">
            <ProfileHeader
              name={profile.full_name}
              university={profile.university}
              rating={profile.rating}
              totalRatings={profile.total_ratings}
              subtitle={`Miembro desde ${formatDate(profile.created_at)}`}
            />
            <div className="mt-4 space-y-1.5 text-sm text-gray-600">
              <p className="flex items-center gap-1.5"><Mail className="w-4 h-4 shrink-0" aria-hidden="true" /> {profile.email}</p>
              {profile.phone && (
                <p className="flex items-center gap-1.5"><Phone className="w-4 h-4 shrink-0" aria-hidden="true" /> {profile.phone}</p>
              )}
            </div>
            {!isEditing ? (
              <Button variant="outline" size="sm" className="mt-4" onClick={() => { setIsEditing(true); setForm({ fullName: profile.full_name, phone: profile.phone ?? '' }); }}>
                Editar perfil
              </Button>
            ) : (
              <form onSubmit={(e) => void handleSave(e)} className="mt-4 rounded-xl border border-gray-200 p-4">
                <FormField label="Nombre completo" name="fullName" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} error={formErrors.fullName} />
                <FormField label="Teléfono (10 dígitos)" name="phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="3312345678" error={formErrors.phone} />
                <p className="text-xs text-gray-500 mb-3">Solo puedes editar tu nombre y teléfono.</p>
                <div className="flex gap-2 flex-wrap">
                  <Button type="submit" variant="primary" size="sm" disabled={isSaving}>{isSaving ? 'Guardando...' : 'Guardar cambios'}</Button>
                  <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={() => setIsEditing(false)}>Cancelar</Button>
                </div>
              </form>
            )}
            <StatsGrid stats={stats} />
            <div className="mt-6">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                <CarIcon className="w-5 h-5 shrink-0" aria-hidden="true" /> Mi automóvil
              </h3>
              {cars.length === 0 ? (
                <div className="rounded-xl border border-gray-200 p-4">
                  <p className="text-sm text-gray-500 mb-3">Sin automóvil registrado.</p>
                  <Link to="/registrar-auto" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">Registrar mi auto</Link>
                </div>
              ) : (
                <ul className="space-y-3">
                  {cars.map((car) => (
                    <li key={car.id} className="rounded-xl border border-gray-200 p-4">
                      <p className="font-semibold text-gray-900">{car.brand} {car.model} <span className="text-sm font-normal text-gray-500">({car.year})</span></p>
                      <p className="text-sm text-gray-600 mt-1">{car.color} · Placas {car.plate} · {car.seats} asientos</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <RatingsList ratings={ratings} />
          </Card>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default MyProfilePage;


