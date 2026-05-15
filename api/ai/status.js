const { env, sendJson } = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  sendJson(res, 200, {
    openrouter: Boolean(env('OPENROUTER_API_KEY')),
    deepseek: Boolean(env('DEEPSEEK_API_KEY')),
    claude: Boolean(env('ANTHROPIC_API_KEY') || env('CLAUDE_API_KEY')),
    openrouterModel: env('OPENROUTER_MODEL') || 'google/gemini-2.5-flash',
    deepseekModel: env('DEEPSEEK_MODEL') || 'deepseek-v4-flash',
    claudeModel: env('ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514',
  });
};
