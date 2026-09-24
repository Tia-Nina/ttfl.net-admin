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

async function sha256hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const buf = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 校验一次性引导码；通过返回 true，无效/已消费返回 false */
async function checkSetupToken(env: AppEnv['Bindings'], setupToken: string): Promise<string | null> {
  if (!env.SETUP_TOKEN || setupToken !== env.SETUP_TOKEN) return 'setup token 无效'
  const consumed = await first<{ value: string }>(env.DB, "select value from app_state where key = 'setup_consumed'")
  if (consumed?.value === (await sha256hex(setupToken))) {
    return '该引导码已被使用；请重新 wrangler secret put SETUP_TOKEN 生成新的'
  }
  return null
}

/** 记录引导码已消费（存哈希，不存原值） */
async function consumeSetupToken(env: AppEnv['Bindings'], setupToken: string) {
  await run(
    env.DB,
    `insert into app_state (key, value) values ('setup_consumed', ?)
     on conflict(key) do update set value = excluded.value`,
    await sha256hex(setupToken),
  )
}

async function storeChallenge(env: AppEnv['Bindings'], purpose: 'register' | 'login' | 'signup', challenge: string) {
  const id = crypto.randomUUID()
  await run(env.DB, 'insert into auth_challenges (id, challenge, purpose, created_at) values (?, ?, ?, ?)', id, challenge, purpose, now())
  return id
}

async function takeChallenge(env: AppEnv['Bindings'], id: string, purpose: 'register' | 'login' | 'signup') {
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
  const setupToken = typeof body.setupToken === 'string' ? body.setupToken : ''

  const userRows = await all<{ id: number; name: string; role: string }>(env.DB, 'select id, name, role from users')
  const session = await getSession(c)

  let user: { id: number; name: string } | null = null
  if (session) {
    // 已登录：为当前用户追加 Passkey
    user = { id: session.sub, name: session.name }
  } else {
    // 未登录：一次性引导码（首次初始化 / 凭证全部丢失找回 / 新设备注册）
    const err = await checkSetupToken(env, setupToken)
    if (err) return c.json({ error: err }, 403)
    // 目标账号：已存在的 owner；不存在则创建（首用户）
    const owner = await first<{ id: number; name: string }>(
      env.DB,
      "select id, name from users where role = 'owner' order by id limit 1",
    )
    user = owner ?? { id: 0, name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Tia' }
  }

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

  const session = await getSession(c)
  const setupToken = typeof body.setupToken === 'string' ? body.setupToken : ''

  let user: { id: number; name: string; role: string }
  let isFirstUser = false
  let viaSetup = false

  if (session) {
    user = { id: session.sub, name: session.name, role: session.role }
  } else {
    const err = await checkSetupToken(env, setupToken)
    if (err) return c.json({ error: err }, 403)
    viaSetup = true
    const owner = await first<{ id: number; name: string; role: string }>(
      env.DB,
      "select id, name, role from users where role = 'owner' order by id limit 1",
    )
    if (owner) {
      // 凭证找回 / 新设备注册：挂到已有 owner 账号
      user = owner
    } else {
      // 首次初始化：创建 owner
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Tia'
      const res = await env.DB.prepare('insert into users (name, role, created_at, last_login_at) values (?, ?, ?, ?)')
        .bind(name, 'owner', now(), now())
        .run()
      const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
      await run(env.DB, 'insert into identities (user_id, provider, provider_user_id, label, created_at) values (?, ?, ?, ?, ?)', id, 'passkey', `local:${id}`, 'Passkey', now())
      user = { id, name, role: 'owner' }
      isFirstUser = true
    }
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
    isFirstUser ? '主 Passkey' : (body.label ?? '恢复 Passkey'),
    now(),
  )

  // 引导码一次性：成功注册即消费
  if (viaSetup) await consumeSetupToken(env, setupToken)

  await logEvent(env, 'auth', 'passkey.registered', { actor: user.name, target: `user:${user.id}` })
  const userInfo = await issueSession(c, user)
  return c.json({ ok: true, user: userInfo, firstLogin: isFirstUser })
})

// ---------- 多用户登录：不指定 allowCredentials，由认证器展示可发现的 Passkey ----------

webauthnApp.post('/login/options', async (c) => {
  const env = c.env
  const creds = await all<{ credential_id: string }>(env.DB, 'select credential_id from credentials')
  if (creds.length === 0) {
    return c.json({ error: '本站还没有任何账号（管理员请用引导码初始化）' }, 400)
  }
  // 留空 allowCredentials：认证器列出本站全部可发现凭证，用户自选账号
  const options = await generateAuthenticationOptions({
    rpID: rpId(env),
    userVerification: 'preferred',
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

// ---------- 普通用户注册（开放 / 邀请码制，模式在控制台设置里切换，默认邀请码制） ----------

async function registrationMode(env: AppEnv['Bindings']): Promise<'open' | 'invite'> {
  const row = await first<{ value: string }>(env.DB, "select value from app_state where key = 'registration_mode'")
  return row?.value === 'open' ? 'open' : 'invite'
}

const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function generateInviteCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)]
  return code
}

function validName(n: unknown): string | null {
  if (typeof n !== 'string') return null
  const name = n.trim()
  return name.length >= 1 && name.length <= 32 ? name : null
}

// 开放注册的 IP 限速：每 IP 每小时 5 次
async function signupRateLimited(env: AppEnv['Bindings'], ip: string): Promise<boolean> {
  const since = now() - 3600_000
  const row = await first<{ n: number }>(env.DB, 'select count(*) as n from signup_rl where ip = ? and ts > ?', ip, since)
  if ((row?.n ?? 0) >= 5) return true
  await run(env.DB, 'insert into signup_rl (ip, ts) values (?, ?)', ip, now())
  return false
}

webauthnApp.get('/registration-mode', async (c) => {
  return c.json({ mode: await registrationMode(c.env) })
})

webauthnApp.post('/signup/options', async (c) => {
  const env = c.env
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const name = validName(body.name)
  if (!name) return c.json({ error: '请填写昵称（1-32 字）' }, 400)

  const mode = await registrationMode(env)
  if (mode === 'invite') {
    const code = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toUpperCase() : ''
    if (!code) return c.json({ error: '本站注册需要邀请码' }, 403)
    const row = await first<{ code: string }>(env.DB, 'select code from invite_codes where code = ? and used_by is null', code)
    if (!row) return c.json({ error: '邀请码无效或已被使用' }, 403)
  } else {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
    if (await signupRateLimited(env, ip)) return c.json({ error: '注册过于频繁，请一小时后再试' }, 429)
  }

  const options = await generateRegistrationOptions({
    rpName: 'ttfl.net 认证中台',
    rpID: rpId(env),
    userID: crypto.getRandomValues(new Uint8Array(16)),
    userName: name,
    attestationType: 'none',
    authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
  })
  const challengeId = await storeChallenge(env, 'signup', options.challenge)
  return c.json({ challengeId, mode, options })
})

webauthnApp.post('/signup/verify', async (c) => {
  const env = c.env
  const body = (await c.req.json().catch(() => null)) as
    | { challengeId?: string; name?: string; inviteCode?: string; response?: RegistrationResponseJSON }
    | null
  if (!body?.challengeId || !body.response) return c.json({ error: '参数不完整' }, 400)
  const name = validName(body.name)
  if (!name) return c.json({ error: '昵称不合法' }, 400)

  const expectedChallenge = await takeChallenge(env, body.challengeId, 'signup')
  if (!expectedChallenge) return c.json({ error: '注册会话已过期，请重新开始' }, 400)

  // 先完成 WebAuthn 校验，再处理邀请码与建号，避免脏数据
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

  const mode = await registrationMode(env)
  let inviteCode: string | null = null
  if (mode === 'invite') {
    const code = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toUpperCase() : ''
    if (!code) return c.json({ error: '本站注册需要邀请码' }, 403)
    // 条件更新原子占用邀请码（并发安全；used_by 先置 -1 占位，建号后回填真实 id）
    const res = await env.DB.prepare('update invite_codes set used_by = -1, used_at = ? where code = ? and used_by is null')
      .bind(now(), code)
      .run()
    if (((res as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
      return c.json({ error: '邀请码无效或已被使用' }, 403)
    }
    inviteCode = code
  }

  const res = await env.DB.prepare('insert into users (name, role, created_at) values (?, ?, ?)')
    .bind(name, 'user', now())
    .run()
  const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
  await run(env.DB, 'insert into identities (user_id, provider, provider_user_id, label, created_at) values (?, ?, ?, ?, ?)', id, 'passkey', `local:${id}`, 'Passkey', now())
  await run(
    env.DB,
    'insert into credentials (user_id, credential_id, public_key, counter, transports, label, created_at) values (?, ?, ?, ?, ?, ?, ?)',
    id,
    cred.id,
    bytesToBase64(cred.publicKey),
    cred.counter,
    cred.transports?.join(',') ?? null,
    '登录 Passkey',
    now(),
  )
  if (inviteCode) {
    await run(env.DB, 'update invite_codes set used_by = ? where code = ?', id, inviteCode)
  }

  await logEvent(env, 'auth', 'user.signup', { actor: name, target: `user:${id}`, detail: { mode } })
  const userInfo = await issueSession(c, { id, name, role: 'user' })
  return c.json({ ok: true, user: userInfo })
})

// ---------- 邮箱 + 密码注册 / 登录 ----------
// 密码安全设计：浏览器端先做 PBKDF2-SHA256(150k, salt="ttfl:"+email) 派生出 dk，
// 只传 dk；服务端存 sha256(dk)。服务端零 KDF 开销（Workers 免费档 CPU 限制友好），
// 拖库者仍需先攻破客户端 PBKDF2 才能碰撞库。

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalizeEmail(e: unknown): string | null {
  if (typeof e !== 'string') return null
  const email = e.trim().toLowerCase()
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null
}

/** 客户端派生键：64 位 hex */
function validPasswordDK(dk: unknown): string | null {
  if (typeof dk !== 'string') return null
  return /^[0-9a-f]{64}$/.test(dk) ? dk : null
}

/** 常量时间比较，防时序侧信道 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

webauthnApp.post('/password/signup', async (c) => {
  const env = c.env
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const email = normalizeEmail(body.email)
  const name = validName(body.name)
  const dk = validPasswordDK(body.password)
  if (!email) return c.json({ error: '邮箱格式不正确' }, 400)
  if (!name) return c.json({ error: '请填写昵称（1-32 字）' }, 400)
  if (!dk) return c.json({ error: '密码派生键不合法' }, 400)

  // 与 Passkey 注册共用邀请码 / 开放模式与限速
  const mode = await registrationMode(env)
  if (mode === 'invite') {
    const code = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toUpperCase() : ''
    if (!code) return c.json({ error: '本站注册需要邀请码' }, 403)
    const row = await first<{ code: string }>(env.DB, 'select code from invite_codes where code = ? and used_by is null', code)
    if (!row) return c.json({ error: '邀请码无效或已被使用' }, 403)
  } else {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
    if (await signupRateLimited(env, ip)) return c.json({ error: '注册过于频繁，请一小时后再试' }, 429)
  }

  const exists = await first<{ user_id: number }>(env.DB, 'select user_id from auth_passwords where email = ?', email)
  if (exists) return c.json({ error: '该邮箱已注册，请直接登录' }, 409)

  const passwordHash = await sha256hex(dk)
  const nowTs = now()
  const res = await env.DB.prepare('insert into users (name, role, created_at) values (?, ?, ?)')
    .bind(name, 'user', nowTs)
    .run()
  const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
  await run(env.DB, 'insert into identities (user_id, provider, provider_user_id, label, created_at) values (?, ?, ?, ?, ?)', id, 'email', email, '邮箱密码', nowTs)
  await run(
    env.DB,
    'insert into auth_passwords (user_id, email, password_hash, email_verified, created_at, updated_at) values (?, ?, ?, 0, ?, ?)',
    id, email, passwordHash, nowTs, nowTs,
  )
  if (mode === 'invite') {
    const code = (body.inviteCode as string).trim().toUpperCase()
    await run(env.DB, 'update invite_codes set used_by = ?, used_at = ? where code = ? and used_by is null', id, nowTs, code)
  }

  await logEvent(env, 'auth', 'password.signup', { actor: name, target: `user:${id}`, detail: { email } })
  const userInfo = await issueSession(c, { id, name, role: 'user' })
  return c.json({ ok: true, user: userInfo, hasPasskey: false })
})

webauthnApp.post('/password/login', async (c) => {
  const env = c.env
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const email = normalizeEmail(body.email)
  const dk = validPasswordDK(body.password)
  if (!email || !dk) return c.json({ error: '邮箱或密码不正确' }, 401)

  const row = await first<{ user_id: number; password_hash: string }>(
    env.DB,
    'select user_id, password_hash from auth_passwords where email = ?',
    email,
  )
  const stored = row?.password_hash ?? ''
  const computed = await sha256hex(dk)
  // 统一走比较逻辑，避免「邮箱不存在」与「密码错误」的响应时间差
  if (!row || !safeEqual(computed, stored)) {
    await logEvent(env, 'auth', 'password.login.failed', { detail: { email } })
    return c.json({ error: '邮箱或密码不正确' }, 401)
  }

  const user = await first<{ id: number; name: string; role: string }>(
    env.DB,
    'select id, name, role from users where id = ?',
    row.user_id,
  )
  if (!user) return c.json({ error: '账号不存在' }, 401)
  // 管理员账号强制 Passkey：不给密码登录口子
  if (user.role === 'owner' || user.role === 'admin') {
    return c.json({ error: '管理员账号请使用 Passkey 登录' }, 403)
  }

  await run(env.DB, 'update users set last_login_at = ? where id = ?', now(), user.id)
  await logEvent(env, 'auth', 'password.login', { actor: user.name, target: `user:${user.id}` })
  const hasPasskey = await first<{ n: number }>(env.DB, 'select count(*) as n from credentials where user_id = ?', user.id)
  const userInfo = await issueSession(c, user)
  return c.json({ ok: true, user: userInfo, hasPasskey: (hasPasskey?.n ?? 0) > 0 })
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

/** 当前用户在某应用的管理员权限（websiteapi 等后端回查用） */
async function myPermissionsHandler(c: Context<AppEnv>) {
  const session = await getSession(c)
  if (!session) return c.json({ error: '未登录' }, 401)
  const app = c.req.query('app') ?? ''
  if (!/^[a-z0-9_-]{1,32}$/.test(app)) return c.json({ error: 'app 不合法' }, 400)
  const row = await first<{ user_id: number }>(
    c.env.DB,
    'select user_id from app_permissions where user_id = ? and app = ? and permission = ?',
    session.sub, app, 'admin',
  )
  return c.json({ app, admin: !!row || session.role === 'owner' || session.role === 'admin' })
}

/** 挂载认证中台路由 */
export function mountAuth(app: HonoType<AppEnv>) {
  const gate = hostGate()
  app.route('/api/webauthn', webauthnApp)
  app.use('/api/webauthn', gate)
  app.use('/api/session', gate)
  app.use('/api/logout', gate)
  app.use('/api/providers', gate)
  app.use('/api/my-permissions', gate)
  app.get('/api/session', sessionHandler)
  app.post('/api/logout', logoutHandler)
  app.get('/api/my-permissions', myPermissionsHandler)
  app.get('/api/providers', (c) => c.json({ providers: Object.keys(OAUTH_PROVIDERS) }))
}
