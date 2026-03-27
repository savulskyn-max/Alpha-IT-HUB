'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type ComprasResponse, type FiltrosDisponibles } from '@/lib/api';
import { formatMoney, formatNumber, formatDate } from '@/lib/format';
import { Loader2 } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';

function defaultDates() {
  const now = new Date();
  const desde = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    fecha_desde: desde.toISOString().slice(0, 10),
    fecha_hasta: now.toISOString().slice(0, 10),
  };
}

export default function PurchasesPage() {
  const { tenant, loading: authLoading } = useAuth();
  const [data, setData] = useState<ComprasResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState(defaultDates);
  const [proveedorId, setProveedorId] = useState<number | undefined>();

  useEffect(() => {
    if (!tenant?.id) return;
    api.analytics.filtros(tenant.id).then(setFiltros).catch(() => {});
  }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);
    api.analytics.compras(tenant.id, { ...dates, proveedor_id: proveedorId })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tenant?.id, dates, proveedorId]);

  const chartData = useMemo(() =>
    data?.serie_temporal.map((d) => ({ ...d, label: formatDate(d.fecha) })) ?? [],
    [data?.serie_temporal]
  );

  if (authLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando compras...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
        Error: {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Desde</label>
          <input
            type="date"
            value={dates.fecha_desde}
            onChange={(e) => setDates((d) => ({ ...d, fecha_desde: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-[#132229]"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Hasta</label>
          <input
            type="date"
            value={dates.fecha_hasta}
            onChange={(e) => setDates((d) => ({ ...d, fecha_hasta: e.target.value }))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-[#132229]"
          />
        </div>
        {filtros && filtros.proveedores.length > 1 && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Proveedor</label>
            <select
              value={proveedorId ?? ''}
              onChange={(e) => setProveedorId(e.target.value ? Number(e.target.value) : undefined)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-[#132229]"
            >
              <option value="">Todos</option>
              {filtros.proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Total compras" value={formatMoney(data.total_periodo)} />
        <KpiCard label="Cant. órdenes" value={formatNumber(data.cantidad_ordenes)} />
        <KpiCard label="Promedio por orden" value={formatMoney(data.promedio_por_orden)} />
        <KpiCard label="Unidades totales" value={formatNumber(data.unidades_totales)} />
      </div>

      {/* Time series */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-[#132229] font-semibold mb-4">Compras por día</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(l) => String(l)} />
              <Area type="monotone" dataKey="total" stroke="#32576F" fill="#32576F" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-400 text-sm py-8 text-center">Sin datos para el período seleccionado</p>
        )}
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top products */}
        {data.top_productos.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-[#132229] font-semibold mb-4">Top productos</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.top_productos.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="total" fill="#ED7C00" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top suppliers */}
        {data.top_proveedores.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-[#132229] font-semibold mb-4">Top proveedores</h3>
            <div className="space-y-3">
              {data.top_proveedores.map((prov, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <span className="text-sm text-[#132229] font-medium">{prov.proveedor}</span>
                    <span className="text-xs text-gray-400 ml-2">{prov.ordenes} órdenes</span>
                  </div>
                  <span className="text-sm font-medium text-[#132229]">{formatMoney(prov.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-[#132229]">{value}</p>
    </div>
  );
}
