-- ============================================================
-- Migracion: Perfiles de usuario (Etapa 2)
-- ------------------------------------------------------------
-- Expone de forma SEGURA la informacion publica de perfiles:
--   * Vista public.public_profiles: solo columnas publicas
--     (id, full_name, university, rating, total_ratings, created_at).
--     NO expone email/phone (datos privados de profiles).
--   * RPC get_user_trip_stats(p_user_id): conteos de viajes como
--     conductor y como pasajero (accepted). SECURITY DEFINER con
--     search_path seguro para que funcione aunque RLS oculte filas
--     de trip_requests a terceros.
--   * RPC get_user_public_car(p_user_id): auto mas reciente del
--     usuario con SOLO campos publicos (brand/model/year/color/seats).
--     NO expone plate, aseguradora, poliza ni fotos (sensibles).
--   * RPC get_user_received_ratings(p_user_id, p_limit): ultimas
--     calificaciones RECIBIDAS (rated_id = usuario), lectura publica
--     ya permitida por RLS de ratings.
-- No modifica tablas, vistas, RPC, triggers ni politicas existentes.
-- No usa service_role ni claves privadas.
-- Ejecutar manualmente en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Vista de perfiles publicos (sin email/phone)
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
SELECT
  p.id,
  p.full_name,
  p.university,
  p.rating,
  p.total_ratings,
  p.created_at
FROM public.profiles p;

COMMENT ON VIEW public.public_profiles IS
  'Perfil publico: id, nombre, universidad, rating y conteo. Sin email/phone.';

GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. Estadisticas de viajes por usuario
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_trip_stats(p_user_id UUID)
RETURNS TABLE (offered_trips BIGINT, passenger_trips BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.trips t WHERE t.driver_id = p_user_id),
    (SELECT COUNT(*) FROM public.trip_requests tr WHERE tr.passenger_id = p_user_id AND tr.status = 'accepted');
END;
$$;

COMMENT ON FUNCTION public.get_user_trip_stats(UUID) IS
  'Conteos publicos: viajes ofrecidos (trips.driver_id) y viajes como pasajero (trip_requests accepted).';

REVOKE ALL ON FUNCTION public.get_user_trip_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_trip_stats(UUID) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. Auto publico del usuario (solo campos no sensibles)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_public_car(p_user_id UUID)
RETURNS TABLE (brand TEXT, model TEXT, year INTEGER, color TEXT, seats INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT c.brand, c.model, c.year, c.color, c.seats
  FROM public.cars c
  WHERE c.owner_id = p_user_id
  ORDER BY c.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_user_public_car(UUID) IS
  'Auto mas reciente con campos publicos. Excluye plate, aseguradora, poliza y fotos.';

REVOKE ALL ON FUNCTION public.get_user_public_car(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_public_car(UUID) TO anon, authenticated;

-- ------------------------------------------------------------
-- 4. Calificaciones recibidas (lectura publica)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_received_ratings(p_user_id UUID, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  id UUID,
  trip_id UUID,
  rater_id UUID,
  rated_id UUID,
  rating INTEGER,
  comment TEXT,
  created_at TIMESTAMPTZ,
  rater_name TEXT,
  trip_origin TEXT,
  trip_destination TEXT,
  trip_driver_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.trip_id,
    r.rater_id,
    r.rated_id,
    r.rating,
    r.comment,
    r.created_at,
    rp.full_name,
    t.origin,
    t.destination,
    t.driver_id
  FROM public.ratings r
  LEFT JOIN public.profiles rp ON rp.id = r.rater_id
  LEFT JOIN public.trips t ON t.id = r.trip_id
  WHERE r.rated_id = p_user_id
  ORDER BY r.created_at DESC
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.get_user_received_ratings(UUID, INTEGER) IS
  'Ultimas calificaciones recibidas con nombre del evaluador y datos del viaje (para rol conductor/pasajero).';

REVOKE ALL ON FUNCTION public.get_user_received_ratings(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_received_ratings(UUID, INTEGER) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. RLS aditivo en profiles (sin tocar politicas existentes):
--     lectura y edicion de la PROPIA fila con email/phone.
--     Nombres nuevos para no colisionar con politicas previas.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own full profile (etapa2)" ON public.profiles;
CREATE POLICY "Users can view own full profile (etapa2)"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile (etapa2)" ON public.profiles;
CREATE POLICY "Users can update own profile (etapa2)"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

