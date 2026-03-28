'use client';

import { JwtTenantProvider } from '@/lib/tenant-context';
import GastosAnalyticsPage from '@/app/(admin)/admin/clientes/[id]/analitica/gastos/page';

export default function ClientGastosPage() {
  return (
    <JwtTenantProvider>
      <GastosAnalyticsPage />
    </JwtTenantProvider>
  );
}
