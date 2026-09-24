/** 认证中台地址：本地开发可用 VITE_AUTH_ORIGIN 覆盖 */
export const AUTH_ORIGIN = import.meta.env.VITE_AUTH_ORIGIN ?? 'https://auth.ttfl.net'

/** 中枢 BFF 地址：生产指向 api.ttfl.net；本地开发置空走 vite 代理（同源免跨域 Cookie） */
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://api.ttfl.net'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 401) {
    // 会话失效 → 跳认证中台，登录后跳回当前页
    const back = encodeURIComponent(location.href)
    location.href = `${AUTH_ORIGIN}/?redirect=${back}`
    throw new ApiError(401, '未登录，正在跳转认证中台…')
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? `请求失败（${res.status}）`)
  }
  return json as T
}

/** 调认证中台（跨子域，凭 Cookie） */
export async function authApi<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${AUTH_ORIGIN}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const json = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? `认证中台请求失败（${res.status}）`)
  }
  return json as T
}
