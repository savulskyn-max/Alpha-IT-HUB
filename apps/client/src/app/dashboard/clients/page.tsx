'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type TenantInfo } from '@/lib/api';
import { Loader2, Store } from 'lucide-react';

export default function ClientsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    api.admin.tenants()
      .then(setTenants)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando clientes...</span>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
        No tenés permisos para acceder a esta sección.
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
        Error: {error}
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    setup: 'bg-yellow-100 text-yellow-700',
    suspended: 'bg-red-100 text-red-700',
    inactive: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#132229]">Clientes</h1>
        <span className="text-sm text-gray-500">{tenants.length} registrados</span>
      </div>

      {tenants.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Store className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No hay clientes registrados todavía.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-[#132229] font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{t.slug}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
