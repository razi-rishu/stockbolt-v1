import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg';
}

const paddingMap = { sm: 'p-4', md: 'p-6', lg: 'p-8' };

export function Card({ padding = 'md', children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-card border border-border-subtle bg-surface-card shadow-card ${paddingMap[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
