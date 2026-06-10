const {
  env,
  handleError,
  normalizeOpenAiBody,
  proxyJsonOrStream,
  readJson,
  sendJson,
} = require('./_shared');

const DEFAULT_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_DOUBAO_MODEL = 'doubao-seed-2-0-lite-260215';

function doubaoApiUrl() {
  const explicit = env('DOUBAO_API_URL') || env('ARK_API_URL');
  if (explicit) return explicit;
  const base = (env('DOUBAO_BASE_URL') || env('ARK_BASE_URL') || DEFAULT_ARK_BASE_URL).replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

function normalizeServiceTier(value) {
  if (value == null || value === '') return undefined;
  const text = String(value).trim();
  return ['fast', 'auto', 'default'].includes(text) ? text : undefined;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const apiKey = env('ARK_API_KEY') || env('DOUBAO_API_KEY') || env('VOLCENGINE_API_KEY');
    if (!apiKey) {
      sendJson(res, 500, { error: 'Missing ARK_API_KEY' });
      return;
    }

    const raw = await readJson(req);
    const body = normalizeOpenAiBody(
      raw,
      env('DOUBAO_MODEL') || env('ARK_MODEL') || DEFAULT_DOUBAO_MODEL,
    );
    const serviceTier = normalizeServiceTier(raw.service_tier);
    if (serviceTier) body.service_tier = serviceTier;
    if (!body.model) {
      sendJson(res, 500, { error: 'Missing DOUBAO_MODEL' });
      return;
    }

    await proxyJsonOrStream({
      req,
      res,
      url: doubaoApiUrl(),
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
