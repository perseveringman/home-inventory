"use strict";
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
 * 用户也可以在 app 设置页填写自己的 API key（MiniMax / OpenRouter / DeepSeek / Claude），
 * 填了之后调用 getUserApiKey(provider) 拿到值，业务层据此直连官方 API，
 * 跳过自建后端代理。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setApiBase = setApiBase;
exports.getApiBase = getApiBase;
exports.apiUrl = apiUrl;
exports.setApiAuthToken = setApiAuthToken;
exports.getApiAuthToken = getApiAuthToken;
exports.apiAuthHeaders = apiAuthHeaders;
exports.setUserApiKey = setUserApiKey;
exports.getUserApiKey = getUserApiKey;
exports.hasAnyUserApiKey = hasAnyUserApiKey;
exports.clearAllUserApiKeys = clearAllUserApiKeys;
let apiBase = '';
let apiAuthToken = '';
const userApiKeys = {
    minimax: '',
    openrouter: '',
    deepseek: '',
    claude: '',
};
function setApiBase(base) {
    apiBase = (base || '').replace(/\/+$/, '');
}
function getApiBase() {
    return apiBase;
}
function apiUrl(path) {
    if (!path.startsWith('/'))
        path = '/' + path;
    return apiBase ? `${apiBase}${path}` : path;
}
function setApiAuthToken(token) {
    apiAuthToken = (token || '').trim();
}
function getApiAuthToken() {
    return apiAuthToken;
}
/**
 * 获取调用独立后端时需要带的 Authorization 头。
 * 仅当：① 配置了 apiBase（即真在走独立后端） ② token 非空 时才返回。
 * 用户若已在前端填了第三方 API key、走 OPENROUTER_API / ANTHROPIC_API 直连，
 * 由调用方自行决定是否合并这个返回值。
 */
function apiAuthHeaders() {
    if (!apiBase || !apiAuthToken)
        return {};
    return { Authorization: `Bearer ${apiAuthToken}` };
}
/* ---------- 用户在 app 内填写的直连 key ---------- */
function setUserApiKey(provider, key) {
    userApiKeys[provider] = (key || '').trim();
}
function getUserApiKey(provider) {
    return userApiKeys[provider] || '';
}
function hasAnyUserApiKey() {
    return Boolean(userApiKeys.minimax || userApiKeys.openrouter || userApiKeys.deepseek || userApiKeys.claude);
}
function clearAllUserApiKeys() {
    userApiKeys.minimax = '';
    userApiKeys.openrouter = '';
    userApiKeys.deepseek = '';
    userApiKeys.claude = '';
}
