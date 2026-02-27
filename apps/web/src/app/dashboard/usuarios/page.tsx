import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, Th, Td } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';

async function fetchUsers(token: string) {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  try {
    const res = await fetch(`${base}/api/v1/users?limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

const roleLabels: Record<string, string> = {
  superadmin: 'Super Admin',
  admin:      'Administrador',
  owner:      'Propietario',
  manager:    'Gerente',
  staff:      'Staff',
};

export default async function UsuariosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: { session } } = await supabase.auth.getSession();

  const data = await fetchUsers(session?.access_token ?? '');
  const users: Array<{
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    tenant_id: string | null;
    created_at: string | null;
  }> = data.items ?? [];

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Usuarios"
        subtitle={`${data.total ?? 0} usuarios registrados`}
        userEmail={user.email}
        actions={
          <Link href="/dashboard/usuarios/nuevo">
            <Button size="sm">+ Nuevo Usuario</Button>
          </Link>
        }
      />

      <main className="flex-1 px-6 py-6">
        {users.length > 0 ? (
          <Table>
            <TableHead>
              <tr>
                <Th>Nombre</Th>
                <Th>Email</Th>
                <Th>Rol</Th>
                <Th>Tenant</Th>
                <Th>Registrado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <Td>
                    <span className="font-medium text-white">
                      {u.full_name || '—'}
                    </span>
                  </Td>
                  <Td>{u.email}</Td>
                  <Td>
                    <Badge
                      variant={u.role === 'admin' || u.role === 'superadmin' ? 'active' : 'inactive'}
                      label={roleLabels[u.role] ?? u.role}
                    />
                  </Td>
                  <Td>
                    {u.tenant_id ? (
                      <Link
                        href={`/dashboard/clientes/${u.tenant_id}`}
                        className="text-[#ED7C00] hover:underline text-xs"
                      >
                        Ver tenant →
                      </Link>
                    ) : (
                      <span className="text-[#7A9BAD] text-xs">Interno</span>
                    )}
                  </Td>
                  <Td>
                    {u.created_at
                      ? new Date(u.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/dashboard/usuarios/${u.id}`}
                        className="text-[#7A9BAD] hover:text-[#ED7C00] transition-colors text-xs"
                      >
                        Ver / Editar
                      </Link>
                    </div>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl px-6 py-16 text-center">
            <svg className="w-10 h-10 text-[#32576F] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <p className="text-white font-medium mb-1">No hay usuarios</p>
            <p className="text-[#7A9BAD] text-sm mb-4">
              Crea el primer usuario del sistema.
            </p>
            <Link href="/dashboard/usuarios/nuevo">
              <Button size="sm">+ Crear Usuario</Button>
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
