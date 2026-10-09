-- ============================================================
-- Migración: ETAPA 3 del ciclo de vida — historial de viajes
--            (estadísticas reales y soporte del rating existente)
-- ============================================================
-- Contexto de las etapas anteriores:
--   * add_trip_lifecycle.sql    (etapa 1): disponibilidad (status 'active',
--     seats_available > 0 y salida futura).
--   * add_trip_completion.sql   (etapa 2): confirmación de finalización,
--     'pending_completion' / 'completed', cierre de cortesía de 48 h,
--     notificaciones 'trip_completed' y RLS para que los participantes sigan
--     viendo sus viajes en cualquier estado.
--
-- Qué hace esta migración (etapa 3):
--   1. public.is_trip_effectively_completed(date, time, duration, status):
--      ¿el viaje ya terminó de forma efectiva? Es la MISMA regla de la etapa 2
--      (estado 'completed' persistido o plazo de cortesía de 48 h vencido),
--      expresada como función para poder reutilizarla en consultas.
--   2. public.get_user_trip_stats(...) recreada con una columna ADICIONAL:
--        - offered_trips    (sin cambios: viajes publicados como conductor)
--        - passenger_trips  (sin cambios: solicitudes 'accepted' como pasajero)
--        - completed_trips  (nuevo: viajes realmente COMPLETADOS en los que
--                            participó, como conductor o pasajero aceptado)
--      Un viaje cancelado NUNCA cuenta como completado.
--
-- POR QUÉ EL HISTORIAL NO NECESITA TABLAS NI RPC NUEVOS:
--   El historial es una LECTURA de datos que ya existen y ya tienen RLS:
--     * como conductor -> trips (propias, cualquier estado) +
--                         trip_requests_details (pasajeros aceptados);
--     * como pasajero  -> trip_requests_details (solicitudes propias) +
--                         trips.status/route_duration_minutes;
--     * calificaciones -> tabla ratings (lectura pública ya existente) y
--                         RPC get_user_received_ratings.
--   Calificar sigue siendo exclusivamente el RPC submit_rating existente
--   (add_ratings_system.sql): NO se crea un sistema de rating paralelo.
--
-- Requisitos previos: schema.sql, add_user_profiles.sql,
--                     add_ratings_system.sql, add_trip_lifecycle.sql,
--                     add_trip_completion.sql
-- Idempotente: se puede reejecutar sin efectos secundarios.
-- No elimina datos ni tablas (sin DELETE / DROP TABLE).
-- Nota: se requiere DROP del RPC get_user_trip_stats porque PostgreSQL no
--       permite cambiar el tipo de retorno de una función con CREATE OR
--       REPLACE; se recrea en la MISMA transacción, con la misma firma y los
--       mismos permisos (no hay ventana sin función para el cliente).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ¿El viaje ya terminó de forma efectiva?
-- ============================================================
-- Regla única, idéntica a la de la etapa 2 (confirm_trip_completion /
-- get_trip_completion_summary):
--   * status 'completed'  -> terminado (unanimidad ya persistida).
--   * status 'cancelled'  -> NO terminado: un viaje cancelado nunca es un
--                            viaje completado.
--   * cualquier otro      -> terminado si ya venció el plazo de cortesía
--                            (fin programado + 48 h), aunque el cierre
--                            automático todavía no se haya materializado en la
--                            fila (el "reaper" es perezoso y sin cron).
-- STABLE (no IMMUTABLE) porque usa NOW().
-- Función interna: la usan funciones SECURITY DEFINER; no se expone a la API
-- (mismo criterio que reap_trip_completion_if_due en la etapa 2).
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_trip_effectively_completed(
  p_date DATE,
  p_time TIME,
  p_duration_minutes INTEGER,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_status = 'completed' THEN TRUE
    WHEN p_status = 'cancelled' THEN FALSE
    ELSE NOW() >= public.trip_scheduled_end(p_date, p_time, p_duration_minutes)
                 + public.trip_completion_grace_interval()
  END;
$$;

COMMENT ON FUNCTION public.is_trip_effectively_completed(DATE, TIME, INTEGER, TEXT) IS
  '¿El viaje ya terminó? Misma regla que la etapa 2: status completed o plazo de cortesía (fin programado + 48 h) vencido. Un viaje cancelado nunca cuenta como completado.';

-- ============================================================
-- 2. Estadísticas del perfil: los viajes completados aportan,
--    los cancelados NO cuentan como completados
-- ============================================================
-- Se conservan EXACTAMENTE las dos columnas anteriores (perfiles y perfiles
-- públicos no cambian) y se agrega completed_trips:
--   * offered_trips   = viajes publicados como conductor (sin filtrar estado).
--   * passenger_trips = solicitudes 'accepted' como pasajero.
--   * completed_trips = viajes distintos en los que participó (conductor o
--                       pasajero 'accepted') y que ya terminaron de forma
--                       efectiva. UNION (no UNION ALL) evita contar dos veces
--                       al conductor que también es pasajero de su propio
--                       viaje. Un viaje cancelado queda fuera por definición
--                       de is_trip_effectively_completed.
-- ============================================================
DROP FUNCTION IF EXISTS public.get_user_trip_stats(UUID);

CREATE OR REPLACE FUNCTION public.get_user_trip_stats(p_user_id UUID)
RETURNS TABLE (offered_trips BIGINT, passenger_trips BIGINT, completed_trips BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.trips t WHERE t.driver_id = p_user_id),
    (SELECT COUNT(*) FROM public.trip_requests tr
      WHERE tr.passenger_id = p_user_id
        AND tr.status = 'accepted'),
    (SELECT COUNT(*)
     FROM (
       SELECT t.id
       FROM public.trips t
       WHERE t.driver_id = p_user_id
         AND public.is_trip_effectively_completed(
               t.date, t.time, t.route_duration_minutes, t.status
             )
       UNION
       SELECT t.id
       FROM public.trip_requests tr
       JOIN public.trips t ON t.id = tr.trip_id
       WHERE tr.passenger_id = p_user_id
         AND tr.status = 'accepted'
         AND public.is_trip_effectively_completed(
               t.date, t.time, t.route_duration_minutes, t.status
             )
     ) AS completed);
END;
$$;

COMMENT ON FUNCTION public.get_user_trip_stats(UUID) IS
  'Conteos públicos: viajes ofrecidos como conductor, viajes como pasajero (accepted) y viajes COMPLETADOS (nunca cancelados) en los que participó.';

REVOKE ALL ON FUNCTION public.get_user_trip_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_trip_stats(UUID) TO anon, authenticated;

-- ============================================================
-- 3. Comprobación final (opcional)
-- ============================================================
-- Consultas de verificación manual, una vez aplicada la migración:
--
--   -- 3.1 Estadísticas por usuario (los completados no incluyen cancelados)
--   SELECT p.full_name, s.offered_trips, s.passenger_trips, s.completed_trips
--   FROM public.profiles p
--   CROSS JOIN LATERAL public.get_user_trip_stats(p.id) s
--   ORDER BY s.completed_trips DESC
--   LIMIT 20;
--
--   -- 3.2 Estado de finalización efectiva de cada viaje
--   SELECT t.id,
--          t.status,
--          public.is_trip_effectively_completed(
--            t.date, t.time, t.route_duration_minutes, t.status
--          ) AS finalizado_efectivo
--   FROM public.trips t
--   ORDER BY t.date DESC
--   LIMIT 20;
--
--   -- 3.3 Cancelados que NO deben aparecer como completados (debe dar 0)
--   SELECT COUNT(*) AS cancelados_contados_como_completados
--   FROM public.trips t
--   WHERE t.status = 'cancelled'
--     AND public.is_trip_effectively_completed(
--           t.date, t.time, t.route_duration_minutes, t.status
--         );
-- ============================================================

COMMIT;
