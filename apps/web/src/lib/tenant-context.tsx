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
 */
export function JwtTenantProvider({ children }: { children: React.ReactNode }) {
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        try {
          const payload = session.access_token.split('.')[1];
          const claims = JSON.parse(atob(payload));
          setTenantId(claims.tenant_id ?? '');
        } catch {
          // fallback
        }
      }
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
          No se encontró un tenant asociado a tu cuenta. Contacta al administrador.
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
