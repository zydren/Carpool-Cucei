-- ============================================================
-- Migración: add_trip_lifecycle.sql
-- Ciclo de vida de los viajes (etapa 1)
-- ============================================================
-- Objetivos:
--   1. Detectar a nivel de BASE DE DATOS cuándo la salida de un viaje ya
--      pasó, para excluirla de la búsqueda con un filtro indexable
--      (departure_at), sin depender exclusivamente del frontend.
--   2. Formalizar el ciclo de vida en la columna existente `status`,
--      reutilizándola y reservando desde ahora los estados de la etapa 2.
--   3. Preparar la arquitectura de etapas siguientes (historial, ratings,
--      confirmación de finalización), SIN implementarlas todavía.
--
-- Reglas de esta migración:
--   * NO modifica filas existentes ni elimina datos (sin DELETE/UPDATE).
--   * NO elimina tablas (sin DROP TABLE).
--   * NO toca RLS ni sus políticas.
--   * NO modifica migraciones anteriores.
--   * Idempotente: se puede ejecutar más de una vez.
--   * Los viajes antiguos quedan cubiertos: la columna generada se calcula
--     automáticamente para todas las filas existentes.
--
-- Estados del viaje (nombre real de la columna: trips.status):
--   'active'             → publicado (equivalente a "scheduled"); aparece en
--                          búsqueda SOLO si su salida aún no ha pasado y
--                          tiene lugares disponibles.
--   'in_progress'        → ETAPA 2 (reservado: aún no se escribe desde la app).
--   'pending_completion' → ETAPA 2 (reservado: aún no se escribe desde la app).
--   'completed'          → finalizado; nunca aparece en búsqueda.
--   'cancelled'          → cancelado; nunca aparece en búsqueda.
-- Se conservan los nombres existentes ('active', 'completed', 'cancelled')
-- por compatibilidad con datos, triggers (solicitudes/ratings) y frontend.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Ciclo de vida: ampliar el CHECK de trips.status
-- ------------------------------------------------------------
-- Ampliar un CHECK es retrocompatible: los valores actuales siguen siendo
-- válidos y ningún dato existente cambia. El constraint creado junto con
-- el esquema (supabase/schema.sql) se llama trips_status_check.
-- ------------------------------------------------------------
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_status_check;

ALTER TABLE public.trips ADD CONSTRAINT trips_status_check
  CHECK (status IN (
    'active',
    'in_progress',
    'pending_completion',
    'completed',
    'cancelled'
  ));

COMMENT ON COLUMN public.trips.status IS
  'Ciclo de vida del viaje: active (publicado) -> [in_progress, pending_completion: etapa 2] -> completed | cancelled. Solo los viajes active cuya salida (departure_at) aún no ha pasado y con lugares disponibles aparecen en la búsqueda.';

-- ------------------------------------------------------------
-- 2. departure_at: fecha + hora de salida como TIMESTAMPTZ
-- ------------------------------------------------------------
-- `date` (DATE) y `time` (TIME) son "naive" (sin zona horaria) y representan
-- la hora local en México. Se les aplica la zona America/Mexico_City para
-- obtener un instante absoluto (TIMESTAMPTZ) correcto sin importar la zona
-- del servidor ni la del cliente:
--     (date + time) AT TIME ZONE 'America/Mexico_City'
--     timestamp naive --AT TIME ZONE zona--> timestamptz (la zona se
--     interpreta como hora local del timestamp, que es exactamente lo que
--     representan date y time).
-- Como columna GENERATED ... STORED:
--   * se calcula SOLO a partir de date y time (expresión inmutable),
--   * se rellena automáticamente para los viajes antiguos al añadirla,
--   * se mantiene sola en cada INSERT/UPDATE (no la escribe el frontend).
-- México no aplica horario de verano desde 2022, pero la zona queda fijada
-- explícitamente para que la regla sea estable en el tiempo.
-- ------------------------------------------------------------
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS departure_at TIMESTAMPTZ
  GENERATED ALWAYS AS ((date + time) AT TIME ZONE 'America/Mexico_City')
  STORED;

COMMENT ON COLUMN public.trips.departure_at IS
  'Salida del viaje (date + time) interpretada en America/Mexico_City como timestamptz. Permite filtrar viajes futuros con WHERE departure_at > NOW(). Columna generada: no se inserta ni se actualiza manualmente.';

-- Índice para el filtro de la búsqueda: departure_at > ahora
CREATE INDEX IF NOT EXISTS idx_trips_departure_at
  ON public.trips (departure_at);

-- ------------------------------------------------------------
-- 3. Reconstruir la vista trips_with_driver exponiendo departure_at
-- ------------------------------------------------------------
-- Misma técnica que la migración 006_update_trips_with_driver_view.sql:
-- PostgreSQL congela la lista de columnas de una vista al crearla, por lo
-- que las columnas añadidas después a `trips` no aparecen solas. Se usa
-- DROP + CREATE (no CREATE OR REPLACE, que solo admite añadir columnas al
-- final). Solo se redefine la vista: NO se borra ningún dato. Se restauran
-- los GRANT que el DROP elimina, para que la API (claves publishable/anon)
-- siga pudiendo leerla, igual que hasta ahora.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.trips_with_driver;

CREATE VIEW public.trips_with_driver AS
SELECT
  t.id,
  t.driver_id,
  t.origin,
  t.destination,
  t.origin_lat,
  t.origin_lng,
  t.route_distance_km,
  t.route_duration_minutes,
  t.route_geometry,
  t.date,
  t.time,
  t.departure_at,
  t.seats_available,
  t.price,
  t.notes,
  t.status,
  t.created_at,
  t.updated_at,
  p.full_name AS driver_name,
  p.rating AS driver_rating,
  p.university AS driver_university,
  p.email AS driver_email
FROM public.trips t
JOIN public.profiles p ON t.driver_id = p.id;

GRANT SELECT ON public.trips_with_driver TO anon, authenticated, service_role;

COMMENT ON VIEW public.trips_with_driver IS
  'Vista de viajes con información del conductor (columnas de trips + datos del perfil). Incluye departure_at (salida como timestamptz en America/Mexico_City) para filtrar viajes futuros en la búsqueda. Reconstruida por add_trip_lifecycle.sql.';

COMMIT;
