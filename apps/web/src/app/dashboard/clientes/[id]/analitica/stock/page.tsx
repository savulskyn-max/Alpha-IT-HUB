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
  type ForecastResponse,
  type ProductForecast,
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

const POLICY_COLORS = {
  normal: 'bg-[#132229] text-[#CDD4DA] border border-[#32576F]',
  proteger: 'bg-[#ED7C00]/10 text-[#ED7C00] border border-[#ED7C00]/30',
  liquidar: 'bg-red-500/10 text-red-400 border border-red-500/30',
};

type Policy = { tipo: 'normal' | 'proteger' | 'liquidar'; stock_min_dias: number };
type PoliciesMap = Record<string, Policy>;

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

function AbcBadge({ cls }: { cls: 'A' | 'B' | 'C' }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded ${ABC_BG[cls]}`}>
      {cls}
    </span>
  );
}

function CoberturaCell({ dias }: { dias: number }) {
  const color =
    dias === 9999 ? 'text-[#7A9BAD]' :
    dias >= 30 ? 'text-green-400' :
    dias >= 7 ? 'text-yellow-400' : 'text-red-400';
  return <span className={color}>{dias === 9999 ? '∞' : `${dias}d`}</span>;
}

function RotacionCell({ r }: { r: number }) {
  const color = r >= 1 ? 'text-green-400' : r >= 0.3 ? 'text-yellow-400' : 'text-red-400';
  return <span className={color}>{r.toFixed(2)}x</span>;
}

function TendenciaBadge({ t }: { t: string }) {
  const cfg = {
    creciente: 'bg-green-500/10 text-green-400 border border-green-500/30',
    decreciente: 'bg-red-500/10 text-red-400 border border-red-500/30',
    estable: 'bg-[#32576F]/30 text-[#7A9BAD] border border-[#32576F]',
  }[t] ?? 'text-[#7A9BAD]';
  return <span className={`text-xs px-2 py-0.5 rounded ${cfg}`}>{t}</span>;
}

function ConfianzaBadge({ c }: { c: string }) {
  const cfg = {
    alta: 'text-green-400',
    media: 'text-yellow-400',
    baja: 'text-red-400',
  }[c] ?? 'text-[#7A9BAD]';
  return <span className={`text-xs ${cfg}`}>{c}</span>;
}

// Mini sparkline using inline SVG
function Sparkline({ data }: { data: number[] }) {
  if (!data.length) return <span className="text-[#7A9BAD] text-xs">—</span>;
  const max = Math.max(...data, 1);
  const W = 80, H = 24;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * W;
    const y = H - (v / max) * (H - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={W} height={H} className="inline-block">
      <polyline points={pts} fill="none" stroke="#3B82F6" strokeWidth="1.5" />
    </svg>
  );
}

function ForecastSparkline({ historico, prediccion }: { historico: number[]; prediccion: number[] }) {
  const allData = [...historico, ...prediccion];
  if (!allData.length) return null;
  const max = Math.max(...allData, 1);
  const W = 120, H = 30;
  const hLen = historico.length;
  const totalLen = allData.length;

  const pts = (arr: number[], offset: number) =>
    arr.map((v, i) => {
      const x = ((i + offset) / Math.max(totalLen - 1, 1)) * W;
      const y = H - (v / max) * (H - 4) - 2;
      return `${x},${y}`;
    }).join(' ');

  return (
    <svg width={W} height={H} className="inline-block">
      <polyline points={pts(historico, 0)} fill="none" stroke="#ED7C00" strokeWidth="1.5" />
      <polyline points={pts(prediccion, hLen)} fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeDasharray="3,2" />
    </svg>
  );
}

function POLICY_LABEL(t: Policy['tipo']) {
  return { normal: 'Normal', proteger: 'Proteger', liquidar: 'Liquidar' }[t];
}

function loadPolicies(tenantId: string): PoliciesMap {
  try {
    const raw = localStorage.getItem(`stock_policies_${tenantId}`);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePolicies(tenantId: string, policies: PoliciesMap) {
  try {
    localStorage.setItem(`stock_policies_${tenantId}`, JSON.stringify(policies));
  } catch { /* no-op */ }
}

export default function StockAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<StockResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Forecast
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [forecastSearch, setForecastSearch] = useState('');

  // Policies (persisted in localStorage)
  const [policies, setPolicies] = useState<PoliciesMap>({});
  const [showPolicies, setShowPolicies] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<{ nombre: string; policy: Policy } | null>(null);

  // ABC por descripción filters
  const [abcFilter, setAbcFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [page, setPage] = useState(0);

  // ABC por nombre filters
  const [abcNombreFilter, setAbcNombreFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [pageNombre, setPageNombre] = useState(0);

  const PAGE_SIZE = 30;

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    setPage(0);
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
    setPolicies(loadPolicies(tenantId));
  }, [tenantId, load]);

  async function loadForecast() {
    if (forecast) { setShowForecast(true); return; }
    setForecastLoading(true);
    try {
      const result = await api.analytics.stockForecast(tenantId);
      setForecast(result);
      setShowForecast(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar predicciones');
    } finally {
      setForecastLoading(false);
    }
  }

  function updatePolicy(nombre: string, policy: Policy) {
    const next = { ...policies, [nombre]: policy };
    setPolicies(next);
    savePolicies(tenantId, next);
  }

  const filteredDesc = data?.productos.filter((p) =>
    abcFilter === 'all' ? true : p.clasificacion_abc === abcFilter
  ) ?? [];
  const paginatedDesc = filteredDesc.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPagesDesc = Math.ceil(filteredDesc.length / PAGE_SIZE);

  const filteredNombre = data?.abc_por_nombre.filter((p) =>
    abcNombreFilter === 'all' ? true : p.clasificacion_abc === abcNombreFilter
  ) ?? [];
  const paginatedNombre = filteredNombre.slice(pageNombre * PAGE_SIZE, (pageNombre + 1) * PAGE_SIZE);
  const totalPagesNombre = Math.ceil(filteredNombre.length / PAGE_SIZE);

  // Top 20 most sold vs stock for comparison chart
  const masVendidosChart = (data?.mas_vendidos ?? []).slice(0, 15).map((p) => ({
    nombre: p.nombre.length > 18 ? p.nombre.slice(0, 18) + '…' : p.nombre,
    vendidas: p.unidades_vendidas,
    stock: p.stock_actual,
    alerta: p.alerta_stock,
  }));

  const masVendidosAlerta = data?.mas_vendidos.filter((p) => p.alerta_stock) ?? [];

  // Forecast filtered
  const filteredForecast = (forecast?.productos ?? []).filter((p) =>
    forecastSearch ? p.nombre.toLowerCase().includes(forecastSearch.toLowerCase()) : true
  );

  // Purchase recommendations: products where predicted demand > stock (considering policy)
  const recommendations = (forecast?.productos ?? [])
    .map((p) => {
      const policy = policies[p.nombre] ?? { tipo: 'normal', stock_min_dias: 30 };
      if (policy.tipo === 'liquidar') return null;
      const weeklyRate = p.prediccion_semanas.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
      const minDiasStock = policy.stock_min_dias;
      const minUnidades = Math.ceil((weeklyRate / 7) * minDiasStock);
      const stockActual = p.stock_actual;
      const sugerido = Math.max(0, minUnidades - stockActual);
      if (sugerido === 0) return null;
      const diasCobertura = weeklyRate > 0 ? Math.floor((stockActual / weeklyRate) * 7) : 9999;
      return {
        nombre: p.nombre,
        stock_actual: stockActual,
        pred_30d: p.prediccion_30d,
        dias_cobertura: diasCobertura,
        sugerido_compra: sugerido,
        policy_tipo: policy.tipo,
        tendencia: p.tendencia,
        confianza: p.confianza,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.dias_cobertura - b!.dias_cobertura))
    .slice(0, 30) as NonNullable<ReturnType<typeof recommendations[0]>>[];

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
          <p className="text-[#7A9BAD] text-sm">Niveles, rotación, cobertura, ABC y predicciones</p>
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
            {/* KPIs principales */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="Valor total del stock"
                value={fmt(data.monto_total_stock)}
                sub="precio de compra × stock"
                color="text-[#ED7C00]"
              />
              <KpiCard
                label="Rotación general"
                value={`${data.rotacion_general.toFixed(2)}x`}
                sub="unidades vendidas / stock"
                color={data.rotacion_general >= 1 ? 'text-green-400' : 'text-yellow-400'}
              />
              <KpiCard
                label="Cobertura general"
                value={data.cobertura_general === 9999 ? '∞' : `${data.cobertura_general}d`}
                sub="días de stock disponibles"
                color={data.cobertura_general >= 30 ? 'text-green-400' : data.cobertura_general >= 7 ? 'text-yellow-400' : 'text-red-400'}
              />
              <KpiCard
                label="SKUs sin stock"
                value={data.skus_sin_stock.toLocaleString('es-AR')}
                color="text-red-400"
              />
            </div>

            {/* Alertas substock / sobrestock */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="Substock (< 7 días)"
                value={data.substock_count.toLocaleString('es-AR')}
                sub="productos en riesgo de quiebre"
                color="text-red-400"
              />
              <KpiCard
                label="Sobrestock (> 90 días)"
                value={data.sobrestock_count.toLocaleString('es-AR')}
                sub="capital inmovilizado"
                color="text-blue-400"
              />
              <KpiCard
                label="Clase A (80% revenue)"
                value={data.productos.filter((p) => p.clasificacion_abc === 'A').length.toLocaleString('es-AR')}
                sub="productos más rentables"
                color="text-[#ED7C00]"
              />
              <KpiCard
                label="SKUs bajo stock mínimo"
                value={data.skus_bajo_stock.toLocaleString('es-AR')}
                color="text-yellow-400"
              />
            </div>

            {/* Explicación ABC */}
            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
              <p className="text-[#7A9BAD] text-xs leading-relaxed">
                <strong className="text-[#CDD4DA]">Análisis ABC:</strong>{' '}
                <span className="text-[#ED7C00]">Clase A</span> = productos que generan el 80% del revenue ·{' '}
                <span className="text-blue-400">Clase B</span> = siguiente 15% ·{' '}
                <span className="text-gray-400">Clase C</span> = últimos 5%.{' '}
                <strong className="text-[#CDD4DA]">Substock</strong> = cobertura &lt; 7 días con ventas activas.{' '}
                <strong className="text-[#CDD4DA]">Sobrestock</strong> = cobertura &gt; 90 días con ventas activas.{' '}
                La <strong className="text-[#CDD4DA]">cobertura ajustada</strong> incorpora la tasa de crecimiento del período anterior.
              </p>
            </div>

            {/* Alerta de productos más vendidos con poco stock */}
            {masVendidosAlerta.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                <p className="text-red-400 text-sm font-medium mb-3">
                  {masVendidosAlerta.length} producto{masVendidosAlerta.length > 1 ? 's' : ''} más vendido{masVendidosAlerta.length > 1 ? 's' : ''} con stock crítico
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-red-500/20">
                        {['Producto', 'Vendidas', 'Stock actual', 'Cobertura'].map((h) => (
                          <th key={h} className="text-left text-red-400/70 font-medium py-1.5 px-3 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {masVendidosAlerta.slice(0, 10).map((p, i) => (
                        <tr key={i} className="border-b border-red-500/10">
                          <td className="py-1.5 px-3 text-white">{p.descripcion}</td>
                          <td className="py-1.5 px-3 text-[#CDD4DA]">{p.unidades_vendidas}</td>
                          <td className="py-1.5 px-3 text-red-400 font-mono">{p.stock_actual}</td>
                          <td className="py-1.5 px-3">
                            <CoberturaCell dias={p.cobertura_dias} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Más vendidos vs stock — dual bar */}
            {masVendidosChart.length > 0 && (
              <ChartContainer
                title="Más vendidos vs stock actual"
                subtitle="Top 15 · naranjo = vendidas en período · azul = stock actual"
                exportFileName={`stock_vendidos_vs_stock_${tenantId}`}
              >
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={masVendidosChart} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                    <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="nombre" stroke="#7A9BAD" tick={{ fontSize: 10 }} width={130} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number, name: string) => [v, name === 'vendidas' ? 'Unidades vendidas' : 'Stock actual']}
                    />
                    <Legend formatter={(v) => <span style={{ color: '#CDD4DA', fontSize: 11 }}>{v === 'vendidas' ? 'Vendidas' : 'Stock actual'}</span>} />
                    <Bar dataKey="vendidas" fill="#ED7C00" radius={[0, 2, 2, 0]} />
                    <Bar dataKey="stock" fill="#3B82F6" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}

            {/* Bajo stock alert */}
            {data.bajo_stock.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
                <p className="text-yellow-400 text-sm font-medium mb-2">
                  {data.bajo_stock.length} productos bajo el stock mínimo configurado
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.bajo_stock.slice(0, 10).map((p, i) => (
                    <span key={i} className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded">
                      {String(p.Nombre ?? p.nombre ?? 'Producto')}
                    </span>
                  ))}
                  {data.bajo_stock.length > 10 && (
                    <span className="text-xs text-[#7A9BAD]">+{data.bajo_stock.length - 10} más</span>
                  )}
                </div>
              </div>
            )}

            {/* ── Más vendidos ── */}
            <ChartContainer
              title="Productos más vendidos"
              subtitle="Top 30 por unidades · con stock actual y cobertura"
              exportFileName={`stock_masvendidos_${tenantId}`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['#', 'Producto', 'Vendidas', 'Stock', 'Cobertura', 'Alerta'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.mas_vendidos.map((p: MasVendido, i: number) => (
                      <tr key={i} className={`border-b border-[#32576F]/40 transition-colors ${p.alerta_stock ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-[#132229]'}`}>
                        <td className="py-2 px-3 text-[#7A9BAD] text-xs">{i + 1}</td>
                        <td className="py-2 px-3 text-white font-medium max-w-[200px] truncate">{p.descripcion}</td>
                        <td className="py-2 px-3 text-[#ED7C00] font-mono font-semibold">{p.unidades_vendidas}</td>
                        <td className="py-2 px-3 text-white font-mono">{p.stock_actual}</td>
                        <td className="py-2 px-3"><CoberturaCell dias={p.cobertura_dias} /></td>
                        <td className="py-2 px-3">
                          {p.alerta_stock
                            ? <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-medium">Stock crítico</span>
                            : <span className="text-xs text-green-400">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartContainer>

            {/* ── ABC por nombre (agregado) ── */}
            <ChartContainer
              title="ABC por nombre de producto"
              subtitle="Agrupado por tipo: zapatilla, remera, pantalón, etc."
              exportFileName={`stock_abc_nombre_${tenantId}`}
            >
              <div className="flex gap-2 mb-4 flex-wrap items-center">
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
                <span className="text-xs text-[#7A9BAD] ml-auto">{filteredNombre.length} tipos de producto</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['ABC', 'Nombre', 'Stock total', 'Valor stock', 'Vendidas', 'Rotación', 'Cobertura', 'Contribución'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedNombre.map((p: AbcNombre, i: number) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3">
                          <AbcBadge cls={p.clasificacion_abc as 'A' | 'B' | 'C'} />
                        </td>
                        <td className="py-2 px-3 text-white font-semibold">{p.nombre}</td>
                        <td className="py-2 px-3 text-white font-mono">{p.stock_total}</td>
                        <td className="py-2 px-3 text-[#ED7C00] font-mono">{fmt(p.monto_stock)}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.unidades_vendidas}</td>
                        <td className="py-2 px-3"><RotacionCell r={p.rotacion} /></td>
                        <td className="py-2 px-3"><CoberturaCell dias={p.cobertura_dias} /></td>
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
                  <button onClick={() => setPageNombre((p) => Math.max(0, p - 1))} disabled={pageNombre === 0} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40 transition-colors">← Anterior</button>
                  <span className="text-xs text-[#7A9BAD]">Página {pageNombre + 1} de {totalPagesNombre}</span>
                  <button onClick={() => setPageNombre((p) => Math.min(totalPagesNombre - 1, p + 1))} disabled={pageNombre >= totalPagesNombre - 1} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40 transition-colors">Siguiente →</button>
                </div>
              )}
            </ChartContainer>

            {/* ── ABC por descripción (nombre+talle+color) ── */}
            <ChartContainer
              title="ABC por descripción de producto"
              subtitle="Detalle por nombre · talle · color — ordenado por contribución al revenue"
              exportFileName={`stock_abc_desc_${tenantId}`}
            >
              <div className="flex gap-2 mb-4 flex-wrap items-center">
                {(['all', 'A', 'B', 'C'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => { setAbcFilter(f); setPage(0); }}
                    className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                      abcFilter === f
                        ? 'bg-[#ED7C00] text-white'
                        : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                    }`}
                  >
                    {f === 'all' ? 'Todos' : `Clase ${f}`}
                  </button>
                ))}
                <span className="text-xs text-[#7A9BAD] ml-auto">{filteredDesc.length} variantes</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['ABC', 'Producto', 'Talle', 'Color', 'Stock', 'Valor', 'Vendidas', 'Rotación', 'Cobertura', 'Cob. ajust.', 'Contribución'].map((h) => (
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
                        <td className="py-2 px-3">
                          <AbcBadge cls={p.clasificacion_abc as 'A' | 'B' | 'C'} />
                        </td>
                        <td className="py-2 px-3 text-white font-medium max-w-[140px] truncate">
                          {p.nombre}
                          {p.es_substock && <span className="ml-1 text-xs text-red-400">↓</span>}
                          {p.es_sobrestock && <span className="ml-1 text-xs text-blue-400">↑</span>}
                        </td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.talle || '—'}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.color || '—'}</td>
                        <td className="py-2 px-3 text-white font-mono">{p.stock_actual}</td>
                        <td className="py-2 px-3 text-[#ED7C00] font-mono text-xs">{fmt(p.monto_stock)}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.unidades_vendidas_periodo}</td>
                        <td className="py-2 px-3"><RotacionCell r={p.rotacion} /></td>
                        <td className="py-2 px-3"><CoberturaCell dias={p.cobertura_dias} /></td>
                        <td className="py-2 px-3">
                          <span className="text-[#7A9BAD] text-xs">
                            {p.cobertura_ajustada === 9999 ? '∞' : `${p.cobertura_ajustada}d`}
                          </span>
                        </td>
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
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40 transition-colors">← Anterior</button>
                  <span className="text-xs text-[#7A9BAD]">Página {page + 1} de {totalPagesDesc}</span>
                  <button onClick={() => setPage((p) => Math.min(totalPagesDesc - 1, p + 1))} disabled={page >= totalPagesDesc - 1} className="text-xs text-[#7A9BAD] hover:text-white disabled:opacity-40 transition-colors">Siguiente →</button>
                </div>
              )}
            </ChartContainer>

            {/* ── Predicción de demanda ── */}
            <div className="bg-[#132229] border border-[#32576F] rounded-xl overflow-hidden">
              <div
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-[#1E3340] transition-colors"
                onClick={() => showForecast ? setShowForecast(false) : loadForecast()}
              >
                <div>
                  <h3 className="text-white font-semibold">Predicción de demanda</h3>
                  <p className="text-[#7A9BAD] text-xs mt-0.5">
                    Pronóstico de ventas por producto · suavizado exponencial de Holt
                    {forecast && ` · ${forecast.semanas_analizadas} semanas analizadas`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {forecastLoading && (
                    <div className="w-5 h-5 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
                  )}
                  <button className="px-3 py-1.5 bg-[#3B82F6]/20 border border-[#3B82F6]/40 text-blue-400 text-xs rounded-lg hover:bg-[#3B82F6]/30 transition-colors">
                    {showForecast ? 'Ocultar' : forecast ? 'Mostrar' : 'Calcular predicciones'}
                  </button>
                </div>
              </div>

              {showForecast && forecast && (
                <div className="px-6 pb-6 border-t border-[#32576F]">
                  {forecast.advertencia && (
                    <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2">
                      <p className="text-yellow-400 text-xs">{forecast.advertencia}</p>
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-3">
                    <input
                      type="text"
                      placeholder="Filtrar por nombre..."
                      value={forecastSearch}
                      onChange={(e) => setForecastSearch(e.target.value)}
                      className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00] w-56"
                    />
                    <div className="flex items-center gap-3 ml-auto text-xs text-[#7A9BAD]">
                      <span><span className="text-[#ED7C00]">—</span> Histórico</span>
                      <span><span className="text-[#3B82F6]">- -</span> Predicción</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto mt-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#32576F]">
                          {['Producto', 'Stock actual', 'Histórico / Predicción', 'Pred. 30d', 'Pred. 60d', 'Pred. 90d', 'Tendencia', 'Confianza'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredForecast.map((p: ProductForecast, i: number) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#1E3340] transition-colors">
                            <td className="py-2 px-3 text-white font-medium max-w-[160px] truncate">{p.nombre}</td>
                            <td className="py-2 px-3 text-white font-mono">{p.stock_actual}</td>
                            <td className="py-2 px-3">
                              <ForecastSparkline historico={p.historico} prediccion={p.prediccion_semanas} />
                            </td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono font-semibold">{p.prediccion_30d}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] font-mono">{p.prediccion_60d}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] font-mono">{p.prediccion_90d}</td>
                            <td className="py-2 px-3"><TendenciaBadge t={p.tendencia} /></td>
                            <td className="py-2 px-3"><ConfianzaBadge c={p.confianza} /></td>
                          </tr>
                        ))}
                        {filteredForecast.length === 0 && (
                          <tr>
                            <td colSpan={8} className="py-6 text-center text-[#7A9BAD] text-sm">
                              {forecastSearch ? `Sin resultados para "${forecastSearch}"` : 'Sin datos de predicción'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* ── Políticas de stock ── */}
            <div className="bg-[#132229] border border-[#32576F] rounded-xl overflow-hidden">
              <div
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-[#1E3340] transition-colors"
                onClick={() => setShowPolicies((v) => !v)}
              >
                <div>
                  <h3 className="text-white font-semibold">Políticas de stock por producto</h3>
                  <p className="text-[#7A9BAD] text-xs mt-0.5">
                    Configurá días mínimos de cobertura y política por producto · se guarda localmente
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {Object.keys(policies).length > 0 && (
                    <span className="text-xs bg-[#ED7C00]/20 text-[#ED7C00] px-2 py-0.5 rounded">
                      {Object.keys(policies).length} configurados
                    </span>
                  )}
                  <svg className={`w-4 h-4 text-[#7A9BAD] transition-transform ${showPolicies ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {showPolicies && (
                <div className="px-6 pb-6 border-t border-[#32576F]">
                  <p className="text-[#7A9BAD] text-xs mt-4 mb-3">
                    Seleccioná un producto para configurar su política:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(forecast?.productos ?? data.mas_vendidos.map((p) => ({ nombre: p.nombre }))).map((p, i) => {
                      const pol = policies[p.nombre] ?? { tipo: 'normal' as const, stock_min_dias: 30 };
                      return (
                        <div key={i} className="bg-[#1E3340] border border-[#32576F] rounded-lg p-3">
                          <p className="text-white text-sm font-medium mb-2 truncate">{p.nombre}</p>
                          <div className="flex gap-1 mb-2">
                            {(['normal', 'proteger', 'liquidar'] as const).map((tipo) => (
                              <button
                                key={tipo}
                                onClick={() => updatePolicy(p.nombre, { ...pol, tipo })}
                                className={`flex-1 py-1 text-xs rounded font-medium transition-colors ${
                                  pol.tipo === tipo
                                    ? tipo === 'proteger' ? 'bg-[#ED7C00] text-white' : tipo === 'liquidar' ? 'bg-red-500 text-white' : 'bg-[#32576F] text-white'
                                    : 'bg-[#132229] text-[#7A9BAD] hover:text-white'
                                }`}
                              >
                                {POLICY_LABEL(tipo)}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[#7A9BAD] text-xs">Min días:</span>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={pol.stock_min_dias}
                              onChange={(e) => updatePolicy(p.nombre, { ...pol, stock_min_dias: Number(e.target.value) || 30 })}
                              className="w-16 bg-[#132229] border border-[#32576F] text-white text-xs rounded px-2 py-0.5 focus:outline-none focus:border-[#ED7C00]"
                            />
                            <span className="text-[#7A9BAD] text-xs">días</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Recomendaciones de compra ── */}
            {forecast && recommendations.length > 0 && (
              <ChartContainer
                title="Recomendaciones de compra"
                subtitle={`${recommendations.length} productos requieren reposición según predicción + políticas`}
                exportFileName={`stock_recomendaciones_${tenantId}`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Producto', 'Stock actual', 'Cobertura', 'Pred. 30d', 'Sugerido comprar', 'Política', 'Tendencia', 'Confianza'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recommendations.map((r, i) => (
                        <tr
                          key={i}
                          className={`border-b border-[#32576F]/40 transition-colors ${
                            r.dias_cobertura < 7 ? 'bg-red-500/5 hover:bg-red-500/10' :
                            r.dias_cobertura < 14 ? 'bg-yellow-500/5 hover:bg-yellow-500/10' :
                            'hover:bg-[#132229]'
                          }`}
                        >
                          <td className="py-2 px-3 text-white font-medium max-w-[160px] truncate">{r.nombre}</td>
                          <td className="py-2 px-3 text-white font-mono">{r.stock_actual}</td>
                          <td className="py-2 px-3"><CoberturaCell dias={r.dias_cobertura} /></td>
                          <td className="py-2 px-3 text-[#CDD4DA] font-mono">{r.pred_30d}</td>
                          <td className="py-2 px-3">
                            <span className="text-[#ED7C00] font-bold font-mono text-base">{r.sugerido_compra}</span>
                            <span className="text-[#7A9BAD] text-xs ml-1">uds</span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`text-xs px-2 py-0.5 rounded ${POLICY_COLORS[r.policy_tipo]}`}>
                              {POLICY_LABEL(r.policy_tipo)}
                            </span>
                          </td>
                          <td className="py-2 px-3"><TendenciaBadge t={r.tendencia} /></td>
                          <td className="py-2 px-3"><ConfianzaBadge c={r.confianza} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[#7A9BAD] text-xs mt-3">
                  La cantidad sugerida = días de stock mínimo según política − stock actual, basado en el ritmo de ventas predicho.
                  Productos con política "Liquidar" se excluyen de las recomendaciones.
                </p>
              </ChartContainer>
            )}
          </>
        )}
      </main>
    </div>
  );
}
