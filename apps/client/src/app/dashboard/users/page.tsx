'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type UserProfile } from '@/lib/api';
import { Loader2, Users } from 'lucide-react';

const roleLabels: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Administrador',
  owner: 'Propietario',
  manager: 'Gerente',
  staff: 'Staff',
  viewer: 'Visor',
};

const roleColors: Record<string, string> = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  owner: 'bg-green-100 text-green-700',
  manager: 'bg-amber-100 text-amber-700',
  staff: 'bg-gray-100 text-gray-700',
  viewer: 'bg-gray-100 text-gray-500',
};

export default function UsersPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    api.admin.users()
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando usuarios...</span>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#132229]">Usuarios</h1>
        <span className="text-sm text-gray-500">{users.length} registrados</span>
      </div>

      {users.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No hay usuarios registrados todavía.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Rol</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#32576F] flex items-center justify-center text-white text-xs font-semibold">
                          {(u.full_name ?? u.email)?.charAt(0)?.toUpperCase() ?? '?'}
                        </div>
                        <span className="text-[#132229] font-medium">{u.full_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {roleLabels[u.role] ?? u.role}
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
