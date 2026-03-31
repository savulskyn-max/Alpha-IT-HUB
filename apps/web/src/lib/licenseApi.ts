/**
 * Client-side API functions for the license admin panel.
 * Calls go through the Next.js route handler at /api/license-admin/*
 * which adds the X-Admin-Key header server-side.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface LicenseDashboard {
  totalSubscriptions: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  revokedSubscriptions: number;
  expiringSoon: number;
  totalDevices: number;
  totalMaxDevices: number;
}

export interface Subscription {
  id: number;
  subscriptionKey: string;
  clientName: string;
  maxDevices: number;
  devicesUsed: number;
  expiresAt: string;
  isRevoked: boolean;
  createdAt: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface Device {
  id: number;
  machineId: string;
  machineName: string;
  lastSeenAt: string;
  isActive: boolean;
}

export interface SubscriptionDetail extends Subscription {
  devices: Device[];
}

export interface CreateSubscriptionRequest {
  clientName: string;
  maxDevices: number;
  expiresInMonths: number;
}

export interface UpdateSubscriptionRequest {
  clientName?: string;
  maxDevices?: number;
  expiresAt?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function licenseRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/license-admin/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = res.statusText;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error || parsed.detail || detail;
    } catch {
      if (text) detail = text;
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

// ── Server-side fetch (for async server components) ─────────────────────────

const LICENSE_API_BASE =
  'https://keloke-license-api-fyccdug0cag0efh5.brazilsouth-01.azurewebsites.net/api';

export async function licenseServerFetch<T>(path: string): Promise<T> {
  const adminKey = process.env.LICENSE_ADMIN_API_KEY ?? '';
  const res = await fetch(`${LICENSE_API_BASE}/license-admin/${path}`, {
    headers: {
      'X-Admin-Key': adminKey,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`License API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Client API ───────────────────────────────────────────────────────────────

export const licenseApi = {
  dashboard: () =>
    licenseRequest<LicenseDashboard>('GET', 'dashboard'),

  subscriptions: {
    list: () =>
      licenseRequest<Subscription[]>('GET', 'subscriptions'),

    get: (id: number) =>
      licenseRequest<SubscriptionDetail>('GET', `subscriptions/${id}`),

    create: (data: CreateSubscriptionRequest) =>
      licenseRequest<Subscription>('POST', 'subscriptions', data),

    update: (id: number, data: UpdateSubscriptionRequest) =>
      licenseRequest<Subscription>('PUT', `subscriptions/${id}`, data),

    revoke: (id: number) =>
      licenseRequest<{ success: boolean }>('POST', `subscriptions/${id}/revoke`),

    unrevoke: (id: number) =>
      licenseRequest<{ success: boolean }>('POST', `subscriptions/${id}/unrevoke`),

    renew: (id: number, months: number) =>
      licenseRequest<{ success: boolean; newExpiresAt: string }>(
        'POST',
        `subscriptions/${id}/renew`,
        { months },
      ),
  },

  devices: {
    activate: (id: number) =>
      licenseRequest<{ success: boolean }>('PUT', `devices/${id}/activate`),

    deactivate: (id: number) =>
      licenseRequest<{ success: boolean }>('PUT', `devices/${id}/deactivate`),
  },
};
