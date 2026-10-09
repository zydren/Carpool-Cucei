-- ============================================================
-- Migración: add_mobility_analytics.sql
-- ETAPA 1 del módulo de Inteligencia Artificial / Soft Computing:
-- MINERÍA DE DATOS + preparación del DATASET (NO es Machine Learning)
-- ============================================================
-- Objetivo
--   Exponer, de forma CONTROLADA y SIN datos personales, un dataset de una
--   fila por viaje con las variables necesarias para calcular las estadísticas
--   de movilidad y, más adelante (otra etapa), entrenar un modelo.
--
-- POR QUÉ ESTA FUNCIÓN Y NO UNA CONSULTA DIRECTA DESDE EL CLIENTE:
--   Las políticas RLS de `trips` (ver schema.sql) solo permiten leer:
--     * los viajes con status = 'active' (a cualquier usuario), y
--     * los viajes propios del conductor autenticado (cualquier estado).
--   Con esa visibilidad, un análisis "de plataforma" en el cliente solo vería
--   viajes activos y los propios: los conteos de completados/cancelados
--   quedarían incompletos. Esta función es SECURITY DEFINER y agrega/anonomiza
--   del lado del servidor, de modo que:
--     * NO se debilita ni se modifica ninguna política RLS existente;
--     * NO se expone ningún dato personal (sin ids, sin correos, sin teléfonos,
--       sin nombres): solo variables agregables de cada viaje;
--     * el cliente deja de depender de qué filas le permite ver RLS.
--
-- Reglas de esta migración:
--   * NO modifica el esquema de `trips` (no añade/borra columnas ni filas).
--   * NO elimina datos ni tablas (sin DELETE / DROP TABLE).
--   * NO toca RLS, sus políticas, triggers ni el ciclo de vida.
--   * NO toca búsqueda, rutas, autenticación, solicitudes, historial ni ratings.
--   * Idempotente: se puede ejecutar más de una vez.
--   * Ejecutar manualmente en el SQL Editor de Supabase.
--
-- Requisitos previos: schema.sql (tablas trips y trip_requests).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- get_trip_mobility_dataset(): dataset anonimizado, una fila por viaje
-- ------------------------------------------------------------
-- Columnas (todas no personales):
--   day_of_week      1 = domingo … 7 = sábado  (EXTRACT(DOW)+1, convención
--                    alineada con Date.getDay()+1 del frontend)
--   hour_of_day      0 … 23 (hora local de la salida)
--   distance_km      route_distance_km (null en viajes antiguos sin ruta)
--   duration_minutes route_duration_minutes (null si no se calculó)
--   price            precio del viaje
--   available_seats  seats_available publicados
--   requested_seats  nº TOTAL de solicitudes recibidas por el viaje
--                    (indica interés; 0 si el viaje no recibió ninguna)
--   is_completed     status = 'completed'
--   is_cancelled     status = 'cancelled'
--   origin_zone      primera parte del origen (p. ej. "Plaza Patria"), usada
--                    como zona de recogida; NO se devuelve la dirección
--                    completa ni coordenadas personales.
--
-- Nota de privacidad: se devuelve UNA fila por viaje SIN identificadores. El
-- objetivo es estadístico; el cliente no puede reconstruir la identidad de
-- ningún usuario a partir de estas columnas.
--
-- Nota de mantenimiento: `origin_zone` se calcula aquí con
-- TRIM(split_part(origin, ',', 1)); el *fallback* del cliente
-- (src/services/analyticsService.ts) calcula exactamente lo mismo. Si se
-- cambiara la regla, debe cambiarse en ambos sitios para mantener la
-- consistencia entre la vía RPC y la vía RLS.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trip_mobility_dataset()
RETURNS TABLE (
  day_of_week      INTEGER,
  hour_of_day      INTEGER,
  distance_km      DOUBLE PRECISION,
  duration_minutes INTEGER,
  price            DOUBLE PRECISION,
  available_seats  INTEGER,
  requested_seats  INTEGER,
  is_completed     BOOLEAN,
  is_cancelled     BOOLEAN,
  origin_zone      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (EXTRACT(DOW FROM t.date)::INTEGER + 1)            AS day_of_week,
    EXTRACT(HOUR FROM t.time)::INTEGER                 AS hour_of_day,
    t.route_distance_km                                AS distance_km,
    t.route_duration_minutes                           AS duration_minutes,
    t.price::DOUBLE PRECISION                          AS price,
    t.seats_available                                  AS available_seats,
    COALESCE(req.total_requests, 0)                    AS requested_seats,
    (t.status = 'completed')                           AS is_completed,
    (t.status = 'cancelled')                           AS is_cancelled,
    COALESCE(
      NULLIF(TRIM(split_part(t.origin, ',', 1)), ''),
      'Sin zona definida'
    )                                                  AS origin_zone
  FROM public.trips t
  LEFT JOIN (
    SELECT tr.trip_id, COUNT(*)::INTEGER AS total_requests
    FROM public.trip_requests tr
    GROUP BY tr.trip_id
  ) req ON req.trip_id = t.id;
$$;

COMMENT ON FUNCTION public.get_trip_mobility_dataset() IS
  'ETAPA 1 (minería de datos): dataset anonimizado con una fila por viaje (día, hora, distancia, duración, precio, asientos, solicitudes, estado y zona de origen) para estadísticas de movilidad y futura preparación del dataset de ML. SECURITY DEFINER: agrega del lado del servidor sin exponer datos personales ni debilitar RLS.';

-- Solo usuarios autenticados pueden invocarla (datos no personales agregados).
-- Se revoca el acceso a PUBLIC por principio de mínimo privilegio.
REVOKE ALL ON FUNCTION public.get_trip_mobility_dataset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trip_mobility_dataset() TO authenticated;

-- ------------------------------------------------------------
-- Comprobación final (opcional), una vez aplicada la migración:
--
--   SELECT COUNT(*) AS viajes_en_dataset FROM public.get_trip_mobility_dataset();
--
--   SELECT day_of_week, COUNT(*)
--   FROM public.get_trip_mobility_dataset()
--   GROUP BY day_of_week ORDER BY day_of_week;
-- ------------------------------------------------------------

COMMIT;