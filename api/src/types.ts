import type { D1Database, Fetcher } from '@cloudflare/workers-types'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher

  // Secrets（wrangler secret put）
  JWT_SECRET?: string
  SETUP_TOKEN?: string
  GH_TOKEN?: string
  CF_API_TOKEN?: string

  // Vars（wrangler.toml [vars]）
  COOKIE_DOMAIN: string
  COOKIE_NAME: string
  SESSION_TTL_SEC: string
  PUBLIC_AUTH_ORIGIN: string
  PUBLIC_HUB_ORIGIN: string
  CF_ACCOUNT_ID: string
}

export interface SessionPayload {
  sub: number
  name: string
  role: string
  iat: number
  exp: number
}

export type AppEnv = {
  Bindings: Env
  Variables: { session?: SessionPayload }
}
