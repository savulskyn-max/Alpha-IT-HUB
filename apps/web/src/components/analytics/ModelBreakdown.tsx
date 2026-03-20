'use client';

import { useEffect, useState } from 'react';
import { api, type StockModelsRankingResponse, type StockModeloDescripcion } from '@/lib/api';

interface Props {
  tenantId: string;
  productoNombreId: number;
  localId?: number;
  horizonte?: number;
}

function fmtN(n: number) { return n.toLocaleString('es-AR'); }
function fmtM(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${fmtN(n)}`;
}

function CobBadge({ dias }: { dias: number }) {
  const color = dias < 15 ? 'text-red-400' : dias <= 60 ? 'text-green-400' : 'text-blue-400';
  const label = dias >= 999 ? '∞d' : `${fmtN(Math.round(dias))}d`;
  return <span className={`font-mono text-xs font-semibold ${color}`}>{label}</span>;
}

function EstadoBadge({ modelo }: { modelo: StockModeloDescripcion }) {
  if (modelo.estado === 'COMPRAR') {
    return (
      <div className="text-right">
        <span className="inline-flex items-center gap-1 bg-red-500/15 border border-red-500/40 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
          COMPRAR {fmtN(modelo.unidadesSugeridas)}
        </span>
        <div className="text-[9px] text-[#7A9BAD] mt-0.5 whitespace-nowrap">
          {fmtM(modelo.inversionSugerida)} · {Math.round(modelo.coberturaPostCompra)}d post
        </div>
      </div>
    );
  }
  if (modelo.estado === 'EXCESO') {
    return (
      <span className="inline-flex items-center bg-blue-500/15 border border-blue-500/40 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
        EXCESO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center bg-green-500/15 border border-green-500/40 text-green-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
      OK
    </span>
  );
}

function SummaryBanner({ data }: { data: StockModelsRankingResponse }) {
  const totalInv = data.modelos.reduce((s, m) => s + m.inversionSugerida, 0);
  const comprar = data.modelos.filter(m => m.estado === 'COMPRAR');
  const avgCob = comprar.length
    ? comprar.reduce((s, m) => s + m.coberturaPostCompra, 0) / comprar.length
    : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 bg-[#1A2F3E] border border-[#ED7C00]/30 rounded-lg text-xs text-[#CDD4DA]">
      <span className="font-semibold text-[#ED7C00]">Distribución de compra</span>
      <span>~{fmtN(data.recomendacionTotal)} un.</span>
      <span className="text-[#32576F]">│</span>
      <span>Inversión: {fmtM(totalInv)}</span>
      <span className="text-[#32576F]">│</span>
      <span>Cobertura post: {Math.round(avgCob)}d</span>
    </div>
  );
}

export default function ModelBreakdown({ tenantId, productoNombreId, localId, horizonte = 60 }: Props) {
  const [data, setData] = useState<StockModelsRankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    api.analytics.stockModelsRanking(tenantId, productoNombreId, horizonte, localId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, productoNombreId, localId, horizonte]);

  return (
    <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
      <p className="text-white text-xs font-semibold mb-3">Modelos — ranking por velocidad de salida</p>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && !data && (
        <p className="text-[#7A9BAD] text-xs text-center py-8">Sin datos</p>
      )}

      {!loading && data && (
        <div className="space-y-2">
          <SummaryBanner data={data} />

          <div className="space-y-1 mt-2">
            {data.modelos.map(m => {
              const isExp = expandedId === m.descripcionId;
              return (
                <div key={m.descripcionId}>
                  {/* Main row */}
                  <div
                    onClick={() => setExpandedId(isExp ? null : m.descripcionId)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      isExp ? 'bg-[#132229]' : 'hover:bg-[#132229]/60'
                    }`}
                  >
                    {/* Expand arrow */}
                    <svg
                      className={`w-3 h-3 flex-shrink-0 text-[#7A9BAD] transition-transform ${isExp ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>

                    {/* Name */}
                    <span className="text-white text-xs font-medium flex-1 min-w-0 truncate">
                      {m.descripcion}
                    </span>

                    {/* Velocity */}
                    <span className="text-[#7A9BAD] text-[10px] font-mono whitespace-nowrap">
                      {m.velocidadSalida.toFixed(2)}/d
                    </span>

                    {/* Stock */}
                    <span className="text-[#CDD4DA] text-[10px] font-mono whitespace-nowrap w-12 text-right">
                      {fmtN(m.stockTotal)} u.
                    </span>

                    {/* Coverage */}
                    <div className="w-12 text-right">
                      <CobBadge dias={m.coberturaDias} />
                    </div>

                    {/* Estado badge */}
                    <div className="flex-shrink-0">
                      <EstadoBadge modelo={m} />
                    </div>
                  </div>

                  {/* Alert row */}
                  {m.alertaColor && (
                    <div className="flex items-start gap-1.5 px-8 py-1 text-[10px] text-yellow-400">
                      <span>⚠</span>
                      <span>{m.alertaColor}</span>
                    </div>
                  )}

                  {/* Expanded placeholder */}
                  {isExp && (
                    <div className="mx-3 mb-1 px-3 py-3 bg-[#0B1921] border border-[#32576F]/50 rounded-lg text-[#7A9BAD] text-xs">
                      Cargando detalle...
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
