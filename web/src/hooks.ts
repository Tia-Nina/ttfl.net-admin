import { useCallback, useEffect, useState } from 'react'
import { api } from './api/client'

/** 简单数据拉取 hook：path 变化自动重新加载；path 为 null 时不请求 */
export function useApiData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!path) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setData(await api<T>(path))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, loading, reload }
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return `${Math.floor(diff / 86400_000)} 天前`
}

export function formatTs(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
