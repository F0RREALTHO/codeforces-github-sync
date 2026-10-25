interface Env {
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
  EXTENSION_ORIGIN: string;
  GITHUB_REDIRECT_URI: string;
  GITHUB_REDIRECT_URIS?: string;
  EXTRA_EXTENSION_ORIGINS?: string;
  ALLOW_FIREFOX_EXTENSION_ORIGINS?: string;
}
interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; error?: string; error_description?: string; }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    if (request.method === 'GET' && new URL(request.url).pathname === '/installation-callback') {
      return installationCallback(request, env);
    }
    const allowedOrigin = isAllowedExtensionOrigin(origin, env);
    if (origin && allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Max-Age', '600');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!allowedOrigin) return json({ error: 'Origin not allowed.' }, 403, headers);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, headers);
    const url = new URL(request.url);
    if (url.pathname !== '/token' && url.pathname !== '/refresh') return json({ error: 'Not found.' }, 404, headers);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return json({ error: 'Invalid request.' }, 400, headers); }
    const params = new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET });
    if (url.pathname === '/token') {
      if (typeof body.code !== 'string' || typeof body.code_verifier !== 'string' || !allowedRedirectUris(env).includes(String(body.redirect_uri)) || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) return json({ error: 'Invalid authorization request.' }, 400, headers);
      params.set('code', body.code);
      params.set('code_verifier', body.code_verifier);
      params.set('redirect_uri', String(body.redirect_uri));
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

function isAllowedExtensionOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  const fixed = [env.EXTENSION_ORIGIN, ...(env.EXTRA_EXTENSION_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)];
  if (fixed.includes(origin)) return true;
  // Firefox assigns a profile-specific moz-extension UUID. This is only a
  // transport/CORS gate; OAuth code+PKCE and exact redirect allowlisting remain
  // the authorization checks.
  return env.ALLOW_FIREFOX_EXTENSION_ORIGINS === 'true' && /^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(origin);
}

function allowedRedirectUris(env: Env): string[] {
  return [...new Set([env.GITHUB_REDIRECT_URI, ...(env.GITHUB_REDIRECT_URIS || '').split(',').map((value) => value.trim()).filter(Boolean)])];
}

function installationCallback(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const installationId = url.searchParams.get('installation_id');
  const state = url.searchParams.get('state');
  if (!installationId || !/^\d+$/.test(installationId) || !state || state.length > 2048) return new Response('Invalid GitHub App installation callback.', { status: 400, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  const match = /^v1\.([A-Za-z0-9_-]{43,64})\.([A-Za-z0-9_-]{1,1024})$/.exec(state);
  if (!match) return new Response('Invalid GitHub App installation state.', { status: 400, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  let redirectUri: string;
  try {
    const encoded = match[2].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
    redirectUri = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new Response('Invalid GitHub App installation redirect.', { status: 400, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  if (!allowedRedirectUris(env).includes(redirectUri)) return new Response('GitHub App installation redirect is not registered.', { status: 400, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  const destination = new URL(redirectUri);
  destination.searchParams.set('installation_id', installationId);
  destination.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: destination.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

function json(body: unknown, status: number, headers: Headers): Response {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}
