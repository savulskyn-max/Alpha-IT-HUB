'use client';

import { useState, useRef, useEffect } from 'react';
import type { StockAnalysisProducto } from '@/lib/api';

const ESTADO_DOT: Record<string, string> = {
  CRITICO: 'bg-[#ED7C00]',
  BAJO:    'bg-[#D4A017]',
  OK:      'bg-[#2ECC71]',
  EXCESO:  'bg-[#5B9BD5]',
};

interface Props {
  productos: StockAnalysisProducto[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export default function ProductSelector({ productos, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sorted = [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const filtered = search
    ? sorted.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const selected = productos.find(p => p.producto_nombre_id === selectedId);

  function pick(id: number) {
    onSelect(id);
    setSearch('');
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative min-w-[240px] max-w-sm flex-1">
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 bg-[#0E1F29] border border-[#32576F] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#ED7C00] hover:border-[#4A7A96] transition-colors"
      >
        {selected ? (
          <>
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${ESTADO_DOT[selected.estado] ?? 'bg-[#2ECC71]'}`}
            />
            <span className="text-white flex-1 text-left truncate">{selected.nombre}</span>
            <span className="text-[#7A9BAD] text-xs flex-shrink-0">
              {selected.stock_total} un.
            </span>
          </>
        ) : (
          <span className="text-[#7A9BAD] flex-1 text-left">Seleccionar producto...</span>
        )}
        <svg className={`w-4 h-4 text-[#7A9BAD] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0E1F29] border border-[#32576F] rounded-lg shadow-2xl flex flex-col">
          <div className="p-2 border-b border-[#32576F]">
            <input
              autoFocus
              type="text"
              placeholder="Buscar..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#071219] border border-[#32576F] text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:border-[#ED7C00] placeholder-[#7A9BAD]"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-[#7A9BAD] text-xs">Sin resultados</p>
            )}
            {filtered.map(p => (
              <button
                key={p.producto_nombre_id}
                onClick={() => pick(p.producto_nombre_id)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[#1E3340] transition-colors ${
                  selectedId === p.producto_nombre_id ? 'bg-[#1E3340]' : ''
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ESTADO_DOT[p.estado] ?? 'bg-[#2ECC71]'}`} />
                <span className="text-white flex-1 truncate">{p.nombre}</span>
                <span className="text-[#7A9BAD] text-xs flex-shrink-0">{p.stock_total} un.</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
