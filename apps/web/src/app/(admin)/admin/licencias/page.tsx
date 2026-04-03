import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';
import { KpiCard } from '@/components/ui/Card';
import { Table, TableHead, TableBody, TableRow, Th, Td } from '@/components/ui/Table';

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  plan_id: string | null;
  plan_name: string | null;
  status: string;
  billing_cycle: string | null;
  payment_provider: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  cancelled_at: string | null;
  created_at: string | null;
}

async function fetchSubscriptions(token: string): Promise<{ items: SubscriptionRow[]; total: number }> {
  const base = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/v1/subscriptions?limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

const billingCycleLabels: Record<string, string> = {
  monthly: 'Mensual',
  yearly: 'Anual',
};

const providerLabels: Record<string, string> = {
  stripe: 'Stripe',
  mercadopago: 'MercadoPago',
};

export default async function LicenciasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: { session } } = await supabase.auth.getSession();

  const data = await fetchSubscriptions(session?.access_token ?? '');
  const subs = data.items ?? [];

  const total = data.total ?? 0;
  const active = subs.filter((s) => s.status === 'active').length;
  const trialing = subs.filter((s) => s.status === 'trialing').length;
  const pastDue = subs.filter((s) => s.status === 'past_due').length;

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Licencias"
        subtitle={`${total} suscripciones registradas`}
        userEmail={user.email}
      />

      <main className="flex-1 px-6 py-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard label="Total" value={total} />
          <KpiCard label="Activas" value={active} accent />
          <KpiCard label="En prueba" value={trialing} />
          <KpiCard label="Pago vencido" value={pastDue} />
        </div>

        {/* Table */}
        {subs.length > 0 ? (
          <Table>
            <TableHead>
              <tr>
                <Th>Cliente</Th>
                <Th>Plan</Th>
                <Th>Estado</Th>
                <Th>Ciclo</Th>
                <Th>Proveedor</Th>
                <Th>Vence</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </TableHead>
            <TableBody>
              {subs.map((s) => (
                <TableRow key={s.id}>
                  <Td>
                    <Link
                      href={`/admin/clientes/${s.tenant_id}`}
                      className="font-medium text-white hover:text-[#ED7C00] transition-colors"
                    >
                      {s.tenant_name}
                    </Link>
                  </Td>
                  <Td>
                    {s.plan_name ?? <span className="text-[#7A9BAD]">Sin plan</span>}
                  </Td>
                  <Td>
                    <Badge variant={statusToBadgeVariant(s.status)} />
                  </Td>
                  <Td>
                    {s.billing_cycle
                      ? billingCycleLabels[s.billing_cycle] ?? s.billing_cycle
                      : <span className="text-[#7A9BAD]">—</span>}
                  </Td>
                  <Td>
                    {s.payment_provider
                      ? providerLabels[s.payment_provider] ?? s.payment_provider
                      : <span className="text-[#7A9BAD]">—</span>}
                  </Td>
                  <Td>
                    {s.current_period_end
                      ? new Date(s.current_period_end).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : <span className="text-[#7A9BAD]">—</span>}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/admin/clientes/${s.tenant_id}`}
                      className="text-[#7A9BAD] hover:text-[#ED7C00] transition-colors text-xs"
                    >
                      Ver cliente
                    </Link>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl px-6 py-16 text-center">
            <svg className="w-10 h-10 text-[#32576F] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-white font-medium mb-1">No hay suscripciones</p>
            <p className="text-[#7A9BAD] text-sm">
              Las suscripciones de los clientes aparecerán aquí.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
