"""
Dashboard service: aggregated KPIs for the main client dashboard.
All queries target the tenant's Azure SQL database using the table/view
structure documented in docs/estructura_base_de_datos.txt.
"""
from __future__ import annotations

import asyncio
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from .schemas import DashboardKpis, TendenciaDia

logger = structlog.get_logger()


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _get_engine(platform_session, tenant_id: str, registry) -> AsyncEngine:
    from ..azure_db.service import get_db_config
    config = await get_db_config(platform_session, tenant_id)
    if not config or not config.vault_secret_id:
        raise ValueError(f"No Azure DB configuration for tenant {tenant_id}")
    return await registry.get_engine(tenant_id, str(config.vault_secret_id))


async def _run(engine: AsyncEngine, query, params: dict | None = None):
    async with engine.connect() as conn:
        return await conn.execute(query, params or {})


async def _run_safe(engine: AsyncEngine, query, params: dict | None = None) -> Any:
    """Run query, return None on error (for optional queries e.g. missing views)."""
    try:
        return await _run(engine, query, params)
    except Exception as exc:
        logger.warning("dashboard _run_safe failed", error=str(exc))
        return None


def _rows(result) -> list[dict[str, Any]]:
    keys = list(result.keys())
    return [dict(zip(keys, row)) for row in result.fetchall()]


# ── Main service function ─────────────────────────────────────────────────────

async def get_dashboard_kpis(
    platform_session,
    tenant_id: str,
    registry,
    local_id: int | None = None,
) -> DashboardKpis:
    engine = await _get_engine(platform_session, tenant_id, registry)

    params: dict[str, Any] = {"local_id": local_id}

    # ── 1. Ventas de hoy ──────────────────────────────────────────────────────
    q_hoy = text("""
        SELECT
            COUNT(*)                      AS cantidad,
            COALESCE(SUM(Total), 0)       AS monto
        FROM VentaCabecera
        WHERE CAST(Fecha AS DATE) = CAST(GETDATE() AS DATE)
          AND Anulada = 0
          AND (:local_id IS NULL OR LocalID = :local_id)
    """)

    # ── 2. Ticket fallback: últimos 7 días (when today has no sales) ──────────
    q_ticket_7d = text("""
        SELECT
            COALESCE(SUM(Total), 0)  AS monto,
            COUNT(*)                 AS cantidad
        FROM VentaCabecera
        WHERE Fecha >= DATEADD(DAY, -7, GETDATE())
          AND Anulada = 0
          AND (:local_id IS NULL OR LocalID = :local_id)
    """)

    # ── 3. Stock crítico (view already exists in the tenant DB) ───────────────
    q_stock_critico = text("SELECT COUNT(*) FROM vw_ProductosBajoStock")

    # ── 4. Ítems en baja rotación (sin ventas en 60 días, con stock > 0) ─────
    q_baja_rotacion = text("""
        SELECT COUNT(*)
        FROM Productos p
        WHERE p.Stock > 0
          AND NOT EXISTS (
            SELECT 1
            FROM VentaDetalle vd
            INNER JOIN VentaCabecera vc ON vc.VentaID = vd.VentaID
            WHERE vd.ProductoID = p.ProductoID
              AND vc.Fecha >= DATEADD(DAY, -60, GETDATE())
              AND vc.Anulada = 0
          )
    """)

    # ── 5. Tendencia últimos 7 días ───────────────────────────────────────────
    q_tendencia = text("""
        SELECT
            CAST(Fecha AS DATE)       AS Dia,
            COALESCE(SUM(Total), 0)   AS Total
        FROM VentaCabecera
        WHERE Fecha >= DATEADD(DAY, -7, GETDATE())
          AND Anulada = 0
          AND (:local_id IS NULL OR LocalID = :local_id)
        GROUP BY CAST(Fecha AS DATE)
        ORDER BY Dia ASC
    """)

    # Run all queries in parallel
    r_hoy, r_ticket_7d, r_stock, r_baja, r_tendencia = await asyncio.gather(
        _run(engine, q_hoy, params),
        _run(engine, q_ticket_7d, params),
        _run_safe(engine, q_stock_critico),   # safe: view may not exist
        _run(engine, q_baja_rotacion),
        _run(engine, q_tendencia, params),
    )

    # ── Process results ───────────────────────────────────────────────────────

    row_hoy = r_hoy.fetchone()
    ventas_hoy_cantidad = int(row_hoy[0] or 0) if row_hoy else 0
    ventas_hoy_monto    = float(row_hoy[1] or 0) if row_hoy else 0.0

    # Ticket promedio: use today's data if available, else fall back to 7-day avg
    ticket_es_7d = False
    if ventas_hoy_cantidad > 0:
        ticket_promedio = ventas_hoy_monto / ventas_hoy_cantidad
    else:
        row_7d = r_ticket_7d.fetchone()
        monto_7d = float(row_7d[0] or 0) if row_7d else 0.0
        cant_7d  = int(row_7d[1] or 0)   if row_7d else 0
        ticket_promedio = monto_7d / cant_7d if cant_7d > 0 else 0.0
        ticket_es_7d = True

    stock_critico = int(r_stock.scalar() or 0) if r_stock else 0
    baja_rotacion  = int(r_baja.scalar() or 0)

    tend_rows  = _rows(r_tendencia)
    tendencia_7d = [
        TendenciaDia(dia=str(r["Dia"]), total=float(r["Total"] or 0))
        for r in tend_rows
    ]

    return DashboardKpis(
        ventas_hoy_cantidad=ventas_hoy_cantidad,
        ventas_hoy_monto=ventas_hoy_monto,
        ticket_promedio=ticket_promedio,
        ticket_promedio_es_7d=ticket_es_7d,
        stock_critico=stock_critico,
        baja_rotacion=baja_rotacion,
        tendencia_7d=tendencia_7d,
    )
