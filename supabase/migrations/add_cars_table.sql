-- ============================================================
-- Migración: Registro de autos de conductores
-- - Tabla cars con datos del vehículo y del seguro
-- - Bucket de Storage para fotos de cobertura y póliza
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabla cars
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,                     -- Marca
  model TEXT NOT NULL,                     -- Modelo
  year INTEGER NOT NULL CHECK (year >= 1980 AND year <= 2100),
  color TEXT NOT NULL,                     -- Color
  plate TEXT NOT NULL,                     -- Placas / matrícula
  seats INTEGER NOT NULL DEFAULT 4 CHECK (seats >= 1 AND seats <= 12),
  insurance_company TEXT NOT NULL,         -- Aseguradora
  insurance_policy_number TEXT NOT NULL,   -- Número de póliza
  coverage_photo_url TEXT,                 -- Foto de la cobertura del seguro
  policy_photo_url TEXT,                   -- Foto de la póliza del seguro
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.cars IS 'Autos registrados por conductores';

DROP TRIGGER IF EXISTS update_cars_updated_at ON public.cars;
CREATE TRIGGER update_cars_updated_at
  BEFORE UPDATE ON public.cars
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_cars_owner_id ON public.cars(owner_id);

-- ------------------------------------------------------------
-- 2. RLS cars: cada usuario solo puede ver y gestionar sus autos
-- ------------------------------------------------------------
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cars" ON public.cars;
CREATE POLICY "Users can view own cars"
  ON public.cars FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can insert own cars" ON public.cars;
CREATE POLICY "Users can insert own cars"
  ON public.cars FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update own cars" ON public.cars;
CREATE POLICY "Users can update own cars"
  ON public.cars FOR UPDATE
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete own cars" ON public.cars;
CREATE POLICY "Users can delete own cars"
  ON public.cars FOR DELETE
  USING (auth.uid() = owner_id);

-- ------------------------------------------------------------
-- 3. Bucket de Storage para las fotos del seguro
--    (público para mostrar las imágenes; solo el dueño sube/borra)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('car-insurance', 'car-insurance', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Owner can upload car insurance photos" ON storage.objects;
CREATE POLICY "Owner can upload car insurance photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'car-insurance' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Anyone can view car insurance photos" ON storage.objects;
CREATE POLICY "Anyone can view car insurance photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'car-insurance');

DROP POLICY IF EXISTS "Owner can update car insurance photos" ON storage.objects;
CREATE POLICY "Owner can update car insurance photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'car-insurance' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Owner can delete car insurance photos" ON storage.objects;
CREATE POLICY "Owner can delete car insurance photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'car-insurance' AND auth.uid() = owner);