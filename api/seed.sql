-- ttfl_hub 初始数据（按 2026-09 探索结果预填，可随时在台账页修改）
-- 幂等性：全部 INSERT OR IGNORE，可重复执行

-- ---- 资产 ----
INSERT OR IGNORE INTO assets (id, kind, name, slug, description, url, repo, deploy_target, stack, status, created_at, updated_at) VALUES
  (1, 'site',   'home 个人主页',   'home',       'ttfl.net 主页，含后台管理',              'https://ttfl.net',        '',                        'gh_pages',  'React 19 / Vite / Tailwind 3 / DaisyUI 5',   'active', (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  (2, 'site',   'ai 聊天站',       'ai',         'AI 对话站，后端走 websiteapi',           'https://ai.ttfl.net',     '',                        'gh_pages',  'React 19 / Vite / Tailwind 3 / jotai',       'active', (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  (3, 'site',   'mc 官网',         'mc',         'FairyLand Minecraft 官网',               'https://p.mc.ttfl.net',   '',                        'gh_pages',  'React 19 / Vite 7 / Tailwind 4 / router 7',  'active', (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  (4, 'site',   'mc 服务器地图',   'map-mc',     'MC 服务器实时地图',                      'https://map.mc.ttfl.net', '',                        'none',      '待登记',                                      'dev',    (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  (5, 'site',   'hrt 记录工具',    'hrt',        'HRT 记录与图表',                         'https://hrt.ttfl.net',    'Tia-Nina/ttfl.net-hrt',   'gh_pages',  'React 19 / Vite 8 / Tailwind 4 / ECharts',   'active', (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  (6, 'app',    'hunt-map-mark',   'hunt-map-mark', '猎杀对决地图标记（Tauri 桌面版）',     '',                        'Tia-Nina/hunt-map-marks', 'desktop',   'Tauri 2 / Rust / React',                     'active', (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  (7, 'worker', 'websiteapi',      'websiteapi', '全站统一后端（Express on Workers）',     'https://websiteapi.ttfl.net', '',                   'cf_worker', 'Workers / Express / D1',                     'active', (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  (8, 'd1',     'ttfl_net',        'd1-ttfl-net','主数据库（home/ai/hunt 数据）',          '',                        '',                        'none',      'D1 / SQLite',                                'active', (strftime('%s','now')*1000), (strftime('%s','now')*1000));

-- ---- 关联关系 ----
INSERT OR IGNORE INTO asset_links (from_id, to_id, kind, note) VALUES
  (1, 7, 'backed_by', 'home 的 nav/blog/zone/more 接口'),
  (2, 7, 'backed_by', 'ai 的对话/历史接口'),
  (5, 7, 'backed_by', 'hrt 数据接口'),
  (6, 7, 'backed_by', 'hunt 密钥激活与数据接口'),
  (7, 8, 'data_of',   'websiteapi 读写 ttfl_net');

-- ---- 探活目标 ----
INSERT OR IGNORE INTO uptime_targets (asset_id, name, url, method, expect_status, interval_sec, enabled, created_at) VALUES
  (1, 'home',       'https://ttfl.net',             'GET', 200, 300, 1, (strftime('%s','now')*1000)),
  (2, 'ai',         'https://ai.ttfl.net',          'GET', 200, 300, 1, (strftime('%s','now')*1000)),
  (3, 'mc 官网',    'https://p.mc.ttfl.net',        'GET', 200, 300, 1, (strftime('%s','now')*1000)),
  (5, 'hrt',        'https://hrt.ttfl.net',         'GET', 200, 300, 1, (strftime('%s','now')*1000)),
  (7, 'websiteapi', 'https://websiteapi.ttfl.net',  'GET', 200, 300, 1, (strftime('%s','now')*1000));

-- ---- 域名 ----
INSERT OR IGNORE INTO domains (name, registrar, expires_at, cf_zone_id, notes, created_at, updated_at) VALUES
  ('ttfl.net', '', NULL, NULL, '主域名；到期时间与 Zone ID 待填写（P2 可从 CF API 同步）', (strftime('%s','now')*1000), (strftime('%s','now')*1000));

-- ---- 密钥元数据（仅元信息） ----
INSERT OR IGNORE INTO secrets_meta (service, name, scope_note, notes, created_at, updated_at) VALUES
  ('hub-worker',  'JWT_SECRET',   '中台会话 JWT 签名密钥',         'wrangler secret put；openssl rand -hex 32', (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  ('hub-worker',  'SETUP_TOKEN',  '首个 Passkey 注册引导令牌',     '一次性；丢失凭证时重新 put 即可找回',        (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  ('hub-worker',  'GH_TOKEN',     'GitHub PAT：repo + workflow',   'P2 部署管理用',                              (strftime('%s','now')*1000), (strftime('%s','now')*1000)),
  ('hub-worker',  'CF_API_TOKEN', 'CF API：Zones/DNS/Workers/D1/Pages 读', 'P2 部署历史与 DNS 查看用',           (strftime('%s','now')*1000), (strftime('%s','now')*1000));
