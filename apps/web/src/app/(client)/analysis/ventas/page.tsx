'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { KpiCard } from '@/components/ui/Card';

export default function VentasPage() {
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
        const res = await fetch(`/api/v1/analytics/ventas?tenant_id=${tenantId}`, {
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

  const totalSales = (data as { total_cobrado?: number })?.total_cobrado;
  const totalQty = (data as { cantidad_ventas?: number })?.cantidad_ventas;
  const avgTicket = (data as { ticket_promedio?: number })?.ticket_promedio;
  const dailyAvg = (data as { promedio_diario?: number })?.promedio_diario;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Cobrado"
          value={totalSales != null ? `$${totalSales.toLocaleString()}` : '—'}
          hint="Ingresos del período"
          accent
        />
        <KpiCard
          label="Cantidad de Ventas"
          value={totalQty ?? '—'}
          hint="Transacciones realizadas"
        />
        <KpiCard
          label="Ticket Promedio"
          value={avgTicket != null ? `$${avgTicket.toLocaleString()}` : '—'}
          hint="Promedio por venta"
        />
        <KpiCard
          label="Promedio Diario"
          value={dailyAvg != null ? `$${dailyAvg.toLocaleString()}` : '—'}
          hint="Ingreso diario promedio"
        />
      </div>

      {!data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 text-center">
          <p className="text-[#7A9BAD] text-sm">
            No hay datos de ventas disponibles. Verifica que la base de datos Azure esté configurada correctamente.
          </p>
        </div>
      )}

      {data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Resumen de Ventas</h3>
          <p className="text-[#7A9BAD] text-xs">
            Los gráficos detallados de ventas por canal, método de pago y producto top se muestran
            cuando la conexión a la base de datos está activa.
          </p>
        </div>
      )}
    </div>
  );
}
