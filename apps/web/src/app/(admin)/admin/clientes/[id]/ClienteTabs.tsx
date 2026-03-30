'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type AzureDbConfigResponse, type TenantDetail } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge, statusToBadgeVariant } from '@/components/ui/Badge';

interface Props {
  tenantId: string;
  initialTenant: TenantDetail;
  initialDbConfig: AzureDbConfigResponse | null;
}

type TabKey = 'info' | 'azure' | 'analitica';

export function ClienteTabs({ tenantId, initialTenant, initialDbConfig }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('info');

  return (
    <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl overflow-hidden">
      {/* Tab headers */}
      <div className="flex border-b border-[#32576F]">
        {([
          { key: 'info' as TabKey, label: 'Información' },
          { key: 'azure' as TabKey, label: 'Base de Datos Azure' },
          { key: 'analitica' as TabKey, label: 'Analítica' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-3.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-white border-[#ED7C00]'
                : 'text-[#7A9BAD] border-transparent hover:text-[#CDD4DA]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-6">
        {activeTab === 'info' && (
          <TenantInfoTab tenantId={tenantId} initialTenant={initialTenant} />
        )}
        {activeTab === 'azure' && (
          <AzureDbTab tenantId={tenantId} initialConfig={initialDbConfig} />
        )}
        {activeTab === 'analitica' && (
          <AnaliticaTab tenantId={tenantId} dbConfigured={!!initialDbConfig} />
        )}
      </div>
    </div>
  );
}

// ── Tenant Info Tab ───────────────────────────────────────────────────────────

function TenantInfoTab({ tenantId, initialTenant }: { tenantId: string; initialTenant: TenantDetail }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    name: initialTenant.name,
    status: initialTenant.status,
    plan_id: initialTenant.plan_id ?? '',
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
      await api.tenants.update(tenantId, {
        name: form.name,
        status: form.status,
        plan_id: form.plan_id || null,
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
    if (!confirm(`¿Eliminar el cliente "${initialTenant.name}"? Esta acción es irreversible.`)) return;
    setDeleting(true);
    try {
      await api.tenants.delete(tenantId);
      router.push('/admin/clientes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar');
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <Input
        label="Nombre del negocio"
        name="name"
        value={form.name}
        onChange={handleChange}
        required
      />
      <div>
        <p className="text-sm font-medium text-[#CDD4DA] mb-1.5">Slug</p>
        <p className="text-[#7A9BAD] text-sm font-mono bg-[#132229] border border-[#32576F] rounded-lg px-3 py-2">
          {initialTenant.slug}
        </p>
        <p className="text-xs text-[#7A9BAD] mt-1">El slug no puede modificarse después de la creación.</p>
      </div>
      <Select
        label="Estado"
        name="status"
        value={form.status}
        onChange={handleChange}
      >
        <option value="setup">En setup</option>
        <option value="active">Activo</option>
        <option value="suspended">Suspendido</option>
        <option value="inactive">Inactivo</option>
      </Select>
      <Input
        label="ID del Plan (opcional)"
        name="plan_id"
        value={form.plan_id}
        onChange={handleChange}
        placeholder="UUID del plan"
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
        <Button type="button" variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
          Eliminar cliente
        </Button>
      </div>
    </form>
  );
}

// ── Azure DB Tab ──────────────────────────────────────────────────────────────

function AzureDbTab({ tenantId, initialConfig }: { tenantId: string; initialConfig: AzureDbConfigResponse | null }) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency_ms?: number | null; error?: string | null } | null>(null);

  const [form, setForm] = useState({
    host: initialConfig?.host ?? '',
    database_name: initialConfig?.database_name ?? '',
    db_username: initialConfig?.db_username ?? '',
    password: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.password) {
      setError('La contraseña es requerida para guardar la configuración.');
      return;
    }
    setSaving(true);
    setError('');
    setSaveSuccess(false);
    setTestResult(null);
    try {
      const result = await api.azureDb.save(tenantId, form);
      setConfig(result);
      setSaveSuccess(true);
      setForm((prev) => ({ ...prev, password: '' })); // Clear password field
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const result = await api.azureDb.test(tenantId);
      setTestResult(result);
      router.refresh();
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Error desconocido' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current status */}
      {config && (
        <div className="flex items-center gap-3 p-4 bg-[#132229] rounded-xl border border-[#32576F]">
          <div>
            <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Estado actual</p>
            <Badge variant={statusToBadgeVariant(config.status)} />
          </div>
          <div className="h-8 w-px bg-[#32576F] mx-2" />
          <div>
            <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Última prueba</p>
            <p className="text-[#CDD4DA] text-sm">
              {config.last_tested_at
                ? new Date(config.last_tested_at).toLocaleString('es-AR', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })
                : 'Nunca'}
            </p>
          </div>
          {config.host && (
            <>
              <div className="h-8 w-px bg-[#32576F] mx-2" />
              <div className="min-w-0">
                <p className="text-[#7A9BAD] text-xs uppercase tracking-wide mb-1">Servidor</p>
                <p className="text-[#CDD4DA] text-sm truncate">{config.host}</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Config form */}
      <form onSubmit={handleSave} className="space-y-4">
        <Input
          label="Servidor (Host)"
          name="host"
          value={form.host}
          onChange={handleChange}
          required
          placeholder="miempresa.database.windows.net"
          hint="URL del servidor Azure SQL"
        />
        <Input
          label="Nombre de la base de datos"
          name="database_name"
          value={form.database_name}
          onChange={handleChange}
          required
          placeholder="mi_base_datos"
        />
        <Input
          label="Usuario"
          name="db_username"
          value={form.db_username}
          onChange={handleChange}
          required
          placeholder="usuario@servidor"
        />
        <Input
          label="Contraseña"
          name="password"
          type="password"
          value={form.password}
          onChange={handleChange}
          required={!config}
          placeholder={config ? '••••••••  (dejar vacío para no cambiar)' : 'Contraseña de la base de datos'}
          hint="La contraseña se almacena encriptada en Supabase Vault"
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        {saveSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3">
            <p className="text-green-400 text-sm">Configuración guardada. Las credenciales están almacenadas de forma segura.</p>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`rounded-lg px-4 py-3 border ${
            testResult.success
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            {testResult.success ? (
              <p className="text-green-400 text-sm">
                Conexión exitosa — latencia: <strong>{testResult.latency_ms}ms</strong>
              </p>
            ) : (
              <p className="text-red-400 text-sm">
                Error de conexión: {testResult.error ?? 'Error desconocido'}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 flex-wrap">
          <Button type="submit" loading={saving}>
            {config ? 'Actualizar configuración' : 'Guardar configuración'}
          </Button>
          {config && (
            <Button
              type="button"
              variant="secondary"
              loading={testing}
              onClick={handleTest}
            >
              {testing ? 'Probando…' : 'Probar conexión'}
            </Button>
          )}
        </div>
      </form>

      {/* Info box */}
      <div className="bg-[#132229] border border-[#32576F]/50 rounded-xl p-4">
        <p className="text-[#7A9BAD] text-xs leading-relaxed">
          <strong className="text-[#CDD4DA]">Nota técnica:</strong> La prueba de conexión requiere que el servidor
          tenga instalado el driver <code className="bg-[#1E3340] px-1 rounded">ODBC Driver 18 for SQL Server</code>.
          Las credenciales se encriptan con Supabase Vault y nunca se exponen en texto plano.
        </p>
      </div>
    </div>
  );
}

// ── Analítica Tab ─────────────────────────────────────────────────────────────

const ANALYTICS_SECTIONS = [
  {
    key: 'ventas',
    label: 'Ventas',
    description: 'Ingresos, ticket promedio, breakdown por local, método de pago y producto.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    color: 'text-green-400',
    bg: 'bg-green-400/10 border-green-400/20',
  },
  {
    key: 'gastos',
    label: 'Gastos',
    description: 'Gastos por categoría, tipo y método de pago. Ratio respecto a ventas.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    color: 'text-red-400',
    bg: 'bg-red-400/10 border-red-400/20',
  },
  {
    key: 'stock',
    label: 'Stock',
    description: 'Niveles de stock, rotación, cobertura en días y clasificación ABC.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    color: 'text-blue-400',
    bg: 'bg-blue-400/10 border-blue-400/20',
  },
  {
    key: 'compras',
    label: 'Compras',
    description: 'Compras por período, top productos más comprados y promedio por orden.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    color: 'text-[#ED7C00]',
    bg: 'bg-[#ED7C00]/10 border-[#ED7C00]/20',
  },
] as const;

function AnaliticaTab({ tenantId, dbConfigured }: { tenantId: string; dbConfigured: boolean }) {
  if (!dbConfigured) {
    return (
      <div className="text-center py-8">
        <p className="text-[#7A9BAD] text-sm mb-2">
          Para ver la analítica, primero configure la Base de Datos Azure en la pestaña correspondiente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[#7A9BAD] text-sm">
        Seleccione una sección para ver los análisis detallados del negocio.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ANALYTICS_SECTIONS.map((section) => (
          <Link
            key={section.key}
            href={`/admin/clientes/${tenantId}/analitica/${section.key}`}
            className={`flex items-start gap-4 p-4 rounded-xl border ${section.bg} hover:opacity-80 transition-opacity`}
          >
            <div className={`flex-shrink-0 ${section.color} mt-0.5`}>
              {section.icon}
            </div>
            <div>
              <p className={`font-semibold text-sm ${section.color}`}>{section.label}</p>
              <p className="text-[#7A9BAD] text-xs mt-0.5 leading-relaxed">{section.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
