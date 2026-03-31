'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Table, TableHead, TableBody, TableRow, Th, Td } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import {
  licenseApi,
  type SubscriptionDetail,
  type UpdateSubscriptionRequest,
} from '@/lib/licenseApi';

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function SubscriptionActions({ sub }: { sub: SubscriptionDetail }) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const refresh = () => router.refresh();

  const handleRevoke = async () => {
    setRevokeLoading(true);
    try {
      if (sub.isRevoked) {
        await licenseApi.subscriptions.unrevoke(sub.id);
      } else {
        await licenseApi.subscriptions.revoke(sub.id);
      }
      refresh();
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleToggleDevice = async (deviceId: number, isActive: boolean) => {
    setActionLoading(deviceId);
    try {
      if (isActive) {
        await licenseApi.devices.deactivate(deviceId);
      } else {
        await licenseApi.devices.activate(deviceId);
      }
      refresh();
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
          Editar
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setShowRenew(true)}>
          Renovar
        </Button>
        <Button
          variant={sub.isRevoked ? 'primary' : 'danger'}
          size="sm"
          loading={revokeLoading}
          onClick={handleRevoke}
        >
          {sub.isRevoked ? 'Des-revocar' : 'Revocar'}
        </Button>
      </div>

      <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#32576F]">
          <h2 className="text-sm font-semibold text-white">
            Dispositivos ({sub.devices.length})
          </h2>
        </div>
        {sub.devices.length > 0 ? (
          <Table>
            <TableHead>
              <tr>
                <Th>Equipo</Th>
                <Th>Machine ID</Th>
                <Th>Ultima conexion</Th>
                <Th>Estado</Th>
                <Th className="text-right">Accion</Th>
              </tr>
            </TableHead>
            <TableBody>
              {sub.devices.map(device => (
                <TableRow key={device.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-[#7A9BAD]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="text-white font-medium">{device.machineName}</span>
                    </div>
                  </Td>
                  <Td>
                    <code className="text-[#7A9BAD] text-xs bg-[#132229] px-1.5 py-0.5 rounded">
                      {device.machineId}
                    </code>
                  </Td>
                  <Td>{formatDateTime(device.lastSeenAt)}</Td>
                  <Td>
                    <Badge
                      variant={device.isActive ? 'active' : 'inactive'}
                      label={device.isActive ? 'Activo' : 'Inactivo'}
                    />
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant={device.isActive ? 'danger' : 'primary'}
                      size="sm"
                      loading={actionLoading === device.id}
                      onClick={() => handleToggleDevice(device.id, device.isActive)}
                    >
                      {device.isActive ? 'Desactivar' : 'Activar'}
                    </Button>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-[#7A9BAD] text-sm">No hay dispositivos registrados.</p>
          </div>
        )}
      </div>

      <EditModal sub={sub} open={showEdit} onClose={() => setShowEdit(false)} onUpdated={refresh} />
      <RenewModal sub={sub} open={showRenew} onClose={() => setShowRenew(false)} onRenewed={refresh} />
    </>
  );
}

function EditModal({ sub, open, onClose, onUpdated }: {
  sub: SubscriptionDetail; open: boolean; onClose: () => void; onUpdated: () => void;
}) {
  const [form, setForm] = useState<UpdateSubscriptionRequest>({
    clientName: sub.clientName, maxDevices: sub.maxDevices, expiresAt: sub.expiresAt.slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await licenseApi.subscriptions.update(sub.id, {
        ...form, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al editar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Editar Suscripcion">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Nombre del cliente" required value={form.clientName}
          onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Max. dispositivos" type="number" required min={1} value={form.maxDevices}
            onChange={e => setForm(f => ({ ...f, maxDevices: parseInt(e.target.value) || 1 }))} />
          <Input label="Expiracion" type="date" required value={form.expiresAt}
            onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
        </div>
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"><p className="text-red-400 text-xs">{error}</p></div>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}

function RenewModal({ sub, open, onClose, onRenewed }: {
  sub: SubscriptionDetail; open: boolean; onClose: () => void; onRenewed: () => void;
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
    <Modal open={open} onClose={onClose} title="Renovar Suscripcion">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-[#CDD4DA] text-sm">
          Renovar <strong className="text-white">{sub.clientName}</strong>.
          {sub.status === 'expired' || sub.status === 'revoked'
            ? ' Se renovara desde la fecha actual.'
            : ` Se extendera desde ${formatDate(sub.expiresAt)}.`}
        </p>
        <Input label="Meses a extender" type="number" required min={1} value={months}
          onChange={e => setMonths(parseInt(e.target.value) || 1)} />
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"><p className="text-red-400 text-xs">{error}</p></div>}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Renovar</Button>
        </div>
      </form>
    </Modal>
  );
}
