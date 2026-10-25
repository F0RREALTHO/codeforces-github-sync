import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

const env = { GITHUB_APP_CLIENT_ID: 'client-public-id', GITHUB_APP_CLIENT_SECRET: 'secret-never-return', EXTENSION_ORIGIN: 'chrome-extension://ahcgidlkjifgfdcalleiijiabidfehjd', GITHUB_REDIRECT_URI: 'https://ahcgidlkjifgfdcalleiijiabidfehjd.chromiumapp.org/github' };
const request = (path: string, body: unknown, origin = env.EXTENSION_ORIGIN) => new Request(`https://auth.example${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const preflight = (origin: string) => new Request('https://auth.example/token', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });

afterEach(() => vi.unstubAllGlobals());

describe('OAuth token exchange worker', () => {
  it('allows preflight from the exact production extension origin with only the expected methods and headers', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(preflight(env.EXTENSION_ORIGIN), env);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.EXTENSION_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('600');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not grant CORS permission to an untrusted preflight origin', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(preflight('https://attacker.example'), env);

    // OPTIONS receives an empty response, but without Access-Control-Allow-Origin
    // a browser cannot proceed with the cross-origin request.
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Headers')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges a PKCE code and returns token fields without exposing the client secret', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('client_id')).toBe(env.GITHUB_APP_CLIENT_ID);
      expect(form.get('client_secret')).toBe(env.GITHUB_APP_CLIENT_SECRET);
      expect(form.get('code')).toBe('short-lived-code');
      expect(form.get('code_verifier')).toBe('v'.repeat(48));
      expect(form.get('redirect_uri')).toBe(env.GITHUB_REDIRECT_URI);
      return new Response(JSON.stringify({ access_token: 'ghu_access', refresh_token: 'ghr_refresh', expires_in: 28800, refresh_token_expires_in: 15897600 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request('/token', { code: 'short-lived-code', code_verifier: 'v'.repeat(48), redirect_uri: env.GITHUB_REDIRECT_URI }), env);
    const value = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(value).toMatchObject({ access_token: 'ghu_access', refresh_token: 'ghr_refresh' });
    expect(JSON.stringify(value)).not.toContain(env.GITHUB_APP_CLIENT_SECRET);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.EXTENSION_ORIGIN);
  });

  it('rejects an untrusted browser origin without contacting GitHub', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request('/token', { code: 'bad', code_verifier: 'v'.repeat(48), redirect_uri: env.GITHUB_REDIRECT_URI }, 'https://attacker.example'), env);
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the exact registered redirect URI and valid verifier', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request('/token', { code: 'code', code_verifier: 'too-short', redirect_uri: 'https://attacker.example/callback' }), env);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not exchange a valid PKCE verifier for an unregistered redirect URI', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request('/token', {
      code: 'code',
      code_verifier: 'v'.repeat(43),
      redirect_uri: 'https://unregistered.example/callback',
    }), env);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a configured Firefox origin and registered Firefox redirect without weakening Chrome origins', async () => {
    const firefoxOrigin = 'moz-extension://123e4567-e89b-42d3-a456-426614174000';
    const firefoxRedirect = 'https://208ea976c859f3fa9fe5eb7c94139ef61077879a.extensions.allizom.org/github';
    const configured = { ...env, ALLOW_FIREFOX_EXTENSION_ORIGINS: 'true', GITHUB_REDIRECT_URIS: firefoxRedirect };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ access_token: 'firefox-token' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(request('/token', { code: 'firefox-code', code_verifier: 'f'.repeat(43), redirect_uri: firefoxRedirect }, firefoxOrigin), configured);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(firefoxOrigin);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('redirect_uri')).toBe(firefoxRedirect);
    const chrome = await worker.fetch(request('/token', { code: 'chrome-code', code_verifier: 'c'.repeat(43), redirect_uri: env.GITHUB_REDIRECT_URI }), configured);
    expect(chrome.status).toBe(200);
  });

  it('accepts the exact Edge store origin and redirect when configured', async () => {
    const edgeOrigin = 'chrome-extension://jpenndpejbklhljfpghhddiollhikdgk';
    const edgeRedirect = 'https://jpenndpejbklhljfpghhddiollhikdgk.chromiumapp.org/github';
    const configured = { ...env, EXTRA_EXTENSION_ORIGINS: edgeOrigin, GITHUB_REDIRECT_URIS: edgeRedirect };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ access_token: 'edge-token' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(request('/token', { code: 'edge-code', code_verifier: 'e'.repeat(43), redirect_uri: edgeRedirect }, edgeOrigin), configured);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(edgeOrigin);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).get('redirect_uri')).toBe(edgeRedirect);
  });

  it.each([
    ['disabled Firefox origins', { ALLOW_FIREFOX_EXTENSION_ORIGINS: 'false' }],
    ['malformed Firefox UUID', { ALLOW_FIREFOX_EXTENSION_ORIGINS: 'true' }],
  ])('rejects %s and does not contact GitHub', async (caseName, overrides) => {
    void caseName;
    const origin = overrides.ALLOW_FIREFOX_EXTENSION_ORIGINS === 'true'
      ? 'moz-extension://not-a-uuid'
      : 'moz-extension://123e4567-e89b-42d3-a456-426614174000';
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request('/token', { code: 'code', code_verifier: 'f'.repeat(43), redirect_uri: env.GITHUB_REDIRECT_URI }, origin), { ...env, ...overrides });
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes expiring user tokens without storing token material on the Worker', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('grant_type')).toBe('refresh_token');
      expect(form.get('refresh_token')).toBe('ghr_old');
      return new Response(JSON.stringify({ access_token: 'ghu_new', refresh_token: 'ghr_rotated', expires_in: 28800 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request('/refresh', { refresh_token: 'ghr_old' }), env);
    expect(await response.json()).toMatchObject({ access_token: 'ghu_new', refresh_token: 'ghr_rotated' });
  });
});

describe('GitHub App installation setup callback', () => {
  const firefoxRedirect = 'https://208ea976c859f3fa9fe5eb7c94139ef61077879a.extensions.allizom.org/github';
  const stateFor = (redirectUri: string) => {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(redirectUri))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `v1.${'s'.repeat(43)}.${encoded}`;
  };
  const callback = (params: Record<string, string>) => {
    const url = new URL('https://auth.example/installation-callback');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return new Request(url);
  };

  it('redirects valid installation_id and state only to its registered browser callback', async () => {
    const state = stateFor(firefoxRedirect);
    const response = await worker.fetch(callback({ installation_id: '174897374', state }), { ...env, GITHUB_REDIRECT_URIS: firefoxRedirect });
    const location = new URL(response.headers.get('Location')!);
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe(firefoxRedirect);
    expect(location.searchParams.get('installation_id')).toBe('174897374');
    expect(location.searchParams.get('state')).toBe(state);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it.each([
    ['missing installation_id', { state: stateFor(env.GITHUB_REDIRECT_URI) }],
    ['malformed installation_id', { installation_id: '42x', state: stateFor(env.GITHUB_REDIRECT_URI) }],
    ['missing state', { installation_id: '42' }],
    ['malformed state', { installation_id: '42', state: 'not-a-state' }],
  ])('rejects %s without exchanging tokens or redirecting', async (_label, params) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(callback(params), env);
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an installation state containing an unregistered redirect target', async () => {
    const response = await worker.fetch(callback({ installation_id: '42', state: stateFor('https://attacker.example/callback') }), env);
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
  });
});
