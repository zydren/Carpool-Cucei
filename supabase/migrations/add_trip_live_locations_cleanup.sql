-- ============================================================
-- Migración: add_trip_live_locations_cleanup.sql
-- Limpieza automática del GPS compartido al finalizar/cancelar
-- ============================================================
-- Objetivo:
--   Cuando un viaje deja de estar en curso (pasa a 'completed' o
--   'cancelled'), las ubicaciones compartidas de ESE viaje deben desaparecer.
--
-- Por qué un TRIGGER y no una llamada desde el cliente:
--   * Es más robusto: corre en el servidor siempre, sin depender de que el
--     cliente ejecute nada. Cubre también el cierre automático de cortesía
--     (reap_my_trip_completions) y cualquier UPDATE de estado futuro.
--   * clear_trip_live_locations() (de add_trip_live_locations.sql) NO valida
--     participación: cualquier usuario podía borrar ubicaciones de un viaje
--     ajeno ya terminado. Aquí se CORRIGE ese RPC (defensa en profundidad) y
--     se añade el trigger como mecanismo principal.
--   * La limpieza NUNCA debe impedir finalizar/cancelar el viaje: el DELETE va
--     dentro de un bloque con EXCEPTION para que un fallo aislado no aborte la
--     transacción principal.
--
-- Decisiones de seguridad:
--   * El trigger es SECURITY DEFINER y actúa SOLO sobre el viaje de la fila
--     que cambió (FOR EACH ROW): nadie puede usarlo contra viajes ajenos.
--   * No se modifica ninguna migración aplicada: este archivo solo AÑADE el
--     trigger y hace CREATE OR REPLACE del RPC (idempotente, no destructivo).
--   * No almacena historial: las filas se eliminan, no se archivan.
--
-- Ejecutar manualmente en el SQL Editor de Supabase. Idempotente.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Función trigger: limpia las ubicaciones cuando el viaje termina
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_trip_live_locations_on_finish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Solo actuamos cuando el estado CAMBIA a completed/cancelled.
  IF NEW.status IN ('completed', 'cancelled')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    BEGIN
      DELETE FROM public.trip_live_locations
      WHERE trip_id = NEW.id;
    EXCEPTION
      WHEN OTHERS THEN
        -- Un fallo de limpieza NO debe impedir finalizar/cancelar el viaje.
        RAISE WARNING 'No se pudieron limpiar las ubicaciones del viaje al finalizar';
    END;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.clear_trip_live_locations_on_finish() IS
  'Trigger: borra las ubicaciones GPS compartidas cuando el viaje pasa a completed o cancelled. No almacena historial.';

-- Se elimina el trigger previo (si existiera) y se recrea: idempotente.
DROP TRIGGER IF EXISTS clear_trip_live_locations_on_finish ON public.trips;
CREATE TRIGGER clear_trip_live_locations_on_finish
  AFTER UPDATE OF status ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_trip_live_locations_on_finish();


-- ============================================================
-- 2. Endurecer clear_trip_live_locations() con validación de participación
-- ============================================================
-- La versión original (add_trip_live_locations.sql) borraba por trip_id SIN
-- comprobar quién llamaba: cualquier usuario autenticado podía borrar
-- ubicaciones de un viaje ajeno ya terminado. Aquí se reemplaza por una
-- versión que valida en el servidor que el llamador sea PARTICIPANTE. Se
-- conserva el contrato (INTEGER de filas borradas) y sigue siendo idempotente.
-- El trigger de arriba es el mecanismo principal; este RPC queda como refuerzo
-- explícito y para uso manual.
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_trip_live_locations(p_trip_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_deleted INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para limpiar las ubicaciones del viaje';
  END IF;

  -- Solo un participante (conductor o pasajero aceptado) puede limpiar.
  IF NOT public.is_trip_participant(p_trip_id, v_user_id) THEN
    RAISE EXCEPTION 'Solo los participantes del viaje pueden limpiar sus ubicaciones';
  END IF;

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
  'Borra las ubicaciones compartidas de un viaje terminado o cancelado. Solo participantes. Idempotente.';

REVOKE ALL ON FUNCTION public.clear_trip_live_locations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_trip_live_locations(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- COMPROBACIONES MANUALES (tras aplicar la migración)
-- ============================================================
-- 1) El trigger existe y está sobre public.trips:
--      SELECT tgname FROM pg_trigger WHERE tgrelid='public.trips'::regclass;
--      -- debe aparecer clear_trip_live_locations_on_finish
--
-- 2) Tras finalizar un viaje, sus ubicaciones se borran solas:
--      -- publica una ubicación, marca el viaje completed y comprueba:
--      SELECT count(*) FROM public.trip_live_locations WHERE trip_id='<trip_id>';  -- 0
--
-- 3) Un NO participante no puede llamar al RPC (debe fallar):
--      -- con la sesión de un usuario ajeno:
--      SELECT public.clear_trip_live_locations('<trip_id>');  -- error: solo participantes
--
-- 4) Un usuario ajeno NO debe leer ubicaciones de ese viaje (RLS):
--      SELECT * FROM public.trip_live_locations WHERE trip_id='<trip_ajeno>';  -- 0 filas
-- ============================================================
