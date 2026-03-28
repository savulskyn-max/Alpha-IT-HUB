import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserRole, isAdminRole } from '@/lib/auth';
import { AdminSidebar } from '@/components/layout/AdminSidebar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const role = getUserRole(user);
  if (!isAdminRole(role)) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-[#132229] flex">
      <AdminSidebar />
      <div className="flex-1 ml-60 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
