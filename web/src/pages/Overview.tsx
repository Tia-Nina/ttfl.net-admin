import { Link } from 'react-router-dom'
import { useApiData, timeAgo, formatTs } from '../hooks'
import type { Overview } from '../api/types'
import { UpBadge, Loading, Empty, ErrorBanner } from '../components/ui'

export default function Overview() {
  const { data, error, loading } = useApiData<Overview>('/overview')

  if (loading) return <Loading />
  if (error) return <ErrorBanner message={error} />
  if (!data) return null

  const down = data.uptime.down
  const expiring = data.expiringDomains.length

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">总览</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat bg-base-100 rounded-box border border-base-300">
          <div className="stat-title text-sm">资产</div>
          <div className="stat-value text-2xl">{data.assets.total}</div>
          <div className="stat-desc">在线 {data.assets.active} 个</div>
        </div>
        <div className={`stat bg-base-100 rounded-box border ${down > 0 ? 'border-error/40' : 'border-base-300'}`}>
          <div className="stat-title text-sm">探活</div>
          <div className="stat-value text-2xl">
            <span className="text-success">{data.uptime.up}</span>
            {down > 0 && <span className="text-error"> / {down}</span>}
          </div>
          <div className="stat-desc">正常 / 异常</div>
        </div>
        <div className={`stat bg-base-100 rounded-box border ${expiring > 0 ? 'border-warning/40' : 'border-base-300'}`}>
          <div className="stat-title text-sm">域名到期</div>
          <div className="stat-value text-2xl">{expiring}</div>
          <div className="stat-desc">45 天内</div>
        </div>
        <div className="stat bg-base-100 rounded-box border border-base-300">
          <div className="stat-title text-sm">事件</div>
          <div className="stat-value text-2xl">{data.recentEvents.length}</div>
          <div className="stat-desc">最近记录</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-base-100 rounded-box border border-base-300 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">探活目标</h2>
            <Link to="/status" className="link link-hover text-sm text-primary">
              查看状态 →
            </Link>
          </div>
          {data.uptime.targets.length === 0 ? (
            <Empty text="还没有探活目标" />
          ) : (
            <ul className="divide-y divide-base-200">
              {data.uptime.targets.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{t.name}</div>
                    <div className="text-xs opacity-50 truncate">{t.url}</div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <UpBadge ok={t.enabled ? t.last_ok : null} />
                    <div className="text-xs opacity-50 mt-1">
                      {t.last_latency != null ? `${t.last_latency}ms · ` : ''}
                      {timeAgo(t.last_checked_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-base-100 rounded-box border border-base-300 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">最近事件</h2>
            <Link to="/events" className="link link-hover text-sm text-primary">
              全部事件 →
            </Link>
          </div>
          {data.recentEvents.length === 0 ? (
            <Empty text="暂无事件" />
          ) : (
            <ul className="divide-y divide-base-200">
              {data.recentEvents.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`badge badge-xs ${
                        e.type === 'uptime' ? 'badge-info' : e.type === 'audit' ? 'badge-ghost' : 'badge-warning'
                      }`}
                    >
                      {e.type}
                    </span>
                    <span className="font-medium truncate">{e.action}</span>
                    {e.target && <span className="opacity-50 truncate">{e.target}</span>}
                  </div>
                  <div className="text-xs opacity-50 mt-0.5">
                    {e.actor ?? 'system'} · {formatTs(e.ts)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
