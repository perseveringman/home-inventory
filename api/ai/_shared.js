function env(name) {
  return process.env[name]?.trim();
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeOpenAiBody(body, defaultModel) {
  if (!Array.isArray(body.messages)) {
    const err = new Error('messages must be an array');
    err.statusCode = 400;
    throw err;
  }
  return {
    model: String(body.model || defaultModel || '').trim(),
    messages: body.messages,
    max_tokens: clampNumber(body.max_tokens ?? body.maxTokens, 4096, 1, 8192),
    temperature: clampNumber(body.temperature, 0.6, 0, 2),
    stream: Boolean(body.stream),
  };
}

async function proxyJsonOrStream({ req, res, url, headers, body }) {
  const upstream = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    sendJson(res, upstream.status, {
      error: `AI provider returned ${upstream.status}`,
      detail: text.slice(0, 500),
    });
    return;
  }

  if (body.stream) {
    res.statusCode = 200;
    res.setHeader('content-type', upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');

    if (!upstream.body) {
      res.end();
      return;
    }
    const reader = upstream.body.getReader();
    while (true) {
      if (req.destroyed) {
        await reader.cancel().catch(() => undefined);
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
    return;
  }

  const text = await upstream.text();
  try {
    sendJson(res, 200, JSON.parse(text));
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

function handleError(res, err) {
  const status = err.statusCode || 500;
  sendJson(res, status, { error: err.message || 'AI request failed' });
}

module.exports = {
  clampNumber,
  env,
  handleError,
  normalizeOpenAiBody,
  proxyJsonOrStream,
  readJson,
  sendJson,
};
