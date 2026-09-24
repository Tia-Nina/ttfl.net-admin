import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, run, now } from '../lib/db'
import { logEvent } from '../lib/audit'
import { runUptimeCycle } from '../cron/uptime'

export const uptimeApp = new Hono<AppEnv>()

uptimeApp.get('/targets', async (c) => {
  const targets = await all(
    c.env.DB,
    `select t.*, a.name as asset_name from uptime_targets t
     left join assets a on a.id = t.asset_id order by t.id`,
  )
  return c.json({ targets })
})

uptimeApp.post('/targets', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.name !== 'string' || !b.name.trim() || typeof b.url !== 'string' || !b.url.trim()) {
    return c.json({ error: 'name 和 url 必填' }, 400)
  }
  let url: URL
  try {
    url = new URL(b.url)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch {
    return c.json({ error: 'url 不合法（需 http/https）' }, 400)
  }
  const res = await c.env.DB.prepare(
    `insert into uptime_targets (asset_id, name, url, method, expect_status, interval_sec, enabled, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      b.asset_id ? Number(b.asset_id) : null,
      b.name.trim(), url.toString(),
      ['GET', 'HEAD'].includes(b.method) ? b.method : 'GET',
      Number(b.expect_status) >= 200 && Number(b.expect_status) < 400 ? Number(b.expect_status) : 200,
      Number(b.interval_sec) >= 60 ? Number(b.interval_sec) : 300,
      b.enabled === 0 ? 0 : 1,
      now(),
    )
    .run()
  const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
  await logEvent(c.env, 'audit', 'uptime.target.create', { target: `uptime:${id}`, detail: { url: url.toString() } })
  return c.json({ id }, 201)
})

uptimeApp.put('/targets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const target = await first(c.env.DB, 'select * from uptime_targets where id = ?', id)
  if (!target) return c.json({ error: '目标不存在' }, 404)
  const b = await c.req.json().catch(() => ({}))
  const cols = ['name', 'url', 'method', 'expect_status', 'interval_sec', 'enabled', 'asset_id'] as const
  const sets: string[] = []
  const vals: unknown[] = []
  for (const col of cols) {
    if (b[col] !== undefined) {
      sets.push(`${col} = ?`)
      vals.push(col === 'asset_id' && b[col] === null ? null : b[col])
    }
  }
  if (sets.length === 0) return c.json({ error: '没有可更新的字段' }, 400)
  sets.push('last_checked_at = NULL, last_ok = NULL, last_status = NULL, last_latency = NULL')
  vals.push(id)
  await run(c.env.DB, `update uptime_targets set ${sets.join(', ')} where id = ?`, ...vals)
  await logEvent(c.env, 'audit', 'uptime.target.update', { target: `uptime:${id}` })
  return c.json({ ok: true })
})

uptimeApp.delete('/targets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await run(c.env.DB, 'delete from uptime_targets where id = ?', id)
  await logEvent(c.env, 'audit', 'uptime.target.delete', { target: `uptime:${id}` })
  return c.json({ ok: true })
})

/** 探活结果：?hours=24 全部目标 / ?target_id=&hours=168 单目标 */
uptimeApp.get('/results', async (c) => {
  const hours = Math.min(Number(c.req.query('hours')) || 24, 24 * 30)
  const since = now() - hours * 3600 * 1000
  const targetId = c.req.query('target_id')
  const targets = await all(
    c.env.DB,
    targetId
      ? 'select id, name, url, enabled from uptime_targets where id = ?'
      : 'select id, name, url, enabled from uptime_targets order by id',
    ...(targetId ? [Number(targetId)] : []),
  )
  const rows = await all<{ target_id: number; ts: number; ok: number; status_code: number | null; latency_ms: number | null; error: string | null }>(
    c.env.DB,
    `select target_id, ts, ok, status_code, latency_ms, error from uptime_results
     where ts >= ? ${targetId ? 'and target_id = ?' : ''} order by ts asc limit 5000`,
    ...(targetId ? [since, Number(targetId)] : [since]),
  )
  return c.json({
    since,
    targets: targets.map((t) => ({
      ...t,
      points: rows.filter((r) => r.target_id === t.id),
    })),
  })
})

/** 手动立即执行一轮探活（测试 / 界面「立即检测」按钮用） */
uptimeApp.post('/run', async (c) => {
  const result = await runUptimeCycle(c.env)
  return c.json({ ok: true, ...result })
})
