import type { Context, Hono as HonoType, Next } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireHubAdmin } from '../auth/session'
import { hostGate } from '../lib/http'
import { logEvent } from '../lib/audit'
import { assetsApp } from './assets'
import { uptimeApp } from './uptime'
import { overviewApp } from './overview'
import { eventsApp } from './events'
import { githubApp } from './github'
import { cfApp } from './cloudflare'
import { systemApp } from './system'

// 中枢 BFF 与认证中台同属一个 Worker；域名门卫统一放行 OUR_HOSTS（见 lib/http.ts），
// 实际的访问隔离由「路径前缀 + JWT 鉴权」完成。

/** 中枢 BFF 的顶层前缀（互不重叠，逐个精确挂载） */
const PREFIXES = ['/api/assets', '/api/uptime', '/api/overview', '/api/events', '/api/github', '/api/cf', '/api/system']

/** 写操作自动落审计事件 */
async function auditWrites(c: Context<AppEnv>, next: Next) {
  await next()
  if (!['GET', 'OPTIONS', 'HEAD'].includes(c.req.method)) {
    await logEvent(c.env, 'audit', `${c.req.method} ${c.req.path}`, {
      actor: c.get('session')?.name,
      detail: { status: c.res.status },
    })
  }
}

export function mountHub(app: HonoType<AppEnv>) {
  const gate = hostGate()
  for (const prefix of PREFIXES) {
    app.use(prefix, gate)
    app.use(`${prefix}/*`, gate)
    app.use(prefix, requireAuth)
    app.use(`${prefix}/*`, requireAuth)
    // 控制台管理功能仅 owner/admin（普通用户 403）
    app.use(prefix, requireHubAdmin)
    app.use(`${prefix}/*`, requireHubAdmin)
    app.use(prefix, auditWrites)
    app.use(`${prefix}/*`, auditWrites)
  }
  app.route('/api/assets', assetsApp)
  app.route('/api/uptime', uptimeApp)
  app.route('/api/overview', overviewApp)
  app.route('/api/events', eventsApp)
  app.route('/api/github', githubApp)
  app.route('/api/cf', cfApp)
  app.route('/api/system', systemApp)
}
