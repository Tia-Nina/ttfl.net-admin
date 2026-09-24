// 本地开发辅助：用 .dev.vars 里的 JWT_SECRET 签发会话 token（1 小时），
// 供 curl / 脚本以 Authorization: Bearer <token> 调试中枢 API。
// 用法：node scripts/mint-token.mjs [userId] [name]
import { webcrypto as crypto } from 'node:crypto'
import { readFileSync } from 'node:fs'

const secret = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
  .split('\n')
  .find((l) => l.startsWith('JWT_SECRET='))
  ?.split('=')[1]
if (!secret) throw new Error('.dev.vars 中未找到 JWT_SECRET')

const enc = new TextEncoder()
const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
const payload = {
  sub: Number(process.argv[2] ?? 1),
  name: process.argv[3] ?? 'Tia',
  role: 'owner',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
}
const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
const body = b64url(enc.encode(JSON.stringify(payload)))
const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`))
console.log(`${header}.${body}.${b64url(new Uint8Array(sig))}`)
