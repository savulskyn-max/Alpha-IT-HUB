'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type KpiSummary } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/format';
import { TrendingUp, ShoppingBag, DollarSign, Percent, Loader2 } from 'lucide-react';

export default function DashboardPage() {
  const { user, tenant, loading: authLoading } = useAuth();
  const [kpis, setKpis] = useState<KpiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    setLoading(true);
    api.analytics.kpis(tenant.id)
      .then(setKpis)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tenant?.id]);

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const userName = user?.full_name || 'Usuario';

  const kpiCards = kpis
    ? [
        { label: 'Ventas del día', value: formatMoney(kpis.ventas_hoy), icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-50' },
        { label: 'Ventas del mes', value: formatMoney(kpis.ventas_mes), icon: ShoppingBag, color: 'text-blue-500', bg: 'bg-blue-50' },
        { label: 'Gastos del mes', value: formatMoney(kpis.gastos_mes), icon: DollarSign, color: 'text-red-500', bg: 'bg-red-50' },
        { label: 'Margen del mes', value: formatMoney(kpis.margen_mes), icon: Percent, color: 'text-purple-500', bg: 'bg-purple-50' },
        { label: 'Cantidad ventas', value: formatNumber(kpis.cantidad_ventas_mes), icon: ShoppingBag, color: 'text-indigo-500', bg: 'bg-indigo-50' },
        { label: 'Ticket promedio', value: formatMoney(kpis.ticket_promedio), icon: TrendingUp, color: 'text-amber-500', bg: 'bg-amber-50' },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-[#132229]">
          Hola, {authLoading ? '...' : userName}!
        </h1>
        <p className="text-gray-500 text-sm capitalize">{today}</p>
      </div>

      {/* KPI cards */}
      {loading || authLoading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Cargando indicadores...</span>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar los KPIs: {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {kpiCards.map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-gray-500 text-sm">{kpi.label}</span>
                <div className={`w-9 h-9 rounded-lg ${kpi.bg} flex items-center justify-center`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-[#132229]">{kpi.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
