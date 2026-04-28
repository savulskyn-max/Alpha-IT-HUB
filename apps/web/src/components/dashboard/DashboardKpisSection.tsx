'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchDashboardKpis, type DashboardKpis } from '@/lib/api/dashboard';
import { KpiCard } from '@/components/ui/Card';
import { TendenciaChart } from './TendenciaChart';

const FETCH_TIMEOUT_MS = 10_000;
const SLOW_THRESHOLD_MS = 3_000;

function formatARS(v: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(v);
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 animate-pulse">
      <div className="h-3 w-28 bg-[#32576F] rounded mb-3" />
      <div className="h-8 w-36 bg-[#32576F] rounded mb-2" />
      <div className="h-3 w-20 bg-[#32576F] rounded" />
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 animate-pulse">
      <div className="h-3 w-56 bg-[#32576F] rounded mb-4" />
      <div className="h-40 bg-[#32576F]/40 rounded-xl" />
    </div>
  );
}

// ── Error / timeout banner ────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="col-span-full bg-[#1E3340] border border-red-500/40 rounded-2xl p-5 flex flex-col items-center gap-3 text-center">
      <p className="text-red-400 text-sm font-medium">
        No se pudieron cargar los datos del dashboard.
      </p>
      <p className="text-[#7A9BAD] text-xs max-w-md">{message}</p>
      <button
        onClick={onRetry}
        className="text-xs text-[#32BFFF] hover:text-white underline underline-offset-2"
      >
        Reintentar
      </button>
    </div>
  );
}

function TimeoutBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="col-span-full bg-[#1E3340] border border-yellow-600/40 rounded-2xl p-5 flex flex-col items-center gap-3 text-center">
      <p className="text-yellow-400 text-sm font-medium">
        La base de datos tardó más de lo esperado en responder.
      </p>
      <p className="text-[#7A9BAD] text-xs">La conexión expiró después de 10 segundos.</p>
      <button
        onClick={onRetry}
        className="text-xs text-[#32BFFF] hover:text-white underline underline-offset-2"
      >
        Reintentar
      </button>
    </div>
  );
}

// ── No tenant ─────────────────────────────────────────────────────────────────

function NoTenantBanner() {
  return (
    <div className="col-span-full bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 text-center">
      <p className="text-[#7A9BAD] text-sm">
        Tu cuenta no tiene una empresa asociada. Contactá al administrador.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Status = 'loading' | 'slow' | 'success' | 'error' | 'timeout';

interface Props {
  tenantId: string | null;
}

export function DashboardKpisSection({ tenantId }: Props) {
  const [status, setStatus]   = useState<Status>('loading');
  const [data, setData]       = useState<DashboardKpis | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const load = useCallback(async () => {
    if (!tenantId) return;

    setStatus('loading');
    setErrorMsg('');

    const ctrl = new AbortController();

    // Show "slow" message after 3 seconds
    const slowTimer = setTimeout(() => setStatus('slow'), SLOW_THRESHOLD_MS);

    // Hard timeout at 10 seconds
    const timeoutTimer = setTimeout(() => {
      ctrl.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const kpis = await fetchDashboardKpis(tenantId, ctrl.signal);
      setData(kpis);
      setStatus('success');
    } catch (err) {
      if (ctrl.signal.aborted) {
        setStatus('timeout');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Error desconocido');
        setStatus('error');
      }
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // ── No tenant ────────────────────────────────────────────────────────────────
  if (!tenantId) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <NoTenantBanner />
      </div>
    );
  }

  // ── Loading / slow ───────────────────────────────────────────────────────────
  if (status === 'loading' || status === 'slow') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
        </div>
        {status === 'slow' && (
          <p className="text-[#7A9BAD] text-xs text-center animate-pulse">
            Cargando datos desde la base de datos...
          </p>
        )}
        <ChartSkeleton />
      </div>
    );
  }

  // ── Timeout ──────────────────────────────────────────────────────────────────
  if (status === 'timeout') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TimeoutBanner onRetry={load} />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ErrorBanner message={errorMsg} onRetry={load} />
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  const kpis = data!;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Ventas de hoy"
          value={kpis.ventas_hoy_monto > 0 ? formatARS(kpis.ventas_hoy_monto) : '$ 0'}
          hint={
            kpis.ventas_hoy_cantidad > 0
              ? `${kpis.ventas_hoy_cantidad} transacciones`
              : 'Sin ventas registradas hoy'
          }
          accent
        />
        <KpiCard
          label="Ticket promedio"
          value={kpis.ticket_promedio > 0 ? formatARS(kpis.ticket_promedio) : '$ 0'}
          hint={kpis.ticket_promedio_es_7d ? 'Promedio últimos 7 días' : 'Promedio de hoy'}
        />
        <KpiCard
          label="Stock crítico"
          value={kpis.stock_critico}
          hint={
            kpis.stock_critico === 0
              ? 'Sin alertas de stock'
              : 'Productos bajo el mínimo'
          }
        />
        <KpiCard
          label="Baja rotación"
          value={kpis.baja_rotacion}
          hint={
            kpis.baja_rotacion === 0
              ? 'Todos los productos rotan'
              : 'Sin ventas en 60 días (con stock)'
          }
        />
      </div>

      <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">
          Tendencia de ventas — últimos 7 días
        </h2>
        <TendenciaChart data={kpis.tendencia_7d} />
      </div>
    </div>
  );
}
