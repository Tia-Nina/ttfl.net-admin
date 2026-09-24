import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { formatTs } from '../hooks'
import type { HubEvent } from '../api/types'
import { Loading, Empty, ErrorBanner } from '../components/ui'

const TYPE_BADGES: Record<string, string> = {
  audit: 'badge-ghost',
  uptime: 'badge-info',
  deploy: 'badge-secondary',
  expiry: 'badge-warning',
  auth: 'badge-accent',
}

export default function Events() {
  const [type, setType] = useState('')
  const [events, setEvents] = useState<HubEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  async function load(reset = true) {
    setLoading(true)
    try {
      const last = reset ? 0 : (events[events.length - 1]?.id ?? 0)
      const q = new URLSearchParams({ limit: '50' })
      if (type) q.set('type', type)
      if (last) q.set('before_id', String(last))
      const r = await api<{ events: HubEvent[] }>(`/events?${q}`)
      setEvents((prev) => (reset ? r.events : [...prev, ...r.events]))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">事件审计</h1>
        <select className="select select-bordered select-sm w-36" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          <option value="audit">audit 操作审计</option>
          <option value="uptime">uptime 探活</option>
          <option value="deploy">deploy 部署</option>
          <option value="expiry">expiry 到期</option>
          <option value="auth">auth 认证</option>
        </select>
      </div>

      <ErrorBanner message={error} />
      {loading && events.length === 0 ? (
        <Loading />
      ) : events.length === 0 ? (
        <Empty text="暂无事件" />
      ) : (
        <div className="bg-base-100 rounded-box border border-base-300 divide-y divide-base-200">
          {events.map((e) => (
            <div key={e.id} className="px-4 py-3">
              <button className="w-full text-left" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className={`badge badge-sm ${TYPE_BADGES[e.type] ?? 'badge-ghost'}`}>{e.type}</span>
                  <span className="font-medium">{e.action}</span>
                  {e.target && <span className="opacity-60">{e.target}</span>}
                  <span className="ml-auto text-xs opacity-50">
                    {e.actor ?? 'system'} · {formatTs(e.ts)}
                  </span>
                </div>
              </button>
              {expanded === e.id && e.detail && (
                <pre className="mt-2 p-3 bg-base-200 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(JSON.parse(e.detail), null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && events.length >= 50 && (
        <div className="text-center">
          <button className="btn btn-sm" onClick={() => load(false)}>
            加载更多
          </button>
        </div>
      )}
    </div>
  )
}
