'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, type PrediccionesResponse, type FiltrosDisponibles, type AnalyticsFilters } from '@/lib/api';
import { ChartContainer } from '@/components/analytics/ChartContainer';
import { DateRangeFilter } from '@/components/analytics/DateRangeFilter';

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="text-white font-bold text-xl">{value}</p>
      {sub && <p className="text-[#7A9BAD] text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

export default function PrediccionesAnalyticsPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const [data, setData] = useState<PrediccionesResponse | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDisponibles | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modelo, setModelo] = useState<'basico' | 'temporada' | 'quiebre'>('basico');
  const [periodoDias, setPeriodoDias] = useState(30);
  const [sobreStockPct, setSobreStockPct] = useState(0);

  const load = useCallback(async (f: AnalyticsFilters) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.analytics.predicciones(tenantId, f, {
        modelo,
        periodo_dias: periodoDias,
        sobre_stock_pct: sobreStockPct,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [tenantId, modelo, periodoDias, sobreStockPct]);

  useEffect(() => {
    api.analytics.filtros(tenantId).then(setFiltros).catch(() => {});
    load({});
  }, [tenantId, load]);

  const totals = useMemo(() => {
    if (!data) return { prediccion: 0, stock: 0, recomendado: 0 };
    const prediccion = data.productos.reduce((sum, p) => sum + (p.prediccion_30_dias ?? 0), 0);
    const stock = data.productos.reduce((sum, p) => sum + (p.stock_actual ?? 0), 0);
    const recomendado = data.productos.reduce((sum, p) => sum + (p.recomendacion_stock_30_dias ?? 0), 0);
    return { prediccion, stock, recomendado };
  }, [data]);

  const top = useMemo(() => {
    if (!data) return [];
    return [...data.productos]
      .sort((a, b) => (b.prediccion_30_dias - a.prediccion_30_dias))
      .slice(0, 30);
  }, [data]);

  return (
    <div className="flex flex-col flex-1">
      <div className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href={`/dashboard/clientes/${tenantId}`} className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Analitica - Predicciones</h1>
          <p className="text-[#7A9BAD] text-sm">Estimaciones de demanda y recomendación de stock con ajustes por temporada y quiebre.</p>
        </div>
      </div>

      <main className="flex-1 px-6 py-6 space-y-6">
        <DateRangeFilter filtros={filtros} onApply={load} loading={loading} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
            <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Modo de predicción</p>
            <select
              value={modelo}
              onChange={(e) => setModelo(e.target.value as any)}
              className="w-full bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="basico">Básico</option>
              <option value="temporada">Temporada</option>
              <option value="quiebre">Quiebre</option>
            </select>
            <p className="text-[#7A9BAD] text-xs mt-2">Ajusta el comportamiento esperado:</p>
            <ul className="text-[#7A9BAD] text-xs list-disc list-inside">
              <li>Básico: mantiene la tendencia histórica.</li>
              <li>Temporada: +25% para períodos de alta demanda.</li>
              <li>Quiebre: +50% para eventos excepcionales.</li>
            </ul>
          </div>
          <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
            <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Horizonte (días)</p>
            <input
              type="number"
              min={1}
              value={periodoDias}
              onChange={(e) => setPeriodoDias(Number(e.target.value))}
              className="w-full bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-white"
            />
            <p className="text-[#7A9BAD] text-xs mt-2">Periodo usado para recomendar stock.</p>
          </div>
          <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
            <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">% Sobre stock</p>
            <input
              type="number"
              min={0}
              value={sobreStockPct}
              onChange={(e) => setSobreStockPct(Number(e.target.value))}
              className="w-full bg-[#0F1E28] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-white"
            />
            <p className="text-[#7A9BAD] text-xs mt-2">Agregar margen extra sobre el stock recomendado.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Predicción 30d" value={fmt(totals.prediccion)} />
          <KpiCard label="Stock actual" value={totals.stock.toLocaleString('es-AR')} />
          <KpiCard label="Stock recomendado" value={totals.recomendado.toLocaleString('es-AR')} />
          <KpiCard label="Diferencia" value={(totals.recomendado - totals.stock).toLocaleString('es-AR')} />
        </div>

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
            <ChartContainer title="Top 30 predicción" exportFileName={`predicciones_${tenantId}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#32576F]">
                      {['Producto', 'Descripción', 'Stock', 'Promedio diario', 'Predicción 30d', 'Recomendado'].map((h) => (
                        <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-3 text-xs uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((p, i) => (
                      <tr key={i} className="border-b border-[#32576F]/40 hover:bg-[#132229] transition-colors">
                        <td className="py-2 px-3 text-white font-medium">{p.nombre}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.descripcion || '-'}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.stock_actual}</td>
                        <td className="py-2 px-3 text-[#CDD4DA]">{p.promedio_diario.toFixed(2)}</td>
                        <td className="py-2 px-3 text-[#ED7C00] font-mono">{p.prediccion_30_dias.toFixed(0)}</td>
                        <td className="py-2 px-3 text-[#10B981] font-mono">{p.recomendacion_stock_30_dias.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartContainer>
          </>
        )}
      </main>
    </div>
  );
}
