'use client';

import { useAuth } from '@/hooks/useAuth';
import { Loader2, Package } from 'lucide-react';

export default function StockPage() {
  const { loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-[#32576F]/10 flex items-center justify-center mx-auto mb-4">
          <Package className="w-7 h-7 text-[#32576F]" />
        </div>
        <h3 className="text-lg font-semibold text-[#132229] mb-2">Análisis de Stock</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          El módulo de stock se habilitará próximamente con datos en tiempo real de tu inventario,
          alertas de bajo stock y análisis de rotación de productos.
        </p>
      </div>
    </div>
  );
}
