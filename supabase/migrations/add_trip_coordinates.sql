-- Migración: Agregar coordenadas y métricas de ruta a la tabla trips
-- Fecha: 2026-09-04
-- Descripción: Agrega columnas para almacenar coordenadas del origen y métricas de la ruta calculada

-- Agregar columnas de coordenadas del origen
ALTER TABLE trips 
ADD COLUMN IF NOT EXISTS origin_lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS origin_lng DOUBLE PRECISION;

-- Agregar columnas de métricas de ruta
ALTER TABLE trips 
ADD COLUMN IF NOT EXISTS route_distance_km DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS route_duration_minutes INTEGER;

-- Comentario sobre las nuevas columnas
COMMENT ON COLUMN trips.origin_lat IS 'Latitud del punto de origen del viaje';
COMMENT ON COLUMN trips.origin_lng IS 'Longitud del punto de origen del viaje';
COMMENT ON COLUMN trips.route_distance_km IS 'Distancia de la ruta en kilómetros (calculada por OSRM)';
COMMENT ON COLUMN trips.route_duration_minutes IS 'Duración estimada de la ruta en minutos (calculada por OSRM)';
