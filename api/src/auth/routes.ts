import { Hono } from 'hono'
import type { Context, Hono as HonoType } from 'hono'
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server'
import type { AppEnv } from '../types'
import { all, first, run, now } from '../lib/db'
import { logEvent } from '../lib/audit'
import { hostGate } from '../lib/http'
import { signSession, sessionCookie, clearSessionCookie, rpId, expectedOrigin } from './jwt'
import { getSession } from './session'
import { OAUTH_PROVIDERS } from './providers'

// ---------- 工具 ----------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function utf8Bytes(s: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(s)
  const out = new Uint8Array(new ArrayBuffer(bytes.length))
  out.set(bytes)
  return out
}

async function storeChallenge(env: AppEnv['Bindings'], purpose: 'register' | 'login', challenge: string) {
  const id = crypto.randomUUID()
  await run(env.DB, 'insert into auth_challenges (id, challenge, purpose, created_at) values (?, ?, ?, ?)', id, challenge, purpose, now())
  return id
}

async function takeChallenge(env: AppEnv['Bindings'], id: string, purpose: 'register' | 'login') {
  const row = await first<{ challenge: string }>(env.DB, 'select challenge from auth_challenges where id = ? and purpose = ?', id, purpose)
  await run(env.DB, 'delete from auth_challenges where id = ?', id)
  return row?.challenge ?? null
}

async function issueSession(c: Context<AppEnv>, user: { id: number; name: string; role: string }) {
  const token = await signSession(c.env, { sub: user.id, name: user.name, role: user.role })
  c.header('Set-Cookie', sessionCookie(c.env, token))
  return { id: user.id, name: user.name, role: user.role }
}

interface StoredCredential {
  id: string
  publicKey: Uint8Array
  counter: number
  transports?: string[]
}

/** 兼容 @simplewebauthn/server v13 的 registrationInfo.credential 结构 */
function extractCredential(info: Record<string, unknown> | undefined): StoredCredential | null {
  if (!info) return null
  const cred = info.credential as Record<string, unknown> | undefined
  if (cred && typeof cred.id === 'string' && cred.publicKey instanceof Uint8Array) {
    return {
      id: cred.id,
      publicKey: cred.publicKey,
      counter: Number(cred.counter ?? 0),
      transports: cred.transports as string[] | undefined,
    }
  }
  // 旧版本结构兜底
  if (typeof info.credentialID === 'string' && info.credentialPublicKey instanceof Uint8Array) {
    return {
      id: info.credentialID as string,
      publicKey: info.credentialPublicKey as Uint8Array,
      counter: Number(info.counter ?? 0),
      transports: info.transports as string[] | undefined,
    }
  }
  return null
}

// ---------- Passkey（挂载于 /api/webauthn） ----------

const webauthnApp = new Hono<AppEnv>()
webauthnApp.use('*', hostGate())

webauthnApp.post('/register/options', async (c) => {
  const env = c.env
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)

  const userRows = await all<{ id: number; name: string; role: string }>(env.DB, 'select id, name, role from users')
  const session = await getSession(c)

  let user: { id: number; name: string } | null = null

  if (userRows.length === 0) {
    // 首次初始化：需要一次性 SETUP_TOKEN（wrangler secret put SETUP_TOKEN）
    if (!env.SETUP_TOKEN) return c.json({ error: '服务端未配置 SETUP_TOKEN，无法初始化' }, 500)
    if (body.setupToken !== env.SETUP_TOKEN) return c.json({ error: 'setup token 无效' }, 403)
    user = { id: 0, name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Tia' }
  } else {
    if (!session) return c.json({ error: '请先登录后再添加 Passkey' }, 401)
    user = { id: session.sub, name: session.name }
  }

  // 首次初始化时还没有 user.id，不查已有凭证（注意：D1 不允许 SQL 无占位符却 bind 参数）
  const existing = user.id
    ? await all<{ credential_id: string }>(env.DB, 'select credential_id from credentials where user_id = ?', user.id)
    : []

  const options = await generateRegistrationOptions({
    rpName: 'ttfl.net 认证中台',
    rpID: rpId(env),
    userID: user.id ? utf8Bytes(String(user.id)) : crypto.getRandomValues(new Uint8Array(16)),
    userName: user.name,
    attestationType: 'none',
    excludeCredentials: existing.map((e) => ({ id: e.credential_id })),
    authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
  })

  const challengeId = await storeChallenge(env, 'register', options.challenge)
  return c.json({ challengeId, isFirstUser: userRows.length === 0, options })
})

webauthnApp.post('/register/verify', async (c) => {
  const env = c.env
  const body = (await c.req.json().catch(() => null)) as
    | { challengeId?: string; setupToken?: string; name?: string; label?: string; response?: RegistrationResponseJSON }
    | null
  if (!body?.challengeId || !body.response) return c.json({ error: '参数不完整' }, 400)

  const expectedChallenge = await takeChallenge(env, body.challengeId, 'register')
  if (!expectedChallenge) return c.json({ error: '注册会话已过期，请重新开始' }, 400)

  const userRows = await all<{ id: number; name: string; role: string }>(env.DB, 'select id, name, role from users')
  const session = await getSession(c)

  let user: { id: number; name: string; role: string }
  if (userRows.length === 0) {
    if (!env.SETUP_TOKEN || body.setupToken !== env.SETUP_TOKEN) return c.json({ error: 'setup token 无效' }, 403)
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Tia'
    const res = await env.DB.prepare('insert into users (name, role, created_at, last_login_at) values (?, ?, ?, ?)')
      .bind(name, 'owner', now(), now())
      .run()
    const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
    await run(env.DB, 'insert into identities (user_id, provider, provider_user_id, label, created_at) values (?, ?, ?, ?, ?)', id, 'passkey', `local:${id}`, 'Passkey', now())
    user = { id, name, role: 'owner' }
  } else {
    if (!session) return c.json({ error: '请先登录' }, 401)
    user = { id: session.sub, name: session.name, role: session.role }
  }

  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge,
    expectedOrigin: expectedOrigin(env),
    expectedRPID: rpId(env),
    requireUserVerification: false,
  })
  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: '注册校验失败' }, 400)
  }
  const cred = extractCredential(verification.registrationInfo as Record<string, unknown>)
  if (!cred) return c.json({ error: '注册响应缺少凭证信息' }, 400)

  await run(
    env.DB,
    'insert into credentials (user_id, credential_id, public_key, counter, transports, label, created_at) values (?, ?, ?, ?, ?, ?, ?)',
    user.id,
    cred.id,
    bytesToBase64(cred.publicKey),
    cred.counter,
    cred.transports?.join(',') ?? null,
    userRows.length === 0 ? '主 Passkey' : (body.label ?? null),
    now(),
  )

  await logEvent(env, 'auth', 'passkey.registered', { actor: user.name, target: `user:${user.id}` })
  const userInfo = await issueSession(c, user)
  return c.json({ ok: true, user: userInfo, firstLogin: userRows.length === 0 })
})

webauthnApp.post('/login/options', async (c) => {
  const env = c.env
  const creds = await all<{ credential_id: string }>(env.DB, 'select credential_id from credentials')
  if (creds.length === 0) {
    return c.json({ error: '尚未注册任何 Passkey（首次部署请访问 /?setup=<SETUP_TOKEN>）' }, 400)
  }
  const options = await generateAuthenticationOptions({
    rpID: rpId(env),
    userVerification: 'preferred',
    allowCredentials: creds.map((cr) => ({ id: cr.credential_id })),
  })
  const challengeId = await storeChallenge(env, 'login', options.challenge)
  return c.json({ challengeId, options })
})

webauthnApp.post('/login/verify', async (c) => {
  const env = c.env
  const body = (await c.req.json().catch(() => null)) as
    | { challengeId?: string; response?: AuthenticationResponseJSON }
    | null
  if (!body?.challengeId || !body.response) return c.json({ error: '参数不完整' }, 400)

  const expectedChallenge = await takeChallenge(env, body.challengeId, 'login')
  if (!expectedChallenge) return c.json({ error: '登录会话已过期，请重试' }, 400)

  const credRow = await first<{
    id: number
    user_id: number
    credential_id: string
    public_key: string
    counter: number
    transports: string | null
    name: string
    role: string
  }>(
    env.DB,
    `select c.id, c.user_id, c.credential_id, c.public_key, c.counter, c.transports, u.name, u.role
     from credentials c join users u on u.id = c.user_id
     where c.credential_id = ?`,
    body.response.id,
  )
  if (!credRow) return c.json({ error: '未知凭证' }, 401)

  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge,
    expectedOrigin: expectedOrigin(env),
    expectedRPID: rpId(env),
    requireUserVerification: false,
    credential: {
      id: credRow.credential_id,
      publicKey: base64ToBytes(credRow.public_key),
      counter: credRow.counter,
      transports: (credRow.transports?.split(',').filter(Boolean) ?? undefined) as never,
    },
  })
  if (!verification.verified) {
    await logEvent(env, 'auth', 'login.failed', { actor: `user:${credRow.user_id}`, detail: { reason: '签名校验失败' } })
    return c.json({ error: '登录校验失败' }, 401)
  }

  await run(env.DB, 'update credentials set counter = ?, last_used_at = ? where id = ?', verification.authenticationInfo.newCounter, now(), credRow.id)
  await run(env.DB, 'update users set last_login_at = ? where id = ?', now(), credRow.user_id)
  await logEvent(env, 'auth', 'login.ok', { actor: credRow.name, target: `user:${credRow.user_id}` })

  const userInfo = await issueSession(c, { id: credRow.user_id, name: credRow.name, role: credRow.role })
  return c.json({ ok: true, user: userInfo })
})

// 凭证管理（登录后）
webauthnApp.get('/credentials', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: '未登录' }, 401)
  const creds = await all(c.env.DB, 'select id, credential_id, label, created_at, last_used_at from credentials where user_id = ?', session.sub)
  return c.json({ credentials: creds })
})

webauthnApp.delete('/credentials/:id', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: '未登录' }, 401)
  const id = Number(c.req.param('id'))
  const creds = await all<{ id: number }>(c.env.DB, 'select id from credentials where user_id = ?', session.sub)
  if (creds.length <= 1) {
    return c.json({ error: '最后一个 Passkey 不可删除（如需重置请重新配置 SETUP_TOKEN 并清空 credentials 表）' }, 400)
  }
  await run(c.env.DB, 'delete from credentials where id = ? and user_id = ?', id, session.sub)
  await logEvent(c.env, 'auth', 'passkey.deleted', { actor: session.name, target: `credential:${id}` })
  return c.json({ ok: true })
})

// ---------- 会话（挂载于 /api/session、/api/logout、/api/providers） ----------

async function sessionHandler(c: Context<AppEnv>) {
  const session = await getSession(c)
  if (!session) return c.json({ error: '未登录' }, 401)
  return c.json({ user: { id: session.sub, name: session.name, role: session.role } })
}

async function logoutHandler(c: Context<AppEnv>) {
  const session = await getSession(c)
  c.header('Set-Cookie', clearSessionCookie(c.env))
  if (session) await logEvent(c.env, 'auth', 'logout', { actor: session.name })
  return c.json({ ok: true })
}

/** 挂载认证中台路由 */
export function mountAuth(app: HonoType<AppEnv>) {
  const gate = hostGate()
  app.route('/api/webauthn', webauthnApp)
  app.use('/api/webauthn', gate)
  app.use('/api/session', gate)
  app.use('/api/logout', gate)
  app.use('/api/providers', gate)
  app.get('/api/session', sessionHandler)
  app.post('/api/logout', logoutHandler)
  app.get('/api/providers', (c) => c.json({ providers: Object.keys(OAUTH_PROVIDERS) }))
}
