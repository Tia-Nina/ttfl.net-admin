import { useEffect, useRef, useState } from 'react'
import { AUTH_ORIGIN, api, authApi } from '../api/client'
import { useApiData, formatTs } from '../hooks'
import type { PasskeyCredential, SecretMeta, SystemInfo } from '../api/types'
import { Modal, Field, Loading, Empty, ErrorBanner } from '../components/ui'

// ---- WebAuthn 浏览器侧工具（与登录页一致的 base64url 处理） ----
function b64ToBuf(s: string): ArrayBuffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr.buffer
}
function bufToB64(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface RegisterOptions {
  challenge: string
  rp: PublicKeyCredentialRpEntity
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: PublicKeyCredentialParameters[]
  timeout?: number
  excludeCredentials?: Array<{ id: string; type: string }>
  authenticatorSelection?: AuthenticatorSelectionCriteria
  attestation?: AttestationConveyancePreference
}

async function registerPasskey(): Promise<void> {
  const { challengeId, options } = await authApi<{ challengeId: string; options: RegisterOptions }>('/webauthn/register/options', {
    method: 'POST',
    body: {},
  })
  const o = options
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: b64ToBuf(o.challenge),
      rp: o.rp,
      user: { id: b64ToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams,
      timeout: o.timeout,
      excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ id: b64ToBuf(c.id), type: c.type as PublicKeyCredentialType })),
      authenticatorSelection: o.authenticatorSelection,
      attestation: o.attestation,
    },
  })) as PublicKeyCredential
  const resp = cred.response as AuthenticatorAttestationResponse
  await authApi('/webauthn/register/verify', {
    method: 'POST',
    body: {
      challengeId,
      response: {
        id: cred.id,
        rawId: bufToB64(cred.rawId),
        type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment,
        clientExtensionResults: cred.getClientExtensionResults(),
        response: {
          clientDataJSON: bufToB64(resp.clientDataJSON),
          attestationObject: bufToB64(resp.attestationObject),
          transports: resp.getTransports?.() ?? [],
        },
      },
    },
  })
}

export default function Settings() {
  const { data: info } = useApiData<SystemInfo>('/system/info')
  const { data: secretsData, reload: reloadSecrets } = useApiData<{ secrets: SecretMeta[] }>('/system/secrets')

  const secRef = useRef<HTMLDialogElement>(null)
  const [secForm, setSecForm] = useState<Partial<SecretMeta> | null>(null)
  const [secError, setSecError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function saveSecret() {
    if (!secForm) return
    try {
      setSecError(null)
      if (secForm.id) {
        await api(`/system/secrets/${secForm.id}`, { method: 'PUT', body: secForm })
      } else {
        await api('/system/secrets', { method: 'POST', body: secForm })
      }
      secRef.current?.close()
      reloadSecrets()
    } catch (e) {
      setSecError((e as Error).message)
    }
  }

  async function removeSecret(id: number) {
    if (!confirm('确认删除该登记？')) return
    await api(`/system/secrets/${id}`, { method: 'DELETE' })
    reloadSecrets()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">设置</h1>

      {/* 配置状态 */}
      <div className="bg-base-100 rounded-box border border-base-300 p-5">
        <h2 className="font-semibold mb-3">配置状态</h2>
        {info && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className={`badge ${info.setupDone ? 'badge-success' : 'badge-warning'}`}>
              中台初始化：{info.setupDone ? '已完成' : '未完成（访问 auth.ttfl.net/?setup=…）'}
            </span>
            <span className={`badge ${info.tokens.jwt ? 'badge-success' : 'badge-error'}`}>JWT_SECRET</span>
            <span className={`badge ${info.tokens.github ? 'badge-success' : 'badge-ghost'}`}>GH_TOKEN</span>
            <span className={`badge ${info.tokens.cloudflare ? 'badge-success' : 'badge-ghost'}`}>CF_API_TOKEN</span>
            <span className={`badge ${info.tokens.cfAccount ? 'badge-success' : 'badge-ghost'}`}>CF_ACCOUNT_ID</span>
          </div>
        )}
      </div>

      {/* 注册与邀请码 */}
      <RegistrationCard />

      {/* 用户与站点权限 */}
      <UsersCard />

      {/* Passkey 管理 */}
      <div className="bg-base-100 rounded-box border border-base-300 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Passkey 凭证</h2>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setMsg(null)
              try {
                await registerPasskey()
                setMsg('新 Passkey 已注册')
              } catch (e) {
                setMsg((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <span className="loading loading-spinner loading-xs" />} 添加 Passkey
          </button>
        </div>
        <ErrorBanner message={msg} />
        <PasskeyList />
      </div>

      {/* SDK 接入说明 */}
      <div className="bg-base-100 rounded-box border border-base-300 p-5">
        <h2 className="font-semibold mb-2">子站点接入认证中台</h2>
        <p className="text-sm opacity-70 mb-2">
          在任意 *.ttfl.net 站点的入口 HTML 加入：
        </p>
        <pre className="p-3 bg-base-200 rounded-lg text-xs overflow-x-auto">{`<script src="${AUTH_ORIGIN}/auth.js" data-require></script>`}</pre>
        <p className="text-xs opacity-50 mt-2">
          data-require：未登录自动跳转中台登录页并回跳。JS API：<code>ttflAuth.session()</code> / <code>ttflAuth.login()</code> / <code>ttflAuth.logout()</code>
        </p>
      </div>

      {/* 密钥元数据 */}
      <div className="bg-base-100 rounded-box border border-base-300 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">密钥元数据</h2>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setSecError(null)
              setSecForm({ service: 'hub-worker', name: '' })
              secRef.current?.showModal()
            }}
          >
            + 登记
          </button>
        </div>
        <p className="text-xs opacity-50 mb-3">只记录名称与用途，密钥值永远留在各自平台的加密存储（wrangler secret / GitHub / Cloudflare），绝不入 D1。</p>
        {(secretsData?.secrets ?? []).length === 0 ? (
          <Empty text="暂无登记" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>服务</th>
                  <th>名称</th>
                  <th>权限/用途</th>
                  <th>轮换时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(secretsData?.secrets ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="text-xs">{s.service}</td>
                    <td className="font-mono text-xs">{s.name}</td>
                    <td className="text-xs opacity-70">{s.scope_note || '—'}</td>
                    <td className="text-xs opacity-50">{formatTs(s.rotated_at)}</td>
                    <td className="text-right">
                      <button className="btn btn-ghost btn-xs" onClick={() => removeSecret(s.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        ref={secRef}
        title="登记密钥元数据"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => secRef.current?.close()}>
              取消
            </button>
            <button className="btn btn-primary" onClick={saveSecret}>
              保存
            </button>
          </>
        }
      >
        {secForm && (
          <div>
            <ErrorBanner message={secError} />
            <Field label="所属服务">
              <input className="input input-bordered w-full" placeholder="hub-worker / websiteapi / github" value={secForm.service ?? ''} onChange={(e) => setSecForm({ ...secForm, service: e.target.value })} />
            </Field>
            <Field label="密钥名称">
              <input className="input input-bordered w-full font-mono" placeholder="GH_TOKEN" value={secForm.name ?? ''} onChange={(e) => setSecForm({ ...secForm, name: e.target.value })} />
            </Field>
            <Field label="权限范围 / 用途">
              <textarea className="textarea textarea-bordered w-full" rows={2} value={secForm.scope_note ?? ''} onChange={(e) => setSecForm({ ...secForm, scope_note: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

/** 注册模式与邀请码管理（普通用户通过中台登录页注册） */
function RegistrationCard() {
  const { data, reload } = useApiData<{
    mode: 'open' | 'invite'
    invites: Array<{ code: string; created_by: string | null; created_at: number; used_by: number | null; used_at: number | null }>
  }>('/system/registration')
  const [mode, setMode] = useState<'open' | 'invite' | ''>('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (data && mode === '') setMode(data.mode)
  }, [data, mode])

  async function saveMode() {
    if (!mode) return
    setBusy(true)
    try {
      await api('/system/registration', { method: 'PUT', body: { mode } })
      setMsg(`注册模式已切换为「${mode === 'open' ? '开放注册' : '邀请码制'}」`)
      await reload()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function genInvite() {
    setBusy(true)
    try {
      const r = await api<{ code: string }>('/system/invites', { method: 'POST', body: {} })
      await navigator.clipboard?.writeText(r.code).catch(() => {})
      setMsg(`新邀请码：${r.code}（已复制到剪贴板）`)
      await reload()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeInvite(code: string) {
    try {
      await api(`/system/invites/${code}`, { method: 'DELETE' })
      await reload()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="bg-base-100 rounded-box border border-base-300 p-5">
      <h2 className="font-semibold mb-2">用户注册</h2>
      <p className="text-xs opacity-50 mb-3">
        控制其他站点（如 hrt）的用户如何注册 ttfl.net 账号：邀请码制需在本页生成邀请码发给用户；开放注册按 IP 限速（每小时 5 次）。
      </p>
      <ErrorBanner message={msg} />
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <select className="select select-bordered select-sm w-40" value={mode} onChange={(e) => setMode(e.target.value as 'open' | 'invite')}>
              <option value="invite">邀请码制</option>
              <option value="open">开放注册</option>
            </select>
            <button className="btn btn-sm" onClick={saveMode} disabled={busy || mode === data.mode}>
              保存模式
            </button>
            <button className="btn btn-primary btn-sm" onClick={genInvite} disabled={busy}>
              生成邀请码
            </button>
          </div>
          {data.invites.length === 0 ? (
            <p className="text-xs opacity-40">还没有邀请码</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>邀请码</th>
                    <th>状态</th>
                    <th>创建</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.invites.map((i) => (
                    <tr key={i.code}>
                      <td className="font-mono text-sm tracking-widest">{i.code}</td>
                      <td className="text-xs">
                        {i.used_by ? (
                          <span className="badge badge-ghost badge-sm">已被用户 #{i.used_by} 使用</span>
                        ) : (
                          <span className="badge badge-success badge-sm">可用</span>
                        )}
                      </td>
                      <td className="text-xs opacity-50">{formatTs(i.created_at)}</td>
                      <td className="text-right">
                        {!i.used_by && (
                          <button className="btn btn-ghost btn-xs" onClick={() => removeInvite(i.code)}>
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 用户列表与站点级权限（如 home 管理员） */
function UsersCard() {
  const { data, reload } = useApiData<{
    users: Array<{
      id: number
      name: string
      role: string
      created_at: number
      last_login_at: number | null
      passkeys: number
      email: string | null
      home_admin: number
    }>
  }>('/system/users')
  const [busy, setBusy] = useState(false)

  async function toggleHomeAdmin(id: number, grant: boolean) {
    setBusy(true)
    try {
      await api(`/system/users/${id}/permissions`, { method: 'PUT', body: { app: 'home', permission: 'admin', grant } })
      await reload()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-base-100 rounded-box border border-base-300 p-5">
      <h2 className="font-semibold mb-2">用户与站点权限</h2>
      <p className="text-xs opacity-50 mb-3">
        ttfl.net 账号总览。「Home 管理员」控制能否管理 home 站（导航/博客/独白/更多）；新注册账号默认没有任何管理权限。
      </p>
      {data && (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>ID</th>
                <th>昵称</th>
                <th>角色</th>
                <th>登录方式</th>
                <th>最近登录</th>
                <th>Home 管理员</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="opacity-50">#{u.id}</td>
                  <td className="font-medium">{u.name}</td>
                  <td>
                    <span className={`badge badge-sm ${u.role === 'owner' ? 'badge-primary' : u.role === 'admin' ? 'badge-secondary' : 'badge-ghost'}`}>
                      {u.role === 'owner' ? '站长' : u.role === 'admin' ? '管理员' : '用户'}
                    </span>
                  </td>
                  <td className="text-xs opacity-70">
                    {u.passkeys > 0 && <span className="mr-1">🔑×{u.passkeys}</span>}
                    {u.email && <span>📧</span>}
                  </td>
                  <td className="text-xs opacity-50">{formatTs(u.last_login_at)}</td>
                  <td>
                    {u.role === 'owner' ? (
                      <span className="badge badge-xs badge-primary"> inherent</span>
                    ) : (
                      <input
                        type="checkbox"
                        className="toggle toggle-primary toggle-sm"
                        disabled={busy}
                        checked={!!u.home_admin}
                        onChange={(e) => toggleHomeAdmin(u.id, e.target.checked)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** 凭证列表（跨子域调认证中台） */
function PasskeyList() {
  const [creds, setCreds] = useState<PasskeyCredential[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    try {
      const r = await authApi<{ credentials: PasskeyCredential[] }>('/webauthn/credentials')
      setCreds(r.credentials)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function remove(id: number) {
    if (!confirm('确认删除该 Passkey？')) return
    try {
      await authApi(`/webauthn/credentials/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (err) return <ErrorBanner message={err} />
  if (!creds) return <Loading />
  if (creds.length === 0) return <p className="text-xs opacity-40">暂无凭证</p>
  return (
    <ul className="divide-y divide-base-200">
      {creds.map((c) => (
        <li key={c.id} className="flex items-center justify-between py-2 text-sm">
          <div>
            <div className="font-medium">{c.label ?? `Passkey #${c.id}`}</div>
            <div className="text-xs opacity-50">
              添加于 {formatTs(c.created_at)} · 最近使用 {formatTs(c.last_used_at)}
            </div>
          </div>
          <button className="btn btn-ghost btn-xs" onClick={() => remove(c.id)}>
            删除
          </button>
        </li>
      ))}
    </ul>
  )
}
