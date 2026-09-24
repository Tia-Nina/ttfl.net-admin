-- ttfl_hub 数据库结构（SQLite / D1）
-- 时间统一存毫秒时间戳（与 server 项目惯例一致）

-- ============ 认证中台 ============

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',      -- owner / admin / user
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- 身份提供方关联：一个用户可绑定多个 provider（passkey / github / google / microsoft / wechat / qq / email）
CREATE TABLE IF NOT EXISTS identities (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  label            TEXT,
  created_at       INTEGER NOT NULL,
  UNIQUE(provider, provider_user_id)
);

-- Passkey 凭证（public_key 存 base64）
CREATE TABLE IF NOT EXISTS credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,              -- base64url
  public_key    TEXT NOT NULL,                     -- base64
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                              -- 逗号分隔
  label         TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

-- WebAuthn 挑战的临时存储（5 分钟过期）
CREATE TABLE IF NOT EXISTS auth_challenges (
  id         TEXT PRIMARY KEY,                     -- 随机 id，客户端回传
  challenge  TEXT NOT NULL,
  purpose    TEXT NOT NULL,                        -- register / login
  created_at INTEGER NOT NULL
);

-- ============ 资产台账 ============

CREATE TABLE IF NOT EXISTS assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,                     -- site/app/worker/d1/r2/kv/repo/server
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  url           TEXT,                              -- 访问地址
  repo          TEXT,                              -- owner/repo
  deploy_target TEXT,                              -- gh_pages/cf_pages/cf_worker/cloud_vm/local/desktop/none
  stack         TEXT,                              -- 技术栈描述
  status        TEXT NOT NULL DEFAULT 'active',    -- active/dev/archived
  meta          TEXT,                              -- JSON 扩展字段
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 资产关联关系（有向边）
CREATE TABLE IF NOT EXISTS asset_links (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  to_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,                           -- serves/backed_by/data_of/deployed_from/domain_of
  note    TEXT,
  UNIQUE(from_id, to_id, kind)
);

-- ============ 探活监控 ============

CREATE TABLE IF NOT EXISTS uptime_targets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id        INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'GET',
  expect_status   INTEGER NOT NULL DEFAULT 200,    -- 期望状态码下限，2xx-3xx 视为通过
  interval_sec    INTEGER NOT NULL DEFAULT 300,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_checked_at INTEGER,
  last_ok         INTEGER,                         -- 0/1
  last_status     INTEGER,
  last_latency    INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uptime_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id   INTEGER NOT NULL REFERENCES uptime_targets(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  ok          INTEGER NOT NULL,                    -- 0/1
  status_code INTEGER,
  latency_ms  INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_uptime_results_target_ts ON uptime_results(target_id, ts DESC);

-- ============ 域名 ============

CREATE TABLE IF NOT EXISTS domains (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  registrar  TEXT,
  expires_at INTEGER,                              -- 毫秒；CF registrar 域名可自动同步
  cf_zone_id TEXT,
  notes      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============ 部署记录 ============

CREATE TABLE IF NOT EXISTS deployments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id    INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,                       -- github_actions/cloudflare/manual
  ref         TEXT,
  status      TEXT,
  external_id TEXT,
  url         TEXT,
  started_at  INTEGER,
  updated_at  INTEGER NOT NULL
);

-- ============ 事件流（审计 / 告警 / 记录 统一） ============

CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  type   TEXT NOT NULL,                            -- audit/uptime/deploy/expiry/auth
  actor  TEXT,                                     -- 操作者（用户名 / system）
  action TEXT NOT NULL,                            -- 如 assets.create / uptime.recovered / domain.expiring
  target TEXT,                                     -- 作用对象（如 asset:12 / hrt.ttfl.net）
  detail TEXT                                     -- JSON
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts DESC);

-- ============ 密钥元数据（只存元信息，绝不存值） ============

CREATE TABLE IF NOT EXISTS secrets_meta (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  service    TEXT NOT NULL,                        -- hub-worker/websiteapi/github/cloudflare/...
  name       TEXT NOT NULL,
  scope_note TEXT,                                 -- 权限范围说明
  rotated_at INTEGER,
  expires_at INTEGER,
  notes      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
