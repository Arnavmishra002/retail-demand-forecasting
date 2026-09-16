import { fmtMoney2, fmtPct } from '../lib/format'
import type { StoreMeta } from '../lib/types'

export interface FilterState {
  store: string
  category: string
  abc: string
  serviceLevel: number
  horizonDays: number
  stockoutPenalty: number
}

interface Props {
  state: FilterState
  stores: StoreMeta[]
  categories: string[]
  horizons: number[]
  onChange: (patch: Partial<FilterState>) => void
}

export default function Controls({ state, stores, categories, horizons, onChange }: Props) {
  return (
    <div className="card">
      <div className="controls">
        <div className="field">
          <label htmlFor="store">Store</label>
          <select
            id="store"
            value={state.store}
            onChange={(e) => onChange({ store: e.target.value })}
          >
            <option value="all">All stores ({stores.length})</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {s.format}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="category">Category</label>
          <select
            id="category"
            value={state.category}
            onChange={(e) => onChange({ category: e.target.value })}
          >
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="abc">ABC class</label>
          <select id="abc" value={state.abc} onChange={(e) => onChange({ abc: e.target.value })}>
            <option value="all">A + B + C</option>
            <option value="A">A — top 80% of revenue</option>
            <option value="B">B — next 15%</option>
            <option value="C">C — tail 5%</option>
          </select>
        </div>

        <div className="field">
          <label>
            Planning horizon
            <span className="val">{state.horizonDays} days</span>
          </label>
          <div className="seg">
            {horizons.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={state.horizonDays === h}
                onClick={() => onChange({ horizonDays: h })}
              >
                {h}d
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="service">
            Cycle service level
            <span className="val">{fmtPct(state.serviceLevel, 1)}</span>
          </label>
          <input
            id="service"
            type="range"
            min={0.5}
            max={0.995}
            step={0.005}
            value={state.serviceLevel}
            onChange={(e) => onChange({ serviceLevel: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="penalty">
            Stockout penalty / unit
            <span className="val">{fmtMoney2(state.stockoutPenalty)}</span>
          </label>
          <input
            id="penalty"
            type="range"
            min={1}
            max={40}
            step={0.5}
            value={state.stockoutPenalty}
            onChange={(e) => onChange({ stockoutPenalty: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  )
}
