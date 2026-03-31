import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserRole, isAdminRole, fetchUserProfile } from '@/lib/auth';
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

  const { data: { session } } = await supabase.auth.getSession();
  let role = getUserRole(user, session);

  // Fallback: if JWT/metadata didn't resolve role, check the backend DB
  if (role === 'viewer' && session?.access_token) {
    const profile = await fetchUserProfile(session.access_token);
    if (profile) role = profile.role;
  }

  if (isAdminRole(role)) {
    redirect('/admin');
  }

  return (
    <div className="min-h-screen bg-[#132229] flex">
      <ClientSidebar />
      <div className="flex-1 ml-60 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
