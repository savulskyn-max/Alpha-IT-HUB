'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import {
  api,
  type StockResponse,
  type FamiliaRecompra,
  type TalleColorVenta,
  type ProductoStock,
  type AbcNombre,
  type FiltrosDisponibles,
} from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';

// ── Types ─────────────────────────────────────────────────────────────────────
type ProductTipo = 'basico' | 'temporada' | 'quiebre';
type Urgency = 'critica' | 'alta' | 'media' | 'ok';

interface FamiliaConfig {
  tipo: ProductTipo;
  cobertura_objetivo: number | null;
  lead_time: number | null;
}

interface RecResult {
  debeComprar: boolean;
  unidades: number;
  urgency: Urgency;
  razon: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ABC_COLORS = { A: '#ED7C00', B: '#3B82F6', C: '#6B7280' };
const ABC_BG = {
  A: 'bg-[#ED7C00]/10 text-[#ED7C00] border border-[#ED7C00]/30',
  B: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  C: 'bg-gray-500/10 text-gray-400 border border-gray-500/30',
};
const URGENCY_BADGE: Record<Urgency, string> = {
  critica: 'bg-red-500/20 text-red-400 border border-red-500/30',
  alta: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  media: 'bg-[#ED7C00]/20 text-[#ED7C00] border border-[#ED7C00]/30',
  ok: 'bg-green-500/20 text-green-400 border border-green-500/30',
};
const URGENCY_LABEL: Record<Urgency, string> = { critica: 'Crítica', alta: 'Alta', media: 'Media', ok: 'OK' };

const TALLE_ORDER = ['XS','S','M','L','XL','XXL','XXXL','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}
function fmtN(n: number) { return new Intl.NumberFormat('es-AR').format(n); }
function familiaKey(f: FamiliaRecompra) { return `${f.nombre}::${f.descripcion}`; }

function sortTalles(talles: string[]): string[] {
  return [...talles].sort((a, b) => {
    const ai = TALLE_ORDER.indexOf(a.toUpperCase());
    const bi = TALLE_ORDER.indexOf(b.toUpperCase());
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    const an = parseInt(a); const bn = parseInt(b);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;
    return a.localeCompare(b);
  });
}

function calcRec(f: FamiliaRecompra, config: FamiliaConfig, globalLT: number): RecResult {
  const { stock_total, promedio_diario_anual, temporada_detectada, fase_temporada } = f;
  const { tipo, cobertura_objetivo, lead_time } = config;

  // Seasonal product in post-temporada: suppress reorder to avoid dead stock
  if (temporada_detectada && fase_temporada === 'post_temporada') {
    return { debeComprar: false, unidades: 0, urgency: 'ok', razon: 'Fuera de temporada — evitar stock inmovilizado' };
  }

  const cobertura = promedio_diario_anual > 0
    ? stock_total / promedio_diario_anual
    : (stock_total > 0 ? 9999 : 0);
  const lt = lead_time ?? globalLT;
  const objetivo = cobertura_objetivo ?? (tipo === 'temporada' ? 90 : tipo === 'quiebre' ? 30 : 60);

  if (tipo === 'quiebre') {
    return {
      debeComprar: stock_total === 0,
      unidades: stock_total === 0 ? Math.ceil(Math.max(objetivo * promedio_diario_anual, 1)) : 0,
      urgency: stock_total === 0 ? 'critica' : 'ok',
      razon: 'Política quiebre: reponer solo al agotarse',
    };
  }

  const puntoPedido = lt > 0 ? lt + 14 : (tipo === 'temporada' ? 45 : 30);
  const debeComprar = cobertura < puntoPedido || stock_total === 0;
  const unidades = Math.max(0, Math.ceil(objetivo * promedio_diario_anual - stock_total));
  const urgency: Urgency =
    stock_total === 0 || cobertura < 7 ? 'critica' :
    cobertura < (lt > 0 ? lt + 7 : 15) ? 'alta' :
    cobertura < puntoPedido ? 'media' : 'ok';

  const razon =
    temporada_detectada === 'OI' && fase_temporada === 'pre_temporada' ? 'Pre-temporada OI — abastecer' :
    temporada_detectada === 'OI' && fase_temporada === 'activa' ? 'Temporada OI activa' :
    temporada_detectada === 'OI' && fase_temporada === 'bajando' ? 'OI en baja — verificar cantidad' :
    temporada_detectada === 'PV' && fase_temporada === 'pre_temporada' ? 'Pre-temporada PV — abastecer' :
    temporada_detectada === 'PV' && fase_temporada === 'activa' ? 'Temporada PV activa' :
    temporada_detectada === 'PV' && fase_temporada === 'bajando' ? 'PV en baja — verificar cantidad' : '';

  return { debeComprar, unidades, urgency, razon };
}

function distributeUnits(total: number, breakdown: TalleColorVenta[]): Map<string, number> {
  const sum = breakdown.reduce((s, x) => s + x.unidades, 0);
  const result = new Map<string, number>();
  if (sum === 0 || total === 0) return result;
  let assigned = 0;
  const sorted = [...breakdown].sort((a, b) => b.unidades - a.unidades);
  for (let i = 0; i < sorted.length; i++) {
    const { talle, color, unidades } = sorted[i];
    const q = i === sorted.length - 1 ? total - assigned : Math.round(total * unidades / sum);
    result.set(`${talle}::${color}`, q);
    assigned += q;
  }
  return result;
}

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

function TemporadaBadge({ temporada, fase }: {
  temporada: 'OI' | 'PV' | null;
  fase: 'pre_temporada' | 'activa' | 'bajando' | 'post_temporada' | null;
}) {
  if (!temporada) return null;
  const faseColors: Record<string, string> = {
    pre_temporada: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    activa: 'bg-green-500/20 text-green-300 border-green-500/30',
    bajando: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    post_temporada: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  const faseLabel: Record<string, string> = {
    pre_temporada: 'Pre-temp.',
    activa: 'Activa',
    bajando: 'En baja',
    post_temporada: 'Post-temp.',
  };
  const col = fase ? (faseColors[fase] ?? 'bg-[#32576F]/20 text-[#7A9BAD] border-[#32576F]/30') : 'bg-[#32576F]/20 text-[#7A9BAD] border-[#32576F]/30';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${col}`}>
      {temporada} {fase ? faseLabel[fase] : ''}
    </span>
  );
}

function MiniChart({ data }: { data: Array<{ mes: string; unidades: number }> }) {
  if (data.length < 3) return null;
  const last12 = data.slice(-12);
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={last12} margin={{ top: 2, right: 2, left: -40, bottom: 0 }}>
        <Line type="monotone" dataKey="unidades" stroke="#ED7C00" strokeWidth={1.5} dot={false} />
        <YAxis hide domain={['auto', 'auto']} />
        <XAxis dataKey="mes" hide />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TalleColorMatrix({
  familia, unidadesTotal, edits, onEdit,
}: {
  familia: FamiliaRecompra;
  unidadesTotal: number;
  edits: Record<string, number>;
  onEdit: (key: string, val: number) => void;
}) {
  const breakdown = familia.talle_color_breakdown;
  const talles = sortTalles([...new Set(breakdown.map((tc) => tc.talle))].filter(Boolean));
  const colores = [...new Set(breakdown.map((tc) => tc.color))].filter(Boolean).sort();

  const hist = new Map<string, number>();
  for (const tc of breakdown) hist.set(`${tc.talle}::${tc.color}`, tc.unidades);
  const recMap = distributeUnits(unidadesTotal, breakdown);
  const maxHist = Math.max(...breakdown.map((tc) => tc.unidades), 1);

  if (talles.length === 0 || colores.length === 0) {
    return <p className="text-xs text-[#7A9BAD] py-3">Sin datos de talle/color en los últimos 12 meses</p>;
  }

  const colTotalsHist = talles.map((t) =>
    colores.reduce((s, c) => s + (hist.get(`${t}::${c}`) ?? 0), 0)
  );
  const colTotalsRec = talles.map((t) =>
    colores.reduce((s, c) => {
      const k = `${t}::${c}`;
      return s + (edits[k] !== undefined ? edits[k] : (recMap.get(k) ?? 0));
    }, 0)
  );

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left text-[#7A9BAD] p-2 min-w-[90px] bg-[#0F1E28] sticky left-0 z-10">
              Color \ Talle
            </th>
            {talles.map((t) => (
              <th key={t} className="text-center text-[#CDD4DA] p-2 min-w-[76px] font-semibold">{t}</th>
            ))}
            <th className="text-center text-[#7A9BAD] p-2 min-w-[76px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {colores.map((color) => {
            const rowHist = talles.reduce((s, t) => s + (hist.get(`${t}::${color}`) ?? 0), 0);
            const rowRec = talles.reduce((s, t) => {
              const k = `${t}::${color}`;
              return s + (edits[k] !== undefined ? edits[k] : (recMap.get(k) ?? 0));
            }, 0);
            return (
              <tr key={color} className="border-t border-[#32576F]/30">
                <td className="p-2 text-[#CDD4DA] font-medium sticky left-0 bg-[#0F1E28] z-10 whitespace-nowrap">
                  {color || '—'}
                </td>
                {talles.map((talle) => {
                  const k = `${talle}::${color}`;
                  const histVal = hist.get(k) ?? 0;
                  const intensity = histVal / maxHist;
                  const recVal = edits[k] !== undefined ? edits[k] : (recMap.get(k) ?? 0);
                  return (
                    <td key={talle} className="p-1 text-center">
                      <div
                        className="rounded p-1 space-y-0.5"
                        style={{ backgroundColor: `rgba(237,124,0,${Math.min(intensity * 0.35, 0.35)})` }}
                      >
                        <div className="text-[#7A9BAD] text-[10px] leading-none">
                          {histVal > 0 ? `${fmtN(histVal)}v` : '—'}
                        </div>
                        <input
                          type="number"
                          min="0"
                          value={recVal}
                          onChange={(e) => onEdit(k, Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full bg-[#1E3340] border border-[#32576F] rounded text-center text-white font-mono text-xs py-0.5 focus:border-[#ED7C00] focus:outline-none"
                        />
                      </div>
                    </td>
                  );
                })}
                <td className="p-2 text-right">
                  <div className="text-[#7A9BAD] text-[10px]">{fmtN(rowHist)}v</div>
                  <div className="text-[#ED7C00] font-mono font-bold">{fmtN(rowRec)}</div>
                </td>
              </tr>
            );
          })}
          {/* Totals */}
          <tr className="border-t border-[#32576F] bg-[#132229]/60">
            <td className="p-2 text-[#7A9BAD] font-medium sticky left-0 bg-[#132229] z-10">Hist. total</td>
            {colTotalsHist.map((v, i) => (
              <td key={i} className="p-2 text-center text-[#CDD4DA] font-mono">{fmtN(v)}</td>
            ))}
            <td className="p-2 text-right text-[#CDD4DA] font-mono">
              {fmtN(breakdown.reduce((s, tc) => s + tc.unidades, 0))}
            </td>
          </tr>
          <tr className="border-t border-[#ED7C00]/30 bg-[#ED7C00]/5">
            <td className="p-2 text-[#ED7C00] font-semibold sticky left-0 bg-[#ED7C00]/10 z-10">A comprar</td>
            {colTotalsRec.map((v, i) => (
              <td key={i} className="p-2 text-center text-[#ED7C00] font-mono font-bold">{fmtN(v)}</td>
            ))}
            <td className="p-2 text-right text-[#ED7C00] font-mono font-bold text-sm">{fmtN(unidadesTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_CONFIGS = (id: string) => `stock_configs_v2_${id}`;
const LS_GLOBAL_LT = (id: string) => `stock_global_lt_${id}`;

// ── Main page ─────────────────────────────────────────────────────────────────
export default function StockAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<StockResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLocal, setSelectedLocal] = useState<number | undefined>(undefined);

  // KPI toggles
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

  // Recompras state
  const [familiaConfigs, setFamiliaConfigs] = useState<Record<string, FamiliaConfig>>({});
  const [globalLeadTime, setGlobalLeadTime] = useState<number>(0);
  const [expandedNombres, setExpandedNombres] = useState<Set<string>>(new Set());
  const [expandedMatrices, setExpandedMatrices] = useState<Set<string>>(new Set());
  const [matrixEdits, setMatrixEdits] = useState<Record<string, Record<string, number>>>({});
  const [comprasSearch, setComprasSearch] = useState('');
  const [showSoloComprar, setShowSoloComprar] = useState(true);
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | Urgency>('all');

  // Restore persisted settings
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CONFIGS(tenantId));
      if (raw) setFamiliaConfigs(JSON.parse(raw));
      const lt = localStorage.getItem(LS_GLOBAL_LT(tenantId));
      if (lt) setGlobalLeadTime(parseInt(lt) || 0);
    } catch {}
  }, [tenantId]);

  const saveConfigs = (configs: Record<string, FamiliaConfig>) => {
    setFamiliaConfigs(configs);
    localStorage.setItem(LS_CONFIGS(tenantId), JSON.stringify(configs));
  };
  const setFamiliaConfig = (key: string, patch: Partial<FamiliaConfig>) => {
    const cur = familiaConfigs[key] ?? { tipo: 'basico', cobertura_objetivo: null, lead_time: null };
    saveConfigs({ ...familiaConfigs, [key]: { ...cur, ...patch } });
  };
  const saveGlobalLT = (v: number) => {
    setGlobalLeadTime(v);
    localStorage.setItem(LS_GLOBAL_LT(tenantId), String(v));
  };

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

  useEffect(() => {
    api.analytics.filtros(tenantId).then(setFiltros).catch(() => {});
    load();
  }, [tenantId, load]);

  const isAdvanced = (data?.meses_con_datos ?? 0) >= 12;

  // Compute recommendations for every familia
  const recsByKey = useMemo(() => {
    const map: Record<string, RecResult & { familia: FamiliaRecompra; config: FamiliaConfig }> = {};
    for (const f of (data?.familias_recompra ?? [])) {
      const k = familiaKey(f);
      const config = familiaConfigs[k] ?? { tipo: 'basico', cobertura_objetivo: null, lead_time: null };
      map[k] = { ...calcRec(f, config, globalLeadTime), familia: f, config };
    }
    return map;
  }, [data?.familias_recompra, familiaConfigs, globalLeadTime]);

  // Group familias by nombre
  const familiasGrouped = useMemo(() => {
    const groups: Record<string, FamiliaRecompra[]> = {};
    for (const f of (data?.familias_recompra ?? [])) {
      if (!groups[f.nombre]) groups[f.nombre] = [];
      groups[f.nombre].push(f);
    }
    return groups;
  }, [data?.familias_recompra]);

  // Summary totals
  const totalCriticas = useMemo(() => Object.values(recsByKey).filter((r) => r.urgency === 'critica').length, [recsByKey]);
  const totalAltas = useMemo(() => Object.values(recsByKey).filter((r) => r.urgency === 'alta').length, [recsByKey]);
  const totalComprar = useMemo(() => Object.values(recsByKey).filter((r) => r.debeComprar).length, [recsByKey]);
  const totalUnidades = useMemo(() => Object.values(recsByKey).reduce((s, r) => s + (r.debeComprar ? r.unidades : 0), 0), [recsByKey]);
  const totalInversion = useMemo(() => Object.values(recsByKey).reduce((s, r) => {
    if (!r.debeComprar) return s;
    return s + r.unidades * r.familia.precio_costo;
  }, 0), [recsByKey]);

  // Filter & sort nombre groups
  const nombresOrdenados = useMemo(() => {
    const urgOrder: Record<Urgency, number> = { critica: 0, alta: 1, media: 2, ok: 3 };
    const search = comprasSearch.toLowerCase();
    return Object.keys(familiasGrouped)
      .filter((nm) => {
        if (search) {
          const matchNombre = nm.toLowerCase().includes(search);
          const matchDesc = familiasGrouped[nm].some((f) => f.descripcion.toLowerCase().includes(search));
          if (!matchNombre && !matchDesc) return false;
        }
        if (showSoloComprar) return familiasGrouped[nm].some((f) => recsByKey[familiaKey(f)]?.debeComprar);
        if (urgencyFilter !== 'all') return familiasGrouped[nm].some((f) => recsByKey[familiaKey(f)]?.urgency === urgencyFilter);
        return true;
      })
      .sort((a, b) => {
        const urgA = Math.min(...familiasGrouped[a].map((f) => urgOrder[recsByKey[familiaKey(f)]?.urgency ?? 'ok']));
        const urgB = Math.min(...familiasGrouped[b].map((f) => urgOrder[recsByKey[familiaKey(f)]?.urgency ?? 'ok']));
        return urgA - urgB;
      });
  }, [familiasGrouped, recsByKey, comprasSearch, showSoloComprar, urgencyFilter]);

  // ABC chart/table data
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
  const claseAProductos = (data?.abc_por_nombre ?? []).filter((p) => p.clasificacion_abc === 'A');
  const filteredNombre = (data?.abc_por_nombre ?? []).filter((p) => abcNombreFilter === 'all' || p.clasificacion_abc === abcNombreFilter);
  const paginatedNombre = filteredNombre.slice(pageNombre * PAGE_SIZE, (pageNombre + 1) * PAGE_SIZE);
  const totalPagesNombre = Math.ceil(filteredNombre.length / PAGE_SIZE);
  const filteredDesc = (data?.productos ?? []).filter((p) => abcDescFilter === 'all' || p.clasificacion_abc === abcDescFilter);
  const paginatedDesc = filteredDesc.slice(pageDesc * PAGE_SIZE, (pageDesc + 1) * PAGE_SIZE);
  const totalPagesDesc = Math.ceil(filteredDesc.length / PAGE_SIZE);

  const toggleNombre = (nm: string) =>
    setExpandedNombres((s) => { const n = new Set(s); n.has(nm) ? n.delete(nm) : n.add(nm); return n; });
  const toggleMatrix = (k: string) =>
    setExpandedMatrices((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const setEdit = (familiaK: string, cellKey: string, val: number) =>
    setMatrixEdits((prev) => ({ ...prev, [familiaK]: { ...(prev[familiaK] ?? {}), [cellKey]: val } }));

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
          <p className="text-[#7A9BAD] text-sm">Valor, rotación, calce financiero y recomendaciones de compra</p>
        </div>
        {data && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
            isAdvanced
              ? 'bg-green-500/10 text-green-400 border-green-500/30'
              : 'bg-[#32576F]/30 text-[#7A9BAD] border-[#32576F]'
          }`}>
            {isAdvanced ? `Modo avanzado · ${data.meses_con_datos}m de datos` : `Modo simple · ${data.meses_con_datos}m de datos`}
          </span>
        )}
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        {/* Local filter — only useful filter for stock */}
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
                sub={data.rotacion_mensual.length > 0 ? `${data.rotacion_mensual.length} meses · click para detalle` : 'CMV / stock promedio'}
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
                label="Alertas de recompra"
                value={fmtN(totalComprar)}
                sub={`${totalCriticas} críticas · ${totalAltas} alta urgencia`}
                color={totalCriticas > 0 ? 'text-red-400' : totalAltas > 0 ? 'text-yellow-400' : 'text-white'}
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
                subtitle="CMV / stock promedio mensual"
                exportFileName={`stock_rotacion_${tenantId}`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.rotacion_mensual} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" />
                    <XAxis dataKey="mes" stroke="#7A9BAD" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#7A9BAD" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(1)}x`} />
                    <Tooltip
                      contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }}
                      formatter={(v: number, name: string) => [
                        name === 'rotacion' ? `${v.toFixed(2)}x` : fmt(v),
                        name === 'rotacion' ? 'Rotación' : name === 'cmv' ? 'CMV' : 'Stock promedio',
                      ]}
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

            {/* ══════════════════════════════════════════════════════════════
                RECOMENDACIONES DE COMPRA
            ══════════════════════════════════════════════════════════════ */}
            <ChartContainer
              title="Recomendaciones de compra"
              subtitle={isAdvanced
                ? `Modo avanzado · ${data.meses_con_datos} meses de datos · detección automática de temporadas OI/PV · distribución por talle y color`
                : `Modo simple · ${data.meses_con_datos} mes${data.meses_con_datos !== 1 ? 'es' : ''} de datos · se necesitan 12+ meses para análisis avanzado con temporadas`}
              exportFileName={`stock_compras_${tenantId}`}
            >
              {/* Summary strip */}
              <div className="flex flex-wrap gap-2 mb-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-1.5">
                  <span className="text-red-400 text-xs font-semibold">{totalCriticas} críticas</span>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-1.5">
                  <span className="text-yellow-400 text-xs font-semibold">{totalAltas} alta urgencia</span>
                </div>
                <div className="bg-[#ED7C00]/10 border border-[#ED7C00]/30 rounded-lg px-3 py-1.5">
                  <span className="text-[#ED7C00] text-xs font-semibold">{totalComprar} familias a reponer</span>
                </div>
                {totalUnidades > 0 && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-1.5">
                    <span className="text-green-400 text-xs font-semibold">{fmtN(totalUnidades)} unidades totales</span>
                  </div>
                )}
                {totalInversion > 0 && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-1.5">
                    <span className="text-blue-400 text-xs font-semibold">Inversión estimada {fmt(totalInversion)}</span>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex flex-wrap gap-2 mb-4 items-center">
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  value={comprasSearch}
                  onChange={(e) => setComprasSearch(e.target.value)}
                  className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-[#ED7C00]"
                />
                <button
                  onClick={() => setShowSoloComprar((v) => !v)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    showSoloComprar ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                  }`}
                >
                  {showSoloComprar ? 'Solo a comprar' : 'Todos los productos'}
                </button>
                <div className="flex gap-1">
                  {(['all', 'critica', 'alta', 'media', 'ok'] as const).map((u) => (
                    <button
                      key={u}
                      onClick={() => setUrgencyFilter(u)}
                      className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                        urgencyFilter === u ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'
                      }`}
                    >
                      {u === 'all' ? 'Todas' : URGENCY_LABEL[u]}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <label className="text-[#7A9BAD] text-xs whitespace-nowrap">Lead time global:</label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={globalLeadTime || ''}
                    placeholder="días"
                    onChange={(e) => saveGlobalLT(parseInt(e.target.value) || 0)}
                    className="w-16 bg-[#1E3340] border border-[#32576F] text-white text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[#ED7C00] text-center"
                  />
                  <span className="text-[#7A9BAD] text-xs">días</span>
                </div>
              </div>

              {/* Hierarchical nombre → familia list */}
              <div className="space-y-2">
                {nombresOrdenados.length === 0 && (
                  <div className="py-8 text-center text-[#7A9BAD] text-sm">
                    {showSoloComprar
                      ? 'No hay productos con necesidad de compra según la configuración actual.'
                      : 'Sin resultados para el filtro aplicado.'}
                  </div>
                )}

                {nombresOrdenados.map((nombre) => {
                  const familias = familiasGrouped[nombre];
                  const isExpanded = expandedNombres.has(nombre);

                  const visibleFamilias = showSoloComprar
                    ? familias.filter((f) => recsByKey[familiaKey(f)]?.debeComprar)
                    : urgencyFilter !== 'all'
                    ? familias.filter((f) => recsByKey[familiaKey(f)]?.urgency === urgencyFilter)
                    : familias;

                  const urgOrder: Record<Urgency, number> = { critica: 0, alta: 1, media: 2, ok: 3 };
                  const grupoUrgency: Urgency = (['critica','alta','media','ok'] as Urgency[])
                    .find((u) => visibleFamilias.some((f) => recsByKey[familiaKey(f)]?.urgency === u)) ?? 'ok';
                  const grupoUnidades = visibleFamilias.reduce((s, f) => s + (recsByKey[familiaKey(f)]?.unidades ?? 0), 0);
                  const grupoStock = familias.reduce((s, f) => s + f.stock_total, 0);
                  const tieneTemporada = familias.some((f) => f.temporada_detectada);

                  return (
                    <div key={nombre} className="border border-[#32576F] rounded-xl overflow-hidden">
                      {/* Nombre header row */}
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 text-left bg-[#132229] hover:bg-[#1E3340] transition-colors"
                        onClick={() => toggleNombre(nombre)}
                      >
                        <svg
                          className={`w-4 h-4 text-[#7A9BAD] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="text-white font-semibold text-sm flex-1 truncate">{nombre}</span>
                        <span className="text-[#7A9BAD] text-xs hidden sm:inline">
                          {familias.length} descripción{familias.length !== 1 ? 'es' : ''}
                        </span>
                        <span className="text-[#7A9BAD] text-xs font-mono hidden sm:inline">
                          Stock: {fmtN(grupoStock)}
                        </span>
                        {tieneTemporada && (
                          <span className="text-[10px] text-blue-400 border border-blue-400/30 bg-blue-400/10 rounded px-1.5 py-0.5">
                            Temporada
                          </span>
                        )}
                        {grupoUnidades > 0 && (
                          <span className="text-xs font-bold text-[#ED7C00]">{fmtN(grupoUnidades)} un.</span>
                        )}
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border flex-shrink-0 ${URGENCY_BADGE[grupoUrgency]}`}>
                          {URGENCY_LABEL[grupoUrgency]}
                        </span>
                      </button>

                      {/* Expanded: familia rows */}
                      {isExpanded && (
                        <div className="border-t border-[#32576F] divide-y divide-[#32576F]/40 bg-[#0F1E28]">
                          {visibleFamilias.map((familia) => {
                            const fk = familiaKey(familia);
                            const rec = recsByKey[fk];
                            const config = familiaConfigs[fk] ?? { tipo: 'basico', cobertura_objetivo: null, lead_time: null };
                            const cobertura = familia.promedio_diario_anual > 0
                              ? familia.stock_total / familia.promedio_diario_anual
                              : (familia.stock_total > 0 ? 9999 : 0);
                            const isMatrixOpen = expandedMatrices.has(fk);
                            const edits = matrixEdits[fk] ?? {};

                            return (
                              <div
                                key={fk}
                                className={
                                  rec?.urgency === 'critica' ? 'bg-red-500/5' :
                                  rec?.urgency === 'alta' ? 'bg-yellow-500/4' :
                                  rec?.urgency === 'media' ? 'bg-[#ED7C00]/3' : ''
                                }
                              >
                                {/* Familia info row */}
                                <div className="flex flex-wrap gap-3 items-start px-4 py-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-[#CDD4DA] font-medium text-sm">
                                        {familia.descripcion || <em className="text-[#7A9BAD] not-italic">Sin descripción</em>}
                                      </span>
                                      <AbcBadge cls={familia.clasificacion_abc} />
                                      <TemporadaBadge temporada={familia.temporada_detectada} fase={familia.fase_temporada} />
                                      {familia.proveedor_nombre && (
                                        <span className="text-[10px] text-[#7A9BAD] border border-[#32576F] rounded px-1.5 py-0.5">
                                          {familia.proveedor_nombre}
                                        </span>
                                      )}
                                    </div>
                                    {rec?.razon && (
                                      <p className="text-[10px] text-[#7A9BAD] mt-0.5 italic">{rec.razon}</p>
                                    )}
                                  </div>

                                  {/* Metric chips */}
                                  <div className="flex gap-4 flex-shrink-0 text-center">
                                    <div>
                                      <div className={`text-sm font-mono font-bold ${familia.stock_total === 0 ? 'text-red-400' : 'text-white'}`}>
                                        {fmtN(familia.stock_total)}
                                      </div>
                                      <div className="text-[10px] text-[#7A9BAD]">stock</div>
                                    </div>
                                    <div>
                                      <div className={`text-sm font-mono font-bold ${
                                        cobertura < 7 ? 'text-red-400' :
                                        cobertura < 30 ? 'text-yellow-400' :
                                        cobertura >= 9999 ? 'text-[#7A9BAD]' : 'text-green-400'
                                      }`}>
                                        {cobertura >= 9999 ? '—' : `${cobertura.toFixed(0)}d`}
                                      </div>
                                      <div className="text-[10px] text-[#7A9BAD]">cobertura</div>
                                    </div>
                                    <div>
                                      <div className="text-sm font-mono text-[#CDD4DA]">
                                        {familia.promedio_diario_anual.toFixed(2)}
                                      </div>
                                      <div className="text-[10px] text-[#7A9BAD]">u/día (12m)</div>
                                    </div>
                                    {rec?.debeComprar && rec.unidades > 0 && (
                                      <div>
                                        <div className="text-sm font-mono font-bold text-[#ED7C00]">
                                          {fmtN(rec.unidades)}
                                        </div>
                                        <div className="text-[10px] text-[#7A9BAD]">a comprar</div>
                                      </div>
                                    )}
                                  </div>

                                  {rec && (
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border self-center flex-shrink-0 ${URGENCY_BADGE[rec.urgency]}`}>
                                      {URGENCY_LABEL[rec.urgency]}
                                    </span>
                                  )}
                                </div>

                                {/* Config row */}
                                <div className="flex flex-wrap gap-3 items-center px-4 pb-3">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[#7A9BAD] text-xs">Tipo:</span>
                                    <select
                                      value={config.tipo}
                                      onChange={(e) => setFamiliaConfig(fk, { tipo: e.target.value as ProductTipo })}
                                      className="bg-[#1E3340] border border-[#32576F] rounded px-1.5 py-0.5 text-xs text-white focus:border-[#ED7C00] focus:outline-none"
                                    >
                                      <option value="basico">Básico</option>
                                      <option value="temporada">Temporada</option>
                                      <option value="quiebre">Quiebre</option>
                                    </select>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[#7A9BAD] text-xs">Obj.:</span>
                                    <input
                                      type="number" min="1" max="365"
                                      value={config.cobertura_objetivo ?? ''}
                                      placeholder={config.tipo === 'temporada' ? '90' : config.tipo === 'quiebre' ? '30' : '60'}
                                      onChange={(e) => setFamiliaConfig(fk, { cobertura_objetivo: parseInt(e.target.value) || null })}
                                      className="w-14 bg-[#1E3340] border border-[#32576F] rounded px-1.5 py-0.5 text-xs text-white text-center focus:border-[#ED7C00] focus:outline-none"
                                    />
                                    <span className="text-[#7A9BAD] text-xs">d</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[#7A9BAD] text-xs">Lead time:</span>
                                    <input
                                      type="number" min="0" max="365"
                                      value={config.lead_time ?? ''}
                                      placeholder={globalLeadTime > 0 ? `${globalLeadTime}` : '—'}
                                      onChange={(e) => setFamiliaConfig(fk, { lead_time: parseInt(e.target.value) || null })}
                                      className="w-14 bg-[#1E3340] border border-[#32576F] rounded px-1.5 py-0.5 text-xs text-white text-center focus:border-[#ED7C00] focus:outline-none"
                                    />
                                    <span className="text-[#7A9BAD] text-xs">d</span>
                                  </div>
                                  {familia.ventas_mensuales.length >= 3 && (
                                    <div className="w-28 opacity-70">
                                      <MiniChart data={familia.ventas_mensuales} />
                                    </div>
                                  )}
                                  {familia.talle_color_breakdown.length > 0 && (
                                    <button
                                      onClick={() => toggleMatrix(fk)}
                                      className={`ml-auto text-xs rounded-lg font-medium transition-colors border px-3 py-1 ${
                                        isMatrixOpen
                                          ? 'bg-[#ED7C00] text-white border-[#ED7C00]'
                                          : 'bg-[#132229] text-[#7A9BAD] hover:text-white border-[#32576F]'
                                      }`}
                                    >
                                      {isMatrixOpen ? 'Ocultar distribución' : `Distribución talle×color (${familia.talle_color_breakdown.length})`}
                                    </button>
                                  )}
                                </div>

                                {/* Talle × Color matrix */}
                                {isMatrixOpen && (
                                  <div className="px-4 pb-4 border-t border-[#32576F]/30 bg-[#0F1E28]">
                                    <div className="pt-3 mb-3">
                                      <p className="text-[#CDD4DA] text-sm font-semibold">
                                        {familia.descripcion || familia.nombre} — distribución talle × color
                                      </p>
                                      <p className="text-[#7A9BAD] text-xs mt-0.5">
                                        Ventas últimos 12m · cantidades editables · total recomendado: <strong className="text-[#ED7C00]">{fmtN(rec?.unidades ?? 0)} unidades</strong>
                                      </p>
                                    </div>
                                    <TalleColorMatrix
                                      familia={familia}
                                      unidadesTotal={rec?.unidades ?? 0}
                                      edits={edits}
                                      onEdit={(cellKey, val) => setEdit(fk, cellKey, val)}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[#7A9BAD]">
                <div className="bg-[#0F1E28] rounded-lg p-2.5">
                  <span className="text-white font-medium">Básico</span> — se vende todo el año. Reordena antes del punto de pedido (cobertura objetivo configurable, default 60d).
                </div>
                <div className="bg-[#0F1E28] rounded-lg p-2.5">
                  <span className="text-white font-medium">Temporada OI/PV</span> — auto-detectado. No genera recompra en post-temporada para evitar stock inmovilizado.
                </div>
                <div className="bg-[#0F1E28] rounded-lg p-2.5">
                  <span className="text-white font-medium">Quiebre</span> — repone solo al agotarse. Para oportunidad o baja rotación.
                </div>
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
                  {(['chart','table'] as const).map((v) => (
                    <button key={v} onClick={() => setAbcNombreView(v)} className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${abcNombreView === v ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'}`}>
                      {v === 'chart' ? 'Gráfico' : 'Tabla'}
                    </button>
                  ))}
                </div>
                {abcNombreView === 'table' && (
                  <div className="flex gap-1 ml-2">
                    {(['all','A','B','C'] as const).map((f) => (
                      <button key={f} onClick={() => { setAbcNombreFilter(f); setPageNombre(0); }} className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${abcNombreFilter === f ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'}`}>
                        {f === 'all' ? 'Todos' : `Clase ${f}`}
                      </button>
                    ))}
                  </div>
                )}
                <span className="text-xs text-[#7A9BAD] ml-auto">{data.abc_por_nombre.length} tipos</span>
              </div>
              {abcNombreView === 'chart' ? (
                <ResponsiveContainer width="100%" height={abcNombreChartData.length * 28 + 40}>
                  <BarChart data={abcNombreChartData} layout="vertical" margin={{ left: 10, right: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#32576F" horizontal={false} />
                    <XAxis type="number" stroke="#7A9BAD" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
                    <YAxis type="category" dataKey="nombre" stroke="#7A9BAD" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number, _n, p) => [`${v.toFixed(1)}% · ${p.payload.vendidas} uds · ${fmt(p.payload.monto)}`, `Clase ${p.payload.abc}`]} />
                    <Bar dataKey="contribucion" radius={[0, 3, 3, 0]}>
                      {abcNombreChartData.map((entry, idx) => <Cell key={idx} fill={ABC_COLORS[entry.abc as 'A' | 'B' | 'C']} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#32576F]">
                          {['ABC','Nombre','Stock total','Valor stock','Vendidas','Rotación','Cobertura','Contribución'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedNombre.map((p: AbcNombre, i) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                            <td className="py-2 px-3"><AbcBadge cls={p.clasificacion_abc as 'A'|'B'|'C'} /></td>
                            <td className="py-2 px-3 text-white font-semibold">{p.nombre}</td>
                            <td className="py-2 px-3 text-white font-mono">{fmtN(p.stock_total)}</td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono">{fmt(p.monto_stock)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{fmtN(p.unidades_vendidas)}</td>
                            <td className="py-2 px-3"><RotacionCell r={p.rotacion} /></td>
                            <td className="py-2 px-3 text-[#CDD4DA] text-xs">{p.cobertura_dias >= 9999 ? '—' : `${p.cobertura_dias.toFixed(0)}d`}</td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 bg-[#32576F] rounded-full w-12">
                                  <div className="h-1.5 rounded-full" style={{ width: `${Math.min(p.contribucion_pct * 3, 100)}%`, backgroundColor: ABC_COLORS[p.clasificacion_abc as 'A'|'B'|'C'] }} />
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
              title="ABC por descripción"
              subtitle="Variantes por nombre · descripción · talle · color"
              exportFileName={`stock_abc_desc_${tenantId}`}
            >
              <div className="flex gap-2 mb-4 flex-wrap items-center">
                <div className="flex gap-1">
                  {(['chart','table'] as const).map((v) => (
                    <button key={v} onClick={() => setAbcDescView(v)} className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${abcDescView === v ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'}`}>
                      {v === 'chart' ? 'Gráfico' : 'Tabla'}
                    </button>
                  ))}
                </div>
                {abcDescView === 'table' && (
                  <div className="flex gap-1 ml-2">
                    {(['all','A','B','C'] as const).map((f) => (
                      <button key={f} onClick={() => { setAbcDescFilter(f); setPageDesc(0); }} className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${abcDescFilter === f ? 'bg-[#ED7C00] text-white' : 'bg-[#132229] text-[#7A9BAD] hover:text-white border border-[#32576F]'}`}>
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
                    <YAxis type="category" dataKey="label" stroke="#7A9BAD" tick={{ fontSize: 9 }} width={150} tickFormatter={(v) => v.length > 22 ? v.slice(0,22)+'…' : v} />
                    <Tooltip contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8 }} formatter={(v: number, _n, p) => [`${v.toFixed(1)}% · ${p.payload.vendidas} uds · stock: ${p.payload.stock}`, `Clase ${p.payload.abc}`]} />
                    <Bar dataKey="contribucion" radius={[0,3,3,0]}>
                      {abcDescChartData.map((e, idx) => <Cell key={idx} fill={ABC_COLORS[e.abc as 'A'|'B'|'C']} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#32576F]">
                          {['ABC','Nombre','Descripción','Stock','Valor','Vendidas','Rotación','Contribución'].map((h) => (
                            <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedDesc.map((p: ProductoStock, i) => (
                          <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                            <td className="py-2 px-3"><AbcBadge cls={p.clasificacion_abc as 'A'|'B'|'C'} /></td>
                            <td className="py-2 px-3 text-white font-medium max-w-[100px] truncate">{p.nombre}</td>
                            <td className="py-2 px-3 text-[#CDD4DA] max-w-[100px] truncate">{p.descripcion || '—'}</td>
                            <td className="py-2 px-3 text-white font-mono">{fmtN(p.stock_actual)}</td>
                            <td className="py-2 px-3 text-[#ED7C00] font-mono text-xs">{fmt(p.monto_stock)}</td>
                            <td className="py-2 px-3 text-[#CDD4DA]">{fmtN(p.unidades_vendidas_periodo)}</td>
                            <td className="py-2 px-3"><RotacionCell r={p.rotacion} /></td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 bg-[#32576F] rounded-full w-12">
                                  <div className="h-1.5 rounded-full" style={{ width: `${Math.min(p.contribucion_pct * 3, 100)}%`, backgroundColor: ABC_COLORS[p.clasificacion_abc as 'A'|'B'|'C'] }} />
                                </div>
                                <span className="text-[#7A9BAD] text-xs">{p.contribucion_pct}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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

            <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
              <p className="text-[#7A9BAD] text-xs leading-relaxed">
                <strong className="text-[#CDD4DA]">Análisis ABC:</strong>{' '}
                <span className="text-[#ED7C00]">A</span> = 80% del revenue ·{' '}
                <span className="text-blue-400">B</span> = siguiente 15% ·{' '}
                <span className="text-gray-400">C</span> = últimos 5%.{' '}
                <strong className="text-[#CDD4DA]">Temporada</strong>: OI (Mar–Ago) o PV (Sep–Feb) se auto-detecta cuando un semestre supera el 60% de las ventas anuales del producto.{' '}
                <strong className="text-[#CDD4DA]">Lead time global</strong>: se usa en todos los productos sin lead time específico. El punto de pedido se calcula como lead time + 14 días de seguridad.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
