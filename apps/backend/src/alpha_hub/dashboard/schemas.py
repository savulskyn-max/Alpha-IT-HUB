from pydantic import BaseModel


class TendenciaDia(BaseModel):
    dia: str   # ISO date "2025-01-15"
    total: float


class DashboardKpis(BaseModel):
    ventas_hoy_cantidad: int
    ventas_hoy_monto: float
    ticket_promedio: float
    ticket_promedio_es_7d: bool   # True when today has no sales → used 7-day average
    stock_critico: int
    baja_rotacion: int
    tendencia_7d: list[TendenciaDia]
