'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AnalyticsCacheProvider } from '@/lib/analytics-cache';

export function AnalyticsCacheWrapper({ children }: { children: React.ReactNode }) {
  const [tenantId, setTenantId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function resolve() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      let id = '';

      // JWT claim
      if (session?.access_token) {
        try {
          const payload = session.access_token.split('.')[1];
          const claims = JSON.parse(atob(payload));
          if (claims.tenant_id) id = claims.tenant_id;
        } catch { /* continue */ }
      }

      // User metadata fallback
      if (!id && user) {
        id = (user.app_metadata?.tenant_id as string) ??
             (user.user_metadata?.tenant_id as string) ?? '';
      }

      // Backend fallback
      if (!id && session?.access_token) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
          const res = await fetch('/api/v1/auth/me', {
            headers: { Authorization: `Bearer ${session.access_token}` },
            signal: ctrl.signal,
          });
          if (res.ok) {
            const me = await res.json();
            if (me.tenant_id) id = me.tenant_id;
          }
        } catch { /* continue */ } finally {
          clearTimeout(timer);
        }
      }

      setTenantId(id);
      setReady(true);
    }
    resolve();
  }, []);

  if (!ready) return null; // Layout already shows header/tabs while this resolves

  if (!tenantId) return <>{children}</>; // Let individual pages handle missing tenant

  return (
    <AnalyticsCacheProvider tenantId={tenantId}>
      {children}
    </AnalyticsCacheProvider>
  );
}
