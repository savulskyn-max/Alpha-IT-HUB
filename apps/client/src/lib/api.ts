/**
 * Typed API client for the Alpha IT Hub backend (client app).
 * Attaches the Supabase session token to all requests.
 */
import { createClient } from '@/lib/supabase/client';

const BACKEND_URL = typeof window === 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')
  : '';

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw = await res.text();
    let detail = res.statusText || 'Request failed';
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { detail?: string };
        if (parsed?.detail) detail = parsed.detail;
      } catch {
        detail = raw;
      }
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  tenant_id: string | null;
}

export interface KpiSummary {
  ventas_hoy: number;
  ventas_mes: number;
  gastos_mes: number;
  margen_mes: number;
  cantidad_ventas_mes: number;
  ticket_promedio: number;
}

export interface VentasPorFecha {
  fecha: string;
  total: number;
  cantidad: number;
}

export interface VentasResponse {
  serie_temporal: VentasPorFecha[];
  por_local: Array<{ nombre: string; total: number; pct: number }>;
  por_metodo_pago: Array<{ nombre: string; total: number; pct: number }>;
  por_tipo_venta: Array<{ tipo: string; total: number; pct: number }>;
  top_productos: Array<{ nombre: string; descripcion: string; talle: string; color: string; total: number; cantidad: number; pct: number }>;
  top_por_nombre: Array<{ nombre: string; total: number; cantidad: number; pct: number }>;
  total_periodo: number;
  facturado_bruto: number;
  cantidad_ventas: number;
  cantidad_unidades_vendidas: number;
  ticket_promedio: number;
  cmv: number;
  comisiones: number;
  vendido_cuenta: number;
  cantidad_cuenta: number;
  cobros_cuenta: number;
  pct_del_total: number | null;
}

export interface GastosResponse {
  serie_temporal: Array<{ fecha: string; total: number }>;
  por_tipo: Array<{ tipo: string; total: number; pct: number }>;
  por_categoria: Array<{ categoria: string; tipo: string; total: number; pct: number }>;
  por_metodo_pago: Array<{ nombre: string; total: number; pct: number }>;
  detalle_gastos: Array<{ fecha: string; tipo: string; categoria: string; metodo_pago: string; monto: number; descripcion?: string }>;
  total_periodo: number;
  ratio_ventas: number | null;
}

export interface ComprasResponse {
  serie_temporal: Array<{ fecha: string; total: number; cantidad: number }>;
  top_productos: Array<{ nombre: string; total: number; cantidad: number }>;
  por_proveedor: Array<{ proveedor: string; total: number; ordenes: number }>;
  ultimas_compras: Array<Record<string, unknown>>;
  top_proveedores: Array<{ proveedor: string; total: number; ordenes: number }>;
  ordenes: Array<Record<string, unknown>>;
  total_periodo: number;
  cantidad_ordenes: number;
  promedio_por_orden: number;
  unidades_totales: number;
}

export interface FiltrosDisponibles {
  locales: Array<{ id: number; nombre: string }>;
  metodos_pago: Array<{ id: number; nombre: string }>;
  tipos_venta: Array<{ id: number; nombre: string }>;
  tipos_gasto: Array<{ id: number; nombre: string }>;
  categorias_gasto: Array<{ id: number; nombre: string }>;
  proveedores: Array<{ id: number; nombre: string }>;
  nombres_producto: Array<{ id: number; nombre: string }>;
}

// ── Stock Types ──────────────────────────────────────────────────────────────

export interface ProductoStock {
  producto_id: number;
  nombre: string;
  descripcion: string | null;
  talle: string | null;
  color: string | null;
  stock_actual: number;
  precio_costo: number;
  monto_stock: number;
  unidades_vendidas_periodo: number;
  rotacion: number;
  rotacion_anualizada: number;
  cobertura_dias: number;
  cobertura_ajustada: number;
  contribucion_pct: number;
  clasificacion_abc: string;
  es_substock: boolean;
  es_sobrestock: boolean;
}

export interface AbcNombre {
  nombre: string;
  stock_total: number;
  monto_stock: number;
  unidades_vendidas: number;
  revenue: number;
  rotacion: number;
  cobertura_dias: number;
  contribucion_pct: number;
  clasificacion_abc: string;
}

export interface MasVendido {
  nombre: string;
  descripcion: string;
  talle: string;
  color: string;
  unidades_vendidas: number;
  stock_actual: number;
  cobertura_dias: number;
  promedio_diario: number;
  alerta_stock: boolean;
}

export interface StockResponse {
  productos: ProductoStock[];
  abc_por_nombre: AbcNombre[];
  mas_vendidos: MasVendido[];
  bajo_stock: Array<Record<string, unknown>>;
  monto_total_stock: number;
  monto_total_stock_compra: number;
  rotacion_general: number;
  cobertura_general_dias: number;
  total_productos: number;
  total_skus: number;
  skus_sin_stock: number;
  skus_bajo_stock: number;
  substock_count: number;
  sobrestock_count: number;
  analisis_stock: Record<string, number>;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
}

// ── Query Param Builder ──────────────────────────────────────────────────────

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ── API Methods ──────────────────────────────────────────────────────────────

export const api = {
  auth: {
    me: () => request<UserProfile>('GET', '/api/v1/users/me'),
  },

  tenants: {
    me: () => request<TenantInfo>('GET', '/api/v1/tenants/me'),
  },

  analytics: {
    kpis: (tenantId: string) =>
      request<KpiSummary>('GET', `/api/v1/analytics/${tenantId}/kpis`),

    ventas: (tenantId: string, params?: { fecha_desde?: string; fecha_hasta?: string; local_id?: number }) =>
      request<VentasResponse>('GET', `/api/v1/analytics/${tenantId}/ventas${buildQuery(params ?? {})}`),

    gastos: (tenantId: string, params?: { fecha_desde?: string; fecha_hasta?: string; local_id?: number }) =>
      request<GastosResponse>('GET', `/api/v1/analytics/${tenantId}/gastos${buildQuery(params ?? {})}`),

    compras: (tenantId: string, params?: { fecha_desde?: string; fecha_hasta?: string; local_id?: number; proveedor_id?: number }) =>
      request<ComprasResponse>('GET', `/api/v1/analytics/${tenantId}/compras${buildQuery(params ?? {})}`),

    filtros: (tenantId: string) =>
      request<FiltrosDisponibles>('GET', `/api/v1/analytics/${tenantId}/filtros`),

    stock: (tenantId: string, params?: { fecha_desde?: string; fecha_hasta?: string; local_id?: number }) =>
      request<StockResponse>('GET', `/api/v1/analytics/${tenantId}/stock${buildQuery(params ?? {})}`),
  },
};
