/**
 * API base 抽象：浏览器环境下默认相对路径走同源 /api/ai；
 * 原生壳（Capacitor iOS/Android）或独立部署后端时，
 * 可通过 setApiBase('https://your-api.example.com') 注入完整地址。
 *
 * 使用方式：业务代码统一调用 apiUrl('/api/ai/{provider}')，
 * 不要再硬编码以 '/api/' 开头的路径。
 *
 * 当独立后端启用了 AI_PROXY_TOKEN 时，前端通过 setApiAuthToken() 注入；
 * 业务层用 apiAuthHeaders() 把 Authorization 头合并进 fetch 请求。
 *
 * 用户也可以在 app 设置页填写自己的 API key（MiniMax / Doubao / OpenRouter / DeepSeek / Claude），
 * 填了之后调用 getUserApiKey(provider) 拿到值，业务层据此直连官方 API，
 * 跳过自建后端代理。
 */

let apiBase = '';
let apiAuthToken = '';

export type AiProvider = 'minimax' | 'doubao' | 'openrouter' | 'deepseek' | 'claude';
const userApiKeys: Record<AiProvider, string> = {
  minimax: '',
  doubao: '',
  openrouter: '',
  deepseek: '',
  claude: '',
};

export function setApiBase(base: string | undefined | null): void {
  apiBase = (base || '').replace(/\/+$/, '');
}

export function getApiBase(): string {
  return apiBase;
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return apiBase ? `${apiBase}${path}` : path;
}

export function setApiAuthToken(token: string | undefined | null): void {
  apiAuthToken = (token || '').trim();
}

export function getApiAuthToken(): string {
  return apiAuthToken;
}

/**
 * 获取调用独立后端时需要带的 Authorization 头。
 * 仅当：① 配置了 apiBase（即真在走独立后端） ② token 非空 时才返回。
 * 用户若已在前端填了第三方 API key、走 OPENROUTER_API / ANTHROPIC_API 直连，
 * 由调用方自行决定是否合并这个返回值。
 */
export function apiAuthHeaders(): Record<string, string> {
  if (!apiBase || !apiAuthToken) return {};
  return { Authorization: `Bearer ${apiAuthToken}` };
}

/* ---------- 用户在 app 内填写的直连 key ---------- */

export function setUserApiKey(provider: AiProvider, key: string | undefined | null): void {
  userApiKeys[provider] = (key || '').trim();
}

export function getUserApiKey(provider: AiProvider): string {
  return userApiKeys[provider] || '';
}

export function hasAnyUserApiKey(): boolean {
  return Boolean(
    userApiKeys.minimax ||
      userApiKeys.doubao ||
      userApiKeys.openrouter ||
      userApiKeys.deepseek ||
      userApiKeys.claude
  );
}

export function clearAllUserApiKeys(): void {
  userApiKeys.minimax = '';
  userApiKeys.doubao = '';
  userApiKeys.openrouter = '';
  userApiKeys.deepseek = '';
  userApiKeys.claude = '';
}
