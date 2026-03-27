'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { api, type UserProfile, type TenantInfo } from '@/lib/api';

interface AuthState {
  user: UserProfile | null;
  tenant: TenantInfo | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    tenant: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setState({ user: null, tenant: null, loading: false, error: null });
        return;
      }

      try {
        const [profile, tenant] = await Promise.all([
          api.auth.me(),
          api.tenants.me(),
        ]);
        setState({ user: profile, tenant, loading: false, error: null });
      } catch (err) {
        setState({
          user: null,
          tenant: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Error loading profile',
        });
      }
    });
  }, []);

  return state;
}
