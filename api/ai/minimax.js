const {
  env,
  handleError,
  normalizeOpenAiBody,
  proxyJsonOrStream,
  readJson,
  sendJson,
} = require('./_shared');

const DEFAULT_MINIMAX_API = 'https://api.minimaxi.com/v1/chat/completions';

function minimaxApiUrl() {
  const explicit = env('MINIMAX_API_URL');
  if (explicit) return explicit;
  const base = (env('MINIMAX_BASE_URL') || 'https://api.minimaxi.com/v1').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const apiKey =
      env('MINIMAX_API_KEY') || env('MINIMAX_TOKEN_PLAN_KEY') || env('MINIMAX_TOKEN_PLAN_API_KEY');
    if (!apiKey) {
      sendJson(res, 500, { error: 'Missing MINIMAX_API_KEY' });
      return;
    }

    const body = normalizeOpenAiBody(await readJson(req), env('MINIMAX_MODEL') || 'MiniMax-M3');
    body.max_completion_tokens = body.max_tokens;
    body.reasoning_split = true;
    delete body.max_tokens;
    if (!body.model) {
      sendJson(res, 500, { error: 'Missing MINIMAX_MODEL' });
      return;
    }

    await proxyJsonOrStream({
      req,
      res,
      url: minimaxApiUrl() || DEFAULT_MINIMAX_API,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body,
    });
  } catch (err) {
    handleError(res, err);
  }
};
