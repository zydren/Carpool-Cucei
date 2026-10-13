-- ============================================================
-- Migración: add_trip_live_locations.sql
-- Seguimiento GPS en tiempo real durante los viajes
-- ============================================================
-- Objetivo:
--   Guardar y propagar por Realtime la ÚLTIMA ubicación conocida de cada
--   participante de un viaje (conductor y pasajeros aceptados) que haya
--   ACEPTADO EXPLÍCITAMENTE compartir su ubicación.
--
-- Decisiones de diseño (coherentes con las etapas anteriores):
--   * NO modifica ninguna tabla, vista, RPC, trigger ni política existente.
--   * Se guarda SOLO la última posición por (viaje, usuario): UNIQUE sobre esa
--     pareja + UPSERT. No se almacena historial GPS (privacidad y tamaño).
--   * La escritura se hace por RPC SECURITY DEFINER que valida EN LA BASE DE
--     DATOS: sesión, participación, que el viaje esté 'in_progress' y que el
--     usuario haya dado su consentimiento. El frontend NO puede insertar filas
--     directamente (ni siquiera las propias) para impedir publicar la ubicación
--     de otro o en un viaje ajeno.
--   * RLS de lectura: solo los participantes del viaje ven esas ubicaciones.
--   * Realtime: la tabla se añade a la publicación supabase_realtime, así los
--     participantes reciben los cambios sin recargar. RLS sigue aplicándose en
--     Realtime (las políticas filtran lo que recibe cada cliente).
--   * Al terminar o cancelar el viaje, las filas se borran y el RPC rechaza
--     nuevas publicaciones: la ubicación deja de estar disponible.
--   * La confirmación de asistencia NO activa el GPS: son etapas independientes.
--     Compartir ubicación exige una acción propia y explícita del usuario.
--
-- Requisitos:
--   * add_trip_completion.sql (usa public.is_trip_participant, que es
--     SECURITY DEFINER; si no existiera, más abajo se recrea de forma segura).
--   * add_trip_lifecycle.sql (estados 'in_progress' / 'completed' /
--     'cancelled'). Si no está aplicada, esta migración AMPLÍA el CHECK para
--     admitirlos sin romper los valores actuales.
--
-- Ejecutar manualmente en el SQL Editor de Supabase. Idempotente.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. Compatibilidad: estado 'in_progress' en trips.status
-- ============================================================
-- Si add_trip_lifecycle.sql no está aplicada, el CHECK original solo admite
-- 'active' | 'completed' | 'cancelled'. Se AMPLÍA (nunca se reduce) para que el
-- ciclo de vida pueda marcar un viaje en curso. Es retrocompatible: los valores
-- actuales siguen siendo válidos y no se modifica ninguna fila.
-- ============================================================
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_status_check;
ALTER TABLE public.trips ADD CONSTRAINT trips_status_check
  CHECK (status IN ('active', 'in_progress', 'pending_completion', 'completed', 'cancelled'));

-- ============================================================
-- 1. Helper de participación (idempotente)
-- ============================================================
-- is_trip_participant() la crea add_trip_completion.sql. Usamos
-- CREATE OR REPLACE (NO un CREATE condicional) para que la migración sea
-- segura si la función YA EXISTE: reemplazarla por una definición IDÉNTICA no
-- cambia su comportamiento ni sus permisos. Antes se usaba un DO con
-- CREATE FUNCTION que fallaba con 42723 si to_regproc no la detectaba.
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
  'true si el usuario es el conductor del viaje o un pasajero con solicitud accepted. Usado por RLS y RPC.';

-- anon también necesita EXECUTE: las políticas RLS se evalúan en búsquedas públicas.
REVOKE ALL ON FUNCTION public.is_trip_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_trip_participant(UUID, UUID) TO anon, authenticated;

-- ============================================================
-- 2. Tabla: trip_live_locations (una fila por viaje y participante)
-- ============================================================
-- Guarda la ÚLTIMA ubicación compartida, no un historial:
--   UNIQUE (trip_id, user_id) + UPSERT.
-- Columnas:
--   * lat / lng        : coordenadas publicadas por el usuario.
--   * accuracy         : precisión GPS en metros (nullable).
--   * shared_at        : cuándo se recibió esa lectura (NOW() del servidor).
--   * is_sharing       : consentimiento activo. false = dejó de compartir
--                        (conserva la última posición conocida para poder
--                        mostrar "dejó de compartir", pero la interfaz no la
--                        presenta como posición actual).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trip_live_locations (
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_sharing BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, user_id)
);

COMMENT ON TABLE public.trip_live_locations IS
  'Última ubicación GPS compartida por participante y viaje (sin historial). Escritura solo por RPC upsert_my_trip_location().';
COMMENT ON COLUMN public.trip_live_locations.is_sharing IS
  'Consentimiento activo de ese participante. En false se conserva la última lectura pero ya no se considera posición actual.';
COMMENT ON COLUMN public.trip_live_locations.shared_at IS
  'Instante (servidor) en que se recibió la última lectura de GPS.';

-- Blindaje de valores imposibles: evita publicar basura si el dispositivo
-- entrega datos corruptos.
ALTER TABLE public.trip_live_locations
  DROP CONSTRAINT IF EXISTS trip_live_locations_lat_range;
ALTER TABLE public.trip_live_locations
  ADD CONSTRAINT trip_live_locations_lat_range CHECK (lat BETWEEN -90 AND 90);

ALTER TABLE public.trip_live_locations
  DROP CONSTRAINT IF EXISTS trip_live_locations_lng_range;
ALTER TABLE public.trip_live_locations
  ADD CONSTRAINT trip_live_locations_lng_range CHECK (lng BETWEEN -180 AND 180);

-- Consulta típica: "las ubicaciones de este viaje".
CREATE INDEX IF NOT EXISTS idx_trip_live_locations_trip
  ON public.trip_live_locations(trip_id);

-- ============================================================
-- 3. RLS: solo los participantes leen las ubicaciones de SU viaje
-- ============================================================
-- No hay política de INSERT/UPDATE/DELETE: la única vía de escritura son los
-- RPC SECURITY DEFINER de más abajo, que validan la participación.
-- ============================================================
ALTER TABLE public.trip_live_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view trip live locations"
  ON public.trip_live_locations;
CREATE POLICY "Participants can view trip live locations"
  ON public.trip_live_locations FOR SELECT
  USING (public.is_trip_participant(trip_id, auth.uid()));

REVOKE ALL ON TABLE public.trip_live_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trip_live_locations TO authenticated;

-- ============================================================
-- 4. RPC: publicar MI ubicación durante el viaje
-- ============================================================
-- Única vía de escritura. Valida EN LA BASE DE DATOS (nunca en React):
--   * sesión iniciada (auth.uid(), jamás un user_id del cliente),
--   * el viaje existe y su estado ACTUAL es 'in_progress',
--   * el llamador es PARTICIPANTE (conductor o pasajero aceptado),
--   * las coordenadas están en rango válido.
-- Efectos: UPSERT de mi fila (trip_id, user_id). No puede tocar la de otro.
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_my_trip_location(
  p_trip_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para compartir tu ubicación';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90
     OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'Coordenadas inválidas';
  END IF;

  SELECT t.status INTO v_status
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  -- El estado ACTUAL manda: un viaje terminado o cancelado no acepta ubicación.
  IF v_status NOT IN ('in_progress') THEN
    RAISE EXCEPTION 'El viaje no está en curso: no se puede compartir la ubicación';
  END IF;

  IF NOT public.is_trip_participant(p_trip_id, v_user_id) THEN
    RAISE EXCEPTION 'Solo los participantes del viaje pueden compartir su ubicación';
  END IF;

  INSERT INTO public.trip_live_locations AS l
    (trip_id, user_id, lat, lng, accuracy, shared_at, is_sharing, updated_at)
  VALUES
    (p_trip_id, v_user_id, p_lat, p_lng, p_accuracy, NOW(), TRUE, NOW())
  ON CONFLICT (trip_id, user_id) DO UPDATE
    SET lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        accuracy = EXCLUDED.accuracy,
        shared_at = NOW(),
        is_sharing = TRUE,
        updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION public.upsert_my_trip_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Publica la ubicación GPS propia en un viaje en curso. Valida sesión, estado in_progress y participación.';

REVOKE ALL ON FUNCTION public.upsert_my_trip_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_my_trip_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ============================================================
-- 5. RPC: dejar de compartir (o reanudar) MI ubicación
-- ============================================================
-- Apagar el interruptor NO borra la fila: se marca is_sharing = false para que
-- los demás sepan que esa persona dejó de compartir, sin inventar una posición.
-- Es una decisión reversible por el propio usuario.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_my_trip_location_sharing(
  p_trip_id UUID,
  p_is_sharing BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para cambiar el uso compartido de ubicación';
  END IF;

  IF NOT public.is_trip_participant(p_trip_id, v_user_id) THEN
    RAISE EXCEPTION 'Solo los participantes del viaje pueden cambiar este ajuste';
  END IF;

  UPDATE public.trip_live_locations l
  SET is_sharing = p_is_sharing,
      updated_at = NOW()
  WHERE l.trip_id = p_trip_id
    AND l.user_id = v_user_id;

  -- Si nunca había fila y se está activando, se crea vacía de coordenadas
  -- imposibles: mejor no crearla. El primer UPSERT de coordenadas la generará.
END;
$$;

COMMENT ON FUNCTION public.set_my_trip_location_sharing(UUID, BOOLEAN) IS
  'Activa o desactiva MI consentimiento de compartir ubicación en un viaje. No borra la última lectura.';

REVOKE ALL ON FUNCTION public.set_my_trip_location_sharing(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_trip_location_sharing(UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- 6. RPC: leer las ubicaciones del viaje (con nombres y rol)
-- ============================================================
-- Devuelve SOLO las filas de un viaje del que el llamador es participante, con
-- el nombre de cada persona y su rol, para que la interfaz no tenga que
-- consultar profiles por separado. SECURITY DEFINER porque trips ya restringe
-- por RLS quién puede ver qué.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_trip_live_locations(p_trip_id UUID)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  role TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  shared_at TIMESTAMPTZ,
  is_sharing BOOLEAN
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
    RAISE EXCEPTION 'Debes iniciar sesión para ver las ubicaciones del viaje';
  END IF;

  IF NOT public.is_trip_participant(p_trip_id, v_user_id) THEN
    RAISE EXCEPTION 'Solo los participantes del viaje pueden ver sus ubicaciones';
  END IF;

  FOR v_row IN
    SELECT
      l.user_id      AS l_user_id,
      l.lat          AS l_lat,
      l.lng          AS l_lng,
      l.accuracy     AS l_accuracy,
      l.shared_at    AS l_shared_at,
      l.is_sharing   AS l_is_sharing,
      p.full_name    AS p_full_name,
      t.driver_id    AS t_driver_id
    FROM public.trip_live_locations l
    JOIN public.trips t     ON t.id = l.trip_id
    LEFT JOIN public.profiles p ON p.id = l.user_id
    WHERE l.trip_id = p_trip_id
  LOOP
    user_id    := v_row.l_user_id;
    full_name  := COALESCE(v_row.p_full_name, 'Participante');
    role       := CASE WHEN v_row.t_driver_id = v_row.l_user_id THEN 'driver' ELSE 'passenger' END;
    lat        := v_row.l_lat;
    lng        := v_row.l_lng;
    accuracy   := v_row.l_accuracy;
    shared_at  := v_row.l_shared_at;
    is_sharing := v_row.l_is_sharing;

    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.get_trip_live_locations(UUID) IS
  'Ubicaciones compartidas de un viaje, solo para participantes, con nombre y rol de cada uno.';

REVOKE ALL ON FUNCTION public.get_trip_live_locations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trip_live_locations(UUID) TO authenticated;

-- ============================================================
-- 7. RPC: poner el viaje EN CURSO ('in_progress')
-- ============================================================
-- El GPS compartido solo se permite con el viaje 'in_progress'. Este RPC lo
-- marca sin alterar nada más del ciclo de vida: no completa ni cancela nada y
-- respeta las reglas existentes (la confirmación de finalización sigue igual).
-- Solo el conductor puede iniciar la marcha.
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_my_trip(p_trip_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_driver_id UUID;
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para iniciar el viaje';
  END IF;

  SELECT t.driver_id, t.status
    INTO v_driver_id, v_status
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF v_driver_id <> v_user_id THEN
    RAISE EXCEPTION 'Solo el conductor puede iniciar el viaje';
  END IF;

  -- Idempotente: si ya está en curso, no hay nada que hacer.
  IF v_status = 'in_progress' THEN
    RETURN v_status;
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'El viaje no se puede iniciar en su estado actual';
  END IF;

  UPDATE public.trips t
  SET status = 'in_progress',
      updated_at = NOW()
  WHERE t.id = p_trip_id
    AND t.status = 'active';

  RETURN 'in_progress';
END;
$$;

COMMENT ON FUNCTION public.start_my_trip(UUID) IS
  'Marca el viaje como en curso (in_progress). Solo el conductor. No completa ni cancela nada.';

REVOKE ALL ON FUNCTION public.start_my_trip(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_my_trip(UUID) TO authenticated;

-- ============================================================
-- 8. Limpieza: al terminar o cancelar, las ubicaciones desaparecen
-- ============================================================
-- Borra las filas de un viaje que ya no está en curso. Se llama desde el RPC
-- de finalización del lado del cliente y queda disponible para el cron.
-- Idempotente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_trip_live_locations(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.trip_live_locations l
  WHERE l.trip_id = p_trip_id
    AND EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = p_trip_id
        AND t.status IN ('completed', 'cancelled')
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.clear_trip_live_locations(UUID) IS
  'Borra las ubicaciones compartidas de un viaje terminado o cancelado. Idempotente.';

REVOKE ALL ON FUNCTION public.clear_trip_live_locations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_trip_live_locations(UUID) TO authenticated;

-- ============================================================
-- 9. Realtime: propagar las ubicaciones sin recargar la página
-- ============================================================
-- Se añade la tabla a la publicación de Supabase para que los participantes
-- reciban INSERT/UPDATE por WebSocket.
--
-- IMPORTANTE (seguridad): con RLS activado, Realtime respeta las políticas de
-- lectura: cada cliente SOLO recibe las filas de los viajes en los que
-- participa. Un usuario ajeno no recibe nada.
--
-- REPLICA IDENTITY FULL: incluye la clave primaria y todas las columnas en el
-- evento, para poder aplicar el cambio sin otra consulta (y para que los
-- DELETE se identifiquen correctamente).
--
-- Si la publicación supabase_realtime no existiera, se crea.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END;
$$;

ALTER TABLE public.trip_live_locations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trip_live_locations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_live_locations;
  END IF;
END;
$$;

-- ============================================================
-- 10. Verificación de que Realtime sigue autorizado
-- ============================================================
-- Supabase controla además el acceso por "Realtime Authorization" (tabla
-- realtime.messages / políticas RLS de la publicación). Esta migración NO
-- desactiva nada. Comprueba en el panel:
--   Database -> Replication -> supabase_realtime incluya trip_live_locations.
-- ============================================================

COMMIT;

-- ============================================================
-- COMPROBACIONES MANUALES (tras aplicar la migración)
-- ============================================================
-- 1) La tabla existe y tiene RLS:
--      SELECT tablename, rowsecurity FROM pg_tables
--      WHERE schemaname='public' AND tablename='trip_live_locations';   -- true
--
-- 2) Políticas (debe haber SOLO la de SELECT para participantes):
--      SELECT policyname, cmd FROM pg_policies
--      WHERE tablename='trip_live_locations';
--
-- 3) Permisos de la API (NO debe aparecer INSERT/UPDATE/DELETE):
--      SELECT privilege_type FROM information_schema.table_privileges
--      WHERE table_name='trip_live_locations' AND grantee='authenticated';
--
-- 4) Realtime:
--      SELECT * FROM pg_publication_tables
--      WHERE pubname='supabase_realtime' AND tablename='trip_live_locations';
--
-- 5) Privacidad: un usuario que NO participa no debe poder leer nada.
--      -- Con la sesión de ese usuario:
--      SELECT * FROM public.trip_live_locations WHERE trip_id='<viaje-ajeno>';
--      -- Debe devolver 0 filas (RLS) y el RPC debe fallar.
--
-- 6) Tras finalizar el viaje, las ubicaciones deben desaparecer:
--      SELECT public.clear_trip_live_locations('<trip_id>');
--      SELECT COUNT(*) FROM public.trip_live_locations WHERE trip_id='<trip_id>';  -- 0
-- ============================================================
