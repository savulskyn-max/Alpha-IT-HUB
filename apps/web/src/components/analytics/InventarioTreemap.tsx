'use client';

import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
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
  if (cobertura >= 999) return '#374151';   // gray  — sin ventas / fuera de temp
  if (cobertura < 7)    return '#DC2626';   // red   — CRÍTICO
  if (cobertura < 15)   return '#D97706';   // amber — BAJO
  if (cobertura >= 60)  return '#1D4ED8';   // blue  — EXCESO
  return '#15803D';                          // green — OK
}

function getHealthLabel(cobertura: number): string {
  if (cobertura >= 999) return 'Sin ventas';
  if (cobertura < 7)    return 'CRÍTICO';
  if (cobertura < 15)   return 'BAJO';
  if (cobertura >= 60)  return 'EXCESO';
  return 'OK';
}

// ── Custom cell renderer ──────────────────────────────────────────────────────

const CustomContent = (props: Record<string, unknown>) => {
  const x = (props.x as number) ?? 0;
  const y = (props.y as number) ?? 0;
  const width = (props.width as number) ?? 0;
  const height = (props.height as number) ?? 0;
  const name = (props.name as string) ?? '';
  const cobertura = (props.cobertura as number) ?? 999;
  const depth = (props.depth as number) ?? 0;

  // Only render leaf nodes (depth > 0 = the actual products)
  if (depth === 0) return null;

  const color = getHealthColor(cobertura);
  const showLabel = width > 44 && height > 24;
  const showSub = width > 60 && height > 44;
  const maxChars = Math.max(4, Math.floor(width / 8));
  const label = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
  const cobLabel = cobertura >= 999 ? '—' : `${cobertura.toFixed(0)}d`;

  return (
    <g>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(0, width - 2)}
        height={Math.max(0, height - 2)}
        rx={3}
        fill={color}
        fillOpacity={0.88}
        stroke="#0B1921"
        strokeWidth={1.5}
      />
      {showLabel && (
        <text
          x={x + 7}
          y={y + (showSub ? height * 0.38 : height * 0.55)}
          fill="rgba(255,255,255,0.95)"
          fontSize={Math.min(11, Math.max(9, width / 10))}
          fontWeight={600}
          dominantBaseline="middle"
          style={{ fontFamily: 'Space Grotesk, sans-serif', pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
      {showSub && (
        <text
          x={x + 7}
          y={y + height * 0.65}
          fill="rgba(255,255,255,0.65)"
          fontSize={9}
          dominantBaseline="middle"
          style={{ fontFamily: 'Space Grotesk, sans-serif', pointerEvents: 'none' }}
        >
          {cobLabel}
        </text>
      )}
    </g>
  );
};

// ── Custom tooltip ────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: TreeItem }> }) => {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  const color = getHealthColor(item.cobertura);
  const healthLabel = getHealthLabel(item.cobertura);

  return (
    <div
      className="rounded-xl px-4 py-3 text-sm shadow-xl"
      style={{ background: '#132229', border: '1px solid #32576F', fontFamily: 'Space Grotesk, sans-serif', minWidth: 200 }}
    >
      <p className="font-semibold text-white mb-2">{item.name}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-6">
          <span className="text-[#7A9BAD]">Valor stock</span>
          <span className="text-[#ED7C00] font-mono font-semibold">
            {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(item.value)}
          </span>
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
          <span className="font-semibold" style={{ color: item.abc === 'A' ? '#ED7C00' : item.abc === 'B' ? '#60A5FA' : '#9CA3AF' }}>
            Clase {item.abc}
          </span>
        </div>
        <div className="flex justify-between gap-6 pt-1 mt-1 border-t border-[#32576F]">
          <span className="text-[#7A9BAD]">Salud</span>
          <span className="font-bold text-xs px-2 py-0.5 rounded" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
            {healthLabel}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Legend ────────────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  { color: '#15803D', label: 'OK', sub: '15–59 días' },
  { color: '#D97706', label: 'Bajo', sub: '7–14 días' },
  { color: '#DC2626', label: 'Crítico', sub: '< 7 días' },
  { color: '#1D4ED8', label: 'Exceso', sub: '≥ 60 días' },
  { color: '#374151', label: 'Sin ventas', sub: '—' },
];

// ── Main component ────────────────────────────────────────────────────────────

export function InventarioTreemap({ data, onProductClick }: InventarioTreemapProps) {
  const chartData: TreeItem[] = data
    .filter((p) => p.stock_total > 0)
    .map((p) => ({
      name: p.nombre,
      // Use monto_stock when available; fall back to stock_total when price is zero
      value: Math.max(p.monto_stock > 0 ? p.monto_stock : p.stock_total, 1),
      cobertura: p.cobertura_dias,
      rotacion: p.rotacion,
      abc: p.clasificacion_abc,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 60); // cap at 60 products for readability

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-[#7A9BAD] text-sm">
        Sin datos de inventario disponibles
      </div>
    );
  }

  const totalValue = chartData.reduce((s, d) => s + d.value, 0);
  const criticos = chartData.filter((d) => d.cobertura < 7).length;
  const exceso = chartData.filter((d) => d.cobertura >= 60 && d.cobertura < 999).length;
  const ok = chartData.filter((d) => d.cobertura >= 15 && d.cobertura < 60).length;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[#7A9BAD] text-xs">
          {chartData.length} productos ·{' '}
          {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(totalValue)} total
        </span>
        <div className="flex gap-2">
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
        </div>
      </div>

      {/* Treemap */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'transparent' }}>
        <ResponsiveContainer width="100%" height={340}>
          <Treemap
            data={chartData}
            dataKey="value"
            aspectRatio={16 / 9}
            content={<CustomContent />}
            onClick={(data: unknown) => {
              if (onProductClick && data && typeof data === 'object' && 'name' in data) {
                onProductClick((data as { name: string }).name);
              }
            }}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
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
    </div>
  );
}
