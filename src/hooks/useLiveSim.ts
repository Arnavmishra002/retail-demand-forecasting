import { useCallback, useEffect, useRef, useState } from 'react'
import { CLOSE_HOUR, OPEN_HOUR, mulberry32, simulateTick, type Txn } from '../lib/live'
import type { Series } from '../lib/types'

/** Real milliseconds between ticks. */
const TICK_MS = 900
/** Simulated minutes advanced per tick -- a 14-hour trading day in ~90 seconds. */
const MINUTES_PER_TICK = 9
const FEED_LENGTH = 40

export interface LiveState {
  running: boolean
  minute: number
  day: number
  /** cumulative units sold today, keyed `store|sku` */
  soldToday: Map<string, number>
  unitsToday: number
  revenueToday: number
  /** cumulative units per tick for the intraday chart */
  path: { minute: number; units: number }[]
  feed: Txn[]
}

const emptyState = (): LiveState => ({
  running: false,
  minute: OPEN_HOUR * 60,
  day: 0,
  soldToday: new Map(),
  unitsToday: 0,
  revenueToday: 0,
  path: [{ minute: OPEN_HOUR * 60, units: 0 }],
  feed: [],
})

/**
 * Drives the point-of-sale simulation.
 *
 * The series list is held in a ref rather than a dependency so that changing a
 * filter re-scopes what is displayed without restarting the day or discarding
 * the sales already booked.
 */
export function useLiveSim(seriesList: Series[]) {
  const [state, setState] = useState<LiveState>(emptyState)
  const seriesRef = useRef(seriesList)
  const rndRef = useRef(mulberry32(Date.now() >>> 0))
  const idRef = useRef(1)

  seriesRef.current = seriesList

  const toggle = useCallback(() => setState((s) => ({ ...s, running: !s.running })), [])
  const reset = useCallback(() => {
    idRef.current = 1
    setState(emptyState)
  }, [])

  useEffect(() => {
    if (!state.running) return
    const handle = window.setInterval(() => {
      setState((prev) => {
        const from = prev.minute
        let to = from + MINUTES_PER_TICK

        // roll into the next trading day: stock stays where it is, the day resets
        if (to >= CLOSE_HOUR * 60) {
          const tail = simulateTick(
            seriesRef.current, from, CLOSE_HOUR * 60, rndRef.current, idRef.current,
          )
          idRef.current += tail.txns.length
          return {
            ...prev,
            minute: OPEN_HOUR * 60,
            day: prev.day + 1,
            soldToday: new Map(),
            unitsToday: 0,
            revenueToday: 0,
            path: [{ minute: OPEN_HOUR * 60, units: 0 }],
            feed: [...tail.txns.reverse(), ...prev.feed].slice(0, FEED_LENGTH),
          }
        }
        if (to > CLOSE_HOUR * 60) to = CLOSE_HOUR * 60

        const tick = simulateTick(
          seriesRef.current, from, to, rndRef.current, idRef.current,
        )
        idRef.current += tick.txns.length

        const soldToday = new Map(prev.soldToday)
        for (const [k, v] of tick.sold) soldToday.set(k, (soldToday.get(k) ?? 0) + v)
        const unitsToday = prev.unitsToday + tick.units

        return {
          ...prev,
          minute: to,
          soldToday,
          unitsToday,
          revenueToday: prev.revenueToday + tick.revenue,
          path: [...prev.path, { minute: to, units: unitsToday }],
          feed: [...tick.txns.reverse(), ...prev.feed].slice(0, FEED_LENGTH),
        }
      })
    }, TICK_MS)
    return () => window.clearInterval(handle)
  }, [state.running])

  return { state, toggle, reset }
}
