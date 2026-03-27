import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Root page: redirect based on user role.
 * Admin → /dashboard, Tenant user → /dashboard/clientes/{id}/analitica
 */
export default async function RootPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.access_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(session.access_token.split('.')[1], 'base64').toString(),
      );
      if (payload.tenant_id) {
        redirect(`/dashboard/clientes/${payload.tenant_id}/analitica`);
      }
    } catch {
      // Fallback to default dashboard
    }
  }

  redirect('/dashboard');
}
