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

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-bold text-xl ${color ?? 'text-white'}`}>{value}</p>
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedNombre, setExpandedNombre] = useState<string | null>(null);

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    setExpandedNombre(null);
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

  // Get detail rows for an expanded product name
  const getDetalleForNombre = (nombre: string) =>
    (data?.top_productos ?? []).filter((p) => p.nombre === nombre);

  const margen = data ? data.total_periodo - data.cmv - data.comisiones : 0;

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analítica · Ventas</h1>
          <p className="text-[#7A9BAD] text-sm">Revenue, costos y análisis de productos</p>
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
            {/* Alerta de filtro de producto */}
            {filters.producto_nombre && data.pct_del_total != null && (
              <div className="bg-[#ED7C00]/10 border border-[#ED7C00]/30 rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="text-[#ED7C00] text-2xl font-bold">{data.pct_del_total}%</span>
                <div>
                  <p className="text-white text-sm font-medium">del revenue total del período</p>
                  <p className="text-[#7A9BAD] text-xs">corresponde a "{filters.producto_nombre}"</p>
                </div>
              </div>
            )}

            {/* KPIs principales */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Cobrado total" value={fmt(data.total_periodo)} sub="DineroDisponible del período" />
              {data.facturado_bruto > 0 && Math.abs(data.facturado_bruto - data.total_periodo) > data.total_periodo * 0.01 && (
                <KpiCard label="Facturado total" value={fmt(data.facturado_bruto)} sub="precio lista × unidades" color="text-blue-300" />
              )}
              <KpiCard label="Cantidad de ventas" value={data.cantidad_ventas.toLocaleString('es-AR')} />
              <KpiCard label="Ticket promedio" value={fmt(data.ticket_promedio)} />
              <KpiCard
                label="Promedio diario"
                value={fmt(data.serie_temporal.length > 0 ? data.total_periodo / data.serie_temporal.length : 0)}
                sub="por día con ventas"
              />
            </div>

            {/* CMV / Comisiones / Margen */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard
                label="Costo mercadería vendida"
                value={fmt(data.cmv)}
                sub={data.total_periodo > 0 ? `${((data.cmv / data.total_periodo) * 100).toFixed(1)}% del cobrado` : undefined}
                color="text-orange-400"
              />
              <KpiCard
                label="Comisiones de pago"
                value={fmt(data.comisiones)}
                sub={data.comisiones > 0 ? `${((data.comisiones / data.total_periodo) * 100).toFixed(1)}% del cobrado` : 'Sin datos de comisión'}
                color="text-yellow-400"
              />
              <KpiCard
                label="Margen bruto"
                value={fmt(margen)}
                sub={data.total_periodo > 0 ? `${((margen / data.total_periodo) * 100).toFixed(1)}% del cobrado` : undefined}
                color={margen >= 0 ? 'text-green-400' : 'text-red-400'}
              />
            </div>

            {/* Ventas a cuenta */}
            {(data.vendido_cuenta > 0 || data.cobros_cuenta > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <KpiCard
                  label="Vendido a cuenta corriente"
                  value={fmt(data.vendido_cuenta)}
                  sub={`${data.cantidad_cuenta} ventas a cuenta`}
                  color="text-blue-400"
                />
                <KpiCard
                  label="Cobrado de cuentas corrientes"
                  value={fmt(data.cobros_cuenta)}
                  sub={
                    data.vendido_cuenta > 0
                      ? `Saldo pendiente: ${fmt(data.vendido_cuenta - data.cobros_cuenta)}`
                      : undefined
                  }
                  color={data.cobros_cuenta >= data.vendido_cuenta ? 'text-green-400' : 'text-yellow-400'}
                />
              </div>
            )}

            {/* Ventas over time */}
            <ChartContainer title="Ventas por día" subtitle="DineroDisponible acumulado por día" exportFileName={`ventas_serie_${tenantId}`}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.serie_temporal} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                  <XAxis dataKey="fecha" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                    labelStyle={{ color: '#CDD4DA', fontSize: 12 }}
                    formatter={(v: number | undefined) => [fmt(v ?? 0), 'Cobrado']}
                  />
                  <Line type="monotone" dataKey="total" stroke="#ED7C00" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>

            {/* By local & by payment method */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartContainer title="Ventas por local" exportFileName={`ventas_local_${tenantId}`}>
                {data.por_local.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.por_local} layout="vertical" margin={{ left: 10, right: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                      <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="nombre" stroke="#7A9BAD" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip
                        contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                        formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.pct}% del total`]}
                      />
                      <Bar dataKey="total" fill="#ED7C00" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>
                )}
              </ChartContainer>

              <ChartContainer title="Ventas por método de pago" exportFileName={`ventas_metodo_${tenantId}`}>
                {data.por_metodo_pago.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={data.por_metodo_pago} dataKey="total" nameKey="nombre" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2}>
                        {data.por_metodo_pago.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                        formatter={(v: number | undefined, _name, p) => [fmt(v ?? 0), `${p.payload.nombre} (${p.payload.pct}%)`]}
                      />
                      <Legend formatter={(value) => <span style={{ color: '#CDD4DA', fontSize: 12 }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>
                )}
              </ChartContainer>
            </div>

            {/* By sale type */}
            {data.por_tipo_venta.length > 0 && (
              <ChartContainer title="Ventas por tipo de venta" exportFileName={`ventas_tipo_${tenantId}`}>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.por_tipo_venta} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="tipo" stroke="#7A9BAD" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.pct}% del total`]}
                    />
                    <Bar dataKey="total" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}

            {/* Top por nombre (agregado) — con expansión para ver detalle */}
            <ChartContainer
              title="Top ventas por tipo de producto"
              subtitle="Agrupado por nombre · expandí cada fila para ver talle y color"
              exportFileName={`ventas_nombre_${tenantId}`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
<<<<<<< HEAD
                      <th className="w-8" />
                      {['Producto', 'Revenue', 'Unidades', '% Total'].map((h) => (
=======
                      {['Producto', ...(showDetalleProducto ? ['Descripción', 'Talle', 'Color'] : []), 'Revenue', 'Unidades', '% Total'].map((h) => (
>>>>>>> main
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
<<<<<<< HEAD
                    {data.top_por_nombre.map((p, i) => {
                      const isExpanded = expandedNombre === p.nombre;
                      const detalle = getDetalleForNombre(p.nombre);
                      return (
                        <>
                          <tr
                            key={`n-${i}`}
                            className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors cursor-pointer"
                            onClick={() => setExpandedNombre(isExpanded ? null : p.nombre)}
                          >
                            <td className="py-2 px-2 text-center">
                              <span className="text-[#7A9BAD] text-xs">{isExpanded ? '▼' : '▶'}</span>
                            </td>
                            <td className="py-2 px-3 text-white font-semibold">{p.nombre}</td>
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
                          {isExpanded && detalle.map((d, j) => (
                            <tr key={`d-${i}-${j}`} className="border-b border-[#32576F]/20 bg-[#0D1A20]">
                              <td />
                              <td className="py-1.5 px-3 pl-8 text-[#7A9BAD] text-xs">
                                {[d.talle, d.color].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td className="py-1.5 px-3 text-[#CDD4DA] font-mono text-xs">{fmt(d.total)}</td>
                              <td className="py-1.5 px-3 text-[#7A9BAD] text-xs">{d.cantidad}</td>
                              <td className="py-1.5 px-3 text-[#7A9BAD] text-xs">{d.pct}%</td>
                            </tr>
                          ))}
                        </>
                      );
                    })}
=======
                    {tableData.map((p, i) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3 text-white font-medium">{p.nombre}</td>
                        {showDetalleProducto && (
                          <>
                            <td className="py-2 px-3 text-[#CDD4DA]">{(p as TopDetalleRow).descripcion || '-'}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{(p as TopDetalleRow).talle || '-'}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{(p as TopDetalleRow).color || '-'}</td>
                          </>
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
>>>>>>> main
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
