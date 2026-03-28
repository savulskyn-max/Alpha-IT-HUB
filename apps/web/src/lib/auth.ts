import type { User } from '@supabase/supabase-js';

export type AppRole = 'admin' | 'superadmin' | 'owner' | 'manager' | 'staff' | 'viewer';

/**
 * Extract the user role from Supabase JWT metadata.
 * Priority: app_metadata.role > user_metadata.role > fallback 'viewer'
 */
export function getUserRole(user: User | null): AppRole {
  if (!user) return 'viewer';

  const role =
    (user.app_metadata?.role as string) ??
    (user.user_metadata?.role as string) ??
    'viewer';

  return role as AppRole;
}

/** Returns true when the role grants admin-level access */
export function isAdminRole(role: AppRole): boolean {
  return role === 'admin' || role === 'superadmin';
}

/** Determine where a user should land after login */
export function getHomeRoute(role: AppRole): string {
  return isAdminRole(role) ? '/admin' : '/dashboard';
}
