/**
 * 家居收纳 · AI 代理后端
 *
 * 复用仓库根目录的 api/ai/*.js 处理器（与 Vercel functions 同源），
 * 包成 Node 原生 HTTP 服务，对外暴露：
 *   GET  /healthz              健康检查（无鉴权）
 *   GET  /api/ai/status        各 provider 是否配置
 *   POST /api/ai/minimax       MiniMax M3 转发
 *   POST /api/ai/doubao        火山方舟 / 豆包转发
 *   POST /api/ai/openrouter    OpenRouter 转发
 *   POST /api/ai/deepseek      DeepSeek 转发
 *   POST /api/ai/claude        Claude 转发
 *
 * 鉴权：若设置了 AI_PROXY_TOKEN，所有 /api/ai/* 请求需带
 *   Authorization: Bearer <token>
 *
 * CORS：默认放行所有源（GET/POST + 自定义头）；可用 ALLOWED_ORIGINS 收紧。
 */

const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = (process.env.AI_PROXY_TOKEN || '').trim();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 复用 api/ai/*.js handler
const API_DIR = path.resolve(__dirname, '..', 'api', 'ai');
const handlers = {
  status: require(path.join(API_DIR, 'status.js')),
  minimax: require(path.join(API_DIR, 'minimax.js')),
  doubao: require(path.join(API_DIR, 'doubao.js')),
  openrouter: require(path.join(API_DIR, 'openrouter.js')),
  deepseek: require(path.join(API_DIR, 'deepseek.js')),
  claude: require(path.join(API_DIR, 'claude.js')),
};

function pickAllowedOrigin(reqOrigin) {
  if (!reqOrigin) return '*';
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  return ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0] || '';
}

function applyCors(req, res) {
  const origin = pickAllowedOrigin(req.headers.origin);
  if (origin) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    'authorization, content-type, x-api-key, anthropic-version'
  );
  res.setHeader('access-control-max-age', '600');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function checkAuth(req) {
  if (!TOKEN) return true; // 未配置 token，公开访问（不推荐）
  const auth = req.headers['authorization'] || '';
  const expected = `Bearer ${TOKEN}`;
  // 时间安全比较，防 timing 探测
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < auth.length; i++) {
    diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', 'http://internal');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // 健康检查（无鉴权，方便 Caddy / k8s probe）
  if (pathname === '/healthz' || pathname === '/') {
    sendJson(res, 200, { ok: true, ts: Date.now() });
    return;
  }

  // 鉴权：仅对 /api/* 生效
  if (pathname.startsWith('/api/')) {
    if (!checkAuth(req)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
  }

  // 路由分发
  const match = pathname.match(/^\/api\/ai\/(status|minimax|doubao|openrouter|deepseek|claude)$/);
  if (match) {
    const handler = handlers[match[1]];
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[handler error]', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'handler crashed' });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found', path: pathname });
});

// 上游 stream 中断时优雅处理（abort 不让进程崩溃）
server.on('clientError', (err, socket) => {
  console.warn('[clientError]', err?.code || err?.message || err);
  if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

server.listen(PORT, HOST, () => {
  const tokenInfo = TOKEN
    ? `Bearer auth enabled (token len=${TOKEN.length})`
    : '⚠ NO Bearer token (public access, not recommended for production)';
  console.log(`[home-inventory api] listening on http://${HOST}:${PORT}`);
  console.log(`[home-inventory api] ${tokenInfo}`);
  console.log(
    `[home-inventory api] CORS: ${
      ALLOWED_ORIGINS.includes('*') ? 'all origins' : ALLOWED_ORIGINS.join(', ')
    }`
  );
});

// 优雅退出
const shutdown = (signal) => () => {
  console.log(`\n[home-inventory api] received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
