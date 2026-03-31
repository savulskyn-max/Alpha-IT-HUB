'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  api,
  type StockResponse,
  type VentasResponse,
  type GastosResponse,
  type ComprasResponse,
  type KpiSummary,
  type FiltrosDisponibles,
} from '@/lib/api';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface AnalyticsCacheData {
  stock: StockResponse | null;
  ventas: VentasResponse | null;
  gastos: GastosResponse | null;
  compras: ComprasResponse | null;
  kpis: KpiSummary | null;
  filtros: FiltrosDisponibles | null;
}

interface AnalyticsCacheState extends AnalyticsCacheData {
  loading: Record<keyof AnalyticsCacheData, boolean>;
  errors: Record<keyof AnalyticsCacheData, string | null>;
  refresh: () => void;
  lastRefreshed: number | null;
}

const defaultLoading = {
  stock: true, ventas: true, gastos: true, compras: true, kpis: true, filtros: true,
};
const defaultErrors = {
  stock: null, ventas: null, gastos: null, compras: null, kpis: null, filtros: null,
} as Record<keyof AnalyticsCacheData, string | null>;

const AnalyticsCacheContext = createContext<AnalyticsCacheState | null>(null);

export function useAnalyticsCache(): AnalyticsCacheState {
  const ctx = useContext(AnalyticsCacheContext);
  if (!ctx) {
    // Return a "not available" state — components can fall back to direct fetching
    return {
      stock: null, ventas: null, gastos: null, compras: null, kpis: null, filtros: null,
      loading: defaultLoading,
      errors: defaultErrors,
      refresh: () => {},
      lastRefreshed: null,
    };
  }
  return ctx;
}

interface Props {
  tenantId: string;
  children: React.ReactNode;
}

export function AnalyticsCacheProvider({ tenantId, children }: Props) {
  const [data, setData] = useState<AnalyticsCacheData>({
    stock: null, ventas: null, gastos: null, compras: null, kpis: null, filtros: null,
  });
  const [loading, setLoading] = useState({ ...defaultLoading });
  const [errors, setErrors] = useState({ ...defaultErrors });
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    if (!tenantId) return;

    setLoading({ stock: true, ventas: true, gastos: true, compras: true, kpis: true, filtros: true });
    setErrors({ ...defaultErrors });

    const fetchers: Array<{
      key: keyof AnalyticsCacheData;
      fn: () => Promise<unknown>;
    }> = [
      { key: 'stock', fn: () => api.analytics.stock(tenantId) },
      { key: 'ventas', fn: () => api.analytics.ventas(tenantId) },
      { key: 'gastos', fn: () => api.analytics.gastos(tenantId) },
      { key: 'compras', fn: () => api.analytics.compras(tenantId) },
      { key: 'kpis', fn: () => api.analytics.kpis(tenantId) },
      { key: 'filtros', fn: () => api.analytics.filtros(tenantId) },
    ];

    const results = await Promise.allSettled(fetchers.map(f => f.fn()));

    const newData = { ...data };
    const newErrors = { ...defaultErrors };
    const newLoading = { stock: false, ventas: false, gastos: false, compras: false, kpis: false, filtros: false };

    results.forEach((result, idx) => {
      const key = fetchers[idx].key;
      if (result.status === 'fulfilled') {
        (newData as Record<string, unknown>)[key] = result.value;
        newErrors[key] = null;
      } else {
        newErrors[key] = result.reason instanceof Error ? result.reason.message : 'Error desconocido';
      }
    });

    setData(newData);
    setErrors(newErrors);
    setLoading(newLoading);
    setLastRefreshed(Date.now());
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAll();

    intervalRef.current = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  const value: AnalyticsCacheState = {
    ...data,
    loading,
    errors,
    refresh: fetchAll,
    lastRefreshed,
  };

  return (
    <AnalyticsCacheContext.Provider value={value}>
      {children}
    </AnalyticsCacheContext.Provider>
  );
}
