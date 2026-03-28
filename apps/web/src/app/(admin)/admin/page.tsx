import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { KpiCard } from '@/components/ui/Card';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, Th, Td } from '@/components/ui/Table';

async function getDashboardData(token: string) {
  const base = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const [tenantsRes, usersRes] = await Promise.allSettled([
      fetch(`${base}/api/v1/tenants?limit=5`, { headers, cache: 'no-store' }),
      fetch(`${base}/api/v1/users?limit=5`, { headers, cache: 'no-store' }),
    ]);

    const tenants = tenantsRes.status === 'fulfilled' && tenantsRes.value.ok
      ? await tenantsRes.value.json()
      : { items: [], total: 0 };

    const users = usersRes.status === 'fulfilled' && usersRes.value.ok
      ? await usersRes.value.json()
      : { items: [], total: 0 };

    return { tenants, users };
  } catch {
    return { tenants: { items: [], total: 0 }, users: { items: [], total: 0 } };
  }
}

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: { session } } = await supabase.auth.getSession();

  const { tenants, users } = await getDashboardData(session?.access_token ?? '');

  const totalClients: number = tenants.total ?? 0;
  const activeClients = tenants.items?.filter((t: { status: string }) => t.status === 'active').length ?? 0;
  const setupClients = tenants.items?.filter((t: { status: string }) => t.status === 'setup').length ?? 0;
  const suspendedClients = tenants.items?.filter((t: { status: string }) => t.status === 'suspended').length ?? 0;

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Dashboard"
        subtitle="Resumen de la plataforma"
        userEmail={user.email}
      />

      <main className="flex-1 px-6 py-6 space-y-6">
        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Clientes" value={totalClients || '—'} hint="Tenants registrados" />
          <KpiCard label="Clientes Activos" value={activeClients || '—'} hint="Con acceso completo" accent />
          <KpiCard label="En Setup" value={setupClients || '—'} hint="Pendientes de configuración" />
          <KpiCard label="Suspendidos" value={suspendedClients || '—'} hint="Acceso restringido" />
        </div>

        {/* Bottom section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent clients */}
          <div className="lg:col-span-2 bg-[#1E3340] border border-[#32576F] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#32576F] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Clientes Recientes</h2>
              <Link href="/admin/clientes" className="text-xs text-[#ED7C00] hover:underline">
                Ver todos →
              </Link>
            </div>
            {tenants.items?.length > 0 ? (
              <Table>
                <TableHead>
                  <tr>
                    <Th>Nombre</Th>
                    <Th>Plan</Th>
                    <Th>Estado</Th>
                    <Th>DB Azure</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {tenants.items.map((t: {
                    id: string; name: string; plan_name: string | null;
                    status: string; db_status: string | null;
                  }) => (
                    <TableRow key={t.id}>
                      <Td>
                        <Link href={`/admin/clientes/${t.id}`}
                          className="text-white hover:text-[#ED7C00] font-medium transition-colors">
                          {t.name}
                        </Link>
                      </Td>
                      <Td>{t.plan_name ?? '—'}</Td>
                      <Td><Badge variant={statusToBadgeVariant(t.status)} /></Td>
                      <Td>
                        {t.db_status
                          ? <Badge variant={statusToBadgeVariant(t.db_status)} />
                          : <span className="text-[#7A9BAD] text-xs">Sin config</span>}
                      </Td>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="px-5 py-10 text-center">
                <p className="text-[#7A9BAD] text-sm">No hay clientes registrados aún.</p>
                <Link href="/admin/clientes/nuevo"
                  className="mt-3 inline-block text-xs text-[#ED7C00] hover:underline">
                  Crear primer cliente →
                </Link>
              </div>
            )}
          </div>

          {/* Users quick view */}
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl">
            <div className="px-5 py-4 border-b border-[#32576F] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Usuarios del Sistema</h2>
              <Link href="/admin/usuarios" className="text-xs text-[#ED7C00] hover:underline">
                Ver todos →
              </Link>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between py-1 border-b border-[#32576F]/50">
                <span className="text-[#CDD4DA] text-sm">Total usuarios</span>
                <span className="text-white font-semibold">{users.total || '—'}</span>
              </div>
              <div className="space-y-2.5">
                {users.items?.slice(0, 5).map((u: {
                  id: string; full_name: string | null; email: string; role: string;
                }) => (
                  <div key={u.id} className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-[#32576F] flex items-center justify-center flex-shrink-0">
                      <span className="text-[#CDD4DA] text-xs font-medium">
                        {(u.full_name || u.email).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[#CDD4DA] text-xs truncate">{u.full_name || u.email}</p>
                      <p className="text-[#7A9BAD] text-xs capitalize">{u.role}</p>
                    </div>
                  </div>
                ))}
                {(users.items?.length ?? 0) === 0 && (
                  <p className="text-[#7A9BAD] text-xs text-center py-2">Sin usuarios</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
