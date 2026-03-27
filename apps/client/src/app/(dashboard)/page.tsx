'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TrendingUp, ShoppingBag, Package, AlertTriangle } from 'lucide-react';

export default function DashboardPage() {
  const [userName, setUserName] = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserName(user?.user_metadata?.full_name || 'Usuario');
    });
  }, [supabase.auth]);

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const kpis = [
    { label: 'Ventas del día', value: '—', icon: TrendingUp, color: 'text-green-500' },
    { label: 'Ventas del mes', value: '—', icon: ShoppingBag, color: 'text-blue-500' },
    { label: 'Stock total', value: '—', icon: Package, color: 'text-purple-500' },
    { label: 'Bajo stock', value: '—', icon: AlertTriangle, color: 'text-orange-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-[#132229]">Hola, {userName}!</h1>
        <p className="text-gray-500 text-sm capitalize">{today}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-sm">{kpi.label}</span>
              <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
            </div>
            <p className="text-2xl font-bold text-[#132229]">{kpi.value}</p>
            <p className="text-xs text-gray-400 mt-1">Conectando datos...</p>
          </div>
        ))}
      </div>

      {/* Placeholder chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-[#132229] font-semibold mb-4">Ventas últimos 7 días</h3>
        <div className="h-48 flex items-center justify-center text-gray-400">
          Los datos se cargarán cuando se conecte el análisis de ventas
        </div>
      </div>

      {/* Alerts placeholder */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-[#132229] font-semibold mb-4">Alertas recientes</h3>
        <div className="text-gray-400 text-sm">
          Sin alertas por el momento
        </div>
      </div>
    </div>
  );
}
