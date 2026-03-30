import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';

export default async function AnaliticaOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Analítica"
        subtitle="Panel de análisis del negocio"
        userEmail={user.email}
        actions={
          <Link
            href={`/admin/clientes/${id}`}
            className="text-[#7A9BAD] hover:text-white text-sm transition-colors"
          >
            ← Volver al cliente
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="max-w-4xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { href: 'ventas', label: 'Ventas', desc: 'Ingresos, ticket promedio, desglose por local y método de pago', color: 'text-green-400', border: 'border-green-400/30' },
              { href: 'gastos', label: 'Gastos', desc: 'Gastos por categoría y método de pago. Ratio vs ventas', color: 'text-red-400', border: 'border-red-400/30' },
              { href: 'stock', label: 'Stock y Predicciones', desc: 'Niveles actuales, rotación, análisis ABC y compras recomendadas por horizonte de días', color: 'text-blue-400', border: 'border-blue-400/30' },
              { href: 'compras', label: 'Compras', desc: 'Compras por período y top productos más comprados', color: 'text-[#ED7C00]', border: 'border-[#ED7C00]/30' },
            ].map((section) => (
              <Link
                key={section.href}
                href={`/admin/clientes/${id}/analitica/${section.href}`}
                className={`block p-5 bg-[#1E3340] border ${section.border} rounded-2xl hover:opacity-80 transition-opacity`}
              >
                <p className={`font-semibold text-base ${section.color} mb-1`}>{section.label}</p>
                <p className="text-[#7A9BAD] text-sm">{section.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
