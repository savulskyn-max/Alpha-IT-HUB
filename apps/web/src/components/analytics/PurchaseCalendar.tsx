'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import {
  api,
  type OrdenCalendario,
  type StockCalendarResponse,
  type OrdenCompraPlanCreate,
  type OrdenCompraPlanUpdate,
} from '@/lib/api';

// ── Constants ────────────────────────────────────────────────────────────────

const DIAS = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const ESTADO_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  sugerida:   { bg: '#132229', border: '#32576F',  text: '#7A9BAD', dot: '#7A9BAD' },
  planificada:{ bg: '#1A2510', border: '#ED7C00',  text: '#ED7C00', dot: '#ED7C00' },
  confirmada: { bg: '#0A2D1A', border: '#2ECC71',  text: '#2ECC71', dot: '#2ECC71' },
  ordenada:   { bg: '#0A1A2D', border: '#3B82F6',  text: '#3B82F6', dot: '#3B82F6' },
};

const URGENCIA_COLOR: Record<string, string> = {
  CRITICO: '#DC2626',
  BAJO:    '#D97706',
  OK:      '#15803D',
};

const TIPO_ICONS: Record<string, string> = { Basico: '🔄', Temporada: '📅', Quiebre: '⚡' };

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function fmtN(n: number) { return new Intl.NumberFormat('es-AR').format(n); }

// ── Props ─────────────────────────────────────────────────────────────────────

interface PurchaseCalendarProps {
  tenantId: string;
  localId?: number;
  /** Increment to force a refetch (e.g. after cart save) */
  refreshKey?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Days in a month grid (including blanks for alignment)
function buildMonthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = first.getDay(); // 0=Sun
  const cells: Array<Date | null> = Array(startDow).fill(null);
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(new Date(year, month, d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── Order chip (calendar block) ───────────────────────────────────────────────

function OrderChip({ orden, onClick, onDragStart }: {
  orden: OrdenCalendario;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const s = ESTADO_STYLES[orden.estado] ?? ESTADO_STYLES.planificada;
  const urg = URGENCIA_COLOR[orden.urgencia] ?? '#7A9BAD';
  const isDashed = orden.estado === 'sugerida';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer hover:opacity-90 transition-opacity truncate"
      style={{
        background: s.bg,
        border: `1.5px ${isDashed ? 'dashed' : 'solid'} ${s.border}`,
        color: s.text,
        borderLeft: `3px solid ${urg}`,
      }}
      title={`${orden.nombre} · ${fmtN(orden.cantidad)} un · ${fmt(orden.inversion_estimada)}`}
    >
      {TIPO_ICONS[orden.tipo] ?? ''} {orden.nombre.length > 14 ? orden.nombre.slice(0, 12) + '…' : orden.nombre}
    </div>
  );
}

// ── Side Panel (order detail) ─────────────────────────────────────────────────

function SidePanel({ orden, onClose, onUpdateEstado, onEdit }: {
  orden: OrdenCalendario;
  onClose: () => void;
  onUpdateEstado: (estado: string) => void;
  onEdit: (update: Partial<OrdenCalendario>) => void;
}) {
  const s = ESTADO_STYLES[orden.estado] ?? ESTADO_STYLES.planificada;
  const llegada = orden.fecha_llegada ? parseDateStr(orden.fecha_llegada) : null;
  const emision = parseDateStr(orden.fecha_emision);
  const today = new Date();
  const diasHasta = Math.round((emision.getTime() - today.getTime()) / 86400000);
  const [editQty, setEditQty] = useState(String(orden.cantidad));

  const NEXT_ESTADO: Record<string, string> = {
    sugerida: 'planificada',
    planificada: 'confirmada',
    confirmada: 'ordenada',
    ordenada: 'ordenada',
  };
  const NEXT_LABEL: Record<string, string> = {
    sugerida: 'Planificar',
    planificada: 'Confirmar',
    confirmada: 'Marcar ordenada',
    ordenada: 'Ya ordenada',
  };

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-[#1E3340] border-l border-[#32576F] z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#32576F]">
        <div>
          <p className="text-white font-semibold text-sm">{orden.nombre}</p>
          <p className="text-[#7A9BAD] text-xs">{TIPO_ICONS[orden.tipo]} {orden.tipo}</p>
        </div>
        <button onClick={onClose} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Estado badge */}
        <div
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: s.bg, border: `1.5px solid ${s.border}`, color: s.text }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: s.dot }} />
          {orden.estado.charAt(0).toUpperCase() + orden.estado.slice(1)}
          {orden.origen === 'motor' && <span className="ml-1 opacity-70">· Motor</span>}
        </div>

        {/* Key info */}
        <div className="space-y-2">
          <div className="flex justify-between items-center py-2 border-b border-[#32576F]/40">
            <span className="text-[#7A9BAD] text-xs">Fecha emisión</span>
            <span className="text-white text-xs font-mono">
              {emision.toLocaleDateString('es-AR')}
              {diasHasta === 0 && <span className="ml-1 text-[#ED7C00]">HOY</span>}
              {diasHasta > 0 && <span className="ml-1 text-[#7A9BAD]">en {diasHasta}d</span>}
              {diasHasta < 0 && <span className="ml-1 text-red-400">hace {-diasHasta}d</span>}
            </span>
          </div>
          {llegada && (
            <div className="flex justify-between items-center py-2 border-b border-[#32576F]/40">
              <span className="text-[#7A9BAD] text-xs">Llegada estimada</span>
              <span className="text-white text-xs font-mono">{llegada.toLocaleDateString('es-AR')}</span>
            </div>
          )}
          {orden.proveedor_nombre && (
            <div className="flex justify-between items-center py-2 border-b border-[#32576F]/40">
              <span className="text-[#7A9BAD] text-xs">Proveedor</span>
              <span className="text-white text-xs">{orden.proveedor_nombre}</span>
            </div>
          )}
          <div className="flex justify-between items-center py-2 border-b border-[#32576F]/40">
            <span className="text-[#7A9BAD] text-xs">Urgencia</span>
            <span className="text-xs font-semibold" style={{ color: URGENCIA_COLOR[orden.urgencia] }}>
              {orden.urgencia}
            </span>
          </div>
        </div>

        {/* Investment */}
        <div className="bg-[#132229] rounded-xl p-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-[#7A9BAD] text-xs">Cantidad</span>
            <input
              type="number"
              value={editQty}
              onChange={e => setEditQty(e.target.value)}
              onBlur={() => {
                const n = parseInt(editQty, 10);
                if (!isNaN(n) && n > 0 && n !== orden.cantidad) {
                  onEdit({ cantidad: n });
                }
              }}
              className="w-16 bg-[#0B1921] border border-[#32576F] text-white text-xs rounded px-1.5 py-0.5 font-mono text-right focus:outline-none focus:border-[#ED7C00]"
            />
          </div>
          <div className="flex justify-between">
            <span className="text-[#7A9BAD] text-xs">Costo unitario</span>
            <span className="text-white text-xs font-mono">{fmt(orden.costo_unitario)}</span>
          </div>
          <div className="flex justify-between pt-1 border-t border-[#32576F]/40">
            <span className="text-white text-xs font-semibold">Inversión estimada</span>
            <span className="text-[#ED7C00] text-sm font-bold font-mono">{fmt(orden.inversion_estimada)}</span>
          </div>
        </div>

        {/* Notes */}
        {orden.notas && (
          <div className="bg-[#132229] rounded-xl p-3">
            <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-1">Notas</p>
            <p className="text-[#CDD4DA] text-xs">{orden.notas}</p>
          </div>
        )}

        {/* Mini projection placeholder */}
        <div className="bg-[#132229] rounded-xl p-3 text-center">
          <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-2">Proyección de stock</p>
          <p className="text-[#7A9BAD] text-xs">Ver análisis completo en Vista 2</p>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-[#32576F] space-y-2">
        {orden.estado !== 'ordenada' && (
          <button
            onClick={() => onUpdateEstado(NEXT_ESTADO[orden.estado] ?? 'ordenada')}
            className="w-full py-2 text-sm font-semibold rounded-xl transition-colors"
            style={{
              background: '#ED7C00',
              color: '#fff',
            }}
          >
            {NEXT_LABEL[orden.estado] ?? 'Actualizar'}
          </button>
        )}
        {orden.estado === 'ordenada' && (
          <div className="w-full py-2 text-sm font-semibold rounded-xl text-center bg-[#0A1A2D] border border-[#3B82F6] text-[#3B82F6]">
            ✓ Ordenada
          </div>
        )}
      </div>
    </div>
  );
}

// ── Monthly KPI cards ─────────────────────────────────────────────────────────

function MesKpiCards({ kpis, total, urgentes }: {
  kpis: StockCalendarResponse['kpis_por_mes'];
  total: number;
  urgentes: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {kpis.map(k => (
        <div key={k.mes} className="bg-[#132229] border border-[#32576F] rounded-xl p-3">
          <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-1">{k.mes_label}</p>
          <p className="text-[#ED7C00] font-bold text-lg">{fmt(k.inversion_total)}</p>
          <div className="flex gap-2 mt-1 text-[10px]">
            <span className="text-[#2ECC71]">{fmt(k.inversion_planificada)} confirm.</span>
            <span className="text-[#7A9BAD]">{k.cantidad_ordenes} órd.</span>
          </div>
        </div>
      ))}
      <div className="bg-[#1E3340] border border-[#ED7C00]/30 rounded-xl p-3">
        <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-1">Total período</p>
        <p className="text-[#ED7C00] font-bold text-lg">{fmt(total)}</p>
        {urgentes > 0 && (
          <p className="text-red-400 text-[10px] mt-1">{urgentes} urgentes 🔴</p>
        )}
      </div>
    </div>
  );
}

// ── Cash flow chart ───────────────────────────────────────────────────────────

function FlujoCajaChart({ data }: { data: StockCalendarResponse['flujo_caja'] }) {
  if (!data.length) return null;
  return (
    <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
      <p className="text-white text-xs font-semibold mb-1">Flujo de caja proyectado</p>
      <p className="text-[#7A9BAD] text-[10px] mb-3">CMV proyectado (año anterior) vs compras planificadas · Saldo neto</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E3340" />
          <XAxis dataKey="periodo_label" stroke="#7A9BAD" tick={{ fontSize: 10 }} />
          <YAxis stroke="#7A9BAD" tick={{ fontSize: 10 }} tickFormatter={v => `$${Math.abs(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8, fontFamily: 'Space Grotesk, sans-serif' }}
            formatter={(v: unknown, name: unknown) => [fmt(v as number), name === 'cmv_proyectado' ? 'CMV (ingreso)' : name === 'compras_planificadas' ? 'Compras (egreso)' : 'Saldo neto']}
          />
          <Legend formatter={(v) => <span style={{ color: '#CDD4DA', fontSize: 10 }}>
            {v === 'cmv_proyectado' ? 'CMV ingreso' : v === 'compras_planificadas' ? 'Compras egreso' : 'Saldo neto'}
          </span>} />
          <Bar dataKey="cmv_proyectado" name="cmv_proyectado" fill="#2ECC71" opacity={0.7} radius={[3, 3, 0, 0]} />
          <Bar dataKey="compras_planificadas" name="compras_planificadas" fill="#ED7C00" opacity={0.7} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="saldo_neto" name="saldo_neto" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} />
          <ReferenceLine y={0} stroke="#DC2626" strokeDasharray="3 3" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Timeline view ─────────────────────────────────────────────────────────────

function TimelineView({ ordenes, onOrderClick }: {
  ordenes: OrdenCalendario[];
  onOrderClick: (o: OrdenCalendario) => void;
}) {
  const today = new Date();
  const todayStr = isoDate(today);

  // Group by week
  const weekMap = new Map<string, OrdenCalendario[]>();
  for (const o of ordenes) {
    const d = parseDateStr(o.fecha_emision);
    // Week key = Monday of that week
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = isoDate(monday);
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(o);
  }

  const weeks = [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (!weeks.length) return (
    <div className="text-center text-[#7A9BAD] py-12 text-sm">Sin órdenes en el período seleccionado</div>
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max pb-2">
        {weeks.map(([weekKey, wOrdenes]) => {
          const monday = parseDateStr(weekKey);
          const sunday = addDays(monday, 6);
          const isCurrentWeek = todayStr >= weekKey && todayStr <= isoDate(sunday);
          return (
            <div
              key={weekKey}
              className={`min-w-[160px] max-w-[200px] bg-[#0E1F29] border rounded-xl overflow-hidden ${isCurrentWeek ? 'border-[#ED7C00]/50 ring-1 ring-[#ED7C00]/20' : 'border-[#32576F]'}`}
            >
              <div className={`px-3 py-2 border-b border-[#32576F] ${isCurrentWeek ? 'bg-[#1A2510]' : ''}`}>
                <p className="text-[#CDD4DA] text-[10px] font-medium">
                  {monday.getDate()} {MESES_SHORT[monday.getMonth()]} – {sunday.getDate()} {MESES_SHORT[sunday.getMonth()]}
                </p>
                {isCurrentWeek && <p className="text-[#ED7C00] text-[9px]">Semana actual</p>}
              </div>
              <div className="p-2 space-y-1.5">
                {wOrdenes.map((o, i) => {
                  const s = ESTADO_STYLES[o.estado] ?? ESTADO_STYLES.planificada;
                  const urg = URGENCIA_COLOR[o.urgencia];
                  const emision = parseDateStr(o.fecha_emision);
                  return (
                    <button
                      key={i}
                      onClick={() => onOrderClick(o)}
                      className="w-full text-left rounded p-1.5 hover:opacity-90 transition-opacity"
                      style={{ background: s.bg, border: `1.5px ${o.estado === 'sugerida' ? 'dashed' : 'solid'} ${s.border}`, borderLeft: `3px solid ${urg}` }}
                    >
                      <p className="text-[10px] font-medium truncate" style={{ color: s.text }}>
                        {TIPO_ICONS[o.tipo]} {o.nombre}
                      </p>
                      <p className="text-[9px] text-[#7A9BAD]">
                        {emision.getDate()} {MESES_SHORT[emision.getMonth()]} · {fmtN(o.cantidad)} un
                      </p>
                      <p className="text-[9px] font-mono" style={{ color: urg }}>{fmt(o.inversion_estimada)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Calendar Month View ───────────────────────────────────────────────────────

function CalendarMonthView({ year, month, ordenes, onOrderClick, onDropOrder }: {
  year: number;
  month: number; // 0-indexed
  ordenes: OrdenCalendario[];
  onOrderClick: (o: OrdenCalendario) => void;
  onDropOrder: (orden: OrdenCalendario, newDateStr: string) => void;
}) {
  const cells = buildMonthGrid(year, month);
  const todayStr = isoDate(new Date());
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // Index ordenes by date string
  const ordenByDate = new Map<string, OrdenCalendario[]>();
  for (const o of ordenes) {
    if (!ordenByDate.has(o.fecha_emision)) ordenByDate.set(o.fecha_emision, []);
    ordenByDate.get(o.fecha_emision)!.push(o);
  }

  const getOrderKey = (o: OrdenCalendario) =>
    o.id != null ? `u-${o.id}` : `m-${o.producto_nombre_id}-${o.fecha_emision}`;

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {DIAS.map(d => (
          <div key={d} className="text-center text-[#7A9BAD] text-[10px] font-medium py-1">{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px bg-[#32576F]/20 rounded-xl overflow-hidden">
        {cells.map((day, idx) => {
          const dateStr = day ? isoDate(day) : '';
          const dayOrdenes = day ? (ordenByDate.get(dateStr) ?? []) : [];
          const isToday = dateStr === todayStr;
          const isDragTarget = dragOverDate === dateStr && dateStr !== '';

          return (
            <div
              key={idx}
              className={`min-h-[90px] p-1.5 transition-colors ${day ? 'bg-[#0E1F29]' : 'bg-[#0B1921]'} ${isToday ? 'ring-1 ring-inset ring-[#ED7C00]/50' : ''} ${isDragTarget ? 'bg-[#132229] ring-1 ring-[#ED7C00]' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (dateStr) setDragOverDate(dateStr); }}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverDate(null);
                const key = e.dataTransfer.getData('order-key');
                if (!key || !dateStr) return;
                // Find orden by key
                const found = ordenes.find(o => getOrderKey(o) === key);
                if (found && found.fecha_emision !== dateStr) {
                  onDropOrder(found, dateStr);
                }
              }}
            >
              {day && (
                <>
                  <div className={`text-[10px] font-medium mb-1 ${isToday ? 'text-[#ED7C00]' : 'text-[#7A9BAD]'}`}>
                    {isToday ? (
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#ED7C00] text-white text-[9px]">{day.getDate()}</span>
                    ) : day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayOrdenes.slice(0, 3).map((o) => {
                      const key = getOrderKey(o);
                      return (
                        <OrderChip
                          key={key}
                          orden={o}
                          onClick={() => onOrderClick(o)}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('order-key', key);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                        />
                      );
                    })}
                    {dayOrdenes.length > 3 && (
                      <button
                        onClick={() => onOrderClick(dayOrdenes[3])}
                        className="text-[9px] text-[#7A9BAD] hover:text-white"
                      >
                        +{dayOrdenes.length - 3} más
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Create Order Form ─────────────────────────────────────────────────────────

function CreateOrderForm({ productos, tenantId, onCreated, onCancel }: {
  productos: Array<{ id: number; nombre: string }>;
  tenantId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [pnId, setPnId] = useState<number | ''>('');
  const [fecha, setFecha] = useState(isoDate(new Date()));
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pnId || !fecha || !cantidad) { setError('Completá producto, fecha y cantidad'); return; }
    setLoading(true);
    setError('');
    try {
      const body: OrdenCompraPlanCreate = {
        producto_nombre_id: Number(pnId),
        fecha_emision: fecha,
        cantidad: parseInt(cantidad, 10),
        costo_unitario: costo ? parseFloat(costo) : undefined,
        estado: 'planificada',
        notas: notas || undefined,
      };
      await api.analytics.createCalendarOrder(tenantId, body);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear orden');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-[#7A9BAD] text-[10px] uppercase tracking-wide block mb-1">Producto</label>
        <select
          value={pnId}
          onChange={e => setPnId(Number(e.target.value))}
          className="w-full bg-[#0B1921] border border-[#32576F] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#ED7C00]"
          required
        >
          <option value="">Seleccionar...</option>
          {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[#7A9BAD] text-[10px] uppercase tracking-wide block mb-1">Fecha emisión</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required
            className="w-full bg-[#0B1921] border border-[#32576F] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#ED7C00]" />
        </div>
        <div>
          <label className="text-[#7A9BAD] text-[10px] uppercase tracking-wide block mb-1">Cantidad (un.)</label>
          <input type="number" value={cantidad} onChange={e => setCantidad(e.target.value)} min={1} required
            className="w-full bg-[#0B1921] border border-[#32576F] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#ED7C00]" />
        </div>
      </div>
      <div>
        <label className="text-[#7A9BAD] text-[10px] uppercase tracking-wide block mb-1">Costo unitario (opcional)</label>
        <input type="number" value={costo} onChange={e => setCosto(e.target.value)} min={0} step="0.01"
          className="w-full bg-[#0B1921] border border-[#32576F] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#ED7C00]" />
      </div>
      <div>
        <label className="text-[#7A9BAD] text-[10px] uppercase tracking-wide block mb-1">Notas</label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
          className="w-full bg-[#0B1921] border border-[#32576F] text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#ED7C00] resize-none" />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={loading}
          className="flex-1 py-1.5 text-xs font-semibold bg-[#ED7C00] hover:bg-[#D4700A] text-white rounded-lg disabled:opacity-50 transition-colors">
          {loading ? 'Guardando...' : 'Crear orden'}
        </button>
        <button type="button" onClick={onCancel}
          className="flex-1 py-1.5 text-xs font-semibold bg-[#132229] border border-[#32576F] text-[#7A9BAD] hover:text-white rounded-lg transition-colors">
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ── Legend strip ──────────────────────────────────────────────────────────────

function CalendarLegend() {
  return (
    <div className="flex items-center gap-4 flex-wrap text-[10px]">
      {[
        { label: 'Sugerida (motor)', bg: '#132229', border: '#32576F', dashed: true },
        { label: 'Planificada', bg: '#1A2510', border: '#ED7C00', dashed: false },
        { label: 'Confirmada', bg: '#0A2D1A', border: '#2ECC71', dashed: false },
        { label: 'Ordenada', bg: '#0A1A2D', border: '#3B82F6', dashed: false },
      ].map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <div className="w-5 h-3 rounded" style={{
            background: item.bg,
            border: `1.5px ${item.dashed ? 'dashed' : 'solid'} ${item.border}`,
          }} />
          <span className="text-[#CDD4DA]">{item.label}</span>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-3 text-[#7A9BAD]">
        <span>Borde izq. rojo = Crítico</span>
        <span>Borde izq. naranja = Bajo</span>
        <span>Drag & drop para mover</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PurchaseCalendar({ tenantId, localId, refreshKey }: PurchaseCalendarProps) {
  const [data, setData] = useState<StockCalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [meses, setMeses] = useState(3);
  const [viewMode, setViewMode] = useState<'calendar' | 'timeline'>('calendar');
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [selectedOrden, setSelectedOrden] = useState<OrdenCalendario | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.analytics.stockCalendar(tenantId, localId, meses);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar calendario');
    } finally {
      setLoading(false);
    }
  }, [tenantId, localId, meses]);

  useEffect(() => { load(); }, [load]);

  // Refetch when refreshKey changes (e.g. after cart save)
  useEffect(() => {
    if (refreshKey) load();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle drop (move order to new date)
  const handleDropOrder = useCallback(async (orden: OrdenCalendario, newDateStr: string) => {
    if (!data) return;
    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ordenes: prev.ordenes.map(o =>
          (o.id === orden.id && o.producto_nombre_id === orden.producto_nombre_id && o.fecha_emision === orden.fecha_emision)
            ? { ...o, fecha_emision: newDateStr }
            : o
        ),
      };
    });

    if (selectedOrden?.fecha_emision === orden.fecha_emision && selectedOrden?.producto_nombre_id === orden.producto_nombre_id) {
      setSelectedOrden(prev => prev ? { ...prev, fecha_emision: newDateStr } : null);
    }

    // Check if stock would be affected (simple warning)
    const newDate = parseDateStr(newDateStr);
    const origDate = parseDateStr(orden.fecha_emision);
    const daysMoved = Math.round((newDate.getTime() - origDate.getTime()) / 86400000);

    if (daysMoved > 7 && orden.urgencia === 'CRITICO') {
      // Show brief warning — just a console warn, UI shows in side panel
      console.warn(`Warning: moving critical order ${orden.nombre} forward by ${daysMoved} days may cause stockout`);
    }

    // Persist if it's a user order
    if (orden.id != null) {
      setSaving(true);
      try {
        await api.analytics.updateCalendarOrder(tenantId, orden.id, { fecha_emision: newDateStr });
      } catch {
        // Revert on error
        load();
      } finally {
        setSaving(false);
      }
    } else {
      // Motor order moved → create as user order
      setSaving(true);
      try {
        const body: OrdenCompraPlanCreate = {
          producto_nombre_id: orden.producto_nombre_id,
          fecha_emision: newDateStr,
          cantidad: orden.cantidad,
          costo_unitario: orden.costo_unitario,
          estado: 'planificada',
        };
        await api.analytics.createCalendarOrder(tenantId, body);
        load(); // reload to get the new id
      } catch {
        load();
      } finally {
        setSaving(false);
      }
    }
  }, [data, tenantId, load, selectedOrden]);

  const handleUpdateEstado = useCallback(async (orden: OrdenCalendario, newEstado: string) => {
    // Optimistic update
    setData(prev => prev ? {
      ...prev,
      ordenes: prev.ordenes.map(o =>
        o.id === orden.id ? { ...o, estado: newEstado as OrdenCalendario['estado'] } : o
      ),
    } : prev);
    setSelectedOrden(prev => prev ? { ...prev, estado: newEstado as OrdenCalendario['estado'] } : null);

    if (orden.id != null) {
      setSaving(true);
      try {
        await api.analytics.updateCalendarOrder(tenantId, orden.id, { estado: newEstado });
      } catch {
        load();
      } finally {
        setSaving(false);
      }
    } else {
      // Motor order → convert to user order with new estado
      setSaving(true);
      try {
        const body: OrdenCompraPlanCreate = {
          producto_nombre_id: orden.producto_nombre_id,
          fecha_emision: orden.fecha_emision,
          cantidad: orden.cantidad,
          costo_unitario: orden.costo_unitario,
          estado: newEstado,
        };
        await api.analytics.createCalendarOrder(tenantId, body);
        load();
      } finally {
        setSaving(false);
      }
    }
  }, [tenantId, load]);

  const handleEditOrden = useCallback(async (orden: OrdenCalendario, update: Partial<OrdenCalendario>) => {
    if (orden.id != null) {
      const body: OrdenCompraPlanUpdate = {};
      if (update.cantidad != null) body.cantidad = update.cantidad;
      if (update.notas != null) body.notas = update.notas;
      setSaving(true);
      try {
        await api.analytics.updateCalendarOrder(tenantId, orden.id, body);
        setData(prev => prev ? {
          ...prev,
          ordenes: prev.ordenes.map(o => o.id === orden.id ? { ...o, ...update } : o),
        } : prev);
        setSelectedOrden(prev => prev ? { ...prev, ...update } : null);
      } finally {
        setSaving(false);
      }
    }
  }, [tenantId]);

  // Products list for create form
  const productos = data
    ? [...new Map(data.ordenes.map(o => [o.producto_nombre_id, { id: o.producto_nombre_id, nombre: o.nombre }])).values()]
    : [];

  const visibleOrdenes = data?.ordenes ?? [];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {/* Horizon selector */}
          <span className="text-[#7A9BAD] text-xs">Horizonte:</span>
          {[1, 2, 3, 6].map(m => (
            <button
              key={m}
              onClick={() => setMeses(m)}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${meses === m ? 'bg-[#ED7C00]/15 border-[#ED7C00]/50 text-[#ED7C00]' : 'bg-[#132229] border-[#32576F] text-[#7A9BAD] hover:text-white'}`}
            >
              {m} {m === 1 ? 'mes' : 'meses'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {saving && <div className="w-3.5 h-3.5 border border-[#ED7C00] border-t-transparent rounded-full animate-spin" />}
          {/* View toggle */}
          <div className="flex bg-[#0E1F29] border border-[#32576F] rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${viewMode === 'calendar' ? 'bg-[#32576F] text-white' : 'text-[#7A9BAD] hover:text-white'}`}
            >
              📅 Calendario
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${viewMode === 'timeline' ? 'bg-[#32576F] text-white' : 'text-[#7A9BAD] hover:text-white'}`}
            >
              ⏱ Timeline
            </button>
          </div>
          <button
            onClick={() => setShowCreateForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#ED7C00] hover:bg-[#D4700A] text-white rounded-lg transition-colors"
          >
            + Nueva orden
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-[#0E1F29] border border-[#ED7C00]/30 rounded-xl p-4">
          <p className="text-white text-xs font-semibold mb-3">Nueva orden de compra</p>
          <CreateOrderForm
            productos={productos}
            tenantId={tenantId}
            onCreated={() => { setShowCreateForm(false); load(); }}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* Monthly KPI cards */}
          <MesKpiCards kpis={data.kpis_por_mes} total={data.inversion_total} urgentes={data.ordenes_urgentes} />

          {/* Legend */}
          <CalendarLegend />

          {/* Calendar view */}
          {viewMode === 'calendar' && (
            <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
              {/* Month nav */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
                    else setCalMonth(m => m - 1);
                  }}
                  className="p-1.5 rounded text-[#7A9BAD] hover:text-white hover:bg-[#132229] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h4 className="text-white font-semibold">{MESES_ES[calMonth]} {calYear}</h4>
                <button
                  onClick={() => {
                    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
                    else setCalMonth(m => m + 1);
                  }}
                  className="p-1.5 rounded text-[#7A9BAD] hover:text-white hover:bg-[#132229] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <CalendarMonthView
                year={calYear}
                month={calMonth}
                ordenes={visibleOrdenes.filter(o => {
                  const d = parseDateStr(o.fecha_emision);
                  return d.getFullYear() === calYear && d.getMonth() === calMonth;
                })}
                onOrderClick={setSelectedOrden}
                onDropOrder={handleDropOrder}
              />

              {/* No ordenes this month */}
              {visibleOrdenes.filter(o => {
                const d = parseDateStr(o.fecha_emision);
                return d.getFullYear() === calYear && d.getMonth() === calMonth;
              }).length === 0 && (
                <p className="text-center text-[#7A9BAD] text-sm mt-4">Sin órdenes este mes</p>
              )}
            </div>
          )}

          {/* Timeline view */}
          {viewMode === 'timeline' && (
            <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
              <p className="text-white text-xs font-semibold mb-3">Timeline por semana</p>
              <TimelineView ordenes={visibleOrdenes} onOrderClick={setSelectedOrden} />
            </div>
          )}

          {/* Cash flow chart */}
          {data.flujo_caja.length > 0 && <FlujoCajaChart data={data.flujo_caja} />}
        </>
      )}

      {/* Side Panel */}
      {selectedOrden && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedOrden(null)} />
          <SidePanel
            orden={selectedOrden}
            onClose={() => setSelectedOrden(null)}
            onUpdateEstado={(estado) => handleUpdateEstado(selectedOrden, estado)}
            onEdit={(update) => handleEditOrden(selectedOrden, update)}
          />
        </>
      )}
    </div>
  );
}
