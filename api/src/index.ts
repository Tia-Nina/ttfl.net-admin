import { Hono } from 'hono'
import type { AppEnv } from './types'
import { corsMiddleware, isDevHost } from './lib/http'
import { renderAuthSdk } from './auth/sdk'
import { mountAuth } from './auth/routes'
import { mountHub } from './hub'
import { handleScheduled } from './cron'

const app = new Hono<AppEnv>()

app.use('*', corsMiddleware)

/** 开放健康检查：可把 https://auth.ttfl.net/api/health 加进 uptime_targets 自监控 */
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

/** 各站点接入的会话检测 SDK（按环境替换认证源） */
app.get('/auth.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=300')
  return c.body(renderAuthSdk(c.env))
})

/** 静态资源（登录页等）：仅 auth 域与本地开发提供；API 路径放行给后续路由 */
app.get('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next()
  const host = c.req.header('host')
  if (host === 'auth.ttfl.net' || isDevHost(host)) {
    return c.env.ASSETS.fetch(c.req.raw)
  }
  return c.json({ error: 'Not Found' }, 404)
})

mountAuth(app)
mountHub(app)

app.onError((err, c) => {
  const status = (err as { status?: number }).status
  if (!status || status >= 500) console.error('[hub] error:', err)
  return c.json({ error: err.message || 'Internal Error' }, (status ?? 500) as 500)
})

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env, event.cron))
  },
}
