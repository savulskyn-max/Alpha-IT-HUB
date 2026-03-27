'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/dashboard/analysis/stock', label: 'Stock' },
  { href: '/dashboard/analysis/sales', label: 'Ventas' },
  { href: '/dashboard/analysis/expenses', label: 'Gastos' },
  { href: '/dashboard/analysis/purchases', label: 'Compras' },
];

export default function AnalysisLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#132229]">Análisis</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 text-center py-2.5 rounded-lg text-sm font-medium transition-colors ${
              pathname.startsWith(tab.href)
                ? 'bg-white text-[#132229] shadow-sm'
                : 'text-gray-500 hover:text-[#132229]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  );
}
