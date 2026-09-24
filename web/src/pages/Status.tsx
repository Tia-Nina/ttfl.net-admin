import { useRef, useState } from 'react'
import { api } from '../api/client'
import { useApiData } from '../hooks'
import type { Asset, UptimePoint, UptimeTarget } from '../api/types'
import { Modal, Field, UpBadge, Loading, Empty, ErrorBanner } from '../components/ui'

interface ResultsResp {
  since: number
  targets: Array<{ id: number; name: string; url: string; enabled: number } & { points: UptimePoint[] }>
}

/** 资产下拉选项（独立加载） */
function AssetOptions({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { data } = useApiData<{ assets: Asset[] }>('/assets')
  return (
    <select
      className="select select-bordered w-full"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">不关联</option>
      {(data?.assets ?? []).map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}（{a.kind}）
        </option>
      ))}
    </select>
  )
}

/** 把明细点聚合成 48 个 30 分钟桶，渲染 24h 时间线条 */
function bar24(points: UptimePoint[], since: number) {
  const buckets = Array.from<number>({ length: 48 }).fill(-1) // -1 无数据 / 1 ok / 0 down
  const span = Date.now() - since
  for (const p of points) {
    const idx = Math.min(47, Math.max(0, Math.floor(((p.ts - since) / span) * 48)))
    buckets[idx] = buckets[idx] === 0 ? 0 : p.ok ? 1 : 0
  }
  return buckets
}

export default function Status() {
  const { data, error, loading, reload } = useApiData<ResultsResp>('/uptime/results?hours=24')
  const { data: targetsData, reload: reloadTargets } = useApiData<{ targets: UptimeTarget[] }>('/uptime/targets')
  const [busy, setBusy] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const editRef = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<Partial<UptimeTarget> | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  if (loading) return <Loading />
  if (error) return <ErrorBanner message={error} />
  if (!data) return null

  async function runNow() {
    setBusy(true)
    try {
      await api('/uptime/run', { method: 'POST', body: {} })
      await Promise.all([reload(), reloadTargets()])
    } finally {
      setBusy(false)
    }
  }

  function openEdit(t?: UptimeTarget) {
    setFormError(null)
    setEditing(
      t ?? { name: '', url: '', method: 'GET', expect_status: 200, interval_sec: 300, enabled: 1, asset_id: null },
    )
    editRef.current?.showModal()
  }

  async function saveTarget() {
    if (!editing) return
    try {
      setFormError(null)
      if (editing.id) {
        await api(`/uptime/targets/${editing.id}`, { method: 'PUT', body: editing })
      } else {
        await api('/uptime/targets', { method: 'POST', body: editing })
      }
      editRef.current?.close()
      await Promise.all([reload(), reloadTargets()])
    } catch (e) {
      setFormError((e as Error).message)
    }
  }

  async function removeTarget(id: number) {
    if (!confirm('确认删除该探活目标？历史结果将一并删除。')) return
    await api(`/uptime/targets/${id}`, { method: 'DELETE' })
    await Promise.all([reload(), reloadTargets()])
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">探活状态（近 24 小时）</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={runNow} disabled={busy}>
            {busy && <span className="loading loading-spinner loading-xs" />} 立即检测
          </button>
          <button className="btn btn-sm" onClick={() => setManageOpen((v) => !v)}>
            {manageOpen ? '完成' : '管理目标'}
          </button>
        </div>
      </div>

      {data.targets.length === 0 ? (
        <Empty text="还没有探活目标，点击「管理目标」添加" />
      ) : (
        <div className="space-y-3">
          {data.targets.map((t) => {
            const last = t.points[t.points.length - 1]
            const buckets = bar24(t.points, data.since)
            return (
              <div key={t.id} className="bg-base-100 rounded-box border border-base-300 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2">
                      {t.name}
                      {!t.enabled && <span className="badge badge-ghost badge-xs">已停用</span>}
                    </div>
                    <div className="text-xs opacity-50 truncate">{t.url}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-xs opacity-50">
                      {last ? `${last.status_code ?? '—'} · ${last.latency_ms ?? '—'}ms` : '暂无数据'}
                    </div>
                    <UpBadge ok={t.enabled ? last?.ok ?? null : null} />
                  </div>
                </div>
                <div className="flex gap-[2px] mt-3 h-5">
                  {buckets.map((b, i) => (
                    <div
                      key={i}
                      title={`${new Date(data.since + ((i + 1) / 48) * (Date.now() - data.since)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} ${b === 0 ? '异常' : b === 1 ? '正常' : '无数据'}`}
                      className={`flex-1 rounded-[2px] ${
                        b === 1 ? 'bg-success/70' : b === 0 ? 'bg-error/80' : 'bg-base-300'
                      }`}
                    />
                  ))}
                </div>
                {manageOpen && (
                  <div className="mt-3 flex gap-2 justify-end border-t border-base-200 pt-3">
                    <button className="btn btn-ghost btn-xs" onClick={() => removeTarget(t.id)}>
                      删除
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => openEdit(targetsData?.targets.find((x) => x.id === t.id))}>
                      编辑
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal
        ref={editRef}
        title={editing?.id ? '编辑探活目标' : '新增探活目标'}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => editRef.current?.close()}>
              取消
            </button>
            <button className="btn btn-primary" onClick={saveTarget}>
              保存
            </button>
          </>
        }
      >
        {editing && (
          <div>
            <ErrorBanner message={formError} />
            <Field label="名称">
              <input
                className="input input-bordered w-full"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="URL">
              <input
                className="input input-bordered w-full"
                placeholder="https://hrt.ttfl.net"
                value={editing.url ?? ''}
                onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="方法">
                <select
                  className="select select-bordered w-full"
                  value={editing.method ?? 'GET'}
                  onChange={(e) => setEditing({ ...editing, method: e.target.value })}
                >
                  <option>GET</option>
                  <option>HEAD</option>
                </select>
              </Field>
              <Field label="期望状态码">
                <input
                  type="number"
                  className="input input-bordered w-full"
                  value={editing.expect_status ?? 200}
                  onChange={(e) => setEditing({ ...editing, expect_status: Number(e.target.value) })}
                />
              </Field>
              <Field label="间隔（秒）">
                <select
                  className="select select-bordered w-full"
                  value={editing.interval_sec ?? 300}
                  onChange={(e) => setEditing({ ...editing, interval_sec: Number(e.target.value) })}
                >
                  <option value={60}>1 分钟</option>
                  <option value={300}>5 分钟</option>
                  <option value={600}>10 分钟</option>
                  <option value={1800}>30 分钟</option>
                </select>
              </Field>
            </div>
            <Field label="关联资产（可选）">
              <AssetOptions value={editing.asset_id ?? null} onChange={(v) => setEditing({ ...editing, asset_id: v })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
