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
  talle: string;
  color: string;
  unidades_vendidas: number;
  stock_actual: number;
  cobertura_dias: number;
  promedio_diario: number;
  alerta_stock: boolean;
}

export interface TalleColorVenta {
  talle: string;
  color: string;
  unidades: number;
}

export interface FamiliaRecompra {
  nombre: string;
  descripcion: string;
  stock_total: number;
  precio_costo: number;
  monto_stock: number;
  ventas_mensuales: Array<{ mes: string; unidades: number }>;
  talle_color_breakdown: TalleColorVenta[];
  proveedor_nombre: string | null;
  promedio_diario_anual: number;
  temporada_detectada: 'OI' | 'PV' | null;
  fase_temporada: 'pre_temporada' | 'activa' | 'bajando' | 'post_temporada' | null;
  clasificacion_abc: 'A' | 'B' | 'C';
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
  rotacion_mes_anualizada: number;
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
  dias_periodo: number;
  meses_con_datos: number;
  familias_recompra: FamiliaRecompra[];
}

export interface RecomendacionSku {
  descripcion: string | null;
  talle: string | null;
  color: string | null;
  stock: number;
  vendidas_30d: number;
  velocidad_diaria: number;
}

export interface RecomendacionItem {
  nombre: string;
  vendidas_30d: number;
  stock_actual: number;
  velocidad_diaria: number;
  cobertura_dias: number;
  estado: 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO';
  proveedor_nombre: string | null;
  sugerencia_compra: number;
  skus: RecomendacionSku[];
}

export interface RecomendacionSimpleResponse {
  items: RecomendacionItem[];
}

export interface RecomendacionAvanzadaSku {
  descripcion: string | null;
  talle: string | null;
  color: string | null;
  stock: number;
  vendidas_30d: number;
  velocidad_diaria: number;
}

export interface RecomendacionAvanzadaItem {
  nombre: string;
  producto_nombre_id: number;
  vendidas_30d: number;
  stock_actual: number;
  velocidad_diaria: number;
  cobertura_dias: number;
  estado: 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO';
  tipo: 'Basico' | 'Temporada' | 'Quiebre';
  lead_time_dias: number;
  stock_seguridad_dias: number;
  punto_reorden: number;
  tendencia: 'up' | 'down' | 'stable';
  costo_promedio: number;
  inversion_sugerida: number;
  sugerencia_compra: number;
  fecha_limite_compra: string | null;
  proveedor_nombre: string | null;
  proveedor_id: number | null;
  skus: RecomendacionAvanzadaSku[];
  proyeccion_stock: Array<{ dia: number; stock: number }>;
  // Temporada-specific
  temporada_mes_inicio: number | null;
  temporada_mes_fin: number | null;
  temporada_mes_liquidacion: number | null;
  temporada_cantidad_estimada: number | null;
  temporada_fase: 'fuera' | 'pre_temporada' | 'en_temporada' | 'liquidacion' | null;
  temporada_fecha_orden: string | null;
  temporada_ventas_anterior: number | null;
  temporada_alerta: string | null;
  ventas_mensuales: Array<{ mes: number; unidades: number }>;
}

export interface RecomendacionAvanzadaResponse {
  items: RecomendacionAvanzadaItem[];
  inversion_total_sugerida: number;
  productos_criticos: number;
  comprar_antes_7d: number;
  productos_exceso: number;
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

export interface VentaMensual {
  anio: number;
  mes: number;
  unidades: number;
  monto: number;
}

export interface FactorCalendario {
  mes: number;
  factor: number;
}

export interface EscenarioCompra {
  comprar: number;
  cobertura: number;
  inversion: number;
  pesoStock: number;
  recomendado?: boolean;
  warning?: string | null;
}

export interface RecomendacionCompra {
  unidades: number;
  inversion: number;
  coberturaDias: number;
  mensaje: string;
}

export interface StockDemandForecastResponse {
  productoNombreId: number;
  nombre: string;
  horizonte: number;
  ventasMensuales: VentaMensual[];
  stockActual: number;
  velocidadBase: number;
  factorTendencia: number;
  factoresCalendario: FactorCalendario[];
  demandaProyectada: number;
  coberturaSinComprar: number;
  costoPromedio: number;
  valorStockProducto: number;
  valorStockTotal: number;
  pesoEnStockTotal: number;
  escenarios: EscenarioCompra[];
  recomendacion: RecomendacionCompra;
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

export interface AiInsightAjuste {
  producto_key: string;   // "nombre::descripcion"
  factor: number;         // 1.0 = no change, 1.2 = +20%
  razon: string;
}

export interface AiAnalysisResponse {
  insights: string;
  ajustes: AiInsightAjuste[];
  advertencia: string | null;
}

// ── Stock Analysis (Motor de Inteligencia) ──────────────────────────────────

export interface StockAnalysisKpis {
  valor_stock: number;
  rotacion: number;
  calce: number;
  compras_periodo: number;
  clase_a: number;
  a_reponer: number;
  total_skus: number;
}

export interface TemporadaConfig {
  mes_inicio: number | null;
  mes_fin: number | null;
  mes_liquidacion: number | null;
  cantidad_estimada: number | null;
}

export interface StockAnalysisProducto {
  producto_nombre_id: number;
  nombre: string;
  tipo: 'Basico' | 'Temporada' | 'Quiebre';
  lead_time: number;
  seguridad: number;
  stock_total: number;
  velocidad_base: number;
  factor_tendencia: number;
  factor_calendario: number;
  demanda_proyectada_diaria: number;
  cobertura_dias: number;
  estado: 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO';
  sugerencia_compra: number;
  inversion_sugerida: number;
  fecha_orden: string | null;
  tendencia_interanual: number;
  estado_temporada: 'fuera' | 'pre_temporada' | 'en_temporada' | 'liquidacion' | null;
  temporada_config: TemporadaConfig | null;
  cantidad_modelos: number;
  modelos_criticos: number;
}

export interface StockAnalysisAlerta {
  tipo: string;
  producto: string;
  modelo: string | null;
  mensaje: string;
  accion: string;
  prioridad: number;
}

export interface StockAnalysisTransferencia {
  producto: string;
  modelo: string | null;
  local_origen: string;
  local_destino: string;
  cantidad: number;
  ahorro: number;
}

export interface StockAnalysisResponse {
  kpis: StockAnalysisKpis;
  productos: StockAnalysisProducto[];
  alertas: StockAnalysisAlerta[];
  transferencias: StockAnalysisTransferencia[];
}

// ── Product Models (Vista 2 lazy-loaded) ────────────────────────────────────

export interface ModeloStock {
  descripcion_id: number;
  descripcion: string;
  stock: number;
  vendidas_30d: number;
  velocidad_diaria: number;
  demanda_30d: number;
  cobertura_dias: number;
  estado: 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO';
  deficit: number;
  alerta_color: string | null;
}

export interface ProductModelsResponse {
  producto_nombre_id: number;
  nombre: string;
  tipo: 'Basico' | 'Temporada' | 'Quiebre';
  lead_time: number;
  seguridad: number;
  proveedor_id: number | null;
  stock_total: number;
  demanda_proyectada_diaria: number;
  cobertura_dias: number;
  estado: 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO';
  proyeccion_stock: Array<{ dia: number; stock: number }>;
  ventas_mensuales: Array<{ mes: number; unidades: number }>;
  modelos: ModeloStock[];
}

export interface TalleDistribucion {
  talle: string;
  stock: number;
  vendidas_30d: number;
  pct_demanda: number;
}

export interface ColorDistribucion {
  color: string;
  stock: number;
  vendidas_30d: number;
  pct_demanda: number;
}

export interface ModelCurveResponse {
  descripcion_id: number;
  descripcion: string;
  talles: TalleDistribucion[];
  colores: ColorDistribucion[];
}

// ── Stock Calendar — Purchase Planning ──────────────────────────────────────

export interface OrdenCalendario {
  id: number | null;
  producto_nombre_id: number;
  nombre: string;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  fecha_emision: string;      // ISO date "2025-06-27"
  fecha_llegada: string | null;
  cantidad: number;
  costo_unitario: number;
  inversion_estimada: number;
  estado: 'sugerida' | 'planificada' | 'confirmada' | 'ordenada' | 'recibida';
  origen: 'motor' | 'manual';
  tipo: 'Basico' | 'Temporada' | 'Quiebre';
  urgencia: 'CRITICO' | 'BAJO' | 'OK';
  notas: string | null;
}

export interface CalendarioMesKpi {
  mes: string;          // "2025-03"
  mes_label: string;    // "Mar 2025"
  inversion_planificada: number;
  inversion_sugerida: number;
  inversion_total: number;
  cantidad_ordenes: number;
}

export interface FlujoCajaEntry {
  periodo: string;
  periodo_label: string;
  cmv_proyectado: number;
  compras_planificadas: number;
  saldo_neto: number;
}

export interface StockCalendarResponse {
  ordenes: OrdenCalendario[];
  kpis_por_mes: CalendarioMesKpi[];
  flujo_caja: FlujoCajaEntry[];
  inversion_total: number;
  ordenes_urgentes: number;
}

export interface OrdenCompraPlanCreate {
  producto_nombre_id: number;
  fecha_emision: string;
  cantidad: number;
  costo_unitario?: number;
  estado?: string;
  notas?: string;
}

export interface OrdenCompraPlanUpdate {
  fecha_emision?: string;
  fecha_llegada?: string;
  cantidad?: number;
  costo_unitario?: number;
  estado?: string;
  notas?: string;
}

// ── Multilocal ─────────────────────────────────────────────────────────────────

export interface CeldaHeatmap {
  local_id: number;
  local_nombre: string;
  stock: number;
  velocidad_diaria: number;
  cobertura_dias: number;          // 999 = "∞" (no sales velocity)
  estado: 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO' | 'SIN_STOCK';
}

export interface MultilocalProducto {
  producto_nombre_id: number;
  nombre: string;
  locales: CeldaHeatmap[];
}

export interface TransferenciaMultilocal {
  producto_nombre_id: number;
  nombre: string;
  origen_local_id: number;
  origen_nombre: string;
  destino_local_id: number;
  destino_nombre: string;
  cantidad: number;
  cobertura_origen_antes: number;
  cobertura_origen_despues: number;
  cobertura_destino_antes: number;
  cobertura_destino_despues: number;
  ahorro_estimado: number;
  costo_unitario: number;
}

export interface CeldaHeatmapDetalle {
  local_id: number;
  local_nombre: string;
  stock: number;
  velocidad_diaria: number;
  cobertura_dias: number;
  estado: string;
}

export interface MultilocalColorDetalle {
  color_id: number;
  color: string;
  locales: CeldaHeatmapDetalle[];
}

export interface MultilocalDescripcionDetalle {
  descripcion_id: number;
  descripcion: string;
  colores: MultilocalColorDetalle[];
}

export interface TalleTransferencia {
  talle: string;
  cantidad: number;
}

export interface TransferenciaDetallada {
  descripcion_id: number;
  descripcion: string;
  color_id: number;
  color: string;
  origen_local_id: number;
  origen_nombre: string;
  destino_local_id: number;
  destino_nombre: string;
  cantidad: number;
  talles: TalleTransferencia[];
  cobertura_origen_antes: number;
  cobertura_origen_despues: number;
  cobertura_destino_antes: number;
  cobertura_destino_despues: number;
  ahorro_estimado: number;
  costo_unitario: number;
}

export interface DemandaLocal {
  local_id: number;
  local_nombre: string;
  demanda_diaria: number;
}

export interface MultilocalDetailResponse {
  producto_nombre_id: number;
  nombre: string;
  descripciones: MultilocalDescripcionDetalle[];
  transferencias: TransferenciaDetallada[];
  demanda_por_local: DemandaLocal[];
}

export interface StockMultilocalResponse {
  productos: MultilocalProducto[];
  locales: Array<{ local_id: number; nombre: string }>;
  transferencias: TransferenciaMultilocal[];
  total_ahorro_potencial: number;
}

export interface StockModeloDescripcion {
  descripcionId: number;
  descripcion: string;
  stockTotal: number;
  vendidasDesdeCompra: number;
  diasDesdeCompra: number;
  velocidadSalida: number;
  coberturaDias: number;
  costoPromedio: number;
  score: number;
  unidadesSugeridas: number;
  inversionSugerida: number;
  coberturaPostCompra: number;
  estado: string;
  alertaColor: string | null;
}

export interface StockModelsRankingResponse {
  productoNombreId: number;
  recomendacionTotal: number;
  modelos: StockModeloDescripcion[];
}

export interface TalleDetalle {
  talle: string;
  stock: number;
  pctDemanda: number;
  prioridad: boolean;
}

export interface DemandaLocal {
  local: string;
  pctDemanda: number;
  unidadesMes: number;
}

export interface ColorDetalle {
  colorId: number;
  color: string;
  stockTotal: number;
  vendidas90d: number;
  pctDemanda: number;
  estado: string;
  talles: TalleDetalle[];
  demandaPorLocal: DemandaLocal[];
}

export interface StockModelDetailResponse {
  descripcionId: number;
  descripcion: string;
  colores: ColorDetalle[];
}

export interface LiquidacionDetalle {
  color: string;
  talle: string;
  stock: number;
  diasEnStock: number;
  vendidas: number;
}

export interface LiquidacionModelo {
  descripcionId: number;
  descripcion: string;
  stockTotal: number;
  valorStock: number;
  edadPromDias: number;
  vendidas90d: number;
  descuentoSugerido: number;
  capitalRecuperable: number;
  detalle: LiquidacionDetalle[];
  tieneDemandaOtroLocal: boolean;
}

export interface StockLiquidationResponse {
  capitalInmovilizado: number;
  capitalRecuperable: number;
  modelos: LiquidacionModelo[];
}

export interface ProveedorProductoResponse {
  proveedorId: number | null;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  precioCompraPromedio: number;
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

    stockDemandForecast: (tenantId: string, productoNombreId: number, horizonteDias = 60, localId?: number) => {
      const qs = new URLSearchParams();
      qs.set('horizonte_dias', String(horizonteDias));
      if (localId != null) qs.set('local_id', String(localId));
      return request<StockDemandForecastResponse>('GET', `/api/v1/analytics/${tenantId}/stock/forecast/${productoNombreId}?${qs}`);
    },

    recomendacionSimple: (tenantId: string, localId?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      const q = qs.toString() ? `?${qs}` : '';
      return request<RecomendacionSimpleResponse>('GET', `/api/v1/analytics/${tenantId}/stock/recomendacion${q}`);
    },

    recomendacionAvanzada: (tenantId: string, localId?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      const q = qs.toString() ? `?${qs}` : '';
      return request<RecomendacionAvanzadaResponse>('GET', `/api/v1/analytics/${tenantId}/stock/recomendacion-avanzada${q}`);
    },

    updateClasificacion: (tenantId: string, body: {
      producto_nombre_id: number;
      tipo_recompra?: string;
      stock_seguridad_dias?: number;
      temporada_mes_inicio?: number;
      temporada_mes_fin?: number;
      temporada_mes_liquidacion?: number;
      temporada_cantidad_estimada?: number;
    }) =>
      request<{ ok: boolean }>('PUT', `/api/v1/analytics/${tenantId}/stock/clasificacion`, body),

    updateLeadTime: (tenantId: string, body: { proveedor_id: number; lead_time_dias: number }) =>
      request<{ ok: boolean }>('PUT', `/api/v1/analytics/${tenantId}/stock/proveedor-leadtime`, body),

    stockAnalysis: (tenantId: string, localId?: number, modo?: 'simple' | 'avanzado') => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      if (modo) qs.set('modo', modo);
      const q = qs.toString() ? `?${qs}` : '';
      return request<StockAnalysisResponse>('GET', `/api/v1/analytics/${tenantId}/stock/analysis${q}`);
    },

    productModels: (tenantId: string, productoNombreId: number, localId?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      const q = qs.toString() ? `?${qs}` : '';
      return request<ProductModelsResponse>('GET', `/api/v1/analytics/${tenantId}/stock/analysis/${productoNombreId}/models${q}`);
    },

    stockModelsRanking: (tenantId: string, productoNombreId: number, horizonteDias = 60, localId?: number) => {
      const qs = new URLSearchParams();
      qs.set('horizonte_dias', String(horizonteDias));
      if (localId != null) qs.set('local_id', String(localId));
      return request<StockModelsRankingResponse>('GET', `/api/v1/analytics/${tenantId}/stock/models/${productoNombreId}?${qs}`);
    },

    stockModelDetail: (tenantId: string, productoNombreId: number, descripcionId: number, localId?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      const q = qs.toString() ? `?${qs}` : '';
      return request<StockModelDetailResponse>('GET', `/api/v1/analytics/${tenantId}/stock/models/${productoNombreId}/detail/${descripcionId}${q}`);
    },

    proveedorProducto: (tenantId: string, productoNombreId: number, descripcionId: number) =>
      request<ProveedorProductoResponse>('GET', `/api/v1/analytics/${tenantId}/stock/proveedor/${productoNombreId}/${descripcionId}`),

    stockLiquidation: (tenantId: string, productoNombreId: number, localId?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      const q = qs.toString() ? `?${qs}` : '';
      return request<StockLiquidationResponse>('GET', `/api/v1/analytics/${tenantId}/stock/liquidation/${productoNombreId}${q}`);
    },

    modelCurve: (tenantId: string, productoNombreId: number, descripcionId: number, localId?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      const q = qs.toString() ? `?${qs}` : '';
      return request<ModelCurveResponse>('GET', `/api/v1/analytics/${tenantId}/stock/analysis/${productoNombreId}/models/${descripcionId}/curve${q}`);
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

    prediccionesAiContext: (
      tenantId: string,
      body: { grupos: Array<Record<string, unknown>>; periodo_dias: number; fecha_actual: string },
    ) =>
      request<AiAnalysisResponse>('POST', `/api/v1/analytics/${tenantId}/predicciones/ai-context`, body),

    filtros: (tenantId: string) =>
      request<FiltrosDisponibles>('GET', `/api/v1/analytics/${tenantId}/filtros`),

    stockCalendar: (tenantId: string, localId?: number, meses?: number) => {
      const qs = new URLSearchParams();
      if (localId != null) qs.set('local_id', String(localId));
      if (meses != null) qs.set('meses', String(meses));
      const q = qs.toString() ? `?${qs}` : '';
      return request<StockCalendarResponse>('GET', `/api/v1/analytics/${tenantId}/stock/calendar${q}`);
    },

    createCalendarOrder: (tenantId: string, body: OrdenCompraPlanCreate) =>
      request<{ id: number; ok: boolean }>('POST', `/api/v1/analytics/${tenantId}/stock/calendar`, body),

    updateCalendarOrder: (tenantId: string, orderId: number, body: OrdenCompraPlanUpdate) =>
      request<{ ok: boolean }>('PUT', `/api/v1/analytics/${tenantId}/stock/calendar/${orderId}`, body),

    stockMultilocal: (tenantId: string) =>
      request<StockMultilocalResponse>('GET', `/api/v1/analytics/${tenantId}/stock/multilocal`),

    stockMultilocalDetail: (tenantId: string, productoNombreId: number) =>
      request<MultilocalDetailResponse>('GET', `/api/v1/analytics/${tenantId}/stock/multilocal/detail/${productoNombreId}`),
  },
};
