import { useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { TextAreaField } from './ui/FormField';
import StarRating from './ui/StarRating';

interface RatingModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  ratedPersonName: string;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (rating: number, comment: string) => void;
}

/**
 * Modal genérico para emitir una calificación (1-5 estrellas + comentario
 * opcional). Se usa tanto para calificar al conductor como a pasajeros.
 *
 * El formulario siempre inicia en blanco: los padres montan el modal de forma
 * condicional (solo cuando hay un destino de calificación), por lo que cada
 * apertura crea un estado nuevo sin efectos secundarios.
 */
const RatingModal = ({
  open,
  onClose,
  title,
  ratedPersonName,
  isSubmitting,
  error,
  onSubmit,
}: RatingModalProps) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const canSubmit = rating >= 1 && rating <= 5 && !isSubmitting;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div>
        <p className="text-sm text-gray-600 mb-4">
          Calificando a{' '}
          <span className="font-semibold text-gray-900">{ratedPersonName}</span>
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tu calificación
          </label>
          <StarRating value={rating} onChange={setRating} size="lg" />
          {rating === 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Selecciona de 1 a 5 estrellas
            </p>
          )}
        </div>

        <TextAreaField
          label="Comentario (opcional)"
          name="ratingComment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Cuéntale cómo fue la experiencia..."
          rows={3}
          maxLength={1000}
          disabled={isSubmitting}
        />

        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={() => onSubmit(rating, comment)}
          >
            {isSubmitting ? 'Guardando...' : 'Guardar calificación'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default RatingModal;