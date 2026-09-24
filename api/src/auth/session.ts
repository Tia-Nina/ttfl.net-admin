import { getCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv, SessionPayload } from '../types'
import { verifySession } from './jwt'

/**
 * 会话来源（优先级）：
 * 1. Cookie ttfl_session（浏览器，跨子域共享）
 * 2. Authorization: Bearer <jwt>（curl / CLI 自动化用）
 */
export async function getSession(c: Context<AppEnv>): Promise<SessionPayload | null> {
  const authz = c.req.header('authorization')
  if (authz?.startsWith('Bearer ')) {
    return verifySession(c.env, authz.slice(7).trim())
  }
  const token = getCookie(c, c.env.COOKIE_NAME)
  if (token) {
    return verifySession(c.env, token)
  }
  return null
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await getSession(c)
  if (!session) {
    return c.json({ error: '未登录或会话已过期' }, 401)
  }
  c.set('session', session)
  await next()
}

/** 管理员门卫：控制台管理功能仅 owner/admin 可用（普通用户会被 403） */
export const requireHubAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get('session')
  if (!session || !['owner', 'admin'].includes(session.role)) {
    return c.json({ error: '需要管理员权限' }, 403)
  }
  await next()
}
