import type { Env } from '../types'

/**
 * 各子站点统一接入的会话检测 SDK。
 * 用法（在任意 *.ttfl.net 页面）：
 *   <script src="https://auth.ttfl.net/auth.js" data-require></script>
 *   data-require —— 未登录自动跳转中台登录页，登录后跳回原地址
 *   JS API：ttflAuth.session() / ttflAuth.login(redirect?) / ttflAuth.logout()
 * __AUTH_ORIGIN__ 由 Worker 按环境替换（生产 https://auth.ttfl.net）
 */
const TEMPLATE = `(function () {
  var ORIGIN = '__AUTH_ORIGIN__'
  function session() {
    return fetch(ORIGIN + '/api/session', { credentials: 'include' }).then(function (r) {
      return r.ok ? r.json() : null
    }).catch(function () { return null })
  }
  function login(redirect) {
    location.href = ORIGIN + '/?redirect=' + encodeURIComponent(redirect || location.href)
  }
  function logout(redirect) {
    return fetch(ORIGIN + '/api/logout', { method: 'POST', credentials: 'include' }).then(function () {
      location.href = redirect || '/'
    })
  }
  window.ttflAuth = { session: session, login: login, logout: logout }
  var s = document.currentScript
  if (s && s.hasAttribute('data-require')) {
    session().then(function (u) { if (!u) login() })
  }
})()
`

export function renderAuthSdk(env: Env): string {
  return TEMPLATE.replace('__AUTH_ORIGIN__', env.PUBLIC_AUTH_ORIGIN)
}
