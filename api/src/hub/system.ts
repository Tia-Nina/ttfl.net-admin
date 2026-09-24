import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, run, now } from '../lib/db'
import { logEvent } from '../lib/audit'

export const systemApp = new Hono<AppEnv>()

/** 配置状态（供设置页显示哪些 Token 已就绪） */
systemApp.get('/info', async (c) => {
  const users = await first<{ n: number }>(c.env.DB, 'select count(*) as n from users')
  return c.json({
    setupDone: (users?.n ?? 0) > 0,
    authOrigin: c.env.PUBLIC_AUTH_ORIGIN,
    hubOrigin: c.env.PUBLIC_HUB_ORIGIN,
    tokens: {
      jwt: !!c.env.JWT_SECRET,
      setup: !!c.env.SETUP_TOKEN,
      github: !!c.env.GH_TOKEN,
      cloudflare: !!c.env.CF_API_TOKEN,
      cfAccount: !!c.env.CF_ACCOUNT_ID,
    },
  })
})

// ---------- 密钥元数据（只记元信息，绝不存值） ----------

systemApp.get('/secrets', async (c) => {
  const rows = await all(c.env.DB, 'select * from secrets_meta order by service, name')
  return c.json({ secrets: rows })
})

systemApp.post('/secrets', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.service !== 'string' || !b.service.trim() || typeof b.name !== 'string' || !b.name.trim()) {
    return c.json({ error: 'service 和 name 必填' }, 400)
  }
  if (b.value) return c.json({ error: '禁止存储密钥值，只能登记元数据' }, 400)
  const res = await c.env.DB.prepare(
    'insert into secrets_meta (service, name, scope_note, rotated_at, expires_at, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      b.service.trim(), b.name.trim(),
      typeof b.scope_note === 'string' ? b.scope_note : null,
      b.rotated_at ? Number(b.rotated_at) : null,
      b.expires_at ? Number(b.expires_at) : null,
      typeof b.notes === 'string' ? b.notes : null,
      now(), now(),
    )
    .run()
  const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
  await logEvent(c.env, 'audit', 'secrets_meta.create', { target: `secret:${id}`, detail: { service: b.service, name: b.name } })
  return c.json({ id }, 201)
})

systemApp.put('/secrets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  if (b.value) return c.json({ error: '禁止存储密钥值，只能登记元数据' }, 400)
  const cols = ['service', 'name', 'scope_note', 'rotated_at', 'expires_at', 'notes'] as const
  const sets: string[] = []
  const vals: unknown[] = []
  for (const col of cols) {
    if (b[col] !== undefined) {
      sets.push(`${col} = ?`)
      vals.push(b[col])
    }
  }
  if (sets.length === 0) return c.json({ error: '没有可更新的字段' }, 400)
  sets.push('updated_at = ?')
  vals.push(now(), id)
  await run(c.env.DB, `update secrets_meta set ${sets.join(', ')} where id = ?`, ...vals)
  await logEvent(c.env, 'audit', 'secrets_meta.update', { target: `secret:${id}` })
  return c.json({ ok: true })
})

systemApp.delete('/secrets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await run(c.env.DB, 'delete from secrets_meta where id = ?', id)
  await logEvent(c.env, 'audit', 'secrets_meta.delete', { target: `secret:${id}` })
  return c.json({ ok: true })
})

// ---------- 域名台账 ----------

systemApp.get('/domains', async (c) => {
  const rows = await all(c.env.DB, 'select * from domains order by name')
  return c.json({ domains: rows })
})

systemApp.post('/domains', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (typeof b.name !== 'string' || !b.name.trim()) return c.json({ error: 'name 必填' }, 400)
  const res = await c.env.DB.prepare(
    'insert into domains (name, registrar, expires_at, cf_zone_id, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      b.name.trim(),
      typeof b.registrar === 'string' ? b.registrar : null,
      b.expires_at ? Number(b.expires_at) : null,
      typeof b.cf_zone_id === 'string' ? b.cf_zone_id : null,
      typeof b.notes === 'string' ? b.notes : null,
      now(), now(),
    )
    .run()
  const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
  await logEvent(c.env, 'audit', 'domains.create', { target: b.name })
  return c.json({ id }, 201)
})

systemApp.put('/domains/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const cols = ['name', 'registrar', 'expires_at', 'cf_zone_id', 'notes'] as const
  const sets: string[] = []
  const vals: unknown[] = []
  for (const col of cols) {
    if (b[col] !== undefined) {
      sets.push(`${col} = ?`)
      vals.push(b[col])
    }
  }
  if (sets.length === 0) return c.json({ error: '没有可更新的字段' }, 400)
  sets.push('updated_at = ?')
  vals.push(now(), id)
  await run(c.env.DB, `update domains set ${sets.join(', ')} where id = ?`, ...vals)
  await logEvent(c.env, 'audit', 'domains.update', { target: `domain:${id}` })
  return c.json({ ok: true })
})

systemApp.delete('/domains/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await run(c.env.DB, 'delete from domains where id = ?', id)
  await logEvent(c.env, 'audit', 'domains.delete', { target: `domain:${id}` })
  return c.json({ ok: true })
})
