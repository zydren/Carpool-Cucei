import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Armchair, Car as CarIcon, Palette, Pencil, ShieldCheck, SquareParking, Trash2 } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { getCurrentUser } from '../services/authService';
import {
  getMyCars,
  createCar,
  updateCar,
  deleteCar,
  uploadCarPhoto,
  type Car,
  type CreateCarParams,
} from '../services/carService';

interface Notice {
  type: 'success' | 'error';
  text: string;
}

/**
 * Registro del auto del conductor.
 * Incluye los datos del vehículo y la carga de fotos de la cobertura
 * y de la póliza del seguro (almacenadas en Supabase Storage).
 */
const CarRegistrationPage = () => {
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [cars, setCars] = useState<Car[]>([]);
  const [editingCarId, setEditingCarId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    brand: '',
    model: '',
    year: '',
    color: '',
    plate: '',
    seats: '',
    insuranceCompany: '',
    insurancePolicyNumber: '',
  });
  const [coveragePhoto, setCoveragePhoto] = useState<File | null>(null);
  const [policyPhoto, setPolicyPhoto] = useState<File | null>(null);
  const [coveragePreview, setCoveragePreview] = useState<string | null>(null);
  const [policyPreview, setPolicyPreview] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;

        if (!user) {
          navigate('/login');
          return;
        }

        const myCars = await getMyCars();
        if (cancelled) return;

        setCars(myCars);
      } catch (err) {
        console.error('Error cargando autos:', err);
        if (!cancelled) {
          setErrors({ general: 'No se pudieron cargar tus autos. Intenta nuevamente.' });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const resetForm = () => {
    setFormData({
      brand: '',
      model: '',
      year: '',
      color: '',
      plate: '',
      seats: '',
      insuranceCompany: '',
      insurancePolicyNumber: '',
    });
    setCoveragePhoto(null);
    setPolicyPhoto(null);
    setCoveragePreview(null);
    setPolicyPreview(null);
    setErrors({});
    setEditingCarId(null);
  };

  const startEdit = (car: Car) => {
    setFormData({
      brand: car.brand,
      model: car.model,
      year: String(car.year),
      color: car.color,
      plate: car.plate,
      seats: String(car.seats),
      insuranceCompany: car.insurance_company,
      insurancePolicyNumber: car.insurance_policy_number,
    });
    setCoveragePhoto(null);
    setPolicyPhoto(null);
    setCoveragePreview(car.coverage_photo_url);
    setPolicyPreview(car.policy_photo_url);
    setNotice(null);
    setEditingCarId(car.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handlePhotoChange =
    (kind: 'coverage' | 'policy') => (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (kind === 'coverage') {
        setCoveragePhoto(file);
        setCoveragePreview(URL.createObjectURL(file));
      } else {
        setPolicyPhoto(file);
        setPolicyPreview(URL.createObjectURL(file));
      }
    };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.brand.trim()) {
      newErrors.brand = 'La marca es requerida';
    }
    if (!formData.model.trim()) {
      newErrors.model = 'El modelo es requerido';
    }
    if (!formData.year.trim()) {
      newErrors.year = 'El año es requerido';
    } else {
      const year = parseInt(formData.year);
      if (year < 1980 || year > new Date().getFullYear() + 1) {
        newErrors.year = 'Ingresa un año válido';
      }
    }
    if (!formData.color.trim()) {
      newErrors.color = 'El color es requerido';
    }
    if (!formData.plate.trim()) {
      newErrors.plate = 'Las placas son requeridas';
    }
    if (!formData.seats.trim()) {
      newErrors.seats = 'El número de asientos es requerido';
    } else {
      const seats = parseInt(formData.seats);
      if (seats < 1 || seats > 12) {
        newErrors.seats = 'Debe ser entre 1 y 12 asientos';
      }
    }
    if (!formData.insuranceCompany.trim()) {
      newErrors.insuranceCompany = 'La aseguradora es requerida';
    }
    if (!formData.insurancePolicyNumber.trim()) {
      newErrors.insurancePolicyNumber = 'El número de póliza es requerido';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);

    if (!validateForm()) {
      return;
    }

    setIsSaving(true);

    try {
      const editingCar = cars.find((c) => c.id === editingCarId);

      let coverageUrl = editingCar?.coverage_photo_url ?? null;
      if (coveragePhoto) {
        coverageUrl = await uploadCarPhoto(coveragePhoto);
      }

      let policyUrl = editingCar?.policy_photo_url ?? null;
      if (policyPhoto) {
        policyUrl = await uploadCarPhoto(policyPhoto);
      }

      const params: CreateCarParams = {
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        year: parseInt(formData.year),
        color: formData.color.trim(),
        plate: formData.plate.trim(),
        seats: parseInt(formData.seats),
        insurance_company: formData.insuranceCompany.trim(),
        insurance_policy_number: formData.insurancePolicyNumber.trim(),
        coverage_photo_url: coverageUrl,
        policy_photo_url: policyUrl,
      };

      if (editingCarId) {
        await updateCar(editingCarId, params);
        setNotice({ type: 'success', text: 'Auto actualizado correctamente.' });
      } else {
        await createCar(params);
        setNotice({
          type: 'success',
          text: 'Auto registrado correctamente. Ya puedes ofrecer viajes.',
        });
      }

      setCars(await getMyCars());
      resetForm();
    } catch (error: unknown) {
      console.error('Error guardando auto:', error);
      const message = error instanceof Error ? error.message : null;
      setErrors({
        general: message || 'No se pudo guardar el auto. Intenta nuevamente.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (car: Car) => {
    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar el auto "${car.brand} ${car.model} (${car.plate})"?`
    );
    if (!confirmed) return;

    try {
      await deleteCar(car.id);
      setCars((prev) => prev.filter((c) => c.id !== car.id));
      setNotice({ type: 'success', text: 'Auto eliminado.' });
    } catch (error: unknown) {
      console.error('Error eliminando auto:', error);
      const message = error instanceof Error ? error.message : null;
      setErrors({ general: message || 'No se pudo eliminar el auto.' });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando tus autos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <div className="pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-2">
              Mi Auto
            </h1>
            <p className="text-xl text-gray-600">
              Registra tu vehículo y los datos de tu seguro para poder ofrecer viajes.
            </p>
          </div>

          <Card className="p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              {editingCarId ? 'Editar auto' : 'Registrar auto'}
            </h2>

            {notice && (
              <div className={`mb-6 p-4 rounded-lg border ${notice.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                <p className="text-sm">{notice.text}</p>
              </div>
            )}

            {errors.general && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{errors.general}</p>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <FormField
                  label="Marca"
                  name="brand"
                  type="text"
                  value={formData.brand}
                  onChange={handleChange}
                  placeholder="Ej: Toyota"
                  error={errors.brand}
                />
                <FormField
                  label="Modelo"
                  name="model"
                  type="text"
                  value={formData.model}
                  onChange={handleChange}
                  placeholder="Ej: Corolla"
                  error={errors.model}
                />
                <FormField
                  label="Año"
                  name="year"
                  type="number"
                  min="1980"
                  max="2100"
                  value={formData.year}
                  onChange={handleChange}
                  placeholder="Ej: 2019"
                  error={errors.year}
                />
                <FormField
                  label="Color"
                  name="color"
                  type="text"
                  value={formData.color}
                  onChange={handleChange}
                  placeholder="Ej: Blanco"
                  error={errors.color}
                />
                <FormField
                  label="Placas / Matrícula"
                  name="plate"
                  type="text"
                  value={formData.plate}
                  onChange={handleChange}
                  placeholder="Ej: GDL-123-AB"
                  error={errors.plate}
                />
                <FormField
                  label="Número de asientos"
                  name="seats"
                  type="number"
                  min="1"
                  max="12"
                  value={formData.seats}
                  onChange={handleChange}
                  placeholder="Ej: 4"
                  error={errors.seats}
                />
                <FormField
                  label="Aseguradora"
                  name="insuranceCompany"
                  type="text"
                  value={formData.insuranceCompany}
                  onChange={handleChange}
                  placeholder="Ej: GNP, Mapfre, AXA..."
                  error={errors.insuranceCompany}
                />
                <FormField
                  label="Número de póliza"
                  name="insurancePolicyNumber"
                  type="text"
                  value={formData.insurancePolicyNumber}
                  onChange={handleChange}
                  placeholder="Número de tu póliza"
                  error={errors.insurancePolicyNumber}
                />
              </div>

              {/* SENTINEL-JSX1 */}

              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Documentos del seguro
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Foto de la cobertura
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoChange('coverage')}
                      className="block w-full text-sm text-gray-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Sube una foto clara de la cobertura de tu seguro.
                    </p>
                    {coveragePreview && (
                      <img
                        src={coveragePreview}
                        alt="Previsualización de la cobertura"
                        className="mt-2 w-24 h-24 object-cover rounded-lg border"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Foto de la póliza
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoChange('policy')}
                      className="block w-full text-sm text-gray-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Sube una foto de tu póliza vigente.
                    </p>
                    {policyPreview && (
                      <img
                        src={policyPreview}
                        alt="Previsualización de la póliza"
                        className="mt-2 w-24 h-24 object-cover rounded-lg border"
                      />
                    )}
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                disabled={isSaving}
                className="mt-2"
              >
                {isSaving ? 'Guardando...' : (editingCarId ? 'Guardar cambios' : 'Registrar auto')}
              </Button>

              {editingCarId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetForm}
                  className="mt-3"
                >
                  Cancelar edición
                </Button>
              )}
            </form>
          </Card>

          {/* SENTINEL-JSX2 */}

          <div className="mt-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Mis autos ({cars.length})
            </h2>

            {cars.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="mb-2">
                  <CarIcon className="w-10 h-10 mx-auto text-gray-400" aria-hidden="true" />
                </p>
                <p className="text-gray-600">
                  Aún no tienes autos registrados. Registra uno para poder ofrecer viajes.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {cars.map((car) => (
                  <Card key={car.id} className="p-5">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900">
                          {car.brand} {car.model}{' '}
                          <span className="text-sm text-gray-500">({car.year})</span>
                        </h3>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mt-1">
                          <span className="inline-flex items-center gap-1.5">
                            <Palette className="w-4 h-4" aria-hidden="true" />
                            {car.color}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <SquareParking className="w-4 h-4" aria-hidden="true" />
                            {car.plate}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Armchair className="w-4 h-4" aria-hidden="true" />
                            {car.seats} asientos
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                          {car.insurance_company} · Póliza {car.insurance_policy_number}
                        </p>
                        <div className="flex gap-3 mt-2">
                          {car.coverage_photo_url && (
                            <a
                              href={car.coverage_photo_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-indigo-600 underline"
                            >
                              Ver cobertura
                            </a>
                          )}
                          {car.policy_photo_url && (
                            <a
                              href={car.policy_photo_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-indigo-600 underline"
                            >
                              Ver póliza
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button variant="outline" size="sm" onClick={() => startEdit(car)}>
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                          Editar
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => handleDelete(car)}>
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default CarRegistrationPage;