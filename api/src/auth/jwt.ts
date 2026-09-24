import type { Env, SessionPayload } from '../types'

const enc = new TextEncoder()

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signSession(env: Env, payload: { sub: number; name: string; role: string }): Promise<string> {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + Number(env.SESSION_TTL_SEC || 604800)
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64urlEncode(enc.encode(JSON.stringify({ ...payload, iat, exp })))
  const key = await hmacKey(jwtSecret(env))
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`))
  return `${header}.${body}.${b64urlEncode(new Uint8Array(sig))}`
}

export async function verifySession(env: Env, token: string): Promise<SessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const key = await hmacKey(jwtSecret(env))
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(`${header}.${body}`))
  if (!ok) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function sessionCookie(env: Env, token: string): string {
  const maxAge = Number(env.SESSION_TTL_SEC || 604800)
  return `${env.COOKIE_NAME}=${token}; Domain=${env.COOKIE_DOMAIN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearSessionCookie(env: Env): string {
  return `${env.COOKIE_NAME}=; Domain=${env.COOKIE_DOMAIN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function jwtSecret(env: Env): string {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET 未配置（wrangler secret put JWT_SECRET）')
  return env.JWT_SECRET
}

export function rpId(env: Env): string {
  return new URL(env.PUBLIC_AUTH_ORIGIN).hostname
}

export function expectedOrigin(env: Env): string {
  return env.PUBLIC_AUTH_ORIGIN
}
