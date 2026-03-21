'use client';

import { useState, useRef, useEffect } from 'react';
import type { FiltrosDisponibles, AnalyticsFilters } from '@/lib/api';

interface Props {
  filtros?: FiltrosDisponibles | null;
  initialFilters?: AnalyticsFilters;
  showProductoFilter?: boolean;
  showGastoFilters?: boolean;
  showSupplierFilter?: boolean;
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

// Multi-select payment methods popover
function MetodoPagoMultiSelect({
  opciones,
  value,
  onChange,
}: {
  opciones: Array<{ id: number; nombre: string }>;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = new Set(
    value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []
  );

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(String(id))) next.delete(String(id));
    else next.add(String(id));
    onChange(next.size > 0 ? [...next].join(',') : undefined);
  }

  const label =
    selected.size === 0
      ? 'Todos'
      : selected.size === opciones.length
      ? 'Todos'
      : selected.size === 1
      ? opciones.find((o) => selected.has(String(o.id)))?.nombre ?? `${selected.size} sel.`
      : `${selected.size} seleccionados`;

  return (
    <div ref={ref} className="relative">
      <label className="block text-[#7A9BAD] text-xs mb-1">Método de pago</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00] flex items-center gap-2 min-w-[140px]"
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <svg className="w-3 h-3 shrink-0 text-[#7A9BAD]" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 bg-[#1E3340] border border-[#32576F] rounded-lg shadow-xl min-w-[180px] max-h-52 overflow-y-auto">
          <label className="flex items-center gap-2 px-3 py-2 hover:bg-[#132229] cursor-pointer border-b border-[#32576F]">
            <input
              type="checkbox"
              checked={selected.size === 0 || selected.size === opciones.length}
              onChange={() => onChange(undefined)}
              className="accent-[#ED7C00]"
            />
            <span className="text-[#7A9BAD] text-sm">Todos</span>
          </label>
          {opciones.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-[#132229] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(String(m.id))}
                onChange={() => toggle(m.id)}
                className="accent-[#ED7C00]"
              />
              <span className="text-white text-sm">{m.nombre}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Autocomplete product name dropdown
function ProductoAutocomplete({
  nombres,
  value,
  onChange,
}: {
  nombres: string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const [input, setInput] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = input.length >= 1
    ? nombres.filter((n) => n.toLowerCase().includes(input.toLowerCase())).slice(0, 20)
    : nombres.slice(0, 20);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function select(name: string) {
    setInput(name);
    onChange(name);
    setOpen(false);
  }

  function handleChange(v: string) {
    setInput(v);
    onChange(v || undefined);
    setOpen(true);
  }

  return (
    <div ref={ref} className="relative">
      <label className="block text-[#7A9BAD] text-xs mb-1">Producto</label>
      <input
        type="text"
        placeholder="Buscar nombre..."
        value={input}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00] w-44"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 bg-[#1E3340] border border-[#32576F] rounded-lg shadow-xl w-60 max-h-52 overflow-y-auto">
          {input && (
            <button
              type="button"
              onClick={() => select('')}
              className="w-full text-left px-3 py-2 text-[#7A9BAD] text-sm hover:bg-[#132229] border-b border-[#32576F]"
            >
              Limpiar filtro
            </button>
          )}
          {filtered.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => select(n)}
              className="w-full text-left px-3 py-2 text-white text-sm hover:bg-[#132229] truncate"
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DateRangeFilter({
  filtros,
  initialFilters,
  showProductoFilter,
  showGastoFilters,
  showSupplierFilter,
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

        {/* Método de pago — multi-select */}
        {filtros && filtros.metodos_pago.length > 0 && (
          <MetodoPagoMultiSelect
            opciones={filtros.metodos_pago}
            value={filters.metodo_pago_ids}
            onChange={(v) => setFilters((prev) => ({ ...prev, metodo_pago_ids: v }))}
          />
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

        {/* Producto autocomplete (ventas only) */}
        {showProductoFilter && filtros && filtros.nombres_producto.length > 0 && (
          <ProductoAutocomplete
            nombres={filtros.nombres_producto}
            value={filters.producto_nombre}
            onChange={(v) => setFilters((prev) => ({ ...prev, producto_nombre: v }))}
          />
        )}

        {showProductoFilter && !filtros?.nombres_producto?.length && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Producto</label>
            <input
              type="text"
              placeholder="Buscar nombre..."
              value={filters.producto_nombre ?? ''}
              onChange={(e) => set('producto_nombre', e.target.value)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00] w-44"
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

        {/* Supplier filter (compras only) */}
        {showSupplierFilter && filtros && filtros.proveedores.length > 0 && (
          <div>
            <label className="block text-[#7A9BAD] text-xs mb-1">Proveedor</label>
            <select
              value={filters.proveedor_id ?? ''}
              onChange={(e) => set('proveedor_id', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-[#1E3340] border border-[#32576F] text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#ED7C00]"
            >
              <option value="">Todos</option>
              {filtros.proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Gasto filters */}
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
