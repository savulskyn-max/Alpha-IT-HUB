'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api, type StockDemandForecastResponse, type StockModelsRankingResponse, type StockModeloDescripcion } from '@/lib/api';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const HORIZONTES: { label: string; dias: number | null }[] = [
  { label: '30d', dias: 30 },
  { label: '60d', dias: 60 },
  { label: '90d', dias: 90 },
  { label: '6 meses', dias: 180 },
  { label: 'Personalizado', dias: null },
];

interface Props {
  tenantId: string;
  productoNombreId: number;
  localId?: number;
}

export default function DemandForecast({ tenantId, productoNombreId, localId }: Props) {
  const [horizonte, setHorizonte] = useState(60);
  const [customDias, setCustomDias] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [data, setData] = useState<StockDemandForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ranking, setRanking] = useState<StockModelsRankingResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.analytics.stockDemandForecast(tenantId, productoNombreId, horizonte, localId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api.analytics.stockModelsRanking(tenantId, productoNombreId, horizonte, localId)
      .then(r => { if (!cancelled) setRanking(r); })
      .catch(() => { if (!cancelled) setRanking(null); });
    return () => { cancelled = true; };
  }, [tenantId, productoNombreId, localId, horizonte]);

  function handleHorizonteClick(dias: number | null) {
    if (dias === null) {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      setHorizonte(dias);
    }
  }

  function handleCustomSubmit() {
    const v = parseInt(customDias, 10);
    if (v > 0 && v <= 365) {
      setHorizonte(v);
      setShowCustom(false);
    }
  }

  const activeLabel = HORIZONTES.find(h => h.dias === horizonte)?.label ?? 'Personalizado';

  // ── Chart data ──────────────────────────────────────────────────────
  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  const chartData = data
    ? [
        ...data.ventasMensuales.map(v => ({
          label: `${MESES[v.mes - 1]} ${String(v.anio).slice(2)}`,
          ventas: v.unidades,
          proyeccion: null as number | null,
        })),
        ...data.factoresCalendario.map(fc => {
          const daysInMonth = new Date(now.getFullYear(), fc.mes, 0).getDate();
          const projected = Math.round(data.velocidadBase * data.factorTendencia * fc.factor * daysInMonth);
          const year = fc.mes >= currentMonth ? now.getFullYear() : now.getFullYear() + 1;
          return {
            label: `${MESES[fc.mes - 1]} ${String(year).slice(2)}`,
            ventas: 0,
            proyeccion: projected,
          };
        }),
      ]
    : [];

  // ── Trend formatting ────────────────────────────────────────────────
  const trendPct = data ? Math.round((data.factorTendencia - 1) * 100) : 0;
  const trendSign = trendPct >= 0 ? '+' : '';
  const trendArrow = trendPct > 0 ? '↑' : trendPct < 0 ? '↓' : '→';
  const trendColor = trendPct > 0 ? 'text-[#2ECC71]' : trendPct < 0 ? 'text-[#ED7C00]' : 'text-[#7A9BAD]';
  const currentCalFactor = data?.factoresCalendario.find(f => f.mes === currentMonth);

  return (
    <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4">
      {/* Header row: title + horizon selector */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-white text-xs font-semibold">
          Pronostico de demanda · proximos {data?.horizonte ?? horizonte} dias
        </p>

        {/* Horizon buttons */}
        <div className="flex items-center gap-1 flex-wrap">
          {HORIZONTES.map(h => {
            const isActive = h.dias === null ? showCustom : (h.dias === horizonte && !showCustom);
            return (
              <button
                key={h.label}
                onClick={() => handleHorizonteClick(h.dias)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  isActive
                    ? 'bg-[#ED7C00]/15 border-[#ED7C00]/50 text-[#ED7C00]'
                    : 'bg-[#132229] border-[#32576F] text-[#7A9BAD] hover:border-[#ED7C00]/30 hover:text-white'
                }`}
              >
                {h.label}
              </button>
            );
          })}
          {showCustom && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={365}
                value={customDias}
                onChange={e => setCustomDias(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                placeholder="dias"
                className="w-16 bg-[#132229] border border-[#32576F] rounded text-white text-[10px] px-2 py-0.5 outline-none focus:border-[#ED7C00]/50"
              />
              <button
                onClick={handleCustomSubmit}
                className="px-2 py-0.5 text-[10px] bg-[#ED7C00]/15 border border-[#ED7C00]/50 text-[#ED7C00] rounded"
              >
                OK
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-52 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data ? null : (
        <>
          {/* Chart + panel row */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* LEFT: Chart (3 cols) */}
            <div className="lg:col-span-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#32576F" opacity={0.3} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#7A9BAD', fontSize: 10 }}
                    axisLine={{ stroke: '#32576F' }}
                    tickLine={false}
                    interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                  />
                  <YAxis tick={{ fill: '#7A9BAD', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#CDD4DA' }}
                    formatter={(value: number, name: string) => [
                      value,
                      name === 'ventas' ? 'Ventas reales' : 'Proyeccion',
                    ]}
                  />
                  <Bar dataKey="ventas" fill="#32576F" radius={[3, 3, 0, 0]} name="ventas" />
                  <Line
                    dataKey="proyeccion"
                    stroke="#ED7C00"
                    strokeWidth={2}
                    dot={{ fill: '#ED7C00', r: 3 }}
                    connectNulls={false}
                    name="proyeccion"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* RIGHT: Forecast panel (2 cols) */}
            <div className="lg:col-span-2 flex flex-col gap-3">
              <Row label="Demanda estimada" value={`${fmtN(data.demandaProyectada)} un.`} accent />
              <Row label="Stock actual" value={`${fmtN(data.stockActual)} un.`} />
              <Row
                label="Cobertura sin comprar"
                value={data.coberturaSinComprar >= 999 ? 'Sin ventas' : `${Math.round(data.coberturaSinComprar)} dias`}
              />
              <div className="border-t border-[#32576F] my-1" />
              <Row
                label="Factor tendencia"
                value={<span className={trendColor}>{trendSign}{trendPct}% {trendArrow}</span>}
              />
              <Row
                label={`Factor estacional (${MESES[currentMonth - 1]})`}
                value={currentCalFactor ? `${currentCalFactor.factor.toFixed(2)}x` : '1.00x'}
              />
              <Row label="Velocidad base" value={`${data.velocidadBase.toFixed(1)} un/dia`} />

              {/* Scenarios table */}
              {data.escenarios && data.escenarios.length > 0 && (
                <div className="border-t border-[#32576F] mt-1 pt-2">
                  <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-2">Escenarios de compra</p>
                  <div className="flex flex-col gap-1">
                    {data.escenarios.map((e, i) => {
                      const isRecomendado = !!e.recomendado;
                      const hasWarning = e.pesoStock > 0.25 && e.comprar > 0;
                      return (
                        <div
                          key={i}
                          className={`rounded px-2 py-1.5 text-[10px] flex items-center justify-between gap-1 ${
                            isRecomendado
                              ? 'bg-[#2ECC71]/10 border border-[#2ECC71]/30'
                              : 'bg-[#132229] border border-[#32576F]/50'
                          }`}
                        >
                          <span className={isRecomendado ? 'text-[#2ECC71] font-semibold' : 'text-[#CDD4DA]'}>
                            Comprar {fmtN(e.comprar)} un.
                          </span>
                          <span className="text-[#7A9BAD]">→ {Math.round(e.cobertura)}d</span>
                          <span className={isRecomendado ? 'text-[#2ECC71]' : 'text-[#CDD4DA]'}>
                            {fmtM(e.inversion)}
                          </span>
                          <span>
                            {isRecomendado && <span className="text-[#2ECC71]">✓ rec.</span>}
                            {hasWarning && !isRecomendado && (
                              <span className="text-[#ED7C00]">⚠ capital</span>
                            )}
                            {!isRecomendado && !hasWarning && e.comprar > 0 && (
                              <span className="text-[#7A9BAD]">{Math.round(e.pesoStock * 100)}% stock</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Connection banner */}
          <div className="mt-3 rounded-lg border border-[#32576F] bg-[#132229] px-4 py-2 flex items-center gap-2 flex-wrap">
            <span className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">Compra sugerida</span>
            <span className="text-[#ED7C00] font-semibold text-xs font-mono">
              ~{fmtN(data.recomendacion.unidades)} un.
            </span>
            <span className="text-[#32576F]">│</span>
            <span className="text-[#7A9BAD] text-[10px]">Inversion</span>
            <span className="text-white font-semibold text-xs font-mono">{fmtM(data.recomendacion.inversion)}</span>
            <span className="text-[#32576F]">│</span>
            <span className="text-[#7A9BAD] text-[10px]">Cobertura</span>
            <span className="text-white font-semibold text-xs font-mono">{data.recomendacion.coberturaDias}d</span>
            {data.recomendacion.mensaje && (
              <>
                <span className="text-[#32576F]">│</span>
                <span className="text-[#7A9BAD] text-[10px] italic">{data.recomendacion.mensaje}</span>
              </>
            )}
          </div>

          {/* Purchase distribution breakdown */}
          {ranking && ranking.modelos.length > 0 && <PurchaseDistribution ranking={ranking} />}
        </>
      )}
    </div>
  );
}

// ── Purchase distribution ────────────────────────────────────────────────────

function PurchaseDistribution({ ranking }: { ranking: StockModelsRankingResponse }) {
  const comprar = ranking.modelos.filter(m => m.estado === 'COMPRAR' || m.estado === 'REVISAR');
  const rest = ranking.modelos.filter(m => m.estado !== 'COMPRAR' && m.estado !== 'REVISAR');

  if (comprar.length === 0) return null;

  // Sort: high velocity + low coverage first
  const sorted = [...comprar].sort((a, b) => {
    // Priority: lower coverage first, then higher velocity
    const urgA = a.coberturaDias < 15 ? 2 : a.coberturaDias < 30 ? 1 : 0;
    const urgB = b.coberturaDias < 15 ? 2 : b.coberturaDias < 30 ? 1 : 0;
    if (urgB !== urgA) return urgB - urgA;
    return b.velocidadSalida - a.velocidadSalida;
  });

  const totalUnits = sorted.reduce((s, m) => s + m.unidadesSugeridas, 0);
  const totalInv = sorted.reduce((s, m) => s + m.inversionSugerida, 0);

  // Detect liquidation candidates: velocity < 10% of average
  const avgVel = comprar.length > 0 ? comprar.reduce((s, m) => s + m.velocidadSalida, 0) / comprar.length : 0;

  return (
    <div className="mt-3 border-t border-[#32576F] pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-white text-xs font-semibold">¿Qué comprar? Distribución recomendada</p>
        <span className="text-[#7A9BAD] text-[10px]">{sorted.length} modelos · {fmtN(totalUnits)} un. · {fmtM(totalInv)}</span>
      </div>
      <div className="space-y-1">
        {sorted.map(m => {
          const pct = totalUnits > 0 ? (m.unidadesSugeridas / totalUnits) * 100 : 0;
          const isLiquidation = m.velocidadSalida < avgVel * 0.1 && avgVel > 0;
          return (
            <div key={m.descripcionId} className="flex items-center gap-2 text-[10px]">
              {/* Bar */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[#CDD4DA] truncate flex-1">{m.descripcion}</span>
                  {m.alertaColor && <span className="text-yellow-400 flex-shrink-0">⚠</span>}
                  {isLiquidation && <span className="text-orange-400 flex-shrink-0">🏷️ liquidar</span>}
                </div>
                <div className="w-full bg-[#0B1921] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      backgroundColor: m.coberturaDias < 7 ? '#DC2626' : m.coberturaDias < 15 ? '#D97706' : '#ED7C00',
                    }}
                  />
                </div>
              </div>
              {/* Stats */}
              <span className="text-[#ED7C00] font-mono font-semibold w-12 text-right">{fmtN(m.unidadesSugeridas)}</span>
              <span className="text-[#7A9BAD] font-mono w-12 text-right">{fmtM(m.inversionSugerida)}</span>
              <span className={`font-mono w-8 text-right ${m.coberturaDias < 7 ? 'text-red-400' : m.coberturaDias < 15 ? 'text-yellow-400' : 'text-[#7A9BAD]'}`}>
                {Math.round(m.coberturaDias)}d
              </span>
              <span className="text-[#7A9BAD] font-mono w-8 text-right">→{Math.round(m.coberturaPostCompra)}d</span>
            </div>
          );
        })}
      </div>
      {rest.filter(m => m.estado === 'EXCESO').length > 0 && (
        <p className="text-[10px] text-blue-400/70 mt-2">
          {rest.filter(m => m.estado === 'EXCESO').length} modelo(s) con exceso omitido(s)
        </p>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[#7A9BAD] text-xs">{label}</span>
      <span className={`text-sm font-semibold font-mono ${accent ? 'text-[#ED7C00]' : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}

function fmtN(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n));
}

function fmtM(n: number): string {
  if (n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
