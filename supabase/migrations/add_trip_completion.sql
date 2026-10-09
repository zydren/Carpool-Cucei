-- ============================================================
-- Migración: add_trip_completion.sql
-- Ciclo de vida de los viajes (ETAPA 2): confirmación de finalización
-- ============================================================
-- Objetivos:
--   1. Registrar QUIÉN confirmó que el viaje terminó
--      (tabla public.trip_completion_confirmations).
--   2. Validar la confirmación en la BASE DE DATOS (RLS + RPC
--      SECURITY DEFINER): solo participan el conductor y los pasajeros
--      con solicitud 'accepted'. Un usuario externo no puede cerrar viajes.
--   3. Pasar el viaje a 'completed' con una regla que NO pueda quedar
--      bloqueada por alguien que abandonó la aplicación.
--   4. Dejar preparado el estado 'completed' para la ETAPA 3 (historial y
--      el sistema de calificaciones EXISTENTE). Esta migración NO toca el
--      sistema de ratings ni crea uno nuevo.
--
-- Reglas de esta migración:
--   * NO elimina datos ni tablas (sin DELETE / DROP TABLE).
--   * NO modifica migraciones anteriores.
--   * Idempotente: se puede ejecutar más de una vez.
--   * Los viajes antiguos siguen siendo válidos: todo se calcula a partir
--     de columnas que ya existen (date, time, route_duration_minutes).
--   * Ejecutar manualmente en el SQL Editor de Supabase.
--
-- Requisitos (migraciones anteriores ya aplicadas):
--   * add_trip_lifecycle.sql: el CHECK de trips.status debe admitir
--     'pending_completion' y 'completed'.
--   * add_notifications.sql: tabla public.notifications (se reutiliza; aquí
--     solo se amplía su CHECK de type para incluir 'trip_completed').
--   * No hace falta ninguna columna nueva en trips.
--
-- ------------------------------------------------------------
-- REGLA DE FINALIZACIÓN (resumen)
-- ------------------------------------------------------------
-- Participantes con "voto" = conductor + pasajeros con request 'accepted'.
--   salida         = (date + time) interpretado en America/Mexico_City
--   fin_programado = salida + COALESCE(route_duration_minutes, 60) minutos
--                    (60 min es el respaldo para viajes antiguos sin duración)
--   plazo_gracia   = fin_programado + 48 horas
--
-- Estados efectivos del ciclo de vida:
--   scheduled          -> ahora < salida
--   in_progress        -> salida <= ahora < fin_programado       ("En curso")
--   pending_completion -> fin_programado <= ahora < plazo_gracia
--                                                     ("Pendiente de finalizar")
--   completed          -> unanimidad de confirmaciones O plazo de gracia vencido
--   cancelled          -> se respeta siempre (nunca se completa)
--
-- CÓMO SE EVITA QUE UN VIAJE QUEDE BLOQUEADO:
--   * La confirmación es un "acuse de recibo", no un requisito eterno.
--   * Si pasan 48 h desde el fin programado, el viaje se cierra solo
--     (cierre automático de cortesía) en cuanto cualquiera de los
--     participantes abre "Mis viajes" o el detalle del viaje: el cliente
--     llama a reap_my_trip_completions() / get_trip_completion_summary(),
--     que aplican la regla DENTRO de la base de datos. No depende de cron.
--   * Un participante que desinstaló la app, que ya no entra o que nunca
--     confirma NUNCA bloquea el viaje.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Funciones auxiliares de fechas del viaje
-- ============================================================

-- Salida del viaje (date + time, hora local de México) como timestamptz.
-- Mismo criterio que la columna generada trips.departure_at de la etapa 1,
-- pero calculable en cualquier consulta sin depender de que esa columna
-- exista (mantiene esta migración independiente).
CREATE OR REPLACE FUNCTION public.trip_scheduled_start(p_date DATE, p_time TIME)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (p_date + p_time) AT TIME ZONE 'America/Mexico_City';
$$;

COMMENT ON FUNCTION public.trip_scheduled_start(DATE, TIME) IS
  'Salida del viaje (date + time) interpretada en America/Mexico_City. Base del ciclo de vida del viaje.';

-- Fin programado del viaje: salida + duración estimada de la ruta.
-- route_duration_minutes puede ser NULL en viajes antiguos -> 60 minutos.
CREATE OR REPLACE FUNCTION public.trip_scheduled_end(
  p_date DATE,
  p_time TIME,
  p_duration_minutes INTEGER
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT public.trip_scheduled_start(p_date, p_time)
         + make_interval(mins => COALESCE(p_duration_minutes, 60));
$$;

COMMENT ON FUNCTION public.trip_scheduled_end(DATE, TIME, INTEGER) IS
  'Fin programado del viaje: salida + COALESCE(route_duration_minutes, 60). Marca el inicio de "Pendiente de finalizar".';

-- Ventana de cortesía antes del cierre automático (48 horas).
CREATE OR REPLACE FUNCTION public.trip_completion_grace_interval()
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT INTERVAL '48 hours';
$$;

COMMENT ON FUNCTION public.trip_completion_grace_interval() IS
  'Ventana de cortesía (48 h) tras el fin programado antes del cierre automático del viaje.';

-- ============================================================
-- 2. Participación en un viaje
-- ============================================================
-- Devuelve true si el usuario es el conductor o un pasajero ACEPTADO.
-- SECURITY DEFINER: se evalúa con los privilegios del dueño de las tablas
-- (que no aplica RLS a sí mismo) para evitar la RECURSIÓN de políticas
-- entre trips (que consulta trip_requests) y trip_requests (que consulta
-- trips). Se usa en las políticas RLS de la etapa 2 y en los RPC.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_trip_participant(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = p_trip_id
        AND t.driver_id = p_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.trip_requests tr
      WHERE tr.trip_id = p_trip_id
        AND tr.passenger_id = p_user_id
        AND tr.status = 'accepted'
    );
$$;

COMMENT ON FUNCTION public.is_trip_participant(UUID, UUID) IS
  'true si el usuario es el conductor del viaje o un pasajero con solicitud accepted. Usado por RLS y RPC de la etapa 2.';

-- anon también necesita EXECUTE: la política RLS de trips se evalúa en la
-- búsqueda pública de viajes (usuarios sin sesión).
REVOKE ALL ON FUNCTION public.is_trip_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_trip_participant(UUID, UUID) TO anon, authenticated;

-- ============================================================
-- 3. Tabla: trip_completion_confirmations
-- ============================================================
-- Un registro por (viaje, usuario). UNIQUE impide confirmar dos veces y es
-- la última línea de defensa frente a dobles clics o llamadas simultáneas.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trip_completion_confirmations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trip_completion_confirmations_trip_user_key UNIQUE (trip_id, user_id)
);

COMMENT ON TABLE public.trip_completion_confirmations IS
  'Confirmaciones de "el viaje terminó" emitidas por participantes (etapa 2). Solo se escriben vía RPC confirm_trip_completion.';
COMMENT ON COLUMN public.trip_completion_confirmations.user_id IS
  'Conductor o pasajero con solicitud accepted: nunca alguien ajeno al viaje.';

CREATE INDEX IF NOT EXISTS idx_trip_completion_confirmations_trip_id
  ON public.trip_completion_confirmations(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_completion_confirmations_user_id
  ON public.trip_completion_confirmations(user_id);

ALTER TABLE public.trip_completion_confirmations ENABLE ROW LEVEL SECURITY;

-- RLS: los participantes ven las confirmaciones de SUS viajes.
DROP POLICY IF EXISTS "Participants can view trip completion confirmations"
  ON public.trip_completion_confirmations;
CREATE POLICY "Participants can view trip completion confirmations"
  ON public.trip_completion_confirmations FOR SELECT
  USING (public.is_trip_participant(trip_id, auth.uid()));

-- Permisos de API: SOLO lectura. No hay política ni permiso de INSERT /
-- UPDATE / DELETE: la única vía de escritura es el RPC SECURITY DEFINER
-- confirm_trip_completion(), que valida participación, fecha y duplicados.
REVOKE ALL ON TABLE public.trip_completion_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trip_completion_confirmations TO authenticated;

-- ============================================================
-- 4. RLS de trips: los participantes ven sus viajes en CUALQUIER estado
-- ============================================================
-- Sin esta política, en cuanto el viaje deja de ser 'active' (por ejemplo
-- al pasar a 'pending_completion' o 'completed') el conductor dejaría de
-- verlo en Mis Viajes y el pasajero perdería su solicitud en la vista
-- trip_requests_details. Las políticas son permisivas (se suman con OR),
-- así que la búsqueda pública de viajes 'active' no cambia.
-- ============================================================
DROP POLICY IF EXISTS "Trip participants can view their trips" ON public.trips;
CREATE POLICY "Trip participants can view their trips"
  ON public.trips FOR SELECT
  USING (public.is_trip_participant(id, auth.uid()));

-- ============================================================
-- 5. Notificación de viaje finalizado (reutiliza la infraestructura
--    existente de public.notifications: no se crea un sistema nuevo)
-- ============================================================
-- Idempotente: si ya existe una notificación 'trip_completed' para el
-- viaje, no inserta nada. Se invoca únicamente justo después de una
-- transición real a 'completed' (dentro de funciones SECURITY DEFINER).
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_trip_completed(p_trip_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_origin TEXT;
  v_destination TEXT;
BEGIN
  SELECT t.origin, t.destination
  INTO v_origin, v_destination
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.related_trip_id = p_trip_id
      AND n.type = 'trip_completed'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_trip_id)
  SELECT
    participantes.user_id,
    'trip_completed',
    'Viaje finalizado',
    'El viaje ' || v_origin || ' → ' || v_destination ||
      ' se marcó como finalizado. Ya puedes calificar a tus compañeros.',
    p_trip_id
  FROM (
    SELECT t.driver_id AS user_id
    FROM public.trips t
    WHERE t.id = p_trip_id
    UNION
    SELECT tr.passenger_id
    FROM public.trip_requests tr
    WHERE tr.trip_id = p_trip_id
      AND tr.status = 'accepted'
  ) AS participantes;
END;
$$;

COMMENT ON FUNCTION public.notify_trip_completed(UUID) IS
  'Notifica a conductor y pasajeros aceptados que el viaje pasó a completed (idempotente por viaje).';

-- ============================================================
-- 6. Cierre automático de cortesía para UN viaje
-- ============================================================
-- Si ya pasaron 48 h desde el fin programado, cierra el viaje en la BD y
-- notifica. Función interna: la llaman los RPC de abajo. No se concede
-- EXECUTE a la API (no es invocable desde /rest/v1/rpc).
-- ============================================================
CREATE OR REPLACE FUNCTION public.reap_trip_completion_if_due(p_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_closed BOOLEAN := FALSE;
BEGIN
  UPDATE public.trips t
  SET status = 'completed',
      updated_at = NOW()
  WHERE t.id = p_trip_id
    AND t.status IN ('active', 'in_progress', 'pending_completion')
    AND public.trip_scheduled_end(t.date, t.time, t.route_duration_minutes)
        + public.trip_completion_grace_interval() <= NOW();

  IF FOUND THEN
    v_closed := TRUE;
    PERFORM public.notify_trip_completed(p_trip_id);
  END IF;

  RETURN v_closed;
END;
$$;

COMMENT ON FUNCTION public.reap_trip_completion_if_due(UUID) IS
  'Cierra (completed) un viaje cuyo plazo de gracia de 48 h ya venció. Idempotente. Uso interno.';

REVOKE ALL ON FUNCTION public.reap_trip_completion_if_due(UUID) FROM PUBLIC;

-- ============================================================
-- 7. RPC: cierre perezoso de los viajes del usuario
-- ============================================================
-- Se llama al abrir "Mis viajes". Cierra los viajes del LLAMADOR cuyo plazo
-- de gracia ya venció (solo los suyos: compartir viaje con otro usuario no
-- permite cerrar viajes ajenos).
-- Devuelve cuántos viajes se cerraron (0 si la migración no está aplicada,
-- el RPC no existe y el cliente lo ignora).
-- ============================================================
CREATE OR REPLACE FUNCTION public.reap_my_trip_completions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_trip RECORD;
  v_closed INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_trip IN
    SELECT t.id
    FROM public.trips t
    WHERE t.status IN ('active', 'in_progress', 'pending_completion')
      AND public.trip_scheduled_end(t.date, t.time, t.route_duration_minutes)
          + public.trip_completion_grace_interval() <= NOW()
      AND public.is_trip_participant(t.id, v_user_id)
  LOOP
    IF public.reap_trip_completion_if_due(v_trip.id) THEN
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  RETURN v_closed;
END;
$$;

COMMENT ON FUNCTION public.reap_my_trip_completions() IS
  'Cierre automático de cortesía: finaliza los viajes del usuario cuyo plazo de gracia (48 h) ya venció.';

REVOKE ALL ON FUNCTION public.reap_my_trip_completions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reap_my_trip_completions() TO authenticated;

-- ============================================================
-- 8. RPC: confirmar que el viaje terminó
-- ============================================================
-- Valida EN LA BASE DE DATOS (no en React):
--   * sesión iniciada,
--   * el viaje existe,
--   * el viaje no está cancelado ni finalizado,
--   * el usuario es PARTICIPANTE (conductor o pasajero aceptado),
--   * ya pasó el fin programado (no se puede confirmar un viaje en curso),
--   * no haya confirmado antes (UNIQUE + ON CONFLICT como respaldo).
-- Efectos:
--   * registra la confirmación,
--   * pone el viaje en 'pending_completion',
--   * si confirmaron TODOS los participantes con voto, pasa a 'completed'
--     y notifica (una sola vez) a conductor y pasajeros.
-- Devuelve el estado efectivo resultante: 'pending_completion' | 'completed'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_trip_completion(p_trip_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_status TEXT;
  v_date DATE;
  v_time TIME;
  v_duration INTEGER;
  v_scheduled_end TIMESTAMPTZ;
  v_expected INTEGER;
  v_confirmed INTEGER;
  v_effective TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para confirmar la finalización del viaje';
  END IF;

  SELECT t.status, t.date, t.time, t.route_duration_minutes
  INTO v_status, v_date, v_time, v_duration
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'El viaje fue cancelado';
  END IF;

  IF NOT public.is_trip_participant(p_trip_id, v_user_id) THEN
    RAISE EXCEPTION 'No participaste en este viaje';
  END IF;

  -- Cierre automático de cortesía si ya venció (idempotente).
  PERFORM public.reap_trip_completion_if_due(p_trip_id);

  SELECT t.status INTO v_status FROM public.trips t WHERE t.id = p_trip_id;

  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'El viaje ya está finalizado';
  END IF;

  v_scheduled_end := public.trip_scheduled_end(v_date, v_time, v_duration);

  IF NOW() < v_scheduled_end THEN
    RAISE EXCEPTION 'El viaje aún no ha terminado';
  END IF;

  INSERT INTO public.trip_completion_confirmations (trip_id, user_id)
  VALUES (p_trip_id, v_user_id)
  ON CONFLICT (trip_id, user_id) DO NOTHING;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ya confirmaste que este viaje terminó';
  END IF;

  -- Con la primera confirmación el viaje deja de ser "activo".
  UPDATE public.trips t
  SET status = 'pending_completion',
      updated_at = NOW()
  WHERE t.id = p_trip_id
    AND t.status IN ('active', 'in_progress');

  -- ¿Confirmaron todos los participantes con voto? (+1 por el conductor)
  SELECT (1 + COUNT(*))::INTEGER
  INTO v_expected
  FROM public.trip_requests tr
  WHERE tr.trip_id = p_trip_id
    AND tr.status = 'accepted';

  SELECT COUNT(*)::INTEGER
  INTO v_confirmed
  FROM public.trip_completion_confirmations c
  WHERE c.trip_id = p_trip_id;

  IF v_confirmed >= v_expected THEN
    UPDATE public.trips t
    SET status = 'completed',
        updated_at = NOW()
    WHERE t.id = p_trip_id
      AND t.status <> 'completed';

    IF FOUND THEN
      PERFORM public.notify_trip_completed(p_trip_id);
      v_effective := 'completed';
    END IF;
  END IF;

  IF v_effective IS NULL THEN
    SELECT t.status INTO v_status FROM public.trips t WHERE t.id = p_trip_id;
    v_effective := v_status;
  END IF;

  RETURN v_effective;
END;
$$;

COMMENT ON FUNCTION public.confirm_trip_completion(UUID) IS
  'Registra la confirmación de finalización de un participante y cierra el viaje si confirmaron todos. Devuelve el estado efectivo.';

REVOKE ALL ON FUNCTION public.confirm_trip_completion(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_trip_completion(UUID) TO authenticated;

-- ============================================================
-- 9. RPC: resumen de finalización del viaje (lectura)
-- ============================================================
-- Devuelve, para un PARTICIPANTE del viaje:
--   raw_status           estado guardado en trips
--   effective_status     estado efectivo del ciclo de vida (incluye el
--                        cierre de cortesía aunque la BD aún no lo aplique)
--   scheduled_end        fin programado
--   completion_deadline  fin programado + 48 h (cierre automático)
--   confirmations_count  confirmaciones registradas
--   expected_count       participantes con voto (conductor + aceptados)
--   confirmed_by_me      si el llamador ya confirmó
--   confirmed_at_by_me   cuándo confirmó (null si no)
--   can_confirm          si puede confirmar AHORA
--   my_role              'driver' | 'passenger'
-- Aplica antes el cierre de cortesía, así el estado que ve el usuario y el
-- estado en la BD no se separan nunca.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_trip_completion_summary(p_trip_id UUID)
RETURNS TABLE (
  raw_status TEXT,
  effective_status TEXT,
  scheduled_end TIMESTAMPTZ,
  completion_deadline TIMESTAMPTZ,
  confirmations_count INTEGER,
  expected_count INTEGER,
  confirmed_by_me BOOLEAN,
  confirmed_at_by_me TIMESTAMPTZ,
  can_confirm BOOLEAN,
  my_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_driver_id UUID;
  v_status TEXT;
  v_date DATE;
  v_time TIME;
  v_duration INTEGER;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_expected INTEGER;
  v_confirmed INTEGER;
  v_my_confirmed_at TIMESTAMPTZ;
  v_effective TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para ver el estado del viaje';
  END IF;

  SELECT t.driver_id, t.status, t.date, t.time, t.route_duration_minutes
  INTO v_driver_id, v_status, v_date, v_time, v_duration
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF NOT public.is_trip_participant(p_trip_id, v_user_id) THEN
    RAISE EXCEPTION 'No participaste en este viaje';
  END IF;

  PERFORM public.reap_trip_completion_if_due(p_trip_id);

  SELECT t.status INTO v_status FROM public.trips t WHERE t.id = p_trip_id;

  v_start := public.trip_scheduled_start(v_date, v_time);
  v_end := public.trip_scheduled_end(v_date, v_time, v_duration);
  v_deadline := v_end + public.trip_completion_grace_interval();

  SELECT (1 + COUNT(*))::INTEGER
  INTO v_expected
  FROM public.trip_requests tr
  WHERE tr.trip_id = p_trip_id
    AND tr.status = 'accepted';

  SELECT COUNT(*)::INTEGER
  INTO v_confirmed
  FROM public.trip_completion_confirmations c
  WHERE c.trip_id = p_trip_id;

  SELECT c.confirmed_at
  INTO v_my_confirmed_at
  FROM public.trip_completion_confirmations c
  WHERE c.trip_id = p_trip_id
    AND c.user_id = v_user_id;

  IF v_status = 'cancelled' THEN
    v_effective := 'cancelled';
  ELSIF v_status = 'completed' THEN
    v_effective := 'completed';
  ELSIF NOW() < v_start THEN
    v_effective := 'scheduled';
  ELSIF NOW() < v_end THEN
    v_effective := 'in_progress';
  ELSIF NOW() >= v_deadline THEN
    -- Plazo de gracia vencido: la regla lo considera finalizado.
    v_effective := 'completed';
  ELSE
    v_effective := 'pending_completion';
  END IF;

  RETURN QUERY
    SELECT
      v_status,
      v_effective,
      v_end,
      v_deadline,
      v_confirmed,
      v_expected,
      (v_my_confirmed_at IS NOT NULL),
      v_my_confirmed_at,
      (v_effective = 'pending_completion' AND v_my_confirmed_at IS NULL),
      CASE WHEN v_driver_id = v_user_id THEN 'driver' ELSE 'passenger' END;
END;
$$;

COMMENT ON FUNCTION public.get_trip_completion_summary(UUID) IS
  'Estado efectivo del ciclo de vida y confirmaciones del viaje, solo para participantes. Aplica el cierre automático de 48 h.';

REVOKE ALL ON FUNCTION public.get_trip_completion_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trip_completion_summary(UUID) TO authenticated;

-- ============================================================
-- 10. Ampliar los tipos de notificación (nunca reducirlos)
-- ============================================================
-- El CHECK original solo permitía los cuatro tipos de solicitud. Se
-- reemplaza por uno que además admite 'trip_completed'. Se recrea con el
-- mismo nombre para no dejar constraints duplicados.
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN (
        'request_created',
        'request_accepted',
        'request_rejected',
        'request_cancelled',
        'trip_completed'
      ));
  END IF;
END;
$$;

-- ============================================================
-- 11. Comprobación final (opcional): estado del ciclo de vida por viaje
-- ============================================================
-- Consulta de verificación manual, una vez aplicada la migración:
--
--   SELECT t.id, t.status,
--          public.trip_scheduled_end(t.date, t.time, t.route_duration_minutes) AS fin_programado,
--          (SELECT COUNT(*) FROM public.trip_completion_confirmations c
--            WHERE c.trip_id = t.id) AS confirmaciones
--   FROM public.trips t
--   ORDER BY t.date DESC
--   LIMIT 20;
-- ============================================================

COMMIT;
