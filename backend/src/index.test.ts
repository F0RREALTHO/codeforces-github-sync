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
