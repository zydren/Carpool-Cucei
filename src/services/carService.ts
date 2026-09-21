import { supabase } from '../lib/supabase';

export interface Car {
  id: string;
  owner_id: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  seats: number;
  insurance_company: string;
  insurance_policy_number: string;
  coverage_photo_url: string | null;
  policy_photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCarParams {
  brand: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  seats: number;
  insurance_company: string;
  insurance_policy_number: string;
  coverage_photo_url: string | null;
  policy_photo_url: string | null;
}

const CAR_PHOTOS_BUCKET = 'car-insurance';

/** Obtiene los autos registrados por el usuario autenticado (RLS: solo los propios). */
export const getMyCars = async (): Promise<Car[]> => {
  const { data, error } = await supabase
    .from('cars')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error getting my cars:', error);
    throw error;
  }

  return (data || []) as Car[];
};

/** Registra un auto nuevo para el usuario autenticado. */
export const createCar = async (params: CreateCarParams): Promise<Car> => {
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Usuario no autenticado');
  }

  const { data, error } = await supabase
    .from('cars')
    .insert({
      ...params,
      owner_id: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating car:', error);
    throw error;
  }

  return data as Car;
};

/** Actualiza un auto propio. */
export const updateCar = async (
  carId: string,
  params: CreateCarParams
): Promise<Car> => {
  const { data, error } = await supabase
    .from('cars')
    .update(params)
    .eq('id', carId)
    .select()
    .single();

  if (error) {
    console.error('Error updating car:', error);
    throw error;
  }

  return data as Car;
};

/** Elimina un auto propio. */
export const deleteCar = async (carId: string): Promise<void> => {
  const { error } = await supabase.from('cars').delete().eq('id', carId);

  if (error) {
    console.error('Error deleting car:', error);
    throw error;
  }
};

/**
 * Sube una foto del seguro (cobertura o póliza) al bucket "car-insurance"
 * y devuelve su URL pública.
 */
export const uploadCarPhoto = async (file: File): Promise<string> => {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}-${safeName}`;

  const { error } = await supabase.storage
    .from(CAR_PHOTOS_BUCKET)
    .upload(filePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    console.error('Error uploading car photo:', error);
    throw error;
  }

  const { data: urlData } = supabase.storage
    .from(CAR_PHOTOS_BUCKET)
    .getPublicUrl(filePath);

  return urlData.publicUrl;
};