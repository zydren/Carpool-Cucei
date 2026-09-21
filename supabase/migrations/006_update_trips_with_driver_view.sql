-- ============================================================
-- Migración: reconstruir la vista trips_with_driver
-- ============================================================
-- Problema: la vista fue creada con SELECT t.* ANTES de que se agregaran a la
-- tabla trips las columnas origin_lat, origin_lng, route_distance_km,
-- route_duration_minutes y route_geometry (migraciones add_trip_coordinates.sql
-- y add_route_geometry_to_trips.sql). PostgreSQL congela la lista de columnas
-- de una vista en el momento de su creación: las columnas añadidas después a
-- la tabla NO aparecen en la vista aunque use SELECT t.*.
--
-- Solución: DROP + CREATE (no CREATE OR REPLACE, que solo permite añadir
-- columnas AL FINAL y aquí además se incorporan driver_id y notes, que el
-- frontend consume). NO se borran datos: solo se redefine la vista.
--
-- Nota: DROP VIEW elimina los GRANT de la vista anterior, por lo que se
-- restauran al final para que la API (claves publishable/anon) siga pudiendo
-- leerla, igual que hasta ahora.
-- ============================================================

BEGIN;

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

-- Restaurar el acceso de los roles de la API (el DROP eliminó los grants previos)
GRANT SELECT ON public.trips_with_driver TO anon, authenticated, service_role;

COMMENT ON VIEW public.trips_with_driver IS
  'Vista de viajes con información del conductor. Incluye coordenadas del origen
  (origin_lat/origin_lng), métricas de ruta y geometría GeoJSON (route_geometry).
  Reconstruida para exponer las columnas añadidas a trips después de su creación.';

COMMIT;
