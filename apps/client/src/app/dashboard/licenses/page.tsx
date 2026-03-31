'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import {
  licenseApi,
  type LicenseDashboard,
  type Subscription,
  type CreateSubscriptionRequest,
  type UpdateSubscriptionRequest,
} from '@/lib/licenseApi';
import {
  Loader2, CreditCard, Monitor, ShieldCheck, ShieldX,
  AlertTriangle, Plus, X, Eye, RotateCcw, Ban, Undo2,
  Pencil, Clock,
} from 'lucide-react';

const ALLOWED_ROLES = ['owner', 'admin', 'superadmin'];

// ── Status helpers ───────────────────────────────────────────────────────────

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

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color, bg }: {
  label: string; value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string; bg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-500 text-sm">{label}</span>
        <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
      <p className="text-2xl font-bold text-[#132229]">{value}</p>
    </div>
  );
}

// ── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<CreateSubscriptionRequest>({
    clientName: '', maxDevices: 5, expiresInMonths: 12,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await licenseApi.subscriptions.create(form);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-[#132229]">Nueva Suscripcion</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del cliente</label>
            <input
              required
              value={form.clientName}
              onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
              placeholder="Ej: Mi Negocio"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max. dispositivos</label>
              <input
                required type="number" min={1}
                value={form.maxDevices}
                onChange={e => setForm(f => ({ ...f, maxDevices: parseInt(e.target.value) || 1 }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duracion (meses)</label>
              <input
                required type="number" min={1}
                value={form.expiresInMonths}
                onChange={e => setForm(f => ({ ...f, expiresInMonths: parseInt(e.target.value) || 1 }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
              />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-[#ED7C00] text-white rounded-lg hover:bg-[#d56d00] disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Crear
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ sub, onClose, onUpdated }: {
  sub: Subscription;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [form, setForm] = useState<UpdateSubscriptionRequest>({
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
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
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
              required
              value={form.clientName}
              onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max. dispositivos</label>
              <input
                required type="number" min={1}
                value={form.maxDevices}
                onChange={e => setForm(f => ({ ...f, maxDevices: parseInt(e.target.value) || 1 }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiracion</label>
              <input
                required type="date"
                value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
              />
            </div>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
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
  sub: Subscription;
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
            <input
              required type="number" min={1}
              value={months}
              onChange={e => setMonths(parseInt(e.target.value) || 1)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#ED7C00]/40 focus:border-[#ED7C00]"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
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

type StatusFilter = 'all' | 'active' | 'expired' | 'revoked';

export default function LicensesPage() {
  const { user, loading: authLoading } = useAuth();
  const [dashboard, setDashboard] = useState<LicenseDashboard | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [renewingSub, setRenewingSub] = useState<Subscription | null>(null);

  // Action loading
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const userRole = user?.role ?? '';
  const hasAccess = ALLOWED_ROLES.includes(userRole);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, subs] = await Promise.all([
        licenseApi.dashboard(),
        licenseApi.subscriptions.list(),
      ]);
      setDashboard(dash);
      setSubscriptions(subs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && hasAccess) loadData();
    if (!authLoading && !hasAccess) setLoading(false);
  }, [authLoading, hasAccess, loadData]);

  const handleRevoke = async (sub: Subscription) => {
    setActionLoading(sub.id);
    try {
      if (sub.isRevoked) {
        await licenseApi.subscriptions.unrevoke(sub.id);
      } else {
        await licenseApi.subscriptions.revoke(sub.id);
      }
      await loadData();
    } catch {
      // silently fail — data will refresh
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
        <span>Cargando licencias...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#132229]">Licencias</h1>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error: {error}
        </div>
        <button onClick={loadData} className="text-sm text-[#ED7C00] hover:underline">
          Reintentar
        </button>
      </div>
    );
  }

  const filtered = filter === 'all'
    ? subscriptions
    : subscriptions.filter(s => s.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#132229]">Licencias</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#ED7C00] text-white text-sm font-medium rounded-lg hover:bg-[#d56d00] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva Suscripcion
        </button>
      </div>

      {/* Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <StatCard label="Total" value={dashboard.totalSubscriptions} icon={CreditCard} color="text-blue-500" bg="bg-blue-50" />
          <StatCard label="Activas" value={dashboard.activeSubscriptions} icon={ShieldCheck} color="text-green-500" bg="bg-green-50" />
          <StatCard label="Expiradas" value={dashboard.expiredSubscriptions} icon={ShieldX} color="text-red-500" bg="bg-red-50" />
          <StatCard label="Revocadas" value={dashboard.revokedSubscriptions} icon={Ban} color="text-gray-500" bg="bg-gray-100" />
          <StatCard label="Por vencer" value={dashboard.expiringSoon} icon={AlertTriangle} color="text-amber-500" bg="bg-amber-50" />
          <StatCard label="Dispositivos activos" value={dashboard.totalDevices} icon={Monitor} color="text-purple-500" bg="bg-purple-50" />
          <StatCard label="Max dispositivos" value={dashboard.totalMaxDevices} icon={Monitor} color="text-indigo-500" bg="bg-indigo-50" />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        {(['all', 'active', 'expired', 'revoked'] as StatusFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              filter === f
                ? 'bg-[#132229] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'Todas' : statusLabels[f]}
          </button>
        ))}
        <span className="ml-auto text-sm text-gray-500">{filtered.length} resultados</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <CreditCard className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No hay suscripciones {filter !== 'all' ? `con estado "${statusLabels[filter]}"` : ''}.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Clave</th>
                  <th className="px-4 py-3 font-medium">Dispositivos</th>
                  <th className="px-4 py-3 font-medium">Expiracion</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(sub => (
                  <tr key={sub.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-[#132229] font-medium">{sub.clientName}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{sub.subscriptionKey.slice(0, 18)}...</td>
                    <td className="px-4 py-3 text-gray-600">
                      {sub.devicesUsed} / {sub.maxDevices}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(sub.expiresAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[sub.status]}`}>
                        {statusLabels[sub.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/dashboard/licenses/${sub.id}`}
                          className="p-1.5 text-gray-400 hover:text-[#32576F] rounded-lg hover:bg-gray-100"
                          title="Ver detalle"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => setEditingSub(sub)}
                          className="p-1.5 text-gray-400 hover:text-[#32576F] rounded-lg hover:bg-gray-100"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setRenewingSub(sub)}
                          className="p-1.5 text-gray-400 hover:text-[#ED7C00] rounded-lg hover:bg-gray-100"
                          title="Renovar"
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleRevoke(sub)}
                          disabled={actionLoading === sub.id}
                          className={`p-1.5 rounded-lg hover:bg-gray-100 ${
                            sub.isRevoked
                              ? 'text-green-400 hover:text-green-600'
                              : 'text-gray-400 hover:text-red-500'
                          }`}
                          title={sub.isRevoked ? 'Des-revocar' : 'Revocar'}
                        >
                          {actionLoading === sub.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : sub.isRevoked
                              ? <Undo2 className="w-4 h-4" />
                              : <Ban className="w-4 h-4" />
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreated={loadData} />
      )}
      {editingSub && (
        <EditModal sub={editingSub} onClose={() => setEditingSub(null)} onUpdated={loadData} />
      )}
      {renewingSub && (
        <RenewModal sub={renewingSub} onClose={() => setRenewingSub(null)} onRenewed={loadData} />
      )}
    </div>
  );
}
