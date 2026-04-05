'use client';

import { useParams } from 'next/navigation';
import { AnalyticsCacheProvider } from '@/lib/analytics-cache';

export default function AnaliticaLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const tenantId = (params?.id as string) ?? '';

  return (
    <AnalyticsCacheProvider tenantId={tenantId}>
      {children}
    </AnalyticsCacheProvider>
  );
}
