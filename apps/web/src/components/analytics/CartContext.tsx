'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface CartTalle {
  talleId: number | null;   // null = talle agregado manualmente
  talle: string;
  cantidad: number;
  pctDemanda: number;
}

export interface CartItem {
  id: string;                    // `${descripcionId}-${colorId}`
  productoNombreId: number;
  nombre: string;
  descripcionId: number;
  descripcion: string;
  colorId: number;
  color: string;
  talles: CartTalle[];
  precioUnitario: number;        // costo de compra real (AVG PrecioCompra) o manual
  precioManual: boolean;         // true si el usuario ingresó precio manualmente
  proveedorId: number | null;
  proveedor: string | null;
  fechaPlanificada: string;      // ISO date "2026-04-02"
}

interface CartCtx {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  updateItem: (id: string, updates: Partial<CartItem>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  isOpen: boolean;
  setOpen: (v: boolean) => void;
}

const CartContext = createContext<CartCtx | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setOpen] = useState(false);

  const addItem = useCallback((item: CartItem) => {
    setItems(prev => {
      const exists = prev.find(i => i.id === item.id);
      return exists ? prev.map(i => i.id === item.id ? item : i) : [...prev, item];
    });
    setOpen(true);
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<CartItem>) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i)), []);

  const removeItem = useCallback((id: string) =>
    setItems(prev => prev.filter(i => i.id !== id)), []);

  const clearCart = useCallback(() => setItems([]), []);

  return (
    <CartContext.Provider value={{ items, addItem, updateItem, removeItem, clearCart, isOpen, setOpen }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
