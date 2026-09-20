-- ============================================================
-- Migración: Dirección de recogida en trip_requests + RPC seguros
-- Flujo real de solicitudes de viaje (pasajero -> conductor)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas de recogida (sin borrar datos existentes)
-- ------------------------------------------------------------
ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;

COMMENT ON COLUMN trip_requests.pickup_address IS 'Dirección de recogida del pasajero (display_name de Nominatim)';
COMMENT ON COLUMN trip_requests.pickup_lat IS 'Latitud del punto de recogida del pasajero';
COMMENT ON COLUMN trip_requests.pickup_lng IS 'Longitud del punto de recogida del pasajero';

-- ------------------------------------------------------------
-- 2. Función RPC: aceptar solicitud (atómicamente reduce asiento)
-- Evita condiciones de carrera: el decremento se hace con un
-- UPDATE condicional (seats_available > 0) dentro de la misma
-- transacción de la función.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_trip_request(p_request_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trip_id UUID;
  v_request_status TEXT;
  v_trip_status TEXT;
  v_driver_id UUID;
BEGIN
  -- La solicitud debe existir y estar pendiente
  SELECT trip_id, status INTO v_trip_id, v_request_status
  FROM public.trip_requests
  WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_request_status <> 'pending' THEN
    RAISE EXCEPTION 'La solicitud ya no está pendiente';
  END IF;

  -- El viaje debe existir, pertenecer al conductor autenticado y estar activo
  SELECT driver_id, status INTO v_driver_id, v_trip_status
  FROM public.trips
  WHERE id = v_trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF v_driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'No eres el conductor de este viaje';
  END IF;

  IF v_trip_status <> 'active' THEN
    RAISE EXCEPTION 'El viaje ya no está activo';
  END IF;

  -- Decrementar asiento de forma atómica (nunca por debajo de 0)
  UPDATE public.trips
  SET seats_available = seats_available - 1,
      updated_at = NOW()
  WHERE id = v_trip_id AND seats_available > 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay asientos disponibles para este viaje';
  END IF;

  -- Marcar la solicitud como aceptada
  UPDATE public.trip_requests
  SET status = 'accepted',
      updated_at = NOW()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_trip_request(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 3. Función RPC: rechazar solicitud (no modifica asientos)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_trip_request(p_request_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trip_id UUID;
  v_request_status TEXT;
  v_driver_id UUID;
BEGIN
  SELECT trip_id, status INTO v_trip_id, v_request_status
  FROM public.trip_requests
  WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF v_request_status <> 'pending' THEN
    RAISE EXCEPTION 'La solicitud ya no está pendiente';
  END IF;

  SELECT driver_id INTO v_driver_id
  FROM public.trips
  WHERE id = v_trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF v_driver_id <> auth.uid() THEN
    RAISE EXCEPTION 'No eres el conductor de este viaje';
  END IF;

  UPDATE public.trip_requests
  SET status = 'rejected',
      updated_at = NOW()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_trip_request(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. Función RPC: cancelar solicitud (pasajero de su propia solicitud)
-- Sustituye la antigua política UPDATE "Passengers can cancel own trip requests"
-- evitando que se pueda modificar cualquier otra columna.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_trip_request(p_request_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_passenger_id UUID;
  v_request_status TEXT;
BEGIN
  SELECT passenger_id, status INTO v_passenger_id, v_request_status
  FROM public.trip_requests
  WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF auth.uid() <> v_passenger_id THEN
    RAISE EXCEPTION 'No puedes cancelar esta solicitud';
  END IF;

  IF v_request_status <> 'pending' THEN
    RAISE EXCEPTION 'La solicitud ya no está pendiente';
  END IF;

  UPDATE public.trip_requests
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_trip_request(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5. Trigger: impedir solicitudes inválidas
--   - No se puede solicitar el propio viaje
--   - El viaje debe estar activo
--   - El viaje debe tener asientos disponibles
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS prevent_invalid_trip_request ON public.trip_requests;

CREATE OR REPLACE FUNCTION public.prevent_invalid_trip_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_driver_id UUID;
  v_status TEXT;
  v_seats INTEGER;
BEGIN
  SELECT driver_id, status, seats_available
  INTO v_driver_id, v_status, v_seats
  FROM public.trips
  WHERE id = NEW.trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje no existe';
  END IF;

  IF v_driver_id = NEW.passenger_id THEN
    RAISE EXCEPTION 'No puedes solicitar tu propio viaje';
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'El viaje ya no está activo';
  END IF;

  IF v_seats <= 0 THEN
    RAISE EXCEPTION 'El viaje no tiene asientos disponibles';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_invalid_trip_request
  BEFORE INSERT ON public.trip_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_invalid_trip_request();

-- ------------------------------------------------------------
-- 6. RLS: eliminar las políticas UPDATE genéricas.
-- Con esto:
--   - Un pasajero NO puede aceptar/rechazar (ya no existe UPDATE propio)
--   - Un conductor NO puede editar columnas vía UPDATE directo (incl. passenger_id)
--   - Aceptar/rechazar/cancelar SOLO a través de las funciones RPC (con checks de auth.uid())
-- Las políticas SELECT y INSERT existentes se conservan.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Passengers can cancel own trip requests" ON public.trip_requests;
DROP POLICY IF EXISTS "Drivers can update trip requests for their trips" ON public.trip_requests;

-- ------------------------------------------------------------
-- 7. Vista trip_requests_details renovada
--   - Añade driver_id, passenger_email y trip_seats_available
--   - security_barrier = true => la vista respeta RLS de las tablas base
--     (sin esto, cualquier usuario autenticado podría leer TODAS las solicitudes
--      incluyendo direcciones de recogida de otros usuarios)
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.trip_requests_details;

CREATE OR REPLACE VIEW public.trip_requests_details
WITH (security_barrier = true) AS
SELECT
  tr.*,
  t.driver_id,
  t.origin,
  t.destination,
  t.date,
  t.time,
  t.price,
  t.seats_available AS trip_seats_available,
  p.full_name AS passenger_name,
  p.email AS passenger_email,
  p.rating AS passenger_rating,
  p.university AS passenger_university
FROM public.trip_requests tr
JOIN public.trips t ON tr.trip_id = t.id
JOIN public.profiles p ON tr.passenger_id = p.id;