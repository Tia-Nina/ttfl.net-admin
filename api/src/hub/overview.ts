import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, now } from '../lib/db'

export const overviewApp = new Hono<AppEnv>()

overviewApp.get('/', async (c) => {
  const soon = now() + 45 * 86400000
  const [assetStats, targets, expiring, recent] = await Promise.all([
    all<{ kind: string; total: number; active: number }>(
      c.env.DB,
      `select kind, count(*) as total, sum(case when status = 'active' then 1 else 0 end) as active
       from assets group by kind`,
    ),
    all(c.env.DB, 'select id, name, url, enabled, last_ok, last_status, last_latency, last_checked_at, interval_sec from uptime_targets order by id'),
    all(c.env.DB, 'select name, registrar, expires_at from domains where expires_at is not null and expires_at < ? order by expires_at', soon),
    all(c.env.DB, 'select id, ts, type, actor, action, target, detail from events order by ts desc limit 12'),
  ])

  const enabled = targets.filter((t) => t.enabled)
  return c.json({
    assets: {
      total: assetStats.reduce((s, k) => s + k.total, 0),
      active: assetStats.reduce((s, k) => s + k.active, 0),
      byKind: assetStats,
    },
    uptime: {
      up: enabled.filter((t) => t.last_ok === 1).length,
      down: enabled.filter((t) => t.enabled && t.last_ok === 0).length,
      pending: enabled.filter((t) => t.last_ok === null).length,
      targets,
    },
    expiringDomains: expiring,
    recentEvents: recent,
  })
})
