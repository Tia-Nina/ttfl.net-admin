import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, run, now } from '../lib/db'
import { logEvent } from '../lib/audit'
import { generateInviteCode } from '../auth/routes'

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

// ---------- 用户注册管理（模式 + 邀请码） ----------

systemApp.get('/registration', async (c) => {
  const modeRow = await first<{ value: string }>(c.env.DB, "select value from app_state where key = 'registration_mode'")
  const invites = await all(c.env.DB, 'select * from invite_codes order by created_at desc limit 50')
  return c.json({
    mode: modeRow?.value === 'open' ? 'open' : 'invite',
    invites,
  })
})

systemApp.put('/registration', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (!['open', 'invite'].includes(b.mode)) return c.json({ error: "mode 必须是 'open' 或 'invite'" }, 400)
  await run(
    c.env.DB,
    `insert into app_state (key, value) values ('registration_mode', ?)
     on conflict(key) do update set value = excluded.value`,
    b.mode,
  )
  await logEvent(c.env, 'audit', 'registration.mode', { actor: c.get('session')?.name, detail: { mode: b.mode } })
  return c.json({ ok: true })
})

systemApp.post('/invites', async (c) => {
  const code = generateInviteCode()
  await run(c.env.DB, 'insert into invite_codes (code, created_by, created_at) values (?, ?, ?)', code, c.get('session')?.name ?? 'admin', now())
  await logEvent(c.env, 'audit', 'registration.invite.create', { target: code })
  return c.json({ code }, 201)
})

systemApp.delete('/invites/:code', async (c) => {
  const code = c.req.param('code').toUpperCase()
  await run(c.env.DB, 'delete from invite_codes where code = ? and used_by is null', code)
  await logEvent(c.env, 'audit', 'registration.invite.delete', { target: code })
  return c.json({ ok: true })
})

// ---------- 用户与站点权限管理 ----------

systemApp.get('/users', async (c) => {
  const users = await all(
    c.env.DB,
    `select u.id, u.name, u.role, u.created_at, u.last_login_at,
            (select count(*) from credentials cr where cr.user_id = u.id) as passkeys,
            p.email,
            exists(select 1 from app_permissions ap where ap.user_id = u.id and ap.app = 'home' and ap.permission = 'admin') as home_admin
     from users u
     left join auth_passwords p on p.user_id = u.id
     order by u.id`,
  )
  return c.json({ users })
})

/** 授予/撤销某用户在某应用的 admin 权限（如 home 站管理员） */
systemApp.put('/users/:id/permissions', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const app = typeof b.app === 'string' ? b.app : ''
  const grant = !!b.grant
  if (!/^[a-z0-9_-]{1,32}$/.test(app)) return c.json({ error: 'app 不合法' }, 400)
  const user = await first<{ id: number; role: string }>(c.env.DB, 'select id, role from users where id = ?', id)
  if (!user) return c.json({ error: '用户不存在' }, 404)

  if (grant) {
    await run(
      c.env.DB,
      'insert or ignore into app_permissions (user_id, app, permission, created_at) values (?, ?, ?, ?)',
      id, app, 'admin', now(),
    )
  } else {
    await run(c.env.DB, 'delete from app_permissions where user_id = ? and app = ? and permission = ?', id, app, 'admin')
  }
  await logEvent(c.env, 'audit', 'app_permission.update', {
    actor: c.get('session')?.name,
    target: `user:${id}`,
    detail: { app, grant },
  })
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
