const {
  env,
  handleError,
  normalizeOpenAiBody,
  proxyJsonOrStream,
  readJson,
  sendJson,
} = require('./_shared');

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const apiKey = env('DEEPSEEK_API_KEY');
    if (!apiKey) {
      sendJson(res, 500, { error: 'Missing DEEPSEEK_API_KEY' });
      return;
    }

    const body = normalizeOpenAiBody(
      await readJson(req),
      env('DEEPSEEK_MODEL') || 'deepseek-v4-flash',
    );
    if (!body.model) {
      sendJson(res, 500, { error: 'Missing DEEPSEEK_MODEL' });
      return;
    }

    await proxyJsonOrStream({
      req,
      res,
      url: DEEPSEEK_API,
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
