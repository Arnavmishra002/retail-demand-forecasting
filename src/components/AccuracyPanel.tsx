import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { fmtInt, fmtPct } from '../lib/format'
import type { CategoryAccuracy } from '../lib/types'
import { CardHead, TooltipCard } from './ChartBits'

function Tip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload as CategoryAccuracy
  return (
    <TooltipCard
      title={p.category}
      rows={[
        { label: 'Model WAPE', value: fmtPct(p.wape, 1), color: 'var(--accent)' },
        { label: 'Seasonal naive', value: fmtPct(p.wapeNaive, 1), color: 'var(--text-muted)' },
        { label: 'Bias', value: `${p.bias >= 0 ? '+' : ''}${fmtPct(p.bias, 1)}`, color: p.bias >= 0 ? 'var(--amber)' : 'var(--teal)' },
        { label: 'Annual units', value: fmtInt(p.units), color: 'var(--text-muted)' },
      ]}
    />
  )
}

export default function AccuracyPanel({ rows, backtest }: { rows: CategoryAccuracy[]; backtest: string }) {
  return (
    <div className="card">
      <CardHead
        title="Out-of-sample accuracy"
        hint={`${backtest}. Lower WAPE is better; the grey bar is what a planner gets for free.`}
      />
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="category" tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0} />
          <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} tickLine={false} axisLine={false} />
          <Tooltip content={<Tip />} cursor={{ fill: 'var(--surface-2)' }} />
          <Bar dataKey="wapeNaive" fill="var(--text-faint)" fillOpacity={0.45} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="wape" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.category} fill={r.wape < r.wapeNaive ? 'var(--accent)' : 'var(--red)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
