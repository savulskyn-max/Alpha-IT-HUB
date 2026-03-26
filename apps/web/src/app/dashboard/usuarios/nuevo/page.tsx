'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, TenantDetail, TenantListResponse } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';

export default function NuevoUsuarioPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tenants, setTenants] = useState<TenantDetail[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);

  const [form, setForm] = useState({
    email: '',
    full_name: '',
    phone: '',
    role: 'staff',
    tenant_id: '',
    azure_local_id: '',
    password: '',
  });

  useEffect(() => {
    api.tenants
      .list({ limit: 200 })
      .then((res: TenantListResponse) => setTenants(res.items))
      .catch(() => setTenants([]))
      .finally(() => setTenantsLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const isTenantRole = ['owner', 'manager', 'staff', 'viewer'].includes(form.role);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await api.users.create({
        email: form.email,
        full_name: form.full_name,
        phone: form.phone || null,
        role: form.role,
        tenant_id: form.tenant_id || null,
        azure_local_id: form.azure_local_id ? Number(form.azure_local_id) : null,
        password: form.password || null,
      });
      router.push('/dashboard/usuarios');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el usuario');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <header className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href="/dashboard/usuarios" className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Nuevo Usuario</h1>
          <p className="text-[#7A9BAD] text-sm">Crear un nuevo usuario del sistema</p>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-xl">
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nombre completo"
                name="full_name"
                value={form.full_name}
                onChange={handleChange}
                required
                placeholder="Juan Pérez"
              />
              <Input
                label="Email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
                placeholder="juan@empresa.com"
              />
              <Input
                label="Teléfono"
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handleChange}
                placeholder="+54 9 11 1234 5678"
              />
              <Select
                label="Rol"
                name="role"
                value={form.role}
                onChange={handleChange}
              >
                <option value="superadmin">Super Admin (Alpha IT Hub)</option>
                <option value="admin">Administrador (Alpha IT Hub)</option>
                <option value="owner">Propietario (Cliente)</option>
                <option value="manager">Gerente (Cliente)</option>
                <option value="staff">Staff (Cliente)</option>
                <option value="viewer">Visor (Cliente)</option>
              </Select>

              {/* Tenant selector — shown for tenant-scoped roles */}
              {isTenantRole && (
                <Select
                  label="Tenant (Tienda)"
                  name="tenant_id"
                  value={form.tenant_id}
                  onChange={handleChange}
                >
                  <option value="">
                    {tenantsLoading ? 'Cargando tenants...' : '— Seleccionar tenant —'}
                  </option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.slug})
                    </option>
                  ))}
                </Select>
              )}

              {/* Azure Local ID — only if tenant is selected */}
              {isTenantRole && form.tenant_id && (
                <Input
                  label="ID del Local (Azure SQL)"
                  name="azure_local_id"
                  type="number"
                  value={form.azure_local_id}
                  onChange={handleChange}
                  placeholder="Ej: 3"
                  hint="LocalID en la base de datos Azure SQL del tenant"
                />
              )}

              <Input
                label="Contraseña"
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                placeholder="Mínimo 8 caracteres"
                hint="Si no se ingresa contraseña, se enviará un email de invitación"
              />

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" loading={loading} className="flex-1">
                  Crear Usuario
                </Button>
                <Link href="/dashboard/usuarios">
                  <Button type="button" variant="secondary">Cancelar</Button>
                </Link>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
