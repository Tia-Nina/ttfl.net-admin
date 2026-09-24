import type { Env } from '../types'
import { all, first, run, now } from '../lib/db'
import { logEvent } from '../lib/audit'
import { pruneUptimeResults } from './uptime'
import { syncCfDomains } from '../hub/cloudflare'

/** 每日 03:00 UTC：域名到期检查（30 天内提醒，每天最多一条）+ CF 域名同步 + 数据清理 */
export async function runDaily(env: Env): Promise<void> {
  // 1. CF Registrar 到期时间同步（未配置 Token 时静默跳过）
  await syncCfDomains(env)

  // 2. 到期提醒（30 天内；按自然日去重）
  const dayStart = new Date(new Date().toISOString().slice(0, 10)).getTime()
  const domains = await all<{ name: string; expires_at: number }>(
    env.DB,
    'select name, expires_at from domains where expires_at is not null',
  )
  for (const d of domains) {
    const days = Math.ceil((d.expires_at - now()) / 86400000)
    if (days > 30) continue
    const existing = await first<{ id: number }>(
      env.DB,
      `select id from events where type = 'expiry' and action = 'domain.expiring' and target = ? and ts >= ?`,
      d.name, dayStart,
    )
    if (existing) continue
    await logEvent(env, 'expiry', 'domain.expiring', {
      target: d.name,
      detail: { days, expires_at: d.expires_at },
    })
  }

  // 3. 数据清理
  await pruneUptimeResults(env)
  await run(env.DB, 'delete from auth_challenges where created_at < ?', now() - 3600_000)
}
