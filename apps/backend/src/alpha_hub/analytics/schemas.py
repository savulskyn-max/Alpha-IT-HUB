"""
Analytics schemas: response models for tenant business analytics.
All data is sourced from the tenant's Azure SQL database (db_keloke_v2 schema).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel


# ── KPIs ──────────────────────────────────────────────────────────────────────

class KpiSummary(BaseModel):
    ventas_hoy: float
    ventas_mes: float
    gastos_mes: float
    margen_mes: float          # ventas_mes - gastos_mes
    cantidad_ventas_mes: int
    ticket_promedio: float     # ventas_mes / cantidad_ventas_mes


# ── Ventas ────────────────────────────────────────────────────────────────────

class VentasPorFecha(BaseModel):
    fecha: str                 # ISO date string
    total: float
    cantidad: int


class VentasResponse(BaseModel):
    serie_temporal: list[VentasPorFecha]
    por_local: list[dict[str, Any]]          # [{nombre, total, pct}]
    por_metodo_pago: list[dict[str, Any]]    # [{nombre, total, pct}]
    por_tipo_venta: list[dict[str, Any]]     # [{tipo, total, pct}]
    top_productos: list[dict[str, Any]]      # [{nombre, talle, color, total, cantidad, pct}]
    total_periodo: float
    cantidad_ventas: int
    ticket_promedio: float


# ── Gastos ────────────────────────────────────────────────────────────────────

class GastosResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]     # [{fecha, total}]
    por_categoria: list[dict[str, Any]]      # [{categoria, tipo, total, pct}]
    por_metodo_pago: list[dict[str, Any]]    # [{nombre, total, pct}]
    total_periodo: float
    ratio_ventas: float | None               # gastos / ventas mismo período (%)


# ── Stock ─────────────────────────────────────────────────────────────────────

class ProductoStock(BaseModel):
    producto_id: int
    nombre: str
    talle: str | None
    color: str | None
    stock_actual: int
    unidades_vendidas_periodo: int
    rotacion: float            # unidades_vendidas / stock_promedio (0 if no stock)
    cobertura_dias: float      # stock_actual / ventas_promedio_diarias (days of coverage)
    contribucion_pct: float    # % of total revenue in period
    clasificacion_abc: str     # "A", "B", or "C"


class StockResponse(BaseModel):
    productos: list[ProductoStock]
    bajo_stock: list[dict[str, Any]]   # from vw_ProductosBajoStock or computed
    total_skus: int
    skus_sin_stock: int
    skus_bajo_stock: int


# ── Compras ───────────────────────────────────────────────────────────────────

class ComprasResponse(BaseModel):
    serie_temporal: list[dict[str, Any]]     # [{fecha, total, cantidad}]
    top_productos: list[dict[str, Any]]      # [{nombre, total, cantidad}]
    total_periodo: float
    cantidad_ordenes: int
    promedio_por_orden: float


# ── Filtros ───────────────────────────────────────────────────────────────────

class FiltrosDisponibles(BaseModel):
    locales: list[dict[str, Any]]            # [{id, nombre}]
    metodos_pago: list[dict[str, Any]]       # [{id, nombre}]
    tipos_venta: list[str]
    talles: list[dict[str, Any]]             # [{id, nombre}]
    colores: list[dict[str, Any]]            # [{id, nombre}]
    tipos_gasto: list[dict[str, Any]]        # [{id, nombre}]
    categorias_gasto: list[dict[str, Any]]   # [{id, nombre}]
