import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';
import { EditUserForm } from './EditUserForm';

async function fetchUser(token: string, userId: string) {
  const base = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000').replace(/\/$/, '');
  const res = await fetch(`${base}/api/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Error al cargar usuario');
  return res.json();
}

const roleLabels: Record<string, string> = {
  superadmin: 'Super Admin',
  admin:      'Administrador',
  owner:      'Propietario',
  manager:    'Gerente',
  staff:      'Staff',
};

export default async function UsuarioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: { session } } = await supabase.auth.getSession();

  const profileUser = await fetchUser(session?.access_token ?? '', id).catch(() => null);
  if (!profileUser) notFound();

  return (
    <div className="flex flex-col flex-1">
      <Header
        title={profileUser.full_name || profileUser.email}
        subtitle={`Usuario · ${roleLabels[profileUser.role] ?? profileUser.role}`}
        userEmail={user.email}
        actions={
          <Link href="/admin/usuarios"
            className="text-[#7A9BAD] hover:text-white text-sm transition-colors flex items-center gap-1">
            ← Volver
          </Link>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="max-w-2xl space-y-6">
          {/* Info Card */}
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-[#ED7C00]/20 border border-[#ED7C00]/30 flex items-center justify-center flex-shrink-0">
                <span className="text-[#ED7C00] text-lg font-semibold">
                  {(profileUser.full_name || profileUser.email).charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <h2 className="text-white font-semibold text-base">{profileUser.full_name || '—'}</h2>
                <p className="text-[#7A9BAD] text-sm">{profileUser.email}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge
                    variant={profileUser.role === 'admin' || profileUser.role === 'superadmin' ? 'active' : 'inactive'}
                    label={roleLabels[profileUser.role] ?? profileUser.role}
                  />
                  {profileUser.tenant_id
                    ? <span className="text-xs text-[#7A9BAD]">Tenant: {profileUser.tenant_id.slice(0, 8)}…</span>
                    : <span className="text-xs text-[#7A9BAD]">Usuario interno</span>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 py-4 border-t border-[#32576F]">
              <div>
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Teléfono</p>
                <p className="text-[#CDD4DA] text-sm">{profileUser.phone || '—'}</p>
              </div>
              <div>
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Registrado</p>
                <p className="text-[#CDD4DA] text-sm">
                  {profileUser.created_at
                    ? new Date(profileUser.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
                    : '—'}
                </p>
              </div>
              {profileUser.tenant_id && (
                <div>
                  <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Tenant</p>
                  <Link href={`/admin/clientes/${profileUser.tenant_id}`}
                    className="text-[#ED7C00] text-sm hover:underline">
                    Ver cliente →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Edit Form */}
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
            <h3 className="text-white font-semibold text-sm mb-4">Editar perfil</h3>
            <EditUserForm userId={id} initialData={profileUser} />
          </div>
        </div>
      </main>
    </div>
  );
}
