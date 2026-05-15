const {
  env,
  handleError,
  normalizeOpenAiBody,
  proxyJsonOrStream,
  readJson,
  sendJson,
} = require('./_shared');

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const apiKey = env('OPENROUTER_API_KEY');
    if (!apiKey) {
      sendJson(res, 500, { error: 'Missing OPENROUTER_API_KEY' });
      return;
    }

    const body = normalizeOpenAiBody(
      await readJson(req),
      env('OPENROUTER_MODEL') || 'google/gemini-2.5-flash',
    );
    if (!body.model) {
      sendJson(res, 500, { error: 'Missing OPENROUTER_MODEL' });
      return;
    }

    const headers = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    };
    const referer = env('AI_HTTP_REFERER') || env('VERCEL_PROJECT_PRODUCTION_URL');
    if (referer) headers['HTTP-Referer'] = referer.startsWith('http') ? referer : `https://${referer}`;
    if (env('AI_APP_TITLE')) headers['X-Title'] = env('AI_APP_TITLE');

    await proxyJsonOrStream({
      req,
      res,
      url: OPENROUTER_API,
      headers,
      body,
    });
  } catch (err) {
    handleError(res, err);
  }
};
