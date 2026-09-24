# ttfl.net 控制中枢（admin）

站点 / 应用的总控管理中枢 + 全子域共用的认证中台（SSO）。

```
┌─ admin.ttfl.net ────────────┐   ┌─ auth.ttfl.net ──────────────┐
│ 中枢控制台 SPA（GH Pages）   │   │ 认证中台登录页（Worker 静态页）│
│ web/  React19+Vite8+TW4     │   └──────────────┬───────────────┘
│       +DaisyUI5+router7     │                  │ 登录成功 Set-Cookie
└──────────────┬──────────────┘                  ▼
               │ fetch /api/*                    JWT Cookie「ttfl_session」
               ▼                                 Domain=.ttfl.net · 7 天
┌─ api.ttfl.net ────────────────────────────────────────────────┐
│ Cloudflare Worker「ttfl-hub」（本 Worker 同时绑定两个域名）      │
│ Hono + D1(ttfl_hub) + Cron(每分钟探活 / 每日到期检查)           │
│ Secrets: JWT_SECRET / SETUP_TOKEN / GH_TOKEN / CF_API_TOKEN   │
└───────────────────────────────────────────────────────────────┘
任意 *.ttfl.net 静态站 ← <script src="https://auth.ttfl.net/auth.js" data-require>
```

## 功能现状

| 模块 | 说明 |
|---|---|
| 认证中台 | Passkey（WebAuthn）登录，`.ttfl.net` 顶级域 JWT Cookie 共享；`users/identities` 多用户模型，第三方 OAuth（GitHub/Google/微信/QQ/邮箱）预留 adapter（`api/src/auth/providers.ts`），当前仅 owner 一账号 |
| 资产台账 | 站点/应用/Worker/D1/R2/KV/云机台账 CRUD + 关联关系（serves / backed_by / data_of / deployed_from / domain_of），已按现有项目预填 |
| 探活监控 | Worker Cron 每分钟按各目标 interval 探测（10s 超时），状态翻转写事件；状态页 24h 时间线 |
| 部署管理 | GitHub Actions：仓库/工作流/运行状态查看、workflow_dispatch 触发、重跑（GH Pages 的“回滚”= 重跑旧 commit）；Cloudflare：Workers/Pages 部署历史、D1/KV/R2 清单 |
| 域名 DNS | 域名台账与到期提醒（30 天内每日事件，去重）；CF Zones / DNS 记录只读查看；CF Registrar 到期时间一键同步 |
| 事件审计 | 统一事件流（audit / uptime / deploy / expiry / auth），中枢所有写操作自动落审计 |
| 密钥元数据 | 只登记名称与用途，**值永远留在各自平台，绝不入 D1** |

## 目录结构

```
web/   中枢前端 → GH Pages admin.ttfl.net（.github/workflows/deploy-web.yml 自动发布）
api/   Cloudflare Worker「ttfl-hub」→ auth.ttfl.net + api.admin.ttfl.net
       schema.sql / seed.sql   D1 建库与初始数据
       public/                 登录页（原生 HTML，无构建步骤）
       src/auth/               Passkey、JWT、会话、SDK、provider 抽象
       src/hub/                台账 / 探活 / 总览 / 事件 / GitHub / Cloudflare / 设置
       src/cron/               每分钟探活 + 每日到期检查与清理
       scripts/mint-token.mjs  本地调试：签发 Bearer token
```

## 本地开发

```bash
pnpm install
cp api/.dev.vars.example api/.dev.vars    # 已含开发用密钥

pnpm db:init:local    # 初始化本地 D1（.wrangler/state）
pnpm dev:api          # wrangler dev → http://localhost:8787（登录页 + API）
pnpm dev:web          # vite → http://localhost:5173（/api 代理到 8787，无跨域问题）
```

- 本地会话调试：`node api/scripts/mint-token.mjs` 签发 1h token，请求带
  `Authorization: Bearer <token>`（中枢 API 同时接受 Cookie 与 Bearer）。
- 本地触发 cron：`curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`
  （每日任务用 `cron=0+3+*+*+*`）。
- 注意：wrangler dev 会把 Host 改写为 wrangler.toml 里的第一个 route
  （auth.ttfl.net），因此本地开发门卫统一放行 OUR_HOSTS + localhost。

## 部署步骤（首次）

```bash
cd api
npx wrangler login
npx wrangler d1 create ttfl_hub          # 把返回的 database_id 填入 wrangler.toml
pnpm db:init:remote                      # 建表 + 初始数据

npx wrangler secret put JWT_SECRET       # openssl rand -hex 32
npx wrangler secret put SETUP_TOKEN      # 任一随机串，注册首个 Passkey 用（一次性）
npx wrangler secret put GH_TOKEN         # 可选，P2 GitHub 集成
npx wrangler secret put CF_API_TOKEN     # 可选，P2 Cloudflare 集成

pnpm run deploy                          # wrangler deploy，自动创建两个自定义域的 DNS
                                         # 注意必须带 run：workspace 里 pnpm deploy 是内置命令会被拦截
```

`CF_ACCOUNT_ID`：Cloudflare 控制台首页右栏复制，填入 `api/wrangler.toml` 的 `[vars]`。

**首个 Passkey**：浏览器访问 `https://auth.ttfl.net/?setup=<SETUP_TOKEN>` → 注册管理员
Passkey → 自动登录并跳回中枢。丢失全部 Passkey 时重新 `wrangler secret put SETUP_TOKEN`
即可重走该流程。

**中枢前端**：创建 GitHub 仓库（如 `Tia-Nina/ttfl.net-admin`），push 本项目到 main，
Actions（`deploy-web.yml`）自动把 `web/dist` 发布到 gh-pages 分支；在仓库 Settings →
Pages 选择 gh-pages 分支后，`admin.ttfl.net` 生效（CNAME 已在 `web/public/`，
DNS 记录 CNAME → `<user>.github.io` 由 wrangler deploy 或手动添加）。

### Tokens 权限要求

| Token | 权限 |
|---|---|
| GH_TOKEN | fine-grained：勾选需要的仓库，Contents: Read + Actions: Read/Write；或 classic `repo` + `workflow` |
| CF_API_TOKEN | Account: Workers Scripts:Read、Pages:Read、D1:Read、KV:Read、R2:Read + Zone: Zones:Read、DNS:Read（只读即可） |

## 子站点接入认证中台

在任意 `*.ttfl.net` 站点入口 HTML 加一行：

```html
<script src="https://auth.ttfl.net/auth.js" data-require></script>
```

- `data-require`：未登录自动跳转 `auth.ttfl.net` 登录页，登录后跳回原地址。
- JS API：`ttflAuth.session()`（Promise，未登录 null）、`ttflAuth.login()`、`ttflAuth.logout()`。
- 静态站的登录墙是前端门槛；真正的鉴权在后端 API 层。其他 Worker（如 websiteapi）
  后续接入时，用同一个 JWT_SECRET 校验 `ttfl_session` Cookie 或 Bearer 即可。

## 设计要点与已知事项

- **独立 Worker**：中枢持高权限 Token（GH/CF），与业务后端 websiteapi 完全隔离。
- **一个 Worker 两个域名**：`auth.ttfl.net`（登录页 + 认证 API）与 `api.ttfl.net`（中枢 BFF）；
  API 路径在两域名下均可访问（同 Worker、同 JWT 保护），登录页只在 auth 域提供。
  ⚠️ API 域名必须用一级子域：Universal SSL 免费证书只覆盖 `ttfl.net` / `*.ttfl.net`，
  `api.admin.ttfl.net` 这类二级子域拿不到证书，TLS 握手直接失败（除非付费开 Advanced Certificate Manager）。
- **GH Pages 无产物级回滚**：部署管理提供「重跑」，即用旧 commit 重新构建发布。
- **seed 中 ai.ttfl.net / map.mc.ttfl.net 为占位**，请按实际调整；websiteapi 根路径返回
  404 属正常，可把该探活目标改为具体健康端点或把期望状态码改掉。
- **事件保留**：探活明细保留 30 天（每日 cron 清理），事件流暂不清理。
- **通知渠道未接**：`api/src/lib/audit.ts` 的 `notify()` 为空实现，接 Telegram / Resend
  时只需填这里。

## 分期路线

- ✅ P0 脚手架 + 认证中台（Passkey）+ 资产台账 + 中枢前端
- ✅ P1 探活 Cron + 状态页 + 事件流（通知接口预留）
- ✅ P2 GitHub Actions 触发/状态 + CF 部署历史 + 域名到期提醒 + DNS 只读
- ⬜ P3 D1 SQL 控制台 + 定时备份到 R2 + KV/R2 浏览器
- ⬜ P4 home 迁移中台登录（替换明文密码方案）、日志/流量汇总、云机/本地服务接入、成本摘要、
  第三方 OAuth（GitHub/Google/微软/微信/QQ/邮箱）adapter
