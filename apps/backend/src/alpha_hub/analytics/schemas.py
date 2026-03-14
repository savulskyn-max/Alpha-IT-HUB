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
    alerta_stock: bool


class StockResponse(BaseModel):
    productos: list[ProductoStock]
    abc_por_nombre: list[AbcNombre]
    mas_vendidos: list[MasVendido]
    bajo_stock: list[dict[str, Any]]
    monto_total_stock: float
    monto_total_stock_compra: float
    rotacion_general: float
    rotacion_promedio_mensual: float
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
