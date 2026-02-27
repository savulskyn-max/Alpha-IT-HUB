import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

const paddingStyles = {
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={`bg-[#1E3340] border border-[#32576F] rounded-2xl ${paddingStyles[padding]} ${className}`}
    >
      {children}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}

export function KpiCard({ label, value, hint, accent = false }: KpiCardProps) {
  return (
    <Card>
      <p className="text-[#7A9BAD] text-xs font-medium uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-3xl font-bold mb-1 ${accent ? 'text-[#ED7C00]' : 'text-white'}`}>
        {value}
      </p>
      {hint && <p className="text-[#CDD4DA] text-xs">{hint}</p>}
    </Card>
  );
}
