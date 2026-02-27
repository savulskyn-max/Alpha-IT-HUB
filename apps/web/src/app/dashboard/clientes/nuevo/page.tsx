'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function NuevoClientePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    slug: '',
    status: 'trial',
    plan_id: '',
  });

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setForm((prev) => ({
      ...prev,
      name,
      slug: prev.slug === slugify(prev.name) || prev.slug === ''
        ? slugify(name)
        : prev.slug,
    }));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const tenant = await api.tenants.create({
        name: form.name,
        slug: form.slug,
        status: form.status,
        plan_id: form.plan_id || null,
      });
      router.push(`/dashboard/clientes/${tenant.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1">
      <header className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center gap-3">
        <Link href="/dashboard/clientes" className="text-[#7A9BAD] hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-white">Nuevo Cliente</h1>
          <p className="text-[#7A9BAD] text-sm">Registrar un nuevo tenant en la plataforma</p>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-xl">
          <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Nombre del negocio"
                name="name"
                value={form.name}
                onChange={handleNameChange}
                required
                placeholder="Tienda Ejemplo S.A."
              />
              <Input
                label="Slug (identificador URL)"
                name="slug"
                value={form.slug}
                onChange={handleChange}
                required
                placeholder="tienda-ejemplo"
                hint="Solo letras minúsculas, números y guiones. Debe ser único."
              />
              <Select
                label="Estado inicial"
                name="status"
                value={form.status}
                onChange={handleChange}
              >
                <option value="trial">Trial</option>
                <option value="active">Activo</option>
                <option value="suspended">Suspendido</option>
                <option value="cancelled">Cancelado</option>
              </Select>
              <Input
                label="ID del Plan (opcional)"
                name="plan_id"
                value={form.plan_id}
                onChange={handleChange}
                placeholder="UUID del plan"
                hint="Dejar vacío para asignar el plan después"
              />

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button type="submit" loading={loading} className="flex-1">
                  Crear Cliente
                </Button>
                <Link href="/dashboard/clientes">
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
