'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { KpiCard } from '@/components/ui/Card';

export default function ComprasPage() {
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
        const res = await fetch(`/api/v1/analytics/compras?tenant_id=${tenantId}`, {
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

  const totalPurchases = (data as { total_compras?: number })?.total_compras;
  const orderCount = (data as { cantidad_ordenes?: number })?.cantidad_ordenes;
  const avgOrder = (data as { promedio_por_orden?: number })?.promedio_por_orden;
  const totalUnits = (data as { total_unidades?: number })?.total_unidades;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Compras"
          value={totalPurchases != null ? `$${totalPurchases.toLocaleString()}` : '—'}
          hint="Inversión del período"
          accent
        />
        <KpiCard
          label="Órdenes"
          value={orderCount ?? '—'}
          hint="Cantidad de órdenes"
        />
        <KpiCard
          label="Promedio por Orden"
          value={avgOrder != null ? `$${avgOrder.toLocaleString()}` : '—'}
          hint="Monto promedio"
        />
        <KpiCard
          label="Total Unidades"
          value={totalUnits ?? '—'}
          hint="Productos comprados"
        />
      </div>

      {!data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 text-center">
          <p className="text-[#7A9BAD] text-sm">
            No hay datos de compras disponibles. Verifica que la base de datos Azure esté configurada correctamente.
          </p>
        </div>
      )}

      {data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Resumen de Compras</h3>
          <p className="text-[#7A9BAD] text-xs">
            Los gráficos detallados de proveedores, productos top y tendencias se muestran
            cuando la conexión a la base de datos está activa.
          </p>
        </div>
      )}
    </div>
  );
}
