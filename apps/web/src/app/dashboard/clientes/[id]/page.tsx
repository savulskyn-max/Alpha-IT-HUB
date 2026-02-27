import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, Th, Td } from '@/components/ui/Table';
import { ClienteTabs } from './ClienteTabs';

async function fetchTenant(token: string, id: string) {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  const res = await fetch(`${base}/api/v1/tenants/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json();
}

async function fetchTenantUsers(token: string, tenantId: string) {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  try {
    const res = await fetch(`${base}/api/v1/users?tenant_id=${tenantId}&limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

async function fetchDbConfig(token: string, tenantId: string) {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  try {
    const res = await fetch(`${base}/api/v1/azure-db/${tenantId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const roleLabels: Record<string, string> = {
  owner: 'Propietario', manager: 'Gerente', staff: 'Staff',
  admin: 'Admin', superadmin: 'Super Admin',
};

export default async function ClienteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? '';

  const [tenant, usersData, dbConfig] = await Promise.all([
    fetchTenant(token, id),
    fetchTenantUsers(token, id),
    fetchDbConfig(token, id),
  ]);

  if (!tenant) notFound();

  const tenantUsers: Array<{
    id: string; email: string; full_name: string | null; role: string;
  }> = usersData?.items ?? [];

  return (
    <div className="flex flex-col flex-1">
      <Header
        title={tenant.name}
        subtitle={`Cliente · ${tenant.slug}`}
        userEmail={user.email}
        actions={
          <Link href="/dashboard/clientes"
            className="text-[#7A9BAD] hover:text-white text-sm transition-colors">
            ← Volver
          </Link>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="max-w-4xl space-y-6">
          {/* Summary card */}
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Estado</p>
                <Badge variant={statusToBadgeVariant(tenant.status)} />
              </div>
              <div>
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Plan</p>
                <p className="text-[#CDD4DA] text-sm">{tenant.plan_name ?? 'Sin plan'}</p>
              </div>
              <div>
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Usuarios</p>
                <p className="text-white font-semibold text-sm">{tenant.user_count}</p>
              </div>
              <div>
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">DB Azure</p>
                {tenant.db_status
                  ? <Badge variant={statusToBadgeVariant(tenant.db_status)} />
                  : <span className="text-[#7A9BAD] text-xs">Sin configurar</span>}
              </div>
            </div>
          </div>

          {/* Tabs: Info + Azure DB */}
          <ClienteTabs
            tenantId={id}
            initialTenant={tenant}
            initialDbConfig={dbConfig}
          />

          {/* Usuarios del tenant */}
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#32576F] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                Usuarios del Cliente <span className="text-[#7A9BAD] font-normal">({tenant.user_count})</span>
              </h2>
              <Link href={`/dashboard/usuarios/nuevo?tenant_id=${id}`}
                className="text-xs text-[#ED7C00] hover:underline">
                + Agregar usuario
              </Link>
            </div>
            {tenantUsers.length > 0 ? (
              <Table>
                <TableHead>
                  <tr>
                    <Th>Nombre</Th>
                    <Th>Email</Th>
                    <Th>Rol</Th>
                    <Th className="text-right">Acciones</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {tenantUsers.map((u) => (
                    <TableRow key={u.id}>
                      <Td className="font-medium text-white">{u.full_name || '—'}</Td>
                      <Td>{u.email}</Td>
                      <Td>
                        <Badge
                          variant="inactive"
                          label={roleLabels[u.role] ?? u.role}
                        />
                      </Td>
                      <Td className="text-right">
                        <Link href={`/dashboard/usuarios/${u.id}`}
                          className="text-[#7A9BAD] hover:text-[#ED7C00] transition-colors text-xs">
                          Ver / Editar
                        </Link>
                      </Td>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="px-5 py-8 text-center">
                <p className="text-[#7A9BAD] text-sm">Este cliente no tiene usuarios asignados.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
