'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { api, type StockResponse, type ProductoStock, type FiltrosDisponibles, type AnalyticsFilters } from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

const ABC_COLORS = { A: '#ED7C00', B: '#3B82F6', C: '#6B7280' };
const ABC_BG = {
  A: 'bg-[#ED7C00]/10 text-[#ED7C00] border border-[#ED7C00]/30',
  B: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  C: 'bg-gray-500/10 text-gray-400 border border-gray-500/30',
};

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-bold text-xl ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-[#7A9BAD] text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function AbcBadge({ cls }: { cls: 'A' | 'B' | 'C' }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded ${ABC_BG[cls]}`}>
      {cls}
    </span>
  );
}

export default function StockAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<StockResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [abcFilter, setAbcFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    setPage(0);
    try {
      const result = await api.analytics.stock(tenantId, f);
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

  const filtered = data?.productos.filter((p) =>
    abcFilter === 'all' ? true : p.clasificacion_abc === abcFilter
  ) ?? [];

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  // Top 20 by stock for bar chart
  const top20 = data?.productos
    .filter((p) => p.stock_actual > 0)
    .slice(0, 20)
    .map((p) => ({ ...p, label: `${p.nombre}${p.talle ? ` (${p.talle})` : ''}` })) ?? [];

  return (
    <div className="flex flex-col flex-1">
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analítica · Stock</h1>
          <p className="text-[#7A9BAD] text-sm">Niveles, rotación, cobertura y análisis ABC</p>
        </div>
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        <DateRangeFilter
          filtros={filtros}
          onApply={load}
          loading={loading}
        />

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Total SKUs" value={data.total_skus.toLocaleString('es-AR')} />
              <KpiCard label="SKUs sin stock" value={data.skus_sin_stock.toLocaleString('es-AR')} color="text-red-400" />
              <KpiCard label="SKUs bajo stock" value={data.skus_bajo_stock.toLocaleString('es-AR')} color="text-yellow-400" />
              <KpiCard
                label="Clase A (80% revenue)"
                value={data.productos.filter((p) => p.clasificacion_abc === 'A').length.toLocaleString('es-AR')}
                sub="productos más rentables"
                color="text-[#ED7C00]"
              />
            </div>

            {/* ABC explanation */}
            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
              <p className="text-[#7A9BAD] text-xs leading-relaxed">
                <strong className="text-[#CDD4DA]">Análisis ABC:</strong>{' '}
                <span className="text-[#ED7C00]">Clase A</span> = productos que generan el 80% del revenue (mayor rentabilidad) ·{' '}
                <span className="text-blue-400">Clase B</span> = siguiente 15% ·{' '}
                <span className="text-gray-400">Clase C</span> = últimos 5% (menor contribución).{' '}
                Rotación = unidades vendidas / stock disponible · Cobertura = stock actual / ventas promedio diarias (días disponibles).
              </p>
            </div>

            {/* Top 20 stock chart */}
            {top20.length > 0 && (
              <ChartContainer title="Top 20 productos por stock actual" exportFileName={`stock_niveles_${tenantId}`}>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={top20} layout="vertical" margin={{ left: 20, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                    <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="label" stroke="#7A9BAD" tick={{ fontSize: 10 }} width={130} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number | undefined, _n, p) => [v ?? 0, `${p.payload.clasificacion_abc} · Rotación: ${p.payload.rotacion}`]}
                    />
                    <Bar dataKey="stock_actual" radius={[0, 4, 4, 0]}>
                      {top20.map((p, i) => (
                        <Cell key={i} fill={ABC_COLORS[p.clasificacion_abc as 'A' | 'B' | 'C']} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}

            {/* Bajo stock alert */}
            {data.bajo_stock.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                <p className="text-yellow-400 text-sm font-medium mb-2">
                  {data.bajo_stock.length} productos bajo el stock mínimo
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.bajo_stock.slice(0, 10).map((p, i) => (
                    <span key={i} className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded">
                      {String(p.Nombre ?? p.nombre ?? 'Producto')}
                    </span>
                  ))}
                  {data.bajo_stock.length > 10 && (
                    <span className="text-xs text-[#7A9BAD]">+{data.bajo_stock.length - 10} más</span>
                  )}
                </div>
              </div>
            )}

            {/* ABC Table */}
            <ChartContainer
              title="Análisis ABC — Todos los productos"
              subtitle="Ordenados por contribución al revenue"
              exportFileName={`stock_abc_${tenantId}`}
            >
              {/* Filter */}
              <div className="flex gap-2 mb-4">
                {(['all', 'A', 'B', 'C'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => { setAbcFilter(f); setPage(0); }}
                    className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                      abcFilter === f
                        ? 'bg-[#ED7C00] text-white'
                        : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                    }`}
                  >
                    {f === 'all' ? 'Todos' : `Clase ${f}`}
                  </button>
                ))}
                <span className="text-xs text-[#7A9BAD] ml-auto self-center">{filtered.length} productos</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['ABC', 'Producto', 'Talle', 'Color', 'Stock', 'Vendidas', 'Rotación', 'Cobertura', 'Contribución'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((p: ProductoStock, i: number) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3">
                          <AbcBadge cls={p.clasificacion_abc as 'A' | 'B' | 'C'} />
                        </td>
                        <td className="py-2 px-3 text-white font-medium max-w-[160px] truncate">{p.nombre}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.talle || '—'}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.color || '—'}</td>
                        <td className="py-2 px-3 text-white font-mono">{p.stock_actual}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.unidades_vendidas_periodo}</td>
                        <td className="py-2 px-3">
                          <span className={p.rotacion >= 1 ? 'text-green-400' : p.rotacion >= 0.3 ? 'text-yellow-400' : 'text-red-400'}>
                            {p.rotacion.toFixed(2)}x
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={
                            p.cobertura_dias === 9999 ? 'text-[#7A9BAD]' :
                            p.cobertura_dias >= 30 ? 'text-green-400' :
                            p.cobertura_dias >= 7 ? 'text-yellow-400' : 'text-red-400'
                          }>
                            {p.cobertura_dias === 9999 ? '∞' : `${p.cobertura_dias}d`}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 bg-[#32576F] rounded-full w-12">
                              <div
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${Math.min(p.contribucion_pct * 3, 100)}%`,
                                  backgroundColor: ABC_COLORS[p.clasificacion_abc as 'A' | 'B' | 'C'],
                                }}
                              />
                            </div>
                            <span className="text-[#7A9BAD] text-xs whitespace-nowrap">{p.contribucion_pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#32576F]">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40 transition-colors"
                  >
                    ← Anterior
                  </button>
                  <span className="text-xs text-[#7A9BAD]">
                    Página {page + 1} de {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40 transition-colors"
                  >
                    Siguiente →
                  </button>
                </div>
              )}
            </ChartContainer>
          </>
        )}
      </main>
    </div>
  );
}
