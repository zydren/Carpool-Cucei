import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

const Card = ({ children, className = '', hover = false }: CardProps) => {
  const baseStyles = 'bg-white rounded-xl shadow-md';
  const hoverStyles = hover ? 'hover:shadow-xl transition-shadow duration-300' : '';
  
  return (
    <div className={`${baseStyles} ${hoverStyles} ${className}`}>
      {children}
    </div>
  );
};

export default Card;
