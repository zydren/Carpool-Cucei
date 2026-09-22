import type { ReceivedRating } from '../services/profileService';

export const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase() || '?';

export const formatRating = (rating: number): string =>
  Number.isFinite(rating) ? (Number.isInteger(rating) ? String(rating) : rating.toFixed(1)) : '';

export const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const roleLabel = (r: ReceivedRating): string =>
  r.trip_driver_id !== null && r.trip_driver_id === r.rated_id ? 'Como conductor' : 'Como pasajero';
