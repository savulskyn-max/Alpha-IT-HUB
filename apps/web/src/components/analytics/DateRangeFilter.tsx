'use client';

import { useState } from 'react';
import type { FiltrosDisponibles, AnalyticsFilters } from '@/lib/api';

interface Props {
  filtros?: FiltrosDisponibles | null;
  initialFilters?: AnalyticsFilters;
  showProductoFilter?: boolean;
  showGastoFilters?: boolean;
  onApply: (filters: AnalyticsFilters) => void;
  loading?: boolean;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function DateRangeFilter({
  filtros,
  initialFilters,
  showProductoFilter,
  showGastoFilters,
  onApply,
  loading,
}: Props) {
  const [filters, setFilters] = useState<AnalyticsFilters>({
    fecha_desde: firstOfMonthStr(),
    fecha_hasta: todayStr(),
    ...initialFilters,
  });

  const set = (key: keyof AnalyticsFilters, value: string | number | undefined) =>
    setFilters((prev) => ({ ...prev, [key]: value || undefined }));

  return (
    <div className="bg-[#132229] border border-[#32576F] rounded-xl p-4">
      <div className="flex flex-wrap gap-3 items-end">
        {/* Date range */}
        <div>
          <label className="block text-[#7A9BAD] text-xs mb-1">Desde</label>
          <input
            type="date"
            value={filters.fecha_desde ?? ''}
            onChange={(e) => set('fecha_desde', e.target.value)}
            className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
          />
        </div>
        <div>
          <label className="block text-[#7A9BAD] text-xs mb-1">Hasta</label>
          <input
            type="date"
            value={filters.fecha_hasta ?? ''}
            onChange={(e) => set('fecha_hasta', e.target.value)}
            className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
          />
        </div>

        {/* Local */}
        {filtros && filtros.locales.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Local</label>
            <select
              value={filters.local_id ?? ''}
              onChange={(e) => set('local_id', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos los locales</option>
              {filtros.locales.map((l) => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Método de pago */}
        {filtros && filtros.metodos_pago.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Método de pago</label>
            <select
              value={filters.metodo_pago_id ?? ''}
              onChange={(e) => set('metodo_pago_id', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos</option>
              {filtros.metodos_pago.map((m) => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Tipo venta (ventas only) */}
        {!showGastoFilters && filtros && filtros.tipos_venta.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Tipo de venta</label>
            <select
              value={filters.tipo_venta ?? ''}
              onChange={(e) => set('tipo_venta', e.target.value)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos</option>
              {filtros.tipos_venta.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}

        {/* Producto search (ventas only) */}
        {showProductoFilter && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Producto</label>
            <input
              type="text"
              placeholder="Buscar nombre..."
              value={filters.producto_nombre ?? ''}
              onChange={(e) => set('producto_nombre', e.target.value)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00] w-36"
            />
          </div>
        )}

        {/* Talle (ventas only) */}
        {showProductoFilter && filtros && filtros.talles.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Talle</label>
            <select
              value={filters.talle_id ?? ''}
              onChange={(e) => set('talle_id', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos</option>
              {filtros.talles.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Color (ventas only) */}
        {showProductoFilter && filtros && filtros.colores.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Color</label>
            <select
              value={filters.color_id ?? ''}
              onChange={(e) => set('color_id', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos</option>
              {filtros.colores.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Gasto filters */}
        {showGastoFilters && filtros && filtros.categorias_gasto.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Categoría</label>
            <select
              value={filters.categoria_id ?? ''}
              onChange={(e) => set('categoria_id', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todas</option>
              {filtros.categorias_gasto.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {showGastoFilters && filtros && filtros.tipos_gasto.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Tipo de gasto</label>
            <select
              value={filters.tipo_id ?? ''}
              onChange={(e) => set('tipo_id', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos</option>
              {filtros.tipos_gasto.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={() => onApply(filters)}
          disabled={loading}
          className="px-4 py-1.5 bg-[#ED7C00] text-white text-sm font-medium rounded-lg hover:bg-[#D46E00] transition-colors disabled:opacity-50"
        >
          {loading ? 'Cargando…' : 'Aplicar'}
        </button>
      </div>
    </div>
  );
}
