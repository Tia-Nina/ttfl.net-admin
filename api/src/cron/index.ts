import type { Env } from '../types'
import { runUptimeCycle } from './uptime'
import { runDaily } from './daily'

/**
 * Cron 分发：wrangler.toml [triggers]
 * - "* * * * *"  → 每分钟探活（内部按各目标的 interval_sec 决定是否到期）
 * - "0 3 * * *"  → 每日：域名到期检查 + CF 同步 + 结果清理
 */
export async function handleScheduled(env: Env, cron: string): Promise<void> {
  try {
    if (cron === '0 3 * * *') {
      await runDaily(env)
      return
    }
    await runUptimeCycle(env)
  } catch (e) {
    console.error('[cron] failed:', e)
  }
}
