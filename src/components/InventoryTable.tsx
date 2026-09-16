import { useMemo, useState } from 'react'
import { fmtDec, fmtInt, fmtMoney, fmtPct } from '../lib/format'
import type { AbcClass } from '../lib/inventory'
import type { Policy } from '../lib/inventory'
import type { SkuMeta, StoreMeta } from '../lib/types'
import { CardHead } from './ChartBits'

interface Props {
  policies: Policy[]
  skuMap: Map<string, SkuMeta>
  storeMap: Map<string, StoreMeta>
  abc: Map<string, AbcClass>
}

type SortKey =
  | 'name' | 'store' | 'mu' | 'sigma' | 'wape' | 'ss' | 'rop'
  | 'eoq' | 'onHand' | 'cover' | 'fill' | 'capital' | 'order'

const COLUMNS: { key: SortKey; label: string; left?: boolean; title: string }[] = [
  { key: 'name', label: 'SKU', left: true, title: 'Product and ABC class' },
  { key: 'store', label: 'Store', left: true, title: 'Selling location' },
  { key: 'mu', label: 'Demand /d', title: 'Mean forecast demand per day over the horizon' },
  { key: 'sigma', label: 'σ /d', title: 'Out-of-sample forecast error standard deviation per day' },
  { key: 'wape', label: 'WAPE', title: 'Backtested weighted absolute percentage error' },
  { key: 'ss', label: 'Safety stock', title: 'z · σ · √(lead time + review period)' },
  { key: 'rop', label: 'Reorder pt', title: 'Lead-time demand plus safety stock' },
  { key: 'eoq', label: 'Order qty', title: 'EOQ rounded up to the case pack' },
  { key: 'onHand', label: 'Position', title: 'On hand plus on order' },
  { key: 'cover', label: 'Cover', title: 'Days of supply at forecast demand' },
  { key: 'fill', label: 'Fill rate', title: 'Fraction of demand served from stock' },
  { key: 'capital', label: 'Capital', title: 'Inventory value at the average position' },
  { key: 'order', label: 'Suggested', title: 'Units to order now to reach the order-up-to level' },
]

function value(p: Policy, key: SortKey, skuMap: Map<string, SkuMeta>): number | string {
  switch (key) {
    case 'name': return skuMap.get(p.series.sku)?.name ?? p.series.sku
    case 'store': return p.series.store
    case 'mu': return p.muDaily
    case 'sigma': return p.sigmaDaily
    case 'wape': return p.series.wape
    case 'ss': return p.safetyStock
    case 'rop': return p.reorderPoint
    case 'eoq': return p.orderQty
    case 'onHand': return p.netPosition
    case 'cover': return p.daysOfCover
    case 'fill': return p.fillRate
    case 'capital': return p.inventoryValue
    case 'order': return p.suggestedOrder
  }
}

export default function InventoryTable({ policies, skuMap, storeMap, abc }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'capital', dir: -1 })
  const [limit, setLimit] = useState(25)

  const rows = useMemo(() => {
    const copy = [...policies]
    copy.sort((a, b) => {
      const va = value(a, sort.key, skuMap)
      const vb = value(b, sort.key, skuMap)
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb)) * sort.dir
      }
      return (va - vb) * sort.dir
    })
    return copy
  }, [policies, sort, skuMap])

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))

  return (
    <div className="card">
      <CardHead
        title="Replenishment policy by line"
        hint={`${policies.length} store × SKU lines in scope. Click any header to sort; every number recomputes from the service level and horizon above.`}
        right={
          <button
            type="button"
            className="chip"
            style={{ cursor: 'pointer' }}
            onClick={() => setLimit((l) => (l >= policies.length ? 25 : policies.length))}
          >
            {limit >= policies.length ? 'Show top 25' : `Show all ${policies.length}`}
          </button>
        }
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.left ? 'left' : ''}
                  title={c.title}
                  onClick={() => toggle(c.key)}
                >
                  {c.label}{sort.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p) => {
              const sku = skuMap.get(p.series.sku)
              const cls = abc.get(p.series.sku) ?? 'C'
              const tone = p.action === 'expedite' ? 'bad'
                : p.action === 'reorder' ? 'warn'
                : p.action === 'overstock' ? 'cool' : 'ok'
              return (
                <tr key={`${p.series.store}-${p.series.sku}`}>
                  <td className="left">
                    <div className="sku-cell">
                      <span className="name">{sku?.name ?? p.series.sku}</span>
                      <span className="sub">{p.series.sku} · {sku?.category} · class {cls}</span>
                    </div>
                  </td>
                  <td className="left">{storeMap.get(p.series.store)?.name ?? p.series.store}</td>
                  <td>{fmtDec(p.muDaily)}</td>
                  <td>{fmtDec(p.sigmaDaily)}</td>
                  <td>{fmtPct(p.series.wape, 0)}</td>
                  <td>{fmtInt(p.safetyStock)}</td>
                  <td>{fmtInt(p.reorderPoint)}</td>
                  <td>{fmtInt(p.orderQty)}</td>
                  <td>
                    <span className={`chip ${tone}`}>{fmtInt(p.netPosition)}</span>
                  </td>
                  <td>{p.daysOfCover > 180 ? '180+' : fmtDec(p.daysOfCover)}</td>
                  <td>{fmtPct(p.fillRate, 1)}</td>
                  <td>{fmtMoney(p.inventoryValue)}</td>
                  <td className="num-strong">
                    {p.suggestedOrder > 0 ? `+${fmtInt(p.suggestedOrder)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
