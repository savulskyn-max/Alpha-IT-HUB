'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  api,
  type StockResponse,
  type StockAnalysisResponse,
  type AbcNombre,
  type FiltrosDisponibles,
} from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { InventarioTreemap } from '@/components/analytics/InventarioTreemap';
import { AlertasUrgentes } from '@/components/analytics/AlertasUrgentes';
import { ProductAnalysis } from '@/components/analytics/ProductAnalysis';
import { PurchaseCalendar } from '@/components/analytics/PurchaseCalendar';
import MultilocalView from '@/components/analytics/MultilocalView';

// ── Types ──────────────────────────────────────────────────────────────────────
type Tab = 'resumen' | 'analisis' | 'calendario' | 'multilocal';

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

// ── Tab button ────────────────────────────────────────────────────────────────
function TabBtn({
  tab, activeTab, label, badge, onClick,
}: {
  tab: Tab; activeTab: Tab; label: string; badge?: number; onClick: () => void;
}) {
  const isActive = tab === activeTab;
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap border-b-2 ${
        isActive
          ? 'text-white border-[#ED7C00]'
          : 'text-[#7A9BAD] border-transparent hover:text-white hover:border-[#32576F]'
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span
          className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full px-1"
          style={{ background: 'rgba(220,38,38,0.85)', color: '#fff' }}
        >
          {badge}
        </span>
      )}
    </button>
  );
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
  const [showRotacionMensual, setShowRotacionMensual] = useState(false);

  // Tab state — lazy mount: once a tab is visited it stays mounted
  const [activeTab, setActiveTab] = useState<Tab>('resumen');
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(new Set(['resumen']));

  const activateTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setMountedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, []);

  // Cross-tab context
  const [selectedProductId, setSelectedProductId] = useState<number | undefined>(undefined);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

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
    setAnalysisLoading(true);
    try {
      const analysisResult = await api.analytics.stockAnalysis(tenantId, localId);
      setAnalysis(analysisResult);
    } catch {
      // best-effort
    } finally {
      setAnalysisLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    api.analytics.filtros(tenantId).then(setFiltros).catch(() => {});
    load();
  }, [tenantId, load]);

  const hasMultilocal = (filtros?.locales.length ?? 0) > 1;

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

  // ── Cross-tab navigation handlers ─────────────────────────────────────────

  // Treemap / alerta click → Análisis tab with product pre-selected
  const handleGoToAnalisis = useCallback((productoNombre: string) => {
    if (!analysis) return;
    const found = analysis.productos.find(p => p.nombre === productoNombre);
    if (found) setSelectedProductId(found.producto_nombre_id);
    activateTab('analisis');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [analysis, activateTab]);

  // Treemap click (same as above but receives nombre directly)
  const handleTreemapProductClick = useCallback((nombre: string) => {
    handleGoToAnalisis(nombre);
  }, [handleGoToAnalisis]);

  // Alerta critico/bajo → Calendario tab
  const handleGoToCalendario = useCallback(() => {
    activateTab('calendario');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activateTab]);

  // Cart saved → switch to Calendario tab and refetch
  const handleOrderSaved = useCallback(() => {
    activateTab('calendario');
    setCalendarRefreshKey(k => k + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activateTab]);

  // Alerta exceso / transferencia → Multilocal tab
  const handleGoToMultilocal = useCallback(() => {
    activateTab('multilocal');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activateTab]);

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

  const alertasBadge = analysis?.alertas?.length ?? 0;
  const urgenteBadge = analysis?.alertas?.filter(a => a.tipo === 'critico').length ?? 0;

  return (
    <div className="flex flex-col flex-1">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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
        {data && activeTab === 'resumen' && (
          <div className="flex items-center gap-3">
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

      {/* ── Sub-header: local filter + tab bar ─────────────────────────────── */}
      <div className="bg-[#132229] border-b border-[#32576F] px-6 flex items-center gap-6 overflow-x-auto">
        {/* Tab bar */}
        <div className="flex items-center flex-shrink-0">
          <TabBtn tab="resumen"     activeTab={activeTab} label="Resumen"    onClick={() => activateTab('resumen')} />
          <TabBtn tab="analisis"    activeTab={activeTab} label="Análisis"   onClick={() => activateTab('analisis')} />
          <TabBtn tab="calendario"  activeTab={activeTab} label="Calendario" badge={urgenteBadge} onClick={() => activateTab('calendario')} />
          {hasMultilocal && (
            <TabBtn tab="multilocal" activeTab={activeTab} label="Multilocal" onClick={() => activateTab('multilocal')} />
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Local filter */}
        {filtros && filtros.locales.length > 1 && (
          <div className="flex items-center gap-2 py-2 flex-shrink-0">
            <span className="text-[#7A9BAD] text-sm whitespace-nowrap">Local:</span>
            <select
              value={selectedLocal ?? ''}
              onChange={(e) => {
                const v = e.target.value ? parseInt(e.target.value) : undefined;
                setSelectedLocal(v);
                load(v);
              }}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos</option>
              {filtros.locales.map((l) => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
            {loading && <div className="w-4 h-4 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />}
          </div>
        )}
      </div>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main ref={mainRef} className="flex-1">
        {error && (
          <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ── TAB: RESUMEN ──────────────────────────────────────────────────── */}
        <div className={`px-6 py-6 space-y-6 ${activeTab === 'resumen' ? '' : 'hidden'}`}>
          {mountedTabs.has('resumen') && data && (
            <>
              {/* KPI Row 1 */}
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

              {/* KPI Row 2 */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <KpiCard
                  label="Productos Clase A"
                  value={fmtN(claseAProductos.length)}
                  sub="generan el 80% del revenue"
                  color="text-[#ED7C00]"
                />
                <KpiCard
                  label="Alertas activas"
                  value={alertasBadge > 0 ? String(alertasBadge) : '—'}
                  sub={alertasBadge > 0 ? `${urgenteBadge} críticas · click en alerta para actuar` : 'Sin alertas'}
                  color={urgenteBadge > 0 ? 'text-red-400' : alertasBadge > 0 ? 'text-yellow-400' : 'text-[#7A9BAD]'}
                />
                <KpiCard
                  label="Total SKUs"
                  value={fmtN(data.total_skus)}
                  sub={`${data.total_productos} tipos de producto`}
                  color="text-white"
                />
              </div>

              {/* Rotación mensual expandible */}
              {showRotacionMensual && data.rotacion_mensual.length > 0 && (
                <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-white font-semibold text-sm">Rotación mensual histórica</p>
                    <button
                      onClick={() => setShowRotacionMensual(false)}
                      className="text-[#7A9BAD] hover:text-white transition-colors text-xs"
                    >
                      cerrar ✕
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {data.rotacion_mensual.map((m: Record<string, unknown>, i: number) => {
                      const rot = Number(m.rotacion ?? m.rotacion_mensual ?? 0);
                      const label = String(m.mes_nombre ?? m.mes ?? i + 1);
                      const color = rot >= 1 ? '#2ECC71' : rot >= 0.3 ? '#D4A017' : '#DC2626';
                      return (
                        <div key={i} className="flex flex-col items-center gap-1 min-w-[44px]">
                          <div className="relative w-8 bg-[#132229] rounded-sm overflow-hidden" style={{ height: 48 }}>
                            <div
                              className="absolute bottom-0 left-0 right-0 rounded-sm transition-all"
                              style={{ height: `${Math.min(rot * 50, 100)}%`, backgroundColor: color, opacity: 0.85 }}
                            />
                          </div>
                          <span className="text-[#7A9BAD] text-[10px] font-mono">{rot.toFixed(1)}x</span>
                          <span className="text-[#7A9BAD] text-[9px] truncate max-w-[44px] text-center">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Alertas urgentes */}
              {(analysisLoading || (analysis?.alertas && analysis.alertas.length > 0)) && (
                <ChartContainer
                  title="Acciones urgentes del día"
                  subtitle="Alertas prioritarias de inventario · click en tarjeta para navegar al tab correspondiente"
                  exportFileName={`stock_alertas_${tenantId}`}
                >
                  <AlertasUrgentes
                    alertas={analysis?.alertas ?? null}
                    loading={analysisLoading && !analysis}
                    onAnalisis={handleGoToAnalisis}
                    onCalendario={handleGoToCalendario}
                    onMultilocal={hasMultilocal ? handleGoToMultilocal : undefined}
                    hasMultilocal={hasMultilocal}
                  />
                </ChartContainer>
              )}

              {/* Salud del inventario (Treemap) */}
              {data.abc_por_nombre.length > 0 && (
                <ChartContainer
                  title="Salud del inventario"
                  subtitle="Tamaño = valor en stock · Color = cobertura de días · Click en producto → tab Análisis"
                  exportFileName={`stock_salud_${tenantId}`}
                >
                  <InventarioTreemap
                    data={data.abc_por_nombre}
                    onProductClick={analysis ? handleTreemapProductClick : undefined}
                  />
                </ChartContainer>
              )}



              {/* ABC por nombre */}
              <ChartContainer
                title="Análisis ABC por producto"
                subtitle="Clasificación Pareto: A=80% revenue, B=95%, C=resto · click en fila → Análisis"
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
                            <tr
                              key={i}
                              className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors cursor-pointer"
                              onClick={() => handleGoToAnalisis(p.nombre)}
                            >
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

            </>
          )}
        </div>

        {/* ── TAB: ANÁLISIS ─────────────────────────────────────────────────── */}
        <div className={`px-6 py-6 ${activeTab === 'analisis' ? '' : 'hidden'}`}>
          {mountedTabs.has('analisis') && (
            analysis && analysis.productos.length > 0 ? (
              <ChartContainer
                title="Análisis por producto"
                subtitle="Proyección de stock · distribución de modelos · curva de talles/colores"
                exportFileName={`stock_producto_${tenantId}`}
              >
                <ProductAnalysis
                  tenantId={tenantId}
                  localId={selectedLocal}
                  productos={analysis.productos}
                  initialProductId={selectedProductId}
                  onClose={undefined}
                  onOrderSaved={handleOrderSaved}
                />
              </ChartContainer>
            ) : analysisLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <svg className="w-10 h-10 text-[#32576F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p className="text-[#7A9BAD] text-sm">Sin datos de análisis disponibles</p>
              </div>
            )
          )}
        </div>

        {/* ── TAB: CALENDARIO ───────────────────────────────────────────────── */}
        <div className={`px-6 py-6 ${activeTab === 'calendario' ? '' : 'hidden'}`}>
          {mountedTabs.has('calendario') && (
            <ChartContainer
              title="Calendario de compras"
              subtitle="Planificación de órdenes · Motor de sugerencias + órdenes manuales · Drag & drop para reprogramar"
              exportFileName={`stock_calendario_${tenantId}`}
            >
              <PurchaseCalendar tenantId={tenantId} localId={selectedLocal} refreshKey={calendarRefreshKey} />
            </ChartContainer>
          )}
        </div>

        {/* ── TAB: MULTILOCAL ───────────────────────────────────────────────── */}
        {hasMultilocal && (
          <div className={`px-6 py-6 ${activeTab === 'multilocal' ? '' : 'hidden'}`}>
            {mountedTabs.has('multilocal') && (
              <ChartContainer
                title="Optimización multilocal"
                subtitle="Mapa de cobertura por local · Transferencias recomendadas para equilibrar inventario sin nuevas compras"
                exportFileName={`stock_multilocal_${tenantId}`}
              >
                <MultilocalView tenantId={tenantId} />
              </ChartContainer>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
