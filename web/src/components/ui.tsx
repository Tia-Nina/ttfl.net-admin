import type { ReactNode, RefObject } from 'react'

/** DaisyUI modal 简易封装：<dialog> + form method，esc/遮罩可关 */
export function Modal({
  ref,
  title,
  children,
  actions,
  wide,
}: {
  ref: RefObject<HTMLDialogElement | null>
  title: string
  children: ReactNode
  actions?: ReactNode
  wide?: boolean
}) {
  return (
    <dialog ref={ref} className="modal">
      <div className={`modal-box ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <h3 className="font-bold text-lg mb-4">{title}</h3>
        {children}
        {actions && <div className="modal-action">{actions}</div>}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block w-full mb-3">
      <span className="block mb-1 text-sm opacity-70">{label}</span>
      {children}
    </label>
  )
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="alert alert-error text-sm my-2">
      <span>{message}</span>
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <span className="loading loading-spinner loading-lg opacity-40" />
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="text-center py-14 opacity-40 text-sm">{text}</div>
}

const KIND_COLORS: Record<string, string> = {
  site: 'badge-primary',
  app: 'badge-secondary',
  worker: 'badge-accent',
  d1: 'badge-info',
  r2: 'badge-info',
  kv: 'badge-info',
  repo: 'badge-ghost',
  server: 'badge-warning',
}

export function KindBadge({ kind }: { kind: string }) {
  return <span className={`badge badge-sm ${KIND_COLORS[kind] ?? 'badge-ghost'}`}>{kind}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'badge-success' : status === 'dev' ? 'badge-warning' : 'badge-ghost'
  const text = status === 'active' ? '在线' : status === 'dev' ? '开发中' : '已归档'
  return <span className={`badge badge-sm ${cls}`}>{text}</span>
}

export function UpBadge({ ok }: { ok: number | null }) {
  if (ok === null) return <span className="badge badge-sm badge-ghost">待探测</span>
  return <span className={`badge badge-sm ${ok ? 'badge-success' : 'badge-error'}`}>{ok ? '正常' : '异常'}</span>
}
