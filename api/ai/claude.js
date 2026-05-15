const {
  clampNumber,
  env,
  handleError,
  proxyJsonOrStream,
  readJson,
  sendJson,
} = require('./_shared');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const apiKey = env('ANTHROPIC_API_KEY') || env('CLAUDE_API_KEY');
    if (!apiKey) {
      sendJson(res, 500, { error: 'Missing ANTHROPIC_API_KEY' });
      return;
    }

    const raw = await readJson(req);
    if (!Array.isArray(raw.messages)) {
      sendJson(res, 400, { error: 'messages must be an array' });
      return;
    }

    await proxyJsonOrStream({
      req,
      res,
      url: ANTHROPIC_API,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': env('ANTHROPIC_VERSION') || '2023-06-01',
        'content-type': 'application/json',
      },
      body: {
        model: String(raw.model || env('ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514').trim(),
        max_tokens: clampNumber(raw.max_tokens ?? raw.maxTokens, 4096, 1, 8192),
        messages: raw.messages,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
};
