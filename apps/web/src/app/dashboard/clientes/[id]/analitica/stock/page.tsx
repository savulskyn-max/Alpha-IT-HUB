'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import {
  api,
  type StockResponse,
  type StockAnalysisResponse,
  type AbcNombre,
  type FiltrosDisponibles,
} from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { StockRecommendation } from '@/components/analytics/StockRecommendation';
import { StockRecommendationAdvanced } from '@/components/analytics/StockRecommendationAdvanced';
import { InventarioTreemap } from '@/components/analytics/InventarioTreemap';
import { AlertasUrgentes } from '@/components/analytics/AlertasUrgentes';

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
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLocal, setSelectedLocal] = useState<number | undefined>(undefined);

  // UI toggles
  const [showRotacionMensual, setShowRotacionMensual] = useState(false);
  const [showClaseAPanel, setShowClaseAPanel] = useState(false);
  const [modeAdvanced, setModeAdvanced] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('stock-mode-advanced');
    return saved === null ? null : saved === 'true';
  });
  const mainRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // ABC state
  const [abcNombreFilter, setAbcNombreFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [pageNombre, setPageNombre] = useState(0);
  const [abcNombreView, setAbcNombreView] = useState<'chart' | 'table'>('chart');
  const PAGE_SIZE = 30;

  const load = useCallback(async (localId?: number) => {
    setLoading(true);
    setError('');
    setPageNombre(0);
    try {
      const result = await api.analytics.stock(tenantId, { local_id: localId });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
    // Load analysis (alertas + adaptive demand) in parallel, non-blocking
    setAnalysisLoading(true);
    try {
      const analysisResult = await api.analytics.stockAnalysis(tenantId, localId);
      setAnalysis(analysisResult);
    } catch {
      // Analysis is best-effort; don't surface error to user
    } finally {
      setAnalysisLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    api.analytics.filtros(tenantId).then(setFiltros).catch(() => {});
    load();
  }, [tenantId, load]);

  const autoAdvanced = (data?.meses_con_datos ?? 0) >= 3; // auto-detect: 90+ days of data
  const isAdvanced = modeAdvanced !== null ? modeAdvanced : autoAdvanced;

  const handleSetMode = (advanced: boolean) => {
    setModeAdvanced(advanced);
    localStorage.setItem('stock-mode-advanced', String(advanced));
  };

  const handleExportPdf = async () => {
    if (!mainRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(mainRef.current, {
        backgroundColor: '#0B1921',
        scale: 1.5,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = canvas.width / pageW;
      const totalH = canvas.height / ratio;
      let yOffset = 0;
      while (yOffset < totalH) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -yOffset, pageW, canvas.height / ratio);
        yOffset += pageH;
      }
      const now = new Date().toLocaleString('es-AR');
      const localLabel = selectedLocal
        ? (filtros?.locales.find(l => l.id === selectedLocal)?.nombre ?? `Local ${selectedLocal}`)
        : 'Todos los locales';
      pdf.setFontSize(8);
      pdf.setTextColor(122, 155, 173);
      pdf.text(`Generado: ${now} · ${localLabel}`, 10, pageH - 8);
      pdf.save(`stock_recomendacion_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // ABC computed
  const claseAProductos = (data?.abc_por_nombre ?? []).filter((p) => p.clasificacion_abc === 'A');
  const filteredNombre = (data?.abc_por_nombre ?? []).filter((p) => abcNombreFilter === 'all' || p.clasificacion_abc === abcNombreFilter);
  const paginatedNombre = filteredNombre.slice(pageNombre * PAGE_SIZE, (pageNombre + 1) * PAGE_SIZE);
  const totalPagesNombre = Math.ceil(filteredNombre.length / PAGE_SIZE);

  const abcNombreChartData = (data?.abc_por_nombre ?? []).slice(0, 20).map((p) => ({
    nombre: p.nombre.length > 16 ? p.nombre.slice(0, 16) + '…' : p.nombre,
    contribucion: p.contribucion_pct,
    stock: p.stock_total, vendidas: p.unidades_vendidas,
    monto: p.monto_stock, abc: p.clasificacion_abc,
  }));

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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-[#0E1F29] border border-[#32576F] rounded-lg p-0.5">
              <button
                onClick={() => handleSetMode(false)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  !isAdvanced ? 'bg-[#32576F] text-white' : 'text-[#7A9BAD] hover:text-white'
                }`}
              >
                Simple
              </button>
              <button
                onClick={() => handleSetMode(true)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  isAdvanced ? 'bg-[#32576F] text-white' : 'text-[#7A9BAD] hover:text-white'
                }`}
              >
                Avanzado
              </button>
            </div>
            <button
              onClick={handleExportPdf}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#0E1F29] border border-[#32576F] rounded-lg text-[#7A9BAD] hover:text-[#ED7C00] hover:border-[#ED7C00] transition-colors disabled:opacity-50"
            >
              {exporting ? (
                <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              Exportar PDF
            </button>
          </div>
        )}
      </div>

      <main ref={mainRef} className="flex-1 px-6 py-6 space-y-6">
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
                value="—"
                sub="próximamente"
                color="text-[#7A9BAD]"
              />
              <KpiCard
                label="Total SKUs"
                value={fmtN(data.total_skus)}
                sub={`${data.total_productos} tipos de producto`}
                color="text-white"
              />
            </div>

            {/* ── Alertas urgentes ── */}
            {(analysisLoading || (analysis?.alertas && analysis.alertas.length > 0)) && (
              <ChartContainer
                title="Acciones urgentes del día"
                subtitle="Alertas prioritarias de inventario · click en recomendación para actuar"
                exportFileName={`stock_alertas_${tenantId}`}
              >
                <AlertasUrgentes
                  alertas={analysis?.alertas ?? null}
                  loading={analysisLoading && !analysis}
                />
              </ChartContainer>
            )}

            {/* ── Salud del inventario (Treemap) ── */}
            {data.abc_por_nombre.length > 0 && (
              <ChartContainer
                title="Salud del inventario"
                subtitle="Tamaño = valor en stock · Color = cobertura de días"
                exportFileName={`stock_salud_${tenantId}`}
              >
                <InventarioTreemap data={data.abc_por_nombre} />
              </ChartContainer>
            )}

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

            {/* ── SECCIÓN 3: Recomendación de compra ──────────────────────────── */}
            {isAdvanced ? (
              <StockRecommendationAdvanced tenantId={tenantId} localId={selectedLocal} />
            ) : (
              <StockRecommendation tenantId={tenantId} localId={selectedLocal} />
            )}

          </>
        )}
      </main>
    </div>
  );
}
