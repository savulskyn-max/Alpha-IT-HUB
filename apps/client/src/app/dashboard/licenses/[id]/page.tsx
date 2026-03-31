'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  licenseApi,
  type SubscriptionDetail,
} from '@/lib/licenseApi';
import {
  Loader2, ArrowLeft, Monitor, ShieldCheck, ShieldX,
  Ban, Undo2, Clock, Pencil, Power, PowerOff, X, Copy, Check,
} from 'lucide-react';

const ALLOWED_ROLES = ['owner', 'admin', 'superadmin'];

const statusStyles: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  expired: 'bg-red-100 text-red-700',
  revoked: 'bg-gray-100 text-gray-600',
};

const statusLabels: Record<string, string> = {
  active: 'Activa',
  expired: 'Expirada',
  revoked: 'Revocada',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ sub, onClose, onUpdated }: {
  sub: SubscriptionDetail;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [form, setForm] = useState({
    clientName: sub.clientName,
    maxDevices: sub.maxDevices,
    expiresAt: sub.expiresAt.slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await licenseApi.subscriptions.update(sub.id, {
        ...form,
        expiresAt: new Date(form.expiresAt).toISOString(),
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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-[#132229]">Editar Suscripcion</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del cliente</label>
            <input
              required value={form.clientName}
              onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max. dispositivos</label>
              <input
                required type="number" min={1} value={form.maxDevices}
                onChange={e => setForm(f => ({ ...f, maxDevices: parseInt(e.target.value) || 1 }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiracion</label>
              <input
                required type="date" value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
              />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-[#ED7C00] text-white rounded-lg hover:bg-[#d56d00] disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Renew Modal ──────────────────────────────────────────────────────────────

function RenewModal({ sub, onClose, onRenewed }: {
  sub: SubscriptionDetail;
  onClose: () => void;
  onRenewed: () => void;
}) {
  const [months, setMonths] = useState(12);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-[#132229]">Renovar Suscripcion</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            Renovar <strong>{sub.clientName}</strong>.
            {sub.status === 'expired' || sub.status === 'revoked'
              ? ' Se renovara desde la fecha actual.'
              : ` Se extendera desde ${formatDate(sub.expiresAt)}.`}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Meses a extender</label>
            <input required type="number" min={1} value={months}
              onChange={e => setMonths(parseInt(e.target.value) || 1)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-[#ED7C00] text-white rounded-lg hover:bg-[#d56d00] disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Renovar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const id = parseInt(idStr);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [sub, setSub] = useState<SubscriptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const userRole = user?.role ?? '';
  const hasAccess = ALLOWED_ROLES.includes(userRole);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await licenseApi.subscriptions.get(id);
      setSub(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!authLoading && hasAccess) loadData();
    if (!authLoading && !hasAccess) setLoading(false);
  }, [authLoading, hasAccess, loadData]);

  const handleCopyKey = async () => {
    if (!sub) return;
    await navigator.clipboard.writeText(sub.subscriptionKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async () => {
    if (!sub) return;
    setActionLoading(-1);
    try {
      if (sub.isRevoked) {
        await licenseApi.subscriptions.unrevoke(sub.id);
      } else {
        await licenseApi.subscriptions.revoke(sub.id);
      }
      await loadData();
    } catch {
      // data will refresh
    } finally {
      setActionLoading(null);
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
      await loadData();
    } catch {
      // data will refresh
    } finally {
      setActionLoading(null);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando...</span>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
        No tenes permisos para acceder a esta seccion.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando suscripcion...</span>
      </div>
    );
  }

  if (error || !sub) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/licenses" className="flex items-center gap-2 text-sm text-gray-500 hover:text-[#132229]">
          <ArrowLeft className="w-4 h-4" /> Volver
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error || 'Suscripcion no encontrada'}
        </div>
      </div>
    );
  }

  const activeDevices = sub.devices.filter(d => d.isActive).length;
  const inactiveDevices = sub.devices.filter(d => !d.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/licenses" className="p-2 text-gray-400 hover:text-[#132229] rounded-lg hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[#132229]">{sub.clientName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[sub.status]}`}>
              {statusLabels[sub.status]}
            </span>
            <span className="text-gray-400 text-xs">ID: {sub.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEdit(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Pencil className="w-4 h-4" /> Editar
          </button>
          <button onClick={() => setShowRenew(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#ED7C00] border border-[#ED7C00]/30 rounded-lg hover:bg-[#ED7C00]/5"
          >
            <Clock className="w-4 h-4" /> Renovar
          </button>
          <button onClick={handleRevoke} disabled={actionLoading === -1}
            className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg ${
              sub.isRevoked
                ? 'text-green-600 border-green-200 hover:bg-green-50'
                : 'text-red-600 border-red-200 hover:bg-red-50'
            }`}
          >
            {actionLoading === -1
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : sub.isRevoked ? <Undo2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />
            }
            {sub.isRevoked ? 'Des-revocar' : 'Revocar'}
          </button>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Informacion</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Clave de licencia</span>
              <button onClick={handleCopyKey} className="flex items-center gap-1 text-[#132229] font-mono text-xs hover:text-[#ED7C00]">
                {sub.subscriptionKey.slice(0, 18)}...
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Creacion</span>
              <span className="text-[#132229]">{formatDate(sub.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Expiracion</span>
              <span className="text-[#132229]">{formatDate(sub.expiresAt)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Dispositivos</h3>
          <div className="flex items-end gap-4">
            <div>
              <p className="text-3xl font-bold text-[#132229]">{sub.devicesUsed}</p>
              <p className="text-xs text-gray-500">de {sub.maxDevices} permitidos</p>
            </div>
            <div className="flex-1">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ED7C00] rounded-full transition-all"
                  style={{ width: `${Math.min((sub.devicesUsed / sub.maxDevices) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400" /> {activeDevices} activos
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-gray-300" /> {inactiveDevices} inactivos
            </span>
          </div>
        </div>
      </div>

      {/* Devices table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-700">
            Dispositivos ({sub.devices.length})
          </h3>
        </div>
        {sub.devices.length === 0 ? (
          <div className="p-8 text-center">
            <Monitor className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No hay dispositivos registrados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-3 font-medium">Equipo</th>
                  <th className="px-4 py-3 font-medium">Machine ID</th>
                  <th className="px-4 py-3 font-medium">Ultima conexion</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium text-right">Accion</th>
                </tr>
              </thead>
              <tbody>
                {sub.devices.map(device => (
                  <tr key={device.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-[#132229] font-medium">
                      <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-gray-400" />
                        {device.machineName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{device.machineId}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDateTime(device.lastSeenAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        device.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${device.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {device.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleToggleDevice(device.id, device.isActive)}
                        disabled={actionLoading === device.id}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          device.isActive
                            ? 'text-red-600 border-red-200 hover:bg-red-50'
                            : 'text-green-600 border-green-200 hover:bg-green-50'
                        }`}
                      >
                        {actionLoading === device.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : device.isActive
                            ? <PowerOff className="w-3.5 h-3.5" />
                            : <Power className="w-3.5 h-3.5" />
                        }
                        {device.isActive ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showEdit && (
        <EditModal sub={sub} onClose={() => setShowEdit(false)} onUpdated={loadData} />
      )}
      {showRenew && (
        <RenewModal sub={sub} onClose={() => setShowRenew(false)} onRenewed={loadData} />
      )}
    </div>
  );
}
