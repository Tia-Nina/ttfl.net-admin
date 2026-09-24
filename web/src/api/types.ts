export interface SessionUser {
  id: number
  name: string
  role: string
}

export interface Asset {
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
  meta: Record<string, unknown> | null
  created_at: number
  updated_at: number
}

export interface AssetLink {
  id: number
  from_id: number
  to_id: number
  kind: string
  note: string | null
  to_name?: string
  to_kind?: string
  from_name?: string
  from_kind?: string
}

export interface UptimeTarget {
  id: number
  asset_id: number | null
  asset_name?: string | null
  name: string
  url: string
  method: string
  expect_status: number
  interval_sec: number
  enabled: number
  last_checked_at: number | null
  last_ok: number | null
  last_status: number | null
  last_latency: number | null
}

export interface UptimePoint {
  ts: number
  ok: number
  status_code: number | null
  latency_ms: number | null
  error: string | null
}

export interface HubEvent {
  id: number
  ts: number
  type: string
  actor: string | null
  action: string
  target: string | null
  detail: string | null
}

export interface Domain {
  id: number
  name: string
  registrar: string | null
  expires_at: number | null
  cf_zone_id: string | null
  notes: string | null
}

export interface SecretMeta {
  id: number
  service: string
  name: string
  scope_note: string | null
  rotated_at: number | null
  expires_at: number | null
  notes: string | null
}

export interface Overview {
  assets: {
    total: number
    active: number
    byKind: Array<{ kind: string; total: number; active: number }>
  }
  uptime: {
    up: number
    down: number
    pending: number
    targets: UptimeTarget[]
  }
  expiringDomains: Array<{ name: string; registrar: string | null; expires_at: number }>
  recentEvents: HubEvent[]
}

export interface SystemInfo {
  setupDone: boolean
  authOrigin: string
  hubOrigin: string
  tokens: { jwt: boolean; setup: boolean; github: boolean; cloudflare: boolean; cfAccount: boolean }
}

export interface PasskeyCredential {
  id: number
  credential_id: string
  label: string | null
  created_at: number
  last_used_at: number | null
}
