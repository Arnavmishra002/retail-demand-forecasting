"""Synthetic but realistic multi-store / multi-SKU retail demand panel.

The generator is deliberately explicit about the structure it injects -- weekly
seasonality, yearly seasonality, trend, price elasticity, promotions, holiday
lifts and negative-binomial style noise -- so that the forecasting model in
``forecast.py`` is solving a problem with a known, checkable signal.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

RNG_SEED = 20240517

STORES = [
    ("S01", "Downtown Flagship", "Urban", 1.45),
    ("S02", "Riverside Mall", "Suburban", 1.10),
    ("S03", "Northgate Plaza", "Suburban", 0.95),
    ("S04", "Airport Kiosk", "Travel", 0.62),
    ("S05", "Lakeside Outlet", "Outlet", 0.88),
    ("S06", "Eastview Express", "Urban", 0.74),
]

# sku, name, category, base_price, unit_cost, base_rate, elasticity, season_phase
#
# base_rate is deliberately skewed: a handful of hero lines carry most of the
# revenue and the tail moves a couple of units a day. That is what real assortments
# look like, and it is what makes the ABC split and the slow-mover forecasting
# problem on the dashboard meaningful rather than decorative.
SKUS = [
    ("K101", "Cold Brew Concentrate", "Beverages", 8.50, 4.10, 88.0, -1.8, 0.58),
    ("K102", "Sparkling Water 12pk", "Beverages", 6.25, 3.05, 150.0, -2.1, 0.55),
    ("K103", "Oat Milk 1L", "Beverages", 4.40, 2.35, 52.0, -1.5, 0.12),
    ("K201", "Protein Bar Variety", "Snacks", 12.90, 6.40, 95.0, -1.3, 0.05),
    ("K202", "Kettle Chips 200g", "Snacks", 3.75, 1.60, 160.0, -1.9, 0.48),
    ("K203", "Trail Mix 500g", "Snacks", 9.10, 4.55, 14.0, -1.1, 0.72),
    ("K301", "Laundry Pods 40ct", "Household", 18.50, 10.20, 26.0, -0.9, 0.30),
    ("K302", "Paper Towels 6pk", "Household", 14.25, 8.10, 21.0, -1.0, 0.18),
    ("K303", "Dish Soap 750ml", "Household", 5.60, 2.70, 8.5, -1.2, 0.25),
    ("K401", "Sunscreen SPF50", "Seasonal", 16.80, 7.35, 5.5, -1.6, 0.52),
    ("K402", "Insulated Bottle 750ml", "Seasonal", 27.40, 12.60, 6.2, -1.4, 0.46),
    ("K403", "Fleece Throw Blanket", "Seasonal", 31.00, 14.80, 1.1, -1.7, 0.96),
    ("K501", "AA Batteries 8pk", "Electronics", 11.40, 5.20, 2.0, -1.0, 0.88),
    ("K502", "USB-C Cable 2m", "Electronics", 13.60, 4.90, 5.0, -1.5, 0.08),
    ("K503", "Wireless Earbuds", "Electronics", 59.00, 28.50, 6.5, -1.9, 0.90),
]

HOLIDAYS = {
    "01-01": 0.70, "02-14": 1.18, "05-26": 1.22, "07-04": 1.35,
    "09-01": 1.15, "10-31": 1.28, "11-27": 1.85, "11-28": 1.40,
    "12-24": 1.62, "12-25": 0.35, "12-26": 1.20, "12-31": 1.30,
}

DOW_SHAPE = np.array([0.88, 0.84, 0.90, 1.00, 1.18, 1.42, 1.28])  # Mon..Sun


def holiday_factor(ts: pd.Timestamp) -> float:
    return HOLIDAYS.get(ts.strftime("%m-%d"), 1.0)


def build_panel(days: int = 735, end: pd.Timestamp | None = None) -> pd.DataFrame:
    """Return a tidy daily panel of ``date, store, sku, units, price, promo, ...``.

    History ends yesterday by default so the dashboard always opens on a "today"
    that matches the wall clock. The seed is fixed, so the *shape* of the series
    is reproducible even though the calendar window slides.
    """
    rng = np.random.default_rng(RNG_SEED)
    end = end if end is not None else pd.Timestamp.today().normalize() - pd.Timedelta(days=1)
    dates = pd.date_range(end=end, periods=days, freq="D")
    doy = dates.dayofyear.to_numpy()
    dow = dates.dayofweek.to_numpy()
    t = np.arange(days) / 365.0
    holiday = np.array([holiday_factor(d) for d in dates])

    rows = []
    for store_id, store_name, fmt, store_mult in STORES:
        # each store drifts on its own slow trajectory
        store_trend = rng.normal(0.045, 0.05)
        store_noise = 0.9 + 0.2 * rng.random()
        for sku, sku_name, category, price, cost, base_rate, elasticity, phase in SKUS:
            yearly = 1.0 + 0.42 * np.sin(2 * np.pi * (doy / 365.25 - phase))
            if category == "Seasonal":
                yearly = 1.0 + 0.85 * np.sin(2 * np.pi * (doy / 365.25 - phase))
            trend = np.exp((store_trend + rng.normal(0.0, 0.03)) * t)

            # promotions: ~9% of days, clustered into 3-7 day windows
            promo = np.zeros(days)
            n_promos = rng.poisson(days * 0.09 / 5)
            for _ in range(max(n_promos, 1)):
                s = int(rng.integers(0, days - 8))
                promo[s:s + int(rng.integers(3, 8))] = 1.0

            discount = np.where(promo > 0, rng.uniform(0.12, 0.35, days), 0.0)
            eff_price = price * (1 - discount)
            price_effect = (eff_price / price) ** elasticity

            lam = (
                base_rate * store_mult * store_noise
                * DOW_SHAPE[dow] * yearly * trend * holiday * price_effect
                * (1.0 + 0.22 * promo)  # display / feature lift beyond the price cut
            )
            lam = np.clip(lam, 0.15, None)
            # negative-binomial overdispersion (gamma-mixed Poisson)
            shape = 9.0
            mixed = rng.gamma(shape, lam / shape)
            units = rng.poisson(mixed)

            rows.append(
                pd.DataFrame(
                    {
                        "date": dates,
                        "store_id": store_id,
                        "store_name": store_name,
                        "store_format": fmt,
                        "sku": sku,
                        "sku_name": sku_name,
                        "category": category,
                        "units": units.astype(int),
                        "list_price": price,
                        "unit_cost": cost,
                        "price": np.round(eff_price, 2),
                        "promo": promo.astype(int),
                        "holiday": (holiday != 1.0).astype(int),
                    }
                )
            )

    panel = pd.concat(rows, ignore_index=True)
    panel["revenue"] = panel["units"] * panel["price"]
    panel["margin"] = panel["units"] * (panel["price"] - panel["unit_cost"])
    return panel


if __name__ == "__main__":
    df = build_panel()
    print(df.shape)
    print(df.head())
