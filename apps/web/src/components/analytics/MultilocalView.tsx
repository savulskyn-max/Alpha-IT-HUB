'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type {
  CeldaHeatmap,
  MultilocalProducto,
  StockMultilocalResponse,
  TransferenciaMultilocal,
  MultilocalDetailResponse,
  TransferenciaDetallada,
  MultilocalDescripcionDetalle,
  MultilocalColorDetalle,
  CeldaHeatmapDetalle,
} from '@/lib/api';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary: '#32576F', dark: '#132229', muted: '#CDD4DA', white: '#FFFFFF',
  accent: '#ED7C00', bg: '#0f1e25', card: '#1a2f3a', border: '#243b4a',
  text: '#e8edf0', textMuted: '#8fa3b0',
};

const ESTADO_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  CRITICO:   { bg: '#7f1d1d', text: '#fca5a5', label: 'Crítico' },
  BAJO:      { bg: '#78350f', text: '#fde68a', label: 'Bajo' },
  OK:        { bg: '#14532d', text: '#86efac', label: 'OK' },
  EXCESO:    { bg: '#1e3a5f', text: '#93c5fd', label: 'Exceso' },
  SIN_STOCK: { bg: '#1a1a1a', text: '#6b7280', label: 'Sin stock' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const cobLabel = (d: number) => (d >= 999 ? '∞' : `${Math.round(d)}d`);
const fmtM = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

function CobBadge({ antes, despues }: { antes: number; despues: number }) {
  const bef = ESTADO_COLOR[antes < 15 ? 'CRITICO' : antes < 30 ? 'BAJO' : antes > 60 ? 'EXCESO' : 'OK'];
  const aft = ESTADO_COLOR[despues < 15 ? 'CRITICO' : despues < 30 ? 'BAJO' : despues > 60 ? 'EXCESO' : 'OK'];
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span style={{ color: bef.text }}>{cobLabel(antes)}</span>
      <span style={{ color: C.textMuted }}>→</span>
      <span style={{ color: aft.text }}>{cobLabel(despues)}</span>
    </span>
  );
}

// ── Heatmap cell (shared for top-level and detail) ──────────────────────────
function HeatCell({ estado, cob, stock, vel }: { estado: string; cob: number; stock: number; vel: number }) {
  const { bg, text } = ESTADO_COLOR[estado] ?? ESTADO_COLOR.SIN_STOCK;
  return (
    <div
      title={`Stock: ${stock} | Vel: ${vel.toFixed(2)}/d`}
      style={{ backgroundColor: bg, color: text, borderRadius: 4, padding: '4px 6px', textAlign: 'center', fontSize: 12, fontWeight: 600, minWidth: 56 }}
    >
      {cobLabel(cob)}
    </div>
  );
}

// ── Expanded detail rows (Desc+Color sub-rows) ─────────────────────────────
function ExpandedRows({ detail, locales }: { detail: MultilocalDetailResponse; locales: StockMultilocalResponse['locales'] }) {
  if (!detail.descripciones.length)
    return <tr><td colSpan={locales.length + 1} style={{ padding: 12, color: C.textMuted, fontSize: 12 }}>Sin detalle de descripciones.</td></tr>;

  return (
    <>
      {detail.descripciones.map(desc => (
        <React.Fragment key={desc.descripcion_id}>
          {/* Descripcion header row */}
          <tr style={{ backgroundColor: '#0d1a22' }}>
            <td style={{ paddingLeft: 28, padding: '4px 12px', color: C.text, fontSize: 12, fontWeight: 600, position: 'sticky', left: 0, backgroundColor: '#0d1a22', borderRight: `1px solid ${C.border}` }} colSpan={1}>
              {desc.descripcion}
            </td>
            {locales.map(l => {
              // Aggregate coverage across colors for this desc+local
              const totalStock = desc.colores.reduce((s, c) => s + (c.locales.find(cl => cl.local_id === l.local_id)?.stock ?? 0), 0);
              const totalVel = desc.colores.reduce((s, c) => s + (c.locales.find(cl => cl.local_id === l.local_id)?.velocidad_diaria ?? 0), 0);
              const cob = totalVel > 0 ? Math.round(totalStock / totalVel) : (totalStock > 0 ? 999 : 0);
              const estado = cob === 0 && totalStock === 0 ? 'SIN_STOCK' : cob < 15 ? 'CRITICO' : cob < 30 ? 'BAJO' : cob > 60 ? 'EXCESO' : 'OK';
              return (
                <td key={l.local_id} style={{ padding: '3px 6px', textAlign: 'center' }}>
                  <HeatCell estado={estado} cob={Math.min(cob, 999)} stock={totalStock} vel={totalVel} />
                </td>
              );
            })}
          </tr>
          {/* Color sub-rows */}
          {desc.colores.map(color => (
            <tr key={`${desc.descripcion_id}-${color.color_id}`} style={{ backgroundColor: '#0a1519' }}>
              <td style={{ paddingLeft: 44, padding: '3px 12px', color: C.textMuted, fontSize: 11, position: 'sticky', left: 0, backgroundColor: '#0a1519', borderRight: `1px solid ${C.border}` }}>
                {color.color}
              </td>
              {locales.map(l => {
                const celda = color.locales.find(cl => cl.local_id === l.local_id);
                return (
                  <td key={l.local_id} style={{ padding: '2px 6px', textAlign: 'center' }}>
                    {celda ? <HeatCell estado={celda.estado} cob={celda.cobertura_dias} stock={celda.stock} vel={celda.velocidad_diaria} /> : <span style={{ color: C.textMuted, fontSize: 11 }}>—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </React.Fragment>
      ))}
    </>
  );
}

// ── Heatmap table ─────────────────────────────────────────────────────────────
function HeatmapTable({ productos, locales, search, tenantId }: {
  productos: MultilocalProducto[];
  locales: StockMultilocalResponse['locales'];
  search: string;
  tenantId: string;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MultilocalDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const filtered = search ? productos.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase())) : productos;
  const localMap = (p: MultilocalProducto) => Object.fromEntries(p.locales.map(c => [c.local_id, c]));

  const toggleExpand = async (pnId: number) => {
    if (expandedId === pnId) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(pnId);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const res = await api.analytics.stockMultilocalDetail(tenantId, pnId);
      setDetail(res);
    } catch { setDetail(null); }
    finally { setLoadingDetail(false); }
  };

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ backgroundColor: C.dark, position: 'sticky', top: 0, zIndex: 2 }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: C.textMuted, fontWeight: 500, minWidth: 200, borderBottom: `1px solid ${C.border}`, position: 'sticky', left: 0, backgroundColor: C.dark }}>
              Producto
            </th>
            {locales.map(l => (
              <th key={l.local_id} style={{ textAlign: 'center', padding: '8px 8px', color: C.textMuted, fontWeight: 500, minWidth: 80, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                {l.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={locales.length + 1} style={{ textAlign: 'center', padding: 24, color: C.textMuted }}>Sin resultados</td></tr>
          )}
          {filtered.map((p, i) => {
            const cellMap = localMap(p);
            const isExp = expandedId === p.producto_nombre_id;
            return (
              <React.Fragment key={p.producto_nombre_id}>
                <tr
                  onClick={() => toggleExpand(p.producto_nombre_id)}
                  style={{ backgroundColor: i % 2 === 0 ? C.card : C.bg, cursor: 'pointer', transition: 'background 0.1s' }}
                >
                  <td style={{ padding: '6px 12px', color: C.text, fontWeight: 500, position: 'sticky', left: 0, backgroundColor: i % 2 === 0 ? C.card : C.bg, borderRight: `1px solid ${C.border}`, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" style={{ transition: 'transform 0.15s', transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
                        <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {p.nombre}
                    </span>
                  </td>
                  {locales.map(l => {
                    const celda = cellMap[l.local_id];
                    return (
                      <td key={l.local_id} style={{ padding: '4px 6px', textAlign: 'center' }}>
                        {celda ? <HeatCell estado={celda.estado} cob={celda.cobertura_dias} stock={celda.stock} vel={celda.velocidad_diaria} /> : <span style={{ color: C.textMuted, fontSize: 12 }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
                {isExp && (
                  loadingDetail ? (
                    <tr><td colSpan={locales.length + 1} style={{ padding: '8px 28px', color: C.textMuted, fontSize: 12 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 12, height: 12, border: `2px solid ${C.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                        Cargando detalle…
                      </span>
                    </td></tr>
                  ) : detail ? (
                    <ExpandedRows detail={detail} locales={locales} />
                  ) : (
                    <tr><td colSpan={locales.length + 1} style={{ padding: '8px 28px', color: C.textMuted, fontSize: 12 }}>Sin datos de detalle.</td></tr>
                  )
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Detailed Transfer Card ──────────────────────────────────────────────────
function TransferenciaDetalladaCard({ t }: { t: TransferenciaDetallada }) {
  const talleStr = t.talles.map(tl => `${tl.talle}×${tl.cantidad}`).join(', ');
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: 8, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Product desc + color */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{t.descripcion}</span>
        <span style={{ color: C.accent, fontSize: 13 }}>·</span>
        <span style={{ color: C.textMuted, fontSize: 13 }}>{t.color}</span>
        <span style={{ marginLeft: 'auto', backgroundColor: '#1a3020', color: '#86efac', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
          Ahorro {fmtM(t.ahorro_estimado)}
        </span>
      </div>

      {/* Origin → Destination */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 13, color: C.text }}>
          {t.origen_nombre}
          <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 6 }}>(cob. {cobLabel(t.cobertura_origen_antes)})</span>
        </div>
        <div style={{ color: C.accent, fontSize: 18, fontWeight: 700 }}>→</div>
        <div style={{ backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 13, color: C.text }}>
          {t.destino_nombre}
          <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 6 }}>(cob. {cobLabel(t.cobertura_destino_antes)})</span>
        </div>
      </div>

      {/* Transfer details */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: C.textMuted }}>
        <span>
          Transferir: <span style={{ color: C.text, fontWeight: 600 }}>{t.cantidad} pares</span>
          {talleStr && <span style={{ color: C.textMuted, marginLeft: 4 }}>({talleStr})</span>}
        </span>
      </div>

      {/* Post-transfer coverage */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: C.textMuted }}>
        <span>Origen: <CobBadge antes={t.cobertura_origen_antes} despues={t.cobertura_origen_despues} /></span>
        <span>Destino: <CobBadge antes={t.cobertura_destino_antes} despues={t.cobertura_destino_despues} /></span>
        {t.costo_unitario > 0 && <span>Costo unit. {fmtM(t.costo_unitario)}</span>}
      </div>
    </div>
  );
}

// ── Simple Transfer Card (top-level, before detail is loaded) ───────────────
function TransferenciaCard({ t }: { t: TransferenciaMultilocal }) {
  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, borderRadius: 8, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{t.nombre}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 13, color: C.text }}>{t.origen_nombre}</div>
        <div style={{ color: C.accent, fontSize: 18, fontWeight: 700 }}>→</div>
        <div style={{ backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 13, color: C.text }}>{t.destino_nombre}</div>
        <div style={{ marginLeft: 'auto', backgroundColor: '#1a3020', color: '#86efac', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
          Ahorro {fmtM(t.ahorro_estimado)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, color: C.textMuted }}>
        <span><span style={{ color: C.text, fontWeight: 600 }}>{t.cantidad} u.</span> a transferir</span>
        <span>Origen: <CobBadge antes={t.cobertura_origen_antes} despues={t.cobertura_origen_despues} /></span>
        <span>Destino: <CobBadge antes={t.cobertura_destino_antes} despues={t.cobertura_destino_despues} /></span>
      </div>
    </div>
  );
}

// ── Transfers tab with product-level expansion ─────────────────────────────
function TransferenciasTab({ transferencias, tenantId }: {
  transferencias: TransferenciaMultilocal[];
  tenantId: string;
}) {
  // Group top-level transfers by product for expansion
  const byProduct = transferencias.reduce<Record<number, TransferenciaMultilocal[]>>((acc, t) => {
    const key = t.producto_nombre_id;
    return { ...acc, [key]: [...(acc[key] ?? []), t] };
  }, {});

  const [expandedPnId, setExpandedPnId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MultilocalDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const toggleExpand = async (pnId: number) => {
    if (expandedPnId === pnId) { setExpandedPnId(null); setDetail(null); return; }
    setExpandedPnId(pnId);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const res = await api.analytics.stockMultilocalDetail(tenantId, pnId);
      setDetail(res);
    } catch { setDetail(null); }
    finally { setLoadingDetail(false); }
  };

  if (transferencias.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: C.textMuted, background: C.card, borderRadius: 10, border: `1px solid ${C.border}` }}>
        No hay transferencias sugeridas. El inventario está bien distribuido.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Object.entries(byProduct).map(([pnIdStr, topTransfers]) => {
        const pnId = Number(pnIdStr);
        const nombre = topTransfers[0].nombre;
        const totalAhorro = topTransfers.reduce((s, t) => s + t.ahorro_estimado, 0);
        const isExp = expandedPnId === pnId;
        const hasDetail = isExp && detail && detail.transferencias.length > 0;

        return (
          <div key={pnId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Product group header */}
            <button
              onClick={() => toggleExpand(pnId)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', width: '100%', textAlign: 'left' }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2" style={{ transition: 'transform 0.15s', transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{ color: C.text, fontWeight: 600, fontSize: 14, flex: 1 }}>{nombre}</span>
              <span style={{ color: C.textMuted, fontSize: 12 }}>{topTransfers.length} transferencias</span>
              <span style={{ backgroundColor: '#1a3020', color: '#86efac', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                Ahorro {fmtM(totalAhorro)}
              </span>
            </button>

            {/* Expanded: show detailed transfers or fallback to simple */}
            {isExp && (
              loadingDetail ? (
                <div style={{ padding: '8px 20px', color: C.textMuted, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, border: `2px solid ${C.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                  Cargando detalle…
                </div>
              ) : hasDetail ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 16 }}>
                  {detail!.transferencias.map((dt, i) => (
                    <TransferenciaDetalladaCard key={i} t={dt} />
                  ))}
                  {/* Demand distribution info */}
                  {detail!.demanda_por_local.length > 0 && (
                    <div style={{ fontSize: 11, color: C.textMuted, padding: '4px 8px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: C.text }}>Demanda por local:</span>
                      {detail!.demanda_por_local.map(d => (
                        <span key={d.local_id}>{d.local_nombre}: {d.demanda_diaria.toFixed(1)}/d</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 16 }}>
                  {topTransfers.map((t, i) => <TransferenciaCard key={i} t={t} />)}
                </div>
              )
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 12, color: C.textMuted }}>
        El ahorro estimado corresponde al ~15% del costo de reposición evitado mediante transferencia interna.
        Solo se sugieren transferencias que dejan al local origen con más de 15 días de cobertura.
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function StatusLegend() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {Object.entries(ESTADO_COLOR).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: val.bg, border: `1px solid ${val.text}33` }} />
          <span style={{ color: C.textMuted }}>{val.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── KPI chip ─────────────────────────────────────────────────────────────────
function KpiChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${accent ? C.accent + '55' : C.border}`, borderRadius: 8, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? C.accent : C.text }}>{value}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface MultilocalViewProps { tenantId: string; }

export default function MultilocalView({ tenantId }: MultilocalViewProps) {
  const [data, setData] = useState<StockMultilocalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'heatmap' | 'transferencias'>('heatmap');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const res = await api.analytics.stockMultilocal(tenantId);
      setData(res);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); return () => abortRef.current?.abort(); }, [load]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Cargando optimización multilocal…</div>;
  if (error) return (
    <div style={{ textAlign: 'center', padding: 40, color: '#fca5a5' }}>
      {error} <button onClick={load} style={{ marginLeft: 8, color: C.accent, background: 'none', border: 'none', cursor: 'pointer' }}>Reintentar</button>
    </div>
  );
  if (!data || data.locales.length < 2) return <div style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Se necesitan al menos 2 locales para el análisis multilocal.</div>;

  const { productos, locales, transferencias, total_ahorro_potencial } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, color: C.text }}>
      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiChip label="Locales" value={String(locales.length)} />
        <KpiChip label="Productos" value={String(productos.length)} />
        <KpiChip label="Transferencias sugeridas" value={String(transferencias.length)} accent />
        <KpiChip label="Ahorro potencial" value={fmtM(total_ahorro_potencial)} accent={total_ahorro_potencial > 0} />
      </div>

      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
        {(['heatmap', 'transferencias'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '7px 18px', fontSize: 13, fontWeight: 600, background: tab === t ? C.primary : 'transparent', color: tab === t ? C.white : C.textMuted, border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}>
            {t === 'heatmap' ? 'Mapa de cobertura' : `Transferencias (${transferencias.length})`}
          </button>
        ))}
      </div>

      {/* Heatmap tab */}
      {tab === 'heatmap' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <StatusLegend />
            <input type="text" placeholder="Buscar producto…" value={search} onChange={e => setSearch(e.target.value)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', color: C.text, fontSize: 13, outline: 'none', width: 200 }} />
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <HeatmapTable productos={productos} locales={locales} search={search} tenantId={tenantId} />
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            Click en un producto para ver el detalle por descripción y color. Cobertura = stock / velocidad de venta (últimos 90 días).
          </div>
        </div>
      )}

      {/* Transferencias tab */}
      {tab === 'transferencias' && (
        <TransferenciasTab transferencias={transferencias} tenantId={tenantId} />
      )}
    </div>
  );
}
