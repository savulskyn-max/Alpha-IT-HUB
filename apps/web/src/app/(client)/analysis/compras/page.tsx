'use client';

import { JwtTenantProvider } from '@/lib/tenant-context';
import ComprasAnalyticsPage from '@/app/(admin)/admin/clientes/[id]/analitica/compras/page';

export default function ClientComprasPage() {
  return (
    <JwtTenantProvider>
      <ComprasAnalyticsPage />
    </JwtTenantProvider>
  );
}
