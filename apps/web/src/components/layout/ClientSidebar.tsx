'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    exact: true,
  },
  {
    label: 'Análisis',
    href: '/analysis',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    label: 'Agentes IA',
    href: '/agents',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.375 3.375 0 01-4.06.44L12 17m0 0l-.47.53a3.375 3.375 0 01-4.06.44L5 14.5m7 2.5v4.25" />
      </svg>
    ),
    exact: true,
  },
];

export function ClientSidebar() {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-[#1E3340] border-r border-[#32576F] flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#32576F]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#ED7C00] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            α
          </div>
          <div>
            <p className="font-semibold text-white text-sm leading-tight">Alpha IT Hub</p>
            <p className="text-[#7A9BAD] text-xs">Mi Panel</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <p className="px-2 mb-2 text-[#7A9BAD] text-xs font-semibold uppercase tracking-wider">
          Principal
        </p>
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                    transition-colors duration-150 group relative
                    ${active
                      ? 'bg-[#132229] text-white border-l-2 border-[#ED7C00] pl-[10px]'
                      : 'text-[#7A9BAD] hover:bg-[#132229]/60 hover:text-[#CDD4DA]'
                    }
                  `}
                >
                  <span className={active ? 'text-[#ED7C00]' : 'text-[#7A9BAD] group-hover:text-[#CDD4DA]'}>
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Subscription section */}
        <div className="mt-6">
          <p className="px-2 mb-2 text-[#7A9BAD] text-xs font-semibold uppercase tracking-wider">
            Suscripción
          </p>
          <div className="mx-2 p-3 bg-[#132229] rounded-lg border border-[#32576F]">
            <p className="text-[#CDD4DA] text-xs font-medium">Plan actual</p>
            <p className="text-white text-sm font-semibold mt-0.5">Pro</p>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[#7A9BAD]">Renovación</span>
                <span className="text-[#CDD4DA]">—</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#7A9BAD]">Estado</span>
                <span className="text-green-400">Activo</span>
              </div>
            </div>
            <p className="text-[#7A9BAD] text-[10px] mt-2 italic">
              Información de suscripción no disponible
            </p>
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-[#32576F]">
        <p className="text-[#7A9BAD] text-xs text-center">
          Alpha IT Hub © {new Date().getFullYear()}
        </p>
      </div>
    </aside>
  );
}
