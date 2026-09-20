-- ============================================================
-- Migración: Sistema real de calificaciones
-- ============================================================
-- Qué hace:
--  1. Crea el RPC submit_rating (SECURITY DEFINER): única vía para
--     insertar calificaciones. Valida en el backend:
--       * rating entre 1 y 5
--       * comentario opcional con límite de 1000 caracteres
--       * el viaje existe y no está cancelado
--       * el viaje ya terminó (status 'completed' O fecha/hora pasadas)
--       * el calificador participó en el viaje (conductor o pasajero aceptado)
--       * el calificado es la contraparte correcta del viaje
--       * no se puede autocalificar (rater != rated)
--       * sin duplicados por (trip, rater, rated)
--  2. Revoca el INSERT/UPDATE/DELETE directo sobre ratings:
--     un cliente no puede insertar calificaciones falsas aunque su
--     rater_id sea su propio uid (la política RLS actual lo permitiría).
--  3. Actualiza la vista trip_requests_details para incluir
--     driver_name y driver_rating (el pasajero ve y califica al conductor).
--
-- NOTA: los triggers existentes (update_rating_after_rating_insert)
-- siguen actualizando el promedio en profiles automáticamente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RPC submit_rating
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_rating(
  p_trip_id UUID,
  p_rated_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trip_status TEXT;
  v_trip_date DATE;
  v_trip_time TIME;
  v_driver_id UUID;
  v_is_driver BOOLEAN;
  v_participates BOOLEAN;
  v_trip_over BOOLEAN;
BEGIN
  -- 1. Rango válido de calificación
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'La calificación debe estar entre 1 y 5';
  END IF;

  -- 2. Comentario opcional con límite de longitud
  IF p_comment IS NOT NULL AND char_length(p_comment) > 1000 THEN
    RAISE EXCEPTION 'El comentario es demasiado largo (máximo 1000 caracteres)';
  END IF;

  -- 3. El viaje debe existir
  SELECT status, date, time, driver_id
  INTO v_trip_status, v_trip_date, v_trip_time, v_driver_id
  FROM public.trips
  WHERE id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  -- 4. Prohibir auto-calificación
  IF auth.uid() = p_rated_id THEN
    RAISE EXCEPTION 'No puedes calificarte a ti mismo';
  END IF;

  -- 5. El viaje debe haber terminado (o estar marcado completed)
  IF v_trip_status = 'cancelled' THEN
    RAISE EXCEPTION 'El viaje fue cancelado y no se puede calificar';
  END IF;

  v_trip_over := (v_trip_status = 'completed')
    OR (v_trip_date < CURRENT_DATE)
    OR (v_trip_date = CURRENT_DATE AND v_trip_time < CURRENT_TIME);

  IF NOT v_trip_over THEN
    RAISE EXCEPTION 'El viaje aún no ha terminado';
  END IF;

  -- 6. El calificador debe participar en el viaje
  v_is_driver := (v_driver_id = auth.uid());

  SELECT EXISTS (
    SELECT 1 FROM public.trip_requests
    WHERE trip_id = p_trip_id
      AND passenger_id = auth.uid()
      AND status = 'accepted'
  ) INTO v_participates;

  IF NOT v_is_driver AND NOT v_participates THEN
    RAISE EXCEPTION 'No participaste en este viaje';
  END IF;

  -- 7. El calificado debe ser la contraparte correcta
  IF v_is_driver THEN
    -- El conductor solo puede calificar a pasajeros aceptados
    IF NOT EXISTS (
      SELECT 1 FROM public.trip_requests
      WHERE trip_id = p_trip_id
        AND passenger_id = p_rated_id
        AND status = 'accepted'
    ) THEN
      RAISE EXCEPTION 'Solo puedes calificar a pasajeros aceptados en este viaje';
    END IF;
  ELSIF p_rated_id <> v_driver_id THEN
    -- El pasajero solo puede calificar al conductor del viaje
    RAISE EXCEPTION 'Solo puedes calificar al conductor de este viaje';
  END IF;

  -- 8. Sin duplicados (la constraint UNIQUE(trip_id, rater_id, rated_id)
  --    es el respaldo final a nivel de base de datos)
  IF EXISTS (
    SELECT 1 FROM public.ratings
    WHERE trip_id = p_trip_id
      AND rater_id = auth.uid()
      AND rated_id = p_rated_id
  ) THEN
    RAISE EXCEPTION 'Ya calificaste a esta persona en este viaje';
  END IF;

  -- 9. Insertar la calificación (el trigger existente
  --    update_rating_after_rating_insert actualiza el promedio en profiles)
  INSERT INTO public.ratings (trip_id, rater_id, rated_id, rating, comment)
  VALUES (p_trip_id, auth.uid(), p_rated_id, p_rating, p_comment);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_rating(UUID, UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_rating(UUID, UUID, INTEGER, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 2. Revocar escritura directa en ratings.
--    A partir de aquí la ÚNICA forma de crear calificaciones
--    es el RPC submit_rating (que sí valida la participación).
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ratings FROM authenticated, anon;

-- La antigua política de INSERT quedaría obsoleta y engañosa.
DROP POLICY IF EXISTS "Authenticated users can create ratings" ON public.ratings;

-- ------------------------------------------------------------
-- 3. Vista trip_requests_details con datos del conductor.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.trip_requests_details
WITH (security_barrier = true) AS
SELECT
  tr.*,
  t.driver_id,
  t.origin,
  t.destination,
  t.date,
  t.time,
  t.price,
  t.seats_available AS trip_seats_available,
  p.full_name AS passenger_name,
  p.email AS passenger_email,
  p.rating AS passenger_rating,
  p.university AS passenger_university,
  pd.full_name AS driver_name,
  pd.rating AS driver_rating
FROM public.trip_requests tr
JOIN public.trips t ON tr.trip_id = t.id
JOIN public.profiles p ON tr.passenger_id = p.id
JOIN public.profiles pd ON t.driver_id = pd.id;