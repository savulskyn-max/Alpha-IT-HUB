'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useCart, type CartItem, type CartTalle } from './CartContext';

const fmtM = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;
const subtotal = (item: CartItem) => item.talles.reduce((s, t) => s + t.cantidad, 0) * item.precioUnitario;

// ── Date helpers ─────────────────────────────────────────────────────────────
function defaultFecha(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

// ── Edit modal per item ──────────────────────────────────────────────────────
function EditModal({ item, onClose, onSave }: { item: CartItem; onClose: () => void; onSave: (updated: Partial<CartItem>) => void }) {
  const [talles, setTalles] = useState<CartTalle[]>(item.talles.map(t => ({ ...t })));
  const [precio, setPrecio] = useState(item.precioUnitario);
  const [precioManual, setPrecioManual] = useState(item.precioManual);
  const [fecha, setFecha] = useState(item.fechaPlanificada);
  const [nuevoTalle, setNuevoTalle] = useState('');

  const setQty = (talle: string, v: string) => {
    const n = Math.max(0, parseInt(v) || 0);
    setTalles(prev => prev.map(t => t.talle === talle ? { ...t, cantidad: n } : t));
  };

  const addTalle = () => {
    const t = nuevoTalle.trim();
    if (!t || talles.some(x => x.talle === t)) return;
    setTalles(prev => [...prev, { talleId: null, talle: t, cantidad: 1, pctDemanda: 0 }]);
    setNuevoTalle('');
  };

  const total = talles.reduce((s, t) => s + t.cantidad, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0E1F29] border border-[#32576F] rounded-xl p-4 w-96 max-h-[90vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-white text-xs font-semibold">{item.descripcion} · {item.color}</p>
          <button onClick={onClose} className="text-[#7A9BAD] hover:text-white text-xs">✕</button>
        </div>

        {/* Talles grid */}
        <div>
          <p className="text-[#7A9BAD] text-[10px] font-semibold uppercase tracking-wide mb-1.5">Talles — cantidad por talle</p>
          <div className="grid grid-cols-4 gap-1.5">
            {talles.map(t => (
              <div key={t.talle} className="flex flex-col gap-0.5">
                <span className="text-[#7A9BAD] text-[10px] text-center truncate">{t.talle}</span>
                <input
                  type="number" min={0} value={t.cantidad}
                  onChange={e => setQty(t.talle, e.target.value)}
                  className="w-full bg-[#132229] border border-[#32576F] text-white text-xs text-center rounded px-1 py-1 focus:border-[#ED7C00] outline-none"
                />
              </div>
            ))}
          </div>
          {/* Add manual talle */}
          <div className="flex items-center gap-1.5 mt-2">
            <input
              type="text" value={nuevoTalle} placeholder="Nuevo talle..."
              onChange={e => setNuevoTalle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTalle()}
              className="flex-1 bg-[#132229] border border-[#32576F] text-white text-xs rounded px-2 py-1 focus:border-[#ED7C00] outline-none placeholder:text-[#4A7A96]"
            />
            <button onClick={addTalle} className="text-[10px] text-[#ED7C00] hover:text-white transition-colors px-2 py-1 border border-[#ED7C00]/40 rounded">+</button>
          </div>
        </div>

        {/* Precio unitario */}
        <div>
          <p className="text-[#7A9BAD] text-[10px] font-semibold uppercase tracking-wide mb-1">Costo unit. estimado</p>
          <div className="flex items-center gap-2">
            {!precioManual && precio > 0 && (
              <span className="text-green-400/80 text-[10px]">Precio real</span>
            )}
            {precioManual && (
              <span className="text-yellow-400/80 text-[10px]">Manual</span>
            )}
            {!precioManual && precio === 0 && (
              <span className="text-red-400/80 text-[10px]">Sin precio ref.</span>
            )}
            <input
              type="number" min={0} value={precio}
              onChange={e => { setPrecio(parseFloat(e.target.value) || 0); setPrecioManual(true); }}
              className="w-28 bg-[#132229] border border-[#32576F] text-white text-xs text-right rounded px-2 py-1 focus:border-[#ED7C00] outline-none ml-auto"
            />
          </div>
        </div>

        {/* Fecha planificada */}
        <div>
          <p className="text-[#7A9BAD] text-[10px] font-semibold uppercase tracking-wide mb-1">Fecha estimada de compra</p>
          <input
            type="date" value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="w-full bg-[#132229] border border-[#32576F] text-white text-xs rounded px-2 py-1.5 focus:border-[#ED7C00] outline-none"
          />
        </div>

        <div className="text-[10px] text-[#7A9BAD]">
          {total} un. × {fmtM(precio)} = <span className="text-white font-bold">{fmtM(total * precio)}</span>
        </div>

        <button
          onClick={() => { onSave({ talles, precioUnitario: precio, precioManual, fechaPlanificada: fecha }); onClose(); }}
          className="w-full bg-[#ED7C00]/15 border border-[#ED7C00]/50 text-[#ED7C00] text-xs py-1.5 rounded-lg hover:bg-[#ED7C00]/25 transition-colors"
        >
          Guardar cambios
        </button>
      </div>
    </div>
  );
}

// ── Provider group ───────────────────────────────────────────────────────────
function ProveedorGroup({ proveedor, items }: { proveedor: string | null; items: CartItem[] }) {
  const { updateItem, removeItem } = useCart();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editItem = items.find(i => i.id === editingId);
  const groupTotal = items.reduce((s, i) => s + subtotal(i), 0);
  const groupUnits = items.reduce((s, i) => s + i.talles.reduce((ss, t) => ss + t.cantidad, 0), 0);

  return (
    <div className="space-y-1.5">
      {proveedor && (
        <p className="text-[10px] text-[#7A9BAD] font-semibold uppercase tracking-wide px-1">
          Proveedor: {proveedor}
        </p>
      )}
      {items.map(item => {
        const units = item.talles.reduce((s, t) => s + t.cantidad, 0);
        return (
          <div key={item.id} className="bg-[#132229] border border-[#32576F]/50 rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0">
                <p className="text-white text-[11px] font-medium truncate">{item.nombre}</p>
                <p className="text-[#7A9BAD] text-[10px]">{item.descripcion} · {item.color}</p>
              </div>
              <button onClick={() => removeItem(item.id)} className="text-[#7A9BAD] hover:text-red-400 text-[10px] flex-shrink-0 transition-colors">✕</button>
            </div>
            {/* Talles summary */}
            <p className="text-[#CDD4DA] text-[10px] font-mono leading-snug">
              {item.talles.filter(t => t.cantidad > 0).map(t => `${t.talle}(${t.cantidad})`).join(' ')}
            </p>
            {/* Price */}
            <div className="flex items-center gap-1.5">
              {item.precioUnitario > 0 ? (
                <span className={`text-[10px] ${item.precioManual ? 'text-yellow-400/80' : 'text-green-400/80'}`}>
                  {item.precioManual ? 'Manual' : 'Costo unit.'}: {fmtM(item.precioUnitario)}
                </span>
              ) : (
                <span className="text-red-400/80 text-[10px]">Sin precio ref.</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#7A9BAD] text-[10px]">{units} un. × {fmtM(item.precioUnitario)}</span>
              <span className="text-white text-[10px] font-bold">{fmtM(subtotal(item))}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#7A9BAD] text-[10px]">Compra: {item.fechaPlanificada}</span>
              <button
                onClick={() => setEditingId(item.id)}
                className="text-[10px] text-[#7A9BAD] hover:text-[#ED7C00] transition-colors underline"
              >
                Editar
              </button>
            </div>
          </div>
        );
      })}
      {items.length > 1 && (
        <div className="flex justify-between px-1 text-[10px] text-[#7A9BAD]">
          <span>Subtotal proveedor</span>
          <span className="text-white font-bold">{groupUnits} un. · {fmtM(groupTotal)}</span>
        </div>
      )}
      {editItem && (
        <EditModal
          item={editItem}
          onClose={() => setEditingId(null)}
          onSave={updates => updateItem(editingId!, updates)}
        />
      )}
    </div>
  );
}

// ── Global date control ──────────────────────────────────────────────────────
function GlobalDateControl({ items, onApply }: { items: CartItem[]; onApply: (fecha: string) => void }) {
  const [fecha, setFecha] = useState(items[0]?.fechaPlanificada ?? defaultFecha());
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="text-[#7A9BAD] text-[10px] whitespace-nowrap">Fecha global:</span>
      <input
        type="date" value={fecha}
        onChange={e => setFecha(e.target.value)}
        className="flex-1 bg-[#132229] border border-[#32576F] text-white text-xs rounded px-2 py-1 focus:border-[#ED7C00] outline-none"
      />
      <button
        onClick={() => onApply(fecha)}
        className="text-[10px] text-[#ED7C00] hover:text-white border border-[#ED7C00]/40 px-2 py-1 rounded transition-colors"
      >
        Aplicar a todos
      </button>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface CartPanelProps {
  tenantId: string;
  onSaved?: () => void;
}

export default function CartPanel({ tenantId, onSaved }: CartPanelProps) {
  const { items, updateItem, clearCart, isOpen, setOpen } = useCart();
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const totalUnits = items.reduce((s, i) => s + i.talles.reduce((ss, t) => ss + t.cantidad, 0), 0);
  const totalInv = items.reduce((s, i) => s + subtotal(i), 0);

  // Group by proveedor
  const groups = items.reduce<Record<string, CartItem[]>>((acc, item) => {
    const key = item.proveedor ?? '__sin_proveedor__';
    return { ...acc, [key]: [...(acc[key] ?? []), item] };
  }, {});

  const applyGlobalDate = (fecha: string) => {
    items.forEach(item => updateItem(item.id, { fechaPlanificada: fecha }));
  };

  // Save: one OrdenCompraPlan per Nombre+Talle with cantidad > 0
  const saveOrden = async () => {
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];
      for (const item of items) {
        for (const t of item.talles) {
          if (t.cantidad <= 0) continue;
          promises.push(
            api.analytics.createCalendarOrder(tenantId, {
              producto_nombre_id: item.productoNombreId,
              fecha_emision: item.fechaPlanificada,
              cantidad: t.cantidad,
              costo_unitario: item.precioUnitario > 0 ? item.precioUnitario : undefined,
              estado: 'planificada',
              notas: `${item.descripcion} · ${item.color} · ${t.talle}`,
            })
          );
        }
      }
      await Promise.all(promises);
      clearCart();
      setOpen(false);
      setToast('Orden planificada guardada');
      setTimeout(() => setToast(''), 3000);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  // Toast notification
  if (toast) {
    return (
      <div className="fixed bottom-6 right-6 z-50 bg-green-600/90 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-lg">
        {toast}
      </div>
    );
  }

  if (!isOpen) {
    return items.length > 0 ? (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#ED7C00] text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-lg hover:bg-[#ED7C00]/90 transition-colors"
      >
        🛒 {items.length} {items.length === 1 ? 'item' : 'items'} · {fmtM(totalInv)}
      </button>
    ) : null;
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
      <div className="fixed right-0 top-0 h-full z-50 w-96 bg-[#0B1921] border-l border-[#32576F] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#32576F]">
          <span className="text-white text-sm font-semibold">🛒 Orden de compra ({items.length})</span>
          <button onClick={() => setOpen(false)} className="text-[#7A9BAD] hover:text-white transition-colors">✕</button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {items.length === 0 ? (
            <p className="text-[#7A9BAD] text-xs text-center py-8">El carrito está vacío</p>
          ) : (
            <>
              {/* Global date control */}
              <GlobalDateControl items={items} onApply={applyGlobalDate} />

              {Object.entries(groups).map(([prov, provItems]) => (
                <ProveedorGroup
                  key={prov}
                  proveedor={prov === '__sin_proveedor__' ? null : prov}
                  items={provItems}
                />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-[#32576F] px-4 py-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-[#7A9BAD]">Total</span>
              <span className="text-white font-bold">{totalUnits} un. · {fmtM(totalInv)}</span>
            </div>
            <button
              onClick={saveOrden} disabled={saving}
              className="w-full bg-[#ED7C00]/15 border border-[#ED7C00]/50 text-[#ED7C00] text-xs py-2 rounded-lg hover:bg-[#ED7C00]/25 transition-colors disabled:opacity-50"
            >
              {saving ? 'Guardando...' : 'Guardar como orden planificada'}
            </button>
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="flex-1 border border-[#32576F] text-[#7A9BAD] text-xs py-1.5 rounded-lg hover:border-[#4A7A96] transition-colors">
                Exportar PDF
              </button>
              <button onClick={clearCart} className="flex-1 border border-red-500/30 text-red-400 text-xs py-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                Limpiar
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
