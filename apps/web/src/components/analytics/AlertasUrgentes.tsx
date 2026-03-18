'use client';

import type { StockAnalysisAlerta } from '@/lib/api';

// ── Config per tipo ───────────────────────────────────────────────────────────

interface AlertaStyle {
  borderColor: string;
  bgColor: string;
  badgeBg: string;
  badgeColor: string;
  label: string;
  Icon: () => JSX.Element;
}

function getAlertaStyle(tipo: string): AlertaStyle {
  switch (tipo) {
    case 'critico':
      return {
        borderColor: '#DC2626',
        bgColor: 'rgba(220,38,38,0.07)',
        badgeBg: 'rgba(220,38,38,0.15)',
        badgeColor: '#EF4444',
        label: 'CRÍTICO',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        ),
      };
    case 'temporada':
      return {
        borderColor: '#ED7C00',
        bgColor: 'rgba(237,124,0,0.07)',
        badgeBg: 'rgba(237,124,0,0.15)',
        badgeColor: '#ED7C00',
        label: 'TEMPORADA',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
          </svg>
        ),
      };
    case 'exceso':
      return {
        borderColor: '#2563EB',
        bgColor: 'rgba(37,99,235,0.07)',
        badgeBg: 'rgba(37,99,235,0.15)',
        badgeColor: '#60A5FA',
        label: 'EXCESO',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z" />
          </svg>
        ),
      };
    default: // bajo
      return {
        borderColor: '#D97706',
        bgColor: 'rgba(217,119,6,0.07)',
        badgeBg: 'rgba(217,119,6,0.15)',
        badgeColor: '#FBBF24',
        label: 'BAJO',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v4.59L7.3 9.24a.75.75 0 00-1.1 1.02l3.25 3.5a.75.75 0 001.1 0l3.25-3.5a.75.75 0 10-1.1-1.02l-1.95 2.1V6.75z" clipRule="evenodd" />
          </svg>
        ),
      };
  }
}

// ── Alerta card ───────────────────────────────────────────────────────────────

interface AlertaCardProps {
  alerta: StockAnalysisAlerta;
  onAnalisis?: (producto: string) => void;
  onCalendario?: () => void;
  onMultilocal?: () => void;
  hasMultilocal?: boolean;
}

function AlertaCard({ alerta, onAnalisis, onCalendario, onMultilocal, hasMultilocal }: AlertaCardProps) {
  const style = getAlertaStyle(alerta.tipo);
  const { Icon } = style;

  // Determine which tab this alert routes to
  const handleClick = () => {
    if (alerta.tipo === 'exceso' && hasMultilocal && onMultilocal) {
      onMultilocal();
    } else if ((alerta.tipo === 'critico' || alerta.tipo === 'bajo') && onCalendario) {
      onCalendario();
    } else if (onAnalisis) {
      onAnalisis(alerta.producto);
    }
  };

  const isClickable = !!(onAnalisis || onCalendario || onMultilocal);

  // Label for the action link based on routing
  const actionTarget =
    alerta.tipo === 'exceso' && hasMultilocal ? 'Ver transferencias →'
    : alerta.tipo === 'critico' || alerta.tipo === 'bajo' ? 'Ver calendario →'
    : 'Ver análisis →';

  return (
    <div
      onClick={isClickable ? handleClick : undefined}
      className={`flex flex-col gap-2 rounded-xl p-4 min-w-[200px] flex-1 ${isClickable ? 'cursor-pointer transition-opacity hover:opacity-80' : ''}`}
      style={{
        background: style.bgColor,
        border: `1px solid ${style.borderColor}55`,
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      {/* Badge + icon */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-full"
          style={{ background: style.badgeBg, color: style.badgeColor }}
        >
          {style.label}
        </span>
        <span style={{ color: style.badgeColor }}>
          <Icon />
        </span>
      </div>

      {/* Product name */}
      <p className="text-white font-semibold text-sm leading-tight line-clamp-2">
        {alerta.producto}
        {alerta.modelo && (
          <span className="text-[#7A9BAD] font-normal"> · {alerta.modelo}</span>
        )}
      </p>

      {/* Message */}
      <p className="text-[#CDD4DA] text-xs leading-snug line-clamp-2">{alerta.mensaje}</p>

      {/* Action */}
      <div className="flex items-center justify-between mt-auto pt-1 border-t gap-2" style={{ borderColor: `${style.borderColor}33` }}>
        <p className="text-xs font-semibold" style={{ color: style.badgeColor }}>
          → {alerta.accion}
        </p>
        {isClickable && (
          <span className="text-[10px] font-semibold text-[#7A9BAD] whitespace-nowrap">
            {actionTarget}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function AlertaSkeleton() {
  return (
    <div className="flex gap-3">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="flex-1 min-w-[180px] h-36 rounded-xl animate-pulse"
          style={{ background: 'rgba(50,87,111,0.2)', border: '1px solid rgba(50,87,111,0.3)' }}
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface AlertasUrgentesProps {
  alertas: StockAnalysisAlerta[] | null;
  loading?: boolean;
  onAnalisis?: (producto: string) => void;
  onCalendario?: () => void;
  onMultilocal?: () => void;
  hasMultilocal?: boolean;
}

export function AlertasUrgentes({ alertas, loading, onAnalisis, onCalendario, onMultilocal, hasMultilocal }: AlertasUrgentesProps) {
  if (loading) return <AlertaSkeleton />;
  if (!alertas || alertas.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Acciones urgentes del día</h3>
          <p className="text-[#7A9BAD] text-xs">Ordenadas por prioridad · click para navegar</p>
        </div>
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold animate-pulse"
          style={{ background: 'rgba(220,38,38,0.2)', color: '#EF4444' }}
        >
          {alertas.length}
        </span>
      </div>

      <div className="flex gap-3 flex-wrap sm:flex-nowrap overflow-x-auto pb-1">
        {alertas.map((a, i) => (
          <AlertaCard
            key={i}
            alerta={a}
            onAnalisis={onAnalisis}
            onCalendario={onCalendario}
            onMultilocal={onMultilocal}
            hasMultilocal={hasMultilocal}
          />
        ))}
      </div>
    </div>
  );
}
