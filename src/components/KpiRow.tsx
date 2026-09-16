import type { ReactNode } from 'react'

import { fmtInt, fmtMoney, fmtPct } from '../lib/format'
import type { NetworkRollup } from '../lib/inventory'

interface Props {
  roll: NetworkRollup
  horizonDays: number
  serviceLevel: number
  wape: number
  wapeNaive: number
  baselineCost: number
}

interface Kpi {
  label: string
  value: string
  delta: ReactNode
  tone?: 'teal' | 'amber' | 'red' | 'violet'
}

export default function KpiRow({
  roll, horizonDays, serviceLevel, wape, wapeNaive, baselineCost,
}: Props) {
  const saving = baselineCost - roll.totalCost
  const kpis: Kpi[] = [
    {
      label: `Forecast demand · ${horizonDays}d`,
      value: fmtInt(roll.horizonUnits),
      delta: <>units · <strong>{fmtMoney(roll.horizonRevenue)}</strong> at plan price</>,
    },
    {
      label: 'Projected fill rate',
      value: fmtPct(roll.fillRate, 1),
      delta: <>at <strong>{fmtPct(serviceLevel, 0)}</strong> cycle service target</>,
      tone: 'teal',
    },
    {
      label: 'Working capital held',
      value: fmtMoney(roll.workingCapital),
      delta: <>of which <strong>{fmtMoney(roll.safetyStockValue)}</strong> is safety stock</>,
      tone: 'violet',
    },
    {
      label: 'Annual policy cost',
      value: fmtMoney(roll.totalCost),
      delta: saving >= 0
        ? <><strong>{fmtMoney(Math.abs(saving))}</strong> below the 99% blanket policy</>
        : <><strong>{fmtMoney(Math.abs(saving))}</strong> above the 99% blanket policy</>,
      tone: saving >= 0 ? 'teal' : 'red',
    },
    {
      label: 'Lines needing action',
      value: fmtInt(roll.reorderLines + roll.expediteLines),
      delta: <><strong>{roll.expediteLines}</strong> expedite · <strong>{roll.overstockLines}</strong> overstocked</>,
      tone: roll.expediteLines > 0 ? 'red' : 'amber',
    },
    {
      label: 'Forecast error (WAPE)',
      value: fmtPct(wape, 1),
      delta: <><strong>{fmtPct((wapeNaive - wape) / wapeNaive, 0)}</strong> better than seasonal naive</>,
    },
  ]

  return (
    <div className="grid kpi">
      {kpis.map((k) => (
        <div className={`card kpi-card ${k.tone ?? ''}`} key={k.label}>
          <div className="rail" />
          <div className="label">{k.label}</div>
          <div className="value">{k.value}</div>
          <div className="delta">{k.delta}</div>
        </div>
      ))}
    </div>
  )
}
