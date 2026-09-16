import { useMemo, useState } from 'react'

import AbcPanel, { type ParetoPoint } from './AbcPanel'
import AccuracyPanel from './AccuracyPanel'
import Alerts from './Alerts'
import Controls, { type FilterState } from './Controls'
import DemandChart, { type DemandPoint } from './DemandChart'
import InventoryTable from './InventoryTable'
import KpiRow from './KpiRow'
import ServiceCurve from './ServiceCurve'

import { abcClassify, buildPolicy, rollup, serviceLevelCurve } from '../lib/inventory'
import { fmtInt } from '../lib/format'
import type { Dashboard } from '../lib/types'

const HORIZONS = [7, 14, 28]
const CURVE_LEVELS = Array.from({ length: 31 }, (_, i) => 0.5 + (i * (0.995 - 0.5)) / 30)

export default function Board({ data }: { data: Dashboard }) {
  const [state, setState] = useState<FilterState>({
    store: 'all',
    category: 'all',
    abc: 'all',
    serviceLevel: 0.95,
    horizonDays: 28,
    stockoutPenalty: 9,
  })

  const skuMap = useMemo(() => new Map(data.skus.map((s) => [s.sku, s])), [data])
  const storeMap = useMemo(() => new Map(data.stores.map((s) => [s.id, s])), [data])
  const categories = useMemo(
    () => [...new Set(data.skus.map((s) => s.category))].sort(), [data],
  )
  const abc = useMemo(() => abcClassify(data.series), [data])

  const scoped = useMemo(() => data.series.filter((s) => {
    if (state.store !== 'all' && s.store !== state.store) return false
    if (state.category !== 'all' && skuMap.get(s.sku)?.category !== state.category) return false
    if (state.abc !== 'all' && abc.get(s.sku) !== state.abc) return false
    return true
  }), [data, state.store, state.category, state.abc, skuMap, abc])

  const policyInput = useMemo(() => ({
    serviceLevel: state.serviceLevel,
    horizonDays: state.horizonDays,
    stockoutPenalty: state.stockoutPenalty,
  }), [state.serviceLevel, state.horizonDays, state.stockoutPenalty])

  const policies = useMemo(
    () => scoped.map((s) => buildPolicy(s, policyInput)), [scoped, policyInput],
  )
  const roll = useMemo(() => rollup(policies, state.horizonDays), [policies, state.horizonDays])

  // What a blanket "99% everywhere" policy costs -- the common planner default,
  // and the number the tuned policy has to beat to be worth adopting.
  const baselineCost = useMemo(() => rollup(
    scoped.map((s) => buildPolicy(s, { ...policyInput, serviceLevel: 0.99 })),
    state.horizonDays,
  ).totalCost, [scoped, policyInput, state.horizonDays])

  const curve = useMemo(
    () => serviceLevelCurve(scoped, policyInput, CURVE_LEVELS), [scoped, policyInput],
  )
  const optimum = useMemo(
    () => curve.reduce<null | (typeof curve)[number]>(
      (best, p) => (best === null || p.total < best.total ? p : best), null),
    [curve],
  )

  const chart: DemandPoint[] = useMemo(() => {
    const histDates = data.totals.dates.slice(-data.histTail)
    const n = histDates.length
    const actual = new Array<number>(n).fill(0)
    for (const s of scoped) {
      for (let i = 0; i < n; i++) actual[i] += s.hist[i] ?? 0
    }

    const h = data.horizon
    const mean = new Array<number>(h).fill(0)
    const varLo = new Array<number>(h).fill(0)
    const varHi = new Array<number>(h).fill(0)
    const promo = new Array<number>(h).fill(0)
    for (const s of scoped) {
      for (let i = 0; i < h; i++) {
        mean[i] += s.fc[i]
        // independent series: variances add, interval widths do not
        varLo[i] += (s.fc[i] - s.lo[i]) ** 2
        varHi[i] += (s.hi[i] - s.fc[i]) ** 2
        promo[i] += s.promoPlan[i]
      }
    }

    const points: DemandPoint[] = histDates.map((date, i) => ({ date, actual: actual[i] }))
    if (points.length) {
      // pin the forecast to the last actual so the two lines join cleanly
      const last = points[points.length - 1]
      last.mean = last.actual
      last.band = [last.actual!, last.actual!]
    }
    for (let i = 0; i < h; i++) {
      points.push({
        date: data.forecastDates[i],
        mean: mean[i],
        band: [Math.max(0, mean[i] - Math.sqrt(varLo[i])), mean[i] + Math.sqrt(varHi[i])],
        promo: promo[i],
      })
    }
    return points
  }, [data, scoped])

  const pareto: ParetoPoint[] = useMemo(() => {
    const bySku = new Map<string, number>()
    for (const s of scoped) bySku.set(s.sku, (bySku.get(s.sku) ?? 0) + s.annualRevenue)
    const sorted = [...bySku.entries()].sort((a, b) => b[1] - a[1])
    const total = sorted.reduce((a, [, v]) => a + v, 0) || 1
    let cum = 0
    return sorted.map(([sku, revenue]) => {
      cum += revenue
      return {
        sku,
        name: skuMap.get(sku)?.name ?? sku,
        revenue,
        cumShare: cum / total,
        cls: abc.get(sku) ?? 'C',
      }
    })
  }, [scoped, skuMap, abc])

  const scopeLabel = [
    state.store === 'all' ? 'All stores' : storeMap.get(state.store)?.name,
    state.category === 'all' ? 'all categories' : state.category,
    state.abc === 'all' ? null : `class ${state.abc}`,
  ].filter(Boolean).join(' · ')

  const patch = (p: Partial<FilterState>) => setState((s) => ({ ...s, ...p }))
  const lastActual = data.totals.dates[data.totals.dates.length - 1]

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Retail Demand Forecasting &amp; Inventory Optimization</h1>
          <p className="sub">
            {fmtInt(data.series.length)} store × SKU lines · {data.horizon}-day forecast ·
            {' '}safety stock, reorder points and EOQ recomputed live from the demand distribution
          </p>
          <div className="badge-row">
            <span className="chip cool">{data.stores.length} stores</span>
            <span className="chip cool">{data.skus.length} SKUs</span>
            <span className="chip ok">WAPE {(data.accuracy.wape * 100).toFixed(1)}%</span>
            <span className="chip ok">
              {(data.accuracy.liftVsNaive * 100).toFixed(0)}% better than seasonal naive
            </span>
          </div>
        </div>
        <div className="meta">
          history through {lastActual}<br />
          pipeline run {data.generatedAt}
        </div>
      </header>

      <div className="section">
        <Controls
          state={state}
          stores={data.stores}
          categories={categories}
          horizons={HORIZONS}
          onChange={patch}
        />
      </div>

      <div className="section">
        <KpiRow
          roll={roll}
          horizonDays={state.horizonDays}
          serviceLevel={state.serviceLevel}
          wape={data.accuracy.wape}
          wapeNaive={data.accuracy.wapeNaive}
          baselineCost={baselineCost}
        />
      </div>

      <div className="grid main section">
        <DemandChart data={chart} splitDate={lastActual} scopeLabel={scopeLabel} />
        <Alerts policies={policies} skuMap={skuMap} storeMap={storeMap} />
      </div>

      <div className="grid two section">
        <ServiceCurve curve={curve} current={state.serviceLevel} optimum={optimum} />
        <AccuracyPanel rows={data.accuracy.byCategory} backtest={data.backtest} />
      </div>

      <div className="section">
        <AbcPanel data={pareto} />
      </div>

      <div className="section">
        <InventoryTable policies={policies} skuMap={skuMap} storeMap={storeMap} abc={abc} />
      </div>

      <p className="footnote">
        Demand is modelled with ridge regression on calendar, price and promotion features and
        validated by rolling-origin backtest against a seasonal-naive benchmark
        (<code>pipeline/forecast.py</code>). Inventory policy uses a continuous-review (s, Q)
        system with a periodic-review order-up-to overlay; fill rate comes from the unit normal
        loss function rather than being assumed equal to the cycle service level
        (<code>src/lib/inventory.ts</code>). The underlying transaction data is synthetic and
        generated by <code>pipeline/generate_data.py</code>.
      </p>
    </div>
  )
}
