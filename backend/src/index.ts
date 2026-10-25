interface Env {
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  EXTENSION_ORIGIN: string;
  GITHUB_REDIRECT_URI: string;
}
interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string; error_description?: string; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    if (origin === env.EXTENSION_ORIGIN) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Max-Age', '600');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (origin !== env.EXTENSION_ORIGIN) return json({ error: 'Origin not allowed.' }, 403, headers);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, headers);
    const url = new URL(request.url);
    if (url.pathname !== '/token' && url.pathname !== '/refresh') return json({ error: 'Not found.' }, 404, headers);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return json({ error: 'Invalid request.' }, 400, headers); }
    const params = new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET });
    if (url.pathname === '/token') {
      if (typeof body.code !== 'string' || typeof body.code_verifier !== 'string' || body.redirect_uri !== env.GITHUB_REDIRECT_URI || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) return json({ error: 'Invalid authorization request.' }, 400, headers);
      params.set('code', body.code);
      params.set('code_verifier', body.code_verifier);
      params.set('redirect_uri', env.GITHUB_REDIRECT_URI);
    } else {
      if (typeof body.refresh_token !== 'string' || body.refresh_token.length > 4096) return json({ error: 'Invalid refresh request.' }, 400, headers);
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', body.refresh_token);
    }
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    } catch { return json({ error: 'GitHub authorization service is unavailable.' }, 502, headers); }
    if (!tokenResponse.ok) return json({ error: 'GitHub authorization failed. Retry sign-in.' }, 502, headers);
    const result = await tokenResponse.json() as TokenResponse;
    if (!result.access_token) return json({ error: result.error_description || 'GitHub authorization failed.' }, 401, headers);
    const safe = { access_token: result.access_token, refresh_token: result.refresh_token, expires_in: result.expires_in, refresh_token_expires_in: result.refresh_token_expires_in };
    return json(safe, 200, headers);
  },
};

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}
