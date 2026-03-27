/**
 * Typed API client for the Alpha IT Hub backend.
 * Attaches the Supabase session token to all requests.
 */
import { createClient } from '@/lib/supabase/client';

const BACKEND_URL = typeof window === 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')
  : '';

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw = await res.text();
    let detail = res.statusText || 'Request failed';
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { detail?: string };
        if (parsed?.detail) detail = parsed.detail;
      } catch {
        detail = raw;
      }
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KpiSummary {
  ventas_hoy: number;
  ventas_mes: number;
  gastos_mes: number;
  margen_mes: number;
  cantidad_ventas_mes: number;
  ticket_promedio: number;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  tenant_id: string | null;
}

// ── API Methods ──────────────────────────────────────────────────────────────

export const api = {
  auth: {
    me: () => request<UserProfile>('GET', '/api/v1/users/me'),
  },
  analytics: {
    kpis: (params?: { local_id?: number; period?: string }) => {
      const qs = new URLSearchParams();
      if (params?.local_id) qs.set('local_id', String(params.local_id));
      if (params?.period) qs.set('period', params.period);
      const query = qs.toString() ? `?${qs}` : '';
      return request<KpiSummary>('GET', `/api/v1/analytics/kpis${query}`);
    },
  },
};
