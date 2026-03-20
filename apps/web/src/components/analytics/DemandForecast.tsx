'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api, type StockDemandForecastResponse } from '@/lib/api';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  tenantId: string;
  productoNombreId: number;
  localId?: number;
}

export default function DemandForecast({ tenantId, productoNombreId, localId }: Props) {
  const [data, setData] = useState<StockDemandForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.analytics.stockDemandForecast(tenantId, productoNombreId, 60, localId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, productoNombreId, localId]);

  if (loading) {
    return (
      <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4 flex items-center justify-center h-52">
        <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  // ── Chart data: historical bars + projected demand line ──────────────
  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  // Build chart series from historical monthly sales
  const chartData = data.ventasMensuales.map(v => ({
    label: `${MESES[v.mes - 1]} ${String(v.anio).slice(2)}`,
    ventas: v.unidades,
    proyeccion: null as number | null,
  }));

  // Add projected months using velocity × calendar factor × trend
  for (const fc of data.factoresCalendario) {
    const daysInMonth = new Date(now.getFullYear(), fc.mes, 0).getDate();
    const projected = Math.round(data.velocidadBase * data.factorTendencia * fc.factor * daysInMonth);
    const year = fc.mes >= currentMonth ? now.getFullYear() : now.getFullYear() + 1;
    chartData.push({
      label: `${MESES[fc.mes - 1]} ${String(year).slice(2)}`,
      ventas: 0,
      proyeccion: projected,
    });
  }

  // ── Trend formatting ────────────────────────────────────────────────
  const trendPct = Math.round((data.factorTendencia - 1) * 100);
  const trendSign = trendPct >= 0 ? '+' : '';
  const trendArrow = trendPct > 0 ? '↑' : trendPct < 0 ? '↓' : '→';
  const trendColor = trendPct > 0 ? 'text-[#2ECC71]' : trendPct < 0 ? 'text-[#ED7C00]' : 'text-[#7A9BAD]';

  // Calendar factor for current month
  const currentCalFactor = data.factoresCalendario.find(f => f.mes === currentMonth);

  return (
    <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
      <p className="text-white text-xs font-semibold mb-3">
        Pronostico de demanda · proximos {data.horizonte} dias
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* LEFT: Chart (3 cols) */}
        <div className="lg:col-span-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#32576F" opacity={0.3} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#7A9BAD', fontSize: 10 }}
                axisLine={{ stroke: '#32576F' }}
                tickLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
              />
              <YAxis
                tick={{ fill: '#7A9BAD', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#CDD4DA' }}
                formatter={(value: number, name: string) => [
                  value,
                  name === 'ventas' ? 'Ventas reales' : 'Proyeccion',
                ]}
              />
              <Bar dataKey="ventas" fill="#32576F" radius={[3, 3, 0, 0]} name="ventas" />
              <Line
                dataKey="proyeccion"
                stroke="#ED7C00"
                strokeWidth={2}
                dot={{ fill: '#ED7C00', r: 3 }}
                connectNulls={false}
                name="proyeccion"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* RIGHT: Forecast panel (2 cols) */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <Row label="Demanda estimada" value={`${fmtN(data.demandaProyectada)} un.`} accent />
          <Row label="Stock actual" value={`${fmtN(data.stockActual)} un.`} />
          <Row
            label="Cobertura sin comprar"
            value={data.coberturaSinComprar >= 999 ? 'Sin ventas' : `${Math.round(data.coberturaSinComprar)} dias`}
          />
          <div className="border-t border-[#32576F] my-1" />
          <Row
            label="Factor tendencia"
            value={<span className={trendColor}>{trendSign}{trendPct}% {trendArrow}</span>}
          />
          <Row
            label={`Factor estacional (${MESES[currentMonth - 1]})`}
            value={currentCalFactor ? `${currentCalFactor.factor.toFixed(2)}x` : '1.00x'}
          />
          <Row label="Velocidad base" value={`${data.velocidadBase.toFixed(1)} un/dia`} />
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[#7A9BAD] text-xs">{label}</span>
      <span className={`text-sm font-semibold font-mono ${accent ? 'text-[#ED7C00]' : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}

function fmtN(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n));
}
