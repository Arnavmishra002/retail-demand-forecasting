import { useEffect, useState } from 'react'
import Board from './components/Board'
import type { Dashboard } from './lib/types'

export default function App() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}dashboard.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Dashboard>
      })
      .then(setData)
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(String(e))
      })
    return () => controller.abort()
  }, [])

  if (error) {
    return (
      <div className="app">
        <div className="loading">
          Could not load <code>dashboard.json</code> — {error}.<br />
          Run <code>npm run pipeline</code> to regenerate it.
        </div>
      </div>
    )
  }
  if (!data) return <div className="app"><div className="loading">Loading forecasts…</div></div>
  return <Board data={data} />
}
