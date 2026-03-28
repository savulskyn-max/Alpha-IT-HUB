'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { KpiCard } from '@/components/ui/Card';

export default function GastosPage() {
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
        const res = await fetch(`/api/v1/analytics/gastos?tenant_id=${tenantId}`, {
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

  const totalExpenses = (data as { total_gastos?: number })?.total_gastos;
  const ratio = (data as { ratio_gastos_ventas?: number })?.ratio_gastos_ventas;
  const dailyAvg = (data as { promedio_diario?: number })?.promedio_diario;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Total Gastos"
          value={totalExpenses != null ? `$${totalExpenses.toLocaleString()}` : '—'}
          hint="Egresos del período"
          accent
        />
        <KpiCard
          label="Ratio Gastos/Ventas"
          value={ratio != null ? `${(ratio * 100).toFixed(1)}%` : '—'}
          hint="Proporción sobre ventas"
        />
        <KpiCard
          label="Promedio Diario"
          value={dailyAvg != null ? `$${dailyAvg.toLocaleString()}` : '—'}
          hint="Gasto diario promedio"
        />
      </div>

      {!data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 text-center">
          <p className="text-[#7A9BAD] text-sm">
            No hay datos de gastos disponibles. Verifica que la base de datos Azure esté configurada correctamente.
          </p>
        </div>
      )}

      {data && (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
          <h3 className="text-white font-semibold text-sm mb-4">Resumen de Gastos</h3>
          <p className="text-[#7A9BAD] text-xs">
            Los gráficos detallados de distribución por tipo, método de pago y categoría se muestran
            cuando la conexión a la base de datos está activa.
          </p>
        </div>
      )}
    </div>
  );
}
