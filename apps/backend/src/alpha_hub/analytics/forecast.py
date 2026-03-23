"""
Sales forecasting for retail inventory planning.

Algorithm: Holt's double exponential smoothing (Level + Trend).
If >= 52 weeks of data: multiplicative seasonal adjustment is applied.

This is designed to be conservative and transparent — forecasts include
a confidence level so the UI can warn the user when data is insufficient.
"""
from __future__ import annotations

import math
from typing import Any


# ── Core algorithm ─────────────────────────────────────────────────────────────

def holt_forecast(series: list[float], h: int, alpha: float = 0.3, beta: float = 0.15) -> tuple[list[float], float]:
    """
    Holt's double exponential smoothing.

    Args:
        series: Historical values, oldest first.
        h: Periods to forecast.
        alpha: Level smoothing factor [0, 1].
        beta: Trend smoothing factor [0, 1].

    Returns:
        (forecasts, trend_per_period)
    """
    n = len(series)
    if n == 0 or sum(series) == 0:
        return [0.0] * h, 0.0
    if n == 1:
        return [max(0.0, series[0])] * h, 0.0

    # Initialize level as first value; trend from first 4 data points (or all)
    window = min(n - 1, 4)
    L = series[0]
    T = (series[window] - series[0]) / window if window > 0 else 0.0

    for t in range(1, n):
        L_prev = L
        L = alpha * series[t] + (1 - alpha) * (L + T)
        T = beta * (L - L_prev) + (1 - beta) * T

    forecasts = [max(0.0, round(L + (i + 1) * T, 2)) for i in range(h)]
    return forecasts, T


def seasonal_indices(series: list[float], period: int) -> list[float]:
    """
    Compute multiplicative seasonal indices for a given period (e.g., 52 weeks/year).
    Returns list of length `period` with indices centered around 1.0.
    """
    n = len(series)
    if n < period * 2:
        return [1.0] * period

    # Compute centered moving average
    half = period // 2
    ma: list[float] = []
    for i in range(half, n - half):
        window = series[i - half: i + half + 1]
        ma.append(sum(window) / len(window))

    # Compute ratios: actual / MA
    offset = half
    buckets: dict[int, list[float]] = {i: [] for i in range(period)}
    for i, m in enumerate(ma):
        if m > 0:
            idx = (i + offset) % period
            buckets[idx].append(series[i + offset] / m)

    # Average and normalize
    raw = [sum(v) / len(v) if v else 1.0 for v in buckets.values()]
    avg = sum(raw) / len(raw) if raw else 1.0
    if avg == 0:
        return [1.0] * period
    return [r / avg for r in raw]


def detect_trend(series: list[float]) -> str:
    """
    Classify trend direction using linear regression slope.
    """
    n = len(series)
    if n < 4:
        return 'estable'
    x_mean = (n - 1) / 2
    y_mean = sum(series) / n
    num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(series))
    den = sum((i - x_mean) ** 2 for i in range(n))
    if den == 0:
        return 'estable'
    slope = num / den
    relative = slope / y_mean if y_mean > 0 else 0.0
    if relative > 0.03:
        return 'creciente'
    if relative < -0.03:
        return 'decreciente'
    return 'estable'


def confidence_label(weeks: int) -> str:
    if weeks >= 52:
        return 'alta'
    if weeks >= 12:
        return 'media'
    return 'baja'


# ── Main forecasting function ──────────────────────────────────────────────────

def forecast_product(
    weekly_sales: list[float],
    h_weeks: int = 13,  # ~3 months
    years_of_data: int = 0,
) -> dict[str, Any]:
    """
    Forecast h_weeks of weekly sales for a single product.

    Args:
        weekly_sales: Weekly sales history, oldest first.
        h_weeks: Periods to forecast ahead.
        years_of_data: Calendar years of tenant sales data (from VentaCabecera date range).
                       Used to clamp seasonal factors when history is limited.

    Returns dict with:
        - historico: list[float] (last 26 weeks max for UI sparkline)
        - prediccion_semanas: list[float] (next h_weeks)
        - prediccion_30d: float
        - prediccion_60d: float
        - prediccion_90d: float
        - tendencia: str
        - confianza: str
        - semanas_datos: int
    """
    n = len(weekly_sales)

    # Use at most 104 weeks (2 years) for fitting
    fit_series = weekly_sales[-104:] if n > 104 else weekly_sales
    n_fit = len(fit_series)

    # Seasonal adjustment if >= 52 weeks
    indices: list[float] = []
    if n_fit >= 52:
        raw_indices = seasonal_indices(fit_series, period=52)

        # Clamp seasonal factors based on available years of calendar data.
        # With < 2 years of data, extreme seasonal spikes are likely noise.
        if years_of_data < 2:
            factor_min, factor_max = 0.5, 2.0
        else:
            factor_min, factor_max = 0.3, 3.0

        clamped = []
        for idx_val in raw_indices:
            clamped_val = max(factor_min, min(factor_max, idx_val))
            if clamped_val != idx_val:
                print(
                    f"[forecast] seasonal factor clamped: {idx_val:.4f} → {clamped_val:.4f} "
                    f"(years_of_data={years_of_data}, range=[{factor_min}, {factor_max}])"
                )
            clamped.append(clamped_val)
        indices = clamped

        # Deseasonalize
        ds = [
            fit_series[i] / indices[i % 52] if indices[i % 52] > 0 else fit_series[i]
            for i in range(n_fit)
        ]
    else:
        ds = fit_series

    # Forecast deseasonalized values
    forecasts_ds, trend = holt_forecast(ds, h_weeks)

    # Reapply seasonality
    if indices:
        last_season_pos = n_fit % 52
        forecasts = [
            max(0.0, round(f * indices[(last_season_pos + i) % 52], 2))
            for i, f in enumerate(forecasts_ds)
        ]
    else:
        forecasts = forecasts_ds

    # 30/60/90 day forecasts (1 week ≈ 7 days)
    w30, w60, w90 = 4, 9, 13
    pred_30 = round(sum(forecasts[:w30]), 1)
    pred_60 = round(sum(forecasts[:w60]), 1)
    pred_90 = round(sum(forecasts[:min(w90, h_weeks)]), 1)

    # Sparkline: last 26 weeks of actuals
    historico = [round(v, 1) for v in weekly_sales[-26:]]

    return {
        'historico': historico,
        'prediccion_semanas': [round(v, 1) for v in forecasts],
        'prediccion_30d': pred_30,
        'prediccion_60d': pred_60,
        'prediccion_90d': pred_90,
        'tendencia': detect_trend(fit_series),
        'confianza': confidence_label(n),
        'semanas_datos': n,
    }
