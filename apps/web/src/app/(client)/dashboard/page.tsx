import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { KpiCard } from '@/components/ui/Card';
import { getUserTenantId, fetchUserProfile } from '@/lib/auth';

async function getClientDashboardData(token: string, tenantId: string | null) {
  if (!tenantId) return null;

  const base = (process.env.NEXT_PUBLIC_BACKEND_URL ?? process.env.BACKEND_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const res = await fetch(`${base}/api/v1/tenants/${tenantId}`, {
      headers,
      cache: 'no-store',
    });
    if (res.ok) return await res.json();
  } catch {
    // fall through
  }
  return null;
}

export default async function ClientDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: { session } } = await supabase.auth.getSession();

  // Resolve tenant_id: JWT claim → user metadata → backend /auth/me
  let tenantId = getUserTenantId(user, session);
  if (!tenantId && session?.access_token) {
    const profile = await fetchUserProfile(session.access_token);
    if (profile?.tenant_id) tenantId = profile.tenant_id;
  }
  const tenant = await getClientDashboardData(session?.access_token ?? '', tenantId);

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Dashboard"
        subtitle="Resumen de tu tienda"
        userEmail={user.email}
      />

      <main className="flex-1 px-6 py-6 space-y-6">
        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Ventas del Mes" value="—" hint="Total facturado" accent />
          <KpiCard label="Productos" value="—" hint="SKUs activos" />
          <KpiCard label="Stock Valorizado" value="—" hint="Valor total inventario" />
          <KpiCard label="Ticket Promedio" value="—" hint="Promedio por venta" />
        </div>

        {/* Quick access */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link href="/analysis/stock" className="group">
            <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 hover:border-[#ED7C00] transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#ED7C00]/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#ED7C00]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h3 className="text-white font-semibold text-sm group-hover:text-[#ED7C00] transition-colors">
                  Stock
                </h3>
              </div>
              <p className="text-[#7A9BAD] text-xs">
                Inventario, rotación y recomendaciones de reposición
              </p>
            </div>
          </Link>

          <Link href="/analysis/ventas" className="group">
            <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 hover:border-[#ED7C00] transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#ED7C00]/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#ED7C00]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-white font-semibold text-sm group-hover:text-[#ED7C00] transition-colors">
                  Ventas
                </h3>
              </div>
              <p className="text-[#7A9BAD] text-xs">
                Análisis de ingresos, tickets y rendimiento por canal
              </p>
            </div>
          </Link>

          <Link href="/analysis/gastos" className="group">
            <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 hover:border-[#ED7C00] transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#ED7C00]/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#ED7C00]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                  </svg>
                </div>
                <h3 className="text-white font-semibold text-sm group-hover:text-[#ED7C00] transition-colors">
                  Gastos
                </h3>
              </div>
              <p className="text-[#7A9BAD] text-xs">
                Control de egresos, categorías y ratios de gastos
              </p>
            </div>
          </Link>

          <Link href="/analysis/compras" className="group">
            <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 hover:border-[#ED7C00] transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#ED7C00]/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#ED7C00]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                  </svg>
                </div>
                <h3 className="text-white font-semibold text-sm group-hover:text-[#ED7C00] transition-colors">
                  Compras
                </h3>
              </div>
              <p className="text-[#7A9BAD] text-xs">
                Órdenes de compra, proveedores y concentración
              </p>
            </div>
          </Link>

          <Link href="/agents" className="group">
            <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 hover:border-[#ED7C00] transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#ED7C00]/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#ED7C00]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.375 3.375 0 01-4.06.44L12 17m0 0l-.47.53a3.375 3.375 0 01-4.06.44L5 14.5m7 2.5v4.25" />
                  </svg>
                </div>
                <h3 className="text-white font-semibold text-sm group-hover:text-[#ED7C00] transition-colors">
                  Agentes IA
                </h3>
              </div>
              <p className="text-[#7A9BAD] text-xs">
                Asistentes inteligentes para tu negocio
              </p>
            </div>
          </Link>
        </div>

        {/* Tenant info */}
        {tenant && (
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white mb-3">Mi Empresa</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-[#7A9BAD] text-xs">Nombre</p>
                <p className="text-[#CDD4DA]">{tenant.name ?? '—'}</p>
              </div>
              <div>
                <p className="text-[#7A9BAD] text-xs">Plan</p>
                <p className="text-[#CDD4DA]">{tenant.plan_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-[#7A9BAD] text-xs">Estado</p>
                <p className="text-[#CDD4DA] capitalize">{tenant.status ?? '—'}</p>
              </div>
              <div>
                <p className="text-[#7A9BAD] text-xs">Base de Datos</p>
                <p className="text-[#CDD4DA] capitalize">{tenant.db_status ?? 'Sin configurar'}</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
