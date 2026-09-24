import { useRef, useState } from 'react'
import { api } from '../api/client'
import { useApiData } from '../hooks'
import type { Asset, AssetLink } from '../api/types'
import { Modal, Field, KindBadge, StatusBadge, Loading, Empty, ErrorBanner } from '../components/ui'

const KINDS = ['site', 'app', 'worker', 'd1', 'r2', 'kv', 'repo', 'server']
const DEPLOY_TARGETS = ['gh_pages', 'cf_pages', 'cf_worker', 'cloud_vm', 'local', 'desktop', 'none']
const STATUSES = ['active', 'dev', 'archived']
const LINK_KINDS = ['serves', 'backed_by', 'data_of', 'deployed_from', 'domain_of']

const EMPTY_FORM = {
  name: '',
  slug: '',
  kind: 'site',
  status: 'active',
  url: '',
  repo: '',
  deploy_target: 'gh_pages',
  stack: '',
  description: '',
}

export default function Assets() {
  const { data, error, loading, reload } = useApiData<{ assets: Asset[]; links: AssetLink[] }>('/assets')
  const [kindFilter, setKindFilter] = useState('')
  const [search, setSearch] = useState('')

  const editRef = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<typeof EMPTY_FORM & { id?: number; metaText?: string }>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const detailRef = useRef<HTMLDialogElement>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const { data: detail, reload: reloadDetail } = useApiData<{
    asset: Asset
    links: AssetLink[]
    linkedFrom: AssetLink[]
    uptimeTargets: Array<{ id: number; name: string; url: string }>
  }>(detailId !== null ? `/assets/${detailId}` : null)

  const [linkForm, setLinkForm] = useState({ to_id: '', kind: 'backed_by', note: '' })

  const assets = (data?.assets ?? []).filter((a) => {
    if (kindFilter && a.kind !== kindFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        a.name.toLowerCase().includes(q) ||
        (a.slug ?? '').includes(q) ||
        (a.url ?? '').toLowerCase().includes(q) ||
        (a.repo ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  function openCreate() {
    setFormError(null)
    setEditing(EMPTY_FORM)
    editRef.current?.showModal()
  }

  function openEdit(a: Asset) {
    setFormError(null)
    setEditing({
      id: a.id,
      name: a.name,
      slug: a.slug,
      kind: a.kind,
      status: a.status,
      url: a.url ?? '',
      repo: a.repo ?? '',
      deploy_target: a.deploy_target ?? '',
      stack: a.stack ?? '',
      description: a.description ?? '',
      metaText: a.meta ? JSON.stringify(a.meta, null, 2) : '',
    })
    editRef.current?.showModal()
  }

  async function save() {
    try {
      setFormError(null)
      const body: Record<string, unknown> = {
        name: editing.name,
        slug: editing.slug || undefined,
        kind: editing.kind,
        status: editing.status,
        url: editing.url,
        repo: editing.repo,
        deploy_target: editing.deploy_target,
        stack: editing.stack,
        description: editing.description,
      }
      if (editing.metaText?.trim()) {
        try {
          body.meta = JSON.parse(editing.metaText)
        } catch {
          throw new Error('meta 不是合法 JSON')
        }
      }
      if (editing.id) {
        await api(`/assets/${editing.id}`, { method: 'PUT', body })
      } else {
        await api('/assets', { method: 'POST', body })
      }
      editRef.current?.close()
      await reload()
    } catch (e) {
      setFormError((e as Error).message)
    }
  }

  async function removeAsset(id: number) {
    if (!confirm('确认删除该资产？关联关系与探活目标将一并解除。')) return
    await api(`/assets/${id}`, { method: 'DELETE' })
    detailRef.current?.close()
    setDetailId(null)
    await reload()
  }

  async function addLink() {
    if (!detailId || !linkForm.to_id) return
    try {
      await api(`/assets/${detailId}/links`, {
        method: 'POST',
        body: { to_id: Number(linkForm.to_id), kind: linkForm.kind, note: linkForm.note || undefined },
      })
      setLinkForm({ to_id: '', kind: 'backed_by', note: '' })
      await Promise.all([reloadDetail(), reload()])
    } catch (e) {
      alert((e as Error).message)
    }
  }

  async function removeLink(linkId: number) {
    await api(`/assets/links/${linkId}`, { method: 'DELETE' })
    await Promise.all([reloadDetail(), reload()])
  }

  function assetName(id: number): string {
    return data?.assets.find((a) => a.id === id)?.name ?? `#${id}`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">资产台账</h1>
        <div className="flex gap-2 flex-wrap">
          <input
            className="input input-bordered input-sm w-44"
            placeholder="搜索名称 / URL / 仓库"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select select-bordered select-sm w-28" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">全部类型</option>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            + 新建资产
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {loading ? (
        <Loading />
      ) : assets.length === 0 ? (
        <Empty text="没有匹配的资产" />
      ) : (
        <div className="bg-base-100 rounded-box border border-base-300 overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>URL</th>
                <th>仓库</th>
                <th>部署</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="hover">
                  <td className="font-medium whitespace-nowrap">{a.name}</td>
                  <td><KindBadge kind={a.kind} /></td>
                  <td className="max-w-52">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className="link link-hover text-primary text-xs truncate block">
                        {a.url.replace(/^https?:\/\//, '')}
                      </a>
                    ) : (
                      <span className="opacity-30 text-xs">—</span>
                    )}
                  </td>
                  <td className="text-xs opacity-70 whitespace-nowrap">{a.repo || '—'}</td>
                  <td className="text-xs opacity-70">{a.deploy_target || '—'}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn btn-ghost btn-xs" onClick={() => { setDetailId(a.id); detailRef.current?.showModal() }}>
                      详情
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => openEdit(a)}>
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新建/编辑 */}
      <Modal
        ref={editRef}
        title={editing.id ? '编辑资产' : '新建资产'}
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
        <ErrorBanner message={formError} />
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="名称">
            <input className="input input-bordered w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label="Slug（英文标识，可留空自动生成）">
            <input className="input input-bordered w-full" value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} />
          </Field>
          <Field label="类型">
            <select className="select select-bordered w-full" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="状态">
            <select className="select select-bordered w-full" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="访问 URL">
            <input className="input input-bordered w-full" placeholder="https://hrt.ttfl.net" value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
          </Field>
          <Field label="Git 仓库（owner/repo）">
            <input className="input input-bordered w-full" placeholder="Tia-Nina/ttfl.net-hrt" value={editing.repo} onChange={(e) => setEditing({ ...editing, repo: e.target.value })} />
          </Field>
          <Field label="部署位置">
            <select className="select select-bordered w-full" value={editing.deploy_target} onChange={(e) => setEditing({ ...editing, deploy_target: e.target.value })}>
              {DEPLOY_TARGETS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="技术栈">
            <input className="input input-bordered w-full" placeholder="React 19 / Vite / Tailwind" value={editing.stack} onChange={(e) => setEditing({ ...editing, stack: e.target.value })} />
          </Field>
        </div>
        <Field label="描述">
          <textarea className="textarea textarea-bordered w-full" rows={2} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
        </Field>
        <Field label="扩展信息（JSON，可选）">
          <textarea className="textarea textarea-bordered w-full font-mono text-xs" rows={3} placeholder='{"health": "/healthz"}' value={editing.metaText ?? ''} onChange={(e) => setEditing({ ...editing, metaText: e.target.value })} />
        </Field>
      </Modal>

      {/* 详情 + 关联关系 */}
      <Modal
        ref={detailRef}
        title="资产详情"
        wide
        actions={
          detail && (
            <>
              <button className="btn btn-error btn-outline btn-sm" onClick={() => removeAsset(detail.asset.id)}>
                删除资产
              </button>
              <button className="btn" onClick={() => detailRef.current?.close()}>
                关闭
              </button>
            </>
          )
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="opacity-50">名称：</span>{detail.asset.name}</div>
              <div><span className="opacity-50">类型：</span><KindBadge kind={detail.asset.kind} /></div>
              <div className="col-span-2"><span className="opacity-50">URL：</span>{detail.asset.url ? <a className="link" href={detail.asset.url} target="_blank" rel="noreferrer">{detail.asset.url}</a> : '—'}</div>
              <div className="col-span-2"><span className="opacity-50">仓库：</span>{detail.asset.repo || '—'}</div>
              <div className="col-span-2"><span className="opacity-50">技术栈：</span>{detail.asset.stack || '—'}</div>
              <div className="col-span-2"><span className="opacity-50">描述：</span>{detail.asset.description || '—'}</div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">关联关系</h4>
              {detail.links.length + detail.linkedFrom.length === 0 ? (
                <p className="text-xs opacity-40 mb-2">暂无关联</p>
              ) : (
                <ul className="text-sm space-y-1 mb-2">
                  {detail.links.map((l) => (
                    <li key={l.id} className="flex items-center gap-2">
                      <span className="badge badge-xs badge-outline">{l.kind}</span>
                      → {assetName(l.to_id)}
                      {l.note && <span className="opacity-40 text-xs">{l.note}</span>}
                      <button className="btn btn-ghost btn-xs ml-auto" onClick={() => removeLink(l.id)}>移除</button>
                    </li>
                  ))}
                  {detail.linkedFrom.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 opacity-80">
                      <span className="badge badge-xs badge-outline">{l.kind}</span>
                      ← {assetName(l.from_id)}
                      {l.note && <span className="opacity-40 text-xs">{l.note}</span>}
                      <button className="btn btn-ghost btn-xs ml-auto" onClick={() => removeLink(l.id)}>移除</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 items-end">
                <select className="select select-bordered select-sm flex-1" value={linkForm.to_id} onChange={(e) => setLinkForm({ ...linkForm, to_id: e.target.value })}>
                  <option value="">选择资产…</option>
                  {(data?.assets ?? []).filter((a) => a.id !== detailId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <select className="select select-bordered select-sm w-36" value={linkForm.kind} onChange={(e) => setLinkForm({ ...linkForm, kind: e.target.value })}>
                  {LINK_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <button className="btn btn-sm" onClick={addLink} disabled={!linkForm.to_id}>
                  关联
                </button>
              </div>
            </div>

            {detail.uptimeTargets.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2">探活目标</h4>
                <ul className="text-sm space-y-1">
                  {detail.uptimeTargets.map((t) => (
                    <li key={t.id} className="opacity-80">{t.name} · {t.url}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
