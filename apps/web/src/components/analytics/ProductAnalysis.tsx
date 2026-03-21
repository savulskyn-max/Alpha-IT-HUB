'use client';

import { useCallback, useEffect, useState } from 'react';
import ProductSelector from './ProductSelector';
import DemandForecast from './DemandForecast';
import ModelBreakdown from './ModelBreakdown';
import { CartProvider, useCart, type CartItem } from './CartContext';
import CartPanel from './CartPanel';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, Area, ComposedChart,
} from 'recharts';
import {
  api,
  type StockAnalysisProducto,
  type ProductModelsResponse,
  type ModeloStock,
  type StockModelDetailResponse,
  type ColorDetalle,
  type StockLiquidationResponse,
} from '@/lib/api';

// ── Constants ────────────────────────────────────────────────────────────────

const ESTADO_CONFIG = {
  CRITICO: { label: 'CRITICO', bg: 'bg-[#3D1A0A]', text: 'text-[#ED7C00]', dot: 'bg-[#ED7C00]', bar: '#ED7C00' },
  BAJO:    { label: 'BAJO',    bg: 'bg-[#2D2A0A]', text: 'text-[#D4A017]', dot: 'bg-[#D4A017]', bar: '#D4A017' },
  OK:      { label: 'OK',      bg: 'bg-[#0A2D1A]', text: 'text-[#2ECC71]', dot: 'bg-[#2ECC71]', bar: '#2ECC71' },
  EXCESO:  { label: 'EXCESO',  bg: 'bg-[#0A1A2D]', text: 'text-[#5B9BD5]', dot: 'bg-[#5B9BD5]', bar: '#5B9BD5' },
} as const;

const TIPO_OPTIONS = ['Basico', 'Temporada', 'Quiebre'] as const;
type TipoRecompra = 'Basico' | 'Temporada' | 'Quiebre';

const TIPO_ICONS: Record<string, string> = { Basico: '🔄', Temporada: '📅', Quiebre: '⚡' };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function fmtN(n: number) { return new Intl.NumberFormat('es-AR').format(n); }

// ── Props ────────────────────────────────────────────────────────────────────

interface ProductAnalysisProps {
  tenantId: string;
  localId?: number;
  productos: StockAnalysisProducto[];
  /** Pre-selected product (e.g. from Treemap click) */
  initialProductId?: number;
  onClose?: () => void;
  /** Called after cart is saved as planned order */
  onOrderSaved?: () => void;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
  const cfg = ESTADO_CONFIG[estado as keyof typeof ESTADO_CONFIG] ?? ESTADO_CONFIG.OK;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// Inline editable number field
function EditableNumber({
  value, min, max, onSave, label, suffix,
}: {
  value: number; min?: number; max?: number;
  onSave: (v: number) => void;
  label: string; suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && (!min || n >= min) && (!max || n <= max)) {
      onSave(n);
    } else {
      setDraft(String(value));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); } }}
        className="w-14 bg-[#0B1921] border border-[#ED7C00] text-white text-xs rounded px-1.5 py-0.5 font-mono text-center focus:outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1 text-xs"
      title={`Editar ${label}`}
    >
      <span className="text-white font-mono">{value}{suffix}</span>
      <svg className="w-3 h-3 text-[#7A9BAD] group-hover:text-[#ED7C00] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </button>
  );
}

// ── Projection Chart (Basico/Quiebre) ────────────────────────────────────────

function ProjectionChart({ data, leadTime, seguridad, demandaDiaria }: {
  data: Array<{ dia: number; stock: number }>;
  leadTime: number;
  seguridad: number;
  demandaDiaria: number;
}) {
  if (!data.length) return (
    <div className="h-52 flex items-center justify-center text-[#7A9BAD] text-sm">Sin datos de proyeccion</div>
  );

  const puntoReorden = Math.round(demandaDiaria * (leadTime + seguridad));
  const quiebreDia = data.find(d => d.stock <= 0)?.dia;
  const ordenDia = data.find(d => d.stock <= puntoReorden)?.dia;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E3340" />
        <XAxis dataKey="dia" stroke="#7A9BAD" tick={{ fontSize: 10 }}
          label={{ value: 'Días', position: 'insideBottomRight', offset: -5, style: { fill: '#7A9BAD', fontSize: 10 } }} />
        <YAxis stroke="#7A9BAD" tick={{ fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8, fontFamily: 'Space Grotesk, sans-serif' }}
          formatter={(v: unknown) => [fmtN(v as number), 'Stock']}
          labelFormatter={(l) => `Día ${l}`}
        />
        <Area type="monotone" dataKey="stock" fill="rgba(59,130,246,0.08)" stroke="transparent" />
        <Line type="monotone" dataKey="stock" stroke="#3B82F6" strokeWidth={2} dot={false} />
        <ReferenceLine y={puntoReorden} stroke="#DC2626" strokeDasharray="5 5"
          label={{ value: `Reorden: ${fmtN(puntoReorden)}`, position: 'right', fill: '#DC2626', fontSize: 9 }} />
        {ordenDia != null && (
          <ReferenceLine x={ordenDia} stroke="#ED7C00" strokeDasharray="3 3"
            label={{ value: 'Emitir orden', position: 'top', fill: '#ED7C00', fontSize: 9 }} />
        )}
        {quiebreDia != null && (
          <ReferenceLine x={quiebreDia} stroke="#DC2626"
            label={{ value: 'Quiebre', position: 'top', fill: '#DC2626', fontSize: 9 }} />
        )}
        <ReferenceLine x={leadTime} stroke="#6B7280" strokeDasharray="5 5"
          label={{ value: `LT: ${leadTime}d`, position: 'insideTopLeft', fill: '#6B7280', fontSize: 9 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Temporada Timeline Chart ─────────────────────────────────────────────────

function TemporadaTimeline({ ventasMensuales }: { ventasMensuales: Array<{ mes: number; unidades: number }> }) {
  if (!ventasMensuales.length) return (
    <div className="h-52 flex items-center justify-center text-[#7A9BAD] text-sm">Sin datos de temporada</div>
  );

  const chartData = Array.from({ length: 12 }, (_, i) => {
    const entry = ventasMensuales.find(v => v.mes === i + 1);
    return { mes: MESES[i], unidades: entry?.unidades ?? 0 };
  });

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1E3340" />
        <XAxis dataKey="mes" stroke="#7A9BAD" tick={{ fontSize: 10 }} />
        <YAxis stroke="#7A9BAD" tick={{ fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
          formatter={(v: unknown) => [fmtN(v as number), 'Unidades vendidas']}
        />
        <Bar dataKey="unidades" radius={[3, 3, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.unidades > 0 ? '#ED7C00' : '#32576F'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Model Bars ────────────────────────────────────────────────────────────────

function ModelBars({ modelos, expandedId, onModelClick }: {
  modelos: ModeloStock[];
  expandedId: number | null;
  onModelClick: (id: number) => void;
}) {
  if (!modelos.length) return (
    <div className="text-[#7A9BAD] text-xs py-4 text-center">Sin modelos con stock o ventas</div>
  );

  const maxVal = Math.max(...modelos.map(m => Math.max(m.stock, m.demanda_30d)), 1);

  return (
    <div className="space-y-1.5">
      {modelos.map(m => {
        const stockPct = Math.min((m.stock / maxVal) * 100, 100);
        const demandaPct = Math.min((m.demanda_30d / maxVal) * 100, 100);
        const cfg = ESTADO_CONFIG[m.estado as keyof typeof ESTADO_CONFIG] ?? ESTADO_CONFIG.OK;
        const isExpanded = expandedId === m.descripcion_id;

        return (
          <button
            key={m.descripcion_id}
            onClick={() => onModelClick(m.descripcion_id)}
            className={`w-full text-left rounded-lg p-2.5 transition-all border ${
              isExpanded ? 'bg-[#132229] border-[#ED7C00]/50 ring-1 ring-[#ED7C00]/20' : 'bg-[#0B1921] border-[#32576F]/40 hover:border-[#32576F]'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-white text-xs font-medium truncate flex-1">{m.descripcion}</span>
              <EstadoBadge estado={m.estado} />
            </div>
            {/* Stacked bar: solid=stock, line marker=demanda */}
            <div className="relative h-4 bg-[#0B1921] rounded-full overflow-hidden border border-[#1E3340]">
              <div className="absolute top-0 left-0 h-full rounded-full transition-all" style={{ width: `${stockPct}%`, background: cfg.bar, opacity: 0.75 }} />
              <div className="absolute top-0 left-0 h-full border-r-2 border-white/40" style={{ width: `${demandaPct}%` }} />
            </div>
            <div className="flex justify-between mt-1 text-[10px] font-mono">
              <span className="text-[#CDD4DA]">Stock: {fmtN(m.stock)}</span>
              <span className="text-[#7A9BAD]">Demanda 30d: {fmtN(Math.round(m.demanda_30d))}</span>
              {m.deficit > 0 && <span className="text-red-400">Deficit: {fmtN(m.deficit)}</span>}
            </div>
            {m.alerta_color && (
              <div style={{ padding: '2px 0 0 16px' }}>
                <span className="inline-block" style={{ padding: '3px 8px', background: 'rgba(239,159,39,0.12)', color: '#EF9F27', borderRadius: 4, fontSize: 11 }}>
                  ⚠ REVISAR: {m.alerta_color}
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Color Estado Logic ────────────────────────────────────────────────────────

const COLOR_ESTADO = {
  REPONER:       { label: 'REPONER',       bg: 'bg-red-900/40',    text: 'text-red-400',    dot: '#EF4444' },
  REVISAR:       { label: 'REVISAR',       bg: 'bg-yellow-900/40', text: 'text-yellow-400', dot: '#FACC15' },
  SIN_MOVIMIENTO:{ label: 'SIN MOVIMIENTO',bg: 'bg-gray-800/40',   text: 'text-gray-400',   dot: '#6B7280' },
  OK:            { label: 'OK',            bg: 'bg-green-900/40',  text: 'text-green-400',  dot: '#22C55E' },
} as const;

type ColorEstado = keyof typeof COLOR_ESTADO;

function colorEstadoCfg(estado: string) {
  return COLOR_ESTADO[estado as ColorEstado] ?? COLOR_ESTADO.OK;
}

// ── Color → Talle Expansion ──────────────────────────────────────────────────

function ColorExpansion({
  data, loading, productoNombreId, nombre, descripcionId, descripcion, proveedorId, proveedor,
}: {
  data: StockModelDetailResponse | null;
  loading: boolean;
  productoNombreId: number;
  nombre: string;
  descripcionId: number;
  descripcion: string;
  proveedorId: number | null;
  proveedor: string | null;
}) {
  const [expandedColorId, setExpandedColorId] = useState<number | null>(null);
  const { addItem } = useCart();

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <div className="w-5 h-5 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!data || !data.colores.length) return (
    <p className="text-[#7A9BAD] text-xs py-3 text-center">Sin colores con stock o ventas</p>
  );

  const handleAddToCart = (c: ColorDetalle) => {
    const item: CartItem = {
      id: `${descripcionId}-${c.colorId}`,
      productoNombreId,
      nombre,
      descripcionId,
      descripcion,
      colorId: c.colorId,
      color: c.color,
      talles: c.talles.map(t => ({ talle: t.talle, cantidad: Math.max(t.stock > 0 ? 0 : 1, 0), pctDemanda: t.pctDemanda })),
      precioUnitario: 0,
      proveedorId,
      proveedor,
    };
    addItem(item);
  };

  return (
    <div className="mt-2 pl-3 border-l-2 border-[#32576F] space-y-1">
      {data.colores.map(c => {
        const cfg = colorEstadoCfg(c.estado);
        const isExp = expandedColorId === c.colorId;
        const actionable = c.estado === 'REPONER' || c.estado === 'REVISAR';

        return (
          <div key={c.colorId}>
            {/* Color row */}
            <button
              onClick={() => setExpandedColorId(isExp ? null : c.colorId)}
              className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all border ${
                isExp ? 'bg-[#132229] border-[#32576F]' : 'bg-[#0B1921] border-transparent hover:border-[#32576F]/50'
              }`}
            >
              <svg className={`w-3 h-3 text-[#7A9BAD] flex-shrink-0 transition-transform ${isExp ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cfg.dot }} />
              <span className="text-white text-xs font-medium flex-1 truncate">{c.color}</span>
              <span className="text-[#7A9BAD] text-[10px] font-mono">{c.pctDemanda.toFixed(0)}% dem</span>
              <span className="text-[#CDD4DA] text-[10px] font-mono">{fmtN(c.stockTotal)} u</span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
                {cfg.label}
              </span>
              {actionable && (
                <button
                  onClick={e => { e.stopPropagation(); handleAddToCart(c); }}
                  className="ml-1 px-2 py-0.5 text-[10px] font-semibold rounded bg-[#ED7C00]/15 text-[#ED7C00] border border-[#ED7C00]/40 hover:bg-[#ED7C00]/25 transition-colors"
                >
                  + Carrito
                </button>
              )}
            </button>

            {/* Expanded: talles + demanda por local */}
            {isExp && (
              <div className="ml-6 mt-1 mb-2 pl-3 border-l-2 border-[#1E3340] space-y-3">
                {/* Talles */}
                <div>
                  <p className="text-[#7A9BAD] text-[10px] font-semibold uppercase tracking-wide mb-1.5">Talles</p>
                  <div className="space-y-1">
                    {c.talles.map(t => (
                      <div key={t.talle} className="flex items-center gap-2">
                        <span className="text-white text-[10px] w-8 text-right font-mono">{t.talle}</span>
                        <div className="flex-1 h-2.5 bg-[#0B1921] rounded-full overflow-hidden">
                          <div className="h-full bg-[#ED7C00] rounded-full" style={{ width: `${Math.min(t.pctDemanda, 100)}%` }} />
                        </div>
                        <span className="text-[#CDD4DA] text-[10px] font-mono w-28 text-right">
                          {t.pctDemanda.toFixed(0)}% · {fmtN(t.stock)} u
                          {t.prioridad && <span className="ml-1 text-red-400">!</span>}
                        </span>
                      </div>
                    ))}
                    {c.talles.length === 0 && <p className="text-[#7A9BAD] text-[10px]">Sin talles</p>}
                  </div>
                </div>

                {/* Demanda por local */}
                {c.demandaPorLocal.length > 0 && (
                  <div>
                    <p className="text-[#7A9BAD] text-[10px] font-semibold mb-1">📍 Demanda por local:</p>
                    <p className="text-[#CDD4DA] text-[11px]">
                      {c.demandaPorLocal.map((l, i) => (
                        <span key={l.local}>
                          {i > 0 && <span className="text-[#7A9BAD]"> · </span>}
                          <span className="text-white font-medium">{l.local}:</span>{' '}
                          {l.pctDemanda.toFixed(0)}% ({l.unidadesMes.toFixed(1)} un/mes)
                        </span>
                      ))}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Liquidation Section ──────────────────────────────────────────────────────

function LiquidationSection({ data }: { data: StockLiquidationResponse }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (!data.modelos.length) return null;

  // Weighted average discount
  const avgDesc = data.modelos.length
    ? Math.round(data.modelos.reduce((s, m) => s + m.descuentoSugerido, 0) / data.modelos.length)
    : 0;

  return (
    <div className="space-y-3">
      {/* Divider */}
      <div className="flex items-center gap-3 pt-2">
        <div className="flex-1 h-px bg-[#6D28D9]/40" />
        <span className="text-[#A78BFA] text-[10px] uppercase tracking-widest font-semibold">Liquidación</span>
        <div className="flex-1 h-px bg-[#6D28D9]/40" />
      </div>

      <div className="bg-[#1a1028] border border-[#6D28D9]/30 rounded-xl p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white text-sm font-semibold flex items-center gap-1.5">
              <span>🏷️</span> Recomendación de liquidación
            </p>
            <p className="text-[#A78BFA] text-xs mt-0.5">
              Capital inmovilizado: {fmt(data.capitalInmovilizado)}
            </p>
          </div>
          <span className="text-[#A78BFA] text-[10px] font-mono">{data.modelos.length} modelo{data.modelos.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Models list */}
        <div className="space-y-1.5">
          {data.modelos.map(m => {
            const isExp = expandedId === m.descripcionId;
            return (
              <div key={m.descripcionId}>
                <button
                  onClick={() => setExpandedId(isExp ? null : m.descripcionId)}
                  className={`w-full text-left rounded-lg p-2.5 transition-all border ${
                    isExp ? 'bg-[#231736] border-[#6D28D9]/50' : 'bg-[#1a1028]/60 border-[#6D28D9]/20 hover:border-[#6D28D9]/40'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <svg className={`w-3 h-3 text-[#A78BFA] flex-shrink-0 transition-transform ${isExp ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-white text-xs font-medium flex-1 truncate">{m.descripcion}</span>
                    {m.tieneDemandaOtroLocal && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                        Transferir primero
                      </span>
                    )}
                    <span className="text-[#A78BFA] text-[10px] font-semibold">-{m.descuentoSugerido}%</span>
                  </div>
                  <div className="flex gap-4 mt-1.5 text-[10px] font-mono flex-wrap">
                    <span className="text-[#CDD4DA]">Stock: {fmtN(m.stockTotal)}</span>
                    <span className="text-[#A78BFA]">Valor: {fmt(m.valorStock)}</span>
                    <span className="text-[#7A9BAD]">Edad: {Math.round(m.edadPromDias)}d</span>
                    <span className="text-[#7A9BAD]">Vtas 90d: {fmtN(m.vendidas90d)}</span>
                    <span className="text-green-400">Recuperable: {fmt(m.capitalRecuperable)}</span>
                  </div>
                </button>

                {/* Expanded: color × talle detail */}
                {isExp && m.detalle.length > 0 && (
                  <div className="ml-6 mt-1 mb-2 pl-3 border-l-2 border-[#6D28D9]/30">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-[#6D28D9]/20">
                          {['Color', 'Talle', 'Stock', 'Días inv.', 'Vendidas'].map(h => (
                            <th key={h} className="text-left text-[#A78BFA] font-medium py-1 px-2 uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {m.detalle.map((d, i) => (
                          <tr key={i} className="border-b border-[#6D28D9]/10">
                            <td className="py-1 px-2 text-white">{d.color}</td>
                            <td className="py-1 px-2 text-white font-mono">{d.talle}</td>
                            <td className="py-1 px-2 text-[#CDD4DA] font-mono text-right">{fmtN(d.stock)}</td>
                            <td className="py-1 px-2 text-[#7A9BAD] font-mono text-right">{d.diasEnStock}d</td>
                            <td className="py-1 px-2 text-[#7A9BAD] font-mono text-right">{fmtN(d.vendidas)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer total */}
        <div className="mt-3 pt-3 border-t border-[#6D28D9]/30 flex items-center justify-between">
          <span className="text-[#A78BFA] text-xs">
            Capital recuperable estimado (con {avgDesc}% desc):
          </span>
          <span className="text-green-400 font-bold text-sm font-mono">{fmt(data.capitalRecuperable)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ProductAnalysis({ tenantId, localId, productos, initialProductId, onClose, onOrderSaved }: ProductAnalysisProps) {
  const [selectedId, setSelectedId] = useState<number | null>(initialProductId ?? null);
  const [models, setModels] = useState<ProductModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [expandedModelId, setExpandedModelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<StockModelDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [liquidation, setLiquidation] = useState<StockLiquidationResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedProduct = productos.find(p => p.producto_nombre_id === selectedId) ?? null;

  const loadModels = useCallback(async (id: number) => {
    setModelsLoading(true);
    setModels(null);
    setExpandedModelId(null);
    setDetail(null);
    setLiquidation(null);
    try {
      const [modelsResult, liqResult] = await Promise.all([
        api.analytics.productModels(tenantId, id, localId),
        api.analytics.stockLiquidation(tenantId, id, localId).catch(() => null),
      ]);
      setModels(modelsResult);
      if (liqResult && liqResult.modelos.length > 0) setLiquidation(liqResult);
    } catch (err) {
      console.error('Failed to load product models:', err);
    } finally {
      setModelsLoading(false);
    }
  }, [tenantId, localId]);

  useEffect(() => {
    if (selectedId != null) loadModels(selectedId);
  }, [selectedId, loadModels]);

  // Keep initialProductId in sync (e.g. new treemap click)
  useEffect(() => {
    if (initialProductId != null && initialProductId !== selectedId) {
      setSelectedId(initialProductId);
    }
  }, [initialProductId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleModelClick = useCallback(async (descripcionId: number) => {
    if (expandedModelId === descripcionId) {
      setExpandedModelId(null);
      setDetail(null);
      return;
    }
    setExpandedModelId(descripcionId);
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await api.analytics.stockModelDetail(tenantId, selectedId!, descripcionId, localId);
      setDetail(result);
    } catch (err) {
      console.error('Failed to load model detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, [tenantId, selectedId, localId, expandedModelId]);

  // Save tipo
  const handleSaveTipo = useCallback(async (tipo: TipoRecompra) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await api.analytics.updateClasificacion(tenantId, { producto_nombre_id: selectedId, tipo_recompra: tipo });
      setModels(prev => prev ? { ...prev, tipo } : null);
    } finally {
      setSaving(false);
    }
  }, [tenantId, selectedId]);

  // Save seguridad
  const handleSaveSeguridad = useCallback(async (seguridad: number) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await api.analytics.updateClasificacion(tenantId, { producto_nombre_id: selectedId, stock_seguridad_dias: seguridad });
      setModels(prev => prev ? { ...prev, seguridad } : null);
    } finally {
      setSaving(false);
    }
  }, [tenantId, selectedId]);

  // Save lead time
  const handleSaveLeadTime = useCallback(async (lead_time: number) => {
    if (!selectedId || !models?.proveedor_id) return;
    setSaving(true);
    try {
      await api.analytics.updateLeadTime(tenantId, { proveedor_id: models.proveedor_id, lead_time_dias: lead_time });
      setModels(prev => prev ? { ...prev, lead_time } : null);
    } finally {
      setSaving(false);
    }
  }, [tenantId, selectedId, models?.proveedor_id]);

  const selectProduct = (id: number) => {
    setSelectedId(id);
  };

  return (
    <CartProvider>
    <CartPanel tenantId={tenantId} onSaved={onOrderSaved} />
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#7A9BAD] text-xs">Selecciona un producto para ver proyeccion, modelos y curvas de talle</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <div className="w-3.5 h-3.5 border border-[#ED7C00] border-t-transparent rounded-full animate-spin" />}
          {onClose && (
            <button onClick={onClose} className="text-[#7A9BAD] hover:text-white transition-colors p-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Product Selector */}
      <div className="flex gap-3 items-start flex-wrap">
        <ProductSelector
          productos={productos}
          selectedId={selectedId}
          onSelect={selectProduct}
        />

        {/* Quick select: top critical/bajo products */}
        {!selectedId && (
          <div className="flex gap-1.5 flex-wrap">
            {productos
              .filter(p => p.estado === 'CRITICO' || p.estado === 'BAJO')
              .slice(0, 6)
              .map(p => {
                const cfg = ESTADO_CONFIG[p.estado as keyof typeof ESTADO_CONFIG];
                return (
                  <button
                    key={p.producto_nombre_id}
                    onClick={() => selectProduct(p.producto_nombre_id)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border transition-colors hover:opacity-100 opacity-80"
                    style={{ background: `${cfg.bar}15`, borderColor: `${cfg.bar}44`, color: cfg.bar }}
                  >
                    {p.nombre.length > 22 ? p.nombre.slice(0, 20) + '...' : p.nombre}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* ── Selected product detail ─────────────────────────────────────────── */}
      {selectedProduct && (
        <div className="space-y-4">
          {/* Config header: nombre + editable fields */}
          <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <p className="text-white font-semibold text-base">{selectedProduct.nombre}</p>
                <div className="flex items-center gap-2 mt-1">
                  <EstadoBadge estado={selectedProduct.estado} />
                  <span className="text-[#7A9BAD] text-xs">
                    {selectedProduct.cobertura_dias >= 999 ? 'Sin ventas' : `${selectedProduct.cobertura_dias.toFixed(0)}d cobertura`}
                  </span>
                </div>
              </div>

              {/* Tipo selector */}
              <div className="flex flex-col gap-1">
                <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">Tipo</p>
                <div className="flex gap-1">
                  {TIPO_OPTIONS.map(t => (
                    <button
                      key={t}
                      onClick={() => handleSaveTipo(t)}
                      className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${
                        (models?.tipo ?? selectedProduct.tipo) === t
                          ? 'bg-[#ED7C00]/15 border-[#ED7C00]/50 text-[#ED7C00]'
                          : 'bg-[#132229] border-[#32576F] text-[#7A9BAD] hover:border-[#ED7C00]/30 hover:text-white'
                      }`}
                    >
                      <span>{TIPO_ICONS[t]}</span>
                      <span>{t}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Lead time editable */}
              <div className="flex flex-col gap-1">
                <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">
                  Lead time
                  {!models?.proveedor_id && <span className="ml-1 text-[#7A9BAD]/60">(sin proveedor)</span>}
                </p>
                {models && models.proveedor_id ? (
                  <EditableNumber
                    value={models.lead_time}
                    min={1}
                    max={365}
                    suffix="d"
                    label="lead time"
                    onSave={handleSaveLeadTime}
                  />
                ) : (
                  <span className="text-[#7A9BAD] text-xs">{selectedProduct.lead_time}d</span>
                )}
              </div>

              {/* Seguridad editable */}
              <div className="flex flex-col gap-1">
                <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">Stock seguridad</p>
                {models ? (
                  <EditableNumber
                    value={models.seguridad}
                    min={0}
                    max={90}
                    suffix="d"
                    label="stock de seguridad"
                    onSave={handleSaveSeguridad}
                  />
                ) : (
                  <span className="text-[#7A9BAD] text-xs">{selectedProduct.seguridad}d</span>
                )}
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-3">
              <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-1">Stock total</p>
              <p className="text-white font-bold text-lg font-mono">{fmtN(selectedProduct.stock_total)}</p>
            </div>
            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-3">
              <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-1">Demanda diaria</p>
              <p className="text-[#ED7C00] font-bold text-lg">{selectedProduct.demanda_proyectada_diaria.toFixed(1)}</p>
              <p className="text-[#7A9BAD] text-[10px]">unidades/dia proyectadas</p>
            </div>
            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-3">
              <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-1">Sugerencia compra</p>
              <p className="text-white font-bold text-lg font-mono">{fmtN(selectedProduct.sugerencia_compra)}</p>
              <p className="text-[#7A9BAD] text-[10px]">unidades a reponer</p>
            </div>
            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-3">
              <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-1">Inversion estimada</p>
              <p className="text-[#ED7C00] font-bold text-lg">{fmt(selectedProduct.inversion_sugerida)}</p>
            </div>
          </div>

          {/* Demand Forecast panel */}
          <DemandForecast tenantId={tenantId} productoNombreId={selectedProduct.producto_nombre_id} localId={localId} />

          {/* CAPA 2: Model breakdown ranked by exit velocity */}
          <ModelBreakdown tenantId={tenantId} productoNombreId={selectedProduct.producto_nombre_id} nombre={selectedProduct.nombre} localId={localId} />

          {/* Two-panel: chart (left) + model bars (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Projection or Temporada timeline */}
            <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
              <p className="text-white text-xs font-semibold mb-3">
                {(models?.tipo ?? selectedProduct.tipo) === 'Temporada' ? 'Ventas mensuales (ano anterior)' : 'Proyeccion de stock'}
              </p>
              {modelsLoading ? (
                <div className="h-52 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : models ? (
                (models.tipo === 'Temporada') ? (
                  <TemporadaTimeline ventasMensuales={models.ventas_mensuales} />
                ) : (
                  <ProjectionChart
                    data={models.proyeccion_stock}
                    leadTime={models.lead_time}
                    seguridad={models.seguridad}
                    demandaDiaria={models.demanda_proyectada_diaria}
                  />
                )
              ) : (
                <div className="h-52 flex items-center justify-center text-[#7A9BAD] text-xs">Cargando...</div>
              )}
            </div>

            {/* Model bars */}
            <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-white text-xs font-semibold">Modelos — barra: stock vs demanda 30d</p>
                {models && <span className="text-[#7A9BAD] text-[10px]">{models.modelos.length} modelos · click para curva</span>}
              </div>
              {modelsLoading ? (
                <div className="h-52 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : models ? (
                <div className="max-h-[290px] overflow-y-auto pr-1 space-y-1.5">
                  <ModelBars modelos={models.modelos} expandedId={expandedModelId} onModelClick={handleModelClick} />
                  {/* Inline color→talle detail after clicked model */}
                  {expandedModelId != null && (
                    <div className="mt-2 p-3 bg-[#132229] border border-[#32576F] rounded-lg">
                      <p className="text-white text-[10px] font-semibold mb-2">
                        {models.modelos.find(m => m.descripcion_id === expandedModelId)?.descripcion}
                        {' — '}colores y talles
                      </p>
                      <ColorExpansion
                        data={detail}
                        loading={detailLoading}
                        productoNombreId={selectedId!}
                        nombre={selectedProduct!.nombre}
                        descripcionId={expandedModelId}
                        descripcion={models.modelos.find(m => m.descripcion_id === expandedModelId)?.descripcion ?? ''}
                        proveedorId={models.proveedor_id}
                        proveedor={null}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-52 flex items-center justify-center text-[#7A9BAD] text-xs">Cargando...</div>
              )}
            </div>
          </div>

          {/* Expandable models table */}
          {models && models.modelos.length > 0 && (
            <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#32576F] flex items-center justify-between">
                <div>
                  <p className="text-white text-xs font-semibold">Tabla de modelos</p>
                  <p className="text-[#7A9BAD] text-[10px]">Click en fila para ver colores y talles</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['Descripcion', 'Stock', 'Vendidas 30d', 'Vel/dia', 'Demanda 30d', 'Cobertura', 'Estado', 'Deficit'].map(h => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {models.modelos.map(m => {
                      const isExp = expandedModelId === m.descripcion_id;
                      return (
                        <>
                          <tr
                            key={m.descripcion_id}
                            onClick={() => handleModelClick(m.descripcion_id)}
                            className={`border-b border-[#32576F]/40 cursor-pointer transition-colors ${
                              isExp ? 'bg-[#132229]' : 'hover:bg-[#132229]/50'
                            }`}
                          >
                            <td className="py-2 px-3 text-white font-medium">
                              <div className="flex items-center gap-1.5">
                                <svg className={`w-3 h-3 transition-transform text-[#7A9BAD] flex-shrink-0 ${isExp ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="max-w-[160px] truncate">{m.descripcion}</span>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-white font-mono text-right">{fmtN(m.stock)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] font-mono text-right">{fmtN(m.vendidas_30d)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] font-mono text-right">{m.velocidad_diaria.toFixed(1)}</td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono text-right">{fmtN(Math.round(m.demanda_30d))}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] text-right">
                              {m.cobertura_dias >= 999 ? '—' : `${m.cobertura_dias.toFixed(0)}d`}
                            </td>
                            <td className="py-2 px-3"><EstadoBadge estado={m.estado} /></td>
                            <td className="py-2 px-3 text-right">
                              {m.deficit > 0 ? (
                                <span className="text-red-400 font-mono">{fmtN(m.deficit)}</span>
                              ) : <span className="text-[#7A9BAD]">—</span>}
                            </td>
                          </tr>
                          {m.alerta_color && (
                            <tr key={`${m.descripcion_id}-alerta`} className="border-b border-[#32576F]/40">
                              <td colSpan={8} style={{ padding: '2px 12px 8px 30px' }}>
                                <span style={{ padding: '3px 8px', background: 'rgba(239,159,39,0.12)', color: '#EF9F27', borderRadius: 4, fontSize: 11 }}>
                                  ⚠ REVISAR: {m.alerta_color}
                                </span>
                              </td>
                            </tr>
                          )}
                          {isExp && (
                            <tr key={`${m.descripcion_id}-detail`} className="bg-[#132229] border-b border-[#32576F]/40">
                              <td colSpan={8} className="px-4 py-3">
                                <ColorExpansion
                                  data={detail}
                                  loading={detailLoading}
                                  productoNombreId={selectedId!}
                                  nombre={selectedProduct!.nombre}
                                  descripcionId={m.descripcion_id}
                                  descripcion={m.descripcion}
                                  proveedorId={models!.proveedor_id}
                                  proveedor={null}
                                />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Liquidation section */}
          {liquidation && <LiquidationSection data={liquidation} />}

          {/* Change product */}
          <div className="flex justify-center">
            <button
              onClick={() => { setSelectedId(null); setModels(null); setExpandedModelId(null); setDetail(null); setLiquidation(null); }}
              className="text-[#7A9BAD] text-xs hover:text-white transition-colors underline"
            >
              Cambiar producto
            </button>
          </div>
        </div>
      )}

      {/* No selection — Top 10 by urgency */}
      {!selectedProduct && productos.length > 0 && (
        <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
          <p className="text-white text-xs font-semibold mb-3">Top 10 productos por urgencia</p>
          <div className="space-y-1.5">
            {[...productos]
              .sort((a, b) => {
                const order = { CRITICO: 0, BAJO: 1, OK: 2, EXCESO: 3 };
                const oa = order[a.estado as keyof typeof order] ?? 2;
                const ob = order[b.estado as keyof typeof order] ?? 2;
                return oa !== ob ? oa - ob : a.cobertura_dias - b.cobertura_dias;
              })
              .slice(0, 10)
              .map(p => {
                const cfg = ESTADO_CONFIG[p.estado as keyof typeof ESTADO_CONFIG] ?? ESTADO_CONFIG.OK;
                const maxCob = 90;
                const pct = Math.min((p.cobertura_dias / maxCob) * 100, 100);
                return (
                  <button
                    key={p.producto_nombre_id}
                    onClick={() => selectProduct(p.producto_nombre_id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#132229] transition-colors text-left group"
                  >
                    <span className="text-white text-xs font-medium w-40 truncate group-hover:text-[#ED7C00] transition-colors">{p.nombre}</span>
                    <div className="flex-1 h-2.5 bg-[#0B1921] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cfg.bar }} />
                    </div>
                    <span className="text-[#CDD4DA] text-[10px] font-mono w-12 text-right">
                      {p.cobertura_dias >= 999 ? '—' : `${p.cobertura_dias.toFixed(0)}d`}
                    </span>
                    <EstadoBadge estado={p.estado} />
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
    </CartProvider>
  );
}
