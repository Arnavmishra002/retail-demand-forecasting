"""Demand forecasting: ridge regression on calendar + price/promo features.

Why this model
--------------
Retail daily demand at the store x SKU grain is dominated by four effects that
are all *observable in advance*: day-of-week, annual seasonality, price, and the
promotion calendar. A regularised linear model on those features is therefore a
direct multi-horizon forecaster -- no recursion, no error compounding -- and it
stays interpretable enough that a planner can ask "why is next Friday high?"
and get an answer.

Everything is validated against a seasonal-naive baseline with a rolling-origin
backtest, so the accuracy numbers on the dashboard are out-of-sample.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

HORIZON = 28          # days forecast forward
BACKTEST_FOLDS = 3    # rolling-origin folds, each HORIZON days long
RIDGE_LAMBDA = 2.0
N_FOURIER = 2


def _fourier(doy: np.ndarray, n: int = N_FOURIER) -> np.ndarray:
    cols = []
    for k in range(1, n + 1):
        cols.append(np.sin(2 * np.pi * k * doy / 365.25))
        cols.append(np.cos(2 * np.pi * k * doy / 365.25))
    return np.column_stack(cols)


def design_matrix(dates: pd.DatetimeIndex, price: np.ndarray, list_price: float,
                  promo: np.ndarray, holiday: np.ndarray, t0: pd.Timestamp) -> np.ndarray:
    """Feature block shared by fit and predict so the two can never drift apart."""
    dates = pd.DatetimeIndex(dates)
    dow = dates.dayofweek.to_numpy()
    doy = dates.dayofyear.to_numpy().astype(float)
    trend = ((dates - t0).days.to_numpy().astype(float)) / 365.0

    dow_dummies = np.zeros((len(dates), 6))
    for i in range(6):                      # Monday is the reference level
        dow_dummies[:, i] = (dow == i + 1).astype(float)

    log_price_ratio = np.log(np.clip(price, 1e-6, None) / list_price)

    return np.column_stack(
        [
            np.ones(len(dates)),
            trend,
            dow_dummies,
            _fourier(doy),
            log_price_ratio,
            promo.astype(float),
            holiday.astype(float),
            promo.astype(float) * log_price_ratio,
        ]
    )


def ridge_fit(X: np.ndarray, y: np.ndarray, lam: float = RIDGE_LAMBDA) -> np.ndarray:
    """Closed-form ridge. The intercept column is left unpenalised.

    The ``errstate`` guard is not hiding a numerical problem in the data: NumPy 2
    on Apple's Accelerate BLAS raises spurious divide/overflow warnings from
    ``matmul`` even for fully finite inputs. Inputs are asserted finite instead.
    """
    assert np.isfinite(X).all() and np.isfinite(y).all(), "non-finite design matrix"
    p = X.shape[1]
    penalty = np.eye(p) * lam
    penalty[0, 0] = 0.0
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        return np.linalg.solve(X.T @ X + penalty, X.T @ y)


def seasonal_naive(history: np.ndarray, horizon: int, season: int = 7) -> np.ndarray:
    """Mean of the last four same-weekday observations -- a strong retail baseline."""
    out = np.empty(horizon)
    for h in range(horizon):
        idx = [len(history) - season * k + (h % season) for k in range(4, 0, -1)]
        vals = [history[i] for i in idx if 0 <= i < len(history)]
        out[h] = float(np.mean(vals)) if vals else float(np.mean(history[-season:]))
    return out


def wape(actual: np.ndarray, pred: np.ndarray) -> float:
    denom = np.abs(actual).sum()
    return float(np.abs(actual - pred).sum() / denom) if denom > 0 else float("nan")


def smape(actual: np.ndarray, pred: np.ndarray) -> float:
    denom = (np.abs(actual) + np.abs(pred)) / 2.0
    mask = denom > 0
    return float(np.mean(np.abs(actual - pred)[mask] / denom[mask])) if mask.any() else float("nan")


def bias(actual: np.ndarray, pred: np.ndarray) -> float:
    denom = np.abs(actual).sum()
    return float((pred - actual).sum() / denom) if denom > 0 else float("nan")


@dataclass
class SeriesForecast:
    store_id: str
    sku: str
    dates: list[str]
    mean: np.ndarray
    lower: np.ndarray
    upper: np.ndarray
    sigma: float           # residual std in units/day, out-of-sample
    wape_model: float
    wape_naive: float
    smape_model: float
    bias_model: float


def _fit_predict(train: pd.DataFrame, future: pd.DataFrame, t0: pd.Timestamp) -> np.ndarray:
    X = design_matrix(
        pd.DatetimeIndex(train["date"]), train["price"].to_numpy(),
        float(train["list_price"].iloc[0]), train["promo"].to_numpy(),
        train["holiday"].to_numpy(), t0,
    )
    y = np.log1p(train["units"].to_numpy().astype(float))
    beta = ridge_fit(X, y)

    Xf = design_matrix(
        pd.DatetimeIndex(future["date"]), future["price"].to_numpy(),
        float(train["list_price"].iloc[0]), future["promo"].to_numpy(),
        future["holiday"].to_numpy(), t0,
    )
    # log-normal retransformation: E[exp(z)] = exp(mu + s^2/2)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        resid = y - X @ beta
        s2 = float(np.var(resid, ddof=X.shape[1]))
        fitted = Xf @ beta + s2 / 2.0
    return np.clip(np.expm1(fitted), 0.0, None)


def forecast_series(series: pd.DataFrame, future: pd.DataFrame,
                    t0: pd.Timestamp) -> SeriesForecast:
    series = series.sort_values("date").reset_index(drop=True)
    actual = series["units"].to_numpy().astype(float)

    # ---- rolling-origin backtest --------------------------------------
    resid_by_h: list[list[float]] = [[] for _ in range(HORIZON)]
    err_model, err_naive, act_all = [], [], []
    for fold in range(BACKTEST_FOLDS, 0, -1):
        cut = len(series) - fold * HORIZON
        if cut < 180:
            continue
        train, test = series.iloc[:cut], series.iloc[cut:cut + HORIZON]
        pred = _fit_predict(train, test, t0)
        base = seasonal_naive(actual[:cut], len(test))
        truth = test["units"].to_numpy().astype(float)
        err_model.append(pred)
        err_naive.append(base)
        act_all.append(truth)
        for h, r in enumerate(truth - pred):
            resid_by_h[h].append(float(r))

    act_cat = np.concatenate(act_all)
    mdl_cat = np.concatenate(err_model)
    nav_cat = np.concatenate(err_naive)

    # ---- final fit on all history -------------------------------------
    mean = _fit_predict(series, future, t0)

    # horizon-dependent intervals from backtest residuals; widen with sqrt(h)
    pooled = np.std(np.concatenate([np.array(r) for r in resid_by_h if r]))
    sigma_h = np.array([
        np.std(resid_by_h[h]) if len(resid_by_h[h]) >= 3 else pooled * np.sqrt((h + 7) / 7)
        for h in range(HORIZON)
    ])
    sigma_h = np.maximum(sigma_h, 0.25)
    z80 = 1.2816
    lower = np.clip(mean - z80 * sigma_h, 0.0, None)
    upper = mean + z80 * sigma_h

    return SeriesForecast(
        store_id=series["store_id"].iloc[0],
        sku=series["sku"].iloc[0],
        dates=[d.strftime("%Y-%m-%d") for d in pd.DatetimeIndex(future["date"])],
        mean=mean, lower=lower, upper=upper,
        sigma=float(pooled),
        wape_model=wape(act_cat, mdl_cat),
        wape_naive=wape(act_cat, nav_cat),
        smape_model=smape(act_cat, mdl_cat),
        bias_model=bias(act_cat, mdl_cat),
    )
