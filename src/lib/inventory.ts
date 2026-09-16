/**
 * Inventory policy mathematics.
 *
 * Everything here is pure and synchronous so the dashboard can recompute the
 * whole network's policy on every slider movement. The model is the standard
 * continuous-review (s, Q) system with a periodic-review order-up-to overlay:
 *
 *   safety stock  SS = z(alpha) * sigma_d * sqrt(L + R)
 *   reorder point  s = mu_d * L + SS
 *   order quantity Q = EOQ = sqrt(2 D S / H),  H = holding_rate * unit_cost
 *   order-up-to    S = mu_d * (L + R) + SS
 *
 * Fill rate is computed from the unit normal loss function rather than assumed
 * equal to the cycle service level -- those two are routinely confused, and the
 * gap between them is exactly where over-stocking hides.
 */

import type { Series } from './types'

/** Inverse standard normal CDF (Acklam's rational approximation, |err| < 1.15e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
             3.754408661907416]
  const pLow = 0.02425
  let q: number, r: number
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pLow) {
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  q = p - 0.5
  r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export const normPdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)

/** Standard normal CDF via the Abramowitz-Stegun 7.1.26 error function. */
export function normCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/** Unit normal loss function G(z) = phi(z) - z * (1 - Phi(z)): expected shortfall. */
export const unitNormalLoss = (z: number) => normPdf(z) - z * (1 - normCdf(z))

export interface PolicyInput {
  serviceLevel: number      // cycle service level alpha, e.g. 0.95
  horizonDays: number       // planning horizon used for demand aggregation
  stockoutPenalty: number   // $ cost per unit short (lost margin + goodwill)
}

export interface Policy {
  series: Series
  /** mean daily demand over the forecast horizon */
  muDaily: number
  /** forecast-error std dev per day, out-of-sample */
  sigmaDaily: number
  /** protection interval = lead time + review period */
  protection: number
  safetyStock: number
  reorderPoint: number
  orderUpTo: number
  eoq: number
  /** EOQ rounded up to the supplier case pack -- what actually gets ordered */
  orderQty: number
  annualDemand: number
  /** achieved fill rate (fraction of demand served from stock) */
  fillRate: number
  expectedShortUnits: number      // per replenishment cycle
  cyclesPerYear: number
  holdingCost: number             // $/yr
  orderingCost: number            // $/yr
  shortageCost: number            // $/yr
  totalCost: number               // $/yr
  inventoryValue: number          // $ tied up at the average position
  daysOfCover: number
  netPosition: number             // on hand + on order
  action: 'reorder' | 'expedite' | 'overstock' | 'ok'
  suggestedOrder: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function buildPolicy(s: Series, input: PolicyInput): Policy {
  const h = Math.min(input.horizonDays, s.fc.length)
  const muDaily = s.fc.slice(0, h).reduce((a, b) => a + b, 0) / h
  const sigmaDaily = Math.max(s.sigma, 0.25)
  const protection = s.leadTime + s.reviewPeriod

  const z = normInv(clamp(input.serviceLevel, 0.5, 0.9999))
  const sigmaProtection = sigmaDaily * Math.sqrt(protection)
  const safetyStock = z * sigmaProtection
  const reorderPoint = muDaily * s.leadTime + safetyStock
  const orderUpTo = muDaily * protection + safetyStock

  const annualDemand = muDaily * 365
  const holdingPerUnit = s.holdingRate * s.unitCost
  const eoq = Math.sqrt((2 * annualDemand * s.orderCost) / Math.max(holdingPerUnit, 1e-6))
  const orderQty = Math.max(s.casePack, Math.ceil(eoq / s.casePack) * s.casePack)

  const expectedShortUnits = sigmaProtection * unitNormalLoss(z)
  const cyclesPerYear = annualDemand / orderQty
  const fillRate = clamp(1 - expectedShortUnits / orderQty, 0, 1)

  const holdingCost = (safetyStock + orderQty / 2) * holdingPerUnit
  const orderingCost = cyclesPerYear * s.orderCost
  const shortageCost = expectedShortUnits * cyclesPerYear * input.stockoutPenalty
  const totalCost = holdingCost + orderingCost + shortageCost

  const netPosition = s.onHand + s.onOrder
  const daysOfCover = muDaily > 0 ? netPosition / muDaily : 999
  const inventoryValue = (safetyStock + orderQty / 2) * s.unitCost

  let action: Policy['action'] = 'ok'
  if (netPosition < muDaily * s.leadTime) action = 'expedite'
  else if (netPosition <= reorderPoint) action = 'reorder'
  else if (netPosition > orderUpTo + orderQty) action = 'overstock'

  const gap = orderUpTo - netPosition
  const suggestedOrder = gap > 0
    ? Math.ceil(Math.max(gap, orderQty) / s.casePack) * s.casePack
    : 0

  return {
    series: s, muDaily, sigmaDaily, protection, safetyStock, reorderPoint,
    orderUpTo, eoq, orderQty, annualDemand, fillRate, expectedShortUnits,
    cyclesPerYear, holdingCost, orderingCost, shortageCost, totalCost,
    inventoryValue, daysOfCover, netPosition, action,
    suggestedOrder: action === 'ok' || action === 'overstock' ? 0 : suggestedOrder,
  }
}

export interface NetworkRollup {
  policies: Policy[]
  horizonUnits: number
  horizonRevenue: number
  fillRate: number
  safetyStockValue: number
  workingCapital: number
  totalCost: number
  holdingCost: number
  orderingCost: number
  shortageCost: number
  reorderLines: number
  expediteLines: number
  overstockLines: number
  openOrderValue: number
}

export function rollup(policies: Policy[], horizonDays: number): NetworkRollup {
  let horizonUnits = 0, horizonRevenue = 0, demandW = 0, fillW = 0
  let safetyStockValue = 0, workingCapital = 0
  let holdingCost = 0, orderingCost = 0, shortageCost = 0, openOrderValue = 0
  let reorderLines = 0, expediteLines = 0, overstockLines = 0

  for (const p of policies) {
    const h = Math.min(horizonDays, p.series.fc.length)
    const units = p.series.fc.slice(0, h).reduce((a, b) => a + b, 0)
    horizonUnits += units
    horizonRevenue += units * p.series.avgPrice
    demandW += p.annualDemand
    fillW += p.fillRate * p.annualDemand
    safetyStockValue += p.safetyStock * p.series.unitCost
    workingCapital += p.inventoryValue
    holdingCost += p.holdingCost
    orderingCost += p.orderingCost
    shortageCost += p.shortageCost
    openOrderValue += p.suggestedOrder * p.series.unitCost
    if (p.action === 'reorder') reorderLines++
    if (p.action === 'expedite') expediteLines++
    if (p.action === 'overstock') overstockLines++
  }

  return {
    policies, horizonUnits, horizonRevenue,
    fillRate: demandW > 0 ? fillW / demandW : 0,
    safetyStockValue, workingCapital,
    totalCost: holdingCost + orderingCost + shortageCost,
    holdingCost, orderingCost, shortageCost,
    reorderLines, expediteLines, overstockLines, openOrderValue,
  }
}

/** Cost of the whole network as a function of service level -- the trade-off curve. */
export function serviceLevelCurve(
  seriesList: Series[], input: PolicyInput, levels: number[],
): { level: number; holding: number; shortage: number; ordering: number; total: number; fillRate: number }[] {
  return levels.map((level) => {
    const r = rollup(seriesList.map((s) => buildPolicy(s, { ...input, serviceLevel: level })),
                     input.horizonDays)
    return {
      level,
      holding: r.holdingCost,
      shortage: r.shortageCost,
      ordering: r.orderingCost,
      total: r.totalCost,
      fillRate: r.fillRate,
    }
  })
}

export type AbcClass = 'A' | 'B' | 'C'

/** Pareto classification by annual revenue: 80% / 15% / 5% of cumulative value. */
export function abcClassify(seriesList: Series[]): Map<string, AbcClass> {
  const bySku = new Map<string, number>()
  for (const s of seriesList) {
    bySku.set(s.sku, (bySku.get(s.sku) ?? 0) + s.annualRevenue)
  }
  const sorted = [...bySku.entries()].sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((a, [, v]) => a + v, 0)
  const out = new Map<string, AbcClass>()
  let cum = 0
  for (const [sku, v] of sorted) {
    cum += v
    const share = total > 0 ? cum / total : 1
    out.set(sku, share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C')
  }
  return out
}
