-- ============================================================
-- Migración: add_trip_attendance_confirmations.sql
-- Confirmación de asistencia 20 minutos antes de la salida
-- ============================================================
-- Objetivo:
--   Veinte minutos antes de la hora programada de salida, el sistema pide
--   confirmación de asistencia AL CONDUCTOR y a CADA PASAJERO ACEPTADO.
--   Cada persona responde de forma independiente:
--       'pending'   -> todavía no responde
--       'confirmed' -> confirma que asistirá
--       'declined'  -> informa que no asistirá
--
-- Decisiones de diseño (coherentes con las etapas anteriores):
--   * NO se modifica ninguna tabla, vista, RPC, trigger ni política
--     existente. Solo se AMPLÍA el CHECK de public.notifications.type para
--     admitir el tipo nuevo 'attendance_request' (nunca se reduce la lista).
--   * Las notificaciones se crean ÚNICAMENTE desde funciones SECURITY
--     DEFINER: el cliente sigue SIN permiso INSERT en notifications.
--   * Las respuestas se escriben SOLO por el RPC respond_trip_attendance():
--     la tabla no tiene INSERT/UPDATE/DELETE para la API. Cada participante
--     puede LEER únicamente su propia fila (mínimo privilegio).
--   * Idempotencia: UNIQUE (trip_id, user_id) + ON CONFLICT DO NOTHING en las
--     filas, y RETURNING + NOT EXISTS en las notificaciones. Ejecutar el
--     proceso diez veces genera exactamente una fila y una notificación por
--     participante.
--   * NO se cambia el estado del viaje: confirmar asistencia no pone el viaje
--     'in_progress', no lo completa ni lo cancela. Tampoco libera asientos ni
--     cancela solicitudes. Nada de GPS ni geolocalización en esta etapa.
--
-- Cálculo de los 20 minutos:
--   salida = (date + time) AT TIME ZONE 'America/Mexico_City'
--   Es la MISMA expresión que usa la columna generada trips.departure_at de
--   add_trip_lifecycle.sql (etapa 1) y que public.trip_scheduled_start() de
--   add_trip_completion.sql (etapa 2). Se repite AQUÍ, escrita en línea, a
--   propósito: así esta migración NO depende de que esas etapas estén
--   aplicadas ni de que la columna departure_at exista. Lo único que necesita
--   son las columnas date (DATE) y time (TIME) de public.trips, que están
--   desde el esquema original (supabase/schema.sql).
--   ventana = salida - 20 minutos  <=  ahora  <  salida
--   NUNCA se usa route_duration_minutes para calcular el inicio: la duración
--   estimada de la ruta solo la usa el mecanismo de finalización (etapa 2).
--
-- Requisitos REALES de esta migración (verifícalos si algo falla):
--   * public.trips con las columnas date y time (esquema original).
--   * public.trip_requests con la columna status.
--   * public.notifications: OPCIONAL. Si no existe, se omite la ampliación de
--     su CHECK (bloque 4) y no se crean notificaciones, pero el resto funciona.
--   * trips.status debe admitir los estados del ciclo de vida
--     ('pending_completion', etc.). Si add_trip_lifecycle.sql no está aplicada,
--     los viajes siguen siendo 'active' y esta etapa trabaja solo con ese
--     estado, que es exactamente el que necesita.
-- NO requiere la columna trips.departure_at ni la función
-- public.trip_scheduled_start().
--
-- Ejecutar manualmente en el SQL Editor de Supabase. Es idempotente.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Antelación con la que se solicita la confirmación
-- ============================================================
CREATE OR REPLACE FUNCTION public.trip_attendance_lead_interval()
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT INTERVAL '20 minutes';
$$;

COMMENT ON FUNCTION public.trip_attendance_lead_interval() IS
  'Antelación con la que se solicita la confirmación de asistencia: 20 minutos antes de la salida.';

REVOKE ALL ON FUNCTION public.trip_attendance_lead_interval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_attendance_lead_interval() TO anon, authenticated;

-- ============================================================
-- 2. Tabla: trip_attendance_confirmations
-- ============================================================
-- Una fila por (viaje, usuario). El rol NO se almacena: se deriva de
-- trips.driver_id y de las solicitudes aceptadas (no se duplica información
-- que ya existe en las tablas anteriores).
--   * response      : 'pending' | 'confirmed' | 'declined'
--   * requested_at  : cuándo se solicitó la confirmación
--   * responded_at  : cuándo respondió (NULL mientras está pendiente)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trip_attendance_confirmations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  response TEXT NOT NULL DEFAULT 'pending'
    CHECK (response IN ('pending', 'confirmed', 'declined')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una sola confirmación por participante y viaje.
  CONSTRAINT trip_attendance_confirmations_trip_user_key UNIQUE (trip_id, user_id),
  -- Integridad: 'pending' no tiene fecha de respuesta; el resto sí.
  CONSTRAINT trip_attendance_confirmations_responded_at_check CHECK (
    (response = 'pending' AND responded_at IS NULL)
    OR (response <> 'pending' AND responded_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.trip_attendance_confirmations IS
  'Confirmación de asistencia solicitada 20 minutos antes de la salida (conductor + pasajeros aceptados). Escritura solo vía RPC respond_trip_attendance().';
COMMENT ON COLUMN public.trip_attendance_confirmations.response IS
  'pending (sin responder) | confirmed (asistirá) | declined (no asistirá).';
COMMENT ON COLUMN public.trip_attendance_confirmations.requested_at IS
  'Momento en que el proceso programado solicitó la confirmación.';
COMMENT ON COLUMN public.trip_attendance_confirmations.responded_at IS
  'Momento de la respuesta; NULL mientras la respuesta sea pending.';

CREATE INDEX IF NOT EXISTS idx_trip_attendance_confirmations_trip_id
  ON public.trip_attendance_confirmations(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_attendance_confirmations_user_id
  ON public.trip_attendance_confirmations(user_id);
-- Consulta del proceso programado: quién sigue pendiente por viaje.
CREATE INDEX IF NOT EXISTS idx_trip_attendance_confirmations_trip_pending
  ON public.trip_attendance_confirmations(trip_id) WHERE response = 'pending';

-- Índice de apoyo para el barrido del proceso programado (estado + salida).
-- OJO: es un ÍNDICE DE EXPRESIÓN sobre (date + time), NO sobre la columna
-- generada trips.departure_at. Esa columna la crea la migración
-- add_trip_lifecycle.sql (etapa 1) y puede no existir todavía en la base de
-- datos (si falta, crear un índice sobre ella falla con 42703). La expresión
-- es inmutable —la etapa 1 la usa en una columna GENERATED ... STORED, que
-- exige inmutabilidad—, así que el índice es válido y sirve a las consultas
-- de esta migración, que calculan la salida con esta misma expresión.
-- Si la etapa 1 ya está aplicada, este índice convive sin conflicto con
-- idx_trips_departure_at (nombre distinto, misma información).
CREATE INDEX IF NOT EXISTS idx_trips_status_departure_expr
  ON public.trips (status, ((date + time) AT TIME ZONE 'America/Mexico_City'));

-- ============================================================
-- 3. RLS: cada persona ve SOLO su propia confirmación
-- ============================================================
-- Política autocontenida (user_id = auth.uid()): no permite ver las
-- respuestas de otros participantes. Si una etapa futura necesita que el
-- conductor vea el estado de sus pasajeros, se añadirá una política nueva
-- sin tocar esta.
-- ============================================================
ALTER TABLE public.trip_attendance_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own attendance confirmations"
  ON public.trip_attendance_confirmations;
CREATE POLICY "Users can view own attendance confirmations"
  ON public.trip_attendance_confirmations FOR SELECT
  USING (auth.uid() = user_id);

-- Sin políticas de INSERT/UPDATE/DELETE y sin permisos de escritura para la
-- API: la única vía de respuesta es el RPC respond_trip_attendance(), que
-- valida sesión, participación, estado del viaje y ventana horaria.
REVOKE ALL ON TABLE public.trip_attendance_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trip_attendance_confirmations TO authenticated;

-- ============================================================
-- 4. Ampliar los tipos de notificación (nunca reducirlos)
-- ============================================================
-- Se reutiliza public.notifications: NO se crea un segundo sistema de
-- notificaciones. El tipo nuevo es 'attendance_request'.
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
        'trip_completed',
        'attendance_request'
      ));
  END IF;
END;
$$;

-- ============================================================
-- 5. Solicitudes + notificaciones de UN viaje (idempotente)
-- ============================================================
-- Crea una fila 'pending' para el conductor y para cada pasajero aceptado
-- SOLO si aún no existe (ON CONFLICT DO NOTHING + UNIQUE), e inserta una
-- notificación 'attendance_request' únicamente para las filas recién creadas
-- (RETURNING) que todavía no tienen notificación (NOT EXISTS).
--
-- Garantías:
--   * Un viaje cancelado, completado o ya salido NUNCA recibe solicitudes.
--   * Se comprueba el estado ACTUAL del viaje en cada ejecución: si el viaje
--     se modifica o cancela después de programar, aquí se detiene.
--   * Se ejecuta con SECURITY DEFINER (puede insertar en notifications y en
--     la tabla nueva sin permisos de escritura para la API).
--   * Los pasajeros NO aceptados (pending / rejected / cancelled) no reciben
--     nada: solo entra tr.status = 'accepted'.
-- Devuelve cuántas filas nuevas creó (0 = nada que hacer / repetido).
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_trip_attendance_for_trip(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_departure_at TIMESTAMPTZ;
  v_origin TEXT;
  v_destination TEXT;
  v_date DATE;
  v_time TIME;
  v_created INTEGER := 0;
BEGIN
  -- El estado ACTUAL del viaje manda: se vuelve a leer en cada llamada.
  SELECT t.status, t.origin, t.destination, t.date, t.time,
         (t.date + t.time) AT TIME ZONE 'America/Mexico_City'
    INTO v_status, v_origin, v_destination, v_date, v_time, v_departure_at
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Solo viajes publicados y cuya salida aún no ocurrió.
  IF v_status <> 'active' OR v_departure_at <= NOW() THEN
    RETURN 0;
  END IF;

  -- Ventana: desde 20 minutos antes de la salida.
  IF v_departure_at - public.trip_attendance_lead_interval() > NOW() THEN
    RETURN 0;
  END IF;

  -- 1) Filas pendientes. Idempotente: UNIQUE (trip_id, user_id) +
  --    ON CONFLICT DO NOTHING. Las filas que ya existían no se tocan, así que
  --    una respuesta ya dada NUNCA se reinicia a 'pending'.
  WITH participantes AS (
    -- El conductor del viaje.
    SELECT t.driver_id AS user_id
    FROM public.trips t
    WHERE t.id = p_trip_id
    UNION
    -- Pasajeros con solicitud ACEPTADA (nadie más).
    SELECT tr.passenger_id
    FROM public.trip_requests tr
    WHERE tr.trip_id = p_trip_id
      AND tr.status = 'accepted'
  )
  INSERT INTO public.trip_attendance_confirmations AS a
    (trip_id, user_id, response, requested_at)
  SELECT p_trip_id, participantes.user_id, 'pending', NOW()
  FROM participantes
  ON CONFLICT (trip_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  -- 2) Notificaciones. Idempotentes por NOT EXISTS: cada (viaje, usuario)
  --    recibe como máximo una notificación 'attendance_request', aunque el
  --    proceso se ejecute cien veces.
  --    La comprobación to_regclass hace que esta migración funcione también
  --    en una base donde todavía no exista public.notifications.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    WITH participantes AS (
      SELECT t.driver_id AS user_id, NULL::UUID AS request_id
      FROM public.trips t
      WHERE t.id = p_trip_id
      UNION
      SELECT tr.passenger_id, tr.id
      FROM public.trip_requests tr
      WHERE tr.trip_id = p_trip_id
        AND tr.status = 'accepted'
    )
    INSERT INTO public.notifications
      (user_id, type, title, message, related_trip_id, related_request_id)
    SELECT
      participantes.user_id,
      'attendance_request',
      'Confirma tu asistencia',
      'Tu viaje ' || v_origin || ' → ' || v_destination ||
        ' sale el ' || to_char(v_date, 'DD/MM/YYYY') ||
        ' a las ' || to_char(v_time, 'HH24:MI') ||
        '. Confirma si asistirás desde Mis viajes.',
      p_trip_id,
      participantes.request_id
    FROM participantes
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.related_trip_id = p_trip_id
        AND n.user_id = participantes.user_id
        AND n.type = 'attendance_request'
    );
  END IF;

  RETURN v_created;
END;
$$;

COMMENT ON FUNCTION public.request_trip_attendance_for_trip(UUID) IS
  'Crea (idempotente) las confirmaciones pending y las notificaciones attendance_request de un viaje que entra en la ventana de 20 minutos. Uso interno.';

-- Uso interno: NO se concede EXECUTE a la API. La invocan los RPC de abajo.
REVOKE ALL ON FUNCTION public.request_trip_attendance_for_trip(UUID) FROM PUBLIC;

-- ============================================================
-- 6. RPC: despachador GLOBAL (proceso programado del servidor)
-- ============================================================
-- Recorre TODOS los viajes publicados que están dentro de la ventana
-- (salida entre hace 0 minutos y dentro de 20 minutos) y llama a la función
-- interna. Es la entrada del cron: NO depende de que nadie tenga la página
-- abierta y es idempotente (ejecutarla cada 5 minutos no duplica nada).
--
-- Sin EXECUTE para la API: solo la invoca el trabajo programado
-- (pg_cron / Edge Function con service_role). Si se quiere disparar a mano:
--   SELECT public.dispatch_trip_attendance_requests();
-- ============================================================
CREATE OR REPLACE FUNCTION public.dispatch_trip_attendance_requests()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trip_id UUID;
  v_total INTEGER := 0;
BEGIN
  FOR v_trip_id IN
    SELECT t.id
    FROM public.trips t
    WHERE t.status = 'active'
      AND (t.date + t.time) AT TIME ZONE 'America/Mexico_City'
            - public.trip_attendance_lead_interval() <= NOW()
      AND (t.date + t.time) AT TIME ZONE 'America/Mexico_City' > NOW()
  LOOP
    v_total := v_total + public.request_trip_attendance_for_trip(v_trip_id);
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.dispatch_trip_attendance_requests() IS
  'Proceso programado: solicita confirmación de asistencia (20 min antes) a conductor y pasajeros aceptados de todos los viajes en ventana. Idempotente. Sin EXECUTE para la API.';

REVOKE ALL ON FUNCTION public.dispatch_trip_attendance_requests() FROM PUBLIC;
-- Excepción única y explícita: los trabajos de pg_cron se ejecutan con el rol
-- postgres, no con el rol que aplicó la migración. Sin este GRANT el trabajo
-- programado fallaría con "permission denied" aunque la función sea correcta.
GRANT EXECUTE ON FUNCTION public.dispatch_trip_attendance_requests() TO postgres;

-- ============================================================
-- 7. RPC: despachador PEREZOSO del usuario autenticado
-- ============================================================
-- Mismo patrón que reap_my_trip_completions() (etapa 2): si el trabajo
-- programado no está activo, la base de datos se pone al día cuando el
-- usuario abre «Mis viajes». Solo toca los viajes del LLAMADOR (conductor o
-- pasajero aceptado), así que nadie puede generar solicitudes en viajes
-- ajenos. Idempotente: no repite notificaciones.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_my_trip_attendance_requests()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_trip_id UUID;
  v_total INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_trip_id IN
    SELECT t.id
    FROM public.trips t
    WHERE t.status = 'active'
      AND (t.date + t.time) AT TIME ZONE 'America/Mexico_City'
            - public.trip_attendance_lead_interval() <= NOW()
      AND (t.date + t.time) AT TIME ZONE 'America/Mexico_City' > NOW()
      AND (
        t.driver_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.trip_requests tr
          WHERE tr.trip_id = t.id
            AND tr.passenger_id = v_user_id
            AND tr.status = 'accepted'
        )
      )
  LOOP
    v_total := v_total + public.request_trip_attendance_for_trip(v_trip_id);
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.ensure_my_trip_attendance_requests() IS
  'Despachador perezoso: crea las solicitudes de asistencia (20 min antes) de los viajes del usuario autenticado que ya están en ventana. Idempotente.';

REVOKE ALL ON FUNCTION public.ensure_my_trip_attendance_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_trip_attendance_requests() TO authenticated;

-- ============================================================
-- 8. RPC: responder la confirmación de asistencia
-- ============================================================
-- ÚNICA vía de escritura. Valida EN LA BASE DE DATOS (nunca en React):
--   * sesión iniciada (auth.uid(), no un user_id enviado por el cliente),
--   * el viaje existe,
--   * el viaje no está cancelado ni finalizado,
--   * el llamador es PARTICIPANTE (conductor o pasajero aceptado),
--   * la salida aún no ocurrió (una respuesta tardía no tiene sentido).
-- Efectos: fija mi respuesta y responded_at. NO cambia el estado del viaje,
-- NO libera asientos, NO cancela solicitudes ni el viaje.
-- ============================================================
CREATE OR REPLACE FUNCTION public.respond_trip_attendance(
  p_trip_id UUID,
  p_response TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_status TEXT;
  v_departure_at TIMESTAMPTZ;
  v_is_participant BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para confirmar tu asistencia';
  END IF;

  IF p_response IS NULL OR p_response NOT IN ('confirmed', 'declined') THEN
    RAISE EXCEPTION 'Respuesta no válida: usa confirmed o declined';
  END IF;

  SELECT t.status, (t.date + t.time) AT TIME ZONE 'America/Mexico_City'
    INTO v_status, v_departure_at
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'El viaje fue cancelado: ya no requiere confirmación de asistencia';
  END IF;

  IF v_status IN ('completed', 'pending_completion') THEN
    RAISE EXCEPTION 'El viaje ya está finalizado: la confirmación de asistencia quedó cerrada';
  END IF;

  IF v_departure_at IS NULL OR NOW() >= v_departure_at THEN
    RAISE EXCEPTION 'El viaje ya salió: ya no se puede modificar tu confirmación de asistencia';
  END IF;

  -- Participación: conductor del viaje o pasajero con solicitud aceptada.
  SELECT
    t.driver_id = v_user_id
    OR EXISTS (
      SELECT 1
      FROM public.trip_requests tr
      WHERE tr.trip_id = p_trip_id
        AND tr.passenger_id = v_user_id
        AND tr.status = 'accepted'
    )
    INTO v_is_participant
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT COALESCE(v_is_participant, FALSE) THEN
    RAISE EXCEPTION 'Solo pueden confirmar asistencia el conductor y los pasajeros aceptados';
  END IF;

  -- Upsert idempotente sobre (trip_id, user_id): nunca afecta a otras filas.
  INSERT INTO public.trip_attendance_confirmations AS a
    (trip_id, user_id, response, requested_at, responded_at, updated_at)
  VALUES
    (p_trip_id, v_user_id, p_response, NOW(), NOW(), NOW())
  ON CONFLICT (trip_id, user_id) DO UPDATE
    SET response = EXCLUDED.response,
        responded_at = EXCLUDED.responded_at,
        updated_at = NOW();

  RETURN p_response;
END;
$$;

COMMENT ON FUNCTION public.respond_trip_attendance(UUID, TEXT) IS
  'Registra la respuesta de asistencia (confirmed | declined) del usuario autenticado en un viaje. Valida sesión, participación y estado del viaje. No altera el ciclo de vida del viaje.';

REVOKE ALL ON FUNCTION public.respond_trip_attendance(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_trip_attendance(UUID, TEXT) TO authenticated;

-- ============================================================
-- 9. RPC: leer MIS solicitudes de asistencia
-- ============================================================
-- Devuelve SOLO las filas del usuario autenticado, junto con los datos del
-- viaje que necesita la interfaz (ruta, salida, estado) y el ROL, que se
-- calcula al vuelo (driver si soy el conductor, passenger si fui aceptado):
-- no se almacena para no duplicar información.
-- Es SECURITY DEFINER porque trips ya restringe por RLS quién ve qué y así
-- la consulta es única y estable para ambos roles.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_trip_attendance_requests()
RETURNS TABLE (
  trip_id UUID,
  response TEXT,
  requested_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  departure_at TIMESTAMPTZ,
  origin TEXT,
  destination TEXT,
  trip_date DATE,
  trip_time TIME,
  trip_status TEXT,
  my_role TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_row RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT
      a.trip_id AS a_trip_id,
      a.response AS a_response,
      a.requested_at AS a_requested_at,
      a.responded_at AS a_responded_at,
      t.origin AS t_origin,
      t.destination AS t_destination,
      t.date AS t_date,
      t.time AS t_time,
      t.status AS t_status,
      t.driver_id AS t_driver_id
    FROM public.trip_attendance_confirmations a
    JOIN public.trips t ON t.id = a.trip_id
    WHERE a.user_id = v_user_id
  LOOP
    trip_id := v_row.a_trip_id;
    response := v_row.a_response;
    requested_at := v_row.a_requested_at;
    responded_at := v_row.a_responded_at;
    departure_at := (v_row.t_date + v_row.t_time) AT TIME ZONE 'America/Mexico_City';
    origin := v_row.t_origin;
    destination := v_row.t_destination;
    trip_date := v_row.t_date;
    trip_time := v_row.t_time;
    trip_status := v_row.t_status;
    my_role := CASE WHEN v_row.t_driver_id = v_user_id THEN 'driver' ELSE 'passenger' END;

    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.get_my_trip_attendance_requests() IS
  'Mis confirmaciones de asistencia (una fila propia por viaje) con los datos del viaje y mi rol. No expone las respuestas de otros participantes.';

REVOKE ALL ON FUNCTION public.get_my_trip_attendance_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_trip_attendance_requests() TO authenticated;

-- ============================================================
-- 10. Programación del proceso (pg_cron, si está disponible)
-- ============================================================
-- Mecanismo principal del lado del servidor: cada 5 minutos se ejecuta
-- dispatch_trip_attendance_requests(), que es idempotente, así que solaparse
-- con la ventana de 20 minutos no genera duplicados.
--
-- Si la extensión pg_cron NO está habilitada, el bloque NO falla: solo
-- avisa y la funcionalidad sigue operando gracias al despachador perezoso
-- (ensure_my_trip_attendance_requests) que llama la app al abrir Mis viajes.
-- Alternativas equivalentes: un cron externo (GitHub Actions / VPS) o una
-- Edge Function con service_role que invoque el mismo RPC.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'carpool_attendance_requests') THEN
      PERFORM cron.unschedule('carpool_attendance_requests');
    END IF;

    PERFORM cron.schedule(
      'carpool_attendance_requests',
      '*/5 * * * *',
      $cron$SELECT public.dispatch_trip_attendance_requests();$cron$
    );

    RAISE NOTICE 'pg_cron: trabajo "carpool_attendance_requests" programado cada 5 minutos.';
  ELSE
    RAISE NOTICE 'pg_cron no está habilitado: programa manualmente dispatch_trip_attendance_requests() (cron externo o Edge Function). Mientras tanto funciona el despachador perezoso de la app.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- OJO con el formato de RAISE: '%' es un marcador de parámetro y '%%' es
    -- un signo de porcentaje LITERAL. Aquí hay exactamente un marcador (%) y
    -- un argumento (SQLERRM). Escribir '%%' con un argumento provoca
    -- "ERROR: 42601: too many parameters specified for RAISE".
    RAISE NOTICE 'No se pudo programar pg_cron automáticamente (detalle: %). Ejecuta manualmente dispatch_trip_attendance_requests().', SQLERRM;
END;
$$;

COMMIT;

-- ============================================================
-- COMPROBACIONES MANUALES (opcionales, tras aplicar la migración)
-- ============================================================
-- 1) Viajes que deberían estar pidiendo asistencia AHORA:
--      SELECT id, origin, destination, date, time
--      FROM public.trips
--      WHERE status = 'active'
--        AND (date + time) AT TIME ZONE 'America/Mexico_City'
--              - public.trip_attendance_lead_interval() <= NOW()
--        AND (date + time) AT TIME ZONE 'America/Mexico_City' > NOW();
--
-- 2) Ejecutar el proceso a mano (equivale a lo que hace el cron):
--      SELECT public.dispatch_trip_attendance_requests();
--
-- 3) Ver las solicitudes generadas:
--      SELECT trip_id, user_id, response, requested_at, responded_at
--      FROM public.trip_attendance_confirmations ORDER BY requested_at DESC;
--
-- 4) Idempotencia: repetir el paso 2 y comprobar que NO aumenta el conteo:
--      SELECT COUNT(*) FROM public.notifications WHERE type = 'attendance_request';
-- ============================================================
