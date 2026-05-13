const crypto = require('node:crypto');

const DEFAULT_SHADOW_BASE_URL = 'https://shadowob.com';

function baseUrlFromRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function signSession(session, secret) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function redirectToRooms(res, status) {
  res.redirect(302, `/rooms?shadow_oauth=${encodeURIComponent(status)}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).send('Method Not Allowed');
    return;
  }

  const appBaseUrl = (process.env.SHADOW_APP_BASE_URL || baseUrlFromRequest(req)).replace(/\/$/, '');
  const shadowBaseUrl = (process.env.SHADOW_BASE_URL || DEFAULT_SHADOW_BASE_URL).replace(/\/$/, '');
  const redirectUri =
    process.env.SHADOW_REDIRECT_URI || `${appBaseUrl}/api/shadow/oauth/callback`;
  const clientId = process.env.SHADOW_CLIENT_ID;
  const clientSecret = process.env.SHADOW_CLIENT_SECRET;
  const sessionSecret = process.env.SHADOW_SESSION_SECRET || clientSecret;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const secure = proto === 'https' || process.env.NODE_ENV === 'production';

  const url = new URL(req.url, appBaseUrl);
  const error = url.searchParams.get('error');
  if (error) {
    redirectToRooms(res, error === 'access_denied' ? 'denied' : 'error');
    return;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  if (!code) {
    redirectToRooms(res, 'missing_code');
    return;
  }

  const stateCookie = parseCookies(req).shadow_oauth_state;
  const launchedFromShadow = state.startsWith('play:');
  if (stateCookie && state !== stateCookie) {
    redirectToRooms(res, 'invalid_state');
    return;
  }
  if (!stateCookie && state && !launchedFromShadow) {
    redirectToRooms(res, 'invalid_state');
    return;
  }

  if (!clientId || !clientSecret || !sessionSecret) {
    res.status(500).send('Missing Shadow OAuth environment variables');
    return;
  }

  try {
    const tokenResponse = await fetch(`${shadowBaseUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      console.error('Shadow token exchange failed', tokenResponse.status, token);
      redirectToRooms(res, 'token_error');
      return;
    }

    const userResponse = await fetch(`${shadowBaseUrl}/api/oauth/userinfo`, {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        accept: 'application/json',
      },
    });
    const user = await userResponse.json().catch(() => null);

    const session = {
      accessToken: token.access_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      scope: token.scope || '',
      user:
        user && typeof user === 'object'
          ? {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatarUrl: user.avatarUrl,
            }
          : null,
    };

    res.setHeader('Set-Cookie', [
      cookie('shadow_oauth_state', '', {
        httpOnly: true,
        maxAge: 0,
        path: '/api/shadow/oauth/callback',
        sameSite: 'Lax',
        secure,
      }),
      cookie('shadow_oauth_session', signSession(session, sessionSecret), {
        httpOnly: true,
        maxAge: Math.max(60, Math.min(Number(token.expires_in || 3600), 3600)),
        path: '/',
        sameSite: 'Lax',
        secure,
      }),
    ]);
    redirectToRooms(res, 'connected');
  } catch (error) {
    console.error('Shadow OAuth callback failed', error);
    redirectToRooms(res, 'error');
  }
};
