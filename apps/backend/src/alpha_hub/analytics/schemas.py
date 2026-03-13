"""
Analytics schemas: response models for tenant business analytics.
All data is sourced from the tenant's Azure SQL database (db_keloke_v2 schema).
"""
from __future__ import annotations

from typing import Any

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
    por_local: list[dict[str, Any]]          # [{nombre, total, pct}]
    por_metodo_pago: list[dict[str, Any]]    # [{nombre, total, pct}]
    por_tipo_venta: list[dict[str, Any]]     # [{tipo, total, pct}]
    top_productos: list[dict[str, Any]]      # [{nombre, descripcion, talle, color, total, cantidad, pct}]
    top_por_nombre: list[dict[str, Any]]     # [{nombre, total, cantidad, pct}] aggregated by name
    top_por_descripcion: list[dict[str, Any]]  # [{nombre, descripcion, total, cantidad, pct}] by descripcion
    total_periodo: float
    facturado_bruto: float                   # precio lista antes de descuento (best-effort)
    cantidad_ventas: int
    ticket_promedio: float
    cmv: float                               # Costo de mercadería vendida
    comisiones: float                        # Comisiones por método de pago
    vendido_cuenta: float                    # Ventas a cuenta corriente en el período
    cantidad_cuenta: int                     # Cantidad de ventas a cuenta
    cobros_cuenta: float                     # Cobros recibidos de cuentas corrientes
    pct_del_total: float | None              # % de lo filtrado vs total período (cuando hay filtro de producto)


# ── Gastos ────────────────────────────────────────────────────────────────────

class GastosResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]     # [{fecha, total}]
    por_tipo: list[dict[str, Any]]           # [{tipo, total, pct}] for pie chart
    por_categoria: list[dict[str, Any]]      # [{categoria, tipo, total, pct}] for table
    por_metodo_pago: list[dict[str, Any]]    # [{nombre, total, pct}]
    detalle_gastos: list[dict[str, Any]]     # individual records sorted by fecha DESC
    total_periodo: float
    ratio_ventas: float | None


# ── Stock ─────────────────────────────────────────────────────────────────────

class ProductoStock(BaseModel):
    producto_id: int
    nombre: str
    descripcion: str | None                  # ProductoDescripcion.Descripcion
    talle: str | None
    color: str | None
    stock_actual: int
    precio_costo: float                      # Último costo de compra
    monto_stock: float                       # stock_actual * precio_costo
    unidades_vendidas_periodo: int
    rotacion: float                          # unidades / stock_actual
    rotacion_anualizada: float               # (unidades/dias_periodo)*365 / stock_actual
    cobertura_dias: float                    # stock / avg_daily_sales
    cobertura_ajustada: float                # cobertura usando tasa de crecimiento proyectada
    contribucion_pct: float                  # % del revenue total en el período
    clasificacion_abc: str                   # "A", "B" o "C"
    es_substock: bool                        # cobertura < 7 días
    es_sobrestock: bool                      # cobertura > 90 días con ventas activas


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
    descripcion: str                         # nombre · descripcion · talle · color
    unidades_vendidas: int
    stock_actual: int
    cobertura_dias: float
    alerta_stock: bool                       # True si cobertura < 14 días o stock crítico


class RotacionMensual(BaseModel):
    anio: int
    mes: int
    label: str                               # "Ene 2025"
    ventas_unidades: int
    compras_unidades: int
    stock_estimado: int                      # reconstructed from ventas + compras
    rotacion: float                          # ventas / avg_stock
    revenue: float


class StockResponse(BaseModel):
    productos: list[ProductoStock]           # ABC por descripción (nombre+talle+color)
    abc_por_nombre: list[AbcNombre]          # ABC agregado por nombre de producto
    mas_vendidos: list[MasVendido]           # Top 30 por unidades vendidas con alerta
    bajo_stock: list[dict[str, Any]]         # from vw_ProductosBajoStock
    monto_total_stock: float                 # Valor total del stock (stock * precio_costo)
    rotacion_general: float                  # Rotación promedio de la tienda
    rotacion_mensual_promedio: float         # Promedio mensual de rotación (últimos 6 meses)
    cobertura_general: float                 # Cobertura general en días
    calce_financiero: float                  # compras_periodo / cmv_diario — días para recuperar inversión
    skus_sin_stock: int
    skus_bajo_stock: int
    substock_count: int                      # Productos con cobertura < 7 días
    sobrestock_count: int                    # Productos con cobertura > 90 días
    rotacion_por_mes: list[RotacionMensual]  # Monthly rotation drilldown (last 12 months)


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
    compra_detalle_id: int
    producto_id: int
    nombre: str
    descripcion: str | None
    talle: str | None
    color: str | None
    cantidad: int
    costo_unitario: float
    subtotal: float


class CompraItemsResponse(BaseModel):
    compra_id: int
    fecha: str
    proveedor: str
    items: list[CompraItem]
    total: float


class CompraOrden(BaseModel):
    compra_id: int
    fecha: str
    proveedor: str
    total: float
    cantidad_items: int


class ComprasResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]     # [{fecha, total, cantidad}]
    top_productos: list[dict[str, Any]]      # [{nombre, descripcion, talle, color, total, cantidad}]
    por_proveedor: list[dict[str, Any]]      # [{nombre, total, cantidad_ordenes, pct}]
    ordenes: list[CompraOrden]               # Individual purchase orders (last 100)
    total_periodo: float
    cantidad_ordenes: int
    promedio_por_orden: float
    unidades_totales: int


# ── Filtros ───────────────────────────────────────────────────────────────────

class FiltrosDisponibles(BaseModel):
    locales: list[dict[str, Any]]
    metodos_pago: list[dict[str, Any]]
    tipos_venta: list[str]
    talles: list[dict[str, Any]]             # [{id, nombre}]
    colores: list[dict[str, Any]]            # [{id, nombre}]
    tipos_gasto: list[dict[str, Any]]        # [{id, nombre}]
    categorias_gasto: list[dict[str, Any]]   # [{id, nombre}]
    proveedores: list[dict[str, Any]]        # [{id, nombre}]
    nombres_producto: list[dict[str, Any]]   # [{id, nombre}]
