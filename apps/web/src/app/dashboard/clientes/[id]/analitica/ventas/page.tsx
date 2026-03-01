'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api, type VentasResponse, type FiltrosDisponibles, type AnalyticsFilters } from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

const COLORS = ['#ED7C00', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

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

export default function VentasAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<VentasResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [filters, setFilters] = useState<AnalyticsFilters>({});
  const [showDetalleProducto, setShowDetalleProducto] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.analytics.ventas(tenantId, f);
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

  const handleApply = (f: AnalyticsFilters) => {
    setFilters(f);
    load(f);
  };

  type TopSimpleRow = { nombre: string; total: number; cantidad: number; pct: number };
  type TopDetalleRow = TopSimpleRow & { talle?: string; color?: string };

  const topSimple: TopSimpleRow[] = (data?.top_productos_por_nombre ?? data?.top_productos ?? []) as TopSimpleRow[];
  const topDetalle: TopDetalleRow[] = (data?.top_productos_detalle ?? data?.top_productos ?? []) as TopDetalleRow[];
  const tableData = showDetalleProducto ? topDetalle : topSimple;

  return (
    <div className="flex flex-col flex-1">
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analitica - Ventas</h1>
          <p className="text-[#7A9BAD] text-sm">Facturado, costo, comisiones y analisis por producto</p>
        </div>
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        <DateRangeFilter filtros={filtros} showProductoFilter onApply={handleApply} loading={loading} />

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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard label="Facturado total" value={fmt(data.facturado_total ?? data.total_periodo)} />
              <KpiCard label="Costo mercaderia" value={fmt(data.costo_mercaderia_vendida ?? 0)} />
              <KpiCard label="Comisiones pago" value={fmt(data.comisiones_pago ?? 0)} />
              <KpiCard label="Margen bruto" value={fmt(data.margen_bruto_post_comisiones ?? 0)} />
              <KpiCard label="Vendido a cuenta" value={fmt(data.vendido_a_cuenta ?? 0)} />
              <KpiCard label="Cobrado de cuenta" value={fmt(data.cobrado_de_cuenta_corriente ?? 0)} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Revenue total" value={fmt(data.total_periodo)} />
              <KpiCard label="Cantidad de ventas" value={data.cantidad_ventas.toLocaleString('es-AR')} />
              <KpiCard label="Ticket promedio" value={fmt(data.ticket_promedio)} />
              <KpiCard
                label="Promedio diario"
                value={fmt(data.serie_temporal.length > 0 ? data.total_periodo / data.serie_temporal.length : 0)}
                sub="por dia con ventas"
              />
            </div>

            {filters.producto_nombre && data.participacion_producto_filtrado_pct != null && (
              <div className="bg-[#132229] border border-[#32576F] rounded-xl px-4 py-3">
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Participacion del producto filtrado</p>
                <p className="text-white text-lg font-bold">{data.participacion_producto_filtrado_pct.toFixed(2)}%</p>
                <p className="text-[#7A9BAD] text-xs">sobre ventas del periodo seleccionado</p>
              </div>
            )}

            <ChartContainer title="Revenue por dia" subtitle="DineroDisponible acumulado" exportFileName={`ventas_serie_${tenantId}`}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.serie_temporal} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                  <XAxis dataKey="fecha" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number | undefined) => [fmt(v ?? 0), 'Revenue']} />
                  <Line type="monotone" dataKey="total" stroke="#ED7C00" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartContainer title="Revenue por local" exportFileName={`ventas_local_${tenantId}`}>
                {data.por_local.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.por_local} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                      <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="nombre" stroke="#7A9BAD" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.pct}% del total`]} />
                      <Bar dataKey="total" fill="#ED7C00" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>}
              </ChartContainer>

              <ChartContainer title="Revenue por metodo de pago" exportFileName={`ventas_metodo_${tenantId}`}>
                {data.por_metodo_pago.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={data.por_metodo_pago} dataKey="total" nameKey="nombre" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2}>
                        {data.por_metodo_pago.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number | undefined, _name, p) => [fmt(v ?? 0), `${p.payload.nombre} (${p.payload.pct}%)`]} />
                      <Legend formatter={(value) => <span style={{ color: '#CDD4DA', fontSize: 12 }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>}
              </ChartContainer>
            </div>

            {data.por_tipo_venta.length > 0 && (
              <ChartContainer title="Revenue por tipo de venta" exportFileName={`ventas_tipo_${tenantId}`}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.por_tipo_venta} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="tipo" stroke="#7A9BAD" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.pct}% del total`]} />
                    <Bar dataKey="total" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}

            <ChartContainer
              title="Top ventas por tipo de producto"
              subtitle={`${tableData.length} filas en el periodo seleccionado`}
              exportFileName={`ventas_productos_${tenantId}`}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-[#7A9BAD] text-xs">Vista simple por nombre con opcion de detalle por variante</p>
                <button
                  onClick={() => setShowDetalleProducto((s) => !s)}
                  className="px-3 py-1 text-xs rounded-lg bg-[#1E3340] border border-[#32576F] text-[#CDD4DA] hover:text-white transition-colors"
                >
                  {showDetalleProducto ? 'Ocultar detalle' : 'Ver detalle'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['Producto', ...(showDetalleProducto ? ['Detalle'] : []), 'Revenue', 'Unidades', '% Total'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((p, i) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3 text-white font-medium">{p.nombre}</td>
                        {showDetalleProducto && (
                          <td className="py-2 px-3 text-[#CDD4DA]">
                            {(p as TopDetalleRow).talle || '-'} - {(p as TopDetalleRow).color || '-'}
                          </td>
                        )}
                        <td className="py-2 px-3 text-green-400 font-mono">{fmt(p.total)}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.cantidad}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 bg-[#32576F] rounded-full w-16">
                              <div className="h-1.5 bg-[#ED7C00] rounded-full" style={{ width: `${Math.min(p.pct, 100)}%` }} />
                            </div>
                            <span className="text-[#7A9BAD] text-xs">{p.pct}%</span>
                          </div>
                        </td>
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
