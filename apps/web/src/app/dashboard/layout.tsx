import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/Sidebar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check JWT claims to determine if this is a tenant user
  const { data: { session } } = await supabase.auth.getSession();
  let isTenantUser = false;

  if (session?.access_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(session.access_token.split('.')[1], 'base64').toString(),
      );
      isTenantUser = !!payload.tenant_id;
    } catch {
      // If decode fails, default to admin layout
    }
  }

  // Tenant users get a clean layout without admin sidebar
  if (isTenantUser) {
    return (
      <div className="min-h-screen bg-[#132229] flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#132229] flex">
      <Sidebar />
      {/* Main content — offset by sidebar width */}
      <div className="flex-1 ml-60 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
