'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from 'recharts';
import type { TendenciaDia } from '@/lib/api/dashboard';

function formatDate(iso: string): string {
  // Force noon to avoid TZ off-by-one on date display
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
}

function formatARS(v: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}

interface Props {
  data: TendenciaDia[];
}

export function TendenciaChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-[#7A9BAD] text-sm">
        Sin ventas en los últimos 7 días
      </div>
    );
  }

  const chartData = data.map(d => ({
    name: formatDate(d.dia),
    total: d.total,
  }));

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dash-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ED7C00" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#ED7C00" stopOpacity={0}    />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#7A9BAD' }}
            axisLine={false}
            tickLine={false}
          />

          <Tooltip
            contentStyle={{
              background: '#0B1F29',
              border: '1px solid #32576F',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: '#CDD4DA', marginBottom: 4 }}
            formatter={(v: number) => [formatARS(v), 'Ventas']}
          />

          <Area
            type="monotone"
            dataKey="total"
            stroke="#ED7C00"
            strokeWidth={2}
            fill="url(#dash-grad)"
            dot={false}
            activeDot={{ r: 4, fill: '#ED7C00', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
