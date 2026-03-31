'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Table, TableHead, TableBody, TableRow, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import {
  licenseApi,
  type Subscription,
  type CreateSubscriptionRequest,
} from '@/lib/licenseApi';

type StatusFilter = 'all' | 'active' | 'expired' | 'revoked';

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

export function LicenciasClient({ initialData }: { initialData: Subscription[] }) {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState(initialData);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showRenew, setShowRenew] = useState<Subscription | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const filtered = filter === 'all'
    ? subscriptions
    : subscriptions.filter(s => s.status === filter);

  const refreshData = async () => {
    try {
      const data = await licenseApi.subscriptions.list();
      setSubscriptions(data);
    } catch {
      // fallback: full page refresh
      router.refresh();
    }
  };

  const handleRevoke = async (sub: Subscription) => {
    setActionLoading(sub.id);
    try {
      if (sub.isRevoked) {
        await licenseApi.subscriptions.unrevoke(sub.id);
      } else {
        await licenseApi.subscriptions.revoke(sub.id);
      }
      await refreshData();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {(['all', 'active', 'expired', 'revoked'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === f
                  ? 'bg-[#ED7C00] text-white'
                  : 'bg-[#1E3340] text-[#7A9BAD] border border-[#32576F] hover:text-[#CDD4DA]'
              }`}
            >
              {f === 'all' ? 'Todas' : statusMap[f]?.label ?? f}
            </button>
          ))}
          <span className="text-[#7A9BAD] text-xs ml-2">{filtered.length} resultados</span>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          + Nueva Suscripcion
        </Button>
      </div>

      {/* Table */}
      {filtered.length > 0 ? (
        <Table>
          <TableHead>
            <tr>
              <Th>Cliente</Th>
              <Th>Clave</Th>
              <Th>Dispositivos</Th>
              <Th>Expiracion</Th>
              <Th>Estado</Th>
              <Th className="text-right">Acciones</Th>
            </tr>
          </TableHead>
          <TableBody>
            {filtered.map(sub => {
              const st = statusMap[sub.status] ?? statusMap.revoked;
              return (
                <TableRow key={sub.id}>
                  <Td>
                    <Link
                      href={`/dashboard/licencias/${sub.id}`}
                      className="font-medium text-white hover:text-[#ED7C00] transition-colors"
                    >
                      {sub.clientName}
                    </Link>
                  </Td>
                  <Td>
                    <code className="text-[#7A9BAD] text-xs bg-[#132229] px-1.5 py-0.5 rounded">
                      {sub.subscriptionKey.slice(0, 18)}...
                    </code>
                  </Td>
                  <Td>
                    <span className="text-white font-medium">{sub.devicesUsed}</span>
                    <span className="text-[#7A9BAD]"> / {sub.maxDevices}</span>
                  </Td>
                  <Td>{formatDate(sub.expiresAt)}</Td>
                  <Td>
                    <Badge variant={st.variant} label={st.label} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/dashboard/licencias/${sub.id}`}
                        className="text-[#7A9BAD] hover:text-[#ED7C00] transition-colors text-xs"
                      >
                        Ver
                      </Link>
                      <button
                        onClick={() => setShowRenew(sub)}
                        className="text-[#7A9BAD] hover:text-[#ED7C00] transition-colors text-xs"
                      >
                        Renovar
                      </button>
                      <button
                        onClick={() => handleRevoke(sub)}
                        disabled={actionLoading === sub.id}
                        className={`text-xs transition-colors ${
                          sub.isRevoked
                            ? 'text-green-400 hover:text-green-300'
                            : 'text-red-400 hover:text-red-300'
                        }`}
                      >
                        {actionLoading === sub.id ? '...' : sub.isRevoked ? 'Activar' : 'Revocar'}
                      </button>
                    </div>
                  </Td>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl px-6 py-16 text-center">
          <svg className="w-10 h-10 text-[#32576F] mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
          <p className="text-white font-medium mb-1">No hay suscripciones</p>
          <p className="text-[#7A9BAD] text-sm mb-4">
            {filter !== 'all' ? `No hay suscripciones con estado "${statusMap[filter]?.label}".` : 'Crea la primera suscripcion.'}
          </p>
          {filter === 'all' && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              + Crear Suscripcion
            </Button>
          )}
        </div>
      )}

      {/* Create Modal */}
      <CreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={refreshData}
      />

      {/* Renew Modal */}
      {showRenew && (
        <RenewModal
          sub={showRenew}
          onClose={() => setShowRenew(null)}
          onRenewed={refreshData}
        />
      )}
    </>
  );
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateSubscriptionRequest>({
    clientName: '', maxDevices: 5, expiresInMonths: 12,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await licenseApi.subscriptions.create(form);
      onCreated();
      onClose();
      setForm({ clientName: '', maxDevices: 5, expiresInMonths: 12 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nueva Suscripcion">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nombre del cliente"
          required
          value={form.clientName}
          onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
          placeholder="Ej: Mi Negocio"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Max. dispositivos"
            type="number"
            required
            min={1}
            value={form.maxDevices}
            onChange={e => setForm(f => ({ ...f, maxDevices: parseInt(e.target.value) || 1 }))}
          />
          <Input
            label="Duracion (meses)"
            type="number"
            required
            min={1}
            value={form.expiresInMonths}
            onChange={e => setForm(f => ({ ...f, expiresInMonths: parseInt(e.target.value) || 1 }))}
          />
        </div>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Crear</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Renew Modal ──────────────────────────────────────────────────────────────

function RenewModal({ sub, onClose, onRenewed }: {
  sub: Subscription;
  onClose: () => void;
  onRenewed: () => void;
}) {
  const [months, setMonths] = useState(12);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await licenseApi.subscriptions.renew(sub.id, months);
      onRenewed();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al renovar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="Renovar Suscripcion">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-[#CDD4DA] text-sm">
          Renovar <strong className="text-white">{sub.clientName}</strong>.
          {sub.status === 'expired' || sub.status === 'revoked'
            ? ' Se renovara desde la fecha actual.'
            : ` Se extendera desde ${formatDate(sub.expiresAt)}.`}
        </p>
        <Input
          label="Meses a extender"
          type="number"
          required
          min={1}
          value={months}
          onChange={e => setMonths(parseInt(e.target.value) || 1)}
        />
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-400 text-xs">{error}</p>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Renovar</Button>
        </div>
      </form>
    </Modal>
  );
}
