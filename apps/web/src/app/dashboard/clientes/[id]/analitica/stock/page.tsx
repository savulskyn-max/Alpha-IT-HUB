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

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-bold text-xl ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-[#7A9BAD] text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

function stateColor(state?: string) {
  if (state === 'substock') return 'text-red-400';
  if (state === 'sobrestock') return 'text-yellow-400';
  return 'text-green-400';
}

export default function StockAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<StockResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [abcFilter, setAbcFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
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

  const productos = data?.productos ?? [];
  const filtered = productos.filter((p) => (abcFilter === 'all' ? true : p.clasificacion_abc === abcFilter));

  const top20 = filtered
    .filter((p) => p.stock_actual > 0)
    .slice(0, 20)
    .map((p) => ({ ...p, label: `${p.nombre}${p.descripcion ? ` - ${p.descripcion}` : ''}` }));

  return (
    <div className="flex flex-col flex-1">
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analitica - Stock</h1>
          <p className="text-[#7A9BAD] text-sm">Valorizacion, ABC por nombre y descripcion, rotacion y cobertura</p>
        </div>
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        <DateRangeFilter filtros={filtros} onApply={load} loading={loading} />

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Monto total stock (costo)" value={fmt(data.monto_total_stock_compra ?? 0)} />
              <KpiCard label="Rotacion general" value={`${(data.rotacion_general ?? 0).toFixed(2)}x`} />
              <KpiCard label="Cobertura general" value={`${(data.cobertura_general_dias ?? 0).toFixed(1)} dias`} />
              <KpiCard label="Crecimiento ventas" value={`${(data.tasa_crecimiento_ventas ?? 0).toFixed(2)}%`} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <KpiCard label="Substock" value={`${data.analisis_stock?.substock ?? 0}`} color="text-red-400" />
              <KpiCard label="Normal" value={`${data.analisis_stock?.normal ?? 0}`} color="text-green-400" />
              <KpiCard label="Sobrestock" value={`${data.analisis_stock?.sobrestock ?? 0}`} color="text-yellow-400" />
            </div>

            {top20.length > 0 && (
              <ChartContainer title="Top 20 por stock actual" exportFileName={`stock_niveles_${tenantId}`}>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={top20} layout="vertical" margin={{ left: 20, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                    <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="label" stroke="#7A9BAD" tick={{ fontSize: 10 }} width={150} />
                    <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number | undefined, _n, p) => [v ?? 0, `${p.payload.clasificacion_abc} - Rotacion: ${p.payload.rotacion}`]} />
                    <Bar dataKey="stock_actual" radius={[0, 4, 4, 0]}>
                      {top20.map((p, i) => <Cell key={i} fill={ABC_COLORS[p.clasificacion_abc as 'A' | 'B' | 'C']} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartContainer title="ABC por nombre" exportFileName={`stock_abc_nombre_${tenantId}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Nombre', 'Revenue', 'ABC', 'Contribucion'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.abc_por_nombre ?? []).slice(0, 20).map((row, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                          <td className="py-2 px-3 text-white">{String((row as Record<string, unknown>).nombre ?? '-')}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{fmt(Number((row as Record<string, unknown>).revenue ?? 0))}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{String((row as Record<string, unknown>).abc ?? 'C')}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{Number((row as Record<string, unknown>).contribucion_pct ?? 0).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>

              <ChartContainer title="ABC por descripcion" exportFileName={`stock_abc_descripcion_${tenantId}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Descripcion', 'Revenue', 'ABC', 'Contribucion'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.abc_por_descripcion ?? []).slice(0, 20).map((row, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                          <td className="py-2 px-3 text-white">{String((row as Record<string, unknown>).descripcion ?? '-')}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{fmt(Number((row as Record<string, unknown>).revenue ?? 0))}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{String((row as Record<string, unknown>).abc ?? 'C')}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{Number((row as Record<string, unknown>).contribucion_pct ?? 0).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartContainer title="Mas vendidos por nombre" exportFileName={`stock_vendidos_nombre_${tenantId}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Nombre', 'Vendidas', 'Stock', 'Alerta'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.mas_vendidos_por_nombre ?? []).slice(0, 20).map((row, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                          <td className="py-2 px-3 text-white">{String((row as Record<string, unknown>).nombre ?? '-')}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{Number((row as Record<string, unknown>).unidades_vendidas ?? 0)}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{Number((row as Record<string, unknown>).stock_actual ?? 0)}</td>
                          <td className="py-2 px-3">
                            {Boolean((row as Record<string, unknown>).alerta_bajo_stock) ? (
                              <span className="text-red-400 text-xs font-medium">Bajo stock</span>
                            ) : (
                              <span className="text-green-400 text-xs">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>

              <ChartContainer title="Mas vendidos por descripcion" exportFileName={`stock_vendidos_descripcion_${tenantId}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Descripcion', 'Vendidas', 'Stock', 'Alerta'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data.mas_vendidos_por_descripcion ?? []).slice(0, 20).map((row, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                          <td className="py-2 px-3 text-white">{String((row as Record<string, unknown>).descripcion ?? '-')}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{Number((row as Record<string, unknown>).unidades_vendidas ?? 0)}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{Number((row as Record<string, unknown>).stock_actual ?? 0)}</td>
                          <td className="py-2 px-3">
                            {Boolean((row as Record<string, unknown>).alerta_bajo_stock) ? (
                              <span className="text-red-400 text-xs font-medium">Bajo stock</span>
                            ) : (
                              <span className="text-green-400 text-xs">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>
            </div>

            <ChartContainer title="Detalle de productos" subtitle="Rotacion y cobertura por producto" exportFileName={`stock_detalle_${tenantId}`}>
              <div className="flex gap-2 mb-4">
                {(['all', 'A', 'B', 'C'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setAbcFilter(f)}
                    className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                      abcFilter === f ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                    }`}
                  >
                    {f === 'all' ? 'Todos' : `Clase ${f}`}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['Producto', 'Descripcion', 'Stock', 'Vendidas', 'Rotacion', 'Cobertura', 'Estado'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 60).map((p: ProductoStock, i: number) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3 text-white font-medium">{p.nombre}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.descripcion || '-'}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.stock_actual}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.unidades_vendidas_periodo}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.rotacion.toFixed(2)}x</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.cobertura_dias.toFixed(1)}d</td>
                        <td className={`py-2 px-3 ${stateColor(p.estado_stock)}`}>{p.estado_stock ?? 'normal'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartContainer>
          </>
        )}
      </main>
    </div>
  );
}
