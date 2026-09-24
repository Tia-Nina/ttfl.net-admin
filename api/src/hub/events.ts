import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { all } from '../lib/db'

export const eventsApp = new Hono<AppEnv>()

/** ?type=audit|uptime|deploy|expiry|auth&limit=50&before_id= */
eventsApp.get('/', async (c) => {
  const type = c.req.query('type')
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
  const beforeId = Number(c.req.query('before_id')) || 0

  const where: string[] = []
  const params: unknown[] = []
  if (type) {
    where.push('type = ?')
    params.push(type)
  }
  if (beforeId) {
    where.push('id < ?')
    params.push(beforeId)
  }
  const clause = where.length ? `where ${where.join(' and ')}` : ''
  const events = await all(c.env.DB, `select * from events ${clause} order by id desc limit ?`, ...params, limit)
  return c.json({ events })
})
