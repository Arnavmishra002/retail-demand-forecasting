const money0 = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
})
const money2 = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const dec1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const fmtMoney = (v: number) => money0.format(v)
export const fmtMoney2 = (v: number) => money2.format(v)
export const fmtInt = (v: number) => int.format(v)
export const fmtDec = (v: number) => dec1.format(v)
export const fmtPct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`

/** Compact money for axis ticks: $1.2M, $84k, $310. */
export function fmtCompactMoney(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`
  return `$${Math.round(v)}`
}

export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fmtMonth(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}
