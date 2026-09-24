/**
 * 身份提供方抽象。
 *
 * 认证中台当前只实现了 Passkey（WebAuthn），但数据模型（users + identities）
 * 和本接口为第三方登录预留了统一入口。接入新渠道时：
 *   1. 在 OAUTH_PROVIDERS 注册一个实现（authorizeUrl / exchange）
 *   2. 新增 /api/oauth/:provider/authorize 与 /callback 两条路由调用它
 *   3. exchange 返回 provider_user_id 后按 identities 表 find-or-create user，
 *      再走与 Passkey 登录相同的「签发 JWT Cookie」出口（issueSession）
 *
 * 计划支持：github / google / microsoft（标准 OAuth2）
 *          wechat / qq（扫码 OAuth2，回调参数格式略有差异）
 *          email（魔法链接或验证码，实现方式待定）
 */

export interface OAuthUserProfile {
  providerUserId: string
  name: string
  email?: string
  avatar?: string
}

export interface OAuthProvider {
  id: string
  /** 生成跳转到第三方平台的授权 URL */
  authorizeUrl(redirectUri: string, state: string): string
  /** 用授权码换取用户资料（内部完成 token 交换） */
  exchange(code: string, redirectUri: string): Promise<OAuthUserProfile>
}

/** 已接入的提供方。空表表示当前仅 Passkey 可用。 */
export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  // github: {
  //   async authorizeUrl(redirectUri, state) {
  //     const q = new URLSearchParams({ client_id: GITHUB_CLIENT_ID, redirect_uri: redirectUri, state })
  //     return `https://github.com/login/oauth/authorize?${q}`
  //   },
  //   async exchange(code, redirectUri) { /* POST https://github.com/login/oauth/access_token */ },
  // },
}
