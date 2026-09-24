import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all, first, run, now, jsonify } from '../lib/db'
import { logEvent } from '../lib/audit'

const KINDS = ['site', 'app', 'worker', 'd1', 'r2', 'kv', 'repo', 'server']
const LINK_KINDS = ['serves', 'backed_by', 'data_of', 'deployed_from', 'domain_of']
const STATUSES = ['active', 'dev', 'archived']

interface AssetRow {
  id: number
  kind: string
  name: string
  slug: string
  description: string | null
  url: string | null
  repo: string | null
  deploy_target: string | null
  stack: string | null
  status: string
  meta: string | null
}

function pickAssetFields(body: Record<string, unknown>) {
  return {
    kind: typeof body.kind === 'string' ? body.kind : undefined,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    slug: typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : undefined,
    description: typeof body.description === 'string' ? body.description : null,
    url: typeof body.url === 'string' ? body.url : null,
    repo: typeof body.repo === 'string' ? body.repo : null,
    deploy_target: typeof body.deploy_target === 'string' ? body.deploy_target : null,
    stack: typeof body.stack === 'string' ? body.stack : null,
    status: typeof body.status === 'string' ? body.status : 'active',
    meta: body.meta !== undefined ? jsonify(body.meta) : null,
  }
}

function autoSlug(name: string): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ascii || `a${now().toString(36)}`
}

export const assetsApp = new Hono<AppEnv>()

assetsApp.get('/', async (c) => {
  const assets = await all<AssetRow>(c.env.DB, 'select * from assets order by kind, id')
  const links = await all(c.env.DB, 'select * from asset_links')
  return c.json({
    assets: assets.map((a) => ({ ...a, meta: a.meta ? JSON.parse(a.meta) : null })),
    links,
  })
})

assetsApp.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const asset = await first<AssetRow>(c.env.DB, 'select * from assets where id = ?', id)
  if (!asset) return c.json({ error: '资产不存在' }, 404)
  const links = await all(
    c.env.DB,
    `select l.*, a.name as to_name, a.kind as to_kind from asset_links l
     join assets a on a.id = l.to_id where l.from_id = ?`,
    id,
  )
  const linkedFrom = await all(
    c.env.DB,
    `select l.*, a.name as from_name, a.kind as from_kind from asset_links l
     join assets a on a.id = l.from_id where l.to_id = ?`,
    id,
  )
  const targets = await all(c.env.DB, 'select * from uptime_targets where asset_id = ?', id)
  return c.json({
    asset: { ...asset, meta: asset.meta ? JSON.parse(asset.meta) : null },
    links,
    linkedFrom,
    uptimeTargets: targets,
  })
})

assetsApp.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const f = pickAssetFields(body)
  if (!f.name) return c.json({ error: 'name 必填' }, 400)
  if (!f.kind || !KINDS.includes(f.kind)) return c.json({ error: `kind 必须是 ${KINDS.join('/')}` }, 400)
  if (!STATUSES.includes(f.status)) return c.json({ error: `status 必须是 ${STATUSES.join('/')}` }, 400)

  let slug = f.slug || autoSlug(f.name)
  const exists = await first(c.env.DB, 'select id from assets where slug = ?', slug)
  if (exists) slug = `${slug}-${now().toString(36).slice(-4)}`

  const res = await c.env.DB.prepare(
    `insert into assets (kind, name, slug, description, url, repo, deploy_target, stack, status, meta, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(f.kind, f.name, slug, f.description, f.url, f.repo, f.deploy_target, f.stack, f.status, f.meta, now(), now())
    .run()
  const id = Number((res as { meta?: { last_row_id?: number } }).meta?.last_row_id)
  await logEvent(c.env, 'audit', 'assets.create', { target: `asset:${id}`, detail: { name: f.name, kind: f.kind } })
  return c.json({ id }, 201)
})

assetsApp.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const asset = await first<AssetRow>(c.env.DB, 'select * from assets where id = ?', id)
  if (!asset) return c.json({ error: '资产不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  if (body.kind !== undefined && !KINDS.includes(body.kind)) return c.json({ error: 'kind 不合法' }, 400)
  if (body.status !== undefined && !STATUSES.includes(body.status)) return c.json({ error: 'status 不合法' }, 400)

  const cols = ['kind', 'name', 'slug', 'description', 'url', 'repo', 'deploy_target', 'stack', 'status'] as const
  const sets: string[] = []
  const vals: unknown[] = []
  for (const col of cols) {
    if (body[col] === undefined) continue
    if ((col === 'name' || col === 'slug') && (typeof body[col] !== 'string' || !body[col].trim())) {
      return c.json({ error: `${col} 不能为空` }, 400)
    }
    sets.push(`${col} = ?`)
    vals.push(col === 'name' || col === 'slug' ? body[col].trim() : body[col])
  }
  if (body.meta !== undefined) {
    sets.push('meta = ?')
    vals.push(jsonify(body.meta))
  }
  if (sets.length === 0) return c.json({ error: '没有可更新的字段' }, 400)
  sets.push('updated_at = ?')
  vals.push(now(), id)
  await run(c.env.DB, `update assets set ${sets.join(', ')} where id = ?`, ...vals)
  await logEvent(c.env, 'audit', 'assets.update', { target: `asset:${id}`, detail: { fields: sets } })
  return c.json({ ok: true })
})

assetsApp.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await run(c.env.DB, 'delete from assets where id = ?', id)
  await logEvent(c.env, 'audit', 'assets.delete', { target: `asset:${id}` })
  return c.json({ ok: true })
})

assetsApp.post('/:id/links', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const toId = Number(body.to_id)
  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!LINK_KINDS.includes(kind)) return c.json({ error: `kind 必须是 ${LINK_KINDS.join('/')}` }, 400)
  if (!toId || toId === id) return c.json({ error: 'to_id 不合法' }, 400)
  const target = await first(c.env.DB, 'select id from assets where id = ?', toId)
  if (!target) return c.json({ error: '目标资产不存在' }, 404)
  await run(
    c.env.DB,
    'insert or ignore into asset_links (from_id, to_id, kind, note) values (?, ?, ?, ?)',
    id, toId, kind, typeof body.note === 'string' ? body.note : null,
  )
  await logEvent(c.env, 'audit', 'assets.link', { target: `asset:${id}`, detail: { to: toId, kind } })
  return c.json({ ok: true }, 201)
})

assetsApp.delete('/links/:linkId', async (c) => {
  const linkId = Number(c.req.param('linkId'))
  await run(c.env.DB, 'delete from asset_links where id = ?', linkId)
  await logEvent(c.env, 'audit', 'assets.unlink', { target: `link:${linkId}` })
  return c.json({ ok: true })
})
