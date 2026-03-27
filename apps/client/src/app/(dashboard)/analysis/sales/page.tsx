'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type VentasResponse, type FiltrosDisponibles } from '@/lib/api';
import { formatMoney, formatNumber, formatPercent, formatDate } from '@/lib/format';
import { Loader2 } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';

const COLORS = ['#32576F', '#ED7C00', '#1E3340', '#7A9BAD', '#4A90D9', '#D4A574'];

function defaultDates() {
  const now = new Date();
  const desde = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    fecha_desde: desde.toISOString().slice(0, 10),
    fecha_hasta: now.toISOString().slice(0, 10),
  };
}

export default function SalesPage() {
  const { tenant, loading: authLoading } = useAuth();
  const [data, setData] = useState<VentasResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState(defaultDates);
  const [localId, setLocalId] = useState<number | undefined>();

  useEffect(() => {
    if (!tenant?.id) return;
    api.analytics.filtros(tenant.id).then(setFiltros).catch(() => {});
  }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);
    api.analytics.ventas(tenant.id, { ...dates, local_id: localId })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tenant?.id, dates, localId]);

  const chartData = useMemo(() =>
    data?.serie_temporal.map((d) => ({ ...d, label: formatDate(d.fecha) })) ?? [],
    [data?.serie_temporal]
  );

  if (authLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando ventas...</span>
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
        {filtros && filtros.locales.length > 1 && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Local</label>
            <select
              value={localId ?? ''}
              onChange={(e) => setLocalId(e.target.value ? Number(e.target.value) : undefined)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-[#132229]"
            >
              <option value="">Todos</option>
              {filtros.locales.map((l) => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Total vendido" value={formatMoney(data.total_periodo)} />
        <KpiCard label="Cant. ventas" value={formatNumber(data.cantidad_ventas)} />
        <KpiCard label="Unidades" value={formatNumber(data.cantidad_unidades_vendidas)} />
        <KpiCard label="Ticket promedio" value={formatMoney(data.ticket_promedio)} />
      </div>

      {/* Time series chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-[#132229] font-semibold mb-4">Ventas por día</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatMoney(v)} labelFormatter={(l) => String(l)} />
              <Area type="monotone" dataKey="total" stroke="#ED7C00" fill="#ED7C00" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-400 text-sm py-8 text-center">Sin datos para el período seleccionado</p>
        )}
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By location */}
        {data.por_local.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-[#132229] font-semibold mb-4">Por local</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={data.por_local} dataKey="total" nameKey="nombre" cx="50%" cy="50%" outerRadius={80} label={({ nombre, pct }) => `${nombre} ${formatPercent(pct)}`}>
                  {data.por_local.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatMoney(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* By payment method */}
        {data.por_metodo_pago.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-[#132229] font-semibold mb-4">Por método de pago</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.por_metodo_pago} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="nombre" tick={{ fontSize: 12 }} width={100} />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Bar dataKey="total" fill="#32576F" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Top products */}
      {data.top_productos.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-[#132229] font-semibold mb-4">Top productos</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Producto</th>
                  <th className="pb-2 font-medium text-right">Cantidad</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {data.top_productos.slice(0, 10).map((p, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-[#132229]">
                      {p.nombre}
                      {p.talle && <span className="text-gray-400 ml-1">· {p.talle}</span>}
                      {p.color && <span className="text-gray-400 ml-1">· {p.color}</span>}
                    </td>
                    <td className="py-2 text-right text-[#132229]">{formatNumber(p.cantidad)}</td>
                    <td className="py-2 text-right text-[#132229] font-medium">{formatMoney(p.total)}</td>
                    <td className="py-2 text-right text-gray-500">{formatPercent(p.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
