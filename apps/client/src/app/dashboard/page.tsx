'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type KpiSummary } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/format';
import { TrendingUp, ShoppingBag, DollarSign, Percent, Loader2, Store, Users, AlertCircle } from 'lucide-react';
import Link from 'next/link';

// ── Admin Dashboard ──────────────────────────────────────────────────────────

function AdminDashboard({ userName }: { userName: string }) {
  const [stats, setStats] = useState<{ tenants: number; users: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.admin.tenants().catch(() => []),
      api.admin.users().catch(() => []),
    ]).then(([tenants, users]) => {
      setStats({ tenants: tenants.length, users: users.length });
      setLoading(false);
    });
  }, []);

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#132229]">Hola, {userName}!</h1>
        <p className="text-gray-500 text-sm capitalize">{today}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Cargando plataforma...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-sm">Total Clientes</span>
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <Store className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#132229]">{stats?.tenants ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-sm">Total Usuarios</span>
              <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-500" />
              </div>
            </div>
            <p className="text-2xl font-bold text-[#132229]">{stats?.users ?? 0}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/dashboard/clients" className="bg-white rounded-xl border border-gray-200 p-6 hover:border-[#ED7C00]/50 transition-colors">
          <Store className="w-8 h-8 text-[#32576F] mb-3" />
          <h3 className="text-lg font-semibold text-[#132229] mb-1">Gestionar Clientes</h3>
          <p className="text-gray-500 text-sm">Ver, crear y configurar clientes y sus bases de datos</p>
        </Link>
        <Link href="/dashboard/users" className="bg-white rounded-xl border border-gray-200 p-6 hover:border-[#ED7C00]/50 transition-colors">
          <Users className="w-8 h-8 text-[#32576F] mb-3" />
          <h3 className="text-lg font-semibold text-[#132229] mb-1">Gestionar Usuarios</h3>
          <p className="text-gray-500 text-sm">Administrar usuarios, roles y permisos de la plataforma</p>
        </Link>
      </div>
    </div>
  );
}

// ── Client Dashboard ─────────────────────────────────────────────────────────

function ClientDashboard({ userName, tenantId }: { userName: string; tenantId: string | null }) {
  const [kpis, setKpis] = useState<KpiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.analytics.kpis(tenantId)
      .then(setKpis)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

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
      <div>
        <h1 className="text-2xl font-bold text-[#132229]">Hola, {userName}!</h1>
        <p className="text-gray-500 text-sm capitalize">{today}</p>
      </div>

      {!tenantId ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <p className="text-yellow-800 font-medium">Cuenta en configuración</p>
            <p className="text-yellow-700 text-sm">Tu cuenta aún no tiene un negocio asociado. Contactá al administrador.</p>
          </div>
        </div>
      ) : loading ? (
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

// ── Main ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, tenant, loading: authLoading, isAdmin } = useAuth();
  const userName = user?.full_name || 'Usuario';

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-8">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando...</span>
      </div>
    );
  }

  if (isAdmin) {
    return <AdminDashboard userName={userName} />;
  }

  return <ClientDashboard userName={userName} tenantId={tenant?.id ?? user?.tenant_id ?? null} />;
}
