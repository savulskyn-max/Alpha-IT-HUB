import type { User, Session } from '@supabase/supabase-js';

export type AppRole = 'admin' | 'superadmin' | 'owner' | 'manager' | 'staff' | 'viewer';

/**
 * Decode the JWT payload to extract custom claims injected by the
 * Supabase auth hook (user_role, tenant_id).
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const payload = parts[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Extract the user role.
 * Priority: JWT custom claim (user_role) > app_metadata.role > user_metadata.role > 'viewer'
 */
export function getUserRole(user: User | null, session?: Session | null): AppRole {
  if (!user) return 'viewer';

  // 1. Check JWT custom claims first (injected by auth hook)
  if (session?.access_token) {
    const claims = decodeJwtPayload(session.access_token);
    if (claims.user_role && typeof claims.user_role === 'string') {
      return claims.user_role as AppRole;
    }
  }

  // 2. Fallback to Supabase metadata
  const role =
    (user.app_metadata?.role as string) ??
    (user.user_metadata?.role as string) ??
    'viewer';

  return role as AppRole;
}

/**
 * Extract tenant_id from JWT custom claims or user metadata.
 */
export function getUserTenantId(user: User | null, session?: Session | null): string | null {
  if (!user) return null;

  // 1. Check JWT custom claims first
  if (session?.access_token) {
    const claims = decodeJwtPayload(session.access_token);
    if (claims.tenant_id && typeof claims.tenant_id === 'string') {
      return claims.tenant_id;
    }
  }

  // 2. Fallback to metadata
  return (
    (user.app_metadata?.tenant_id as string) ??
    (user.user_metadata?.tenant_id as string) ??
    null
  );
}

/** Returns true when the role grants admin-level access */
export function isAdminRole(role: AppRole): boolean {
  return role === 'admin' || role === 'superadmin';
}

/** Determine where a user should land after login */
export function getHomeRoute(role: AppRole): string {
  return isAdminRole(role) ? '/admin' : '/dashboard';
}

/**
 * Extract role from JWT token string (for use in middleware where
 * we only have the access_token, not a full User object).
 */
export function getRoleFromToken(accessToken: string): AppRole {
  const claims = decodeJwtPayload(accessToken);
  if (claims.user_role && typeof claims.user_role === 'string') {
    return claims.user_role as AppRole;
  }
  return 'viewer';
}

export function getTenantIdFromToken(accessToken: string): string | null {
  const claims = decodeJwtPayload(accessToken);
  if (claims.tenant_id && typeof claims.tenant_id === 'string') {
    return claims.tenant_id;
  }
  return null;
}
