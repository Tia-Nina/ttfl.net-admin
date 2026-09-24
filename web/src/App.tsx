import { useEffect, useState } from 'react'
import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AUTH_ORIGIN, authApi } from './api/client'
import type { SessionUser } from './api/types'
import Overview from './pages/Overview'
import Assets from './pages/Assets'
import Status from './pages/Status'
import Deployments from './pages/Deployments'
import Domains from './pages/Domains'
import Events from './pages/Events'
import Settings from './pages/Settings'

const NAV = [
  { to: '/', label: '总览', icon: '◎', end: true },
  { to: '/assets', label: '资产台账', icon: '▤' },
  { to: '/status', label: '探活状态', icon: '♡' },
  { to: '/deployments', label: '部署管理', icon: '⇪' },
  { to: '/domains', label: '域名 DNS', icon: '⊘' },
  { to: '/events', label: '事件审计', icon: '☰' },
  { to: '/settings', label: '设置', icon: '⚙' },
]

function Layout() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const location = useLocation()

  useEffect(() => {
    authApi<{ user: SessionUser }>('/session')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
  }, [location.pathname])

  async function logout() {
    await authApi('/logout', { method: 'POST' }).catch(() => {})
    window.location.href = AUTH_ORIGIN + '/'
  }

  return (
    <div className="flex min-h-screen bg-base-200">
      {/* 侧边栏 */}
      <aside className="hidden lg:flex w-56 flex-col border-r border-base-300 bg-base-100 sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-primary-content font-bold">
            ◆
          </div>
          <div>
            <div className="font-bold leading-tight">ttfl.net</div>
            <div className="text-xs opacity-50">控制中枢</div>
          </div>
        </div>
        <nav className="flex-1 px-3">
          <ul className="menu w-full gap-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'menu-active' : '')}>
                  <span className="opacity-60">{n.icon}</span>
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="px-5 py-4 border-t border-base-300 flex items-center justify-between">
          <div className="text-sm">
            <div className="font-medium">{user?.name ?? '…'}</div>
            <div className="text-xs opacity-50">{user?.role ?? ''}</div>
          </div>
          <button className="btn btn-ghost btn-xs" onClick={logout}>
            退出
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex-1 min-w-0">
        {/* 移动端顶栏 */}
        <div className="lg:hidden navbar bg-base-100 border-b border-base-300">
          <div className="navbar-start">
            <div className="dropdown">
              <button className="btn btn-ghost btn-sm">☰</button>
              <ul className="dropdown-content menu bg-base-100 rounded-box z-50 w-44 p-2 shadow-lg border border-base-300">
                {NAV.map((n) => (
                  <li key={n.to}>
                    <NavLink to={n.to} end={n.end}>
                      {n.label}
                    </NavLink>
                  </li>
                ))}
                <li>
                  <button onClick={logout}>退出登录</button>
                </li>
              </ul>
            </div>
          </div>
          <div className="navbar-center">
            <span className="font-bold">ttfl.net 控制中枢</span>
          </div>
          <div className="navbar-end" />
        </div>

        <main className="p-4 md:p-6 max-w-6xl mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/status" element={<Status />} />
        <Route path="/deployments" element={<Deployments />} />
        <Route path="/domains" element={<Domains />} />
        <Route path="/events" element={<Events />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="*"
          element={<div className="text-center py-24 opacity-40">页面不存在</div>}
        />
      </Route>
    </Routes>
  )
}
