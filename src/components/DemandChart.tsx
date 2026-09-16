import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtDay, fmtInt } from '../lib/format'
import { CardHead, Legend, TooltipCard } from './ChartBits'

export interface DemandPoint {
  date: string
  actual?: number
  mean?: number
  band?: [number, number]
  promo?: number
}

interface Props {
  data: DemandPoint[]
  splitDate: string
  scopeLabel: string
}

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as DemandPoint
  const rows = []
  if (p.actual != null) rows.push({ label: 'Actual', value: fmtInt(p.actual), color: 'var(--text)' })
  if (p.mean != null) rows.push({ label: 'Forecast', value: fmtInt(p.mean), color: 'var(--accent)' })
  if (p.band) {
    rows.push({ label: '80% interval', value: `${fmtInt(p.band[0])} – ${fmtInt(p.band[1])}`, color: 'var(--text-muted)' })
  }
  if (p.promo) rows.push({ label: 'Promotion', value: 'planned', color: 'var(--amber)' })
  return <TooltipCard title={fmtDay(label)} rows={rows} />
}

export default function DemandChart({ data, splitDate, scopeLabel }: Props) {
  return (
    <div className="card">
      <CardHead
        title="Daily demand — actual and forecast"
        hint={`${scopeLabel} · 120 days of history, 28-day forward forecast with an 80% prediction interval`}
        right={<Legend items={[
          { color: 'var(--text-muted)', label: 'Actual' },
          { color: 'var(--accent)', label: 'Forecast' },
          { color: 'var(--accent-soft)', label: '80% interval' },
        ]} />}
      />
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDay}
            minTickGap={44}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
          />
          <YAxis
            tickFormatter={(v) => fmtInt(v)}
            width={56}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<Tip />} />
          <Area
            dataKey="band"
            stroke="none"
            fill="var(--accent)"
            fillOpacity={0.16}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            dataKey="actual"
            stroke="var(--text-muted)"
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="mean"
            stroke="var(--accent)"
            strokeWidth={2.2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <ReferenceLine
            x={splitDate}
            stroke="var(--border-strong)"
            strokeDasharray="4 4"
            label={{ value: 'today', position: 'insideTopRight', fill: 'var(--text-faint)', fontSize: 11 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
