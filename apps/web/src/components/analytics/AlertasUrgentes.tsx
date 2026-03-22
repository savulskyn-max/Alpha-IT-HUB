'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { StockAnalysisAlerta, OrdenCalendario } from '@/lib/api';

// ── Extended alert with optional calendar order linkage ───────────────────────

interface LocalAlerta extends StockAnalysisAlerta {
  orden_id?: number;
}

// ── localStorage dismiss logic ────────────────────────────────────────────────

const STORAGE_KEY = 'alertas_resueltas';

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date: string; keys: string[] };
    if (parsed.date !== getTodayStr()) return new Set(); // reset next day
    return new Set(parsed.keys);
  } catch { return new Set(); }
}

function saveDismissed(keys: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: getTodayStr(), keys: [...keys] }));
}

function alertaKey(a: LocalAlerta): string {
  return a.orden_id != null ? `cal_${a.orden_id}` : `stock_${a.tipo}_${a.producto}`;
}

// ── Build calendar alerts from OrdenCompraPlan orders ────────────────────────

function buildCalendarAlertas(ordenes: OrdenCalendario[]): LocalAlerta[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result: LocalAlerta[] = [];

  for (const o of ordenes) {
    if (!o.id) continue; // skip motor suggestions (no saved ID)

    const emision = new Date(o.fecha_emision + 'T00:00:00');
    const llegada = o.fecha_llegada ? new Date(o.fecha_llegada + 'T00:00:00') : null;
    const diasEmision = Math.round((emision.getTime() - today.getTime()) / 86400000);
    const diasLlegada = llegada != null ? Math.round((llegada.getTime() - today.getTime()) / 86400000) : null;

    // Compra próxima: planificada/confirmada + emision in next 7 days
    if ((o.estado === 'planificada' || o.estado === 'confirmada') && diasEmision >= 0 && diasEmision <= 7) {
      const en = diasEmision === 0 ? 'hoy' : `en ${diasEmision} día${diasEmision === 1 ? '' : 's'}`;
      result.push({
        tipo: 'compra_proxima',
        producto: o.nombre,
        modelo: null,
        mensaje: `📦 Compra programada ${en}`,
        accion: 'Preparar orden',
        prioridad: diasEmision <= 2 ? 1 : 2,
        orden_id: o.id,
      });
    }

    // Compra atrasada: planificada/confirmada + emision already past
    if ((o.estado === 'planificada' || o.estado === 'confirmada') && diasEmision < 0) {
      const hace = -diasEmision;
      result.push({
        tipo: 'compra_atrasada',
        producto: o.nombre,
        modelo: null,
        mensaje: `⚠ Compra atrasada ${hace} día${hace === 1 ? '' : 's'}`,
        accion: 'Emitir o cancelar',
        prioridad: 0,
        orden_id: o.id,
      });
    }

    // Llegada próxima: ordenada + fecha_llegada in next 7 days
    if (o.estado === 'ordenada' && diasLlegada != null && diasLlegada >= 0 && diasLlegada <= 7) {
      const en = diasLlegada === 0 ? 'hoy' : `en ${diasLlegada} día${diasLlegada === 1 ? '' : 's'}`;
      result.push({
        tipo: 'llegada_proxima',
        producto: o.nombre,
        modelo: null,
        mensaje: `📬 Llegada esperada ${en}`,
        accion: 'Preparar recepción',
        prioridad: 1,
        orden_id: o.id,
      });
    }

    // Llegada atrasada: ordenada + fecha_llegada already past
    if (o.estado === 'ordenada' && diasLlegada != null && diasLlegada < 0) {
      const hace = -diasLlegada;
      result.push({
        tipo: 'llegada_atrasada',
        producto: o.nombre,
        modelo: null,
        mensaje: `⚠ Pedido debería haber llegado hace ${hace} día${hace === 1 ? '' : 's'}`,
        accion: 'Consultar proveedor',
        prioridad: 0,
        orden_id: o.id,
      });
    }
  }

  return result;
}

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
        borderColor: '#DC2626', bgColor: 'rgba(220,38,38,0.07)',
        badgeBg: 'rgba(220,38,38,0.15)', badgeColor: '#EF4444', label: 'CRÍTICO',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        ),
      };
    case 'temporada':
      return {
        borderColor: '#ED7C00', bgColor: 'rgba(237,124,0,0.07)',
        badgeBg: 'rgba(237,124,0,0.15)', badgeColor: '#ED7C00', label: 'TEMPORADA',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
          </svg>
        ),
      };
    case 'exceso':
      return {
        borderColor: '#2563EB', bgColor: 'rgba(37,99,235,0.07)',
        badgeBg: 'rgba(37,99,235,0.15)', badgeColor: '#60A5FA', label: 'EXCESO',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z" />
          </svg>
        ),
      };
    case 'liquidacion':
      return {
        borderColor: '#7C3AED', bgColor: 'rgba(124,58,237,0.07)',
        badgeBg: 'rgba(124,58,237,0.15)', badgeColor: '#A78BFA', label: 'LIQUIDAR',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M17.721 1.599a.75.75 0 01.279.584v11.29a2.25 2.25 0 01-1.774 2.198l-2.041.442a2.216 2.216 0 01-.938-4.333l2.662-.576V6.112l-8 1.73v7.306a2.25 2.25 0 01-1.774 2.198l-2.041.442a2.216 2.216 0 01-.938-4.333l2.662-.576V5.25a.75.75 0 01.591-.733l9.5-2.054a.75.75 0 01.812.136z" clipRule="evenodd" />
          </svg>
        ),
      };
    case 'compra_proxima':
      return {
        borderColor: '#0891B2', bgColor: 'rgba(8,145,178,0.07)',
        badgeBg: 'rgba(8,145,178,0.15)', badgeColor: '#22D3EE', label: 'COMPRA',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M1 1.75A.75.75 0 011.75 1h1.628a1.75 1.75 0 011.734 1.51L5.43 3h8.57A1.75 1.75 0 0115.768 5.5l-.196 1.75a.75.75 0 01-.748.676H5.364l.281 2h8.105a.75.75 0 010 1.5H4.75a.75.75 0 01-.74-.627L3.067 4.5H1.75A.75.75 0 011 3.75v-2zM6 15.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15.5 17a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
          </svg>
        ),
      };
    case 'compra_atrasada':
      return {
        borderColor: '#DC2626', bgColor: 'rgba(220,38,38,0.07)',
        badgeBg: 'rgba(220,38,38,0.15)', badgeColor: '#EF4444', label: 'ATRASADA',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        ),
      };
    case 'llegada_proxima':
      return {
        borderColor: '#16A34A', bgColor: 'rgba(22,163,74,0.07)',
        badgeBg: 'rgba(22,163,74,0.15)', badgeColor: '#4ADE80', label: 'LLEGADA',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.114A28.897 28.897 0 003.105 2.289z" />
          </svg>
        ),
      };
    case 'llegada_atrasada':
      return {
        borderColor: '#D97706', bgColor: 'rgba(217,119,6,0.07)',
        badgeBg: 'rgba(217,119,6,0.15)', badgeColor: '#FBBF24', label: 'DEMORADA',
        Icon: () => (
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v4.59L7.3 9.24a.75.75 0 00-1.1 1.02l3.25 3.5a.75.75 0 001.1 0l3.25-3.5a.75.75 0 10-1.1-1.02l-1.95 2.1V6.75z" clipRule="evenodd" />
          </svg>
        ),
      };
    default: // bajo
      return {
        borderColor: '#D97706', bgColor: 'rgba(217,119,6,0.07)',
        badgeBg: 'rgba(217,119,6,0.15)', badgeColor: '#FBBF24', label: 'BAJO',
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
  alerta: LocalAlerta;
  onDismiss: () => void;
  onAnalisis?: (producto: string) => void;
  onCalendario?: () => void;
  onMultilocal?: () => void;
  hasMultilocal?: boolean;
  tenantId?: string;
}

function AlertaCard({ alerta, onDismiss, onAnalisis, onCalendario, onMultilocal, hasMultilocal, tenantId }: AlertaCardProps) {
  const style = getAlertaStyle(alerta.tipo);
  const { Icon } = style;
  const isArrivalAlert = alerta.tipo === 'llegada_proxima' || alerta.tipo === 'llegada_atrasada';
  const [marking, setMarking] = useState(false);

  const handleClick = () => {
    const calTypes = ['compra_proxima', 'compra_atrasada', 'llegada_proxima', 'llegada_atrasada'];
    if (alerta.tipo === 'exceso' && hasMultilocal && onMultilocal) {
      onMultilocal();
    } else if ((alerta.tipo === 'critico' || alerta.tipo === 'bajo' || calTypes.includes(alerta.tipo)) && onCalendario) {
      onCalendario();
    } else if (onAnalisis) {
      onAnalisis(alerta.producto);
    }
  };

  const isClickable = !!(onAnalisis || onCalendario || onMultilocal);

  const actionTarget =
    alerta.tipo === 'exceso' && hasMultilocal ? 'Ver transferencias →'
    : alerta.tipo === 'liquidacion' ? 'Ver análisis → Liquidación'
    : ['compra_proxima', 'compra_atrasada', 'llegada_proxima', 'llegada_atrasada', 'critico', 'bajo'].includes(alerta.tipo) ? 'Ver calendario →'
    : 'Ver análisis →';

  const handleMarcarRecibida = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!alerta.orden_id || !tenantId || marking) return;
    setMarking(true);
    try {
      await api.analytics.updateCalendarOrder(tenantId, alerta.orden_id, { estado: 'recibida' });
      onDismiss();
    } catch {
      setMarking(false);
    }
  };

  return (
    <div
      onClick={isClickable ? handleClick : undefined}
      className={`flex flex-col gap-2 rounded-xl p-4 min-w-[200px] flex-1 relative ${isClickable ? 'cursor-pointer transition-opacity hover:opacity-80' : ''}`}
      style={{
        background: style.bgColor,
        border: `1px solid ${style.borderColor}55`,
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      {/* Dismiss ✓ button */}
      <button
        onClick={e => { e.stopPropagation(); onDismiss(); }}
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold opacity-40 hover:opacity-100 transition-opacity"
        style={{ background: style.badgeBg, color: style.badgeColor }}
        title="Marcar como resuelta (se oculta hasta mañana)"
      >
        ✓
      </button>

      {/* Badge + icon */}
      <div className="flex items-center justify-between gap-2 pr-6">
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

      {/* "Marcar recibida" button for arrival alerts */}
      {isArrivalAlert && alerta.orden_id && tenantId && (
        <button
          onClick={handleMarcarRecibida}
          disabled={marking}
          className="mt-1 py-1 px-3 rounded-lg text-[11px] font-semibold transition-opacity text-left"
          style={{ background: style.badgeBg, color: style.badgeColor, opacity: marking ? 0.6 : 1 }}
        >
          {marking ? 'Guardando…' : '✓ Marcar recibida'}
        </button>
      )}

      {/* Action footer */}
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
  tenantId?: string;
  onAnalisis?: (producto: string) => void;
  onCalendario?: () => void;
  onMultilocal?: () => void;
  hasMultilocal?: boolean;
}

export function AlertasUrgentes({
  alertas, loading, tenantId,
  onAnalisis, onCalendario, onMultilocal, hasMultilocal,
}: AlertasUrgentesProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [calendarAlertas, setCalendarAlertas] = useState<LocalAlerta[]>([]);

  // Load dismissed keys from localStorage (client-side only)
  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  // Fetch calendar orders and build alerts
  useEffect(() => {
    if (!tenantId) return;
    api.analytics.stockCalendar(tenantId)
      .then(res => setCalendarAlertas(buildCalendarAlertas(res.ordenes)))
      .catch(() => {}); // graceful: show only stock alerts if calendar fetch fails
  }, [tenantId]);

  const dismiss = useCallback((key: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(key);
      saveDismissed(next);
      return next;
    });
  }, []);

  if (loading) return <AlertaSkeleton />;

  const stockAlertas: LocalAlerta[] = (alertas ?? []).map(a => ({ ...a }));
  const allAlertas = [...stockAlertas, ...calendarAlertas]
    .filter(a => !dismissed.has(alertaKey(a)))
    .sort((a, b) => a.prioridad - b.prioridad);

  if (allAlertas.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Acciones urgentes del día</h3>
          <p className="text-[#7A9BAD] text-xs">Ordenadas por prioridad · click para navegar · ✓ para resolver</p>
        </div>
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold animate-pulse"
          style={{ background: 'rgba(220,38,38,0.2)', color: '#EF4444' }}
        >
          {allAlertas.length}
        </span>
      </div>

      <div className="flex gap-3 flex-wrap sm:flex-nowrap overflow-x-auto pb-1">
        {allAlertas.map((a, i) => (
          <AlertaCard
            key={`${alertaKey(a)}_${i}`}
            alerta={a}
            onDismiss={() => dismiss(alertaKey(a))}
            onAnalisis={onAnalisis}
            onCalendario={onCalendario}
            onMultilocal={onMultilocal}
            hasMultilocal={hasMultilocal}
            tenantId={tenantId}
          />
        ))}
      </div>
    </div>
  );
}
