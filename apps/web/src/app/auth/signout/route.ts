import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const origin = new URL(request.url).origin;
  // Use 303 (See Other) so the browser does a GET to /login instead of POST
  const response = NextResponse.redirect(`${origin}/login`, 303);
  // Clear role cookie so middleware doesn't use stale role on next login
  response.cookies.set('x-user-role', '', { path: '/', maxAge: 0 });
  return response;
}

// Handle accidental GET requests (browser prefetch, etc.)
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/login`);
}
