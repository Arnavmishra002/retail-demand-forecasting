import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtInt, fmtMoney, fmtPct } from '../lib/format'
import { CLOSE_HOUR, OPEN_HOUR, fmtClock, intradayProgress } from '../lib/live'
import type { LiveState } from '../hooks/useLiveSim'
import type { SkuMeta, StoreMeta } from '../lib/types'
import { CardHead, TooltipCard } from './ChartBits'

interface Props {
  live: LiveState
  onToggle: () => void
  onReset: () => void
  /** total forecast units for day 1 across the series currently in scope */
  forecastToday: number
  skuMap: Map<string, SkuMeta>
  storeMap: Map<string, StoreMeta>
}

const STEP = 9  // simulated minutes per tick, matched to useLiveSim

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const rows = [
    { label: 'Expected by now', value: fmtInt(p.expected), color: 'var(--text-muted)' },
  ]
  if (p.actual != null) {
    rows.unshift({ label: 'Sold', value: fmtInt(p.actual), color: 'var(--teal)' })
    rows.push({
      label: 'Variance',
      value: `${p.actual - p.expected >= 0 ? '+' : ''}${fmtInt(p.actual - p.expected)}`,
      color: p.actual >= p.expected ? 'var(--teal)' : 'var(--red)',
    })
  }
  return <TooltipCard title={fmtClock(label)} rows={rows} />
}

export default function LiveFeed({
  live, onToggle, onReset, forecastToday, skuMap, storeMap,
}: Props) {
  const actualByMinute = new Map(live.path.map((p) => [p.minute, p.units]))
  const points: { minute: number; expected: number; actual?: number }[] = []
  for (let m = OPEN_HOUR * 60; m <= CLOSE_HOUR * 60; m += STEP) {
    points.push({
      minute: m,
      expected: forecastToday * intradayProgress(m),
      actual: actualByMinute.get(m),
    })
  }

  const expectedNow = forecastToday * intradayProgress(live.minute)
  const variance = expectedNow > 0 ? live.unitsToday / expectedNow - 1 : 0
  const tone = Math.abs(variance) < 0.05 ? 'ok' : variance > 0 ? 'cool' : 'bad'
  const dayLabel = live.day === 0 ? 'today' : `day +${live.day}`

  return (
    <div className="card">
      <CardHead
        title="Live point-of-sale feed"
        hint="Simulated transactions drawn from the same day-1 forecast, as an inhomogeneous Poisson process — aggregated over a full day they reproduce it. Sales decrement on-hand, so the exception queue below reacts as the day runs."
        right={
          <div className="live-controls">
            <span className={`chip ${live.running ? 'ok' : ''}`}>
              {live.running ? <i className="pulse" /> : null}
              {fmtClock(live.minute)} · {dayLabel}
            </span>
            <button type="button" className="chip btn" onClick={onToggle}>
              {live.running ? 'Pause' : 'Start feed'}
            </button>
            <button type="button" className="chip btn" onClick={onReset}>Reset</button>
          </div>
        }
      />

      <div className="live-grid">
        <div>
          <div className="live-stats">
            <div>
              <span className="label">Sold {dayLabel}</span>
              <span className="value">{fmtInt(live.unitsToday)}</span>
              <span className="sub">{fmtMoney(live.revenueToday)}</span>
            </div>
            <div>
              <span className="label">Expected by {fmtClock(live.minute)}</span>
              <span className="value">{fmtInt(expectedNow)}</span>
              <span className="sub">of {fmtInt(forecastToday)} forecast for the day</span>
            </div>
            <div>
              <span className="label">Pace vs plan</span>
              <span className={`value ${variance >= 0 ? 'up' : 'down'}`}>
                {variance >= 0 ? '+' : ''}{fmtPct(variance, 1)}
              </span>
              <span className={`chip ${tone}`}>
                {Math.abs(variance) < 0.05 ? 'on plan' : variance > 0 ? 'running hot' : 'running cold'}
              </span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={190}>
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="minute"
                type="number"
                domain={[OPEN_HOUR * 60, CLOSE_HOUR * 60]}
                tickFormatter={fmtClock}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                minTickGap={40}
              />
              <YAxis tickFormatter={(v) => fmtInt(v)} width={52} tickLine={false} axisLine={false} />
              <Tooltip content={<Tip />} />
              <Area
                dataKey="expected"
                stroke="var(--text-faint)"
                strokeDasharray="4 4"
                strokeWidth={1.4}
                fill="var(--text-faint)"
                fillOpacity={0.1}
                isAnimationActive={false}
              />
              <Line
                dataKey="actual"
                stroke="var(--teal)"
                strokeWidth={2.4}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="feed">
          {live.feed.length === 0 ? (
            <div className="feed-empty">
              Feed idle. Press <strong>Start feed</strong> to open the trading day.
            </div>
          ) : (
            live.feed.map((t) => (
              <div className="feed-row" key={t.id}>
                <span className="t">{fmtClock(t.minute)}</span>
                <span className="n">
                  {skuMap.get(t.sku)?.name ?? t.sku}
                  <em>{storeMap.get(t.store)?.name ?? t.store}</em>
                </span>
                <span className="u">×{t.units}</span>
                <span className="v">{fmtMoney(t.value)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
