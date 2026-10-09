import StarRating from './ui/StarRating';
import { Star, GraduationCap, Car as CarIcon } from 'lucide-react';
import type { PublicCar, ReceivedRating, UserTripStats } from '../services/profileService';
import { initialOf, formatRating, formatDate, roleLabel } from '../utils/profileFormat';

export function ProfileHeader({
  name,
  university,
  rating,
  totalRatings,
  subtitle,
}: {
  name: string;
  university: string;
  rating: number;
  totalRatings: number;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-5">
      <div className="w-20 h-20 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-3xl font-extrabold flex-shrink-0" aria-hidden="true">
        {initialOf(name)}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 break-words">{name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-slate-500 mt-1.5">
          <GraduationCap className="w-4 h-4 shrink-0 text-teal-700" aria-hidden="true" />
          {university}
        </p>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {totalRatings > 0 ? (
            <>
              <StarRating value={Math.round(rating)} readOnly size="sm" />
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2.5 py-1 text-sm font-semibold text-teal-800">
                <Star className="w-4 h-4" aria-hidden="true" fill="currentColor" />
                {formatRating(rating)} · {totalRatings} {totalRatings === 1 ? 'calificación' : 'calificaciones'}
              </span>
            </>
          ) : (
            <span className="text-sm text-slate-500">Sin calificaciones todavía</span>
          )}
        </div>
        {subtitle && <p className="text-xs text-slate-400 mt-1.5">{subtitle}</p>}
      </div>
    </div>
  );
}

export function StatsGrid({ stats }: { stats: UserTripStats }) {
  const completed = stats.completedTrips ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5 text-center">
        <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{stats.offeredTrips}</p>
        <p className="text-xs sm:text-sm font-medium text-slate-500 mt-1">Viajes ofrecidos como conductor</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5 text-center">
        <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">{stats.passengerTrips}</p>
        <p className="text-xs sm:text-sm font-medium text-slate-500 mt-1">Viajes realizados como pasajero</p>
      </div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5 text-center col-span-2">
        <p className="text-2xl sm:text-3xl font-extrabold text-emerald-900">{completed}</p>
        <p className="text-xs sm:text-sm font-medium text-emerald-700 mt-1">Viajes completados (sin contar cancelados)</p>
      </div>
    </div>
  );
}

export function PublicCarCard({ car }: { car: PublicCar | null }) {
  return (
    <div className="mt-8">
      <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 mb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
          <CarIcon className="w-4 h-4" aria-hidden="true" />
        </span>
        Automóvil
      </h3>
      {car ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <p className="font-bold text-slate-900">
            {car.brand} {car.model} <span className="text-sm font-medium text-slate-500">({car.year})</span>
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {car.color} · {car.seats} asientos
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">Sin automóvil registrado.</p>
      )}
    </div>
  );
}

export function RatingsList({ ratings }: { ratings: ReceivedRating[] }) {
  return (
    <div className="mt-8">
      <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 mb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
          <Star className="w-4 h-4" aria-hidden="true" />
        </span>
        Calificaciones recibidas
      </h3>
      {ratings.length === 0 ? (
        <p className="text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">Sin calificaciones todavía.</p>
      ) : (
        <ul className="space-y-3">
          {ratings.map((r) => (
            <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <StarRating value={r.rating} readOnly size="sm" />
                <span className="text-xs font-bold text-teal-800 bg-teal-500/15 border border-teal-500/30 rounded-full px-2.5 py-0.5">
                  {roleLabel(r)}
                </span>
              </div>
              {r.comment && <p className="text-sm text-slate-700 mt-2 break-words leading-relaxed">{r.comment}</p>}
              <p className="text-xs text-slate-400 mt-2">
                {r.rater_name ? `Por ${r.rater_name}` : 'Por un usuario'}
                {r.trip_origin && r.trip_destination ? ` · Viaje ${r.trip_origin} → ${r.trip_destination}` : ''}
                {formatDate(r.created_at) ? ` · ${formatDate(r.created_at)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
