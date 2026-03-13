'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  api,
  type ComprasResponse,
  type CompraOrden,
  type CompraItemsResponse,
  type FiltrosDisponibles,
  type AnalyticsFilters,
} from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

const COLORS = ['#3B82F6', '#ED7C00', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6'];

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

function OrdenRow({
  orden,
  tenantId,
}: {
  orden: CompraOrden;
  tenantId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<CompraItemsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadItems = async () => {
    if (items) { setExpanded(!expanded); return; }
    setExpanded(true);
    setLoading(true);
    try {
      const result = await api.analytics.compraItems(tenantId, orden.compra_id);
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar ítems');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <tr
        className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors cursor-pointer"
        onClick={loadItems}
      >
        <td className="py-2 px-2 text-center w-8">
          <span className="text-[#7A9BAD] text-xs">{expanded ? '▼' : '▶'}</span>
        </td>
        <td className="py-2 px-3 text-[#7A9BAD] text-xs font-mono">{orden.fecha}</td>
        <td className="py-2 px-3 text-white font-medium">{orden.proveedor}</td>
        <td className="py-2 px-3 text-[#ED7C00] font-mono font-semibold">{fmt(orden.total)}</td>
        <td className="py-2 px-3 text-[#CDD4DA] text-xs">{orden.cantidad_items} ítems</td>
        <td className="py-2 px-3 text-[#7A9BAD] text-xs font-mono">#{orden.compra_id}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-[#32576F]/20">
          <td colSpan={6} className="p-0">
            <div className="bg-[#0D1A20] px-4 py-3">
              {loading && (
                <div className="flex items-center gap-2 py-2">
                  <div className="w-4 h-4 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[#7A9BAD] text-xs">Cargando ítems...</span>
                </div>
              )}
              {error && <p className="text-red-400 text-xs py-2">{error}</p>}
              {items && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#32576F]/40">
                      {['Nombre', 'Descripción', 'Talle', 'Color', 'Cant.', 'Costo unit.', 'Subtotal'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-1.5 px-3 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.items.map((item, k) => (
                      <tr key={k} className="border-b border-[#32576F]/20 hover:bg-[#132229]">
                        <td className="py-1.5 px-3 text-white font-medium">{item.nombre}</td>
                        <td className="py-1.5 px-3 text-[#CDD4DA]">{item.descripcion || '—'}</td>
                        <td className="py-1.5 px-3 text-[#CDD4DA]">{item.talle || '—'}</td>
                        <td className="py-1.5 px-3 text-[#CDD4DA]">{item.color || '—'}</td>
                        <td className="py-1.5 px-3 text-white font-mono">{item.cantidad}</td>
                        <td className="py-1.5 px-3 text-[#CDD4DA] font-mono">{fmt(item.costo_unitario)}</td>
                        <td className="py-1.5 px-3 text-[#ED7C00] font-mono font-semibold">{fmt(item.subtotal)}</td>
                      </tr>
                    ))}
                    <tr className="bg-[#132229]">
                      <td colSpan={6} className="py-1.5 px-3 text-right text-[#7A9BAD] font-medium text-xs uppercase">Total</td>
                      <td className="py-1.5 px-3 text-[#ED7C00] font-mono font-bold">{fmt(items.total)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
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

  const topProveedorName = data?.por_proveedor?.[0]?.nombre ?? '—';
  const topProveedorTotal = data?.por_proveedor?.[0]?.total ?? 0;

  return (
    <div className="flex flex-col flex-1">
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analítica · Compras</h1>
          <p className="text-[#7A9BAD] text-sm">Órdenes de compra, proveedores y productos</p>
        </div>
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        <DateRangeFilter
          filtros={filtros}
          showSupplierFilter
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
              <KpiCard label="Total compras" value={fmt(data.total_periodo)} color="text-[#ED7C00]" />
              <KpiCard label="Órdenes de compra" value={data.cantidad_ordenes.toLocaleString('es-AR')} />
              <KpiCard label="Promedio por orden" value={fmt(data.promedio_por_orden)} />
              <KpiCard
                label="Unidades totales"
                value={data.unidades_totales.toLocaleString('es-AR')}
                sub="unidades compradas"
              />
            </div>

            {/* Proveedor top */}
            {data.por_proveedor.length > 0 && (
              <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <p className="text-[#7A9BAD] text-xs uppercase">Proveedor principal</p>
                  <p className="text-white font-semibold">{topProveedorName}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-blue-400 font-mono font-semibold">{fmt(topProveedorTotal)}</p>
                  <p className="text-[#7A9BAD] text-xs">{data.por_proveedor[0]?.pct ?? 0}% del total</p>
                </div>
              </div>
            )}

            {/* Time series + Suppliers side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartContainer title="Compras por día" exportFileName={`compras_serie_${tenantId}`}>
                {data.serie_temporal.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.serie_temporal} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                      <XAxis dataKey="fecha" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                        formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.cantidad} órdenes`]}
                      />
                      <Bar dataKey="total" fill="#ED7C00" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos</p>
                )}
              </ChartContainer>

              {/* Proveedores pie */}
              <ChartContainer title="Distribución por proveedor" exportFileName={`compras_prov_${tenantId}`}>
                {data.por_proveedor.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={data.por_proveedor}
                        dataKey="total"
                        nameKey="nombre"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        innerRadius={50}
                        paddingAngle={2}
                      >
                        {data.por_proveedor.map((_, idx) => (
                          <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                        formatter={(v: number | undefined, _n, p) => [
                          fmt(v ?? 0),
                          `${p.payload.nombre} · ${p.payload.cantidad_ordenes} órdenes (${p.payload.pct}%)`,
                        ]}
                      />
                      <Legend formatter={(v) => <span style={{ color: '#CDD4DA', fontSize: 11 }}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos de proveedores</p>
                )}
              </ChartContainer>
            </div>

            {/* Top productos por monto */}
            {data.top_productos.length > 0 && (
              <ChartContainer title="Top 10 productos por monto comprado" exportFileName={`compras_top_${tenantId}`}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={data.top_productos.slice(0, 10).map((p) => ({
                      ...p,
                      label: `${p.nombre}${p.talle ? ` (${p.talle})` : ''}`,
                    }))}
                    layout="vertical"
                    margin={{ left: 20, right: 30 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                    <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="label" stroke="#7A9BAD" tick={{ fontSize: 10 }} width={130} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number | undefined, _n, p) => [fmt(v ?? 0), `${p.payload.cantidad} uds`]}
                    />
                    <Bar dataKey="total" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}

            {/* Tabla completa de productos */}
            <ChartContainer
              title="Todos los productos comprados"
              subtitle={`${data.top_productos.length} productos distintos`}
              exportFileName={`compras_productos_${tenantId}`}
            >
              {data.top_productos.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Producto', 'Descripción', 'Talle', 'Color', 'Total comprado', 'Unidades'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_productos.map((p, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                          <td className="py-2 px-3 text-white font-medium">{p.nombre}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{p.descripcion || '—'}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{p.talle || '—'}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{p.color || '—'}</td>
                          <td className="py-2 px-3 text-[#ED7C00] font-mono">{fmt(p.total)}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{p.cantidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[#7A9BAD] text-sm text-center py-8">Sin datos para el período seleccionado</p>
              )}
            </ChartContainer>

            {/* Órdenes de compra expandibles */}
            {data.ordenes.length > 0 && (
              <ChartContainer
                title="Órdenes de compra"
                subtitle="Expandí cada orden para ver los ítems detallados (nombre, descripción, talle, color)"
                exportFileName={`compras_ordenes_${tenantId}`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        <th className="w-8" />
                        {['Fecha', 'Proveedor', 'Total', 'Ítems', 'ID'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.ordenes.map((orden) => (
                        <OrdenRow key={orden.compra_id} orden={orden} tenantId={tenantId} />
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
