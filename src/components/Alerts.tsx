import { fmtDec, fmtInt, fmtMoney } from '../lib/format'
import type { Policy } from '../lib/inventory'
import type { SkuMeta, StoreMeta } from '../lib/types'
import { CardHead } from './ChartBits'

interface Props {
  policies: Policy[]
  skuMap: Map<string, SkuMeta>
  storeMap: Map<string, StoreMeta>
}

const RANK: Record<Policy['action'], number> = { expedite: 0, reorder: 1, overstock: 2, ok: 3 }

export default function Alerts({ policies, skuMap, storeMap }: Props) {
  const flagged = policies
    .filter((p) => p.action !== 'ok')
    .sort((a, b) => {
      const r = RANK[a.action] - RANK[b.action]
      if (r !== 0) return r
      return b.series.annualRevenue - a.series.annualRevenue
    })
    .slice(0, 12)

  const exposure = policies
    .filter((p) => p.action === 'expedite')
    .reduce((acc, p) => acc + p.muDaily * p.series.leadTime * (p.series.avgPrice - p.series.unitCost), 0)

  return (
    <div className="card">
      <CardHead
        title="Exception queue"
        hint={flagged.length
          ? `${flagged.length} of ${policies.length} lines shown, worst first. Margin at risk on expedites: ${fmtMoney(exposure)}.`
          : 'Every line in scope is inside its policy band.'}
      />
      <div className="alert-list">
        {flagged.map((p) => {
          const sku = skuMap.get(p.series.sku)
          const store = storeMap.get(p.series.store)
          const tone = p.action === 'expedite' ? 'bad' : p.action === 'reorder' ? 'warn' : 'cool'
          const why = p.action === 'expedite'
            ? `${fmtDec(p.daysOfCover)}d cover vs ${p.series.leadTime}d lead time — will stock out before the PO lands`
            : p.action === 'reorder'
              ? `position ${fmtInt(p.netPosition)} at or below reorder point ${fmtInt(p.reorderPoint)}`
              : `position ${fmtInt(p.netPosition)} vs order-up-to ${fmtInt(p.orderUpTo)} — ${fmtMoney((p.netPosition - p.orderUpTo) * p.series.unitCost)} idle`
          return (
            <div className="alert" key={`${p.series.store}-${p.series.sku}`}>
              <span className={`chip ${tone}`}>{p.action}</span>
              <div>
                <div className="who">{sku?.name ?? p.series.sku} · {store?.name ?? p.series.store}</div>
                <div className="why">{why}</div>
              </div>
              <div className="qty">
                {p.suggestedOrder > 0
                  ? <>+{fmtInt(p.suggestedOrder)}<br /><span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>units</span></>
                  : <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>hold</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
