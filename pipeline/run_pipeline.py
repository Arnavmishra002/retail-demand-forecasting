"""End-to-end offline pipeline.

    generate panel -> backtest + forecast every store x SKU series
    -> pack a single JSON payload the static dashboard reads at load time.

The inventory *policy* maths deliberately does NOT live here -- it lives in
``src/lib/inventory.ts`` so the dashboard can recompute safety stock, reorder
points and cost trade-offs live as the planner drags the service-level slider.
This script only ships the demand distribution those formulas need.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from forecast import BACKTEST_FOLDS, HORIZON, forecast_series  # noqa: E402
from generate_data import SKUS, STORES, build_panel, holiday_factor  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "public" / "dashboard.json"
HIST_TAIL = 120          # days of per-series history shipped to the browser
PLAN_SEED = 909

# Supply-side parameters per SKU: lead time (days), order cost ($/PO),
# annual holding rate (fraction of unit cost), case pack, review period (days).
SUPPLY = {
    "Beverages":   dict(lead_time=7,  order_cost=120.0, holding_rate=0.24, case_pack=12, review=7),
    "Snacks":      dict(lead_time=5,  order_cost=95.0,  holding_rate=0.22, case_pack=24, review=7),
    "Household":   dict(lead_time=12, order_cost=180.0, holding_rate=0.18, case_pack=6,  review=14),
    "Seasonal":    dict(lead_time=21, order_cost=240.0, holding_rate=0.28, case_pack=6,  review=14),
    "Electronics": dict(lead_time=28, order_cost=310.0, holding_rate=0.20, case_pack=4,  review=14),
}


def forward_plan(panel: pd.DataFrame, rng: np.random.Generator) -> dict:
    """A 28-day forward promo/price calendar -- known to the planner in advance."""
    start = panel["date"].max() + pd.Timedelta(days=1)
    dates = pd.date_range(start, periods=HORIZON, freq="D")
    holiday = np.array([holiday_factor(d) != 1.0 for d in dates]).astype(int)

    plans = {}
    for store_id, *_ in STORES:
        for sku, _n, _c, price, *_ in SKUS:
            promo = np.zeros(HORIZON)
            if rng.random() < 0.55:
                s = int(rng.integers(0, HORIZON - 5))
                promo[s:s + int(rng.integers(3, 7))] = 1.0
            disc = np.where(promo > 0, rng.uniform(0.15, 0.30), 0.0)
            plans[(store_id, sku)] = pd.DataFrame(
                {"date": dates, "price": np.round(price * (1 - disc), 2),
                 "promo": promo.astype(int), "holiday": holiday}
            )
    return plans, dates


def main() -> None:
    t_start = time.time()
    print("[1/4] generating demand panel ...", flush=True)
    panel = build_panel()
    t0 = panel["date"].min()
    rng = np.random.default_rng(PLAN_SEED)
    plans, fdates = forward_plan(panel, rng)

    sku_meta = {s[0]: dict(sku=s[0], name=s[1], category=s[2], list_price=s[3], unit_cost=s[4])
                for s in SKUS}
    store_meta = {s[0]: dict(id=s[0], name=s[1], format=s[2]) for s in STORES}

    n_series = len(STORES) * len(SKUS)
    print(f"[2/4] backtesting + forecasting {n_series} series "
          f"(rolling origin, {BACKTEST_FOLDS} x {HORIZON}d) ...", flush=True)
    grouped = dict(list(panel.groupby(["store_id", "sku"], sort=False)))

    series_out: list[dict] = []
    inv_rng = np.random.default_rng(PLAN_SEED + 1)

    for i, ((store_id, sku), g) in enumerate(grouped.items(), 1):
        g = g.sort_values("date").reset_index(drop=True)
        fc = forecast_series(g, plans[(store_id, sku)], t0)

        hist = g["units"].to_numpy().astype(float)[-HIST_TAIL:]
        meta = sku_meta[sku]
        sup = SUPPLY[meta["category"]]

        lt_demand = float(fc.mean[: sup["lead_time"]].sum())
        # A plausible *current* position so the board shows real exceptions:
        # some lines are already below their reorder point, some are bloated.
        on_hand = float(np.round(lt_demand * inv_rng.uniform(0.35, 2.4) + inv_rng.uniform(0, 12)))
        on_order = float(np.round(lt_demand * inv_rng.uniform(0.0, 0.6))) if inv_rng.random() < 0.4 else 0.0

        series_out.append({
            "store": store_id, "sku": sku,
            "hist": [round(float(v), 1) for v in hist],
            "fc": [round(float(v), 2) for v in fc.mean],
            "lo": [round(float(v), 2) for v in fc.lower],
            "hi": [round(float(v), 2) for v in fc.upper],
            "promoPlan": [int(v) for v in plans[(store_id, sku)]["promo"]],
            "sigma": round(fc.sigma, 3),
            "wape": round(fc.wape_model, 4),
            "wapeNaive": round(fc.wape_naive, 4),
            "smape": round(fc.smape_model, 4),
            "bias": round(fc.bias_model, 4),
            "avgPrice": round(float(g["price"].tail(90).mean()), 2),
            "unitCost": meta["unit_cost"],
            "listPrice": meta["list_price"],
            "annualUnits": round(float(g["units"].tail(365).sum()), 1),
            "annualRevenue": round(float(g["revenue"].tail(365).sum()), 2),
            "onHand": on_hand,
            "onOrder": on_order,
            "leadTime": sup["lead_time"],
            "orderCost": sup["order_cost"],
            "holdingRate": sup["holding_rate"],
            "casePack": sup["case_pack"],
            "reviewPeriod": sup["review"],
        })

        if i % 15 == 0:
            print(f"      {i}/{len(grouped)} series", flush=True)

    print("[3/4] aggregating network totals ...", flush=True)
    daily = panel.groupby("date", as_index=False).agg(units=("units", "sum"),
                                                      revenue=("revenue", "sum"),
                                                      margin=("margin", "sum"))
    fc_matrix = np.array([s["fc"] for s in series_out])
    lo_matrix = np.array([s["lo"] for s in series_out])
    hi_matrix = np.array([s["hi"] for s in series_out])

    # weighted accuracy: weight each series' WAPE by its demand volume
    weights = np.array([s["annualUnits"] for s in series_out])
    w_model = float(np.average([s["wape"] for s in series_out], weights=weights))
    w_naive = float(np.average([s["wapeNaive"] for s in series_out], weights=weights))

    by_cat = {}
    for s in series_out:
        cat = sku_meta[s["sku"]]["category"]
        by_cat.setdefault(cat, {"w": [], "m": [], "n": [], "b": []})
        by_cat[cat]["w"].append(s["annualUnits"])
        by_cat[cat]["m"].append(s["wape"])
        by_cat[cat]["n"].append(s["wapeNaive"])
        by_cat[cat]["b"].append(s["bias"])

    accuracy = {
        "wape": round(w_model, 4),
        "wapeNaive": round(w_naive, 4),
        "liftVsNaive": round((w_naive - w_model) / w_naive, 4),
        "byCategory": [
            {
                "category": c,
                "wape": round(float(np.average(v["m"], weights=v["w"])), 4),
                "wapeNaive": round(float(np.average(v["n"], weights=v["w"])), 4),
                "bias": round(float(np.average(v["b"], weights=v["w"])), 4),
                "units": int(sum(v["w"])),
            }
            for c, v in sorted(by_cat.items())
        ],
    }

    payload = {
        "generatedAt": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "horizon": HORIZON,
        "histTail": HIST_TAIL,
        "backtest": "rolling origin, 3 folds x 28 days, seasonal-naive benchmark",
        "stores": list(store_meta.values()),
        "skus": [
            {**sku_meta[s[0]], **{k: SUPPLY[s[2]][k] for k in
                                  ("lead_time", "order_cost", "holding_rate", "case_pack", "review")}}
            for s in SKUS
        ],
        "totals": {
            "dates": [d.strftime("%Y-%m-%d") for d in daily["date"]],
            "units": [int(v) for v in daily["units"]],
            "revenue": [round(float(v), 2) for v in daily["revenue"]],
            "margin": [round(float(v), 2) for v in daily["margin"]],
        },
        "forecastDates": [d.strftime("%Y-%m-%d") for d in fdates],
        "networkForecast": {
            "mean": [round(float(v), 1) for v in fc_matrix.sum(axis=0)],
            # independent-series aggregation: variances add, not interval widths
            "lo": [round(float(v), 1) for v in
                   fc_matrix.sum(axis=0) - np.sqrt((((fc_matrix - lo_matrix) ** 2)).sum(axis=0))],
            "hi": [round(float(v), 1) for v in
                   fc_matrix.sum(axis=0) + np.sqrt((((hi_matrix - fc_matrix) ** 2)).sum(axis=0))],
        },
        "accuracy": accuracy,
        "series": series_out,
    }

    print("[4/4] writing", OUT, flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    size_kb = OUT.stat().st_size / 1024
    print(f"done in {time.time() - t_start:.1f}s  |  {size_kb:.0f} KB  |  "
          f"WAPE {accuracy['wape']:.3f} vs naive {accuracy['wapeNaive']:.3f} "
          f"({accuracy['liftVsNaive'] * 100:.1f}% better)")


if __name__ == "__main__":
    main()
