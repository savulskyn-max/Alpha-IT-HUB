import { createBrowserClient } from '@supabase/ssr';

function getCookieDomain(): string | undefined {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('alphaitgroup.com')) {
    return '.alphaitgroup.com';
  }
  return undefined;
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createBrowserClient(url, key, {
    cookieOptions: {
      domain: getCookieDomain(),
      path: '/',
    },
  });
}
