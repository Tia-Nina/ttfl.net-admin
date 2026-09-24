import type { Env } from '../types'
import { all, first, run, now } from '../lib/db'
import { logEvent } from '../lib/audit'

interface UptimeTarget {
  id: number
  name: string
  url: string
  method: string
  expect_status: number
  interval_sec: number
  last_checked_at: number | null
  last_ok: number | null
}

const PROBE_TIMEOUT_MS = 10_000

async function probeTarget(env: Env, t: UptimeTarget): Promise<void> {
  const started = now()
  let ok = 0
  let status: number | null = null
  let latency = 0
  let error: string | null = null
  try {
    const res = await fetch(t.url, {
      method: t.method,
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { 'user-agent': 'ttfl-hub/uptime' },
    })
    status = res.status
    latency = now() - started
    ok = status >= t.expect_status && status < 400 ? 1 : 0
    if (!ok) error = `HTTP ${status}`
  } catch (e) {
    latency = now() - started
    error = String((e as Error)?.message ?? e).slice(0, 300)
  }

  const ts = now()
  await run(
    env.DB,
    'insert into uptime_results (target_id, ts, ok, status_code, latency_ms, error) values (?, ?, ?, ?, ?, ?)',
    t.id, ts, ok, status, latency, error,
  )
  await run(
    env.DB,
    'update uptime_targets set last_checked_at = ?, last_ok = ?, last_status = ?, last_latency = ? where id = ?',
    ts, ok, status, latency, t.id,
  )

  // 仅状态翻转时记录事件（避免每次探测刷屏）
  if (t.last_ok !== null && Number(t.last_ok) !== ok) {
    await logEvent(env, 'uptime', ok ? 'uptime.recovered' : 'uptime.down', {
      target: t.name,
      detail: { url: t.url, status, latency_ms: latency, error },
    })
  }
}

/** 一轮探活：只处理到达间隔的目标，单个失败不影响其他目标 */
export async function runUptimeCycle(env: Env): Promise<{ checked: number; total: number }> {
  const targets = await all<UptimeTarget>(env.DB, 'select * from uptime_targets where enabled = 1')
  const nowMs = now()
  const due = targets.filter(
    (t) => !t.last_checked_at || nowMs - Number(t.last_checked_at) >= t.interval_sec * 1000 - 5000,
  )
  await Promise.allSettled(due.map((t) => probeTarget(env, t)))
  return { checked: due.length, total: targets.length }
}

/** 单目标探测（供测试 / 手动重试单个目标） */
export async function probeOnce(env: Env, targetId: number): Promise<void> {
  const t = await first<UptimeTarget>(env.DB, 'select * from uptime_targets where id = ?', targetId)
  if (t) await probeTarget(env, t)
}

export async function pruneUptimeResults(env: Env, retentionDays = 30): Promise<void> {
  await run(env.DB, 'delete from uptime_results where ts < ?', now() - retentionDays * 86400000)
}
