import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { logEvent } from '../lib/audit'
import { HttpError } from '../lib/http'

/** GitHub REST API 代理：PAT 只存在 Worker Secret，前端永不接触 */
async function gh(env: AppEnv['Bindings'], path: string, init: RequestInit = {}): Promise<unknown> {
  if (!env.GH_TOKEN) throw new HttpError(503, 'GH_TOKEN 未配置（wrangler secret put GH_TOKEN）')
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'ttfl-hub',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json as { message?: string }).message ?? res.statusText
    throw new HttpError(502, `GitHub API ${res.status}: ${msg}`)
  }
  return json
}

export const githubApp = new Hono<AppEnv>()

/** 当前 PAT 可见的仓库（按最近更新排序） */
githubApp.get('/repos', async (c) => {
  const repos = (await gh(c.env, '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member')) as Array<Record<string, unknown>>
  return c.json({
    repos: repos.map((r) => ({
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      html_url: r.html_url,
      description: r.description,
      updated_at: r.updated_at,
    })),
  })
})

/** 仓库的工作流列表：?repo=owner/name */
githubApp.get('/workflows', async (c) => {
  const repo = c.req.query('repo')
  if (!repo) return c.json({ error: 'repo 必填（owner/name）' }, 400)
  const data = (await gh(c.env, `/repos/${repo}/actions/workflows`)) as { workflows?: Array<Record<string, unknown>> }
  return c.json({
    workflows: (data.workflows ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      state: w.state,
    })),
  })
})

/** 最近的工作流运行：?repo=&per_page=15 */
githubApp.get('/runs', async (c) => {
  const repo = c.req.query('repo')
  if (!repo) return c.json({ error: 'repo 必填（owner/name）' }, 400)
  const perPage = Math.min(Number(c.req.query('per_page')) || 15, 50)
  const data = (await gh(c.env, `/repos/${repo}/actions/runs?per_page=${perPage}`)) as { workflow_runs?: Array<Record<string, unknown>> }
  return c.json({
    runs: (data.workflow_runs ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      event: r.event,
      status: r.status,
      conclusion: r.conclusion,
      head_branch: r.head_branch,
      head_sha: r.head_sha,
      run_number: r.run_number,
      created_at: r.created_at,
      updated_at: r.updated_at,
      html_url: r.html_url,
    })),
  })
})

/** 触发 workflow_dispatch：{ repo, workflow, ref }，workflow 为文件名如 deploy.yml 或数字 id */
githubApp.post('/dispatch', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const { repo, workflow, ref } = b as { repo?: string; workflow?: string; ref?: string }
  if (!repo || !workflow || !ref) return c.json({ error: 'repo / workflow / ref 必填' }, 400)
  await gh(c.env, `/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  })
  await logEvent(c.env, 'deploy', 'github.dispatch', { actor: c.get('session')?.name, target: repo, detail: { workflow, ref } })
  return c.json({ ok: true })
})

/** 重跑某次运行（GH Pages 的「回滚」= 重跑旧 commit 的工作流）：{ repo, run_id } */
githubApp.post('/rerun', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const { repo, run_id } = b as { repo?: string; run_id?: number }
  if (!repo || !run_id) return c.json({ error: 'repo / run_id 必填' }, 400)
  await gh(c.env, `/repos/${repo}/actions/runs/${run_id}/rerun`, { method: 'POST' })
  await logEvent(c.env, 'deploy', 'github.rerun', { actor: c.get('session')?.name, target: repo, detail: { run_id } })
  return c.json({ ok: true })
})
