import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtCompactMoney, fmtMoney, fmtPct } from '../lib/format'
import { CardHead, Legend, TooltipCard } from './ChartBits'

export interface CurvePoint {
  level: number
  holding: number
  shortage: number
  ordering: number
  total: number
  fillRate: number
}

interface Props {
  curve: CurvePoint[]
  current: number
  optimum: CurvePoint | null
}

function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as CurvePoint
  return (
    <TooltipCard
      title={`${fmtPct(p.level, 1)} cycle service`}
      rows={[
        { label: 'Total cost', value: fmtMoney(p.total), color: 'var(--text)' },
        { label: 'Holding', value: fmtMoney(p.holding), color: 'var(--violet)' },
        { label: 'Shortage', value: fmtMoney(p.shortage), color: 'var(--red)' },
        { label: 'Ordering', value: fmtMoney(p.ordering), color: 'var(--text-muted)' },
        { label: 'Fill rate', value: fmtPct(p.fillRate, 2), color: 'var(--teal)' },
      ]}
    />
  )
}

export default function ServiceCurve({ curve, current, optimum }: Props) {
  const here = curve.reduce((best, p) =>
    Math.abs(p.level - current) < Math.abs(best.level - current) ? p : best, curve[0])

  return (
    <div className="card">
      <CardHead
        title="Service level vs annual cost"
        hint="Holding cost climbs with safety stock; shortage cost falls. The minimum of the sum is the economically correct service level — not 99%."
        right={<Legend items={[
          { color: 'var(--violet)', label: 'Holding' },
          { color: 'var(--red)', label: 'Shortage' },
          { color: 'var(--text)', label: 'Total' },
        ]} />}
      />
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={curve} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="level"
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            minTickGap={24}
          />
          <YAxis tickFormatter={fmtCompactMoney} width={56} tickLine={false} axisLine={false} />
          <Tooltip content={<Tip />} />
          <Area dataKey="holding" stackId="c" stroke="none" fill="var(--violet)" fillOpacity={0.25} isAnimationActive={false} />
          <Area dataKey="shortage" stackId="c" stroke="none" fill="var(--red)" fillOpacity={0.25} isAnimationActive={false} />
          <Area dataKey="ordering" stackId="c" stroke="none" fill="var(--text-faint)" fillOpacity={0.18} isAnimationActive={false} />
          <Line dataKey="total" stroke="var(--text)" strokeWidth={2.2} dot={false} isAnimationActive={false} />
          {optimum ? (
            <ReferenceDot x={optimum.level} y={optimum.total} r={5}
              fill="var(--teal)" stroke="var(--surface)" strokeWidth={2} isFront />
          ) : null}
          <ReferenceDot x={here.level} y={here.total} r={4}
            fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} isFront />
        </ComposedChart>
      </ResponsiveContainer>
      {optimum ? (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-muted)' }}>
          Cost-minimising service level is{' '}
          <strong style={{ color: 'var(--teal)' }}>{fmtPct(optimum.level, 1)}</strong>{' '}
          ({fmtMoney(optimum.total)}/yr). You are set to {fmtPct(here.level, 1)} —{' '}
          {here.total > optimum.total
            ? <>{fmtMoney(here.total - optimum.total)} above the minimum.</>
            : <>at the minimum.</>}
        </div>
      ) : null}
    </div>
  )
}
