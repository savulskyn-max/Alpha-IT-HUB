'use client';

import { JwtTenantProvider } from '@/lib/tenant-context';
import StockAnalyticsPage from '@/app/(admin)/admin/clientes/[id]/analitica/stock/page';

export default function ClientStockPage() {
  return (
    <JwtTenantProvider>
      <StockAnalyticsPage />
    </JwtTenantProvider>
  );
}
