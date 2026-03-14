'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend,
} from 'recharts';
import {
  api,
  type StockResponse,
  type ProductoStock,
  type AbcNombre,
  type MasVendido,
  type FiltrosDisponibles,
  type AnalyticsFilters,
} from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

const ABC_COLORS = { A: '#ED7C00', B: '#3B82F6', C: '#6B7280' };
const ABC_BG = {
  A: 'bg-[#ED7C00]/10 text-[#ED7C00] border border-[#ED7C00]/30',
  B: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  C: 'bg-gray-500/10 text-gray-400 border border-gray-500/30',
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function fmtN(n: number) {
  return new Intl.NumberFormat('es-AR').format(n);
}

function KpiCard({ label, value, sub, color, onClick }: { label: string; value: string; sub?: string; color?: string; onClick?: () => void }) {
  return (
    <div
      className={`bg-[#132229] border border-[#32576F] rounded-xl p-4 ${onClick ? 'cursor-pointer hover:bg-[#1E3340] transition-colors' : ''}`}
      onClick={onClick}
    >
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

function RotacionCell({ r }: { r: number }) {
  const color = r >= 1 ? 'text-green-400' : r >= 0.3 ? 'text-yellow-400' : 'text-red-400';
  return <span className={color}>{r.toFixed(2)}x</span>;
}

export default function StockAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<StockResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Rotation monthly detail toggle
  const [showRotacionMensual, setShowRotacionMensual] = useState(false);

  // ABC filters
  const [abcDescFilter, setAbcDescFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [abcNombreFilter, setAbcNombreFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [pageDesc, setPageDesc] = useState(0);
  const [pageNombre, setPageNombre] = useState(0);
  const PAGE_SIZE = 30;

  // Most sold period (from DateRangeFilter applies to all, but this is for display)
  const [masVendidosSearch, setMasVendidosSearch] = useState('');

  // ABC view toggle: 'chart' | 'table'
  const [abcNombreView, setAbcNombreView] = useState<'chart' | 'table'>('chart');
  const [abcDescView, setAbcDescView] = useState<'chart' | 'table'>('chart');

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    setPageDesc(0);
    setPageNombre(0);
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

  // Filtered ABC por descripcion
  const filteredDesc = (data?.productos ?? []).filter((p) =>
    abcDescFilter === 'all' ? true : p.clasificacion_abc === abcDescFilter
  );
  const paginatedDesc = filteredDesc.slice(pageDesc * PAGE_SIZE, (pageDesc + 1) * PAGE_SIZE);
  const totalPagesDesc = Math.ceil(filteredDesc.length / PAGE_SIZE);

  // Filtered ABC por nombre
  const filteredNombre = (data?.abc_por_nombre ?? []).filter((p) =>
    abcNombreFilter === 'all' ? true : p.clasificacion_abc === abcNombreFilter
  );
  const paginatedNombre = filteredNombre.slice(pageNombre * PAGE_SIZE, (pageNombre + 1) * PAGE_SIZE);
  const totalPagesNombre = Math.ceil(filteredNombre.length / PAGE_SIZE);

  // ABC chart data (top 20 by contribution)
  const abcNombreChartData = (data?.abc_por_nombre ?? []).slice(0, 20).map((p) => ({
    nombre: p.nombre.length > 16 ? p.nombre.slice(0, 16) + '…' : p.nombre,
    contribucion: p.contribucion_pct,
    stock: p.stock_total,
    vendidas: p.unidades_vendidas,
    monto: p.monto_stock,
    abc: p.clasificacion_abc,
  }));

  const abcDescChartData = ((data?.abc_por_descripcion ?? []) as Array<Record<string, unknown>>).slice(0, 20).map((p) => ({
    nombre: String(p.nombre ?? '').length > 12 ? String(p.nombre ?? '').slice(0, 12) + '…' : String(p.nombre ?? ''),
    descripcion: p.descripcion ? String(p.descripcion).slice(0, 14) : '',
    label: p.descripcion ? `${p.nombre} · ${p.descripcion}` : String(p.nombre ?? ''),
    contribucion: Number(p.contribucion_pct ?? 0),
    stock: Number(p.stock_total ?? 0),
    vendidas: Number(p.unidades_vendidas ?? 0),
    abc: String(p.clasificacion_abc ?? 'C'),
  }));

  // Most sold filtered
  const masVendidosFiltrados = (data?.mas_vendidos ?? []).filter((p) =>
    masVendidosSearch
      ? p.nombre.toLowerCase().includes(masVendidosSearch.toLowerCase()) ||
        p.descripcion.toLowerCase().includes(masVendidosSearch.toLowerCase())
      : true
  );

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
          <p className="text-[#7A9BAD] text-sm">Valor, rotación, calce financiero y análisis ABC</p>
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
            {/* ── KPIs Row 1: financial metrics ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="Valor total del stock"
                value={fmt(data.monto_total_stock)}
                sub="precio de compra × unidades"
                color="text-[#ED7C00]"
              />
              <KpiCard
                label="Rotación promedio mensual"
                value={`${data.rotacion_promedio_mensual.toFixed(2)}x`}
                sub={data.rotacion_mensual.length > 0 ? `${data.rotacion_mensual.length} meses · click para ver detalle` : 'CMV / stock promedio'}
                color={data.rotacion_promedio_mensual >= 1 ? 'text-green-400' : 'text-yellow-400'}
                onClick={() => setShowRotacionMensual((v) => !v)}
              />
              <KpiCard
                label="Calce financiero"
                value={data.calce_financiero_dias != null ? `${data.calce_financiero_dias.toFixed(0)} días` : '—'}
                sub="días para recuperar inversión en compras"
                color={
                  data.calce_financiero_dias == null ? 'text-[#7A9BAD]' :
                  data.calce_financiero_dias <= 30 ? 'text-green-400' :
                  data.calce_financiero_dias <= 60 ? 'text-yellow-400' : 'text-red-400'
                }
              />
              <KpiCard
                label="SKUs sin stock"
                value={fmtN(data.skus_sin_stock)}
                sub={`de ${fmtN(data.total_skus)} SKUs totales`}
                color="text-red-400"
              />
            </div>

            {/* ── KPIs Row 2: risk metrics ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="En substock (< 7d)"
                value={fmtN(data.substock_count)}
                sub="productos en riesgo de quiebre"
                color="text-red-400"
              />
              <KpiCard
                label="En sobrestock (> 90d)"
                value={fmtN(data.sobrestock_count)}
                sub="capital inmovilizado"
                color="text-blue-400"
              />
              <KpiCard
                label="Clase A (80% revenue)"
                value={fmtN(data.abc_por_nombre.filter((p) => p.clasificacion_abc === 'A').length)}
                sub="tipos de producto más rentables"
                color="text-[#ED7C00]"
              />
              <KpiCard
                label="Compras del período"
                value={fmt(data.compras_total_periodo)}
                sub={data.tasa_crecimiento_ventas !== 0 ? `Ventas ${data.tasa_crecimiento_ventas > 0 ? '+' : ''}${data.tasa_crecimiento_ventas.toFixed(1)}% vs anterior` : 'vs período anterior'}
                color={data.tasa_crecimiento_ventas > 0 ? 'text-green-400' : data.tasa_crecimiento_ventas < 0 ? 'text-red-400' : 'text-white'}
              />
            </div>

            {/* ── Rotación mensual detail ── */}
            {showRotacionMensual && data.rotacion_mensual.length > 0 && (
              <ChartContainer
                title="Rotación mensual"
                subtitle="CMV / stock promedio mensual · calculado desde ventas y compras"
                exportFileName={`stock_rotacion_mensual_${tenantId}`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.rotacion_mensual} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="mes" stroke="#7A9BAD" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)}x`} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number | undefined, name: string | undefined) => [
                        name === 'rotacion' ? `${(v ?? 0).toFixed(2)}x` : fmt(v ?? 0),
                        name === 'rotacion' ? 'Rotación' : name === 'cmv' ? 'CMV' : 'Stock promedio',
                      ]}
                    />
                    <Legend formatter={(v) => <span style={{ color: '#CDD4DA', fontSize: 11 }}>{v === 'rotacion' ? 'Rotación' : v === 'cmv' ? 'CMV' : 'Stock promedio'}</span>} />
                    <Line type="monotone" dataKey="rotacion" stroke="#ED7C00" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Mes', 'Rotación', 'CMV', 'Stock promedio'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-1.5 px-3 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rotacion_mensual.map((r, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40">
                          <td className="py-1.5 px-3 text-[#CDD4DA]">{r.mes}</td>
                          <td className="py-1.5 px-3">
                            <span className={r.rotacion >= 1 ? 'text-green-400' : r.rotacion >= 0.3 ? 'text-yellow-400' : 'text-red-400'}>
                              {r.rotacion.toFixed(2)}x
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-[#ED7C00] font-mono">{fmt(r.cmv)}</td>
                          <td className="py-1.5 px-3 text-white font-mono">{fmt(r.stock_promedio)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>
            )}

            {/* ── Productos más vendidos ── */}
            <ChartContainer
              title="Productos más vendidos"
              subtitle="Por unidades vendidas en el período seleccionado · con stock actual"
              exportFileName={`stock_masvendidos_${tenantId}`}
            >
              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={masVendidosSearch}
                  onChange={(e) => setMasVendidosSearch(e.target.value)}
                  className="w-full sm:w-64 bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['#', 'Nombre', 'Descripción', 'Talle', 'Color', 'Vendidas', 'Stock'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {masVendidosFiltrados.map((p: MasVendido, i: number) => (
                      <tr
                        key={i}
                        className={`border-b border-[#32576F]/40 transition-colors ${
                          p.alerta_stock ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-[#132229]'
                        }`}
                      >
                        <td className="py-2 px-3 text-[#7A9BAD] text-xs">{i + 1}</td>
                        <td className="py-2 px-3 text-white font-medium max-w-[130px] truncate">{p.nombre}</td>
                        <td className="py-2 px-3 text-[#CDD4DA] max-w-[130px] truncate">{p.descripcion || '—'}</td>
                        <td className="py-2 px-3 text-[#CDD4DA] text-xs">{p.talle || '—'}</td>
                        <td className="py-2 px-3 text-[#CDD4DA] text-xs">{p.color || '—'}</td>
                        <td className="py-2 px-3 text-[#ED7C00] font-mono font-semibold">{p.unidades_vendidas}</td>
                        <td className={`py-2 px-3 font-mono ${p.alerta_stock ? 'text-red-400 font-bold' : 'text-white'}`}>
                          {p.stock_actual}
                          {p.alerta_stock && <span className="ml-1 text-xs text-red-400">↓</span>}
                        </td>
                      </tr>
                    ))}
                    {masVendidosFiltrados.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-[#7A9BAD] text-sm">Sin resultados</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </ChartContainer>

            {/* ── ABC por nombre ── */}
            <ChartContainer
              title="ABC por nombre de producto"
              subtitle="Clasificación por contribución al revenue · A=80% · B=15% · C=5%"
              exportFileName={`stock_abc_nombre_${tenantId}`}
            >
              <div className="flex gap-2 mb-4 flex-wrap items-center">
                <div className="flex gap-1">
                  {(['chart', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setAbcNombreView(v)}
                      className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                        abcNombreView === v ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                      }`}
                    >
                      {v === 'chart' ? 'Gráfico' : 'Tabla'}
                    </button>
                  ))}
                </div>
                {abcNombreView === 'table' && (
                  <div className="flex gap-1 ml-2">
                    {(['all', 'A', 'B', 'C'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => { setAbcNombreFilter(f); setPageNombre(0); }}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          abcNombreFilter === f
                            ? 'bg-[#ED7C00] text-white'
                            : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                        }`}
                      >
                        {f === 'all' ? 'Todos' : `Clase ${f}`}
                      </button>
                    ))}
                  </div>
                )}
                <span className="text-xs text-[#7A9BAD] ml-auto">{data.abc_por_nombre.length} tipos de producto</span>
              </div>

              {abcNombreView === 'chart' ? (
                <ResponsiveContainer width="100%" height={abcNombreChartData.length * 28 + 40}>
                  <BarChart data={abcNombreChartData} layout="vertical" margin={{ left: 10, right: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                    <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
                    <YAxis type="category" dataKey="nombre" stroke="#7A9BAD" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number | undefined, _n, p) => [
                        `${(v ?? 0).toFixed(1)}% · ${p.payload.vendidas} uds · ${fmt(p.payload.monto)}`,
                        `Clase ${p.payload.abc}`,
                      ]}
                    />
                    <Bar dataKey="contribucion" radius={[0, 3, 3, 0]}>
                      {abcNombreChartData.map((entry, idx) => (
                        <Cell key={idx} fill={ABC_COLORS[entry.abc as 'A' | 'B' | 'C']} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#32576F]">
                          {['ABC', 'Nombre', 'Stock total', 'Valor stock', 'Vendidas', 'Rotación', 'Contribución'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedNombre.map((p: AbcNombre, i: number) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                            <td className="py-2 px-3"><AbcBadge cls={p.clasificacion_abc as 'A' | 'B' | 'C'} /></td>
                            <td className="py-2 px-3 text-white font-semibold">{p.nombre}</td>
                            <td className="py-2 px-3 text-white font-mono">{p.stock_total}</td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono">{fmt(p.monto_stock)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{p.unidades_vendidas}</td>
                            <td className="py-2 px-3"><RotacionCell r={p.rotacion} /></td>
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
                                <span className="text-[#7A9BAD] text-xs">{p.contribucion_pct}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPagesNombre > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#32576F]">
                      <button onClick={() => setPageNombre((p) => Math.max(0, p - 1))} disabled={pageNombre === 0} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40">← Anterior</button>
                      <span className="text-xs text-[#7A9BAD]">Página {pageNombre + 1} de {totalPagesNombre}</span>
                      <button onClick={() => setPageNombre((p) => Math.min(totalPagesNombre - 1, p + 1))} disabled={pageNombre >= totalPagesNombre - 1} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40">Siguiente →</button>
                    </div>
                  )}
                </>
              )}
            </ChartContainer>

            {/* ── ABC por descripción ── */}
            <ChartContainer
              title="ABC por descripción de producto"
              subtitle="Agrupado por nombre · descripción — detalle por variante"
              exportFileName={`stock_abc_desc_${tenantId}`}
            >
              <div className="flex gap-2 mb-4 flex-wrap items-center">
                <div className="flex gap-1">
                  {(['chart', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setAbcDescView(v)}
                      className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                        abcDescView === v ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                      }`}
                    >
                      {v === 'chart' ? 'Gráfico' : 'Tabla'}
                    </button>
                  ))}
                </div>
                {abcDescView === 'table' && (
                  <div className="flex gap-1 ml-2">
                    {(['all', 'A', 'B', 'C'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => { setAbcDescFilter(f); setPageDesc(0); }}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          abcDescFilter === f
                            ? 'bg-[#ED7C00] text-white'
                            : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                        }`}
                      >
                        {f === 'all' ? 'Todos' : `Clase ${f}`}
                      </button>
                    ))}
                  </div>
                )}
                <span className="text-xs text-[#7A9BAD] ml-auto">{data.productos.length} variantes</span>
              </div>

              {abcDescView === 'chart' ? (
                <ResponsiveContainer width="100%" height={abcDescChartData.length * 28 + 40}>
                  <BarChart data={abcDescChartData} layout="vertical" margin={{ left: 10, right: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                    <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      stroke="#7A9BAD"
                      tick={{ fontSize: 9 }}
                      width={150}
                      tickFormatter={(v) => v.length > 22 ? v.slice(0, 22) + '…' : v}
                    />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number | undefined, _n, p) => [
                        `${(v ?? 0).toFixed(1)}% · ${p.payload.vendidas} uds · stock: ${p.payload.stock}`,
                        `Clase ${p.payload.abc}`,
                      ]}
                    />
                    <Bar dataKey="contribucion" radius={[0, 3, 3, 0]}>
                      {abcDescChartData.map((entry, idx) => (
                        <Cell key={idx} fill={ABC_COLORS[entry.abc as 'A' | 'B' | 'C']} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#32576F]">
                          {['ABC', 'Nombre', 'Descripción', 'Talle', 'Color', 'Stock', 'Valor', 'Vendidas', 'Rotación', 'Contribución'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedDesc.map((p: ProductoStock, i: number) => (
                          <tr
                            key={i}
                            className={`border-b border-[#32576F]/40 transition-colors ${
                              p.es_substock ? 'bg-red-500/5 hover:bg-red-500/10' :
                              p.es_sobrestock ? 'bg-blue-500/5 hover:bg-blue-500/10' :
                              'hover:bg-[#132229]'
                            }`}
                          >
                            <td className="py-2 px-3"><AbcBadge cls={p.clasificacion_abc as 'A' | 'B' | 'C'} /></td>
                            <td className="py-2 px-3 text-white font-medium max-w-[110px] truncate">
                              {p.nombre}
                              {p.es_substock && <span className="ml-1 text-xs text-red-400">↓</span>}
                              {p.es_sobrestock && <span className="ml-1 text-xs text-blue-400">↑</span>}
                            </td>
                            <td className="py-2 px-3 text-[#CDD4DA] max-w-[110px] truncate">{p.descripcion || '—'}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] text-xs">{p.talle || '—'}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] text-xs">{p.color || '—'}</td>
                            <td className="py-2 px-3 text-white font-mono">{p.stock_actual}</td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono text-xs">{fmt(p.monto_stock)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{p.unidades_vendidas_periodo}</td>
                            <td className="py-2 px-3"><RotacionCell r={p.rotacion} /></td>
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
                                <span className="text-[#7A9BAD] text-xs">{p.contribucion_pct}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-4 mt-3 text-xs text-[#7A9BAD]">
                    <span><span className="text-red-400">↓</span> = substock (&lt;7d)</span>
                    <span><span className="text-blue-400">↑</span> = sobrestock (&gt;90d)</span>
                  </div>
                  {totalPagesDesc > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[#32576F]">
                      <button onClick={() => setPageDesc((p) => Math.max(0, p - 1))} disabled={pageDesc === 0} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40">← Anterior</button>
                      <span className="text-xs text-[#7A9BAD]">Página {pageDesc + 1} de {totalPagesDesc}</span>
                      <button onClick={() => setPageDesc((p) => Math.min(totalPagesDesc - 1, p + 1))} disabled={pageDesc >= totalPagesDesc - 1} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40">Siguiente →</button>
                    </div>
                  )}
                </>
              )}
            </ChartContainer>

            {/* ── Explicación ABC ── */}
            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
              <p className="text-[#7A9BAD] text-xs leading-relaxed">
                <strong className="text-[#CDD4DA]">Análisis ABC:</strong>{' '}
                <span className="text-[#ED7C00]">Clase A</span> = productos que generan el 80% del revenue ·{' '}
                <span className="text-blue-400">Clase B</span> = siguiente 15% ·{' '}
                <span className="text-gray-400">Clase C</span> = últimos 5%.{' '}
                <strong className="text-[#CDD4DA]">Substock</strong> = cobertura &lt; 7 días con ventas activas.{' '}
                <strong className="text-[#CDD4DA]">Sobrestock</strong> = cobertura &gt; 90 días con ventas activas.{' '}
                <strong className="text-[#CDD4DA]">Calce financiero</strong> = días para recuperar el dinero invertido en compras mediante el CMV diario promedio.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
