import { createClient } from '@/lib/supabase/client';

// Match BACKEND_URL logic from lib/api.ts: server gets full URL, browser uses same-origin
const BACKEND_URL = typeof window === 'undefined'
  ? (
      process.env.NEXT_PUBLIC_BACKEND_URL ??
      process.env.BACKEND_URL ??
      'http://localhost:8000'
    ).replace(/\/$/, '')
  : '';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TendenciaDia {
  dia: string;    // "2025-01-15"
  total: number;
}

export interface DashboardKpis {
  ventas_hoy_cantidad: number;
  ventas_hoy_monto: number;
  ticket_promedio: number;
  ticket_promedio_es_7d: boolean;
  stock_critico: number;
  baja_rotacion: number;
  tendencia_7d: TendenciaDia[];
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchDashboardKpis(
  tenantId: string,
  signal?: AbortSignal,
): Promise<DashboardKpis> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${BACKEND_URL}/api/v1/dashboard/${tenantId}/kpis`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = `Error ${res.status}: ${res.statusText}`;
    try {
      const json = JSON.parse(body) as { detail?: unknown };
      if (json?.detail) {
        message = typeof json.detail === 'string'
          ? json.detail
          : JSON.stringify(json.detail);
      }
    } catch { /* keep default */ }
    throw new Error(message);
  }

  return res.json() as Promise<DashboardKpis>;
}
