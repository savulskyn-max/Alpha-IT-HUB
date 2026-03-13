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
  top_productos: Array<{ nombre: string; talle: string; color: string; total: number; cantidad: number; pct: number }>;
  top_por_nombre: Array<{ nombre: string; total: number; cantidad: number; pct: number }>;
  total_periodo: number;
  facturado_bruto: number;
  cantidad_ventas: number;
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

export interface ProductoStock {
  producto_id: number;
  nombre: string;
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
  clasificacion_abc: 'A' | 'B' | 'C';
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
  clasificacion_abc: 'A' | 'B' | 'C';
}

export interface MasVendido {
  nombre: string;
  descripcion: string;
  unidades_vendidas: number;
  stock_actual: number;
  cobertura_dias: number;
  alerta_stock: boolean;
}

export interface StockResponse {
  productos: ProductoStock[];
  abc_por_nombre: AbcNombre[];
  mas_vendidos: MasVendido[];
  bajo_stock: Array<Record<string, unknown>>;
  monto_total_stock: number;
  rotacion_general: number;
  cobertura_general: number;
  skus_sin_stock: number;
  skus_bajo_stock: number;
  substock_count: number;
  sobrestock_count: number;
  monto_total_stock_compra: number;
  rotacion_promedio_mensual: number;
  rotacion_mensual: Array<{ mes: string; rotacion: number; cmv: number; stock_promedio: number }>;
  cobertura_general_dias: number;
  calce_financiero_dias: number | null;
  compras_total_periodo: number;
  tasa_crecimiento_ventas: number;
  analisis_stock: { substock: number; normal: number; sobrestock: number };
  abc_por_descripcion: Array<Record<string, unknown>>;
  mas_vendidos_por_nombre: Array<Record<string, unknown>>;
  mas_vendidos_por_descripcion: Array<Record<string, unknown>>;
  total_productos: number;
  total_skus: number;
}

export interface ComprasResponse {
  serie_temporal: Array<{ fecha: string; total: number; cantidad: number }>;
  top_productos: Array<{ nombre: string; talle: string; color: string; total: number; cantidad: number }>;
  por_proveedor: Array<{ nombre: string; total: number; cantidad_ordenes: number; pct: number }>;
  ultimas_compras: Array<{
    id: number; fecha: string; proveedor: string; local_nombre: string;
    metodo_pago: string; items_distintos: number; unidades: number; total: number;
  }>;
  top_proveedores: Array<{ proveedor: string; total: number; ordenes: number; pct: number }>;
  analisis: Record<string, number>;
  ordenes: Array<{
    compra_id: number;
    fecha: string;
    proveedor: string;
    total: number;
    items: Array<{ nombre: string; descripcion?: string; talle?: string; color?: string; cantidad: number; costo_unitario: number; subtotal: number }>;
  }>;
  total_periodo: number;
  cantidad_ordenes: number;
  promedio_por_orden: number;
  unidades_totales: number;
}

export interface ProductForecast {
  nombre: string;
  stock_actual: number;
  historico: number[];
  prediccion_semanas: number[];
  prediccion_30d: number;
  prediccion_60d: number;
  prediccion_90d: number;
  tendencia: 'creciente' | 'estable' | 'decreciente';
  confianza: 'alta' | 'media' | 'baja';
  semanas_datos: number;
}

export interface ForecastResponse {
  productos: ProductForecast[];
  semanas_analizadas: number;
  advertencia: string | null;
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
  proveedores: Array<{ id: number; nombre: string }>;
  nombres_producto: string[];
}

export interface AnalyticsFilters {
  fecha_desde?: string;
  fecha_hasta?: string;
  local_id?: number;
  metodo_pago_ids?: string;   // comma-separated IDs, e.g. "1,3,5"
  tipo_venta?: string;
  producto_nombre?: string;
  talle_id?: number;
  color_id?: number;
  tipo_id?: number;
  categoria_id?: number;
  proveedor_id?: number;
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
      if (filters?.metodo_pago_ids) qs.set('metodo_pago_ids', filters.metodo_pago_ids);
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
      if (filters?.metodo_pago_ids) qs.set('metodo_pago_ids', filters.metodo_pago_ids);
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

    stockForecast: (tenantId: string, localId?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      const q = qs.toString() ? `?${qs}` : '';
      return request<ForecastResponse>('GET', `/api/v1/analytics/${tenantId}/stock/forecast${q}`);
    },

    compras: (tenantId: string, filters?: AnalyticsFilters) => {
      const qs = new URLSearchParams();
      if (filters?.fecha_desde) qs.set('fecha_desde', filters.fecha_desde);
      if (filters?.fecha_hasta) qs.set('fecha_hasta', filters.fecha_hasta);
      if (filters?.local_id != null) qs.set('local_id', String(filters.local_id));
      if (filters?.proveedor_id != null) qs.set('proveedor_id', String(filters.proveedor_id));
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
