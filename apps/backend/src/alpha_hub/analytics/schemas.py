"""
Analytics schemas: response models for tenant business analytics.
All data is sourced from the tenant's Azure SQL database (db_keloke_v2 schema).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


# ── KPIs ──────────────────────────────────────────────────────────────────────

class KpiSummary(BaseModel):
    ventas_hoy: float
    ventas_mes: float
    gastos_mes: float
    margen_mes: float
    cantidad_ventas_mes: int
    ticket_promedio: float


# ── Ventas ────────────────────────────────────────────────────────────────────

class VentasPorFecha(BaseModel):
    fecha: str
    total: float
    cantidad: int


class VentasResponse(BaseModel):
    serie_temporal: list[VentasPorFecha]
    por_local: list[dict[str, Any]]
    por_metodo_pago: list[dict[str, Any]]
    por_tipo_venta: list[dict[str, Any]]
    top_productos: list[dict[str, Any]]       # nombre+talle+color detail
    top_por_nombre: list[dict[str, Any]]      # aggregated by nombre
    total_periodo: float                      # cobrado (DineroDisponible)
    facturado_bruto: float                    # precio lista antes de descuento (best-effort)
    cantidad_ventas: int
    cantidad_unidades_vendidas: int = 0       # sum of units sold (≠ number of orders)
    ticket_promedio: float
    cmv: float
    comisiones: float
    vendido_cuenta: float                     # total de ventas a crédito (monto facturado)
    cantidad_cuenta: int
    cobros_cuenta: float                      # pagos recibidos sobre CtaCte
    pct_del_total: float | None


# ── Gastos ────────────────────────────────────────────────────────────────────

class GastosResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]
    por_tipo: list[dict[str, Any]]
    por_categoria: list[dict[str, Any]]
    por_metodo_pago: list[dict[str, Any]]
    detalle_gastos: list[dict[str, Any]]      # individual records with fecha + descripcion
    total_periodo: float
    ratio_ventas: float | None


# ── Stock ─────────────────────────────────────────────────────────────────────

class ProductoStock(BaseModel):
    producto_id: int
    nombre: str
    descripcion: str | None = None
    talle: str | None
    color: str | None
    stock_actual: int
    precio_costo: float
    monto_stock: float
    unidades_vendidas_periodo: int
    rotacion: float
    rotacion_anualizada: float
    cobertura_dias: float
    cobertura_ajustada: float
    contribucion_pct: float
    clasificacion_abc: str
    es_substock: bool
    es_sobrestock: bool


class AbcNombre(BaseModel):
    nombre: str
    stock_total: int
    monto_stock: float
    unidades_vendidas: int
    revenue: float
    rotacion: float
    cobertura_dias: float
    contribucion_pct: float
    clasificacion_abc: str


class MasVendido(BaseModel):
    nombre: str
    descripcion: str
    talle: str = ""
    color: str = ""
    unidades_vendidas: int
    stock_actual: int
    cobertura_dias: float
    promedio_diario: float = 0.0
    alerta_stock: bool


class TalleColorVenta(BaseModel):
    talle: str
    color: str
    unidades: int


class FamiliaRecompra(BaseModel):
    nombre: str
    descripcion: str
    stock_total: int
    precio_costo: float
    monto_stock: float
    ventas_mensuales: list[dict[str, Any]]    # [{"mes": "2024-01", "unidades": 45}, ...]
    talle_color_breakdown: list[TalleColorVenta]
    proveedor_nombre: str | None
    promedio_diario_anual: float              # based on last 12 months
    temporada_detectada: str | None           # 'OI' | 'PV' | None (Básico)
    fase_temporada: str | None                # 'pre_temporada' | 'activa' | 'bajando' | 'post_temporada'
    clasificacion_abc: str


class StockResponse(BaseModel):
    productos: list[ProductoStock]
    abc_por_nombre: list[AbcNombre]
    mas_vendidos: list[MasVendido]
    bajo_stock: list[dict[str, Any]]
    monto_total_stock: float
    monto_total_stock_compra: float
    rotacion_general: float
    rotacion_promedio_mensual: float
    rotacion_mes_anualizada: float = 0.0
    rotacion_mensual: list[dict[str, Any]]
    cobertura_general: float
    cobertura_general_dias: float
    calce_financiero_dias: float | None
    compras_total_periodo: float
    tasa_crecimiento_ventas: float
    analisis_stock: dict[str, int]
    abc_por_descripcion: list[dict[str, Any]]
    mas_vendidos_por_nombre: list[dict[str, Any]]
    mas_vendidos_por_descripcion: list[dict[str, Any]]
    total_productos: int
    total_skus: int
    skus_sin_stock: int
    skus_bajo_stock: int
    substock_count: int
    sobrestock_count: int
    dias_periodo: int = 30
    # New fields for the advanced recompras system
    meses_con_datos: int = 0
    familias_recompra: list[FamiliaRecompra] = []


# ── Recomendación Simple ──────────────────────────────────────────────────────

class RecomendacionSku(BaseModel):
    descripcion: str | None
    talle: str | None
    color: str | None
    stock: int
    vendidas_30d: int
    velocidad_diaria: float


class RecomendacionItem(BaseModel):
    nombre: str
    vendidas_30d: int
    stock_actual: int
    velocidad_diaria: float
    cobertura_dias: float
    estado: str                        # 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO'
    proveedor_nombre: str | None
    sugerencia_compra: int
    skus: list[RecomendacionSku] = []


class RecomendacionSimpleResponse(BaseModel):
    items: list[RecomendacionItem]


# ── Recomendación Avanzada ────────────────────────────────────────────────────

class RecomendacionAvanzadaSku(BaseModel):
    descripcion: str | None
    talle: str | None
    color: str | None
    stock: int
    vendidas_30d: int
    velocidad_diaria: float


class RecomendacionAvanzadaItem(BaseModel):
    nombre: str
    producto_nombre_id: int
    vendidas_30d: int
    stock_actual: int
    velocidad_diaria: float                  # 90d-based velocity
    cobertura_dias: float
    estado: str                              # 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO'
    tipo: str                                # 'Basico' | 'Temporada' | 'Quiebre'
    lead_time_dias: int
    stock_seguridad_dias: int
    punto_reorden: int                       # lead_time + stock_seguridad (days)
    tendencia: str                           # 'up' | 'down' | 'stable'
    costo_promedio: float
    inversion_sugerida: float                # sugerencia_compra × costo_promedio
    sugerencia_compra: int
    fecha_limite_compra: str | None          # ISO date or None
    proveedor_nombre: str | None
    proveedor_id: int | None
    skus: list[RecomendacionAvanzadaSku] = []
    # For the projection chart (Básico/Quiebre)
    proyeccion_stock: list[dict[str, Any]] = []  # [{dia: 0, stock: 250}, ...]
    # Temporada-specific fields
    temporada_mes_inicio: int | None = None      # 1-12
    temporada_mes_fin: int | None = None         # 1-12
    temporada_mes_liquidacion: int | None = None # 1-12
    temporada_cantidad_estimada: int | None = None
    temporada_fase: str | None = None            # 'fuera' | 'pre_temporada' | 'en_temporada' | 'liquidacion'
    temporada_fecha_orden: str | None = None     # ISO date of next order emission
    temporada_ventas_anterior: int | None = None # total sold in same season last year
    temporada_alerta: str | None = None          # alert message for En temporada
    ventas_mensuales: list[dict[str, Any]] = []  # [{mes: 1, unidades: 42}, ...] for timeline chart


class RecomendacionAvanzadaResponse(BaseModel):
    items: list[RecomendacionAvanzadaItem]
    # Summary cards
    inversion_total_sugerida: float
    productos_criticos: int
    comprar_antes_7d: int
    productos_exceso: int


class ClasificacionUpdate(BaseModel):
    producto_nombre_id: int
    tipo_recompra: str | None = None         # 'Basico' | 'Temporada' | 'Quiebre'
    stock_seguridad_dias: int | None = None
    temporada_mes_inicio: int | None = None      # 1-12
    temporada_mes_fin: int | None = None         # 1-12
    temporada_mes_liquidacion: int | None = None # 1-12
    temporada_cantidad_estimada: int | None = None


class LeadTimeUpdate(BaseModel):
    proveedor_id: int
    lead_time_dias: int


# ── Forecast ──────────────────────────────────────────────────────────────────

class ProductForecast(BaseModel):
    nombre: str
    stock_actual: int                         # current stock aggregated by nombre
    historico: list[float]                    # last 26 weeks of actual sales
    prediccion_semanas: list[float]           # next 13 weeks forecast
    prediccion_30d: float
    prediccion_60d: float
    prediccion_90d: float
    tendencia: str                            # 'creciente' | 'estable' | 'decreciente'
    confianza: str                            # 'alta' | 'media' | 'baja'
    semanas_datos: int


class ForecastResponse(BaseModel):
    productos: list[ProductForecast]
    semanas_analizadas: int
    advertencia: str | None                   # shown when data is insufficient


# ── Stock Demand Forecast (per-product with horizon) ─────────────────────────

class VentaMensual(BaseModel):
    anio: int
    mes: int
    unidades: int
    monto: float


class FactorCalendario(BaseModel):
    mes: int
    factor: float


class EscenarioCompra(BaseModel):
    comprar: int
    cobertura: float                          # days of coverage
    inversion: float
    pesoStock: float                          # % of total stock value
    recomendado: bool = False
    warning: str | None = None


class RecomendacionCompra(BaseModel):
    unidades: int
    inversion: float
    coberturaDias: float
    mensaje: str


class StockDemandForecastResponse(BaseModel):
    productoNombreId: int
    nombre: str
    horizonte: int
    ventasMensuales: list[VentaMensual]
    stockActual: int
    velocidadBase: float
    factorTendencia: float
    factoresCalendario: list[FactorCalendario]
    demandaProyectada: float
    coberturaSinComprar: float
    costoPromedio: float
    valorStockProducto: float
    valorStockTotal: float
    pesoEnStockTotal: float
    escenarios: list[EscenarioCompra]
    recomendacion: RecomendacionCompra


# ── Compras ───────────────────────────────────────────────────────────────────

class CompraItem(BaseModel):
    compra_id: int
    nombre: str
    descripcion: str | None = None
    talle: str | None = None
    color: str | None = None
    cantidad: int
    costo_unitario: float
    subtotal: float


class CompraOrden(BaseModel):
    compra_id: int
    fecha: str
    proveedor: str
    total: float
    items: list[CompraItem] = []


class ComprasResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]
    top_productos: list[dict[str, Any]]
    por_proveedor: list[dict[str, Any]]
    ultimas_compras: list[dict[str, Any]]     # individual orders with summary
    top_proveedores: list[dict[str, Any]] = []
    analisis: dict[str, Any] = {}
    ordenes: list[CompraOrden] = []
    total_periodo: float
    cantidad_ordenes: int
    promedio_por_orden: float
    unidades_totales: int


class PrediccionProducto(BaseModel):
    producto_id: int
    nombre: str
    descripcion: str | None = None
    talle: str | None = None
    color: str | None = None
    stock_actual: int
    promedio_diario: float
    prediccion_30_dias: float
    recomendacion_stock_30_dias: float
    modelo: Literal['basico', 'temporada', 'quiebre']
    sobre_stock_pct: float


class PrediccionesResponse(BaseModel):
    periodo_dias: int
    modelo: Literal['basico', 'temporada', 'quiebre']
    sobre_stock_pct: float
    productos: list[PrediccionProducto]


class AiInsightAjuste(BaseModel):
    producto_key: str             # "nombre::descripcion"
    factor: float                 # 1.0 = no change, 1.2 = +20%, 0.8 = -20%
    razon: str


class AiAnalysisResponse(BaseModel):
    insights: str
    ajustes: list[AiInsightAjuste]
    advertencia: str | None = None


class FiltrosDisponibles(BaseModel):
    locales: list[dict[str, Any]]
    metodos_pago: list[dict[str, Any]]
    tipos_venta: list[str]
    talles: list[dict[str, Any]]
    colores: list[dict[str, Any]]
    tipos_gasto: list[dict[str, Any]]
    categorias_gasto: list[dict[str, Any]]
    proveedores: list[dict[str, Any]]         # [{id, nombre}] for compras filter
    nombres_producto: list[str]               # top product names for autocomplete


# ── Stock Analysis (Motor de Inteligencia) ─────────────────────────────────────

class StockAnalysisKpis(BaseModel):
    valor_stock: float                        # SUM(PrecioCompra × Stock)
    rotacion: float                           # monthly rotation ratio
    calce: float                              # financial matching days
    compras_periodo: float                    # purchases last 30d
    clase_a: int                              # count of names representing 80% revenue
    a_reponer: int                            # count of names needing reorder
    total_skus: int                           # total SKU count


class TemporadaConfigSchema(BaseModel):
    mes_inicio: int | None = None
    mes_fin: int | None = None
    mes_liquidacion: int | None = None
    cantidad_estimada: int | None = None


class StockAnalysisProducto(BaseModel):
    producto_nombre_id: int
    nombre: str
    tipo: str                                 # 'Basico' | 'Temporada' | 'Quiebre'
    lead_time: int
    seguridad: int
    stock_total: int
    velocidad_base: float                     # avg daily sales last 90d
    factor_tendencia: float                   # short-term trend (30d vs 30-60d)
    factor_calendario: float                  # seasonal factor (same period last year)
    demanda_proyectada_diaria: float          # velocidadBase × factorTendencia × factorCalendario
    cobertura_dias: float                     # stock / demandaProyectadaDiaria
    estado: str                               # 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO'
    sugerencia_compra: int
    inversion_sugerida: float                 # sugerencia × costo_promedio
    fecha_orden: str | None                   # ISO date or None
    tendencia_interanual: float               # % YoY change
    # Temporada-specific
    estado_temporada: str | None = None       # 'fuera' | 'pre_temporada' | 'en_temporada' | 'liquidacion'
    temporada_config: TemporadaConfigSchema | None = None
    # Lazy model counts (detail loaded separately)
    cantidad_modelos: int = 0
    modelos_criticos: int = 0                 # SKUs with stock = 0


class StockAnalysisAlerta(BaseModel):
    tipo: str                                 # 'critico' | 'temporada' | 'exceso' | 'bajo' | 'liquidacion'
    producto: str
    modelo: str | None = None
    mensaje: str
    accion: str
    prioridad: int                            # 1 = highest


class StockAnalysisTransferencia(BaseModel):
    producto: str
    modelo: str | None = None
    local_origen: str
    local_destino: str
    cantidad: int
    ahorro: float                             # estimated cost savings


class StockAnalysisResponse(BaseModel):
    kpis: StockAnalysisKpis
    productos: list[StockAnalysisProducto]
    alertas: list[StockAnalysisAlerta]
    transferencias: list[StockAnalysisTransferencia]


# ── Stock Analysis — Product Models Detail (lazy-loaded) ─────────────────────

class ModeloStock(BaseModel):
    descripcion_id: int
    descripcion: str
    stock: int
    vendidas_30d: int
    velocidad_diaria: float
    demanda_30d: float                        # projected 30d demand
    cobertura_dias: float
    estado: str                               # 'CRITICO' | 'BAJO' | 'OK' | 'EXCESO'
    deficit: int                              # max(0, demanda_30d - stock)


class ProductModelsResponse(BaseModel):
    producto_nombre_id: int
    nombre: str
    tipo: str
    lead_time: int
    seguridad: int
    proveedor_id: int | None                  # for lead-time updates
    stock_total: int
    demanda_proyectada_diaria: float
    cobertura_dias: float
    estado: str
    proyeccion_stock: list[dict[str, Any]]    # [{dia, stock}] for projection chart
    ventas_mensuales: list[dict[str, Any]]    # [{mes, unidades}] for temporada timeline
    modelos: list[ModeloStock]


class TalleDistribucion(BaseModel):
    talle: str
    stock: int
    vendidas_30d: int
    pct_demanda: float                        # % of total demand for this model


class ColorDistribucion(BaseModel):
    color: str
    stock: int
    vendidas_30d: int
    pct_demanda: float


class ModelCurveResponse(BaseModel):
    descripcion_id: int
    descripcion: str
    talles: list[TalleDistribucion]
    colores: list[ColorDistribucion]


# ── Stock Calendar — Purchase Planning ────────────────────────────────────────

class OrdenCalendario(BaseModel):
    id: int | None                       # None = motor-suggested (not yet saved)
    producto_nombre_id: int
    nombre: str
    proveedor_id: int | None
    proveedor_nombre: str | None
    fecha_emision: date
    fecha_llegada: date | None
    cantidad: int
    costo_unitario: float
    inversion_estimada: float
    estado: str                          # 'sugerida'|'planificada'|'confirmada'|'ordenada'
    origen: str                          # 'motor' | 'manual'
    tipo: str                            # 'Basico'|'Temporada'|'Quiebre'
    urgencia: str                        # 'CRITICO'|'BAJO'|'OK'
    notas: str | None


class CalendarioMesKpi(BaseModel):
    mes: str                             # "2025-03"
    mes_label: str                       # "Mar 2025"
    inversion_planificada: float         # user-created orders
    inversion_sugerida: float            # motor orders not yet confirmed
    inversion_total: float
    cantidad_ordenes: int


class FlujoCajaEntry(BaseModel):
    periodo: str                         # "2025-03"
    periodo_label: str                   # "Mar 2025"
    cmv_proyectado: float                # based on previous year's CMV
    compras_planificadas: float
    saldo_neto: float                    # cmv - compras


class StockCalendarResponse(BaseModel):
    ordenes: list[OrdenCalendario]
    kpis_por_mes: list[CalendarioMesKpi]
    flujo_caja: list[FlujoCajaEntry]
    inversion_total: float
    ordenes_urgentes: int                # ordenes with urgencia==CRITICO


class OrdenCompraPlanCreate(BaseModel):
    producto_nombre_id: int
    fecha_emision: date
    cantidad: int
    costo_unitario: float | None = None
    estado: str = "planificada"
    notas: str | None = None


class OrdenCompraPlanUpdate(BaseModel):
    fecha_emision: date | None = None
    fecha_llegada: date | None = None
    cantidad: int | None = None
    costo_unitario: float | None = None
    estado: str | None = None
    notas: str | None = None


# ── Multilocal ────────────────────────────────────────────────────────────────

class CeldaHeatmap(BaseModel):
    local_id: int
    local_nombre: str
    stock: int
    velocidad_diaria: float              # units/day (90d window)
    cobertura_dias: float                # stock / velocidad (Inf when vel==0)
    estado: str                          # 'CRITICO'|'BAJO'|'OK'|'EXCESO'


class MultilocalProducto(BaseModel):
    producto_nombre_id: int
    nombre: str
    locales: list[CeldaHeatmap]          # one entry per local that has stock data


class TransferenciaMultilocal(BaseModel):
    producto_nombre_id: int
    nombre: str
    origen_local_id: int
    origen_nombre: str
    destino_local_id: int
    destino_nombre: str
    cantidad: int
    cobertura_origen_antes: float
    cobertura_origen_despues: float
    cobertura_destino_antes: float
    cobertura_destino_despues: float
    ahorro_estimado: float               # ~15% of transfer_qty * unit_cost vs re-buying
    costo_unitario: float


class StockMultilocalResponse(BaseModel):
    productos: list[MultilocalProducto]
    locales: list[dict]                  # [{local_id, nombre}] — column headers
    transferencias: list[TransferenciaMultilocal]
    total_ahorro_potencial: float


# ── Multilocal Detail (Descripcion+Color level) ──────────────────────────────

class CeldaHeatmapDetalle(BaseModel):
    local_id: int
    local_nombre: str
    stock: int
    velocidad_diaria: float
    cobertura_dias: float
    estado: str

class MultilocalColorDetalle(BaseModel):
    color_id: int
    color: str
    locales: list[CeldaHeatmapDetalle]

class MultilocalDescripcionDetalle(BaseModel):
    descripcion_id: int
    descripcion: str
    colores: list[MultilocalColorDetalle]

class TalleTransferencia(BaseModel):
    talle: str
    cantidad: int

class TransferenciaDetallada(BaseModel):
    descripcion_id: int
    descripcion: str
    color_id: int
    color: str
    origen_local_id: int
    origen_nombre: str
    destino_local_id: int
    destino_nombre: str
    cantidad: int
    talles: list[TalleTransferencia]
    cobertura_origen_antes: float
    cobertura_origen_despues: float
    cobertura_destino_antes: float
    cobertura_destino_despues: float
    ahorro_estimado: float
    costo_unitario: float

class DemandaLocal(BaseModel):
    local_id: int
    local_nombre: str
    demanda_diaria: float

class MultilocalDetailResponse(BaseModel):
    producto_nombre_id: int
    nombre: str
    descripciones: list[MultilocalDescripcionDetalle]
    transferencias: list[TransferenciaDetallada]
    demanda_por_local: list[DemandaLocal]


# ── Stock Models (CAPA 2 - ranking de Descripciones) ─────────────────────────

class StockModeloDescripcion(BaseModel):
    descripcionId: int
    descripcion: str
    stockTotal: int
    vendidasDesdeCompra: int
    diasDesdeCompra: int
    velocidadSalida: float
    coberturaDias: float
    costoPromedio: float
    score: float
    unidadesSugeridas: int
    inversionSugerida: float
    coberturaPostCompra: float
    estado: str                         # COMPRAR | OK | EXCESO
    alertaColor: str | None = None      # e.g. "Negro sin stock, 30% demanda"


class StockModelsRankingResponse(BaseModel):
    productoNombreId: int
    recomendacionTotal: int
    modelos: list[StockModeloDescripcion]


# ── Stock Model Detail (CAPA 3 + 4 — colores, talles, demanda por local) ─────

class TalleDetalle(BaseModel):
    talle: str
    stock: int
    pctDemanda: float
    prioridad: bool                          # stock=0 AND pctDemanda > 5%


class DemandaLocal(BaseModel):
    local: str
    pctDemanda: float
    unidadesMes: float


class ColorDetalle(BaseModel):
    colorId: int
    color: str
    stockTotal: int
    vendidas90d: int
    pctDemanda: float
    estado: str                              # REPONER | REVISAR | SIN MOVIMIENTO | OK
    talles: list[TalleDetalle]
    demandaPorLocal: list[DemandaLocal]


class StockModelDetailResponse(BaseModel):
    descripcionId: int
    descripcion: str
    colores: list[ColorDetalle]


# ── Stock Liquidation (stock muerto / sin rotación) ───────────────────────────

class LiquidacionDetalle(BaseModel):
    color: str
    talle: str
    stock: int
    diasEnStock: int
    vendidas: int


class LiquidacionModelo(BaseModel):
    descripcionId: int
    descripcion: str
    stockTotal: int
    valorStock: float
    edadPromDias: int
    vendidas90d: int
    descuentoSugerido: int
    capitalRecuperable: float
    detalle: list[LiquidacionDetalle]
    tieneDemandaOtroLocal: bool


class StockLiquidationResponse(BaseModel):
    capitalInmovilizado: float
    capitalRecuperable: float
    modelos: list[LiquidacionModelo]


# ── Rotación Histórica (últimos 6 meses, fórmula unidades) ────────────────────

class RotacionMesItem(BaseModel):
    mes: str                              # "2025-03"
    mes_nombre: str                       # "Mar 2025"
    rotacion: float                       # unidades / stock_promedio
    rotacion_anualizada: float            # rotacion * 12
    unidades_vendidas: int
    stock_promedio: int                   # (stock_actual + unidades_vendidas) / 2


class RotacionHistoricoResponse(BaseModel):
    meses: list[RotacionMesItem]


# ── Proveedor + precio promedio para un ProductoDescripcion ───────────────────

class ProveedorProductoResponse(BaseModel):
    proveedorId: int | None = None
    nombre: str | None = None
    telefono: str | None = None
    email: str | None = None
    precioCompraPromedio: float


# ── Precio de compra real ─────────────────────────────────────────────────────

class PrecioCompraResponse(BaseModel):
    precio_compra: float | None = None   # AVG(PrecioCompra) o None si no hay datos


# ── Talles disponibles para un modelo ─────────────────────────────────────────

class TalleDisponible(BaseModel):
    id: int
    talle: str

class TallesProductoResponse(BaseModel):
    talles: list[TalleDisponible]


# ── Transferencias sugeridas entre locales ────────────────────────────────────

class LocalTransfInfo(BaseModel):
    local_id: int
    local_nombre: str
    stock: int
    cobertura_dias: float

class TransferenciaSugerida(BaseModel):
    producto_nombre: str
    producto_descripcion: str
    origen: LocalTransfInfo
    destino: LocalTransfInfo
    cantidad_sugerida: int

class TransferenciasSugeridasResponse(BaseModel):
    sugerencias: list[TransferenciaSugerida]
