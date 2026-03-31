'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface TenantContextValue {
  tenantId: string;
  backLink: string;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/**
 * Get the current tenant ID.
 * Priority: explicit TenantContext > URL params.id > JWT claim
 */
export function useTenantId(): string {
  const ctx = useContext(TenantContext);
  const params = useParams();

  // 1. From context (client wrapper pages)
  if (ctx?.tenantId) return ctx.tenantId;

  // 2. From URL params (admin pages: /admin/clientes/[id]/...)
  if (params?.id) return params.id as string;

  return '';
}

/**
 * Get the back-navigation link.
 */
export function useBackLink(): string {
  const ctx = useContext(TenantContext);
  const params = useParams();

  if (ctx?.backLink) return ctx.backLink;
  if (params?.id) return `/admin/clientes/${params.id}`;
  return '/dashboard';
}

/**
 * Provider that injects tenant_id from the JWT for client-facing pages.
 * Fallback chain: JWT claim → user metadata → backend /auth/me
 */
export function JwtTenantProvider({ children }: { children: React.ReactNode }) {
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      let resolved = '';

      // 1. Try JWT custom claims
      if (session?.access_token) {
        try {
          const payload = session.access_token.split('.')[1];
          const claims = JSON.parse(atob(payload));
          if (claims.tenant_id) resolved = claims.tenant_id;
        } catch {
          // continue to fallback
        }
      }

      // 2. Fallback to Supabase user metadata
      if (!resolved && user) {
        resolved =
          (user.app_metadata?.tenant_id as string) ??
          (user.user_metadata?.tenant_id as string) ??
          '';
      }

      // 3. Fallback to backend /auth/me
      if (!resolved && session?.access_token) {
        try {
          const res = await fetch('/api/v1/auth/me', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const me = await res.json();
            if (me.tenant_id) resolved = me.tenant_id;
          } else {
            setErrorMsg(`Error al verificar tu cuenta (${res.status})`);
          }
        } catch {
          setErrorMsg('No se pudo conectar con el servidor');
        }
      }

      setTenantId(resolved);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#ED7C00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 m-6 text-center">
        <p className="text-[#7A9BAD] text-sm">
          {errorMsg || 'No se encontró un tenant asociado a tu cuenta. Contacta al administrador.'}
        </p>
      </div>
    );
  }

  return (
    <TenantContext.Provider value={{ tenantId, backLink: '/dashboard' }}>
      {children}
    </TenantContext.Provider>
  );
}
