'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';

interface Props {
  userId: string;
  initialData: {
    full_name: string | null;
    phone: string | null;
    role: string;
    tenant_id: string | null;
  };
}

export function EditUserForm({ userId, initialData }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    full_name: initialData.full_name ?? '',
    phone: initialData.phone ?? '',
    role: initialData.role,
    tenant_id: initialData.tenant_id ?? '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      await api.users.update(userId, {
        full_name: form.full_name || null,
        phone: form.phone || null,
        role: form.role,
        tenant_id: form.tenant_id || null,
      });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este usuario permanentemente? Esta acción no se puede deshacer.')) return;
    setDeleting(true);
    try {
      await api.users.delete(userId);
      router.push('/admin/usuarios');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <Input
        label="Nombre completo"
        name="full_name"
        value={form.full_name}
        onChange={handleChange}
        placeholder="Nombre y apellido"
      />
      <Input
        label="Teléfono"
        name="phone"
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
      </Select>
      <Input
        label="ID del Tenant"
        name="tenant_id"
        value={form.tenant_id}
        onChange={handleChange}
        placeholder="UUID del tenant cliente"
        hint="Vacío = usuario interno de Alpha IT Hub"
      />

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3">
          <p className="text-green-400 text-sm">Cambios guardados correctamente.</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button type="submit" loading={loading}>Guardar cambios</Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={deleting}
          onClick={handleDelete}
        >
          Eliminar usuario
        </Button>
      </div>
    </form>
  );
}
