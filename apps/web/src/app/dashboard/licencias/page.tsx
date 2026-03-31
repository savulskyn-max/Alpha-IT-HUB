import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { KpiCard } from '@/components/ui/Card';
import {
  licenseServerFetch,
  type LicenseDashboard,
  type Subscription,
} from '@/lib/licenseApi';
import { LicenciasClient } from './LicenciasClient';

export default async function LicenciasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let dashboard: LicenseDashboard | null = null;
  let subscriptions: Subscription[] = [];
  let error: string | null = null;

  try {
    [dashboard, subscriptions] = await Promise.all([
      licenseServerFetch<LicenseDashboard>('dashboard'),
      licenseServerFetch<Subscription[]>('subscriptions'),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Error al cargar datos';
  }

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Licencias"
        subtitle={`${subscriptions.length} suscripciones registradas`}
        userEmail={user.email}
      />

      <main className="flex-1 px-6 py-6 space-y-6">
        {error ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : (
          <>
            {/* KPI Grid */}
            {dashboard && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Suscripciones Activas"
                  value={dashboard.activeSubscriptions}
                  hint={`de ${dashboard.totalSubscriptions} totales`}
                  accent
                />
                <KpiCard
                  label="Expiradas"
                  value={dashboard.expiredSubscriptions}
                  hint="Requieren renovacion"
                />
                <KpiCard
                  label="Revocadas"
                  value={dashboard.revokedSubscriptions}
                  hint="Acceso bloqueado"
                />
                <KpiCard
                  label="Dispositivos"
                  value={`${dashboard.totalDevices} / ${dashboard.totalMaxDevices}`}
                  hint="Activos / Permitidos"
                />
              </div>
            )}

            {/* Interactive table with actions */}
            <LicenciasClient initialData={subscriptions} />
          </>
        )}
      </main>
    </div>
  );
}
