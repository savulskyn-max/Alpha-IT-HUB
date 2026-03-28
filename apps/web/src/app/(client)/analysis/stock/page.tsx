'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { KpiCard } from '@/components/ui/Card';

export default function StockPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      const tenantId = user?.app_metadata?.tenant_id ?? user?.user_metadata?.tenant_id;

      if (!tenantId || !session) {
        setLoading(false);
        return;
      }

      try {
        const base = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_BACKEND_URL ?? '');
        const res = await fetch(`${base}/api/v1/analytics/stock?tenant_id=${tenantId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) setData(await res.json());
      } catch {
        // API not available
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stockValue = (data as { stock_value?: number })?.stock_value;
  const rotation = (data as { monthly_rotation?: number })?.monthly_rotation;
  const totalSkus = (data as { total_skus?: number })?.total_skus;
  const alerts = (data as { urgent_alerts?: number })?.urgent_alerts;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Stock Valorizado"
          value={stockValue != null ? `$${stockValue.toLocaleString()}` : '—'}
          hint="Valor total del inventario"
          accent
        />
        <KpiCard
          label="Rotación Mensual"
          value={rotation != null ? `${rotation.toFixed(1)}x` : '—'}
          hint="Veces que rota el stock"
        />
        <KpiCard
          label="SKUs Activos"
          value={totalSkus ?? '—'}
          hint="Productos con stock"
        />
        <KpiCard
          label="Alertas Urgentes"
          value={alerts ?? '—'}
          hint="Requieren atención"
        />
      </div>

      {!data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 text-center">
          <p className="text-[#7A9BAD] text-sm">
            No hay datos de stock disponibles. Verifica que la base de datos Azure esté configurada correctamente.
          </p>
        </div>
      )}

      {data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Resumen de Inventario</h3>
          <p className="text-[#7A9BAD] text-xs">
            Los datos detallados de stock, análisis ABC y recomendaciones de compra se encuentran disponibles
            cuando la conexión a la base de datos está activa.
          </p>
        </div>
      )}
    </div>
  );
}
