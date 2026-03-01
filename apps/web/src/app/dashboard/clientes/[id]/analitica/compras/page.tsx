'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api, type ComprasResponse, type FiltrosDisponibles, type AnalyticsFilters } from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="text-white font-bold text-xl">{value}</p>
      {sub && <p className="text-[#7A9BAD] text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ComprasAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<ComprasResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.analytics.compras(tenantId, f);
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

  return (
    <div className="flex flex-col flex-1">
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analitica - Compras</h1>
          <p className="text-[#7A9BAD] text-sm">Analisis por periodo, producto y proveedor</p>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <KpiCard label="Total compras" value={fmt(data.total_periodo)} />
              <KpiCard label="Ordenes de compra" value={data.cantidad_ordenes.toLocaleString('es-AR')} />
              <KpiCard label="Promedio por orden" value={fmt(data.promedio_por_orden)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard label="Top 10 concentracion" value={`${Number(data.analisis?.concentracion_top10_pct ?? 0).toFixed(2)}%`} />
              <KpiCard label="Proveedores activos" value={`${Number(data.analisis?.cantidad_proveedores ?? 0)}`} />
              <KpiCard label="Proveedor principal" value={`${Number(data.analisis?.proveedor_principal_pct ?? 0).toFixed(2)}%`} />
            </div>

            <ChartContainer title="Compras por dia" exportFileName={`compras_serie_${tenantId}`}>
              {data.serie_temporal.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.serie_temporal} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="fecha" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number | undefined) => [fmt(v ?? 0), 'Total compras']} />
                    <Bar dataKey="total" fill="#ED7C00" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos para el periodo seleccionado</p>}
            </ChartContainer>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartContainer title="Top productos comprados" exportFileName={`compras_productos_${tenantId}`}>
                {data.top_productos.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#32576F]">
                          {['Producto', 'Talle', 'Color', 'Total', 'Unidades'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.top_productos.map((p, i) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                            <td className="py-2 px-3 text-white font-medium">{p.nombre}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{p.talle || '-'}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{p.color || '-'}</td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono">{fmt(p.total)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{p.cantidad}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>}
              </ChartContainer>

              <ChartContainer title="Top proveedores" exportFileName={`compras_proveedores_${tenantId}`}>
                {(data.top_proveedores ?? []).length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#32576F]">
                          {['Proveedor', 'Total', 'Ordenes', '% Periodo'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(data.top_proveedores ?? []).map((row, i) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                            <td className="py-2 px-3 text-white font-medium">{row.proveedor}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{fmt(row.total)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{row.ordenes}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{row.pct.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos de proveedores</p>}
              </ChartContainer>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
