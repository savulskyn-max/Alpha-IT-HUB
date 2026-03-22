'use client';

import { useState, useCallback } from 'react';
import type { AbcNombre } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreeItem {
  name: string;
  value: number;      // monto_stock (ARS)
  cobertura: number;  // cobertura_dias
  rotacion: number;
  abc: string;
}

interface InventarioTreemapProps {
  data: AbcNombre[];
  onProductClick?: (nombre: string) => void;
}

// ── Health color mapping ──────────────────────────────────────────────────────

function getHealthColor(cobertura: number): string {
  if (cobertura >= 999) return '#6D28D9';   // violet — sin rotación (capital inmovilizado)
  if (cobertura < 7)    return '#DC2626';   // red    — CRÍTICO
  if (cobertura < 15)   return '#D97706';   // amber  — BAJO
  if (cobertura >= 60)  return '#1D4ED8';   // blue   — EXCESO (con rotación)
  return '#15803D';                          // green  — OK
}

function getHealthLabel(cobertura: number): string {
  if (cobertura >= 999) return 'Sin rotación';
  if (cobertura < 7)    return 'CRÍTICO';
  if (cobertura < 15)   return 'BAJO';
  if (cobertura >= 60)  return 'EXCESO';
  return 'OK';
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

// ── Legend ────────────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  { color: '#15803D', label: 'OK',            sub: '15–59 días' },
  { color: '#D97706', label: 'Bajo',           sub: '7–14 días' },
  { color: '#DC2626', label: 'Crítico',        sub: '< 7 días' },
  { color: '#1D4ED8', label: 'Exceso (rota)',  sub: '≥ 60 días' },
  { color: '#6D28D9', label: 'Sin rotación',   sub: 'capital inmovilizado' },
];

// ── Treemap block ─────────────────────────────────────────────────────────────

interface BlockProps {
  item: TreeItem;
  totalValue: number;
  onClick?: () => void;
  onHover: (item: TreeItem | null, x: number, y: number) => void;
}

function TreeBlock({ item, totalValue, onClick, onHover }: BlockProps) {
  const color = getHealthColor(item.cobertura);
  const pct = totalValue > 0 ? item.value / totalValue : 0;

  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => onHover(item, e.clientX, e.clientY)}
      onMouseMove={(e) => onHover(item, e.clientX, e.clientY)}
      onMouseLeave={() => onHover(null, 0, 0)}
      style={{
        flexGrow: item.value,
        flexShrink: 1,
        flexBasis: `${Math.max(pct * 100 * 2.5, 12)}px`,
        backgroundColor: color,
        opacity: 0.88,
        cursor: onClick ? 'pointer' : 'default',
        minWidth: 12,
        position: 'relative',
        overflow: 'hidden',
        transition: 'opacity 0.15s',
      }}
      onMouseOver={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '0.88'; }}
    >
      {/* Label — only visible when block is wide enough */}
      <div
        className="absolute inset-0 flex flex-col justify-start p-1.5 pointer-events-none select-none"
        style={{ gap: 2 }}
      >
        <span
          className="text-white font-semibold leading-tight"
          style={{
            fontSize: Math.min(11, Math.max(9, Math.sqrt(pct) * 80)),
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}
        >
          {item.name}
        </span>
        {pct > 0.03 && (
          <span className="text-white/60 text-[9px] leading-tight font-mono">
            {item.cobertura >= 999 ? '—' : `${item.cobertura.toFixed(0)}d`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipState {
  item: TreeItem;
  x: number;
  y: number;
}

function HoverTooltip({ state }: { state: TooltipState }) {
  const { item, x, y } = state;
  const color = getHealthColor(item.cobertura);
  const healthLabel = getHealthLabel(item.cobertura);

  // Position tooltip so it stays on screen
  const left = x + 16;
  const top = y - 8;

  return (
    <div
      className="fixed z-50 pointer-events-none rounded-xl px-4 py-3 text-sm shadow-2xl"
      style={{
        left,
        top,
        background: '#132229',
        border: '1px solid #32576F',
        fontFamily: 'Space Grotesk, sans-serif',
        minWidth: 210,
        maxWidth: 280,
      }}
    >
      <p className="font-semibold text-white mb-2 truncate">{item.name}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6">
          <span className="text-[#7A9BAD]">Valor stock</span>
          <span className="text-[#ED7C00] font-mono font-semibold">{fmt(item.value)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-[#7A9BAD]">Cobertura</span>
          <span className="text-white font-mono">
            {item.cobertura >= 999 ? '— sin ventas' : `${item.cobertura.toFixed(0)} días`}
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-[#7A9BAD]">Rotación</span>
          <span className="text-white font-mono">{item.rotacion.toFixed(2)}x</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-[#7A9BAD]">Clase ABC</span>
          <span
            className="font-semibold"
            style={{ color: item.abc === 'A' ? '#ED7C00' : item.abc === 'B' ? '#60A5FA' : '#9CA3AF' }}
          >
            Clase {item.abc}
          </span>
        </div>
        <div className="flex justify-between gap-6 pt-1 mt-1 border-t border-[#32576F]">
          <span className="text-[#7A9BAD]">Salud</span>
          <span
            className="font-bold text-xs px-2 py-0.5 rounded"
            style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
          >
            {healthLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Slice-and-dice layout helpers ─────────────────────────────────────────────
// Group items into rows so the layout looks like a real treemap.
// Each row targets ~1/3 of total height (3 rows), items within a row
// get widths proportional to their value share inside the row.

interface Row {
  items: TreeItem[];
  rowValue: number;
}

function buildRows(items: TreeItem[], totalValue: number, targetRows = 3): Row[] {
  if (items.length === 0) return [];
  const targetPerRow = totalValue / targetRows;
  const rows: Row[] = [];
  let current: TreeItem[] = [];
  let currentSum = 0;

  for (const item of items) {
    current.push(item);
    currentSum += item.value;
    if (currentSum >= targetPerRow && rows.length < targetRows - 1) {
      rows.push({ items: current, rowValue: currentSum });
      current = [];
      currentSum = 0;
    }
  }
  if (current.length > 0) {
    rows.push({ items: current, rowValue: currentSum });
  }
  return rows;
}

// ── Main component ────────────────────────────────────────────────────────────

export function InventarioTreemap({ data, onProductClick }: InventarioTreemapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const handleHover = useCallback((item: TreeItem | null, x: number, y: number) => {
    setTooltip(item ? { item, x, y } : null);
  }, []);

  const chartData: TreeItem[] = data
    .filter((p) => p.monto_stock > 0)
    .map((p) => ({
      name: p.nombre,
      value: Math.max(p.monto_stock, 1),
      cobertura: p.cobertura_dias,
      rotacion: p.rotacion,
      abc: p.clasificacion_abc,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 60);

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-[#7A9BAD] text-sm">
        Sin datos de inventario disponibles
      </div>
    );
  }

  const totalValue = chartData.reduce((s, d) => s + d.value, 0);
  const criticos    = chartData.filter((d) => d.cobertura < 7).length;
  const exceso      = chartData.filter((d) => d.cobertura >= 60 && d.cobertura < 999).length;
  const ok          = chartData.filter((d) => d.cobertura >= 15 && d.cobertura < 60).length;
  const sinRotacion = chartData.filter((d) => d.cobertura >= 999).length;

  // Build rows for treemap-like layout
  const rows = buildRows(chartData, totalValue);

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[#7A9BAD] text-xs">
          {chartData.length} productos · {fmt(totalValue)} total
        </span>
        <div className="flex gap-2 flex-wrap">
          {criticos > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/25">
              {criticos} críticos
            </span>
          )}
          {exceso > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/25">
              {exceso} en exceso
            </span>
          )}
          {ok > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/10 text-green-400 border border-green-500/25">
              {ok} OK
            </span>
          )}
          {sinRotacion > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(109,40,217,0.12)', color: '#A78BFA', border: '1px solid rgba(109,40,217,0.3)' }}
            >
              {sinRotacion} sin rotación
            </span>
          )}
        </div>
      </div>

      {/* CSS-based treemap: rows × flex items */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ height: 340, display: 'flex', flexDirection: 'column', gap: 2, background: '#0B1921' }}
      >
        {rows.map((row, ri) => (
          <div
            key={ri}
            style={{
              display: 'flex',
              flex: row.rowValue,
              gap: 2,
              minHeight: 0,
            }}
          >
            {row.items.map((item, ii) => (
              <TreeBlock
                key={`${ri}-${ii}`}
                item={item}
                totalValue={row.rowValue}
                onClick={onProductClick ? () => onProductClick(item.name) : undefined}
                onHover={handleHover}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
            <span className="text-[#CDD4DA] text-xs">{item.label}</span>
            <span className="text-[#7A9BAD] text-xs">({item.sub})</span>
          </div>
        ))}
        <span className="text-[#7A9BAD] text-xs ml-auto italic">Tamaño = valor en stock (ARS)</span>
      </div>

      {/* Floating tooltip */}
      {tooltip && <HoverTooltip state={tooltip} />}
    </div>
  );
}
