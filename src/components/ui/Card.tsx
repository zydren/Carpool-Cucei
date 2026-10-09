import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  /** Acción al hacer clic en la tarjeta (opcional). */
  onClick?: () => void;
}
const Card = ({ children, className = '', hover = false, onClick }: CardProps) => {
  const baseStyles =
    'bg-white rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.05)]';
  const hoverStyles = hover
    ? 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(15,23,42,0.1)] hover:border-teal-500/40'
    : '';
  
  return (
    <div className={`${baseStyles} ${hoverStyles} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
};

export default Card;
