/**
 * Typed API client for the Alpha IT Hub backend.
 * Automatically attaches the Supabase session token to all requests.
 */
import { createClient } from '@/lib/supabase/client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, err.detail ?? 'Request failed');
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserResponse {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  tenant_id: string | null;
  created_at: string | null;
}

export interface UserCreate {
  email: string;
  full_name: string;
  role?: string;
  tenant_id?: string | null;
  phone?: string | null;
  password?: string | null;
}

export interface UserUpdate {
  full_name?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  tenant_id?: string | null;
}

export interface UserListResponse {
  items: UserResponse[];
  total: number;
}

export interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  plan_name: string | null;
  user_count: number;
  db_status: string | null;
  created_at: string | null;
}

export interface TenantCreate {
  name: string;
  slug: string;
  plan_id?: string | null;
  status?: string;
}

export interface TenantUpdate {
  name?: string | null;
  plan_id?: string | null;
  status?: string | null;
}

export interface TenantListResponse {
  items: TenantDetail[];
  total: number;
}

export interface AzureDbConfigResponse {
  id: string;
  tenant_id: string;
  host: string;
  database_name: string;
  db_username: string;
  status: string;
  last_tested_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AzureDbConfigCreate {
  host: string;
  database_name: string;
  db_username: string;
  password: string;
}

export interface AzureDbTestResult {
  success: boolean;
  latency_ms: number | null;
  error: string | null;
}

// ── API methods ───────────────────────────────────────────────────────────────

export const api = {
  users: {
    list: (params?: { tenant_id?: string; role?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.tenant_id) qs.set('tenant_id', params.tenant_id);
      if (params?.role) qs.set('role', params.role);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      const query = qs.toString() ? `?${qs}` : '';
      return request<UserListResponse>('GET', `/api/v1/users${query}`);
    },
    getMe: () => request<UserResponse>('GET', '/api/v1/users/me'),
    updateMe: (data: UserUpdate) => request<UserResponse>('PUT', '/api/v1/users/me', data),
    get: (id: string) => request<UserResponse>('GET', `/api/v1/users/${id}`),
    create: (data: UserCreate) => request<UserResponse>('POST', '/api/v1/users', data),
    update: (id: string, data: UserUpdate) =>
      request<UserResponse>('PUT', `/api/v1/users/${id}`, data),
    delete: (id: string) => request<void>('DELETE', `/api/v1/users/${id}`),
  },

  tenants: {
    list: (params?: { limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      const query = qs.toString() ? `?${qs}` : '';
      return request<TenantListResponse>('GET', `/api/v1/tenants${query}`);
    },
    getMe: () => request<TenantDetail>('GET', '/api/v1/tenants/me'),
    get: (id: string) => request<TenantDetail>('GET', `/api/v1/tenants/${id}`),
    create: (data: TenantCreate) => request<TenantDetail>('POST', '/api/v1/tenants', data),
    update: (id: string, data: TenantUpdate) =>
      request<TenantDetail>('PUT', `/api/v1/tenants/${id}`, data),
    delete: (id: string) => request<void>('DELETE', `/api/v1/tenants/${id}`),
  },

  azureDb: {
    get: (tenantId: string) =>
      request<AzureDbConfigResponse>('GET', `/api/v1/azure-db/${tenantId}`),
    save: (tenantId: string, data: AzureDbConfigCreate) =>
      request<AzureDbConfigResponse>('POST', `/api/v1/azure-db/${tenantId}`, data),
    test: (tenantId: string) =>
      request<AzureDbTestResult>('POST', `/api/v1/azure-db/${tenantId}/test`),
    delete: (tenantId: string) => request<void>('DELETE', `/api/v1/azure-db/${tenantId}`),
  },
};
