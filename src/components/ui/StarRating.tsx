interface StarRatingProps {
  /** Valor actual (0 = ninguna seleccionada). */
  value: number;
  /** Si se provee, las estrellas son interactivas y llaman onChange. */
  onChange?: (value: number) => void;
  /** Solo visualización (no interactivo). */
  readOnly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

/**
 * Selector / visualizador de calificación de 1 a 5 estrellas.
 * Reutilizable: funciona en modo "solo lectura" (mostrar promedio)
 * o como selector interactivo.
 */
const StarRating = ({
  value,
  onChange,
  readOnly = false,
  size = 'md',
}: StarRatingProps) => {
  const stars = [1, 2, 3, 4, 5];

  return (
    <div
      className="flex items-center gap-1"
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={readOnly ? `Calificación ${value} de 5` : 'Calificación'}
    >
      {stars.map((star) => {
        const filled = star <= value;
        const starIcon = (
          <svg
            className={`${sizeClasses[size]} ${
              filled ? 'text-yellow-400' : 'text-gray-300'
            }`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.97a1 1 0 00.95.691h4.155c.969 0 1.371 1.24.588 1.81l-3.361 2.44a1 1 0 00-.363 1.118l1.286 3.97c.3.92-.755 1.688-1.54 1.118l-3.361-2.44a1 1 0 00-1.175 0l-3.361 2.44c-.784.57-1.838-.198-1.539-1.118l1.286-3.97a1 1 0 00-.363-1.118L2.924 9.398c-.783-.57-.38-1.81.589-1.81h4.154a1 1 0 00.95-.691l1.286-3.97z" />
          </svg>
        );

        if (readOnly) {
          return <span key={star}>{starIcon}</span>;
        }

        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === value}
            aria-label={`${star} estrellas`}
            onClick={() => onChange?.(star)}
            className="focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded hover:scale-110 transition-transform"
          >
            {starIcon}
          </button>
        );
      })}
    </div>
  );
};

export default StarRating;