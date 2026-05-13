const crypto = require('node:crypto');

const DEFAULT_SHADOW_BASE_URL = 'https://shadowob.com';
const DEFAULT_SCOPES = 'user:read';

function env(name) {
  return process.env[name]?.trim();
}

function baseUrlFromRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).send('Method Not Allowed');
    return;
  }

  const clientId = env('SHADOW_CLIENT_ID');
  if (!clientId) {
    res.status(500).send('Missing SHADOW_CLIENT_ID');
    return;
  }

  const appBaseUrl = (env('SHADOW_APP_BASE_URL') || baseUrlFromRequest(req)).replace(/\/$/, '');
  const shadowBaseUrl = (env('SHADOW_BASE_URL') || DEFAULT_SHADOW_BASE_URL).replace(/\/$/, '');
  const redirectUri =
    env('SHADOW_REDIRECT_URI') || `${appBaseUrl}/api/shadow/oauth/callback`;
  const scopes = env('SHADOW_OAUTH_SCOPES') || DEFAULT_SCOPES;
  const state = crypto.randomBytes(16).toString('hex');

  const proto = req.headers['x-forwarded-proto'] || 'https';
  res.setHeader(
    'Set-Cookie',
    cookie('shadow_oauth_state', state, {
      httpOnly: true,
      maxAge: 600,
      path: '/api/shadow/oauth/callback',
      sameSite: 'Lax',
      secure: proto === 'https' || process.env.NODE_ENV === 'production',
    }),
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  });
  res.redirect(302, `${shadowBaseUrl}/oauth/authorize?${params.toString()}`);
};
