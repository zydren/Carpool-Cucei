/**
 * Nombre corto para la Navbar: los dos primeros nombres.
 * - "Diego Aram Ornelas Cariño" -> "Diego Aram"
 * - "Juan" -> "Juan"
 * - "" o solo espacios -> fallback (email o "Usuario")
 * No modifica Supabase; solo presentación.
 */
export const getShortDisplayName = (
  fullName: string | null | undefined,
  fallback?: string | null
): string => {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 0) return parts.slice(0, 2).join(' ');
  const emailName = (fallback ?? '').trim();
  if (emailName) return emailName;
  return 'Usuario';
};
