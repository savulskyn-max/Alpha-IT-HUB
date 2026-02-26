import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-[#132229]">
      {/* Header */}
      <header className="border-b border-[#32576F] bg-[#1E3340] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ED7C00] flex items-center justify-center text-white font-bold text-sm">
              α
            </div>
            <span className="font-semibold text-white">Alpha IT Hub</span>
            <span className="text-[#7A9BAD] text-sm">— Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[#CDD4DA] text-sm">{user.email}</span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-[#7A9BAD] hover:text-[#ED7C00] text-sm transition-colors"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-[#CDD4DA] mb-8">Bienvenido al panel de administración de Alpha IT Hub.</p>

        {/* KPI placeholder grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'MRR', value: '—', hint: 'Ingresos recurrentes mensuales' },
            { label: 'Clientes activos', value: '—', hint: 'Tenants con acceso activo' },
            { label: 'En setup', value: '—', hint: 'Esperando configuración' },
            { label: 'Suspendidos', value: '—', hint: 'Acceso suspendido' },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5"
            >
              <p className="text-[#7A9BAD] text-xs font-medium uppercase tracking-wide mb-2">
                {kpi.label}
              </p>
              <p className="text-3xl font-bold text-white mb-1">{kpi.value}</p>
              <p className="text-[#CDD4DA] text-xs">{kpi.hint}</p>
            </div>
          ))}
        </div>

        {/* Coming soon notice */}
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 text-center">
          <div className="text-4xl mb-4">🚀</div>
          <h2 className="text-lg font-semibold text-white mb-2">Fase 5 — Panel Admin</h2>
          <p className="text-[#CDD4DA] text-sm max-w-md mx-auto">
            El dashboard completo con gestión de clientes, agentes, configuración de bases de datos y
            cobros estará disponible en la Fase 5 del desarrollo.
          </p>
        </div>
      </main>
    </div>
  );
}
