'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type StockResponse, type FiltrosDisponibles } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/format';
import { Loader2, Package, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#22C55E', '#ED7C00', '#EF4444', '#32576F', '#7A9BAD'];
const ABC_COLORS: Record<string, string> = { A: '#22C55E', B: '#ED7C00', C: '#EF4444' };

export default function StockPage() {
  const { tenant, loading: authLoading } = useAuth();
  const [data, setData] = useState<StockResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localId, setLocalId] = useState<number | undefined>();

  useEffect(() => {
    if (!tenant?.id) return;
    api.analytics.filtros(tenant.id).then(setFiltros).catch(() => {});
  }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id) return;
    setLoading(true);
    setError(null);
    api.analytics.stock(tenant.id, { local_id: localId })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tenant?.id, localId]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando stock...</span>
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

  const abcData = Object.entries(data.analisis_stock).map(([key, value]) => ({
    name: key,
    value,
    fill: ABC_COLORS[key] ?? '#7A9BAD',
  }));

  return (
    <div className="space-y-6">
      {/* Filter */}
      {filtros && filtros.locales.length > 1 && (
        <div className="flex gap-3 items-end">
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
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Valor stock (venta)" value={formatMoney(data.monto_total_stock)} icon={<Package className="w-5 h-5 text-blue-500" />} />
        <KpiCard label="Valor stock (costo)" value={formatMoney(data.monto_total_stock_compra)} icon={<Package className="w-5 h-5 text-purple-500" />} />
        <KpiCard label="Total productos" value={formatNumber(data.total_productos)} icon={<Package className="w-5 h-5 text-[#32576F]" />} />
        <KpiCard label="SKUs totales" value={formatNumber(data.total_skus)} icon={<Package className="w-5 h-5 text-indigo-500" />} />
        <KpiCard
          label="Bajo stock"
          value={formatNumber(data.skus_bajo_stock)}
          icon={<AlertTriangle className="w-5 h-5 text-orange-500" />}
          highlight={data.skus_bajo_stock > 0 ? 'orange' : undefined}
        />
        <KpiCard
          label="Sin stock"
          value={formatNumber(data.skus_sin_stock)}
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          highlight={data.skus_sin_stock > 0 ? 'red' : undefined}
        />
      </div>

      {/* Rotation & Coverage */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Rotación general</p>
          <p className="text-lg font-bold text-[#132229]">{data.rotacion_general.toFixed(2)}x</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Cobertura general</p>
          <p className="text-lg font-bold text-[#132229]">{Math.round(data.cobertura_general_dias)} días</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Sub-stock</p>
          <div className="flex items-center gap-1">
            <TrendingDown className="w-4 h-4 text-orange-500" />
            <p className="text-lg font-bold text-[#132229]">{formatNumber(data.substock_count)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Sobre-stock</p>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-4 h-4 text-red-500" />
            <p className="text-lg font-bold text-[#132229]">{formatNumber(data.sobrestock_count)}</p>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ABC Classification */}
        {abcData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-[#132229] font-semibold mb-4">Clasificación ABC</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={abcData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                  {abcData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top sellers */}
        {data.mas_vendidos.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="text-[#132229] font-semibold mb-4">Más vendidos</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.mas_vendidos.slice(0, 8)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v: number) => formatNumber(v)} />
                <Bar dataKey="unidades_vendidas" fill="#ED7C00" radius={[0, 4, 4, 0]} name="Unidades" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Low stock alerts */}
      {data.mas_vendidos.filter(p => p.alerta_stock).length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
          <h3 className="text-orange-800 font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Alertas de stock bajo
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.mas_vendidos.filter(p => p.alerta_stock).map((p, i) => (
              <div key={i} className="bg-white rounded-lg p-3 border border-orange-200">
                <p className="text-sm font-medium text-[#132229]">{p.nombre}</p>
                <p className="text-xs text-gray-500">{p.descripcion}{p.talle ? ` · ${p.talle}` : ''}{p.color ? ` · ${p.color}` : ''}</p>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-orange-600 font-medium">Stock: {p.stock_actual}</span>
                  <span className="text-gray-500">Cobertura: {Math.round(p.cobertura_dias)}d</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ABC by product name table */}
      {data.abc_por_nombre.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-[#132229] font-semibold mb-4">Análisis ABC por producto</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Producto</th>
                  <th className="pb-2 font-medium text-center">ABC</th>
                  <th className="pb-2 font-medium text-right">Stock</th>
                  <th className="pb-2 font-medium text-right">Valor</th>
                  <th className="pb-2 font-medium text-right">Vendidas</th>
                  <th className="pb-2 font-medium text-right">Rotación</th>
                  <th className="pb-2 font-medium text-right">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {data.abc_por_nombre.slice(0, 20).map((p, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-[#132229] font-medium">{p.nombre}</td>
                    <td className="py-2 text-center">
                      <span className={`inline-block w-6 h-6 rounded-full text-xs font-bold leading-6 text-white text-center ${
                        p.clasificacion_abc === 'A' ? 'bg-green-500' : p.clasificacion_abc === 'B' ? 'bg-orange-500' : 'bg-red-500'
                      }`}>
                        {p.clasificacion_abc}
                      </span>
                    </td>
                    <td className="py-2 text-right text-[#132229]">{formatNumber(p.stock_total)}</td>
                    <td className="py-2 text-right text-[#132229]">{formatMoney(p.monto_stock)}</td>
                    <td className="py-2 text-right text-[#132229]">{formatNumber(p.unidades_vendidas)}</td>
                    <td className="py-2 text-right text-[#132229]">{p.rotacion.toFixed(2)}x</td>
                    <td className="py-2 text-right text-gray-500">{Math.round(p.cobertura_dias)}d</td>
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

function KpiCard({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: 'orange' | 'red' }) {
  const borderClass = highlight === 'orange' ? 'border-orange-300 bg-orange-50' : highlight === 'red' ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-xl border p-4 ${borderClass}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500">{label}</p>
        {icon}
      </div>
      <p className="text-lg font-bold text-[#132229]">{value}</p>
    </div>
  );
}
