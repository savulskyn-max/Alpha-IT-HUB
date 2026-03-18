'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { analyticsApi } from '@/lib/api';
import type {
  CeldaHeatmap,
  MultilocalProducto,
  StockMultilocalResponse,
  TransferenciaMultilocal,
} from '@/lib/api';

// ── Palette ───────────────────────────────────────────────────────────────────
const COLORS = {
  primary: '#32576F',
  dark: '#132229',
  muted: '#CDD4DA',
  white: '#FFFFFF',
  accent: '#ED7C00',
  bg: '#0f1e25',
  card: '#1a2f3a',
  border: '#243b4a',
  text: '#e8edf0',
  textMuted: '#8fa3b0',
};

// ── Traffic-light palette ─────────────────────────────────────────────────────
const ESTADO_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  CRITICO:  { bg: '#7f1d1d', text: '#fca5a5', label: 'Crítico' },
  BAJO:     { bg: '#78350f', text: '#fde68a', label: 'Bajo' },
  OK:       { bg: '#14532d', text: '#86efac', label: 'OK' },
  EXCESO:   { bg: '#1e3a5f', text: '#93c5fd', label: 'Exceso' },
  SIN_STOCK:{ bg: '#1a1a1a', text: '#6b7280', label: 'Sin stock' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function coberturaLabel(dias: number) {
  if (dias >= 999) return '∞';
  return `${Math.round(dias)}d`;
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

// ── Heatmap cell ──────────────────────────────────────────────────────────────
function HeatCell({ celda }: { celda: CeldaHeatmap }) {
  const { bg, text } = ESTADO_COLOR[celda.estado] ?? ESTADO_COLOR.SIN_STOCK;
  return (
    <div
      title={`Stock: ${celda.stock} | Vel: ${celda.velocidad_diaria.toFixed(2)}/d`}
      style={{
        backgroundColor: bg,
        color: text,
        borderRadius: 4,
        padding: '4px 6px',
        textAlign: 'center',
        fontSize: 12,
        fontWeight: 600,
        minWidth: 56,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {coberturaLabel(celda.cobertura_dias)}
    </div>
  );
}

// ── Heatmap table ─────────────────────────────────────────────────────────────
function HeatmapTable({
  productos,
  locales,
  search,
}: {
  productos: MultilocalProducto[];
  locales: StockMultilocalResponse['locales'];
  search: string;
}) {
  const filtered = search
    ? productos.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase()))
    : productos;

  // Build a quick lookup: pn_id → local_id → celda
  const localMap = (p: MultilocalProducto) =>
    Object.fromEntries(p.locales.map(c => [c.local_id, c]));

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 420 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ backgroundColor: COLORS.dark, position: 'sticky', top: 0, zIndex: 1 }}>
            <th
              style={{
                textAlign: 'left',
                padding: '8px 12px',
                color: COLORS.textMuted,
                fontWeight: 500,
                minWidth: 180,
                borderBottom: `1px solid ${COLORS.border}`,
                position: 'sticky',
                left: 0,
                backgroundColor: COLORS.dark,
              }}
            >
              Producto
            </th>
            {locales.map(l => (
              <th
                key={l.local_id}
                style={{
                  textAlign: 'center',
                  padding: '8px 8px',
                  color: COLORS.textMuted,
                  fontWeight: 500,
                  minWidth: 80,
                  borderBottom: `1px solid ${COLORS.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {l.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td
                colSpan={locales.length + 1}
                style={{ textAlign: 'center', padding: 24, color: COLORS.textMuted }}
              >
                Sin resultados
              </td>
            </tr>
          )}
          {filtered.map((p, i) => {
            const cellMap = localMap(p);
            return (
              <tr
                key={p.producto_nombre_id}
                style={{ backgroundColor: i % 2 === 0 ? COLORS.card : COLORS.bg }}
              >
                <td
                  style={{
                    padding: '6px 12px',
                    color: COLORS.text,
                    fontWeight: 500,
                    position: 'sticky',
                    left: 0,
                    backgroundColor: i % 2 === 0 ? COLORS.card : COLORS.bg,
                    borderRight: `1px solid ${COLORS.border}`,
                    maxWidth: 220,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.nombre}
                </td>
                {locales.map(l => {
                  const celda = cellMap[l.local_id];
                  return (
                    <td key={l.local_id} style={{ padding: '4px 6px', textAlign: 'center' }}>
                      {celda ? (
                        <HeatCell celda={celda} />
                      ) : (
                        <span style={{ color: COLORS.textMuted, fontSize: 12 }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Cobertura arrow badge ─────────────────────────────────────────────────────
function CobBadge({ antes, despues }: { antes: number; despues: number }) {
  const bef = ESTADO_COLOR[antes < 15 ? 'CRITICO' : antes < 30 ? 'BAJO' : antes > 60 ? 'EXCESO' : 'OK'];
  const aft = ESTADO_COLOR[despues < 15 ? 'CRITICO' : despues < 30 ? 'BAJO' : despues > 60 ? 'EXCESO' : 'OK'];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
      <span style={{ color: bef.text }}>{coberturaLabel(antes)}</span>
      <span style={{ color: COLORS.textMuted }}>→</span>
      <span style={{ color: aft.text }}>{coberturaLabel(despues)}</span>
    </span>
  );
}

// ── Transfer card ─────────────────────────────────────────────────────────────
function TransferenciaCard({ t }: { t: TransferenciaMultilocal }) {
  return (
    <div
      style={{
        backgroundColor: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderLeft: `3px solid ${COLORS.accent}`,
        borderRadius: 8,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Product name */}
      <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 14 }}>{t.nombre}</div>

      {/* Origin → Destination */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div
          style={{
            backgroundColor: COLORS.bg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 13,
            color: COLORS.text,
          }}
        >
          {t.origen_nombre}
        </div>
        <div style={{ color: COLORS.accent, fontSize: 18, fontWeight: 700 }}>→</div>
        <div
          style={{
            backgroundColor: COLORS.bg,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 13,
            color: COLORS.text,
          }}
        >
          {t.destino_nombre}
        </div>
        <div
          style={{
            marginLeft: 'auto',
            backgroundColor: '#1a3020',
            color: '#86efac',
            borderRadius: 6,
            padding: '3px 10px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Ahorro {formatMoney(t.ahorro_estimado)}
        </div>
      </div>

      {/* Details row */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, color: COLORS.textMuted }}>
        <span>
          <span style={{ color: COLORS.text, fontWeight: 600 }}>{t.cantidad} u.</span> a transferir
        </span>
        <span>
          Origen:{' '}
          <CobBadge antes={t.cobertura_origen_antes} despues={t.cobertura_origen_despues} />
        </span>
        <span>
          Destino:{' '}
          <CobBadge antes={t.cobertura_destino_antes} despues={t.cobertura_destino_despues} />
        </span>
        {t.costo_unitario > 0 && (
          <span>Costo unit. {formatMoney(t.costo_unitario)}</span>
        )}
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {Object.entries(ESTADO_COLOR).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              backgroundColor: val.bg,
              border: `1px solid ${val.text}33`,
            }}
          />
          <span style={{ color: COLORS.textMuted }}>{val.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface MultilocalViewProps {
  tenantId: string;
}

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
      const res = await analyticsApi.stockMultilocal(tenantId);
      setData(res);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: COLORS.textMuted }}>
        Cargando optimización multilocal…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#fca5a5' }}>
        {error}{' '}
        <button
          onClick={load}
          style={{ marginLeft: 8, color: COLORS.accent, background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!data || data.locales.length < 2) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: COLORS.textMuted }}>
        Se necesitan al menos 2 locales para el análisis multilocal.
      </div>
    );
  }

  const { productos, locales, transferencias, total_ahorro_potencial } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, color: COLORS.text }}>

      {/* ── Summary KPIs ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiChip label="Locales" value={String(locales.length)} />
        <KpiChip label="Productos" value={String(productos.length)} />
        <KpiChip label="Transferencias sugeridas" value={String(transferencias.length)} accent />
        <KpiChip
          label="Ahorro potencial"
          value={formatMoney(total_ahorro_potencial)}
          accent={total_ahorro_potencial > 0}
        />
      </div>

      {/* ── Tab selector ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
        {(['heatmap', 'transferencias'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '7px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: tab === t ? COLORS.primary : 'transparent',
              color: tab === t ? COLORS.white : COLORS.textMuted,
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {t === 'heatmap' ? 'Mapa de cobertura' : `Transferencias (${transferencias.length})`}
          </button>
        ))}
      </div>

      {/* ── Heatmap tab ───────────────────────────────────────────────────── */}
      {tab === 'heatmap' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <Legend />
            <input
              type="text"
              placeholder="Buscar producto…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 6,
                padding: '6px 12px',
                color: COLORS.text,
                fontSize: 13,
                outline: 'none',
                width: 200,
              }}
            />
          </div>
          <div
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <HeatmapTable productos={productos} locales={locales} search={search} />
          </div>
          <div style={{ fontSize: 12, color: COLORS.textMuted }}>
            Cobertura = stock / velocidad de venta (últimos 90 días). Umbral crítico &lt;15d, bajo &lt;30d, exceso &gt;60d.
          </div>
        </div>
      )}

      {/* ── Transferencias tab ────────────────────────────────────────────── */}
      {tab === 'transferencias' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {transferencias.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 40,
                color: COLORS.textMuted,
                background: COLORS.card,
                borderRadius: 10,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              No hay transferencias sugeridas. El inventario está bien distribuido.
            </div>
          ) : (
            transferencias.map((t, i) => <TransferenciaCard key={i} t={t} />)
          )}
          {transferencias.length > 0 && (
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>
              El ahorro estimado corresponde al ~15% del costo de reposición evitado mediante transferencia interna.
              Solo se sugieren transferencias que dejan al local origen con más de 15 días de cobertura.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── KPI chip ──────────────────────────────────────────────────────────────────
function KpiChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${accent ? COLORS.accent + '55' : COLORS.border}`,
        borderRadius: 8,
        padding: '8px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? COLORS.accent : COLORS.text }}>
        {value}
      </div>
    </div>
  );
}
