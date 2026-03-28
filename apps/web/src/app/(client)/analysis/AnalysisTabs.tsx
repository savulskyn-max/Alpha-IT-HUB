'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Stock', href: '/analysis/stock' },
  { label: 'Ventas', href: '/analysis/ventas' },
  { label: 'Gastos', href: '/analysis/gastos' },
  { label: 'Compras', href: '/analysis/compras' },
];

export function AnalysisTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 bg-[#1E3340] border border-[#32576F] rounded-xl p-1 w-fit">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${active
                ? 'bg-[#ED7C00] text-white'
                : 'text-[#7A9BAD] hover:text-[#CDD4DA] hover:bg-[#132229]/60'
              }
            `}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
