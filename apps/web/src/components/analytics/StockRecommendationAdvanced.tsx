'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, Cell,
} from 'recharts';
import {
  api,
  type RecomendacionAvanzadaItem,
  type RecomendacionAvanzadaResponse,
} from '@/lib/api';
import { ChartContainer } from './ChartContainer';

interface Props {
  tenantId: string;
  localId?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const ESTADO_CONFIG = {
  CRITICO: { label: 'CRÍTICO', bg: 'bg-[#3D1A0A]', text: 'text-[#ED7C00]', dot: 'bg-[#ED7C00]', bar: '#ED7C00' },
  BAJO:    { label: 'BAJO',    bg: 'bg-[#2D2A0A]', text: 'text-[#D4A017]', dot: 'bg-[#D4A017]', bar: '#D4A017' },
  OK:      { label: 'OK',      bg: 'bg-[#0A2D1A]', text: 'text-[#2ECC71]', dot: 'bg-[#2ECC71]', bar: '#2ECC71' },
  EXCESO:  { label: 'EXCESO',  bg: 'bg-[#0A1A2D]', text: 'text-[#5B9BD5]', dot: 'bg-[#5B9BD5]', bar: '#5B9BD5' },
} as const;

const TEMPORADA_FASE_CONFIG = {
  fuera:          { label: 'Fuera de temp.', bg: 'bg-[#1E3340]/50', text: 'text-[#7A9BAD]', dot: 'bg-[#7A9BAD]' },
  pre_temporada:  { label: '¡Emitir orden!', bg: 'bg-[#3D1A0A]', text: 'text-[#ED7C00]', dot: 'bg-[#ED7C00]' },
  en_temporada:   { label: 'En temporada', bg: 'bg-[#0A2D1A]', text: 'text-[#2ECC71]', dot: 'bg-[#2ECC71]' },
  liquidacion:    { label: 'Liquidación', bg: 'bg-[#2D2A0A]', text: 'text-[#D4A017]', dot: 'bg-[#D4A017]' },
} as const;

const TIPO_ICONS: Record<string, string> = { Basico: '🔄', Temporada: '📅', Quiebre: '⚡' };
const TIPOS = ['Basico', 'Temporada', 'Quiebre'] as const;
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const TENDENCIA_MAP = {
  up:     { arrow: '↑', color: 'text-[#2ECC71]' },
  down:   { arrow: '↓', color: 'text-[#ED7C00]' },
  stable: { arrow: '→', color: 'text-[#7A9BAD]' },
} as const;

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function fmtN(n: number) { return new Intl.NumberFormat('es-AR').format(n); }

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-bold text-xl ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-[#7A9BAD] text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function EstadoBadge({ item }: { item: RecomendacionAvanzadaItem }) {
  // Temporada products show fase-specific badge
  if (item.tipo === 'Temporada' && item.temporada_fase) {
    const cfg = TEMPORADA_FASE_CONFIG[item.temporada_fase];
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
    );
  }
  const cfg = ESTADO_CONFIG[item.estado];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function TipoSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex items-center gap-1 text-xs px-2 py-1 bg-[#0E1F29] border border-[#32576F] rounded hover:border-[#ED7C00] transition-colors"
      >
        <span>{TIPO_ICONS[value] ?? '🔄'}</span>
        <span className="text-[#CDD4DA]">{value}</span>
      </button>
      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 bg-[#0E1F29] border border-[#32576F] rounded shadow-lg">
          {TIPOS.map(t => (
            <button
              key={t}
              onClick={(e) => { e.stopPropagation(); onChange(t); setOpen(false); }}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[#1E3340] transition-colors ${t === value ? 'text-[#ED7C00]' : 'text-[#CDD4DA]'}`}
            >
              <span>{TIPO_ICONS[t]}</span> {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditableNumber({ value, onSave, suffix }: { value: number; onSave: (v: number) => void; suffix?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!editing) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setDraft(String(value)); setEditing(true); }}
        className="text-xs text-[#CDD4DA] hover:text-[#ED7C00] transition-colors cursor-text"
      >
        {value}{suffix ?? ''}
      </button>
    );
  }
  return (
    <input
      type="number"
      value={draft}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const n = parseInt(draft); if (!isNaN(n) && n >= 0) onSave(n); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { const n = parseInt(draft); if (!isNaN(n) && n >= 0) onSave(n); setEditing(false); }
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-14 text-xs bg-[#0E1F29] border border-[#ED7C00] rounded px-1 py-0.5 text-white text-center focus:outline-none"
    />
  );
}

function FechaLimiteCell({ item }: { item: RecomendacionAvanzadaItem }) {
  // Temporada: show fase-specific info
  if (item.tipo === 'Temporada') {
    if (item.temporada_fase === 'fuera') {
      if (item.temporada_fecha_orden) {
        const d = new Date(item.temporada_fecha_orden);
        return <span className="text-[#7A9BAD] text-xs">{d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>;
      }
      return <span className="text-[#7A9BAD]">—</span>;
    }
    if (item.temporada_fase === 'pre_temporada') {
      return <span className="text-[#ED7C00] font-bold text-xs animate-pulse">¡YA!</span>;
    }
    if (item.temporada_fase === 'liquidacion') {
      return <span className="text-[#D4A017] text-xs">Liquidar</span>;
    }
    // en_temporada: use normal fecha logic
  }

  // Básico / Quiebre / en_temporada
  const { fecha_limite_compra: fecha, cobertura_dias: cobertura, punto_reorden } = item;
  if (cobertura >= 999) return <span className="text-[#7A9BAD]">—</span>;
  if (fecha === null || cobertura < punto_reorden) {
    return <span className="text-[#ED7C00] font-bold text-xs animate-pulse">¡YA!</span>;
  }
  const d = new Date(fecha);
  const today = new Date();
  const diffDays = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 7) return <span className="text-[#ED7C00] font-semibold text-xs">{diffDays}d</span>;
  return <span className="text-[#CDD4DA] text-xs">{diffDays}d</span>;
}

// ── Temporada Config Form ────────────────────────────────────────────────────

function MonthSelect({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[#7A9BAD] text-xs">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v)) onChange(v); }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0E1F29] border border-[#32576F] text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[#ED7C00]"
      >
        <option value="">—</option>
        {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
      </select>
    </div>
  );
}

function TemporadaConfigForm({ item, tenantId, onUpdate }: {
  item: RecomendacionAvanzadaItem;
  tenantId: string;
  onUpdate: (pnId: number, fields: Partial<RecomendacionAvanzadaItem>) => void;
}) {
  const [saving, setSaving] = useState(false);

  const save = async (fields: { temporada_mes_inicio?: number; temporada_mes_fin?: number; temporada_mes_liquidacion?: number; temporada_cantidad_estimada?: number }) => {
    setSaving(true);
    try {
      await api.analytics.updateClasificacion(tenantId, {
        producto_nombre_id: item.producto_nombre_id,
        ...fields,
      });
      onUpdate(item.producto_nombre_id, fields);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <tr className="border-b border-[#1A3040]/60" onClick={(e) => e.stopPropagation()}>
      <td colSpan={13} className="px-10 py-3">
        <div className="bg-[#0E1F29] rounded-lg p-3 border border-[#32576F]">
          <p className="text-[#CDD4DA] text-xs font-semibold mb-2">Configuración de temporada</p>
          <div className="flex flex-wrap gap-4 items-end">
            <MonthSelect
              label="Inicio temporada"
              value={item.temporada_mes_inicio}
              onChange={(v) => save({ temporada_mes_inicio: v })}
            />
            <MonthSelect
              label="Fin temporada"
              value={item.temporada_mes_fin}
              onChange={(v) => save({ temporada_mes_fin: v })}
            />
            <MonthSelect
              label="Inicio liquidación"
              value={item.temporada_mes_liquidacion}
              onChange={(v) => save({ temporada_mes_liquidacion: v })}
            />
            <div className="flex flex-col gap-1">
              <label className="text-[#7A9BAD] text-xs">Cant. estimada</label>
              <input
                type="number"
                value={item.temporada_cantidad_estimada ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v >= 0) save({ temporada_cantidad_estimada: v });
                }}
                placeholder="Auto"
                className="w-20 bg-[#0E1F29] border border-[#32576F] text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[#ED7C00]"
              />
            </div>
            {item.temporada_ventas_anterior != null && (
              <div className="text-xs text-[#7A9BAD] self-center">
                Ventas temp. anterior: <span className="text-[#CDD4DA] font-semibold">{fmtN(item.temporada_ventas_anterior)}</span> un
              </div>
            )}
            {saving && <span className="w-3 h-3 border border-[#ED7C00] border-t-transparent rounded-full animate-spin self-center" />}
          </div>
          {item.temporada_alerta && (
            <p className="mt-2 text-xs text-[#ED7C00] bg-[#3D1A0A] rounded px-2 py-1">{item.temporada_alerta}</p>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── SKU Row ──────────────────────────────────────────────────────────────────

function SkuRow({ sku }: { sku: RecomendacionAvanzadaItem['skus'][0] }) {
  return (
    <tr className="border-b border-[#1A3040]/60 last:border-0">
      <td className="pl-10 pr-3 py-2 text-xs text-[#7A9BAD]" colSpan={2}>
        {[sku.descripcion, sku.talle, sku.color].filter(Boolean).join(' · ') || '—'}
      </td>
      <td className="px-3 py-2 text-xs text-[#CDD4DA] text-right">{sku.vendidas_30d}</td>
      <td className="px-3 py-2 text-xs text-[#CDD4DA] text-right">{sku.stock}</td>
      <td className="px-3 py-2 text-xs text-[#CDD4DA] text-right">{sku.velocidad_diaria.toFixed(1)}</td>
      <td colSpan={8} />
    </tr>
  );
}

// ── Projection chart (Básico/Quiebre) ────────────────────────────────────────

function ProjectionChart({ item }: { item: RecomendacionAvanzadaItem }) {
  const { proyeccion_stock, lead_time_dias, stock_seguridad_dias, velocidad_diaria, stock_actual, punto_reorden } = item;
  if (!proyeccion_stock.length || velocidad_diaria <= 0) {
    return <p className="text-[#7A9BAD] text-sm text-center py-4">Sin datos suficientes para proyectar.</p>;
  }

  const puntoReordenUnidades = velocidad_diaria * punto_reorden;
  const diasHastaReorden = puntoReordenUnidades < stock_actual
    ? Math.round((stock_actual - puntoReordenUnidades) / velocidad_diaria)
    : 0;
  const diasHastaQuiebre = Math.round(stock_actual / velocidad_diaria);

  return (
    <div className="mt-4 p-4 bg-[#0E1F29] rounded-xl border border-[#32576F]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-white text-sm font-semibold">{item.nombre} · Proyección de stock</h4>
          <p className="text-[#7A9BAD] text-xs mt-0.5">
            Velocidad: {velocidad_diaria.toFixed(1)} un/día · Lead time: {lead_time_dias}d · Seguridad: {stock_seguridad_dias}d
          </p>
        </div>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-[#5B9BD5] rounded" />Stock proyectado</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-[#ED7C00] rounded" />Punto de reorden</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={proyeccion_stock} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E3340" />
          <XAxis dataKey="dia" tick={{ fill: '#7A9BAD', fontSize: 11 }} label={{ value: 'Días', position: 'insideBottomRight', offset: -5, fill: '#7A9BAD', fontSize: 11 }} />
          <YAxis tick={{ fill: '#7A9BAD', fontSize: 11 }} label={{ value: 'Unidades', angle: -90, position: 'insideLeft', offset: 10, fill: '#7A9BAD', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#132229', border: '1px solid #32576F', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#7A9BAD' }}
            formatter={(val: number) => [`${Math.round(val)} un`, 'Stock']}
            labelFormatter={(d: number) => `Día ${d}`}
          />
          <Line type="monotone" dataKey="stock" stroke="#5B9BD5" strokeWidth={2} dot={false} />
          <ReferenceLine y={puntoReordenUnidades} stroke="#ED7C00" strokeDasharray="6 3" label={{ value: `Reorden: ${Math.round(puntoReordenUnidades)} un`, fill: '#ED7C00', fontSize: 11, position: 'right' }} />
          {diasHastaReorden > 0 && (
            <ReferenceLine x={diasHastaReorden} stroke="#D4A017" strokeDasharray="4 4" label={{ value: 'Emitir orden', fill: '#D4A017', fontSize: 10, position: 'top' }} />
          )}
          {diasHastaQuiebre > 0 && diasHastaQuiebre < (proyeccion_stock[proyeccion_stock.length - 1]?.dia ?? 0) + 1 && (
            <ReferenceLine x={diasHastaQuiebre} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'Quiebre stock', fill: '#EF4444', fontSize: 10, position: 'top' }} />
          )}
          <ReferenceLine x={lead_time_dias} stroke="#7A9BAD" strokeDasharray="2 4" label={{ value: 'Llegada (si comprás hoy)', fill: '#7A9BAD', fontSize: 9, position: 'insideTopRight' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Temporada Timeline Chart ─────────────────────────────────────────────────

function TemporadaTimelineChart({ item }: { item: RecomendacionAvanzadaItem }) {
  const { temporada_mes_inicio, temporada_mes_fin, temporada_mes_liquidacion, ventas_mensuales } = item;
  const currentMonth = new Date().getMonth() + 1; // 1-12

  const hasData = ventas_mensuales.some(v => v.unidades > 0);

  // Build chart data: 12 months with zone coloring
  const chartData = MESES.map((label, i) => {
    const mes = i + 1;
    const venta = ventas_mensuales.find(v => v.mes === mes);
    let zone: 'temporada' | 'liquidacion' | 'fuera' = 'fuera';

    if (temporada_mes_inicio != null && temporada_mes_fin != null) {
      const mesLiq = temporada_mes_liquidacion ?? temporada_mes_fin;
      const inTemporada = temporada_mes_inicio <= (mesLiq > 0 ? mesLiq - 1 : 12)
        ? (mes >= temporada_mes_inicio && mes < mesLiq)
        : (mes >= temporada_mes_inicio || mes < mesLiq);
      const inLiquidacion = mesLiq <= temporada_mes_fin
        ? (mes >= mesLiq && mes <= temporada_mes_fin)
        : (mes >= mesLiq || mes <= temporada_mes_fin);
      if (inTemporada) zone = 'temporada';
      else if (inLiquidacion) zone = 'liquidacion';
    }

    return {
      label,
      mes,
      unidades: venta?.unidades ?? 0,
      fill: zone === 'temporada' ? '#2ECC71' : zone === 'liquidacion' ? '#D4A017' : '#4A6878',
      isCurrent: mes === currentMonth,
    };
  });

  // Calculate order emission month for the marker
  let ordenMes: number | null = null;
  if (item.temporada_fecha_orden) {
    ordenMes = new Date(item.temporada_fecha_orden).getMonth() + 1;
  }

  return (
    <div className="mt-4 p-4 bg-[#0E1F29] rounded-xl border border-[#32576F]">
      {/* Temporada summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard
          label="Estado"
          value={item.temporada_fase ? TEMPORADA_FASE_CONFIG[item.temporada_fase].label : '—'}
          color={item.temporada_fase === 'pre_temporada' ? 'text-[#ED7C00]'
            : item.temporada_fase === 'en_temporada' ? 'text-[#2ECC71]'
            : item.temporada_fase === 'liquidacion' ? 'text-[#D4A017]'
            : 'text-[#7A9BAD]'}
        />
        <SummaryCard
          label="Fecha de orden"
          value={item.temporada_fecha_orden
            ? (new Date(item.temporada_fecha_orden) <= new Date() ? '¡YA!' : new Date(item.temporada_fecha_orden).toLocaleDateString('es-AR'))
            : '—'}
          color={item.temporada_fase === 'pre_temporada' ? 'text-[#ED7C00]' : 'text-white'}
        />
        <SummaryCard
          label="Cantidad sugerida"
          value={item.sugerencia_compra > 0 ? `${fmtN(item.sugerencia_compra)} un` : '—'}
          sub={item.temporada_ventas_anterior != null ? `temp. anterior: ${fmtN(item.temporada_ventas_anterior)}` : 'sin datos anteriores'}
        />
        <SummaryCard
          label="Inversión estimada"
          value={item.inversion_sugerida > 0 ? fmt(item.inversion_sugerida) : '—'}
          color="text-[#ED7C00]"
        />
      </div>

      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-white text-sm font-semibold">{item.nombre} · Timeline anual</h4>
          <p className="text-[#7A9BAD] text-xs mt-0.5">
            Ventas mensuales del año anterior · Lead time: {item.lead_time_dias}d
          </p>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-[#2ECC71] rounded-sm" />Temporada</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-[#D4A017] rounded-sm" />Liquidación</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 bg-[#4A6878] rounded-sm" />Fuera</span>
        </div>
      </div>

      {!hasData && (
        <p className="text-[#7A9BAD] text-sm text-center py-4 mb-2">
          Sin datos de temporada anterior. Ingresá cantidad estimada manualmente.
        </p>
      )}

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E3340" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#7A9BAD', fontSize: 11 }} />
          <YAxis tick={{ fill: '#7A9BAD', fontSize: 11 }} label={{ value: 'Unidades', angle: -90, position: 'insideLeft', offset: 10, fill: '#7A9BAD', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#132229', border: '1px solid #32576F', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#7A9BAD' }}
            formatter={(val: number) => [`${val} un`, 'Ventas']}
          />
          <Bar dataKey="unidades" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} stroke={entry.isCurrent ? '#ED7C00' : 'none'} strokeWidth={entry.isCurrent ? 2 : 0} />
            ))}
          </Bar>
          {/* Current month marker */}
          <ReferenceLine x={MESES[currentMonth - 1]} stroke="#ED7C00" strokeDasharray="4 4" label={{ value: 'HOY', fill: '#ED7C00', fontSize: 10, position: 'top' }} />
          {/* Order emission marker */}
          {ordenMes && (
            <ReferenceLine x={MESES[ordenMes - 1]} stroke="#EF4444" strokeDasharray="6 3" label={{ value: 'Emitir orden', fill: '#EF4444', fontSize: 10, position: 'top' }} />
          )}
        </BarChart>
      </ResponsiveContainer>

      {item.temporada_alerta && (
        <p className="mt-2 text-xs text-[#ED7C00] bg-[#3D1A0A] rounded px-3 py-2">{item.temporada_alerta}</p>
      )}
      {item.temporada_fase === 'liquidacion' && item.stock_actual > 0 && (
        <p className="mt-2 text-xs text-[#D4A017] bg-[#2D2A0A] rounded px-3 py-2">
          Liquidar {fmtN(item.stock_actual)} unidades restantes. No reponer.
        </p>
      )}
    </div>
  );
}

// ── Top 10 Urgency Chart ─────────────────────────────────────────────────────

function Top10UrgencyChart({ items }: { items: RecomendacionAvanzadaItem[] }) {
  const top10 = items
    .filter(i => i.velocidad_diaria > 0 || (i.tipo === 'Temporada' && i.temporada_fase === 'pre_temporada'))
    .map(i => {
      let diasHasta: number;
      if (i.tipo === 'Temporada' && i.temporada_fase === 'pre_temporada') {
        diasHasta = i.temporada_fecha_orden
          ? Math.ceil((new Date(i.temporada_fecha_orden).getTime() - Date.now()) / 86400000)
          : -999;
      } else {
        diasHasta = i.cobertura_dias < 999
          ? Math.round(i.cobertura_dias - i.punto_reorden)
          : 999;
      }
      return { ...i, dias_hasta_reorden: diasHasta };
    })
    .filter(i => i.dias_hasta_reorden < 999)
    .sort((a, b) => a.dias_hasta_reorden - b.dias_hasta_reorden)
    .slice(0, 10);

  if (!top10.length) return null;

  const chartData = top10.map(i => ({
    nombre: i.nombre.length > 18 ? i.nombre.slice(0, 18) + '…' : i.nombre,
    dias: i.dias_hasta_reorden,
    fill: i.dias_hasta_reorden < 0 ? '#ED7C00' : i.dias_hasta_reorden < 7 ? '#D4A017' : '#2ECC71',
  }));

  return (
    <div className="mt-4 p-4 bg-[#0E1F29] rounded-xl border border-[#32576F]">
      <h4 className="text-white text-sm font-semibold mb-1">Top 10 productos por urgencia de compra</h4>
      <p className="text-[#7A9BAD] text-xs mb-3">Días hasta punto de reorden (negativo = ya debés comprar)</p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E3340" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#7A9BAD', fontSize: 11 }} />
          <YAxis type="category" dataKey="nombre" tick={{ fill: '#CDD4DA', fontSize: 11 }} width={95} />
          <Tooltip
            contentStyle={{ backgroundColor: '#132229', border: '1px solid #32576F', borderRadius: 8, fontSize: 12 }}
            formatter={(val: number) => [`${val} días`, 'Hasta reorden']}
          />
          <ReferenceLine x={0} stroke="#ED7C00" strokeDasharray="4 4" />
          <Bar dataKey="dias" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function StockRecommendationAdvanced({ tenantId, localId }: Props) {
  const [data, setData] = useState<RecomendacionAvanzadaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [showTemporadaConfig, setShowTemporadaConfig] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.analytics.recomendacionAvanzada(tenantId, localId);
      setData(res);
    } catch {
      setError('No se pudo cargar la recomendación avanzada.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, localId]);

  useEffect(() => { load(); }, [load]);

  const toggleRow = (nombre: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  };

  const handleSelectItem = (nombre: string) => {
    setSelectedItem(prev => prev === nombre ? null : nombre);
  };

  const handleTipoChange = async (item: RecomendacionAvanzadaItem, newTipo: string) => {
    try {
      await api.analytics.updateClasificacion(tenantId, {
        producto_nombre_id: item.producto_nombre_id,
        tipo_recompra: newTipo,
      });
      // Optimistic update
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map(i =>
            i.producto_nombre_id === item.producto_nombre_id
              ? { ...i, tipo: newTipo as RecomendacionAvanzadaItem['tipo'] }
              : i
          ),
        };
      });
      // Auto-show temporada config when switching to Temporada
      if (newTipo === 'Temporada') {
        setShowTemporadaConfig(prev => new Set(prev).add(item.producto_nombre_id));
      } else {
        setShowTemporadaConfig(prev => {
          const next = new Set(prev);
          next.delete(item.producto_nombre_id);
          return next;
        });
      }
    } catch { /* ignore */ }
  };

  const handleTemporadaUpdate = (pnId: number, fields: Partial<RecomendacionAvanzadaItem>) => {
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(i =>
          i.producto_nombre_id === pnId ? { ...i, ...fields } : i
        ),
      };
    });
  };

  const handleLeadTimeChange = async (item: RecomendacionAvanzadaItem, newLt: number) => {
    if (!item.proveedor_id) return;
    try {
      await api.analytics.updateLeadTime(tenantId, {
        proveedor_id: item.proveedor_id,
        lead_time_dias: newLt,
      });
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map(i => {
            if (i.proveedor_id !== item.proveedor_id) return i;
            const newPR = newLt + i.stock_seguridad_dias;
            return { ...i, lead_time_dias: newLt, punto_reorden: newPR };
          }),
        };
      });
    } catch { /* ignore */ }
  };

  const handleSeguridadChange = async (item: RecomendacionAvanzadaItem, newSeg: number) => {
    try {
      await api.analytics.updateClasificacion(tenantId, {
        producto_nombre_id: item.producto_nombre_id,
        stock_seguridad_dias: newSeg,
      });
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map(i => {
            if (i.producto_nombre_id !== item.producto_nombre_id) return i;
            const newPR = i.lead_time_dias + newSeg;
            return { ...i, stock_seguridad_dias: newSeg, punto_reorden: newPR };
          }),
        };
      });
    } catch { /* ignore */ }
  };

  const filtered = (data?.items ?? []).filter(item =>
    search === '' || item.nombre.toLowerCase().includes(search.toLowerCase())
  );

  const selectedItemData = selectedItem ? filtered.find(i => i.nombre === selectedItem) : null;

  return (
    <ChartContainer
      title="Recomendación de compra · Modo avanzado"
      subtitle="Análisis histórico con clasificación de productos"
      exportFileName="recomendacion_avanzada"
    >
      {/* Summary cards */}
      {!loading && data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <SummaryCard
            label="Inversión total sugerida"
            value={fmt(data.inversion_total_sugerida)}
            color="text-[#ED7C00]"
          />
          <SummaryCard
            label="Productos críticos"
            value={String(data.productos_criticos)}
            sub="cobertura < punto de reorden"
            color={data.productos_criticos > 0 ? 'text-[#ED7C00]' : 'text-[#2ECC71]'}
          />
          <SummaryCard
            label="Comprar antes de 7 días"
            value={String(data.comprar_antes_7d)}
            sub="urgencia alta"
            color={data.comprar_antes_7d > 0 ? 'text-[#D4A017]' : 'text-[#2ECC71]'}
          />
          <SummaryCard
            label="Productos en exceso"
            value={String(data.productos_exceso)}
            sub="cobertura > 60 días"
            color="text-[#5B9BD5]"
          />
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre de producto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-[#0E1F29] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-[#CDD4DA] placeholder-[#7A9BAD] focus:outline-none focus:border-[#ED7C00] transition-colors"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <span className="w-5 h-5 border-2 border-[#32576F] border-t-[#ED7C00] rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <p className="text-[#ED7C00] text-sm text-center py-8">{error}</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-[#7A9BAD] text-sm text-center py-8">
          {search ? 'Sin resultados para esa búsqueda.' : 'Sin productos para mostrar.'}
        </p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[#1E3340]">
          <table className="w-full text-left" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <thead>
              <tr className="bg-[#0E1F29] border-b border-[#32576F]">
                <th className="px-4 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide">Producto</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide">Tipo</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Vend. 30d</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Stock</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Vel./día</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Cobert.</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Lead T.</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Segur.</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">P.Reord.</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-center">Tend.</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Estado</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Inversión</th>
                <th className="px-2 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Fecha</th>
              </tr>
            </thead>
            <tbody className="bg-[#132229]">
              {filtered.map(item => {
                const isExpanded = expanded.has(item.nombre);
                const isSelected = selectedItem === item.nombre;
                const cfg = ESTADO_CONFIG[item.estado];
                const tend = TENDENCIA_MAP[item.tendencia];
                const coverageDisplay = item.cobertura_dias >= 999 ? '∞' : `${Math.round(item.cobertura_dias)}d`;
                const coberturaRed = item.cobertura_dias < item.punto_reorden && item.cobertura_dias < 999;
                const showTempConfig = item.tipo === 'Temporada' && showTemporadaConfig.has(item.producto_nombre_id);

                return (
                  <><tr
                    key={item.nombre}
                    className={`border-b border-[#1E3340] cursor-pointer hover:bg-[#1A2E3A] transition-colors ${isSelected ? 'bg-[#1A2E3A] ring-1 ring-[#ED7C00]/30' : isExpanded ? 'bg-[#152530]' : ''}`}
                    onClick={() => handleSelectItem(item.nombre)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleRow(item.nombre); }}
                          className={`text-xs transition-transform duration-200 text-[#7A9BAD] ${isExpanded ? 'rotate-90' : ''}`}
                        >▶</button>
                        <span className="text-sm text-white font-medium truncate max-w-[140px]" title={item.nombre}>{item.nombre}</span>
                        {item.skus.length > 0 && <span className="text-xs text-[#7A9BAD]">({item.skus.length})</span>}
                        {item.tipo === 'Temporada' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowTemporadaConfig(prev => {
                                const next = new Set(prev);
                                if (next.has(item.producto_nombre_id)) next.delete(item.producto_nombre_id);
                                else next.add(item.producto_nombre_id);
                                return next;
                              });
                            }}
                            className="text-xs text-[#7A9BAD] hover:text-[#ED7C00] transition-colors"
                            title="Configurar temporada"
                          >⚙</button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
                      <TipoSelector value={item.tipo} onChange={(v) => handleTipoChange(item, v)} />
                    </td>
                    <td className="px-2 py-2.5 text-sm text-[#CDD4DA] text-right">{fmtN(item.vendidas_30d)}</td>
                    <td className="px-2 py-2.5 text-sm text-[#CDD4DA] text-right">{fmtN(item.stock_actual)}</td>
                    <td className="px-2 py-2.5 text-sm text-[#CDD4DA] text-right">{item.velocidad_diaria.toFixed(1)}</td>
                    <td className="px-2 py-2.5 text-sm text-right">
                      <span className={coberturaRed ? 'text-[#ED7C00] font-semibold' : item.cobertura_dias >= 999 ? 'text-[#7A9BAD]' : cfg.text}>
                        {coverageDisplay}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                      <EditableNumber value={item.lead_time_dias} onSave={(v) => handleLeadTimeChange(item, v)} suffix="d" />
                    </td>
                    <td className="px-2 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                      <EditableNumber value={item.stock_seguridad_dias} onSave={(v) => handleSeguridadChange(item, v)} suffix="d" />
                    </td>
                    <td className="px-2 py-2.5 text-sm text-right">
                      <span className={coberturaRed ? 'text-[#ED7C00] font-semibold' : 'text-[#CDD4DA]'}>
                        {item.punto_reorden}d
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <span className={`text-base ${tend.color}`}>{tend.arrow}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right"><EstadoBadge item={item} /></td>
                    <td className="px-2 py-2.5 text-right">
                      {item.inversion_sugerida > 0 ? (
                        <span className="text-xs text-[#ED7C00] font-semibold">{fmt(item.inversion_sugerida)}</span>
                      ) : (
                        <span className="text-xs text-[#7A9BAD]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <FechaLimiteCell item={item} />
                    </td>
                  </tr>
                  {/* Temporada config form */}
                  {showTempConfig && (
                    <TemporadaConfigForm item={item} tenantId={tenantId} onUpdate={handleTemporadaUpdate} />
                  )}
                  {/* Expanded SKUs */}
                  {isExpanded && item.skus.length > 0 && item.skus.map((sku, i) => (
                    <SkuRow key={`${item.nombre}-sku-${i}`} sku={sku} />
                  ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Chart: Temporada timeline or Básico/Quiebre projection or Top 10 urgency */}
      {!loading && !error && data && data.items.length > 0 && (
        selectedItemData
          ? (selectedItemData.tipo === 'Temporada'
            ? <TemporadaTimelineChart item={selectedItemData} />
            : <ProjectionChart item={selectedItemData} />
          )
          : <Top10UrgencyChart items={data.items} />
      )}
    </ChartContainer>
  );
}
