-- Migración: Agregar geometría de ruta a la tabla trips
-- Descripción: Agrega una columna JSONB para almacenar la geometría
--   GeoJSON LineString de la ruta origen→CUCEI, calculada por OSRM al
--   publicar el viaje. Se usa para poder comprobar, en una fase futura,
--   si la ruta del viaje pasa cerca de la ubicación del pasajero.

ALTER TABLE trips
ADD COLUMN IF NOT EXISTS route_geometry JSONB;

COMMENT ON COLUMN trips.route_geometry IS
  'Geometría GeoJSON LineString de la ruta origen→CUCEI (calculada por OSRM).
   Puede ser NULL en viajes creados antes de esta migración.';
