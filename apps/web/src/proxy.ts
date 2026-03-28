import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// ── Route definitions ──────────────────────────────────────────
const PUBLIC_ROUTES = ['/', '/login', '/forgot-password'];
const ADMIN_PREFIX = '/admin';
const CLIENT_PREFIXES = ['/dashboard', '/analysis', '/agents'];

function isAdminRoute(pathname: string) {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
}

function isClientRoute(pathname: string) {
  return CLIENT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function isProtectedRoute(pathname: string) {
  return isAdminRoute(pathname) || isClientRoute(pathname);
}

function isAdminRoleValue(role: string): boolean {
  return role === 'admin' || role === 'superadmin';
}

/** Decode JWT payload to extract custom claims (user_role, tenant_id) */
function decodeJwtRole(token: string): string {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload, 'base64url').toString('utf-8');
    const claims = JSON.parse(json);
    return (claims.user_role as string) ?? 'viewer';
  } catch {
    return 'viewer';
  }
}

// ── Proxy (Middleware) ──────────────────────────────────────────
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── 1. Unauthenticated on protected route → /login ──
  if (!user && isProtectedRoute(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user) {
    // Get role from JWT custom claims (injected by auth hook)
    const { data: { session } } = await supabase.auth.getSession();
    const role = session?.access_token
      ? decodeJwtRole(session.access_token)
      : 'viewer';
    const admin = isAdminRoleValue(role);

    // ── 2. Authenticated on /login → redirect to home by role ──
    if (pathname === '/login') {
      const home = admin ? '/admin' : '/dashboard';
      return NextResponse.redirect(new URL(home, request.url));
    }

    // ── 3. Non-admin trying to access /admin/* → /dashboard ──
    if (!admin && isAdminRoute(pathname)) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    // ── 4. Admin trying to access client routes → /admin ──
    if (admin && isClientRoute(pathname)) {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
