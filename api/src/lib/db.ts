import type { D1Database } from '@cloudflare/workers-types'

export const now = () => Date.now()

export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>()
  return results ?? []
}

export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>()
}

export async function run(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<void> {
  await db.prepare(sql).bind(...params).run()
}

export function jsonify(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}
