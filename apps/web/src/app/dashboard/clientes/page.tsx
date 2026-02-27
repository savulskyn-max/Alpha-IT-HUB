import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, Th, Td } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';

async function fetchTenants(token: string) {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
  try {
    const res = await fetch(`${base}/api/v1/tenants?limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

export default async function ClientesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: { session } } = await supabase.auth.getSession();

  const data = await fetchTenants(session?.access_token ?? '');
  const tenants: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    plan_name: string | null;
    user_count: number;
    db_status: string | null;
    created_at: string | null;
  }> = data.items ?? [];

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Clientes"
        subtitle={`${data.total ?? 0} clientes registrados`}
        userEmail={user.email}
        actions={
          <Link href="/dashboard/clientes/nuevo">
            <Button size="sm">+ Nuevo Cliente</Button>
          </Link>
        }
      />

      <main className="flex-1 px-6 py-6">
        {tenants.length > 0 ? (
          <Table>
            <TableHead>
              <tr>
                <Th>Nombre</Th>
                <Th>Slug</Th>
                <Th>Plan</Th>
                <Th>Usuarios</Th>
                <Th>Estado</Th>
                <Th>DB Azure</Th>
                <Th>Registrado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </TableHead>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.id}>
                  <Td>
                    <Link
                      href={`/dashboard/clientes/${t.id}`}
                      className="font-medium text-white hover:text-[#ED7C00] transition-colors"
                    >
                      {t.name}
                    </Link>
                  </Td>
                  <Td>
                    <code className="text-[#7A9BAD] text-xs bg-[#132229] px-1.5 py-0.5 rounded">
                      {t.slug}
                    </code>
                  </Td>
                  <Td>{t.plan_name ?? <span className="text-[#7A9BAD]">Sin plan</span>}</Td>
                  <Td>
                    <span className="text-white font-medium">{t.user_count}</span>
                  </Td>
                  <Td>
                    <Badge variant={statusToBadgeVariant(t.status)} />
                  </Td>
                  <Td>
                    {t.db_status
                      ? <Badge variant={statusToBadgeVariant(t.db_status)} />
                      : <span className="text-[#7A9BAD] text-xs">Sin configurar</span>}
                  </Td>
                  <Td>
                    {t.created_at
                      ? new Date(t.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/dashboard/clientes/${t.id}`}
                      className="text-[#7A9BAD] hover:text-[#ED7C00] transition-colors text-xs"
                    >
                      Ver / Editar
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
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="text-white font-medium mb-1">No hay clientes</p>
            <p className="text-[#7A9BAD] text-sm mb-4">
              Registra el primer cliente de la plataforma.
            </p>
            <Link href="/dashboard/clientes/nuevo">
              <Button size="sm">+ Crear Cliente</Button>
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
