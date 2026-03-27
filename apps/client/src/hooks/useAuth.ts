'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type UserProfile, type TenantInfo } from '@/lib/api';

const ADMIN_ROLES = ['superadmin', 'admin'];

interface AuthState {
  user: UserProfile | null;
  tenant: TenantInfo | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    tenant: null,
    loading: true,
    error: null,
    isAdmin: false,
  });

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setState({ user: null, tenant: null, loading: false, error: null, isAdmin: false });
        return;
      }

      try {
        const profile = await api.auth.me();
        const isAdmin = ADMIN_ROLES.includes(profile.role);

        let tenant: TenantInfo | null = null;
        if (profile.tenant_id) {
          try {
            tenant = await api.tenants.me();
          } catch {
            // Admin users may not have a tenant — that's OK
          }
        }

        setState({ user: profile, tenant, loading: false, error: null, isAdmin });
      } catch (err) {
        // If /users/me fails, fall back to Supabase user metadata
        const meta = user.user_metadata;
        const role = (meta?.role as string) ?? 'viewer';
        const isAdmin = ADMIN_ROLES.includes(role);
        const fallbackUser: UserProfile = {
          id: user.id,
          email: user.email ?? '',
          full_name: (meta?.full_name as string) ?? null,
          role,
          tenant_id: (meta?.tenant_id as string) ?? null,
        };
        setState({
          user: fallbackUser,
          tenant: null,
          loading: false,
          error: null,
          isAdmin,
        });
      }
    });
  }, []);

  return state;
}
