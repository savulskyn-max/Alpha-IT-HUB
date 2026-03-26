'use client';

import { useEffect, useState } from 'react';
import { api, type ColorDetalle, type StockModelDetailResponse, type StockModeloDescripcion, type StockModelsRankingResponse } from '@/lib/api';
import { useCart, type CartTalle } from './CartContext';

interface Props { tenantId: string; productoNombreId: number; nombre?: string; localId?: number; horizonte?: number; }

const fmtN = (n: number) => n.toLocaleString('es-AR');
const fmtM = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${fmtN(n)}`;

const ESTADO_CLS: Record<string, { border: string; text: string; dot: string }> = {
  REPONER:          { border: 'border-red-500/30 bg-red-500/10',       text: 'text-red-400',    dot: 'bg-red-400' },
  REVISAR:          { border: 'border-yellow-500/30 bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  'SIN MOVIMIENTO': { border: 'border-[#32576F]/30 bg-[#1E3340]',      text: 'text-[#7A9BAD]',  dot: 'bg-[#4A7A96]' },
  OK:               { border: 'border-green-500/30 bg-green-500/10',   text: 'text-green-400',  dot: 'bg-green-400' },
};

function ColorRow({ c, onAddToCart }: { c: ColorDetalle; onAddToCart?: () => void }) {
  const s = ESTADO_CLS[c.estado] ?? ESTADO_CLS.OK;
  const needsAction = c.estado === 'REPONER' || c.estado === 'REVISAR';
  const prioridades = c.talles.filter(t => t.prioridad);
  return (
    <div className={`rounded-lg border px-3 py-2 space-y-2 ${s.border}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
        <span className={`text-xs font-medium flex-1 ${s.text}`}>{c.color}</span>
        <span className="text-[10px] text-[#7A9BAD]">{c.pctDemanda.toFixed(0)}% dem.</span>
        <span className="text-[10px] text-[#CDD4DA] font-mono">{fmtN(c.stockTotal)} u.</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/20 ${s.text}`}>{c.estado}</span>
        {needsAction && (
          <button
            onClick={e => { e.stopPropagation(); onAddToCart?.(); }}
            className="text-[10px] border border-[#ED7C00]/50 text-[#ED7C00] px-2 py-0.5 rounded hover:bg-[#ED7C00]/10 transition-colors whitespace-nowrap"
          >
            + Carrito
          </button>
        )}
      </div>
      {needsAction && c.talles.length > 0 && (
        <div className="space-y-1 pl-4">
          {c.talles.map(t => (
            <div key={t.talle} className="flex items-center gap-2">
              <span className={`text-[10px] w-7 flex-shrink-0 font-mono ${t.prioridad ? 'text-red-400 font-bold' : 'text-[#7A9BAD]'}`}>{t.talle}</span>
              <div className="flex-1 bg-[#0B1921] rounded-full h-2 overflow-hidden">
                <div className={`h-full rounded-full ${t.prioridad ? 'bg-red-500' : 'bg-[#4A7A96]'}`} style={{ width: `${Math.min(t.pctDemanda, 100)}%` }} />
              </div>
              <span className="text-[10px] text-[#7A9BAD] w-8 text-right">{t.pctDemanda.toFixed(0)}%</span>
              {t.stock === 0 && <span className="text-[10px] text-red-400 font-bold">★</span>}
            </div>
          ))}
          {prioridades.length > 0 && (
            <p className="text-[10px] text-[#7A9BAD] pt-1">ℹ Priorizar talles {prioridades.map(t => t.talle).join(', ')}. Considerar gama completa.</p>
          )}
        </div>
      )}
      {needsAction && c.demandaPorLocal.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-4 text-[10px] text-[#7A9BAD]">
          {c.demandaPorLocal.map(l => <span key={l.local}>{l.local}: {l.pctDemanda.toFixed(0)}% · {l.unidadesMes.toFixed(1)} u/mes</span>)}
        </div>
      )}
    </div>
  );
}

function ExpandedDetail({ tenantId, productoNombreId, nombre, descripcionId, descripcion, localId }: {
  tenantId: string; productoNombreId: number; nombre: string; descripcionId: number; descripcion: string; localId?: number;
}) {
  const [detail, setDetail] = useState<StockModelDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { addItem } = useCart();

  useEffect(() => {
    let cancelled = false;
    api.analytics.stockModelDetail(tenantId, productoNombreId, descripcionId, localId)
      .then(r => { if (!cancelled) setDetail(r); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, productoNombreId, descripcionId, localId]);

  const handleAddToCart = async (c: ColorDetalle) => {
    const [prov, precioRes, tallesRes] = await Promise.all([
      api.analytics.proveedorProducto(tenantId, productoNombreId, descripcionId).catch(() => null),
      api.analytics.precioCompra(tenantId, productoNombreId, descripcionId, c.colorId).catch(() => ({ precio_compra: null })),
      api.analytics.tallesProducto(tenantId, productoNombreId, descripcionId, c.colorId).catch(() => ({ talles: [] })),
    ]);
    const precioReal = precioRes.precio_compra ?? prov?.precioCompraPromedio ?? 0;
    const allTalles = tallesRes.talles.length > 0 ? tallesRes.talles : c.talles.map(t => ({ id: 0, talle: t.talle }));
    const demandMap = new Map(c.talles.map(t => [t.talle, t.pctDemanda]));
    const monthlyDemand = c.vendidas90d > 0 ? Math.ceil(c.vendidas90d / 3) : allTalles.length;
    const totalPct = c.talles.reduce((s, t) => s + t.pctDemanda, 0);
    const uniform = totalPct <= 0;
    const fechaDefault = new Date();
    fechaDefault.setDate(fechaDefault.getDate() + 7);
    const talles: CartTalle[] = allTalles.map(t => {
      const pct = demandMap.get(t.talle) ?? 0;
      const share = uniform ? 1 / allTalles.length : (pct / totalPct);
      return {
        talleId: t.id || null,
        talle: t.talle,
        pctDemanda: pct,
        cantidad: Math.max(1, Math.round(monthlyDemand * share)),
      };
    });
    addItem({
      id: `${descripcionId}-${c.colorId}`,
      productoNombreId, nombre, descripcionId, descripcion,
      colorId: c.colorId, color: c.color, talles,
      precioUnitario: precioReal,
      precioManual: precioReal === 0,
      proveedorId: prov?.proveedorId ?? null,
      proveedor: prov?.nombre ?? null,
      fechaPlanificada: fechaDefault.toISOString().split('T')[0],
    });
  };

  if (loading) return (
    <div className="flex items-center gap-2 py-3 px-3 text-[#7A9BAD] text-xs">
      <div className="w-4 h-4 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />Cargando detalle...
    </div>
  );
  if (!detail || !detail.colores.length) return <p className="text-[#7A9BAD] text-xs py-3 px-3">Sin datos de colores.</p>;
  return <div className="space-y-1.5 py-2 px-3">{detail.colores.map(c => <ColorRow key={c.colorId} c={c} onAddToCart={() => handleAddToCart(c)} />)}</div>;
}

// ── Velocity chart ────────────────────────────────────────────────────────────

const ESTADO_COLOR: Record<string, string> = {
  COMPRAR:      '#EF4444',
  REVISAR:      '#EAB308',
  OK:           '#22C55E',
  EXCESO:       '#3B82F6',
  STOCK_MUERTO: '#A78BFA',
  LIQUIDACION:  '#FBBF24',
};

function ModelsVelocityChart({ modelos }: { modelos: StockModeloDescripcion[] }) {
  const maxVel = Math.max(...modelos.map(m => m.velocidadSalida), 0.01);
  return (
    <div className="mb-3 space-y-1 overflow-y-auto" style={{ maxHeight: 200 }}>
      {modelos.map(m => {
        const pct = (m.velocidadSalida / maxVel) * 100;
        const color = ESTADO_COLOR[m.estado] ?? '#4A7A96';
        return (
          <div key={m.descripcionId} className="flex items-center gap-2">
            <div className="w-28 flex-shrink-0 text-[10px] text-[#CDD4DA] truncate" title={m.descripcion}>
              {m.descripcion}
            </div>
            <div className="flex-1 relative h-5 bg-[#0B1921] rounded overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded"
                style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: `${color}33`, borderRight: `2px solid ${color}` }}
              />
              <div className="absolute inset-0 flex items-center px-2 gap-1">
                <span className="text-[10px] font-mono font-semibold" style={{ color }}>
                  {m.velocidadSalida.toFixed(2)}/d
                </span>
                <span className="text-[10px] text-[#7A9BAD] ml-auto whitespace-nowrap">
                  {fmtN(m.stockTotal)} u · {m.coberturaDias >= 999 ? '∞' : `${Math.round(m.coberturaDias)}d`}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Model Row ─────────────────────────────────────────────────────────────────

function ModelRow({ m, tenantId, productoNombreId, nombre, localId, isExp, onToggle }: {
  m: StockModeloDescripcion; tenantId: string; productoNombreId: number; nombre: string; localId?: number; isExp: boolean; onToggle: () => void;
}) {
  return (
    <div>
      <div onClick={onToggle} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isExp ? 'bg-[#132229]' : 'hover:bg-[#132229]/60'}`}>
        <svg className={`w-3 h-3 flex-shrink-0 text-[#7A9BAD] transition-transform ${isExp ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-white text-xs font-medium flex-1 min-w-0 truncate">{m.descripcion}</span>
        <span className="text-[#7A9BAD] text-[10px] font-mono whitespace-nowrap">{m.velocidadSalida.toFixed(2)}/d</span>
        <span className="text-[#CDD4DA] text-[10px] font-mono whitespace-nowrap w-12 text-right">{fmtN(m.stockTotal)} u.</span>
        <div className="w-12 text-right">
          <span className={`font-mono text-xs font-semibold ${m.coberturaDias < 15 ? 'text-red-400' : m.coberturaDias <= 60 ? 'text-green-400' : 'text-blue-400'}`}>
            {m.coberturaDias >= 999 ? '∞d' : `${Math.round(m.coberturaDias)}d`}
          </span>
        </div>
        <div className="flex-shrink-0">
          {m.estado === 'COMPRAR' ? (
            <div className="text-right">
              <span className="inline-flex items-center gap-1 bg-red-500/15 border border-red-500/40 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">COMPRAR {fmtN(m.unidadesSugeridas)}</span>
              <div className="text-[9px] text-[#7A9BAD] mt-0.5 whitespace-nowrap">{fmtM(m.inversionSugerida)} · {Math.round(m.coberturaPostCompra)}d post</div>
            </div>
          ) : m.estado === 'EXCESO' ? (
            <span className="inline-flex items-center bg-blue-500/15 border border-blue-500/40 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full">EXCESO</span>
          ) : m.estado === 'REVISAR' ? (
            <span className="inline-flex items-center bg-yellow-500/15 border border-yellow-500/40 text-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded-full">REVISAR</span>
          ) : (
            <span className="inline-flex items-center bg-green-500/15 border border-green-500/40 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full">OK</span>
          )}
        </div>
      </div>
      {m.alertaColor && (
        <div className="flex items-start gap-1.5 px-8 py-1 text-[10px] text-yellow-400">
          <span>⚠</span><span>{m.alertaColor}</span>
        </div>
      )}
      {isExp && (
        <div className="mx-3 mb-1 bg-[#0B1921] border border-[#32576F]/50 rounded-lg overflow-hidden">
          <ExpandedDetail tenantId={tenantId} productoNombreId={productoNombreId} nombre={nombre} descripcionId={m.descripcionId} descripcion={m.descripcion} localId={localId} />
        </div>
      )}
    </div>
  );
}


export default function ModelBreakdown({ tenantId, productoNombreId, nombre, localId, horizonte = 60 }: Props) {
  const [data, setData] = useState<StockModelsRankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setData(null); setExpandedId(null);
    api.analytics.stockModelsRanking(tenantId, productoNombreId, horizonte, localId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, productoNombreId, localId, horizonte]);

  const totalInv = data ? data.modelos.reduce((s, m) => s + m.inversionSugerida, 0) : 0;
  const comprar = data ? data.modelos.filter(m => m.estado === 'COMPRAR') : [];
  const avgCob = comprar.length ? comprar.reduce((s, m) => s + m.coberturaPostCompra, 0) / comprar.length : 0;
  // Total stock value for capital split chart (units × avg cost)
  return (
    <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
      <p className="text-white text-xs font-semibold mb-3">Modelos — ranking por velocidad de salida</p>
      {loading && <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" /></div>}
      {!loading && !data && <p className="text-[#7A9BAD] text-xs text-center py-8">Sin datos</p>}
      {!loading && data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 bg-[#1A2F3E] border border-[#ED7C00]/30 rounded-lg text-xs text-[#CDD4DA]">
            <span className="font-semibold text-[#ED7C00]">Distribución de compra</span>
            <span>~{fmtN(data.recomendacionTotal)} un.</span>
            <span className="text-[#32576F]">│</span><span>Inversión: {fmtM(totalInv)}</span>
            <span className="text-[#32576F]">│</span><span>Cobertura post: {Math.round(avgCob)}d</span>
          </div>
          {/* Velocity chart — visual overview before list */}
          <ModelsVelocityChart modelos={data.modelos} />
          <div className="space-y-1">
            {data.modelos.map(m => (
              <ModelRow key={m.descripcionId} m={m} tenantId={tenantId} productoNombreId={productoNombreId} nombre={nombre ?? ''} localId={localId}
                isExp={expandedId === m.descripcionId} onToggle={() => setExpandedId(expandedId === m.descripcionId ? null : m.descripcionId)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
