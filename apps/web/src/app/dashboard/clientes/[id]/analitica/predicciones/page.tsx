'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  type AiAnalysisResponse,
  type AiInsightAjuste,
  type AnalyticsFilters,
  type FiltrosDisponibles,
  type PrediccionProducto,
  type PrediccionesResponse,
} from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

type Modelo = 'basico' | 'temporada' | 'quiebre';

interface ProductConfig {
  modelo?: Modelo;
  sobre_stock_pct?: number;
  periodo_dias?: number;
}

interface GroupRow {
  key: string;           // "nombre::descripcion"
  nombre: string;
  descripcion: string;
  skus: PrediccionProducto[];
  totalStock: number;
  promedioDiario: number;
  prediccion: number;    // after model factor, before override
  finalPrediccion: number; // after override (if any)
  recomendado: number;
  modelo: Modelo;
  sobreStock: number;
  periodoDias: number;
  hasImbalance: boolean;
  imbalanceDetail: string;
  aiAjuste: AiInsightAjuste | undefined;
}

const MODEL_FACTOR: Record<Modelo, number> = { basico: 1.0, temporada: 1.25, quiebre: 1.5 };
const MODEL_LABEL: Record<Modelo, string> = { basico: 'Básico', temporada: 'Temporada', quiebre: 'Quiebre' };
const LS_CONFIG = (id: string) => `pred_config_${id}`;
const LS_OVERRIDE = (id: string) => `pred_override_${id}`;

function fmtNum(n: number) {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function KpiCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 border ${highlight ? 'bg-[#1a2e1a] border-[#22543D]' : 'bg-[#132229] border-[#32576F]'}`}>
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-bold text-xl ${highlight ? 'text-[#4ade80]' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-[#7A9BAD] text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

export default function PrediccionesPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<PrediccionesResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Global defaults
  const [globalModelo, setGlobalModelo] = useState<Modelo>('basico');
  const [globalPeriodo, setGlobalPeriodo] = useState(30);
  const [globalSobreStock, setGlobalSobreStock] = useState(0);

  // Per-product configs persisted in localStorage
  const [productConfigs, setProductConfigs] = useState<Record<string, ProductConfig>>({});
  // Manual overrides (final prediccion value set by user)
  const [manualOverrides, setManualOverrides] = useState<Record<string, number | null>>({});

  // UI state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiData, setAiData] = useState<AiAnalysisResponse | null>(null);
  const [aiApplied, setAiApplied] = useState(false);
  const aiAjustesApplied = useRef<Record<string, number>>({});

  // Load localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CONFIG(tenantId));
      if (raw) setProductConfigs(JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem(LS_OVERRIDE(tenantId));
      if (raw) setManualOverrides(JSON.parse(raw));
    } catch {}
  }, [tenantId]);

  const saveConfigs = useCallback((configs: Record<string, ProductConfig>) => {
    setProductConfigs(configs);
    localStorage.setItem(LS_CONFIG(tenantId), JSON.stringify(configs));
  }, [tenantId]);

  const saveOverrides = useCallback((overrides: Record<string, number | null>) => {
    setManualOverrides(overrides);
    localStorage.setItem(LS_OVERRIDE(tenantId), JSON.stringify(overrides));
  }, [tenantId]);

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.analytics.predicciones(tenantId, f, {
        modelo: 'basico',
        periodo_dias: globalPeriodo,
        sobre_stock_pct: 0,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [tenantId, globalPeriodo]);

  useEffect(() => {
    api.analytics.filtros(tenantId).then(setFiltros).catch(() => {});
    load({});
  }, [tenantId, load]);

  // Group products by nombre::descripcion
  const groups: GroupRow[] = useMemo(() => {
    if (!data) return [];

    const grouped = new Map<string, PrediccionProducto[]>();
    for (const p of data.productos) {
      const key = `${p.nombre}::${p.descripcion || ''}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    return Array.from(grouped.entries()).map(([key, skus]) => {
      const cfg = productConfigs[key] || {};
      const modelo = cfg.modelo ?? globalModelo;
      const sobreStock = cfg.sobre_stock_pct ?? globalSobreStock;
      const periodoDias = cfg.periodo_dias ?? globalPeriodo;
      const factor = MODEL_FACTOR[modelo];

      const totalStock = skus.reduce((s, p) => s + (p.stock_actual ?? 0), 0);
      const promedioDiario = skus.reduce((s, p) => s + (p.promedio_diario ?? 0), 0);
      const prediccion = promedioDiario * periodoDias * factor;

      // AI adjustment
      const aiAjuste = aiData?.ajustes.find((a) => a.producto_key === key);
      const aiMultiplier = aiApplied && aiAjuste ? aiAjuste.factor : 1.0;
      const prediccionConAI = prediccion * aiMultiplier;

      const override = manualOverrides[key] ?? null;
      const finalPrediccion = override !== null ? override : prediccionConAI;
      const recomendado = Math.ceil(finalPrediccion * (1 + sobreStock / 100));

      // Imbalance detection
      let hasImbalance = false;
      let imbalanceDetail = '';
      if (skus.length > 1) {
        const byTalle = new Map<string, number>();
        const byColor = new Map<string, number>();
        for (const p of skus) {
          if (p.talle) byTalle.set(p.talle, (byTalle.get(p.talle) ?? 0) + (p.stock_actual ?? 0));
          if (p.color) byColor.set(p.color, (byColor.get(p.color) ?? 0) + (p.stock_actual ?? 0));
        }
        if (totalStock > 0) {
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
      }

      return {
        key,
        nombre: skus[0]?.nombre ?? '',
        descripcion: skus[0]?.descripcion ?? '',
        skus,
        totalStock,
        promedioDiario,
        prediccion,
        finalPrediccion,
        recomendado,
        modelo,
        sobreStock,
        periodoDias,
        hasImbalance,
        imbalanceDetail,
        aiAjuste,
      } as GroupRow;
    }).sort((a, b) => b.finalPrediccion - a.finalPrediccion);
  }, [data, productConfigs, manualOverrides, globalModelo, globalSobreStock, globalPeriodo, aiData, aiApplied]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const s = search.toLowerCase();
    return groups.filter(
      (g) =>
        g.nombre.toLowerCase().includes(s) ||
        g.descripcion.toLowerCase().includes(s),
    );
  }, [groups, search]);

  const totals = useMemo(() => {
    const pred = groups.reduce((s, g) => s + g.finalPrediccion, 0);
    const stock = groups.reduce((s, g) => s + g.totalStock, 0);
    const rec = groups.reduce((s, g) => s + g.recomendado, 0);
    const faltante = Math.max(rec - stock, 0);
    return { pred, stock, rec, faltante };
  }, [groups]);

  const callAi = useCallback(async () => {
    setAiLoading(true);
    setAiData(null);
    setAiApplied(false);
    try {
      const gruposPayload = groups.slice(0, 60).map((g) => ({
        nombre: g.nombre,
        descripcion: g.descripcion,
        stock: g.totalStock,
        prediccion: g.prediccion,
        promedio_diario: g.promedioDiario,
      }));
      const fechaActual = new Date().toLocaleDateString('es-AR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const result = await api.analytics.prediccionesAiContext(tenantId, {
        grupos: gruposPayload,
        periodo_dias: globalPeriodo,
        fecha_actual: fechaActual,
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
  }, [groups, tenantId, globalPeriodo]);

  const applyAiSuggestions = useCallback(() => {
    if (!aiData) return;
    const newOverrides = { ...manualOverrides };
    const applied: Record<string, number> = {};
    for (const g of groups) {
      const ajuste = aiData.ajustes.find((a) => a.producto_key === g.key);
      if (ajuste && Math.abs(ajuste.factor - 1.0) > 0.01) {
        const newVal = Math.ceil(g.prediccion * ajuste.factor);
        newOverrides[g.key] = newVal;
        applied[g.key] = newVal;
      }
    }
    aiAjustesApplied.current = applied;
    saveOverrides(newOverrides);
    setAiApplied(true);
  }, [aiData, groups, manualOverrides, saveOverrides]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateConfig = (key: string, patch: Partial<ProductConfig>) => {
    const next = { ...productConfigs, [key]: { ...(productConfigs[key] ?? {}), ...patch } };
    saveConfigs(next);
  };

  const setOverride = (key: string, val: string) => {
    const n = val === '' ? null : Number(val);
    saveOverrides({ ...manualOverrides, [key]: n });
  };

  const resetProduct = (key: string) => {
    const newCfg = { ...productConfigs };
    delete newCfg[key];
    saveConfigs(newCfg);
    const newOvr = { ...manualOverrides };
    delete newOvr[key];
    saveOverrides(newOvr);
  };

  const hasCustom = (key: string) =>
    !!productConfigs[key] || manualOverrides[key] != null;

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link
          href={`/dashboard/clientes/${tenantId}`}
          className="text-[#7A9BAD] hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-white">Predicciones de demanda</h1>
          <p className="text-[#7A9BAD] text-sm">
            Estimaciones por producto con configuración individual, edición manual y análisis IA.
          </p>
        </div>
        {/* AI toggle */}
        <button
          onClick={() => {
            const next = !aiEnabled;
            setAiEnabled(next);
            if (next && !aiData) callAi();
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            aiEnabled
              ? 'bg-[#ED7C00] text-white'
              : 'bg-[#132229] border border-[#32576F] text-[#7A9BAD] hover:text-white'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.2 1.2M5 14.5l-1.2 1.2m0 0l1.2 1.2M3.8 15.7l1.2 1.2M19.8 15l1.2 1.2" />
          </svg>
          {aiEnabled ? 'IA activa' : 'Activar IA'}
        </button>
      </div>

      <main className="flex-1 px-6 py-6 space-y-5">
        <DateRangeFilter filtros={filtros} onApply={load} loading={loading} />

        {/* Global config */}
        <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
          <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-3">Configuración global (por defecto)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[#7A9BAD] text-xs mb-1 block">Modelo de predicción</label>
              <select
                value={globalModelo}
                onChange={(e) => setGlobalModelo(e.target.value as Modelo)}
                className="w-full bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="basico">Básico (×1.0)</option>
                <option value="temporada">Temporada (×1.25)</option>
                <option value="quiebre">Quiebre de stock (×1.5)</option>
              </select>
              <p className="text-[#7A9BAD] text-xs mt-1">Aplica a productos sin configuración individual</p>
            </div>
            <div>
              <label className="text-[#7A9BAD] text-xs mb-1 block">Horizonte (días)</label>
              <input
                type="number"
                min={1}
                value={globalPeriodo}
                onChange={(e) => setGlobalPeriodo(Math.max(1, Number(e.target.value)))}
                className="w-full bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-white"
              />
              <p className="text-[#7A9BAD] text-xs mt-1">Días a cubrir con el stock recomendado</p>
            </div>
            <div>
              <label className="text-[#7A9BAD] text-xs mb-1 block">% Sobrestock de seguridad</label>
              <input
                type="number"
                min={0}
                value={globalSobreStock}
                onChange={(e) => setGlobalSobreStock(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-white"
              />
              <p className="text-[#7A9BAD] text-xs mt-1">Margen extra sobre la predicción (0 = sin margen)</p>
            </div>
          </div>
        </div>

        {/* AI panel */}
        {aiEnabled && (
          <div className="bg-[#1a2433] border border-[#ED7C00]/40 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#ED7C00] animate-pulse" />
                <span className="text-[#ED7C00] text-sm font-medium">Análisis IA — Claude</span>
              </div>
              <div className="flex items-center gap-2">
                {aiData && !aiLoading && (
                  <>
                    <button
                      onClick={callAi}
                      className="text-[#7A9BAD] hover:text-white text-xs px-2 py-1 border border-[#32576F] rounded"
                    >
                      Reanalizar
                    </button>
                    {aiData.ajustes.length > 0 && !aiApplied && (
                      <button
                        onClick={applyAiSuggestions}
                        className="bg-[#ED7C00] hover:bg-[#c96900] text-white text-xs px-3 py-1 rounded font-medium"
                      >
                        Aplicar {aiData.ajustes.length} sugerencia{aiData.ajustes.length !== 1 ? 's' : ''}
                      </button>
                    )}
                    {aiApplied && (
                      <span className="text-[#4ade80] text-xs">✓ Sugerencias aplicadas</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {aiLoading && (
              <div className="flex items-center gap-2 py-2">
                <div className="w-4 h-4 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
                <span className="text-[#7A9BAD] text-sm">Analizando predicciones con IA...</span>
              </div>
            )}

            {aiData && !aiLoading && (
              <>
                {aiData.advertencia && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    <p className="text-red-400 text-xs">{aiData.advertencia}</p>
                  </div>
                )}
                <div className="text-[#CDD4DA] text-sm leading-relaxed whitespace-pre-line">
                  {aiData.insights}
                </div>
                {aiData.ajustes.length > 0 && (
                  <div>
                    <p className="text-[#7A9BAD] text-xs mb-2">Ajustes sugeridos:</p>
                    <div className="space-y-1">
                      {aiData.ajustes.map((a, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span
                            className={`font-mono font-bold shrink-0 ${
                              a.factor > 1 ? 'text-[#ED7C00]' : 'text-[#4ade80]'
                            }`}
                          >
                            {a.factor > 1 ? '+' : ''}{Math.round((a.factor - 1) * 100)}%
                          </span>
                          <span className="text-[#7A9BAD] font-medium shrink-0">{a.producto_key}</span>
                          <span className="text-[#7A9BAD]">— {a.razon}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* KPIs */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label={`Predicción ${globalPeriodo}d`}
              value={fmtNum(totals.pred)}
              sub="unidades proyectadas"
            />
            <KpiCard
              label="Stock actual"
              value={fmtNum(totals.stock)}
              sub="unidades en inventario"
            />
            <KpiCard
              label="Stock recomendado"
              value={fmtNum(totals.rec)}
              sub={`con ${globalSobreStock}% sobrestock`}
            />
            <KpiCard
              label="Unidades faltantes"
              value={fmtNum(totals.faltante)}
              sub="para cubrir el horizonte"
              highlight={totals.faltante > 0}
            />
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

        {/* Main table */}
        {data && (
          <ChartContainer title="Predicciones por producto" exportFileName={`predicciones_${tenantId}`}>
            {/* Search */}
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                placeholder="Buscar por nombre o descripción..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-white placeholder-[#7A9BAD]"
              />
              <span className="text-[#7A9BAD] text-xs shrink-0">
                {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#32576F]">
                    <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase w-6">#</th>
                    <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Nombre</th>
                    <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Descripción</th>
                    <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Stock</th>
                    <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Predicción</th>
                    <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Recomendado</th>
                    <th className="text-center text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Modelo</th>
                    <th className="text-center text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">%Sobre</th>
                    <th className="text-center text-[#7A9BAD] font-medium py-2 px-2 text-xs uppercase">Override</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g, i) => {
                    const isExpanded = expandedGroups.has(g.key);
                    const isCustom = hasCustom(g.key);
                    const overrideVal = manualOverrides[g.key] ?? null;

                    return (
                      <React.Fragment key={g.key}>
                        <tr
                          className={`border-b border-[#32576F]/40 hover:bg-[#132229]/60 transition-colors ${
                            isCustom ? 'bg-[#1a2c2a]/30' : ''
                          }`}
                        >
                          <td className="py-2 px-2 text-[#7A9BAD] text-xs">{i + 1}</td>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => toggleGroup(g.key)}
                                className="text-[#7A9BAD] hover:text-white transition-colors shrink-0"
                                title={isExpanded ? 'Colapsar' : 'Ver talles/colores'}
                              >
                                <svg
                                  className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                              <span className="text-white font-medium">{g.nombre}</span>
                              {g.hasImbalance && (
                                <span
                                  title={g.imbalanceDetail}
                                  className="ml-1 text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-1 rounded cursor-help"
                                >
                                  desbalance
                                </span>
                              )}
                              {g.aiAjuste && aiEnabled && (
                                <span
                                  title={`IA: ${g.aiAjuste.razon}`}
                                  className="ml-1 text-[10px] bg-[#ED7C00]/20 text-[#ED7C00] border border-[#ED7C00]/30 px-1 rounded cursor-help"
                                >
                                  IA {g.aiAjuste.factor > 1 ? '+' : ''}{Math.round((g.aiAjuste.factor - 1) * 100)}%
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-[#CDD4DA] text-xs max-w-[140px] truncate" title={g.descripcion}>
                            {g.descripcion || '—'}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-[#CDD4DA]">{fmtNum(g.totalStock)}</td>
                          <td className="py-2 px-2 text-right font-mono text-[#ED7C00]">
                            {fmtNum(Math.round(g.finalPrediccion))}
                            {overrideVal !== null && (
                              <span className="ml-1 text-[10px] text-[#4ade80]">✎</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-[#4ade80]">{fmtNum(g.recomendado)}</td>
                          {/* Modelo individual */}
                          <td className="py-2 px-2 text-center">
                            <select
                              value={productConfigs[g.key]?.modelo ?? ''}
                              onChange={(e) =>
                                updateConfig(g.key, { modelo: (e.target.value as Modelo) || undefined })
                              }
                              className="bg-[#0F1E28] border border-[#32576F] rounded px-1 py-0.5 text-xs text-white w-[90px]"
                              title="Modelo individual (sobreescribe el global)"
                            >
                              <option value="">Global ({MODEL_LABEL[globalModelo]})</option>
                              <option value="basico">Básico</option>
                              <option value="temporada">Temporada</option>
                              <option value="quiebre">Quiebre</option>
                            </select>
                          </td>
                          {/* % Sobrestock individual */}
                          <td className="py-2 px-2 text-center">
                            <input
                              type="number"
                              min={0}
                              placeholder={`${globalSobreStock}`}
                              value={productConfigs[g.key]?.sobre_stock_pct ?? ''}
                              onChange={(e) =>
                                updateConfig(g.key, {
                                  sobre_stock_pct: e.target.value === '' ? undefined : Number(e.target.value),
                                })
                              }
                              className="bg-[#0F1E28] border border-[#32576F] rounded px-1 py-0.5 text-xs text-white w-[56px] text-center"
                              title="% sobrestock individual"
                            />
                          </td>
                          {/* Manual override */}
                          <td className="py-2 px-2 text-center">
                            <input
                              type="number"
                              min={0}
                              placeholder="auto"
                              value={overrideVal ?? ''}
                              onChange={(e) => setOverride(g.key, e.target.value)}
                              className="bg-[#0F1E28] border border-[#32576F] rounded px-1 py-0.5 text-xs text-white w-[64px] text-center"
                              title="Override manual de predicción"
                            />
                          </td>
                          {/* Reset */}
                          <td className="py-2 px-2 text-center">
                            {isCustom && (
                              <button
                                onClick={() => resetProduct(g.key)}
                                className="text-[#7A9BAD] hover:text-red-400 transition-colors text-xs"
                                title="Restablecer a valores globales"
                              >
                                ↺
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Expanded: talle/color breakdown */}
                        {isExpanded && (
                          <tr className="border-b border-[#32576F]/40">
                            <td colSpan={10} className="py-0">
                              <div className="bg-[#0F1E28] mx-2 mb-2 rounded-lg overflow-hidden">
                                {g.hasImbalance && (
                                  <div className="px-3 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20">
                                    <p className="text-yellow-400 text-xs">
                                      Desbalance detectado: {g.imbalanceDetail}
                                    </p>
                                  </div>
                                )}
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-[#32576F]/60">
                                      <th className="text-left text-[#7A9BAD] font-medium py-1.5 px-3">Talle</th>
                                      <th className="text-left text-[#7A9BAD] font-medium py-1.5 px-3">Color</th>
                                      <th className="text-right text-[#7A9BAD] font-medium py-1.5 px-3">Stock</th>
                                      <th className="text-right text-[#7A9BAD] font-medium py-1.5 px-3">Prom./día</th>
                                      <th className="text-right text-[#7A9BAD] font-medium py-1.5 px-3">Pred. {g.periodoDias}d</th>
                                      <th className="text-right text-[#7A9BAD] font-medium py-1.5 px-3">Rec. stock</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.skus.map((sku, si) => {
                                      const skuPred =
                                        (sku.promedio_diario ?? 0) * g.periodoDias * MODEL_FACTOR[g.modelo];
                                      const skuRec = Math.ceil(
                                        skuPred * (1 + g.sobreStock / 100),
                                      );
                                      const stockPct =
                                        g.totalStock > 0
                                          ? Math.round(((sku.stock_actual ?? 0) / g.totalStock) * 100)
                                          : 0;
                                      return (
                                        <tr
                                          key={si}
                                          className="border-b border-[#32576F]/30 hover:bg-[#132229]/40"
                                        >
                                          <td className="py-1.5 px-3 text-[#CDD4DA]">
                                            {sku.talle || '—'}
                                          </td>
                                          <td className="py-1.5 px-3 text-[#CDD4DA]">
                                            {sku.color || '—'}
                                          </td>
                                          <td className="py-1.5 px-3 text-right text-[#CDD4DA]">
                                            {fmtNum(sku.stock_actual ?? 0)}
                                            <span className="text-[#7A9BAD] ml-1">({stockPct}%)</span>
                                          </td>
                                          <td className="py-1.5 px-3 text-right text-[#7A9BAD]">
                                            {(sku.promedio_diario ?? 0).toFixed(2)}
                                          </td>
                                          <td className="py-1.5 px-3 text-right text-[#ED7C00] font-mono">
                                            {fmtNum(Math.round(skuPred))}
                                          </td>
                                          <td className="py-1.5 px-3 text-right text-[#4ade80] font-mono">
                                            {fmtNum(skuRec)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartContainer>
        )}

        {/* Footer note */}
        <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
          <p className="text-[#7A9BAD] text-xs leading-relaxed">
            <span className="text-[#CDD4DA] font-medium">Notas: </span>
            Las configuraciones individuales por producto (modelo, % sobrestock, overrides manuales) se persisten
            localmente en este navegador. Usar el botón ↺ restablece el producto a los valores globales.
            La IA analiza los top 60 productos y sugiere factores de ajuste basados en patrones de demanda y
            contexto estacional. Las sugerencias de IA pueden aplicarse en bloque o ajustarse manualmente.
          </p>
        </div>
      </main>
    </div>
  );
}
