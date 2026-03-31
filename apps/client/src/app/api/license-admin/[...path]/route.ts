import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const LICENSE_API_BASE =
  'https://keloke-license-api-fyccdug0cag0efh5.brazilsouth-01.azurewebsites.net/api';

const ADMIN_KEY = process.env.LICENSE_ADMIN_API_KEY ?? '';

const ALLOWED_ROLES = ['owner', 'admin', 'superadmin'];

async function verifyRole(request: NextRequest): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'not_authenticated';
    const role = (user.user_metadata?.role as string) ?? 'viewer';
    if (!ALLOWED_ROLES.includes(role)) return 'insufficient_permissions';
    return null;
  } catch {
    return 'auth_error';
  }
}

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const error = await verifyRole(request);
  if (error) {
    return NextResponse.json({ error }, { status: 403 });
  }

  if (!ADMIN_KEY) {
    return NextResponse.json(
      { error: 'LICENSE_ADMIN_API_KEY not configured' },
      { status: 500 },
    );
  }

  const { path } = await params;
  const target = `${LICENSE_API_BASE}/license-admin/${path.join('/')}`;
  const headers: Record<string, string> = {
    'X-Admin-Key': ADMIN_KEY,
    'Content-Type': 'application/json',
  };

  const init: RequestInit = { method: request.method, headers };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      const body = await request.text();
      if (body) init.body = body;
    } catch {
      // no body
    }
  }

  try {
    const upstream = await fetch(target, init);
    const data = await upstream.text();
    return new NextResponse(data, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to reach license API', detail: String(err) },
      { status: 502 },
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
