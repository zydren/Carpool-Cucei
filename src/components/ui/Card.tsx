import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  /** Acción al hacer clic en la tarjeta (opcional). */
  onClick?: () => void;
}
const Card = ({ children, className = '', hover = false, onClick }: CardProps) => {
  const baseStyles = 'bg-white rounded-xl shadow-md';
  const hoverStyles = hover ? 'hover:shadow-xl transition-shadow duration-300' : '';
  
  return (
    <div className={`${baseStyles} ${hoverStyles} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
};

export default Card;
