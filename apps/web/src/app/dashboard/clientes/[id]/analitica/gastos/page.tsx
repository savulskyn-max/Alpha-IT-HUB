'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api, type GastosResponse, type FiltrosDisponibles, type AnalyticsFilters } from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

const COLORS = ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#14B8A6', '#3B82F6'];

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-bold text-xl ${accent ? 'text-red-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-[#7A9BAD] text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

type SortKey = 'fecha' | 'tipo' | 'categoria' | 'metodo_pago' | 'monto';
type SortDir = 'asc' | 'desc';

function SortTh({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  return (
    <th
      className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap cursor-pointer select-none hover:text-white transition-colors"
      onClick={() => onClick(sortKey)}
    >
      {label}
      {active ? (
        <span className="ml-1 text-[#ED7C00]">{dir === 'asc' ? '↑' : '↓'}</span>
      ) : (
        <span className="ml-1 opacity-30">↕</span>
      )}
    </th>
  );
}

export default function GastosAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<GastosResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('fecha');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.analytics.gastos(tenantId, f);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    api.analytics.filtros(tenantId).then(setFiltros).catch(() => {});
    load({});
  }, [tenantId, load]);

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'monto' ? 'desc' : 'asc'); }
  }

  const sortedDetalle = [...(data?.detalle_gastos ?? [])].sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), 'es-AR');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="flex flex-col flex-1">
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analítica · Gastos</h1>
          <p className="text-[#7A9BAD] text-sm">Gastos por tipo, categoría y método de pago</p>
        </div>
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        <DateRangeFilter filtros={filtros} showGastoFilters onApply={load} loading={loading} />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {data && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <KpiCard label="Total gastos" value={fmt(data.total_periodo)} accent />
              <KpiCard
                label="Ratio gastos / ventas"
                value={data.ratio_ventas != null ? `${data.ratio_ventas}%` : '—'}
                sub={data.ratio_ventas != null ? 'del revenue del período' : undefined}
              />
              <KpiCard
                label="Promedio diario"
                value={fmt(data.serie_temporal.length > 0 ? data.total_periodo / data.serie_temporal.length : 0)}
                sub="por día con gastos"
              />
            </div>

            {/* Time series */}
            <ChartContainer title="Gastos por día" exportFileName={`gastos_serie_${tenantId}`}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.serie_temporal} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                  <XAxis dataKey="fecha" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                    formatter={(v: number | undefined) => [fmt(v ?? 0), 'Gastos']}
                  />
                  <Line type="monotone" dataKey="total" stroke="#EF4444" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>

            {/* Pie por tipo + Bar por método de pago */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pie chart — por tipo (clasificación) */}
              <ChartContainer title="Distribución por tipo de gasto" exportFileName={`gastos_tipo_${tenantId}`}>
                {data.por_tipo.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={data.por_tipo}
                        dataKey="total"
                        nameKey="tipo"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={55}
                        paddingAngle={2}
                      >
                        {data.por_tipo.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                        formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.tipo} (${p.payload.pct}%)`]}
                      />
                      <Legend formatter={(v) => <span style={{ color: '#CDD4DA', fontSize: 11 }}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>
                )}
              </ChartContainer>

              {/* Bar chart — por método de pago */}
              <ChartContainer title="Gastos por método de pago" exportFileName={`gastos_metodo_${tenantId}`}>
                {data.por_metodo_pago.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.por_metodo_pago} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                      <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="nombre" stroke="#7A9BAD" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip
                        contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                        formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.pct}% del total`]}
                      />
                      <Bar dataKey="total" fill="#EF4444" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>
                )}
              </ChartContainer>
            </div>

            {/* Resumen por categoría */}
            <ChartContainer title="Resumen por categoría y tipo" exportFileName={`gastos_categoria_${tenantId}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['Categoría', 'Tipo', 'Total', '% del período'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.por_categoria.map((row, i) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3 text-white font-medium">{row.categoria}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{row.tipo}</td>
                        <td className="py-2 px-3 text-red-400 font-mono">{fmt(row.total)}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 bg-[#32576F] rounded-full w-16">
                              <div className="h-1.5 bg-red-400 rounded-full" style={{ width: `${Math.min(row.pct, 100)}%` }} />
                            </div>
                            <span className="text-[#7A9BAD] text-xs">{row.pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartContainer>

            {/* Detalle individual con fecha */}
            {data.detalle_gastos.length > 0 && (
              <ChartContainer
                title="Detalle de gastos"
                subtitle={`${data.detalle_gastos.length} registros · hacé clic en los encabezados para ordenar`}
                exportFileName={`gastos_detalle_${tenantId}`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        <SortTh label="Fecha" sortKey="fecha" active={sortKey === 'fecha'} dir={sortDir} onClick={handleSort} />
                        <SortTh label="Tipo" sortKey="tipo" active={sortKey === 'tipo'} dir={sortDir} onClick={handleSort} />
                        <SortTh label="Categoría" sortKey="categoria" active={sortKey === 'categoria'} dir={sortDir} onClick={handleSort} />
                        <th className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">Descripción</th>
                        <SortTh label="Método de pago" sortKey="metodo_pago" active={sortKey === 'metodo_pago'} dir={sortDir} onClick={handleSort} />
                        <SortTh label="Monto" sortKey="monto" active={sortKey === 'monto'} dir={sortDir} onClick={handleSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDetalle.map((row, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                          <td className="py-2 px-3 text-[#7A9BAD] font-mono text-xs whitespace-nowrap">{row.fecha}</td>
                          <td className="py-2 px-3 text-white">{row.tipo}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{row.categoria}</td>
                          <td className="py-2 px-3 text-[#7A9BAD] text-xs max-w-[180px] truncate">{row.descripcion ?? '—'}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{row.metodo_pago}</td>
                          <td className="py-2 px-3 text-red-400 font-mono">{fmt(row.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>
            )}
          </>
        )}
      </main>
    </div>
  );
}
