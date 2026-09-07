-- ============================================
-- CARPOOL UNIVERSITARIO - ESTRUCTURA DE BASE DE DATOS
-- Adaptado al frontend existente
-- ============================================

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLA: profiles
-- Información adicional de usuarios de Supabase Auth
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  university TEXT NOT NULL,
  phone TEXT NOT NULL,
  rating DECIMAL(3,2) DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
  total_ratings INTEGER DEFAULT 0 CHECK (total_ratings >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger para actualizar updated_at en profiles
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para crear profile automáticamente al registrar usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, university, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Usuario'),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'university', 'No especificada'),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- TABLA: trips
-- Viajes publicados por conductores
-- ============================================
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  origin_lat DOUBLE PRECISION,
  origin_lng DOUBLE PRECISION,
  route_distance_km DOUBLE PRECISION,
  route_duration_minutes INTEGER,
  date DATE NOT NULL,
  time TIME NOT NULL,
  seats_available INTEGER NOT NULL CHECK (seats_available > 0 AND seats_available <= 8),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger para actualizar updated_at en trips
CREATE TRIGGER update_trips_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Índices para trips
CREATE INDEX idx_trips_driver_id ON trips(driver_id);
CREATE INDEX idx_trips_date ON trips(date);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_origin_destination ON trips(origin, destination);

-- ============================================
-- TABLA: trip_requests
-- Solicitudes de pasajeros para unirse a viajes
-- ============================================
CREATE TABLE IF NOT EXISTS trip_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, passenger_id)
);

-- Trigger para actualizar updated_at en trip_requests
CREATE TRIGGER update_trip_requests_updated_at
  BEFORE UPDATE ON trip_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Índices para trip_requests
CREATE INDEX idx_trip_requests_trip_id ON trip_requests(trip_id);
CREATE INDEX idx_trip_requests_passenger_id ON trip_requests(passenger_id);
CREATE INDEX idx_trip_requests_status ON trip_requests(status);

-- ============================================
-- TABLA: ratings
-- Calificaciones entre usuarios después de viajes
-- ============================================
CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  rater_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rated_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (rater_id != rated_id),
  UNIQUE(trip_id, rater_id, rated_id)
);

-- Índices para ratings
CREATE INDEX idx_ratings_trip_id ON ratings(trip_id);
CREATE INDEX idx_ratings_rated_id ON ratings(rated_id);
CREATE INDEX idx_ratings_rater_id ON ratings(rater_id);

-- ============================================
-- TABLA: contact_messages
-- Mensajes del formulario de contacto
-- ============================================
CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para contact_messages
CREATE INDEX idx_contact_messages_created_at ON contact_messages(created_at);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Habilitar RLS en todas las tablas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLÍTICAS RLS: profiles
-- ============================================

-- Todos pueden ver perfiles públicos
CREATE POLICY "Profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (true);

-- Usuarios solo pueden actualizar su propio perfil
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================
-- POLÍTICAS RLS: trips
-- ============================================

-- Todos pueden ver viajes activos
CREATE POLICY "Active trips are viewable by everyone"
  ON trips FOR SELECT
  USING (status = 'active');

-- Conductores pueden ver sus propios viajes
CREATE POLICY "Drivers can view own trips"
  ON trips FOR SELECT
  USING (auth.uid() = driver_id);

-- Usuarios autenticados pueden crear viajes
CREATE POLICY "Authenticated users can create trips"
  ON trips FOR INSERT
  WITH CHECK (auth.uid() = driver_id);

-- Conductores pueden actualizar sus propios viajes
CREATE POLICY "Drivers can update own trips"
  ON trips FOR UPDATE
  USING (auth.uid() = driver_id);

-- Conductores pueden eliminar sus propios viajes
CREATE POLICY "Drivers can delete own trips"
  ON trips FOR DELETE
  USING (auth.uid() = driver_id);

-- ============================================
-- POLÍTICAS RLS: trip_requests
-- ============================================

-- Conductores pueden ver solicitudes de sus viajes
CREATE POLICY "Drivers can view trip requests for their trips"
  ON trip_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = trip_requests.trip_id
      AND trips.driver_id = auth.uid()
    )
  );

-- Pasajeros pueden ver sus propias solicitudes
CREATE POLICY "Passengers can view own trip requests"
  ON trip_requests FOR SELECT
  USING (auth.uid() = passenger_id);

-- Usuarios autenticados pueden crear solicitudes
CREATE POLICY "Authenticated users can create trip requests"
  ON trip_requests FOR INSERT
  WITH CHECK (auth.uid() = passenger_id);

-- Pasajeros pueden cancelar sus propias solicitudes
CREATE POLICY "Passengers can cancel own trip requests"
  ON trip_requests FOR UPDATE
  USING (auth.uid() = passenger_id AND status = 'pending');

-- Conductores pueden actualizar solicitudes de sus viajes
CREATE POLICY "Drivers can update trip requests for their trips"
  ON trip_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = trip_requests.trip_id
      AND trips.driver_id = auth.uid()
    )
  );

-- ============================================
-- POLÍTICAS RLS: ratings
-- ============================================

-- Todos pueden ver calificaciones
CREATE POLICY "Ratings are viewable by everyone"
  ON ratings FOR SELECT
  USING (true);

-- Usuarios autenticados pueden crear calificaciones
CREATE POLICY "Authenticated users can create ratings"
  ON ratings FOR INSERT
  WITH CHECK (auth.uid() = rater_id);

-- ============================================
-- POLÍTICAS RLS: contact_messages
-- ============================================

-- Solo administradores pueden ver mensajes de contacto
-- Por ahora, deshabilitado para desarrollo
CREATE POLICY "Contact messages are viewable by everyone"
  ON contact_messages FOR SELECT
  USING (true);

-- Todos pueden crear mensajes de contacto
CREATE POLICY "Everyone can create contact messages"
  ON contact_messages FOR INSERT
  WITH CHECK (true);

-- ============================================
-- FUNCIONES ÚTILES
-- ============================================

-- Función para actualizar rating de un usuario
CREATE OR REPLACE FUNCTION update_user_rating(user_id UUID)
RETURNS VOID AS $$
DECLARE
  avg_rating DECIMAL(3,2);
  total_count INTEGER;
BEGIN
  SELECT 
    COALESCE(AVG(rating), 0.00),
    COUNT(*)
  INTO avg_rating, total_count
  FROM ratings
  WHERE rated_id = user_id;

  UPDATE profiles
  SET rating = avg_rating,
      total_ratings = total_count
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar rating después de insertar calificación
CREATE OR REPLACE FUNCTION trigger_update_rating_after_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_user_rating(NEW.rated_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rating_after_rating_insert
  AFTER INSERT ON ratings
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_rating_after_insert();

-- ============================================
-- VISTAS ÚTILES
-- ============================================

-- Vista de viajes con información del conductor
CREATE OR REPLACE VIEW trips_with_driver AS
SELECT 
  t.*,
  p.full_name as driver_name,
  p.rating as driver_rating,
  p.university as driver_university,
  p.email as driver_email
FROM trips t
JOIN profiles p ON t.driver_id = p.id;

-- Vista de solicitudes con información del viaje y pasajero
CREATE OR REPLACE VIEW trip_requests_details AS
SELECT 
  tr.*,
  t.origin,
  t.destination,
  t.date,
  t.time,
  t.price,
  p.full_name as passenger_name,
  p.rating as passenger_rating,
  p.university as passenger_university
FROM trip_requests tr
JOIN trips t ON tr.trip_id = t.id
JOIN profiles p ON tr.passenger_id = p.id;
