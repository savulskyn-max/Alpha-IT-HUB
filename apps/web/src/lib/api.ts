/**
 * Typed API client for the Alpha IT Hub backend.
 * Automatically attaches the Supabase session token to all requests.
 */
import { createClient } from '@/lib/supabase/client';

const configuredBackendUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8000'
).replace(/\/$/, '');

// In browser, use same-origin paths and let Next.js rewrites proxy to backend.
const BACKEND_URL = typeof window === 'undefined' ? configuredBackendUrl : '';

async function getAuthToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
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
        const parsed = JSON.parse(raw) as { detail?: string; upstream_body?: string };
        if (parsed?.detail) {
          detail = parsed.detail;
        }
        if (parsed?.upstream_body) {
          detail = `${detail} | ${parsed.upstream_body}`;
        }
      } catch {
        detail = raw;
      }
    }

    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserResponse {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  tenant_id: string | null;
  created_at: string | null;
}

export interface UserCreate {
  email: string;
  full_name: string;
  role?: string;
  tenant_id?: string | null;
  phone?: string | null;
  password?: string | null;
}

export interface UserUpdate {
  full_name?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  tenant_id?: string | null;
}

export interface UserListResponse {
  items: UserResponse[];
  total: number;
}

export interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  plan_name: string | null;
  user_count: number;
  db_status: string | null;
  created_at: string | null;
}

export interface TenantCreate {
  name: string;
  slug: string;
  plan_id?: string | null;
  status?: string;
}

export interface TenantUpdate {
  name?: string | null;
  plan_id?: string | null;
  status?: string | null;
}

export interface TenantListResponse {
  items: TenantDetail[];
  total: number;
}

export interface AzureDbConfigResponse {
  id: string;
  tenant_id: string;
  host: string;
  database_name: string;
  db_username: string;
  status: string;
  last_tested_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AzureDbConfigCreate {
  host: string;
  database_name: string;
  db_username: string;
  password: string;
}

export interface AzureDbTestResult {
  success: boolean;
  latency_ms: number | null;
  error: string | null;
}

// ── Analytics Types ───────────────────────────────────────────────────────────

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
  top_productos: Array<{ nombre: string; talle?: string; color?: string; descripcion?: string; total: number; cantidad: number; pct: number }>;
  top_productos_por_nombre?: Array<{ nombre: string; total: number; cantidad: number; pct: number }>;
  top_productos_detalle?: Array<{ nombre: string; talle?: string; color?: string; descripcion?: string; total: number; cantidad: number; pct: number }>;
  participacion_producto_filtrado_pct?: number | null;
  total_periodo: number;
  cantidad_ventas: number;
  ticket_promedio: number;
  facturado_total?: number;
  costo_mercaderia_vendida?: number;
  comisiones_pago?: number;
  margen_bruto_post_comisiones?: number;
  vendido_a_cuenta?: number;
  cobrado_de_cuenta_corriente?: number;
}

export interface GastosResponse {
  serie_temporal: Array<{ fecha: string; total: number }>;
  por_categoria: Array<{ categoria: string; tipo: string; total: number; pct: number }>;
  por_tipo?: Array<{ tipo: string; total: number; pct: number }>;
  por_metodo_pago: Array<{ nombre: string; total: number; pct: number }>;
  detalle?: Array<{ fecha: string; categoria: string; tipo: string; metodo_pago: string; monto: number }>;
  total_periodo: number;
  ratio_ventas: number | null;
}

export interface ProductoStock {
  producto_id: number;
  nombre: string;
  descripcion?: string;
  talle: string | null;
  color: string | null;
  stock_actual: number;
  unidades_vendidas_periodo: number;
  rotacion: number;
  cobertura_dias: number;
  contribucion_pct: number;
  clasificacion_abc: 'A' | 'B' | 'C';
  estado_stock?: 'substock' | 'normal' | 'sobrestock';
  alerta_bajo_stock?: boolean;
}

export interface StockResponse {
  productos: ProductoStock[];
  bajo_stock: Array<Record<string, unknown>>;
  total_skus: number;
  skus_sin_stock: number;
  skus_bajo_stock: number;
  monto_total_stock_compra?: number;
  rotacion_general?: number;
  rotacion_promedio_mensual?: number;
  rotacion_mensual?: Array<{ mes: string; rotacion: number; cmv: number; stock_promedio: number }>;
  calce_financiero_dias?: number | null;
  compras_total_periodo?: number;
  cobertura_general_dias?: number;
  tasa_crecimiento_ventas?: number;
  analisis_stock?: { substock?: number; normal?: number; sobrestock?: number };
  abc_por_nombre?: Array<Record<string, unknown>>;
  abc_por_descripcion?: Array<Record<string, unknown>>;
  mas_vendidos_por_nombre?: Array<Record<string, unknown>>;
  mas_vendidos_por_descripcion?: Array<Record<string, unknown>>;
  total_productos?: number;
}

export interface ComprasResponse {
  serie_temporal: Array<{ fecha: string; total: number; cantidad: number }>;
  top_productos: Array<{ nombre: string; talle: string; color: string; total: number; cantidad: number }>;
  top_proveedores?: Array<{ proveedor: string; total: number; ordenes: number; pct: number }>;
  analisis?: Record<string, number>;
  ordenes?: Array<{
    compra_id: number;
    fecha: string;
    proveedor: string;
    total: number;
    items: Array<{ nombre: string; descripcion?: string; talle?: string; color?: string; cantidad: number; costo_unitario: number; subtotal: number }>;
  }>;
  total_periodo: number;
  cantidad_ordenes: number;
  promedio_por_orden: number;
}

export interface PrediccionProducto {
  producto_id: number;
  nombre: string;
  descripcion?: string;
  talle?: string;
  color?: string;
  stock_actual: number;
  promedio_diario: number;
  prediccion_30_dias: number;
  recomendacion_stock_30_dias: number;
  modelo: 'basico' | 'temporada' | 'quiebre';
  sobre_stock_pct: number;
}

export interface PrediccionesResponse {
  periodo_dias: number;
  modelo: 'basico' | 'temporada' | 'quiebre';
  sobre_stock_pct: number;
  productos: PrediccionProducto[];
}

export interface FiltrosDisponibles {
  locales: Array<{ id: number; nombre: string }>;
  metodos_pago: Array<{ id: number; nombre: string }>;
  tipos_venta: string[];
  talles: Array<{ id: number; nombre: string }>;
  colores: Array<{ id: number; nombre: string }>;
  tipos_gasto: Array<{ id: number; nombre: string }>;
  categorias_gasto: Array<{ id: number; nombre: string }>;
}

export interface AnalyticsFilters {
  fecha_desde?: string;
  fecha_hasta?: string;
  local_id?: number;
  metodo_pago_id?: number;
  tipo_venta?: string;
  producto_nombre?: string;
  talle_id?: number;
  color_id?: number;
  tipo_id?: number;
  categoria_id?: number;
}

// ── API methods ───────────────────────────────────────────────────────────────

export const api = {
  users: {
    list: (params?: { tenant_id?: string; role?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.tenant_id) qs.set('tenant_id', params.tenant_id);
      if (params?.role) qs.set('role', params.role);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      const query = qs.toString() ? `?${qs}` : '';
      return request<UserListResponse>('GET', `/api/v1/users${query}`);
    },
    getMe: () => request<UserResponse>('GET', '/api/v1/users/me'),
    updateMe: (data: UserUpdate) => request<UserResponse>('PUT', '/api/v1/users/me', data),
    get: (id: string) => request<UserResponse>('GET', `/api/v1/users/${id}`),
    create: (data: UserCreate) => request<UserResponse>('POST', '/api/v1/users', data),
    update: (id: string, data: UserUpdate) =>
      request<UserResponse>('PUT', `/api/v1/users/${id}`, data),
    delete: (id: string) => request<void>('DELETE', `/api/v1/users/${id}`),
  },

  tenants: {
    list: (params?: { limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      const query = qs.toString() ? `?${qs}` : '';
      return request<TenantListResponse>('GET', `/api/v1/tenants${query}`);
    },
    getMe: () => request<TenantDetail>('GET', '/api/v1/tenants/me'),
    get: (id: string) => request<TenantDetail>('GET', `/api/v1/tenants/${id}`),
    create: (data: TenantCreate) => request<TenantDetail>('POST', '/api/v1/tenants', data),
    update: (id: string, data: TenantUpdate) =>
      request<TenantDetail>('PUT', `/api/v1/tenants/${id}`, data),
    delete: (id: string) => request<void>('DELETE', `/api/v1/tenants/${id}`),
  },

  azureDb: {
    get: (tenantId: string) =>
      request<AzureDbConfigResponse>('GET', `/api/v1/azure-db/${tenantId}`),
    save: (tenantId: string, data: AzureDbConfigCreate) =>
      request<AzureDbConfigResponse>('POST', `/api/v1/azure-db/${tenantId}`, data),
    test: (tenantId: string) =>
      request<AzureDbTestResult>('POST', `/api/v1/azure-db/${tenantId}/test`),
    delete: (tenantId: string) => request<void>('DELETE', `/api/v1/azure-db/${tenantId}`),
  },

  analytics: {
    kpis: (tenantId: string) =>
      request<KpiSummary>('GET', `/api/v1/analytics/${tenantId}/kpis`),

    ventas: (tenantId: string, filters?: AnalyticsFilters) => {
      const qs = new URLSearchParams();
      if (filters?.fecha_desde) qs.set('fecha_desde', filters.fecha_desde);
      if (filters?.fecha_hasta) qs.set('fecha_hasta', filters.fecha_hasta);
      if (filters?.local_id != null) qs.set('local_id', String(filters.local_id));
      if (filters?.metodo_pago_id != null) qs.set('metodo_pago_id', String(filters.metodo_pago_id));
      if (filters?.tipo_venta) qs.set('tipo_venta', filters.tipo_venta);
      if (filters?.producto_nombre) qs.set('producto_nombre', filters.producto_nombre);
      if (filters?.talle_id != null) qs.set('talle_id', String(filters.talle_id));
      if (filters?.color_id != null) qs.set('color_id', String(filters.color_id));
      const q = qs.toString() ? `?${qs}` : '';
      return request<VentasResponse>('GET', `/api/v1/analytics/${tenantId}/ventas${q}`);
    },

    gastos: (tenantId: string, filters?: AnalyticsFilters) => {
      const qs = new URLSearchParams();
      if (filters?.fecha_desde) qs.set('fecha_desde', filters.fecha_desde);
      if (filters?.fecha_hasta) qs.set('fecha_hasta', filters.fecha_hasta);
      if (filters?.local_id != null) qs.set('local_id', String(filters.local_id));
      if (filters?.metodo_pago_id != null) qs.set('metodo_pago_id', String(filters.metodo_pago_id));
      if (filters?.tipo_id != null) qs.set('tipo_id', String(filters.tipo_id));
      if (filters?.categoria_id != null) qs.set('categoria_id', String(filters.categoria_id));
      const q = qs.toString() ? `?${qs}` : '';
      return request<GastosResponse>('GET', `/api/v1/analytics/${tenantId}/gastos${q}`);
    },

    stock: (tenantId: string, filters?: Pick<AnalyticsFilters, 'fecha_desde' | 'fecha_hasta' | 'local_id'>) => {
      const qs = new URLSearchParams();
      if (filters?.fecha_desde) qs.set('fecha_desde', filters.fecha_desde);
      if (filters?.fecha_hasta) qs.set('fecha_hasta', filters.fecha_hasta);
      if (filters?.local_id != null) qs.set('local_id', String(filters.local_id));
      const q = qs.toString() ? `?${qs}` : '';
      return request<StockResponse>('GET', `/api/v1/analytics/${tenantId}/stock${q}`);
    },

    compras: (tenantId: string, filters?: Pick<AnalyticsFilters, 'fecha_desde' | 'fecha_hasta' | 'local_id'>) => {
      const qs = new URLSearchParams();
      if (filters?.fecha_desde) qs.set('fecha_desde', filters.fecha_desde);
      if (filters?.fecha_hasta) qs.set('fecha_hasta', filters.fecha_hasta);
      if (filters?.local_id != null) qs.set('local_id', String(filters.local_id));
      const q = qs.toString() ? `?${qs}` : '';
      return request<ComprasResponse>('GET', `/api/v1/analytics/${tenantId}/compras${q}`);
    },

    predicciones: (
      tenantId: string,
      filters?: Pick<AnalyticsFilters, 'fecha_desde' | 'fecha_hasta' | 'local_id'>,
      options?: { modelo?: 'basico' | 'temporada' | 'quiebre'; periodo_dias?: number; sobre_stock_pct?: number },
    ) => {
      const qs = new URLSearchParams();
      if (filters?.fecha_desde) qs.set('fecha_desde', filters.fecha_desde);
      if (filters?.fecha_hasta) qs.set('fecha_hasta', filters.fecha_hasta);
      if (filters?.local_id != null) qs.set('local_id', String(filters.local_id));
      if (options?.modelo) qs.set('modelo', options.modelo);
      if (options?.periodo_dias != null) qs.set('periodo_dias', String(options.periodo_dias));
      if (options?.sobre_stock_pct != null) qs.set('sobre_stock_pct', String(options.sobre_stock_pct));
      const q = qs.toString() ? `?${qs}` : '';
      return request<PrediccionesResponse>('GET', `/api/v1/analytics/${tenantId}/predicciones${q}`);
    },

    filtros: (tenantId: string) =>
      request<FiltrosDisponibles>('GET', `/api/v1/analytics/${tenantId}/filtros`),
  },
};
