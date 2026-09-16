import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtCompactMoney, fmtMoney, fmtPct } from '../lib/format'
import { CardHead, Legend, TooltipCard } from './ChartBits'

export interface ParetoPoint {
  sku: string
  name: string
  revenue: number
  cumShare: number
  cls: 'A' | 'B' | 'C'
}

const CLASS_COLOR: Record<ParetoPoint['cls'], string> = {
  A: 'var(--accent)',
  B: 'var(--teal)',
  C: 'var(--text-faint)',
}

function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as ParetoPoint
  return (
    <TooltipCard
      title={`${p.name} · class ${p.cls}`}
      rows={[
        { label: 'Annual revenue', value: fmtMoney(p.revenue), color: 'var(--text)' },
        { label: 'Cumulative share', value: fmtPct(p.cumShare, 1), color: 'var(--amber)' },
      ]}
    />
  )
}

export default function AbcPanel({ data }: { data: ParetoPoint[] }) {
  return (
    <div className="card">
      <CardHead
        title="ABC concentration"
        hint="Revenue Pareto across the SKU range. Class A earns tight forecasting and frequent review; class C earns a bigger buffer and less attention."
        right={<Legend items={[
          { color: CLASS_COLOR.A, label: 'A · top 80%' },
          { color: CLASS_COLOR.B, label: 'B · next 15%' },
          { color: CLASS_COLOR.C, label: 'C · tail' },
        ]} />}
      />
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={data} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="sku" tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0} angle={-38} textAnchor="end" height={54} />
          <YAxis yAxisId="rev" tickFormatter={fmtCompactMoney} width={56} tickLine={false} axisLine={false} />
          <YAxis yAxisId="cum" orientation="right" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={40} tickLine={false} axisLine={false} />
          <Tooltip content={<Tip />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar yAxisId="rev" dataKey="revenue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.sku} fill={CLASS_COLOR[d.cls]} />)}
          </Bar>
          <Line yAxisId="cum" dataKey="cumShare" stroke="var(--amber)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <ReferenceLine yAxisId="cum" y={0.8} stroke="var(--border-strong)" strokeDasharray="4 4" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
