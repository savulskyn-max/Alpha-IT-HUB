import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  licenseServerFetch,
  type SubscriptionDetail,
} from '@/lib/licenseApi';
import { SubscriptionActions } from './SubscriptionActions';

const statusMap: Record<string, { variant: 'active' | 'inactive' | 'suspended'; label: string }> = {
  active:  { variant: 'active', label: 'Activa' },
  expired: { variant: 'suspended', label: 'Expirada' },
  revoked: { variant: 'inactive', label: 'Revocada' },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let sub: SubscriptionDetail | null = null;
  let error: string | null = null;

  try {
    sub = await licenseServerFetch<SubscriptionDetail>(`subscriptions/${id}`);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Error al cargar suscripcion';
  }

  if (error || !sub) {
    return (
      <div className="flex flex-col flex-1">
        <Header
          title="Suscripcion"
          userEmail={user.email}
          actions={
            <Link href="/dashboard/licencias">
              <Button variant="secondary" size="sm">← Volver</Button>
            </Link>
          }
        />
        <main className="flex-1 px-6 py-6">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4">
            <p className="text-red-400 text-sm">{error || 'Suscripcion no encontrada'}</p>
          </div>
        </main>
      </div>
    );
  }

  const st = statusMap[sub.status] ?? statusMap.revoked;
  const activeDevices = sub.devices.filter(d => d.isActive).length;
  const usagePercent = Math.min((sub.devicesUsed / sub.maxDevices) * 100, 100);

  return (
    <div className="flex flex-col flex-1">
      <Header
        title={sub.clientName}
        subtitle={`ID: ${sub.id}`}
        userEmail={user.email}
        actions={
          <Link href="/dashboard/licencias">
            <Button variant="secondary" size="sm">← Volver</Button>
          </Link>
        }
      />

      <main className="flex-1 px-6 py-6 space-y-6">
        {/* Info cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-[#7A9BAD] text-xs font-semibold uppercase tracking-wide mb-4">
              Informacion de la Suscripcion
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-[#7A9BAD]">Estado</span>
                <Badge variant={st.variant} label={st.label} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A9BAD]">Clave de licencia</span>
                <code className="text-[#CDD4DA] text-xs bg-[#132229] px-2 py-0.5 rounded select-all">
                  {sub.subscriptionKey}
                </code>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A9BAD]">Creacion</span>
                <span className="text-white">{formatDate(sub.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A9BAD]">Expiracion</span>
                <span className="text-white">{formatDate(sub.expiresAt)}</span>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-[#7A9BAD] text-xs font-semibold uppercase tracking-wide mb-4">
              Uso de Dispositivos
            </h3>
            <div className="flex items-end gap-4 mb-4">
              <div>
                <p className="text-3xl font-bold text-white">{sub.devicesUsed}</p>
                <p className="text-[#7A9BAD] text-xs">de {sub.maxDevices} permitidos</p>
              </div>
              <div className="flex-1">
                <div className="h-2 bg-[#132229] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#ED7C00] rounded-full transition-all"
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-4 text-xs text-[#7A9BAD]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400" /> {activeDevices} activos
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#32576F]" /> {sub.devices.length - activeDevices} inactivos
              </span>
            </div>
          </Card>
        </div>

        {/* Actions + Devices table (client component) */}
        <SubscriptionActions sub={sub} />
      </main>
    </div>
  );
}
