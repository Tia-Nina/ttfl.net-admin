import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api/client'
import { useApiData } from '../hooks'
import { Modal, Field, Loading, Empty, ErrorBanner } from '../components/ui'

const RUN_ICON: Record<string, string> = {
  success: '✅',
  failure: '❌',
  cancelled: '🚫',
  in_progress: '🔄',
  queued: '⏳',
}
const RUN_BADGE: Record<string, string> = {
  success: 'badge-success',
  failure: 'badge-error',
  cancelled: 'badge-ghost',
  in_progress: 'badge-info',
  queued: 'badge-ghost',
}

function GitHubTab() {
  const { data, error, loading } = useApiData<{ repos: Array<{ full_name: string; default_branch: string | null; private: number }> }>('/github/repos')
  const [repo, setRepo] = useState('')
  const [workflows, setWorkflows] = useState<Array<{ id: number; name: string; path: string; state: string }>>([])
  const [runs, setRuns] = useState<Array<Record<string, unknown>>>([])
  const [err, setErr] = useState<string | null>(null)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const dispatchRef = useRef<HTMLDialogElement>(null)
  const [dispatchForm, setDispatchForm] = useState({ workflow: '', ref: 'main' })
  const [dispatching, setDispatching] = useState(false)

  useEffect(() => {
    if (!repo) return
    setLoadingRuns(true)
    Promise.all([
      api<{ workflows: typeof workflows }>(`/github/workflows?repo=${repo}`),
      api<{ runs: Array<Record<string, unknown>> }>(`/github/runs?repo=${repo}`),
    ])
      .then(([w, r]) => {
        setWorkflows(w.workflows)
        setRuns(r.runs)
        setErr(null)
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoadingRuns(false))
  }, [repo])

  async function dispatch() {
    try {
      setDispatching(true)
      await api('/github/dispatch', { method: 'POST', body: { repo, workflow: dispatchForm.workflow, ref: dispatchForm.ref } })
      dispatchRef.current?.close()
      await new Promise((r) => setTimeout(r, 2000))
      const r = await api<{ runs: Array<Record<string, unknown>> }>(`/github/runs?repo=${repo}`)
      setRuns(r.runs)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setDispatching(false)
    }
  }

  async function rerun(runId: unknown) {
    if (!confirm('确认重跑该工作流运行？（GH Pages 的“回滚”即重跑旧 commit）')) return
    try {
      await api('/github/rerun', { method: 'POST', body: { repo, run_id: runId } })
      const r = await api<{ runs: Array<Record<string, unknown>> }>(`/github/runs?repo=${repo}`)
      setRuns(r.runs)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrorBanner message={error} />

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <select className="select select-bordered select-sm w-64" value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="">选择仓库…</option>
          {(data?.repos ?? []).map((r) => (
            <option key={r.full_name} value={r.full_name}>
              {r.full_name}
            </option>
          ))}
        </select>
        {repo && (
          <button className="btn btn-primary btn-sm" onClick={() => dispatchRef.current?.showModal()}>
            触发工作流
          </button>
        )}
        {repo && (
          <button className="btn btn-ghost btn-sm" onClick={() => setRepo(repo)}>
            刷新
          </button>
        )}
      </div>

      <ErrorBanner message={err} />
      {!repo ? (
        <Empty text="选择一个仓库查看工作流与运行记录" />
      ) : loadingRuns ? (
        <Loading />
      ) : (
        <>
          {workflows.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {workflows.map((w) => (
                <span key={w.id} className="badge badge-sm badge-outline">
                  {w.name}
                </span>
              ))}
            </div>
          )}
          {runs.length === 0 ? (
            <Empty text="该仓库没有工作流运行记录（或未启用 Actions）" />
          ) : (
            <div className="bg-base-100 rounded-box border border-base-300 overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>工作流</th>
                    <th>状态</th>
                    <th>分支 / 提交</th>
                    <th>时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={String(r.id)}>
                      <td className="opacity-50">{String(r.run_number)}</td>
                      <td className="whitespace-nowrap">{String(r.name)}</td>
                      <td>
                        <span className={`badge badge-sm ${RUN_BADGE[String(r.conclusion ?? r.status)] ?? 'badge-ghost'}`}>
                          {RUN_ICON[String(r.conclusion ?? r.status)] ?? ''} {String(r.conclusion ?? r.status)}
                        </span>
                      </td>
                      <td className="text-xs">
                        {String(r.head_branch)} · <code>{String(r.head_sha).slice(0, 7)}</code>
                      </td>
                      <td className="text-xs opacity-50 whitespace-nowrap">{new Date(String(r.created_at)).toLocaleString('zh-CN', { hour12: false })}</td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn btn-ghost btn-xs" onClick={() => rerun(r.id)}>
                          重跑
                        </button>
                        <a className="btn btn-ghost btn-xs" href={String(r.html_url)} target="_blank" rel="noreferrer">
                          详情
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        ref={dispatchRef}
        title="触发工作流（workflow_dispatch）"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => dispatchRef.current?.close()}>
              取消
            </button>
            <button className="btn btn-primary" onClick={dispatch} disabled={dispatching}>
              {dispatching && <span className="loading loading-spinner loading-xs" />} 触发
            </button>
          </>
        }
      >
        <Field label="工作流">
          <select className="select select-bordered w-full" value={dispatchForm.workflow} onChange={(e) => setDispatchForm({ ...dispatchForm, workflow: e.target.value })}>
            <option value="">选择工作流…</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.path.replace('workflows/', '')}>
                {w.name}（{w.path.replace('workflows/', '')}）
              </option>
            ))}
          </select>
        </Field>
        <Field label="分支 / Ref">
          <input className="input input-bordered w-full" value={dispatchForm.ref} onChange={(e) => setDispatchForm({ ...dispatchForm, ref: e.target.value })} />
        </Field>
        <p className="text-xs opacity-50">工作流必须包含 on: workflow_dispatch 触发器</p>
      </Modal>
    </div>
  )
}

function CloudflareTab() {
  const { data, error, loading } = useApiData<{
    workers: Array<{ name: string; modified_on: string | null }>
    pages: Array<{ name: string }>
    d1: Array<{ name: string; file_size: number | null }>
    kv: Array<{ title: string }>
    r2: Array<{ name: string }>
    errors: Array<{ label?: string; error: string }>
  }>('/cf/summary')

  const [detail, setDetail] = useState<{ kind: 'worker' | 'pages'; name: string; rows: Array<Record<string, unknown>> } | null>(null)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  async function showDeployments(kind: 'worker' | 'pages', name: string) {
    setDetailErr(null)
    setDetail(null)
    try {
      const q = kind === 'worker' ? `script=${name}` : `project=${name}`
      const r = await api<{ deployments: Array<Record<string, unknown>> }>(`/cf/${kind === 'worker' ? 'worker' : 'pages'}-deployments?${q}`)
      setDetail({ kind, name, rows: r.deployments })
    } catch (e) {
      setDetailErr((e as Error).message)
    }
  }

  async function syncDomains() {
    setSyncing(true)
    try {
      await api('/cf/sync', { method: 'POST', body: {} })
      alert('已同步 CF Registrar 域名到期时间与 Zone ID')
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrorBanner message={error} />
  if (!data) return null

  return (
    <div className="space-y-4">
      {data.errors.length > 0 && (
        <div className="alert alert-warning text-sm py-2">
          <span>部分查询失败：{data.errors.map((e) => `${e.label}: ${e.error}`).join('；')}</span>
        </div>
      )}

      <Section title={`Workers（${data.workers.length}）`}>
        {data.workers.map((w) => (
          <Row key={w.name} title={w.name} sub={w.modified_on ? `更新于 ${new Date(w.modified_on).toLocaleString('zh-CN', { hour12: false })}` : ''} onClick={() => showDeployments('worker', w.name)} action="部署历史" />
        ))}
      </Section>
      <Section title={`Pages（${data.pages.length}）`}>
        {data.pages.map((p) => (
          <Row key={p.name} title={p.name} onClick={() => showDeployments('pages', p.name)} action="部署历史" />
        ))}
      </Section>
      <Section title={`D1（${data.d1.length}）`}>
        {data.d1.map((d) => (
          <Row key={d.name} title={d.name} sub={d.file_size != null ? `${(Number(d.file_size) / 1024 / 1024).toFixed(2)} MB` : ''} />
        ))}
      </Section>
      <Section title={`KV（${data.kv.length}）`}>
        {data.kv.map((n) => (
          <Row key={n.title} title={n.title} />
        ))}
      </Section>
      <Section title={`R2（${data.r2.length}）`}>
        {data.r2.map((b) => (
          <Row key={b.name} title={b.name} />
        ))}
      </Section>

      <div className="flex justify-end">
        <button className="btn btn-sm" onClick={syncDomains} disabled={syncing}>
          {syncing && <span className="loading loading-spinner loading-xs" />} 同步域名到期时间（CF Registrar）
        </button>
      </div>

      {detailErr && <ErrorBanner message={detailErr} />}
      {detail && (
        <div className="bg-base-100 rounded-box border border-base-300 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">
              {detail.kind === 'worker' ? 'Worker' : 'Pages'}「{detail.name}」部署历史
            </h3>
            <button className="btn btn-ghost btn-xs" onClick={() => setDetail(null)}>
              收起
            </button>
          </div>
          {detail.rows.length === 0 ? (
            <Empty text="暂无部署记录" />
          ) : (
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>环境</th>
                  <th>状态</th>
                  <th>信息</th>
                </tr>
              </thead>
              <tbody>
                {detail.rows.map((r, i) => (
                  <tr key={String(r.id ?? i)}>
                    <td className="text-xs whitespace-nowrap">{r.created_on ? new Date(String(r.created_on)).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                    <td className="text-xs">{String(r.environment ?? '—')}</td>
                    <td className="text-xs">{String(r.latest_stage ?? r.source ?? '—')}</td>
                    <td className="text-xs opacity-70 truncate max-w-64">{String(r.commit_message ?? r.strategy ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      <div className="bg-base-100 rounded-box border border-base-300 divide-y divide-base-200">
        {children}
      </div>
    </div>
  )
}

function Row({ title, sub, onClick, action }: { title: string; sub?: string; onClick?: () => void; action?: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        {sub && <div className="text-xs opacity-50">{sub}</div>}
      </div>
      {onClick && (
        <button className="btn btn-ghost btn-xs" onClick={onClick}>
          {action}
        </button>
      )}
    </div>
  )
}

export default function Deployments() {
  const [tab, setTab] = useState<'gh' | 'cf'>('gh')
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">部署管理</h1>
      <div role="tablist" className="tabs tabs-box w-fit">
        <button role="tab" className={`tab ${tab === 'gh' ? 'tab-active' : ''}`} onClick={() => setTab('gh')}>
          GitHub Actions
        </button>
        <button role="tab" className={`tab ${tab === 'cf' ? 'tab-active' : ''}`} onClick={() => setTab('cf')}>
          Cloudflare
        </button>
      </div>
      {tab === 'gh' ? <GitHubTab /> : <CloudflareTab />}
    </div>
  )
}
