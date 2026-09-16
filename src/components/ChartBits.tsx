import type { ReactNode } from 'react'

export interface TipRow {
  label: string
  value: string
  color?: string
}

export function TooltipCard({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="tooltip">
      <div className="t-title">{title}</div>
      {rows.map((r) => (
        <div className="t-row" key={r.label}>
          <span style={{ color: r.color ?? 'var(--text-muted)' }}>{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className="swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function CardHead({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2>{title}</h2>
        {hint ? <p className="hint">{hint}</p> : null}
      </div>
      {right}
    </div>
  )
}
