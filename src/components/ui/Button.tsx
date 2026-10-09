import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    variant = 'primary', 
    size = 'md', 
    fullWidth = false, 
    className = '', 
    children, 
    ...props 
  }, ref) => {
    // inline-flex + gap mantiene alineados los iconos y el texto de los botones.
    const baseStyles =
      'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-500 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99]';
    
    const variantStyles = {
      primary: 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.2)]',
      secondary: 'bg-teal-700 text-white hover:bg-teal-800 focus-visible:ring-teal-600',
      outline: 'bg-white border border-slate-300 text-slate-900 hover:border-teal-600 hover:text-teal-800 hover:bg-teal-50 focus-visible:ring-teal-500',
      ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
      danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
      accent: 'bg-teal-500 text-slate-950 hover:bg-teal-400 focus-visible:ring-teal-500',
    };
    
    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    };
    
    const widthStyle = fullWidth ? 'w-full' : '';
    
    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyle} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
