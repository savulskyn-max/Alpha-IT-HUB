import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ClientSidebar } from '@/components/layout/ClientSidebar';

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Role-based routing is handled by middleware (proxy.ts).
  // The layout only verifies authentication — no cross-section redirects
  // to avoid redirect loops when JWT/metadata and backend disagree on role.

  return (
    <div className="min-h-screen bg-[#132229] flex">
      <ClientSidebar />
      <div className="flex-1 ml-60 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
