'use client';

import { useAuth } from '@/hooks/useAuth';
import { CreditCard, Loader2 } from 'lucide-react';

export default function LicensesPage() {
  const { tenant, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-12">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Cargando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#132229]">Licencias</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-[#ED7C00]/10 flex items-center justify-center mx-auto mb-4">
          <CreditCard className="w-7 h-7 text-[#ED7C00]" />
        </div>
        <h3 className="text-lg font-semibold text-[#132229] mb-2">Gestión de Licencias</h3>
        <p className="text-gray-500 text-sm max-w-md mx-auto mb-4">
          Próximamente podrás gestionar tu plan, ver el estado de tu suscripción
          y administrar los pagos desde acá.
        </p>
        {tenant && (
          <div className="inline-block bg-green-50 border border-green-200 rounded-lg px-4 py-2">
            <p className="text-green-700 text-sm font-medium">
              Plan activo — {tenant.name}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
