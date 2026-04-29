'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { api, type ValorizacionResponse, type LocalValorizacion } from '@/lib/api';

interface Props {
  tenantId: string;
  productoNombreId: number;
  stockTotalEsperado?: number;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtARS(n: number): string {
  if (n >= 1_000) {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function fmtN(n: number): string {
  return new Intl.NumberFormat('es-AR').format(n);
}

// ── Palette for multi-local bars ──────────────────────────────────────────────

const BAR_COLORS = ['#ED7C00', '#3B82F6', '#2ECC71', '#A78BFA', '#F43F5E', '#14B8A6', '#F59E0B', '#6366F1'];

// ── Sub-components ────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-14 bg-[#1E3340] rounded-lg" />
      <div className="h-24 bg-[#1E3340] rounded-lg" />
      <div className="h-20 bg-[#1E3340] rounded-lg" />
    </div>
  );
}

function TotalStrip({ total, margen }: { total: ValorizacionResponse['total']; margen: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 bg-[#1A2F3E] border border-[#32576F] rounded-lg text-sm">
      <div className="flex flex-col">
        <span className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">Unidades totales</span>
        <span className="text-white font-bold font-mono">{fmtN(total.unidades_totales)}</span>
      </div>
      <div className="text-[#32576F] hidden sm:block">│</div>
      <div className="flex flex-col">
        <span className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">Valor al costo</span>
        <span className="text-[#CDD4DA] font-bold font-mono">{fmtARS(total.valor_costo)}</span>
      </div>
      <div className="text-[#32576F] hidden sm:block">│</div>
      <div className="flex flex-col">
        <span className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">Valor a venta</span>
        <span className="text-[#ED7C00] font-bold font-mono">{fmtARS(total.valor_venta)}</span>
      </div>
      {margen > 0 && (
        <>
          <div className="text-[#32576F] hidden sm:block">│</div>
          <div className="flex flex-col">
            <span className="text-[#7A9BAD] text-[10px] uppercase tracking-wide">Margen potencial</span>
            <span className="text-green-400 font-bold">{margen.toFixed(0)}%</span>
          </div>
        </>
      )}
    </div>
  );
}

// Horizontal stacked-bar distribution chart
function DistribucionChart({ locales }: { locales: LocalValorizacion[] }) {
  if (locales.length <= 1) return null;

  const chartData = locales.map((l, i) => ({
    name: l.local_nombre,
    pct: l.pct_total,
    valor: l.valor_costo,
    fill: BAR_COLORS[i % BAR_COLORS.length],
  }));

  return (
    <div>
      <p className="text-[#7A9BAD] text-[10px] uppercase tracking-wide mb-2">
        Distribución por local — valor al costo
      </p>
      <ResponsiveContainer width="100%" height={Math.max(locales.length * 28 + 16, 60)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
          barSize={14}
        >
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fontSize: 10, fill: '#CDD4DA' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: '#132229', border: '1px solid #32576F', borderRadius: 8, fontSize: 11 }}
            formatter={(v: unknown, _: unknown, props: { payload?: { valor?: number } }) => [
              `${(v as number).toFixed(1)}% · ${fmtARS(props.payload?.valor ?? 0)}`,
              'Participación',
            ]}
            cursor={{ fill: 'rgba(50,87,111,0.2)' }}
          />
          <Bar dataKey="pct" radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Table for 2–5 locales
function TablaLocales({ locales }: { locales: LocalValorizacion[] }) {
  const maxCosto = Math.max(...locales.map(l => l.valor_costo), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#32576F]">
            {['Local', 'Unidades', '%', 'Valor costo', 'Valor venta', 'Var.'].map(h => (
              <th key={h} className="text-left text-[#7A9BAD] font-medium py-2 px-2 uppercase whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locales.map((l, i) => {
            const isMax = l.valor_costo === maxCosto;
            return (
              <tr
                key={l.local_id}
                className={`border-b border-[#32576F]/40 ${isMax ? 'bg-[#ED7C00]/5' : ''}`}
              >
                <td className="py-2 px-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: BAR_COLORS[i % BAR_COLORS.length] }}
                    />
                    <span className={`font-medium ${isMax ? 'text-[#ED7C00]' : 'text-white'}`}>
                      {l.local_nombre}
                    </span>
                  </div>
                </td>
                <td className="py-2 px-2 text-[#CDD4DA] font-mono text-right">{fmtN(l.unidades)}</td>
                <td className="py-2 px-2 text-right">
                  <span className="text-[#7A9BAD]">{l.pct_total.toFixed(1)}%</span>
                </td>
                <td className="py-2 px-2 text-[#CDD4DA] font-mono text-right">{fmtARS(l.valor_costo)}</td>
                <td className="py-2 px-2 text-[#ED7C00] font-mono text-right">{fmtARS(l.valor_venta)}</td>
                <td className="py-2 px-2 text-[#7A9BAD] text-right">{l.descripciones_distintas}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Scrolleable table with search for >5 locales
function TablaLocalesGrande({ locales }: { locales: LocalValorizacion[] }) {
  const [busqueda, setBusqueda] = useState('');
  const [sortCol, setSortCol] = useState<'valor_costo' | 'unidades' | 'valor_venta'>('valor_costo');
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = locales
    .filter(l => l.local_nombre.toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a, b) => {
      const diff = a[sortCol] - b[sortCol];
      return sortAsc ? diff : -diff;
    });

  const maxCosto = Math.max(...locales.map(l => l.valor_costo), 1);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(v => !v);
    else { setSortCol(col); setSortAsc(false); }
  };

  const SortBtn = ({ col, label }: { col: typeof sortCol; label: string }) => (
    <button
      onClick={() => toggleSort(col)}
      className="flex items-center gap-0.5 text-[#7A9BAD] hover:text-white transition-colors uppercase whitespace-nowrap"
    >
      {label}
      {sortCol === col && <span className="text-[#ED7C00]">{sortAsc ? ' ↑' : ' ↓'}</span>}
    </button>
  );

  return (
    <div className="space-y-2">
      <input
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        placeholder="Buscar local..."
        className="w-full bg-[#0B1921] border border-[#32576F] text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00] placeholder:text-[#7A9BAD]"
      />
      <div className="overflow-y-auto max-h-64">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#0E1F29]">
            <tr className="border-b border-[#32576F]">
              <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 uppercase">Local</th>
              <th className="py-2 px-2 text-right"><SortBtn col="unidades" label="Unid." /></th>
              <th className="text-left text-[#7A9BAD] font-medium py-2 px-2 uppercase">%</th>
              <th className="py-2 px-2 text-right"><SortBtn col="valor_costo" label="Costo" /></th>
              <th className="py-2 px-2 text-right"><SortBtn col="valor_venta" label="Venta" /></th>
              <th className="text-right text-[#7A9BAD] font-medium py-2 px-2 uppercase">Var.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l, i) => {
              const isMax = l.valor_costo === maxCosto;
              const origIdx = locales.indexOf(l);
              return (
                <tr key={l.local_id} className={`border-b border-[#32576F]/40 ${isMax ? 'bg-[#ED7C00]/5' : ''}`}>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: BAR_COLORS[origIdx % BAR_COLORS.length] }} />
                      <span className={`font-medium ${isMax ? 'text-[#ED7C00]' : 'text-white'}`}>{l.local_nombre}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-[#CDD4DA] font-mono text-right">{fmtN(l.unidades)}</td>
                  <td className="py-2 px-2 text-[#7A9BAD]">{l.pct_total.toFixed(1)}%</td>
                  <td className="py-2 px-2 text-[#CDD4DA] font-mono text-right">{fmtARS(l.valor_costo)}</td>
                  <td className="py-2 px-2 text-[#ED7C00] font-mono text-right">{fmtARS(l.valor_venta)}</td>
                  <td className="py-2 px-2 text-[#7A9BAD] text-right">{l.descripciones_distintas}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-[#7A9BAD]">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ValorizacionStock({ tenantId, productoNombreId }: Props) {
  const [data, setData] = useState<ValorizacionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(false);

    api.analytics.stockValorizacion(tenantId, productoNombreId)
      .then(r => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [tenantId, productoNombreId]);

  const margen = data && data.total.valor_costo > 0
    ? ((data.total.valor_venta - data.total.valor_costo) / data.total.valor_costo) * 100
    : 0;

  return (
    <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4 space-y-4">
      <p className="text-white text-xs font-semibold">Valorización del stock</p>

      {loading && <Skeleton />}

      {!loading && error && (
        <div className="flex items-center justify-between px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-xs">No se pudo cargar la valorización</p>
          <button
            onClick={() => {
              setError(false);
              setLoading(true);
              api.analytics.stockValorizacion(tenantId, productoNombreId)
                .then(setData)
                .catch(() => setError(true))
                .finally(() => setLoading(false));
            }}
            className="text-xs text-[#ED7C00] hover:underline ml-3"
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && data && (
        <>
          <TotalStrip total={data.total} margen={margen} />

          {data.por_local.length > 1 && (
            <DistribucionChart locales={data.por_local} />
          )}

          {data.por_local.length === 1 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#132229] border border-[#32576F]/50 rounded-lg text-xs text-[#7A9BAD]">
              <span className="w-2 h-2 rounded-full bg-[#ED7C00]" />
              <span className="text-white font-medium">{data.por_local[0].local_nombre}</span>
              <span>— único local con stock</span>
            </div>
          )}

          {data.por_local.length >= 6
            ? <TablaLocalesGrande locales={data.por_local} />
            : data.por_local.length >= 2
              ? <TablaLocales locales={data.por_local} />
              : null
          }

          {data.total.skus_sin_costo > 0 && (
            <p className="text-[10px] text-[#7A9BAD] flex items-center gap-1.5">
              <span className="text-yellow-400">⚠</span>
              {data.total.skus_sin_costo} SKU{data.total.skus_sin_costo > 1 ? 's' : ''} sin precio de costo cargado — valorización aproximada
            </p>
          )}
        </>
      )}
    </div>
  );
}
