import { useRef, useState } from 'react'
import { api } from '../api/client'
import { useApiData, formatTs } from '../hooks'
import type { Domain } from '../api/types'
import { Modal, Field, Loading, Empty, ErrorBanner } from '../components/ui'

function expiryBadge(expiresAt: number | null) {
  if (!expiresAt) return <span className="badge badge-ghost badge-sm">未知</span>
  const days = Math.ceil((expiresAt - Date.now()) / 86400000)
  if (days <= 7) return <span className="badge badge-error badge-sm">{days} 天后到期</span>
  if (days <= 30) return <span className="badge badge-warning badge-sm">{days} 天后到期</span>
  return <span className="badge badge-ghost badge-sm">{days} 天</span>
}

interface DnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
}

export default function Domains() {
  const { data, error, loading, reload } = useApiData<{ domains: Domain[] }>('/system/domains')
  const { data: zonesData } = useApiData<{ zones: Array<{ id: string; name: string; status: string }> }>('/cf/zones')
  const [zone, setZone] = useState('')
  const { data: dnsData, loading: dnsLoading } = useApiData<{ records: DnsRecord[] }>(zone ? `/cf/dns?zone=${zone}` : null)

  const editRef = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<Partial<Domain> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function openEdit(d?: Domain) {
    setFormError(null)
    setEditing(d ?? { name: '', registrar: '', expires_at: null, notes: '' })
    editRef.current?.showModal()
  }

  async function save() {
    if (!editing) return
    try {
      setFormError(null)
      if (editing.id) {
        await api(`/system/domains/${editing.id}`, { method: 'PUT', body: editing })
      } else {
        await api('/system/domains', { method: 'POST', body: editing })
      }
      editRef.current?.close()
      await reload()
    } catch (e) {
      setFormError((e as Error).message)
    }
  }

  async function remove(id: number) {
    if (!confirm('确认删除该域名记录？')) return
    await api(`/system/domains/${id}`, { method: 'DELETE' })
    await reload()
  }

  async function sync() {
    try {
      const r = await api<{ updated: number }>('/cf/sync', { method: 'POST', body: {} })
      alert(`已从 Cloudflare 同步 ${r.updated} 个域名`)
      await reload()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">域名 / DNS</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={sync}>
            从 CF 同步
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => openEdit()}>
            + 登记域名
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {loading ? (
        <Loading />
      ) : (data?.domains ?? []).length === 0 ? (
        <Empty text="还没有登记域名" />
      ) : (
        <div className="bg-base-100 rounded-box border border-base-300 overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>域名</th>
                <th>到期</th>
                <th>注册商</th>
                <th>到期时间</th>
                <th>备注</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.domains ?? []).map((d) => (
                <tr key={d.id} className="hover">
                  <td className="font-medium whitespace-nowrap">{d.name}</td>
                  <td>{expiryBadge(d.expires_at)}</td>
                  <td className="text-xs opacity-70">{d.registrar || '—'}</td>
                  <td className="text-xs opacity-70 whitespace-nowrap">{formatTs(d.expires_at)}</td>
                  <td className="text-xs opacity-50 max-w-52 truncate">{d.notes || ''}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn btn-ghost btn-xs" onClick={() => openEdit(d)}>
                      编辑
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => remove(d.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* DNS 记录查看（只读） */}
      <div className="bg-base-100 rounded-box border border-base-300 p-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h3 className="font-semibold text-sm">DNS 记录（Cloudflare · 只读）</h3>
          <select className="select select-bordered select-sm w-56" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">选择 Zone…</option>
            {(zonesData?.zones ?? []).map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}（{z.status}）
              </option>
            ))}
          </select>
        </div>
        {zone && dnsLoading ? (
          <Loading />
        ) : zone && (dnsData?.records ?? []).length === 0 ? (
          <Empty text="该 Zone 无 DNS 记录" />
        ) : zone ? (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>名称</th>
                  <th>内容</th>
                  <th>代理</th>
                  <th>TTL</th>
                </tr>
              </thead>
              <tbody>
                {(dnsData?.records ?? []).map((r) => (
                  <tr key={r.id}>
                    <td><span className="badge badge-ghost badge-sm">{r.type}</span></td>
                    <td className="text-xs whitespace-nowrap">{r.name}</td>
                    <td className="text-xs max-w-72 truncate" title={r.content}>{r.content}</td>
                    <td className="text-xs">{r.proxied ? '🟠 已代理' : '仅 DNS'}</td>
                    <td className="text-xs opacity-50">{r.ttl === 1 ? 'Auto' : r.ttl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs opacity-40">选择 Zone 查看记录。DNS 编辑功能将在后续版本提供。</p>
        )}
      </div>

      <Modal
        ref={editRef}
        title={editing?.id ? '编辑域名' : '登记域名'}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => editRef.current?.close()}>
              取消
            </button>
            <button className="btn btn-primary" onClick={save}>
              保存
            </button>
          </>
        }
      >
        {editing && (
          <div>
            <ErrorBanner message={formError} />
            <Field label="域名">
              <input className="input input-bordered w-full" placeholder="ttfl.net" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="注册商">
              <input className="input input-bordered w-full" placeholder="Cloudflare Registrar" value={editing.registrar ?? ''} onChange={(e) => setEditing({ ...editing, registrar: e.target.value })} />
            </Field>
            <Field label="到期日期（留空则由 CF 同步）">
              <input
                type="date"
                className="input input-bordered w-full"
                value={editing.expires_at ? new Date(editing.expires_at).toISOString().slice(0, 10) : ''}
                onChange={(e) => setEditing({ ...editing, expires_at: e.target.value ? new Date(e.target.value).getTime() : null })}
              />
            </Field>
            <Field label="备注">
              <textarea className="textarea textarea-bordered w-full" rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
