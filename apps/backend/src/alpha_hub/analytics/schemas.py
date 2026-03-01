"""
Analytics response schemas.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class KpiSummary(BaseModel):
    ventas_hoy: float
    ventas_mes: float
    gastos_mes: float
    margen_mes: float
    cantidad_ventas_mes: int
    ticket_promedio: float


class VentasPorFecha(BaseModel):
    fecha: str
    total: float
    cantidad: int


class VentasResponse(BaseModel):
    serie_temporal: list[VentasPorFecha]
    por_local: list[dict[str, Any]]
    por_metodo_pago: list[dict[str, Any]]
    por_tipo_venta: list[dict[str, Any]]
    top_productos: list[dict[str, Any]]
    top_productos_por_nombre: list[dict[str, Any]] = []
    top_productos_detalle: list[dict[str, Any]] = []
    participacion_producto_filtrado_pct: float | None = None
    total_periodo: float
    cantidad_ventas: int
    ticket_promedio: float
    facturado_total: float = 0.0
    costo_mercaderia_vendida: float = 0.0
    comisiones_pago: float = 0.0
    margen_bruto_post_comisiones: float = 0.0
    vendido_a_cuenta: float = 0.0
    cobrado_de_cuenta_corriente: float = 0.0


class GastosResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]
    por_categoria: list[dict[str, Any]]
    por_tipo: list[dict[str, Any]] = []
    por_metodo_pago: list[dict[str, Any]]
    detalle: list[dict[str, Any]] = []
    total_periodo: float
    ratio_ventas: float | None


class ProductoStock(BaseModel):
    producto_id: int
    nombre: str
    descripcion: str = ""
    talle: str | None
    color: str | None
    stock_actual: int
    unidades_vendidas_periodo: int
    rotacion: float
    cobertura_dias: float
    contribucion_pct: float
    clasificacion_abc: Literal["A", "B", "C"] = "C"
    estado_stock: Literal["substock", "normal", "sobrestock"] = "normal"
    alerta_bajo_stock: bool = False


class StockResponse(BaseModel):
    productos: list[ProductoStock]
    bajo_stock: list[dict[str, Any]]
    monto_total_stock_compra: float = 0.0
    rotacion_general: float = 0.0
    cobertura_general_dias: float = 0.0
    tasa_crecimiento_ventas: float = 0.0
    analisis_stock: dict[str, int] = {}
    abc_por_nombre: list[dict[str, Any]] = []
    abc_por_descripcion: list[dict[str, Any]] = []
    mas_vendidos_por_nombre: list[dict[str, Any]] = []
    mas_vendidos_por_descripcion: list[dict[str, Any]] = []
    total_productos: int = 0


class ComprasResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]
    top_productos: list[dict[str, Any]]
    top_proveedores: list[dict[str, Any]] = []
    analisis: dict[str, Any] = {}
    total_periodo: float
    cantidad_ordenes: int
    promedio_por_orden: float


class FiltrosDisponibles(BaseModel):
    locales: list[dict[str, Any]]
    metodos_pago: list[dict[str, Any]]
    tipos_venta: list[str]
    talles: list[dict[str, Any]]
    colores: list[dict[str, Any]]
    tipos_gasto: list[dict[str, Any]]
    categorias_gasto: list[dict[str, Any]]
