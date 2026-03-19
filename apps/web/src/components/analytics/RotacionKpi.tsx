'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type RotacionLocal,
  type RotacionMesResponse,
  type RotacionNombre,
  type RotacionDescripcion,
} from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtN(n: number) {
  return new Intl.NumberFormat('es-AR').format(n);
}
function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

function rotColor(anualizada: number): string {
  if (anualizada >= 6) return 'text-green-400';
  if (anualizada >= 3) return 'text-yellow-400';
  return 'text-red-400';
}

function rotBg(anualizada: number): string {
  if (anualizada >= 6) return '#15803D';
  if (anualizada >= 3) return '#D97706';
  return '#DC2626';
}

function RotBadge({ rot, annual }: { rot: number; annual: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-mono font-semibold px-1.5 py-0.5 rounded"
      style={{ background: `${rotBg(annual)}20`, color: rotBg(annual), border: `1px solid ${rotBg(annual)}44` }}
    >
      {rot.toFixed(2)}x
    </span>
  );
}

function Spinner() {
  return (
    <span className="w-4 h-4 border-2 border-[#32576F] border-t-[#ED7C00] rounded-full animate-spin inline-block" />
  );
}

// ── Level 3: Descripciones ────────────────────────────────────────────────────

function DescripcionesPanel({
  tenantId, productoNombreId, localId,
}: { tenantId: string; productoNombreId: number; localId?: number }) {
  const [data, setData] = useState<RotacionDescripcion[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.analytics.rotacionDescripciones(tenantId, productoNombreId, localId)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [tenantId, productoNombreId, localId]);

  if (loading) return <tr><td colSpan={5} className="py-3 pl-20 text-[#7A9BAD]"><Spinner /></td></tr>;
  if (!data?.length) return <tr><td colSpan={5} className="py-3 pl-20 text-[#7A9BAD] text-xs">Sin modelos.</td></tr>;

  return (
    <>
      {data.map((d, i) => (
        <tr key={i} className="border-b border-[#1A2E3A]/60 last:border-0 bg-[#0C1B24]">
          <td className="pl-20 pr-3 py-2 text-xs text-[#CDD4DA]">{d.descripcion}</td>
          <td className="px-3 py-2 text-xs text-right">
            <RotBadge rot={d.rotacion_mes} annual={d.rotacion_anualizada} />
          </td>
          <td className="px-3 py-2 text-xs text-right">
            <span className={`font-mono text-xs ${rotColor(d.rotacion_anualizada)}`}>
              {d.rotacion_anualizada.toFixed(1)}x/año
            </span>
          </td>
          <td className="px-3 py-2 text-xs text-right text-[#CDD4DA] font-mono">{fmtN(d.stock_actual)}</td>
          <td className="px-3 py-2 text-xs text-right">
            {d.edad_promedio_dias != null ? (
              <span className={d.edad_promedio_dias > 90 ? 'text-red-400 font-mono text-xs' : 'text-[#7A9BAD] font-mono text-xs'}>
                {Math.round(d.edad_promedio_dias)}d
              </span>
            ) : <span className="text-[#7A9BAD]">—</span>}
          </td>
        </tr>
      ))}
    </>
  );
}

// ── Level 2: Nombres por local ────────────────────────────────────────────────

function NombresPanel({
  tenantId, localId,
}: { tenantId: string; localId?: number }) {
  const [data, setData] = useState<RotacionNombre[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setExpandedId(null);
    api.analytics.rotacionNombres(tenantId, localId)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [tenantId, localId]);

  if (loading) return (
    <tr><td colSpan={6} className="py-4 pl-12 text-[#7A9BAD]"><Spinner /></td></tr>
  );
  if (!data?.length) return (
    <tr><td colSpan={6} className="py-3 pl-12 text-[#7A9BAD] text-xs">Sin datos de productos.</td></tr>
  );

  return (
    <>
      {data.map((n) => (
        <>
          <tr
            key={n.producto_nombre_id}
            className="border-b border-[#1E3340]/80 hover:bg-[#0E1F29] transition-colors cursor-pointer"
            onClick={() => setExpandedId(prev => prev === n.producto_nombre_id ? null : n.producto_nombre_id)}
          >
            <td className="pl-12 pr-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs text-[#7A9BAD] transition-transform duration-150 ${expandedId === n.producto_nombre_id ? 'rotate-90' : ''}`}>▶</span>
                <span className="text-xs text-white font-medium">{n.nombre}</span>
              </div>
            </td>
            <td className="px-3 py-2 text-xs text-right">
              <RotBadge rot={n.rotacion_mes} annual={n.rotacion_anualizada} />
            </td>
            <td className="px-3 py-2 text-xs text-right">
              <span className={`font-mono text-xs ${rotColor(n.rotacion_anualizada)}`}>
                {n.rotacion_anualizada.toFixed(1)}x/año
              </span>
            </td>
            <td className="px-3 py-2 text-xs text-right text-[#ED7C00] font-mono">{fmt(n.monto_stock)}</td>
            <td className="px-3 py-2 text-xs text-right text-[#CDD4DA] font-mono">{fmtN(n.vendido_mes)}</td>
            <td className="px-3 py-2 text-xs text-right">
              {n.edad_promedio_dias != null ? (
                <span className={n.edad_promedio_dias > 90 ? 'text-red-400 font-mono text-xs' : 'text-[#7A9BAD] font-mono text-xs'}>
                  {Math.round(n.edad_promedio_dias)}d
                </span>
              ) : <span className="text-[#7A9BAD]">—</span>}
            </td>
          </tr>
          {expandedId === n.producto_nombre_id && (
            <DescripcionesPanel
              tenantId={tenantId}
              productoNombreId={n.producto_nombre_id}
              localId={localId}
            />
          )}
        </>
      ))}
    </>
  );
}

// ── Level 1: Panel de locales ─────────────────────────────────────────────────

function LocalesPanel({
  tenantId, locales,
}: { tenantId: string; locales: RotacionLocal[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="overflow-x-auto rounded-xl border border-[#1E3340] mt-4">
      <table className="w-full text-left text-sm" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        <thead>
          <tr className="bg-[#0E1F29] border-b border-[#32576F]">
            <th className="px-4 py-2.5 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide">Local / Producto</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Rotación mes</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Anualizada</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Stock $</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Vendido</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Edad prom.</th>
          </tr>
        </thead>
        <tbody className="bg-[#132229]">
          {locales.map((l) => (
            <>
              <tr
                key={l.local_id}
                className="border-b border-[#1E3340] hover:bg-[#1A2E3A] transition-colors cursor-pointer"
                onClick={() => setExpandedId(prev => prev === l.local_id ? null : l.local_id)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs text-[#7A9BAD] transition-transform duration-150 ${expandedId === l.local_id ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-sm text-white font-semibold">{l.local_nombre}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <RotBadge rot={l.rotacion_mes} annual={l.rotacion_anualizada} />
                </td>
                <td className={`px-3 py-3 text-sm text-right font-mono font-semibold ${rotColor(l.rotacion_anualizada)}`}>
                  {l.rotacion_anualizada.toFixed(1)}x/año
                </td>
                <td className="px-3 py-3 text-sm text-right text-[#ED7C00] font-mono">{fmt(l.monto_stock)}</td>
                <td className="px-3 py-3 text-sm text-right text-[#CDD4DA] font-mono">{fmtN(l.vendido_mes)}</td>
                <td className="px-3 py-3 text-sm text-right text-[#7A9BAD]">—</td>
              </tr>
              {expandedId === l.local_id && (
                <>
                  <tr className="bg-[#0E1F29]">
                    <td colSpan={6} className="px-4 py-1.5">
                      <span className="text-[10px] text-[#7A9BAD] uppercase tracking-widest">
                        Productos · {l.local_nombre}
                      </span>
                    </td>
                  </tr>
                  <NombresPanel tenantId={tenantId} localId={l.local_id} />
                </>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main KPI Card ─────────────────────────────────────────────────────────────

interface Props {
  tenantId: string;
  localId?: number;
}

export function RotacionKpi({ tenantId, localId }: Props) {
  const [data, setData] = useState<RotacionMesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.analytics.rotacion(tenantId, localId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [tenantId, localId]);

  useEffect(() => { load(); }, [load]);

  const annual = data?.rotacion_anualizada ?? 0;
  const color = loading || !data ? 'text-[#7A9BAD]' : rotColor(annual);

  return (
    <>
      {/* ── KPI card ──────────────────────────────────────────────────────── */}
      <div
        className="bg-[#132229] border border-[#32576F] rounded-xl p-4 cursor-pointer hover:bg-[#1E3340] transition-colors"
        onClick={() => !loading && data && setOpen(o => !o)}
      >
        <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">
          {loading ? 'Rotación mensual' : `Rotación · ${data?.mes_label ?? '—'}`}
        </p>
        <p className={`font-bold text-xl ${color}`}>
          {loading ? '…' : data ? `${data.rotacion_mes.toFixed(2)}x` : '—'}
        </p>
        <p className="text-[#7A9BAD] text-xs mt-0.5">
          {loading ? 'cargando…' : data
            ? `Anualizada: ${data.rotacion_anualizada.toFixed(1)}x · click para desagregar`
            : 'Sin datos'}
        </p>
      </div>

      {/* ── Drilldown panel ───────────────────────────────────────────────── */}
      {open && data && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
          style={{ background: 'rgba(11,25,33,0.85)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full max-w-4xl max-h-[80vh] overflow-y-auto rounded-2xl border border-[#32576F] shadow-2xl"
            style={{ background: '#132229' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#32576F] sticky top-0 bg-[#132229] z-10">
              <div>
                <h2 className="text-white font-semibold text-base">
                  Rotación de inventario · {data.mes_label}
                </h2>
                <p className="text-[#7A9BAD] text-xs mt-0.5">
                  Click en local → productos · Click en producto → modelos · Edad alta + rotación baja = candidatos a liquidar
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[#7A9BAD] hover:text-white transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Global summary chips */}
            <div className="px-6 py-4 flex flex-wrap gap-3 border-b border-[#32576F]">
              <div className="flex items-center gap-2 bg-[#0E1F29] rounded-lg px-3 py-2">
                <span className="text-[#7A9BAD] text-xs">Rotación mes</span>
                <span className={`font-bold text-sm font-mono ${color}`}>{data.rotacion_mes.toFixed(2)}x</span>
              </div>
              <div className="flex items-center gap-2 bg-[#0E1F29] rounded-lg px-3 py-2">
                <span className="text-[#7A9BAD] text-xs">Anualizada</span>
                <span className={`font-bold text-sm font-mono ${color}`}>{data.rotacion_anualizada.toFixed(1)}x</span>
              </div>
              <div className="flex items-center gap-2 bg-[#0E1F29] rounded-lg px-3 py-2">
                <span className="text-[#7A9BAD] text-xs">Stock total</span>
                <span className="font-bold text-sm font-mono text-[#ED7C00]">{fmt(data.monto_stock)}</span>
              </div>
              <div className="flex items-center gap-2 bg-[#0E1F29] rounded-lg px-3 py-2">
                <span className="text-[#7A9BAD] text-xs">Vendido mes</span>
                <span className="font-bold text-sm font-mono text-white">{fmtN(data.vendido_mes)} u.</span>
              </div>
            </div>

            {/* Locales table */}
            <div className="px-6 py-4">
              {data.por_local.length === 0 ? (
                <p className="text-[#7A9BAD] text-sm text-center py-8">
                  Sin datos por local. Verificá que los productos tengan LocalID asignado.
                </p>
              ) : (
                <LocalesPanel tenantId={tenantId} locales={data.por_local} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
