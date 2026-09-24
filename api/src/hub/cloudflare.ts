import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, run, now } from '../lib/db'
import { logEvent } from '../lib/audit'
import { HttpError } from '../lib/http'

/** Cloudflare API v4 代理：Token 只存 Worker Secret，DNS/部署历史只读 */
async function cf(env: AppEnv['Bindings'], path: string, init: RequestInit = {}): Promise<unknown> {
  if (!env.CF_API_TOKEN) throw new HttpError(503, 'CF_API_TOKEN 未配置（wrangler secret put CF_API_TOKEN）')
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: unknown; errors?: Array<{ message: string }> }
  if (!res.ok || !json.success) {
    throw new HttpError(502, `Cloudflare API ${res.status}: ${json.errors?.[0]?.message ?? '请求失败'}`)
  }
  return json.result
}

function requireAccount(env: AppEnv['Bindings']): string {
  if (!env.CF_ACCOUNT_ID) throw new HttpError(503, 'CF_ACCOUNT_ID 未配置（wrangler.toml [vars]）')
  return env.CF_ACCOUNT_ID
}

export const cfApp = new Hono<AppEnv>()

/** 账户资源总览：Workers / Pages / D1 / KV / R2（单项失败不影响整体） */
cfApp.get('/summary', async (c) => {
  const account = requireAccount(c.env)
  const safe = async <T>(label: string, p: Promise<T>) => {
    try {
      return { data: await p, error: null }
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e), label }
    }
  }
  const [workers, pages, d1, kv, r2] = await Promise.all([
    safe('workers', cf(c.env, `/accounts/${account}/workers/scripts`) as Promise<Array<Record<string, unknown>>>),
    safe('pages', cf(c.env, `/accounts/${account}/pages/projects`) as Promise<Array<Record<string, unknown>>>),
    safe('d1', cf(c.env, `/accounts/${account}/d1/database?per_page=50`) as Promise<{ results?: Array<Record<string, unknown>> }>),
    safe('kv', cf(c.env, `/accounts/${account}/storage/kv/namespaces?per_page=50`) as Promise<Array<Record<string, unknown>>>),
    safe('r2', cf(c.env, `/accounts/${account}/r2/buckets?per_page=50`) as Promise<{ buckets?: Array<Record<string, unknown>> }>),
  ])
  return c.json({
    workers: Array.isArray(workers.data) ? workers.data.map((w) => ({ id: w.id, name: w.id, modified_on: w.modified_on })) : [],
    pages: Array.isArray(pages.data) ? pages.data.map((p) => ({ name: p.name, subdomain: p.subdomain, created_on: p.created_on })) : [],
    d1: d1.data?.results?.map((d) => ({ name: d.name, uuid: d.uuid, created_at: d.created_at, file_size: d.file_size })) ?? [],
    kv: Array.isArray(kv.data) ? kv.data.map((n) => ({ id: n.id, title: n.title })) : [],
    r2: r2.data?.buckets?.map((b) => ({ name: b.name, creation_date: b.creation_date })) ?? [],
    errors: [workers, pages, d1, kv, r2].filter((x) => x.error),
  })
})

/** Worker 部署历史：?script=name */
cfApp.get('/worker-deployments', async (c) => {
  const account = requireAccount(c.env)
  const script = c.req.query('script')
  if (!script) return c.json({ error: 'script 必填' }, 400)
  const result = (await cf(c.env, `/accounts/${account}/workers/scripts/${script}/deployments`)) as unknown
  const items: Array<Record<string, unknown>> = Array.isArray(result)
    ? result
    : ((result as { deployments?: Array<Record<string, unknown>> })?.deployments ?? [])
  return c.json({
    deployments: items.map((d) => ({
      id: d.id,
      created_on: d.created_on,
      source: d.source,
      strategy: d.strategy,
      versions: d.versions,
    })),
  })
})

/** Pages 部署历史：?project=name */
cfApp.get('/pages-deployments', async (c) => {
  const account = requireAccount(c.env)
  const project = c.req.query('project')
  if (!project) return c.json({ error: 'project 必填' }, 400)
  const result = (await cf(c.env, `/accounts/${account}/pages/projects/${project}/deployments`)) as Array<Record<string, unknown>>
  return c.json({
    deployments: result.map((d) => ({
      id: d.id,
      created_on: d.created_on,
      environment: d.environment,
      latest_stage: (d.latest_stage as Record<string, unknown> | undefined)?.['status'] ?? null,
      branch: (d.deployment_trigger as Record<string, unknown> | undefined)?.['branch'] ?? null,
      commit_message: (d.deployment_trigger as Record<string, unknown> | undefined)?.['commit_message'] ?? null,
      url: d.url,
    })),
  })
})

/** Zone 列表 */
cfApp.get('/zones', async (c) => {
  const zones = (await cf(c.env, '/zones?per_page=50')) as Array<Record<string, unknown>>
  return c.json({
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      status: z.status,
      paused: z.paused,
      name_servers: z.name_servers,
      created_on: z.created_on,
    })),
  })
})

/** DNS 记录（只读）：?zone=zone_id */
cfApp.get('/dns', async (c) => {
  const zone = c.req.query('zone')
  if (!zone) return c.json({ error: 'zone 必填' }, 400)
  const records = (await cf(c.env, `/zones/${zone}/dns_records?per_page=100`)) as Array<Record<string, unknown>>
  return c.json({
    records: records.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      proxied: r.proxied,
      ttl: r.ttl,
      modified_on: r.modified_on,
    })),
  })
})

/** CF Registrar 域名及到期时间（仅 CF 注册的域名有数据） */
cfApp.get('/registrar', async (c) => {
  const account = requireAccount(c.env)
  const domains = (await cf(c.env, `/accounts/${account}/registrar/domains`)) as Array<Record<string, unknown>>
  return c.json({
    domains: domains.map((d) => ({
      name: d.name,
      expires_at: d.expires_at,
      auto_renew: d.auto_renew,
      status: d.status,
    })),
  })
})

/** 把 CF Registrar 到期时间 + Zone ID 同步进 domains 表（每日 cron 与手动按钮共用） */
export async function syncCfDomains(env: AppEnv['Bindings']): Promise<number> {
  if (!env.CF_API_TOKEN) return 0
  let updated = 0
  try {
    const account = requireAccount(env)
    const registrar = (await cf(env, `/accounts/${account}/registrar/domains`)) as Array<Record<string, unknown>>
    for (const d of registrar) {
      const name = d.name as string
      const expiresAt = d.expires_at ? Date.parse(d.expires_at as string) : null
      const row = await first<{ id: number }>(env.DB, 'select id from domains where name = ?', name)
      if (row) {
        await run(env.DB, 'update domains set expires_at = ?, updated_at = ? where id = ?', expiresAt, now(), row.id)
      } else {
        await run(env.DB, 'insert into domains (name, registrar, expires_at, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?)', name, 'Cloudflare Registrar', expiresAt, 'CF API 自动同步', now(), now())
      }
      updated++
    }
    const zones = (await cf(env, `/zones?per_page=50`)) as Array<Record<string, unknown>>
    for (const z of zones) {
      await run(env.DB, 'update domains set cf_zone_id = ? where name = ?', z.id, z.name)
    }
    await logEvent(env, 'expiry', 'domains.cf_sync', { detail: { updated } })
  } catch {
    // P2 集成为可选能力：未配置 Token 或 API 失败时静默跳过，由每日 cron 重试
  }
  return updated
}

cfApp.post('/sync', async (c) => {
  const updated = await syncCfDomains(c.env)
  return c.json({ ok: true, updated })
})
