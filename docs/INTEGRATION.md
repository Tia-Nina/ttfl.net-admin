# 应用接入认证中台指南

认证中台（auth.ttfl.net）向所有 `*.ttfl.net` 下的应用提供统一登录。本文说明接入一个新应用需要做的事情。

## 决策树：你的应用是哪种形态？

```
应用在 *.ttfl.net 下？
├── 是
│   ├── 纯静态站 / 前端为主 ──────────→ 方案 A（5 分钟）
│   └── 有自己的后端 API ─────────────→ 方案 A + B（后端验签）
└── 否（云机 / 本地服务 / 外部域名）──→ 方案 C（需要中台加功能，见文末）
```

## 方案 A：静态站点（纯前端）

一行代码接入：

```html
<script src="https://auth.ttfl.net/auth.js" data-require></script>
```

- `data-require`：未登录自动跳转中台登录页，登录后跳回当前页
- JS API：
  - `ttflAuth.session()` → Promise<{user: {id, name, role}} | null>
  - `ttflAuth.login(redirect?)` → 手动跳登录
  - `ttflAuth.logout(redirect?)` → 登出并跳转
- 局部保护（不锁全站）：不加 `data-require`，在需要登录的功能处自行调 `ttflAuth.session()` 判断（hrt 的云同步就是这么做的）

**Passkey 仪式的域名说明**：中台的 RP ID 是 `auth.ttfl.net`，已在
`https://auth.ttfl.net/.well-known/webauthn` 声明了关联来源（admin / hrt / ttfl.net）。
如果新站点要在**自己的页面**上直接发起 Passkey 注册/登录（而不是跳中台），把它的
完整来源（如 `https://xxx.ttfl.net`）加进 `api/src/index.ts` 的 origins 数组并重新部署。
只跳中台登录页的话不需要。

## 方案 B：带后端 API 的应用（Cloudflare Worker / Node 服务）

在方案 A 基础上，后端要识别「当前请求是哪个用户」。登录态以 JWT Cookie
`ttfl_session`（Domain=.ttfl.net，HttpOnly）承载，**同注册域的子域之间请求会自动携带**
（前端请求记得带 `credentials: 'include'` / axios `withCredentials: true`）。

### 验签方式（二选一）

**本地验签（推荐）**：与中台共享 `HUB_JWT_SECRET`，HS256 自验，零网络开销。
现成模板：`server/src/utils/hubAuth.ts`（websiteapi 项目）。要点：

```ts
// payload: { sub: number, name: string, role: 'owner'|'admin'|'user', iat, exp }
// 载体优先级：Cookie ttfl_session → Authorization: Bearer <jwt>
// 密钥配置：npx wrangler secret put HUB_JWT_SECRET（与 ttfl-hub 的 JWT_SECRET 同值）
```

**转发校验**：不想共享密钥的服务，把请求的 Cookie/Bearer 原样转发到
`GET https://auth.ttfl.net/api/session`，200 即有效（多一跳网络，适合云机/异构环境）。

### CORS（浏览器直连后端时）

允许凭据时不能用 `*`，需反射白名单来源。模板见 `server/src/server.ts`：

```ts
origin: /^https:\/\/([a-z0-9-]+\.)?ttfl\.net$/ 匹配 → 反射 origin
credentials: true
```

### 站点级权限（如「某站管理员」）

中台有通用权限表 `app_permissions (user_id, app, permission)`：

- 后端回查：`GET https://auth.ttfl.net/api/my-permissions?app=<应用名>`（带用户 Cookie/Bearer）
  → `{ "app": "home", "admin": true }`。模板：websiteapi 的 `requireAdminOrHub(app)`，含 60s 内存缓存
- 授权入口：控制台 → 设置 → 用户与站点权限（目前 UI 内置了 home 的开关；
  接入新应用时在 `web/src/pages/Settings.tsx` 的 UsersCard 加一列即可）
- 中台角色 owner/admin 天然拥有所有应用的 admin，无需单独授权

### 数据按账号隔离

用 JWT 的 `sub` 作为账号主键（不要用昵称，昵称可重复）。模板：hrt 的
`hrt_sync` 表（owner = `hub:<sub>`）。注册/登录端点在
`admin/api/src/auth/routes.ts`（Passkey：signup/*；密码：password/*）。

## 方案 C：域名不在 *.ttfl.net 的应用

Cookie 作用域限制（Domain=.ttfl.net 不会发送到其他顶级域），当前架构不直接支持。
可行路径（按工作量排序）：

1. **给它一个 ttfl.net 子域反代**（如 `xxx.ttfl.net` → 云机服务），套用方案 A/B
2. **中台加 Bearer Token 签发端点**：会话内用户可换取短时 token，前端手动携带
   （需要在中台加 ~1 个端点 + 前端 token 存储逻辑，属 P4 范围）
3. **标准 OAuth2/OIDC 授权码流程**：把中台升级成完整 IdP，第三方应用走
   authorize → callback（中台的 `providers.ts` 抽象就是为扩展这类能力预留的）

## 接入 checklist（方案 A/B）

- [ ] 前端：引入 auth.js（全站或局部保护）
- [ ] 前端：API 请求带凭据（credentials: 'include'）
- [ ] 后端：HUB_JWT_SECRET 验签或转发校验（方案 B）
- [ ] 后端：CORS 反射白名单 + credentials:true（方案 B）
- [ ] 权限：需要站点级管理员时接 my-permissions（方案 B）
- [ ] 中台：站点来源加入 .well-known/webauthn（仅当在自己页面发起 Passkey 仪式）
- [ ] 控制台：资产台账登记该应用 + 添加 uptime 探活目标
- [ ] 控制台：如需站点级管理员，Settings 页 UsersCard 加对应开关

## 现成参考实现

| 能力 | 模板位置 |
|---|---|
| 前端 SDK 接入（局部保护） | `hrt/src/pages/Settings.tsx` 云同步区 |
| 后端 JWT 验签 + 中间件 | `server/src/utils/hubAuth.ts` |
| 站点级管理员回查 + 缓存 | 同上 `requireAdminOrHub(app)` |
| CORS 凭据白名单 | `server/src/server.ts` |
| 按账号数据隔离 | `server/src/routes/hrt/data.ts` |
| 注册/登录/Passkey 端点 | `admin/api/src/auth/routes.ts` |
