-- ============================================================
-- Migración: Notificaciones en la aplicación (Etapa 1)
-- ------------------------------------------------------------
-- Crea la tabla public.notifications y los TRIGGERS que generan las
-- notificaciones del flujo real de solicitudes de viaje:
--   * AFTER INSERT  (solicitud pendiente)  -> conductor  (request_created)
--   * AFTER UPDATE  pending -> accepted    -> pasajero   (request_accepted)
--   * AFTER UPDATE  pending -> rejected    -> pasajero   (request_rejected)
--   * AFTER UPDATE  pending -> cancelled   -> conductor  (request_cancelled)
--
-- Decisiones de diseño:
--   * Las notificaciones se crean ÚNICAMENTE desde funciones de trigger
--     SECURITY DEFINER con search_path seguro. Por eso NO existe política
--     INSERT ni permiso INSERT para los roles de la API: el cliente solo
--     puede leer y marcar como leídas sus propias notificaciones.
--   * RLS activado: un usuario solo ve/actualiza/elimina SUS notificaciones.
--   * No se modifica ninguna tabla, vista, RPC, trigger, política ni
--     función existente del proyecto (aceptar/rechazar/cancelar siguen igual).
--   * No se usa service_role ni claves privadas.
--
-- Ejecutar manualmente en el SQL Editor de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabla notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('request_created', 'request_accepted', 'request_rejected', 'request_cancelled')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE,
  related_request_id UUID REFERENCES public.trip_requests(id) ON DELETE CASCADE,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notifications IS 'Notificaciones dentro de la aplicación, generadas por los triggers del flujo de solicitudes de viaje';
COMMENT ON COLUMN public.notifications.user_id IS 'Destinatario de la notificación (profiles.id)';
COMMENT ON COLUMN public.notifications.type IS 'Evento: request_created | request_accepted | request_rejected | request_cancelled';
COMMENT ON COLUMN public.notifications.read IS 'true cuando el usuario ya la leyó desde la campana del navbar';
COMMENT ON COLUMN public.notifications.related_trip_id IS 'Viaje relacionado con la notificación (nullable)';
COMMENT ON COLUMN public.notifications.related_request_id IS 'Solicitud relacionada con la notificación (nullable)';

-- ------------------------------------------------------------
-- 2. Índices
--    - user_id: listar las notificaciones propias
--    - parcial (user_id) WHERE read = FALSE: contador de no leídas
--    - created_at DESC: orden del listado (más recientes primero)
--    - related_request_id: trazabilidad de la solicitud
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_related_request_id ON public.notifications(related_request_id);

-- ------------------------------------------------------------
-- 3. RLS: cada usuario solo accede a sus propias notificaciones
--    (SIN política INSERT: la inserción la hacen los triggers)
-- ------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Permisos de API: solo lectura y actualización (el INSERT lo hacen los
-- triggers, nunca el cliente; por eso no se concede INSERT).
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;


-- ============================================================
-- 4. Funciones de trigger (SECURITY DEFINER + search_path seguro)
-- ------------------------------------------------------------
-- Ambas funciones se ejecutan con los privilegios de su dueño (el rol
-- que aplica la migración), por lo que pueden insertar en
-- public.notifications aunque ningún rol de la API tenga permiso INSERT.
--
-- Nota de seguridad: son funciones que devuelven TRIGGER, así que
-- PostgreSQL no permite invocarlas directamente (solo se ejecutan como
-- triggers de trip_requests). No son alcanzables desde /rest/v1/rpc.
-- ============================================================

-- ------------------------------------------------------------
-- 4.1 Solicitud creada -> notifica al CONDUCTOR
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_trip_request_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver_id UUID;
  v_passenger_name TEXT;
BEGIN
  -- Solo solicitudes pendientes (el flujo real crea siempre 'pending')
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT t.driver_id INTO v_driver_id
  FROM public.trips t
  WHERE t.id = NEW.trip_id;

  -- Sin viaje asociado no hay destinatario (no debería ocurrir: FK + trigger de validación)
  IF v_driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Nunca notificar al propio solicitante
  IF v_driver_id = NEW.passenger_id THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO v_passenger_name
  FROM public.profiles p
  WHERE p.id = NEW.passenger_id;

  INSERT INTO public.notifications (user_id, type, title, message, related_trip_id, related_request_id)
  VALUES (
    v_driver_id,
    'request_created',
    'Nueva solicitud de viaje',
    COALESCE(v_passenger_name, 'Un pasajero') || ' solicitó un lugar en tu viaje.',
    NEW.trip_id,
    NEW.id
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_trip_request_created() IS
  'Trigger AFTER INSERT en trip_requests: notifica al conductor que un pasajero solicitó un lugar';

-- ------------------------------------------------------------
-- 4.2 Cambio de estado -> notifica a la CONTRAPARTE
--     accepted/rejected -> pasajero | cancelled -> conductor
--     (las RPC accept/reject/cancel ya validan quién puede cambiar el estado)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_trip_request_status_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver_id UUID;
  v_passenger_name TEXT;
  v_recipient UUID;
  v_type TEXT;
  v_title TEXT;
  v_message TEXT;
BEGIN
  -- Solo transiciones que salen de 'pending' hacia un estado final
  IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status IS NOT DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT t.driver_id INTO v_driver_id
  FROM public.trips t
  WHERE t.id = NEW.trip_id;

  IF v_driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' THEN
    v_recipient := NEW.passenger_id;
    v_type := 'request_accepted';
    v_title := 'Solicitud aceptada';
    v_message := 'Tu solicitud de viaje fue aceptada.';
  ELSIF NEW.status = 'rejected' THEN
    v_recipient := NEW.passenger_id;
    v_type := 'request_rejected';
    v_title := 'Solicitud rechazada';
    v_message := 'Tu solicitud de viaje fue rechazada.';
  ELSIF NEW.status = 'cancelled' THEN
    SELECT p.full_name INTO v_passenger_name
    FROM public.profiles p
    WHERE p.id = NEW.passenger_id;

    v_recipient := v_driver_id;
    v_type := 'request_cancelled';
    v_title := 'Solicitud cancelada';
    v_message := COALESCE(v_passenger_name, 'Un pasajero') || ' canceló su solicitud en tu viaje.';
  ELSE
    RETURN NEW;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, related_trip_id, related_request_id)
  VALUES (v_recipient, v_type, v_title, v_message, NEW.trip_id, NEW.id);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_trip_request_status_changed() IS
  'Trigger AFTER UPDATE OF status en trip_requests: notifica al pasajero (aceptada/rechazada) o al conductor (cancelada)';

-- ============================================================
-- 5. Triggers sobre public.trip_requests
--    No se tocan las RPC existentes: ellas solo hacen UPDATE del
--    status y estos triggers se disparan después.
-- ============================================================
DROP TRIGGER IF EXISTS notify_trip_request_created ON public.trip_requests;
CREATE TRIGGER notify_trip_request_created
  AFTER INSERT ON public.trip_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_trip_request_created();

DROP TRIGGER IF EXISTS notify_trip_request_status_changed ON public.trip_requests;
CREATE TRIGGER notify_trip_request_status_changed
  AFTER UPDATE OF status ON public.trip_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_trip_request_status_changed();
