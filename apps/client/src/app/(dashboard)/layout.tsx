'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { LayoutDashboard, BarChart3, Bot, LogOut, Menu, X } from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
  { href: '/analysis', label: 'Análisis', icon: BarChart3 },
  { href: '/agents', label: 'Agentes IA', icon: Bot, badge: 'Pronto' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [userName, setUserName] = useState('');
  const [tenantName, setTenantName] = useState('Mi Tienda');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login');
        return;
      }
      setUserName(user.user_metadata?.full_name || user.email || '');
    });
  }, [router, supabase.auth]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen flex bg-[#F5F7F9]">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-[#132229] flex flex-col transform transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[#32576F]/30">
          <div className="w-9 h-9 rounded-lg bg-[#ED7C00] flex items-center justify-center text-white text-lg font-bold">
            α
          </div>
          <span className="text-white font-semibold">Alpha IT Hub</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto text-[#7A9BAD] lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? 'bg-[#32576F]/30 text-white border-l-3 border-[#ED7C00]'
                  : 'text-[#7A9BAD] hover:text-white hover:bg-[#32576F]/20'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
              {item.badge && (
                <span className="ml-auto text-xs bg-[#ED7C00]/20 text-[#ED7C00] px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-[#32576F]/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#32576F] flex items-center justify-center text-white text-xs font-semibold">
              {userName?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{userName}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-[#7A9BAD] hover:text-red-400 transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-[#132229] lg:hidden"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div>
            <h2 className="text-[#132229] font-semibold text-sm">{tenantName}</h2>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
