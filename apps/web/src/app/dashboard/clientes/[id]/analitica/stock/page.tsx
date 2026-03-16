'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import {
  api,
  type StockResponse,
  type ProductoStock,
  type AbcNombre,
  type FiltrosDisponibles,
  type PrediccionesResponse,
  type PrediccionProducto,
  type AiAnalysisResponse,
  type AiInsightAjuste,
} from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PredGroupRow {
  key: string;
  nombre: string;
  descripcion: string;
  skus: PrediccionProducto[];
  totalStock: number;
  promedioDiario: number;
  prediccion: number;
  aComprar: number;
  hasImbalance: boolean;
  imbalanceDetail: string;
  aiAjuste: AiInsightAjuste | undefined;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ABC_COLORS = { A: '#ED7C00', B: '#3B82F6', C: '#6B7280' };
const ABC_BG = {
  A: 'bg-[#ED7C00]/10 text-[#ED7C00] border border-[#ED7C00]/30',
  B: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  C: 'bg-gray-500/10 text-gray-400 border border-gray-500/30',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function fmtN(n: number) { return new Intl.NumberFormat('es-AR').format(n); }


// ── Sub-components ────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, onClick }: {
  label: string; value: string; sub?: string; color?: string; onClick?: () => void;
}) {
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StockAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<StockResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLocal, setSelectedLocal] = useState<number | undefined>(undefined);

  // UI toggles
  const [showRotacionMensual, setShowRotacionMensual] = useState(false);
  const [showClaseAPanel, setShowClaseAPanel] = useState(false);

  // ABC state
  const [abcDescFilter, setAbcDescFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [abcNombreFilter, setAbcNombreFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [pageDesc, setPageDesc] = useState(0);
  const [pageNombre, setPageNombre] = useState(0);
  const [abcNombreView, setAbcNombreView] = useState<'chart' | 'table'>('chart');
  const [abcDescView, setAbcDescView] = useState<'chart' | 'table'>('table');
  const PAGE_SIZE = 30;

  // Predicciones state
  const [predData, setPredData] = useState<PrediccionesResponse | null>(null);
  const [predLoading, setPredLoading] = useState(false);
  const [predHorizonte, setPredHorizonte] = useState(30);
  const [predSearch, setPredSearch] = useState('');
  const [expandedPredGroups, setExpandedPredGroups] = useState<Set<string>>(new Set());

  // AI state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiData, setAiData] = useState<AiAnalysisResponse | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const aiAppliedAdjustments = useRef<Record<string, number>>({});

  const load = useCallback(async (localId?: number) => {
    setLoading(true);
    setError('');
    setPageDesc(0);
    setPageNombre(0);
    try {
      const result = await api.analytics.stock(tenantId, { local_id: localId });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  const loadPred = useCallback(async (localId?: number, horizonte?: number) => {
    setPredLoading(true);
    try {
      const result = await api.analytics.predicciones(tenantId, { local_id: localId }, {
        periodo_dias: horizonte ?? predHorizonte,
        sobre_stock_pct: 0,
      });
      setPredData(result);
    } catch {
      // Silently fail - predicciones is optional
    } finally {
      setPredLoading(false);
    }
  }, [tenantId, predHorizonte]);

  useEffect(() => {
    api.analytics.filtros(tenantId).then(setFiltros).catch(() => {});
    load();
    loadPred();
  }, [tenantId, load, loadPred]);

  const isAdvanced = (data?.meses_con_datos ?? 0) >= 12;

  // Predicciones groups
  const predGroups: PredGroupRow[] = useMemo(() => {
    if (!predData) return [];
    const grouped = new Map<string, PrediccionProducto[]>();
    for (const p of predData.productos) {
      const key = `${p.nombre}::${p.descripcion || ''}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }
    return Array.from(grouped.entries()).map(([key, skus]) => {
      const totalStock = skus.reduce((s, p) => s + (p.stock_actual ?? 0), 0);
      const promedioDiario = skus.reduce((s, p) => s + (p.promedio_diario ?? 0), 0);
      const prediccion = promedioDiario * predHorizonte;

      // AI adjustment (if applied)
      const aiAjuste = aiData?.ajustes.find((a) => a.producto_key === key);
      const factor = aiApplied && aiAjuste ? aiAjuste.factor : 1.0;
      const prediccionFinal = prediccion * factor;
      const aComprar = Math.max(0, Math.ceil(prediccionFinal) - totalStock);

      // Imbalance detection
      let hasImbalance = false;
      let imbalanceDetail = '';
      if (skus.length > 1 && totalStock > 0) {
        const byTalle = new Map<string, number>();
        const byColor = new Map<string, number>();
        for (const p of skus) {
          if (p.talle) byTalle.set(p.talle, (byTalle.get(p.talle) ?? 0) + (p.stock_actual ?? 0));
          if (p.color) byColor.set(p.color, (byColor.get(p.color) ?? 0) + (p.stock_actual ?? 0));
        }
        const maxTalle = byTalle.size > 0 ? Math.max(...byTalle.values()) : 0;
        const maxColor = byColor.size > 0 ? Math.max(...byColor.values()) : 0;
        if (maxTalle / totalStock > 0.6 && byTalle.size > 1) {
          const dom = [...byTalle.entries()].find(([, v]) => v === maxTalle)?.[0] ?? '';
          hasImbalance = true;
          imbalanceDetail = `Talle "${dom}" concentra ${Math.round((maxTalle / totalStock) * 100)}% del stock`;
        } else if (maxColor / totalStock > 0.6 && byColor.size > 1) {
          const dom = [...byColor.entries()].find(([, v]) => v === maxColor)?.[0] ?? '';
          hasImbalance = true;
          imbalanceDetail = `Color "${dom}" concentra ${Math.round((maxColor / totalStock) * 100)}% del stock`;
        }
      }

      return {
        key,
        nombre: skus[0]?.nombre ?? '',
        descripcion: skus[0]?.descripcion ?? '',
        skus,
        totalStock,
        promedioDiario,
        prediccion: prediccionFinal,
        aComprar,
        hasImbalance,
        imbalanceDetail,
        aiAjuste,
      } as PredGroupRow;
    }).sort((a, b) => b.aComprar - a.aComprar || b.prediccion - a.prediccion);
  }, [predData, predHorizonte, aiData, aiApplied]);

  async function callAi() {
    if (!predGroups.length) return;
    setAiLoading(true);
    setAiData(null);
    setAiApplied(false);
    try {
      const payload = predGroups.slice(0, 60).map((g) => ({
        nombre: g.nombre,
        descripcion: g.descripcion,
        stock: g.totalStock,
        prediccion: g.prediccion,
        promedio_diario: g.promedioDiario,
      }));
      const result = await api.analytics.prediccionesAiContext(tenantId, {
        grupos: payload,
        periodo_dias: predHorizonte,
        fecha_actual: new Date().toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' }),
      });
      setAiData(result);
    } catch (err) {
      setAiData({
        insights: err instanceof Error ? err.message : 'Error al consultar IA',
        ajustes: [],
        advertencia: 'error',
      });
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiSuggestions() {
    if (!aiData) return;
    const applied: Record<string, number> = {};
    for (const ajuste of aiData.ajustes) {
      applied[ajuste.producto_key] = ajuste.factor;
    }
    aiAppliedAdjustments.current = applied;
    setAiApplied(true);
  }

  const predFiltered = useMemo(() => {
    if (!predSearch.trim()) return predGroups;
    const s = predSearch.toLowerCase();
    return predGroups.filter(
      (g) => g.nombre.toLowerCase().includes(s) || g.descripcion.toLowerCase().includes(s),
    );
  }, [predGroups, predSearch]);

  const predTotals = useMemo(() => ({
    prediccion: predGroups.reduce((s, g) => s + g.prediccion, 0),
    stock: predGroups.reduce((s, g) => s + g.totalStock, 0),
    aComprar: predGroups.reduce((s, g) => s + g.aComprar, 0),
    conNecesidad: predGroups.filter((g) => g.aComprar > 0).length,
  }), [predGroups]);

  // ABC computed
  const claseAProductos = (data?.abc_por_nombre ?? []).filter((p) => p.clasificacion_abc === 'A');
  const filteredNombre = (data?.abc_por_nombre ?? []).filter((p) => abcNombreFilter === 'all' || p.clasificacion_abc === abcNombreFilter);
  const paginatedNombre = filteredNombre.slice(pageNombre * PAGE_SIZE, (pageNombre + 1) * PAGE_SIZE);
  const totalPagesNombre = Math.ceil(filteredNombre.length / PAGE_SIZE);
  const filteredDesc = (data?.productos ?? []).filter((p) => abcDescFilter === 'all' || p.clasificacion_abc === abcDescFilter);
  const paginatedDesc = filteredDesc.slice(pageDesc * PAGE_SIZE, (pageDesc + 1) * PAGE_SIZE);
  const totalPagesDesc = Math.ceil(filteredDesc.length / PAGE_SIZE);

  const abcNombreChartData = (data?.abc_por_nombre ?? []).slice(0, 20).map((p) => ({
    nombre: p.nombre.length > 16 ? p.nombre.slice(0, 16) + '…' : p.nombre,
    contribucion: p.contribucion_pct,
    stock: p.stock_total, vendidas: p.unidades_vendidas,
    monto: p.monto_stock, abc: p.clasificacion_abc,
  }));
  const abcDescChartData = ((data?.abc_por_descripcion ?? []) as Array<Record<string, unknown>>).slice(0, 20).map((p) => ({
    label: p.descripcion ? `${p.nombre} · ${p.descripcion}` : String(p.nombre ?? ''),
    contribucion: Number(p.contribucion_pct ?? 0),
    stock: Number(p.stock_total ?? 0), vendidas: Number(p.unidades_vendidas ?? 0),
    abc: String(p.clasificacion_abc ?? 'C'),
  }));

  const togglePredGroup = (key: string) => {
    setExpandedPredGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-white">Analítica · Stock</h1>
          <p className="text-[#7A9BAD] text-sm">Valor, rotación, calce financiero y predicciones de compra</p>
        </div>
        {data && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
            isAdvanced
              ? 'bg-green-500/10 text-green-400 border-green-500/30'
              : 'bg-[#32576F]/30 text-[#7A9BAD] border-[#32576F]'
          }`}>
            {isAdvanced ? `Avanzado · ${data.meses_con_datos}m datos` : `Simple · ${data.meses_con_datos}m datos`}
          </span>
        )}
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        {/* Local filter */}
        {filtros && filtros.locales && filtros.locales.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[#7A9BAD] text-sm">Filtrar por local:</span>
            <select
              value={selectedLocal ?? ''}
              onChange={(e) => {
                const v = e.target.value ? parseInt(e.target.value) : undefined;
                setSelectedLocal(v);
                load(v);
                loadPred(v);
              }}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos los locales</option>
              {filtros.locales.map((l) => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
            {loading && <div className="w-4 h-4 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />}
          </div>
        )}

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
            {/* ── KPI Row 1 ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="Valor total del stock"
                value={fmt(data.monto_total_stock)}
                sub="precio de compra × unidades"
                color="text-[#ED7C00]"
              />
              <KpiCard
                label="Rotación promedio mensual"
                value={data.rotacion_promedio_mensual > 0 ? `${data.rotacion_promedio_mensual.toFixed(2)}x` : '—'}
                sub={data.rotacion_mensual.length > 0
                  ? `${data.rotacion_mensual.length} meses con compras · click`
                  : 'Sin meses con datos de compras'}
                color={data.rotacion_promedio_mensual >= 1 ? 'text-green-400' : data.rotacion_promedio_mensual > 0 ? 'text-yellow-400' : 'text-[#7A9BAD]'}
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
                label="Compras del período"
                value={fmt(data.compras_total_periodo)}
                sub={data.tasa_crecimiento_ventas !== 0
                  ? `Ventas ${data.tasa_crecimiento_ventas > 0 ? '+' : ''}${data.tasa_crecimiento_ventas.toFixed(1)}% vs anterior`
                  : 'vs período anterior'}
                color={data.tasa_crecimiento_ventas > 0 ? 'text-green-400' : data.tasa_crecimiento_ventas < 0 ? 'text-red-400' : 'text-white'}
              />
            </div>

            {/* ── KPI Row 2 ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <KpiCard
                label="Productos más rentables (Clase A)"
                value={fmtN(claseAProductos.length)}
                sub="generan el 80% del revenue · click para ver"
                color="text-[#ED7C00]"
                onClick={() => setShowClaseAPanel((v) => !v)}
              />
              <KpiCard
                label="Productos a reponer"
                value={predTotals.conNecesidad > 0 ? fmtN(predTotals.conNecesidad) : predLoading ? '...' : '—'}
                sub={predTotals.conNecesidad > 0
                  ? `${fmtN(predTotals.aComprar)} unidades · horizonte ${predHorizonte}d`
                  : 'calculando predicciones...'}
                color={predTotals.conNecesidad > 0 ? 'text-yellow-400' : 'text-[#7A9BAD]'}
              />
              <KpiCard
                label="Total SKUs"
                value={fmtN(data.total_skus)}
                sub={`${data.total_productos} tipos de producto`}
                color="text-white"
              />
            </div>

            {/* ── Clase A panel ── */}
            {showClaseAPanel && claseAProductos.length > 0 && (
              <ChartContainer
                title="Productos Clase A — 80% del revenue"
                subtitle="Cuidar el stock de estos productos es crítico"
                exportFileName={`stock_clase_a_${tenantId}`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Producto','Stock total','Valor stock','Vendidas','Rotación','Cobertura','Contribución'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {claseAProductos.map((p: AbcNombre, i) => (
                        <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                          <td className="py-2 px-3 text-white font-semibold">{p.nombre}</td>
                          <td className="py-2 px-3 text-white font-mono">{fmtN(p.stock_total)}</td>
                          <td className="py-2 px-3 text-[#ED7C00] font-mono">{fmt(p.monto_stock)}</td>
                          <td className="py-2 px-3 text-[#CDD4DA]">{fmtN(p.unidades_vendidas)}</td>
                          <td className="py-2 px-3"><RotacionCell r={p.rotacion} /></td>
                          <td className="py-2 px-3 text-[#CDD4DA] text-xs">
                            {p.cobertura_dias >= 9999 ? '—' : `${p.cobertura_dias.toFixed(0)}d`}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 bg-[#32576F] rounded-full w-12">
                                <div className="h-1.5 bg-[#ED7C00] rounded-full" style={{ width: `${Math.min(p.contribucion_pct * 3, 100)}%` }} />
                              </div>
                              <span className="text-[#ED7C00] text-xs font-mono">{p.contribucion_pct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>
            )}

            {/* ── Rotación mensual panel ── */}
            {showRotacionMensual && data.rotacion_mensual.length > 0 && (
              <ChartContainer
                title="Rotación mensual de stock"
                subtitle="Solo meses con registros de CompraDetalle — CMV / stock promedio"
                exportFileName={`stock_rotacion_${tenantId}`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.rotacion_mensual} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="mes" stroke="#7A9BAD" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)}x`} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: unknown, name: unknown) => [
                        name === 'rotacion' ? `${(v as number).toFixed(2)}x` : fmt(v as number),
                        name === 'rotacion' ? 'Rotación' : name === 'cmv' ? 'CMV' : 'Stock promedio',
                      ] as [string, string]}
                    />
                    <Legend formatter={(v) => <span style={{ color: '#CDD4DA', fontSize: 11 }}>{v === 'rotacion' ? 'Rotación' : v === 'cmv' ? 'CMV' : 'Stock prom.'}</span>} />
                    <Line type="monotone" dataKey="rotacion" stroke="#ED7C00" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['Mes','Rotación','CMV','Stock promedio'].map((h) => (
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

            {/* ── ABC por nombre ── */}
            <ChartContainer
              title="Análisis ABC por producto"
              subtitle="Clasificación Pareto: A=80% revenue, B=95%, C=resto"
              exportFileName={`stock_abc_nombre_${tenantId}`}
            >
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex gap-1">
                  {(['all', 'A', 'B', 'C'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => { setAbcNombreFilter(f); setPageNombre(0); }}
                      className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                        abcNombreFilter === f ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                      }`}
                    >
                      {f === 'all' ? 'Todos' : `Clase ${f}`}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {(['chart', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setAbcNombreView(v)}
                      className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                        abcNombreView === v ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                      }`}
                    >
                      {v === 'chart' ? 'Gráfico' : 'Tabla'}
                    </button>
                  ))}
                </div>
              </div>

              {abcNombreView === 'chart' ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={abcNombreChartData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="nombre" stroke="#7A9BAD" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: unknown, name: unknown) => [
                        name === 'contribucion' ? `${v as number}%` : fmtN(v as number),
                        name === 'contribucion' ? 'Contribución' : name === 'stock' ? 'Stock' : 'Vendidas',
                      ] as [string, string]}
                    />
                    <Bar dataKey="contribucion" radius={[2, 2, 0, 0]}>
                      {abcNombreChartData.map((entry, index) => (
                        <Cell key={index} fill={ABC_COLORS[entry.abc as 'A' | 'B' | 'C'] ?? '#6B7280'} />
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
                          {['Clase','Producto','Stock','Valor','Vendidas','Rotación','Cobertura','Contribución'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedNombre.map((p: AbcNombre, i) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                            <td className="py-2 px-2"><AbcBadge cls={p.clasificacion_abc} /></td>
                            <td className="py-2 px-2 text-white font-medium max-w-[160px] truncate" title={p.nombre}>{p.nombre}</td>
                            <td className="py-2 px-2 text-[#CDD4DA] font-mono text-right">{fmtN(p.stock_total)}</td>
                            <td className="py-2 px-2 text-[#ED7C00] font-mono text-right">{fmt(p.monto_stock)}</td>
                            <td className="py-2 px-2 text-[#CDD4DA] text-right">{fmtN(p.unidades_vendidas)}</td>
                            <td className="py-2 px-2"><RotacionCell r={p.rotacion} /></td>
                            <td className="py-2 px-2 text-[#CDD4DA] text-xs">
                              {p.cobertura_dias >= 9999 ? '—' : `${p.cobertura_dias.toFixed(0)}d`}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="h-1 bg-[#32576F] rounded-full w-10">
                                  <div className="h-1 bg-[#ED7C00] rounded-full" style={{ width: `${Math.min(p.contribucion_pct * 2, 100)}%` }} />
                                </div>
                                <span className="text-[#CDD4DA] text-xs font-mono">{p.contribucion_pct}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPagesNombre > 1 && (
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#32576F]">
                      <span className="text-[#7A9BAD] text-xs">{filteredNombre.length} productos · página {pageNombre + 1}/{totalPagesNombre}</span>
                      <div className="flex gap-1">
                        <button disabled={pageNombre === 0} onClick={() => setPageNombre((p) => p - 1)} className="px-2 py-1 text-xs bg-[#132229] border border-[#32576F] rounded disabled:opacity-40 text-[#7A9BAD] hover:text-white">← Ant</button>
                        <button disabled={pageNombre === totalPagesNombre - 1} onClick={() => setPageNombre((p) => p + 1)} className="px-2 py-1 text-xs bg-[#132229] border border-[#32576F] rounded disabled:opacity-40 text-[#7A9BAD] hover:text-white">Sig →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </ChartContainer>

            {/* ── ABC por descripción (SKU) ── */}
            <ChartContainer
              title="Inventario por SKU (nombre × descripción × talle × color)"
              subtitle="Clasificación ABC a nivel SKU individual"
              exportFileName={`stock_skus_${tenantId}`}
            >
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex gap-1">
                  {(['all', 'A', 'B', 'C'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => { setAbcDescFilter(f); setPageDesc(0); }}
                      className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                        abcDescFilter === f ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                      }`}
                    >
                      {f === 'all' ? 'Todos' : `Clase ${f}`}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {(['chart', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setAbcDescView(v)}
                      className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                        abcDescView === v ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                      }`}
                    >
                      {v === 'chart' ? 'Gráfico' : 'Tabla'}
                    </button>
                  ))}
                </div>
              </div>

              {abcDescView === 'chart' ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={abcDescChartData} margin={{ top: 5, right: 10, left: 0, bottom: 55 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="label" stroke="#7A9BAD" tick={{ fontSize: 8 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: unknown, name: unknown) => [
                        name === 'contribucion' ? `${v as number}%` : fmtN(v as number),
                        name === 'contribucion' ? 'Contribución' : name === 'stock' ? 'Stock' : 'Vendidas',
                      ] as [string, string]}
                    />
                    <Bar dataKey="contribucion" radius={[2, 2, 0, 0]}>
                      {abcDescChartData.map((entry, index) => (
                        <Cell key={index} fill={ABC_COLORS[entry.abc as 'A' | 'B' | 'C'] ?? '#6B7280'} />
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
                          {['Clase','Nombre','Desc.','Talle','Color','Stock','Costo','Valor','Vendidas','Rot.','Cob.días','Contrib.'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedDesc.map((p: ProductoStock, i) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                            <td className="py-1.5 px-2"><AbcBadge cls={p.clasificacion_abc} /></td>
                            <td className="py-1.5 px-2 text-white text-xs max-w-[120px] truncate" title={p.nombre}>{p.nombre}</td>
                            <td className="py-1.5 px-2 text-[#CDD4DA] text-xs max-w-[100px] truncate" title={p.descripcion ?? ''}>{p.descripcion || '—'}</td>
                            <td className="py-1.5 px-2 text-[#CDD4DA] text-xs">{p.talle || '—'}</td>
                            <td className="py-1.5 px-2 text-[#CDD4DA] text-xs">{p.color || '—'}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-white">{fmtN(p.stock_actual)}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-[#7A9BAD] text-xs">{fmt(p.precio_costo)}</td>
                            <td className="py-1.5 px-2 text-right font-mono text-[#ED7C00]">{fmt(p.monto_stock)}</td>
                            <td className="py-1.5 px-2 text-right text-[#CDD4DA]">{fmtN(p.unidades_vendidas_periodo)}</td>
                            <td className="py-1.5 px-2"><RotacionCell r={p.rotacion} /></td>
                            <td className="py-1.5 px-2 text-[#CDD4DA] text-xs text-right">
                              {p.cobertura_dias >= 9999 ? '—' : `${p.cobertura_dias.toFixed(0)}d`}
                            </td>
                            <td className="py-1.5 px-2 text-right text-xs font-mono text-[#CDD4DA]">{p.contribucion_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPagesDesc > 1 && (
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#32576F]">
                      <span className="text-[#7A9BAD] text-xs">{filteredDesc.length} SKUs · página {pageDesc + 1}/{totalPagesDesc}</span>
                      <div className="flex gap-1">
                        <button disabled={pageDesc === 0} onClick={() => setPageDesc((p) => p - 1)} className="px-2 py-1 text-xs bg-[#132229] border border-[#32576F] rounded disabled:opacity-40 text-[#7A9BAD] hover:text-white">← Ant</button>
                        <button disabled={pageDesc === totalPagesDesc - 1} onClick={() => setPageDesc((p) => p + 1)} className="px-2 py-1 text-xs bg-[#132229] border border-[#32576F] rounded disabled:opacity-40 text-[#7A9BAD] hover:text-white">Sig →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </ChartContainer>

            {/* ── Más vendidos ── */}
            {data.mas_vendidos.length > 0 && (
              <ChartContainer
                title="Más vendidos del período"
                subtitle="Top 100 SKUs por unidades vendidas"
                exportFileName={`stock_masvendidos_${tenantId}`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        {['#','Nombre','Desc.','Talle','Color','Vendidas','Stock','Cob.días','Prom/día'].map((h) => (
                          <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.mas_vendidos.map((p, i) => (
                        <tr key={i} className={`border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors ${p.alerta_stock ? 'bg-red-500/5' : ''}`}>
                          <td className="py-1.5 px-2 text-[#7A9BAD] text-xs">{i + 1}</td>
                          <td className="py-1.5 px-2 text-white text-xs font-medium max-w-[120px] truncate" title={p.nombre}>{p.nombre}</td>
                          <td className="py-1.5 px-2 text-[#CDD4DA] text-xs max-w-[100px] truncate">{p.descripcion || '—'}</td>
                          <td className="py-1.5 px-2 text-[#CDD4DA] text-xs">{p.talle || '—'}</td>
                          <td className="py-1.5 px-2 text-[#CDD4DA] text-xs">{p.color || '—'}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-[#ED7C00]">{fmtN(p.unidades_vendidas)}</td>
                          <td className={`py-1.5 px-2 text-right font-mono ${p.alerta_stock ? 'text-red-400' : 'text-white'}`}>{fmtN(p.stock_actual)}</td>
                          <td className="py-1.5 px-2 text-right text-[#CDD4DA] text-xs">
                            {p.cobertura_dias >= 9999 ? '—' : `${p.cobertura_dias.toFixed(0)}d`}
                            {p.alerta_stock && <span className="ml-1 text-red-400">⚠</span>}
                          </td>
                          <td className="py-1.5 px-2 text-right text-[#7A9BAD] text-xs">{p.promedio_diario.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartContainer>
            )}

            {/* ══════════════════════════════════════════════════════════════
                PREDICCIONES Y COMPRAS RECOMENDADAS
            ══════════════════════════════════════════════════════════════ */}
            <ChartContainer
              title="Predicciones y compras recomendadas"
              subtitle="Basado en promedio diario histórico · sin configuración individual por producto"
              exportFileName={`stock_predicciones_${tenantId}`}
            >
              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <label className="text-[#7A9BAD] text-xs whitespace-nowrap">Horizonte:</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={predHorizonte}
                    onChange={(e) => {
                      const v = Math.max(1, Number(e.target.value));
                      setPredHorizonte(v);
                    }}
                    onBlur={() => loadPred(selectedLocal, predHorizonte)}
                    onKeyDown={(e) => e.key === 'Enter' && loadPred(selectedLocal, predHorizonte)}
                    className="w-16 bg-[#0F1E28] border border-[#32576F] rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-[#ED7C00] focus:outline-none"
                  />
                  <span className="text-[#7A9BAD] text-xs">días</span>
                </div>
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={predSearch}
                  onChange={(e) => setPredSearch(e.target.value)}
                  className="flex-1 min-w-[160px] bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-1.5 text-sm text-white placeholder-[#7A9BAD] focus:border-[#ED7C00] focus:outline-none"
                />
                <button
                  onClick={() => {
                    const next = !aiEnabled;
                    setAiEnabled(next);
                    if (next && !aiData) callAi();
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    aiEnabled ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] border border-[#32576F] text-[#7A9BAD] hover:text-white'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  {aiEnabled ? 'IA activa' : 'Análisis IA'}
                </button>
                {predLoading && <div className="w-4 h-4 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />}
              </div>

              {/* KPIs */}
              {predData && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-[#0F1E28] rounded-lg p-3">
                    <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Predicción {predHorizonte}d</p>
                    <p className="text-white font-bold">{fmtN(Math.round(predTotals.prediccion))} un.</p>
                  </div>
                  <div className="bg-[#0F1E28] rounded-lg p-3">
                    <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Stock actual</p>
                    <p className="text-white font-bold">{fmtN(predTotals.stock)} un.</p>
                  </div>
                  <div className={`rounded-lg p-3 ${predTotals.aComprar > 0 ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-[#0F1E28]'}`}>
                    <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">A comprar</p>
                    <p className={`font-bold ${predTotals.aComprar > 0 ? 'text-yellow-400' : 'text-white'}`}>{fmtN(predTotals.aComprar)} un.</p>
                  </div>
                </div>
              )}

              {/* AI panel */}
              {aiEnabled && (
                <div className="bg-[#1a2433] border border-[#ED7C00]/40 rounded-xl p-4 space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#ED7C00] animate-pulse" />
                      <span className="text-[#ED7C00] text-sm font-medium">Análisis IA — Claude</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {aiData && !aiLoading && (
                        <>
                          <button onClick={callAi} className="text-[#7A9BAD] hover:text-white text-xs px-2 py-1 border border-[#32576F] rounded">
                            Reanalizar
                          </button>
                          {aiData.ajustes.length > 0 && !aiApplied && (
                            <button
                              onClick={applyAiSuggestions}
                              className="bg-[#ED7C00] hover:bg-[#c96900] text-white text-xs px-3 py-1 rounded font-medium"
                            >
                              Aplicar {aiData.ajustes.length} ajuste{aiData.ajustes.length !== 1 ? 's' : ''}
                            </button>
                          )}
                          {aiApplied && <span className="text-[#4ade80] text-xs">✓ Ajustes aplicados</span>}
                        </>
                      )}
                    </div>
                  </div>
                  {aiLoading && (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-4 h-4 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
                      <span className="text-[#7A9BAD] text-sm">Analizando con IA...</span>
                    </div>
                  )}
                  {aiData && !aiLoading && (
                    <>
                      {aiData.advertencia && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                          <p className="text-red-400 text-xs">{aiData.advertencia}</p>
                        </div>
                      )}
                      <div className="text-[#CDD4DA] text-sm leading-relaxed whitespace-pre-line">{aiData.insights}</div>
                      {aiData.ajustes.length > 0 && (
                        <div className="space-y-1">
                          {aiData.ajustes.map((a, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className={`font-mono font-bold shrink-0 ${a.factor > 1 ? 'text-[#ED7C00]' : 'text-[#4ade80]'}`}>
                                {a.factor > 1 ? '+' : ''}{Math.round((a.factor - 1) * 100)}%
                              </span>
                              <span className="text-[#7A9BAD] font-medium shrink-0">{a.producto_key}</span>
                              <span className="text-[#7A9BAD]">— {a.razon}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Table */}
              {predData && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#32576F]">
                        <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase w-8">#</th>
                        <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Nombre</th>
                        <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Descripción</th>
                        <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Stock</th>
                        <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Prom/día</th>
                        <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Pred. {predHorizonte}d</th>
                        <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">A comprar</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {predFiltered.map((g, i) => {
                        const isExpanded = expandedPredGroups.has(g.key);
                        return (
                          <Fragment key={g.key}>
                            <tr
                              className="border-b border-[#32576F]/40 hover:bg-[#132229]/60 transition-colors"
                            >
                              <td className="py-2 px-2 text-[#7A9BAD] text-xs">{i + 1}</td>
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-1.5">
                                  {g.skus.length > 1 && (
                                    <button
                                      onClick={() => togglePredGroup(g.key)}
                                      className="text-[#7A9BAD] hover:text-white shrink-0"
                                    >
                                      <svg
                                        className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                      >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                  )}
                                  <span className="text-white font-medium">{g.nombre}</span>
                                  {g.hasImbalance && (
                                    <span
                                      title={g.imbalanceDetail}
                                      className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1 rounded cursor-help"
                                    >
                                      desbalance
                                    </span>
                                  )}
                                  {g.aiAjuste && aiEnabled && (
                                    <span
                                      title={`IA: ${g.aiAjuste.razon}`}
                                      className="text-[10px] bg-[#ED7C00]/20 text-[#ED7C00] border border-[#ED7C00]/30 px-1 rounded cursor-help"
                                    >
                                      IA {g.aiAjuste.factor > 1 ? '+' : ''}{Math.round((g.aiAjuste.factor - 1) * 100)}%
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-[#CDD4DA] text-xs max-w-[140px] truncate" title={g.descripcion}>
                                {g.descripcion || '—'}
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-[#CDD4DA]">{fmtN(g.totalStock)}</td>
                              <td className="py-2 px-2 text-right font-mono text-[#7A9BAD] text-xs">{g.promedioDiario.toFixed(2)}</td>
                              <td className="py-2 px-2 text-right font-mono text-[#ED7C00]">{fmtN(Math.round(g.prediccion))}</td>
                              <td className="py-2 px-2 text-right font-mono">
                                {g.aComprar > 0
                                  ? <span className="text-yellow-400 font-semibold">{fmtN(g.aComprar)}</span>
                                  : <span className="text-green-400 text-xs">OK</span>
                                }
                              </td>
                              <td className="py-2 px-2" />
                            </tr>
                            {/* Expanded: talle/color breakdown (read-only) */}
                            {isExpanded && (
                              <tr className="border-b border-[#32576F]/40">
                                <td colSpan={8} className="py-0">
                                  <div className="bg-[#0F1E28] mx-2 mb-2 rounded-lg overflow-hidden">
                                    {g.hasImbalance && (
                                      <div className="px-3 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20">
                                        <p className="text-yellow-400 text-xs">Desbalance: {g.imbalanceDetail}</p>
                                      </div>
                                    )}
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-[#32576F]/60">
                                          <th className="text-left text-[#7A9BAD] font-medium py-1.5 px-3">Talle</th>
                                          <th className="text-left text-[#7A9BAD] font-medium py-1.5 px-3">Color</th>
                                          <th className="text-right text-[#7A9BAD] font-medium py-1.5 px-3">Stock</th>
                                          <th className="text-right text-[#7A9BAD] font-medium py-1.5 px-3">Prom/día</th>
                                          <th className="text-right text-[#7A9BAD] font-medium py-1.5 px-3">Pred. {predHorizonte}d</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {g.skus.map((sku, si) => {
                                          const skuPred = (sku.promedio_diario ?? 0) * predHorizonte;
                                          return (
                                            <tr key={si} className="border-b border-[#32576F]/30 hover:bg-[#132229]/40">
                                              <td className="py-1.5 px-3 text-[#CDD4DA]">{sku.talle || '—'}</td>
                                              <td className="py-1.5 px-3 text-[#CDD4DA]">{sku.color || '—'}</td>
                                              <td className="py-1.5 px-3 text-right text-[#CDD4DA] font-mono">{fmtN(sku.stock_actual ?? 0)}</td>
                                              <td className="py-1.5 px-3 text-right text-[#7A9BAD]">{(sku.promedio_diario ?? 0).toFixed(2)}</td>
                                              <td className="py-1.5 px-3 text-right text-[#ED7C00] font-mono">{fmtN(Math.round(skuPred))}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  {predFiltered.length === 0 && !predLoading && (
                    <p className="text-center text-[#7A9BAD] text-sm py-8">
                      {predSearch ? 'Sin resultados para la búsqueda.' : 'No hay datos de predicciones disponibles.'}
                    </p>
                  )}
                </div>
              )}

              {!predData && predLoading && (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              <p className="text-[#7A9BAD] text-xs mt-4">
                La predicción se calcula como: promedio diario × horizonte (días). El análisis IA puede ajustar estas estimaciones según contexto estacional. El stock que se muestra proviene de los movimientos de StockMovimiento.
              </p>
            </ChartContainer>
          </>
        )}
      </main>
    </div>
  );
}
