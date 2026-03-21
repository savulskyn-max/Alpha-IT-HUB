'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, RecomendacionItem, RecomendacionSimpleResponse } from '@/lib/api';
import { ChartContainer } from './ChartContainer';

interface Props {
  tenantId: string;
  localId?: number;
}

const ESTADO_CONFIG = {
  CRITICO: { label: 'CRÍTICO', bg: 'bg-[#3D1A0A]', text: 'text-[#ED7C00]', dot: 'bg-[#ED7C00]', order: 1 },
  BAJO: { label: 'BAJO', bg: 'bg-[#2D2A0A]', text: 'text-[#D4A017]', dot: 'bg-[#D4A017]', order: 2 },
  OK: { label: 'OK', bg: 'bg-[#0A2D1A]', text: 'text-[#2ECC71]', dot: 'bg-[#2ECC71]', order: 3 },
  EXCESO: { label: 'EXCESO', bg: 'bg-[#0A1A2D]', text: 'text-[#5B9BD5]', dot: 'bg-[#5B9BD5]', order: 4 },
} as const;

function EstadoBadge({ estado }: { estado: RecomendacionItem['estado'] }) {
  const cfg = ESTADO_CONFIG[estado];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function SkuRow({ sku }: { sku: RecomendacionItem['skus'][0] }) {
  const cobertura = sku.velocidad_diaria > 0 ? sku.stock / sku.velocidad_diaria : 999;
  const estado: RecomendacionItem['estado'] =
    cobertura < 7 ? 'CRITICO' : cobertura < 15 ? 'BAJO' : cobertura < 45 ? 'OK' : 'EXCESO';

  return (
    <tr className="border-b border-[#1A3040]/60 last:border-0">
      <td className="pl-10 pr-3 py-2 text-xs text-[#7A9BAD]">
        {[sku.descripcion, sku.talle, sku.color].filter(Boolean).join(' · ') || '—'}
      </td>
      <td className="px-3 py-2 text-xs text-[#CDD4DA] text-right">{sku.vendidas_30d}</td>
      <td className="px-3 py-2 text-xs text-[#CDD4DA] text-right">{sku.stock}</td>
      <td className="px-3 py-2 text-xs text-[#CDD4DA] text-right">{sku.velocidad_diaria.toFixed(1)}</td>
      <td className="px-3 py-2 text-xs text-right">
        <span className={cobertura >= 999 ? 'text-[#7A9BAD]' : ESTADO_CONFIG[estado].text}>
          {cobertura >= 999 ? '∞' : Math.round(cobertura)}d
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-right text-[#7A9BAD]">—</td>
      <td className="px-3 py-2 text-xs text-right text-[#7A9BAD]">—</td>
    </tr>
  );
}

function ItemRow({ item, expanded, onToggle }: { item: RecomendacionItem; expanded: boolean; onToggle: () => void }) {
  const cfg = ESTADO_CONFIG[item.estado];
  const coverageDisplay = item.cobertura_dias >= 999 ? '∞' : `${Math.round(item.cobertura_dias)}d`;

  return (
    <>
      <tr
        className={`border-b border-[#1E3340] cursor-pointer hover:bg-[#1A2E3A] transition-colors ${expanded ? 'bg-[#152530]' : ''}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`text-xs transition-transform duration-200 text-[#7A9BAD] ${expanded ? 'rotate-90' : ''}`}>▶</span>
            <span className="text-sm text-white font-medium">{item.nombre}</span>
            {item.skus.length > 0 && (
              <span className="text-xs text-[#7A9BAD]">({item.skus.length} SKUs)</span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 text-sm text-[#CDD4DA] text-right">{item.vendidas_30d}</td>
        <td className="px-3 py-3 text-sm text-[#CDD4DA] text-right">{item.stock_actual}</td>
        <td className="px-3 py-3 text-sm text-[#CDD4DA] text-right">{item.velocidad_diaria.toFixed(1)}</td>
        <td className="px-3 py-3 text-sm text-right">
          <span className={item.cobertura_dias >= 999 ? 'text-[#7A9BAD]' : cfg.text}>
            {coverageDisplay}
          </span>
        </td>
        <td className="px-3 py-3 text-sm text-right">
          <EstadoBadge estado={item.estado} />
        </td>
        <td className="px-3 py-3 text-sm text-[#7A9BAD] text-right text-xs truncate max-w-[120px]">
          {item.proveedor_nombre ?? '—'}
        </td>
        <td className="px-3 py-3 text-right">
          {item.sugerencia_compra > 0 ? (
            <span className="text-sm font-semibold text-[#ED7C00]">{item.sugerencia_compra}</span>
          ) : (
            <span className="text-sm text-[#7A9BAD]">—</span>
          )}
        </td>
      </tr>
      {expanded && item.skus.length > 0 && item.skus.map((sku, i) => (
        <SkuRow key={i} sku={sku} />
      ))}
    </>
  );
}

export function StockRecommendation({ tenantId, localId }: Props) {
  const [data, setData] = useState<RecomendacionSimpleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.analytics.recomendacionSimple(tenantId, localId);
      setData(res);
    } catch (e) {
      setError('No se pudo cargar la recomendación de compra.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, localId]);

  useEffect(() => { load(); }, [load]);

  const toggleRow = (nombre: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  };

  const filtered = (data?.items ?? []).filter(item =>
    search === '' || item.nombre.toLowerCase().includes(search.toLowerCase())
  );

  const criticos = filtered.filter(i => i.estado === 'CRITICO').length;
  const bajos = filtered.filter(i => i.estado === 'BAJO').length;

  return (
    <ChartContainer
      title="Recomendación de compra · Modo rápido"
      subtitle="Basado en ventas recientes y stock actual"
      exportFileName="recomendacion_compra"
    >
      {/* Summary chips */}
      {!loading && data && (
        <div className="flex flex-wrap gap-2 mb-4">
          {criticos > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3D1A0A] text-[#ED7C00] text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ED7C00]" />
              {criticos} CRÍTICO{criticos !== 1 ? 'S' : ''}
            </span>
          )}
          {bajos > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#2D2A0A] text-[#D4A017] text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4A017]" />
              {bajos} BAJO{bajos !== 1 ? 'S' : ''}
            </span>
          )}
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre de producto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-[#0E1F29] border border-[#32576F] rounded-lg px-3 py-2 text-sm text-[#CDD4DA] placeholder-[#7A9BAD] focus:outline-none focus:border-[#ED7C00] transition-colors"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <span className="w-5 h-5 border-2 border-[#32576F] border-t-[#ED7C00] rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <p className="text-[#ED7C00] text-sm text-center py-8">{error}</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-[#7A9BAD] text-sm text-center py-8">
          {search ? 'Sin resultados para esa búsqueda.' : 'Sin productos para mostrar.'}
        </p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[#1E3340]">
          <table className="w-full text-left" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <thead>
              <tr className="bg-[#0E1F29] border-b border-[#32576F]">
                <th className="px-4 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide">Producto</th>
                <th className="px-3 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Vend. 30d</th>
                <th className="px-3 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Stock</th>
                <th className="px-3 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Vel./día</th>
                <th className="px-3 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Cobertura</th>
                <th className="px-3 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Estado</th>
                <th className="px-3 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Proveedor</th>
                <th className="px-3 py-3 text-xs font-semibold text-[#7A9BAD] uppercase tracking-wide text-right">Sugerencia</th>
              </tr>
            </thead>
            <tbody className="bg-[#132229]">
              {filtered.map(item => (
                <ItemRow
                  key={item.nombre}
                  item={item}
                  expanded={expanded.has(item.nombre)}
                  onToggle={() => toggleRow(item.nombre)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartContainer>
  );
}
