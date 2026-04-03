type BadgeVariant =
  | 'active' | 'inactive' | 'suspended' | 'setup' | 'error' | 'configured' | 'unconfigured'
  | 'trialing' | 'past_due' | 'paused' | 'cancelled';

const variantStyles: Record<BadgeVariant, string> = {
  active:        'bg-green-500/15 text-green-400 border border-green-500/30',
  inactive:      'bg-[#32576F]/30 text-[#7A9BAD] border border-[#32576F]/40',
  suspended:     'bg-red-500/15 text-red-400 border border-red-500/30',
  setup:         'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  error:         'bg-red-500/15 text-red-400 border border-red-500/30',
  configured:    'bg-green-500/15 text-green-400 border border-green-500/30',
  unconfigured:  'bg-[#32576F]/30 text-[#7A9BAD] border border-[#32576F]/40',
  trialing:      'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  past_due:      'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  paused:        'bg-[#32576F]/30 text-[#7A9BAD] border border-[#32576F]/40',
  cancelled:     'bg-red-500/15 text-red-400 border border-red-500/30',
};

const variantLabels: Record<string, string> = {
  active:        'Activo',
  inactive:      'Inactivo',
  suspended:     'Suspendido',
  setup:         'En setup',
  error:         'Error',
  configured:    'Configurado',
  unconfigured:  'Sin configurar',
  trialing:      'Prueba',
  past_due:      'Pago vencido',
  paused:        'Pausado',
  cancelled:     'Cancelado',
};

interface BadgeProps {
  variant?: BadgeVariant;
  label?: string;
  className?: string;
}

export function Badge({ variant = 'inactive', label, className = '' }: BadgeProps) {
  const style = variantStyles[variant] ?? variantStyles.inactive;
  const text = label ?? variantLabels[variant] ?? variant;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style} ${className}`}>
      {text}
    </span>
  );
}

export function statusToBadgeVariant(status: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    active: 'active',
    activo: 'active',
    inactive: 'inactive',
    inactivo: 'inactive',
    suspended: 'suspended',
    suspendido: 'suspended',
    setup: 'setup',
    error: 'error',
    configured: 'configured',
    unconfigured: 'unconfigured',
    trialing: 'trialing',
    past_due: 'past_due',
    paused: 'paused',
    cancelled: 'cancelled',
  };
  return map[status.toLowerCase()] ?? 'inactive';
}
