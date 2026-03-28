'use client';

import { JwtTenantProvider } from '@/lib/tenant-context';
import VentasAnalyticsPage from '@/app/(admin)/admin/clientes/[id]/analitica/ventas/page';

export default function ClientVentasPage() {
  return (
    <JwtTenantProvider>
      <VentasAnalyticsPage />
    </JwtTenantProvider>
  );
}
