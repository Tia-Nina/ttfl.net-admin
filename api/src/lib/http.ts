import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv, Env } from '../types'

const TTFL_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?ttfl\.net$/
const DEV_ORIGINS = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function isDevHost(host: string | undefined): boolean {
  return !!host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
}

export function isAllowedOrigin(origin: string, _env: Env): boolean {
  return TTFL_ORIGIN.test(origin) || DEV_ORIGINS.test(origin)
}

export const corsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('origin')
  if (origin && isAllowedOrigin(origin, c.env)) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Vary', 'Origin')
  }
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    c.header('Access-Control-Max-Age', '86400')
    return c.body(null, 204)
  }
  await next()
}

export function errorJson(c: Context<AppEnv>, status: number, message: string) {
  return c.json({ error: message }, status as 400 | 401 | 403 | 404 | 500 | 503)
}

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 500 | 502 | 503,
    message: string,
  ) {
    super(message)
  }
}

/**
 * 域名门卫。同一 Worker 绑定两个域名，API 路径在两个域名下都放行
 * （路径层已隔离，且均受 JWT 保护）；注意 wrangler dev 会把 Host
 * 改写为第一个 route（auth.ttfl.net），本地开发时同样全放行。
 */
export const OUR_HOSTS = ['auth.ttfl.net', 'api.ttfl.net']

export function hostGate(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const host = c.req.header('host')
    if ((host && OUR_HOSTS.includes(host)) || isDevHost(host)) return next()
    return c.json({ error: 'Not Found' }, 404)
  }
}
