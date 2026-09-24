import { now, run, jsonify } from './db'
import type { Env } from '../types'

export type EventType = 'audit' | 'uptime' | 'deploy' | 'expiry' | 'auth'

export async function logEvent(
  env: Env,
  type: EventType,
  action: string,
  opts: { actor?: string; target?: string; detail?: unknown } = {},
): Promise<void> {
  await run(
    env.DB,
    'insert into events (ts, type, actor, action, target, detail) values (?, ?, ?, ?, ?, ?)',
    now(),
    type,
    opts.actor ?? 'system',
    action,
    opts.target ?? null,
    jsonify(opts.detail),
  )
  if (type === 'uptime' || type === 'expiry' || type === 'deploy') {
    await notify(env, { type, action, ...opts })
  }
}

/**
 * 通知推送（P3+ 接入具体渠道）。
 * 现阶段只记录事件到 D1；接入 Telegram Bot / 邮件（Resend）时只需在这里实现，
 * 不需要改动任何调用方。
 */
async function notify(
  _env: Env,
  _event: { type: EventType; action: string; actor?: string; target?: string; detail?: unknown },
): Promise<void> {
  // 例：
  // await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
  //   method: 'POST', headers: { 'content-type': 'application/json' },
  //   body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: `[${e.type}] ${e.action} ${e.target}` }),
  // })
}
