/**
 * Live point-of-sale simulation.
 *
 * The forecast payload is a daily plan; a planner watching a screen wants to
 * know whether *today* is tracking it. This module turns day-1 of the forecast
 * into a stream of individual transactions so the board can answer that in real
 * time: units sell, on-hand falls, and lines cross their reorder point while you
 * watch.
 *
 * The arrival process is an inhomogeneous Poisson process. Each store × SKU has
 * a daily rate from the forecast; that rate is spread over trading hours by a
 * shared intraday curve, and each tick draws Poisson counts for the slice of the
 * day it covers. Aggregating the tick counts over a full day reproduces the
 * daily forecast in expectation -- the live view and the plan are the same model.
 */

import type { Series } from './types'

export const OPEN_HOUR = 8
export const CLOSE_HOUR = 22

/** Share of a day's demand falling in each hour 0-23. Sums to 1 over trading hours. */
const INTRADAY_SHAPE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  0.024, 0.041, 0.058, 0.077, 0.092, 0.088, 0.074, 0.068,
  0.072, 0.089, 0.108, 0.096, 0.063, 0.038, 0.012, 0,
]

const SHAPE_TOTAL = INTRADAY_SHAPE.reduce((a, b) => a + b, 0)

/** Cumulative share of the day's demand completed by `minuteOfDay`. */
export function intradayProgress(minuteOfDay: number): number {
  const hour = Math.floor(minuteOfDay / 60)
  const frac = (minuteOfDay % 60) / 60
  let acc = 0
  for (let h = 0; h < Math.min(hour, 24); h++) acc += INTRADAY_SHAPE[h]
  if (hour < 24) acc += INTRADAY_SHAPE[hour] * frac
  return acc / SHAPE_TOTAL
}

/** Small, fast, seedable PRNG so a session can be replayed if needed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Knuth for small means, normal approximation above ~30 to keep ticks cheap. */
export function poisson(lambda: number, rnd: () => number): number {
  if (lambda <= 0) return 0
  if (lambda < 30) {
    const limit = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= rnd()
    } while (p > limit)
    return k - 1
  }
  const z = Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd())
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z))
}

export interface Txn {
  id: number
  store: string
  sku: string
  units: number
  value: number
  minute: number
}

export interface TickResult {
  txns: Txn[]
  /** units sold this tick, keyed `store|sku` */
  sold: Map<string, number>
  units: number
  revenue: number
}

/**
 * Draw the transactions falling in (fromMinute, toMinute] of the trading day.
 * `nextId` keeps feed rows stably keyed across ticks.
 */
export function simulateTick(
  seriesList: Series[],
  fromMinute: number,
  toMinute: number,
  rnd: () => number,
  nextId: number,
): TickResult {
  const share = intradayProgress(toMinute) - intradayProgress(fromMinute)
  const txns: Txn[] = []
  const sold = new Map<string, number>()
  let units = 0
  let revenue = 0
  let id = nextId

  if (share <= 0) return { txns, sold, units, revenue }

  for (const s of seriesList) {
    const lambda = s.fc[0] * share
    const n = poisson(lambda, rnd)
    if (n <= 0) continue
    const key = `${s.store}|${s.sku}`
    sold.set(key, (sold.get(key) ?? 0) + n)
    units += n
    revenue += n * s.avgPrice
    // one feed row per store x SKU per tick, not per unit -- a basket, not a beep
    txns.push({
      id: id++,
      store: s.store,
      sku: s.sku,
      units: n,
      value: n * s.avgPrice,
      minute: toMinute,
    })
  }

  return { txns, sold, units, revenue }
}

export const fmtClock = (minuteOfDay: number): string => {
  const h = Math.floor(minuteOfDay / 60) % 24
  const m = Math.floor(minuteOfDay % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
