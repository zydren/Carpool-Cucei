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
    <div className="flex items-start gap-4">
      <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-700 flex-shrink-0" aria-hidden="true">
        {initialOf(name)}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-2xl font-bold text-gray-900 break-words">{name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-gray-600 mt-1">
          <GraduationCap className="w-4 h-4 shrink-0" aria-hidden="true" />
          {university}
        </p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {totalRatings > 0 ? (
            <>
              <StarRating value={Math.round(rating)} readOnly size="sm" />
              <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                <Star className="w-4 h-4 text-yellow-400" aria-hidden="true" fill="currentColor" />
                {formatRating(rating)} ({totalRatings} {totalRatings === 1 ? 'calificación' : 'calificaciones'})
              </span>
            </>
          ) : (
            <span className="text-sm text-gray-500">Sin calificaciones todavía</span>
          )}
        </div>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

export function StatsGrid({ stats }: { stats: UserTripStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 mt-6">
      <div className="rounded-xl border border-gray-200 p-4 text-center">
        <p className="text-2xl font-bold text-gray-900">{stats.offeredTrips}</p>
        <p className="text-xs text-gray-600 mt-1">Viajes ofrecidos como conductor</p>
      </div>
      <div className="rounded-xl border border-gray-200 p-4 text-center">
        <p className="text-2xl font-bold text-gray-900">{stats.passengerTrips}</p>
        <p className="text-xs text-gray-600 mt-1">Viajes realizados como pasajero</p>
      </div>
    </div>
  );
}

export function PublicCarCard({ car }: { car: PublicCar | null }) {
  return (
    <div className="mt-6">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
        <CarIcon className="w-5 h-5 shrink-0" aria-hidden="true" />
        Automóvil
      </h3>
      {car ? (
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="font-semibold text-gray-900">
            {car.brand} {car.model} <span className="text-sm font-normal text-gray-500">({car.year})</span>
          </p>
          <p className="text-sm text-gray-600 mt-1">
            {car.color} · {car.seats} asientos
          </p>
        </div>
      ) : (
        <p className="text-sm text-gray-500">Sin automóvil registrado.</p>
      )}
    </div>
  );
}

export function RatingsList({ ratings }: { ratings: ReceivedRating[] }) {
  return (
    <div className="mt-6">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
        <Star className="w-5 h-5 shrink-0" aria-hidden="true" />
        Calificaciones recibidas
      </h3>
      {ratings.length === 0 ? (
        <p className="text-sm text-gray-500">Sin calificaciones todavía.</p>
      ) : (
        <ul className="space-y-3">
          {ratings.map((r) => (
            <li key={r.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <StarRating value={r.rating} readOnly size="sm" />
                <span className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-0.5">
                  {roleLabel(r)}
                </span>
              </div>
              {r.comment && <p className="text-sm text-gray-700 mt-2 break-words">{r.comment}</p>}
              <p className="text-xs text-gray-500 mt-2">
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
