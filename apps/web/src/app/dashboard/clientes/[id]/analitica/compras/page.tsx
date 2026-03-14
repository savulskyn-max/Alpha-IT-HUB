'use client';

import { Fragment, useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api, type ComprasResponse, type FiltrosDisponibles, type AnalyticsFilters } from '@/lib/api';
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

type SortKey = 'fecha' | 'proveedor' | 'total' | 'unidades';
type SortDir = 'asc' | 'desc';
type CompraItemLocal = {
  nombre: string;
  descripcion?: string;
  talle?: string;
  color?: string;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
};

export default function ComprasAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<ComprasResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('fecha');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchText, setSearchText] = useState('');

  const toggleOrder = (id: number) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    setExpandedOrders(new Set());
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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Build a lookup of items from data.ordenes to enrich ultimas_compras entries
  const ordenesItemsMap: Record<number, CompraItemLocal[]> = {};
  for (const o of (data?.ordenes ?? [])) {
    ordenesItemsMap[o.compra_id] = o.items ?? [];
  }

  const orders = (data?.ultimas_compras ?? data?.ordenes ?? []).map((o) => {
    const id = (o as any).compra_id ?? (o as any).id;
    return {
      id,
      fecha: (o as any).fecha,
      proveedor: (o as any).proveedor,
      total: (o as any).total ?? 0,
      local_nombre: (o as any).local_nombre,
      metodo_pago: (o as any).metodo_pago,
      items_distintos: (o as any).items_distintos,
      unidades: (o as any).unidades,
      items: ((o as any).items ?? ordenesItemsMap[id] ?? []) as CompraItemLocal[],
    };
  });

  const sortedOrders = [...orders].filter((o) => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return (
      String(o.proveedor ?? '').toLowerCase().includes(q) ||
      String(o.local_nombre ?? '').toLowerCase().includes(q) ||
      String(o.id ?? '').toLowerCase().includes(q)
    );
  }).sort((a, b) => {
    let va = a[sortKey] as string | number;
    let vb = b[sortKey] as string | number;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      <span className="ml-1 text-[#ED7C00]">{sortDir === 'asc' ? '↑' : '↓'}</span>
    ) : (
      <span className="ml-1 text-[#32576F]">↕</span>
    );

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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiCard label="Top 10 concentracion" value={`${Number(data.analisis?.concentracion_top10_pct ?? 0).toFixed(2)}%`} />
              <KpiCard label="Proveedores activos" value={`${Number(data.analisis?.cantidad_proveedores ?? 0)}`} />
              <KpiCard label="Proveedor principal" value={`${Number(data.analisis?.proveedor_principal_pct ?? 0).toFixed(2)}%`} />
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

            {/* Listado de órdenes */}
            {(data.ultimas_compras?.length ?? 0) > 0 && (
              <ChartContainer
                title="Órdenes de compra"
                subtitle={`${data.ultimas_compras!.length} órdenes en el período · click para ver detalle`}
                exportFileName={`compras_ordenes_${tenantId}`}
              >
                {/* Search */}
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder="Buscar por proveedor, local..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="w-full sm:w-72 bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        <th className="w-8" />
                        {[
                          { label: 'Fecha', key: 'fecha' as SortKey },
                          { label: 'Proveedor', key: 'proveedor' as SortKey },
                          { label: 'Local', key: null },
                          { label: 'Método', key: null },
                          { label: 'Items', key: null },
                          { label: 'Unidades', key: 'unidades' as SortKey },
                          { label: 'Total', key: 'total' as SortKey },
                        ].map(({ label, key }) => (
                          <th
                            key={label}
                            onClick={() => key && toggleSort(key)}
                            className={`text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap ${key ? 'cursor-pointer hover:text-white' : ''}`}
                          >
                            {label}
                            {key && <SortIcon k={key} />}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedOrders.map((o, i) => (
                        <>
                          <tr
                            key={`o-${i}`}
                            className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors cursor-pointer"
                            onClick={() => toggleOrder(o.id)}
                          >
                            <td className="py-2 px-2 text-center">
                              <span className="text-[#7A9BAD] text-xs">{expandedOrders.has(o.id) ? '▼' : '▶'}</span>
                            </td>
                            <td className="py-2 px-3 text-[#7A9BAD] font-mono text-xs whitespace-nowrap">{o.fecha}</td>
                            <td className="py-2 px-3 text-white font-medium">{o.proveedor}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{o.local_nombre}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{o.metodo_pago}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{o.items_distintos}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{o.unidades}</td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono font-semibold">{fmt(Number(o.total))}</td>
                          </tr>
                          {expandedOrders.has(o.id) && (
                            <tr key={`od-${i}`}>
                              <td colSpan={8} className="py-0">
                                <div className="bg-[#0D1A20] border-b border-[#32576F]/40 px-8 py-3">
                                  <p className="text-[#7A9BAD] text-xs mb-2">
                                    Orden #{o.id} · {o.fecha} · {o.proveedor}
                                    {o.metodo_pago && o.metodo_pago !== 'Sin método' ? ` · ${o.metodo_pago}` : ''}
                                  </p>
                                  {o.items && o.items.length > 0 ? (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-[#32576F]/40">
                                          {['Descripción', 'Talle', 'Color', 'Cant.', 'Costo unit.', 'Subtotal'].map((h) => (
                                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-1 pr-3 uppercase">{h}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {o.items.map((item, idx) => (
                                          <tr key={idx} className="border-b border-[#32576F]/20">
                                            <td className="py-1 pr-3 text-white">
                                              <span className="font-medium">{item.nombre}</span>
                                              {item.descripcion && <span className="text-[#7A9BAD] ml-1">· {item.descripcion}</span>}
                                            </td>
                                            <td className="py-1 pr-3 text-[#CDD4DA]">{item.talle || '—'}</td>
                                            <td className="py-1 pr-3 text-[#CDD4DA]">{item.color || '—'}</td>
                                            <td className="py-1 pr-3 text-white font-mono">{item.cantidad}</td>
                                            <td className="py-1 pr-3 text-[#7A9BAD] font-mono">{fmt(item.costo_unitario)}</td>
                                            <td className="py-1 pr-3 text-[#ED7C00] font-mono font-semibold">{fmt(item.subtotal)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div className="grid grid-cols-3 gap-4 text-sm">
                                      <div>
                                        <span className="text-[#7A9BAD] text-xs">Items distintos</span>
                                        <p className="text-white font-semibold">{o.items_distintos}</p>
                                      </div>
                                      <div>
                                        <span className="text-[#7A9BAD] text-xs">Unidades totales</span>
                                        <p className="text-white font-semibold">{o.unidades}</p>
                                      </div>
                                      <div>
                                        <span className="text-[#7A9BAD] text-xs">Monto total</span>
                                        <p className="text-[#ED7C00] font-mono font-semibold">{fmt(Number(o.total))}</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                  {sortedOrders.length === 0 && (
                    <p className="text-[#7A9BAD] text-sm text-center py-8">
                      {searchText ? 'Sin resultados para la búsqueda' : 'Sin órdenes en el período'}
                    </p>
                  )}
                </div>
              </ChartContainer>
            )}

            {/* Tabla completa de productos */}
            <ChartContainer
              title="Todos los productos comprados"
              subtitle={`${data.top_productos.length} productos distintos`}
              exportFileName={`compras_productos_${tenantId}`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['#', 'Producto', 'Talle', 'Color', 'Total comprado', 'Unidades'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_productos.map((p, i) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3 text-[#7A9BAD] text-xs">{i + 1}</td>
                        <td className="py-2 px-3 text-white font-medium">{p.nombre}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.talle || '—'}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.color || '—'}</td>
                        <td className="py-2 px-3 text-[#ED7C00] font-mono">{fmt(p.total)}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.cantidad}</td>
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
