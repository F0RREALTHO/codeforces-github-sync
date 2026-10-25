import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../domain/types';

const auth: AuthState = {
  accessToken: 'ghu_old', refreshToken: 'ghr_old', expiresAt: Date.now() - 1_000,
  refreshTokenExpiresAt: Date.now() + 1_000_000, login: 'octo', installationId: 42,
};

function installChromeStorage(failOnSet?: (key: string, attempt: number) => boolean) {
  const localData = new Map<string, unknown>();
  const sessionData = new Map<string, unknown>();
  let localSetAttempts = 0;
  const area = (data: Map<string, unknown>, isLocal = false) => ({
    get: vi.fn(async (key: string) => ({ [key]: data.get(key) })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      if (isLocal) localSetAttempts += 1;
      for (const [key, value] of Object.entries(values)) {
        if (isLocal && failOnSet?.(key, localSetAttempts)) throw new Error('injected storage write failure');
        data.set(key, structuredClone(value));
      }
    }),
    remove: vi.fn(async (key: string) => { data.delete(key); }),
  });
  vi.stubGlobal('chrome', { storage: { local: area(localData, true), session: area(sessionData) } });
  return { localData, sessionData };
}

async function setup(failOnSet?: (key: string, attempt: number) => boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_AUTH_API_BASE_URL', 'https://auth.example');
  const storage = installChromeStorage(failOnSet);
  const vault = await import('../storage/vault');
  await vault.openVault('long enough test password');
  await vault.saveVaultSecrets({ github: auth });
  const service = await import('./github-auth');
  return { ...storage, vault, service };
}

function callbackUrl(params: Record<string, string>): string {
  const url = new URL('https://ahcgidlkjifgfdcalleiijiabidfehjd.chromiumapp.org/github');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function setupConnect(installationResult: (expectedState: string) => string, oauthResult: (expectedState: string) => string) {
  vi.resetModules();
  vi.stubEnv('VITE_GITHUB_APP_CLIENT_ID', 'test-public-client-id');
  vi.stubEnv('VITE_GITHUB_APP_SLUG', 'test-app');
  vi.stubEnv('VITE_AUTH_API_BASE_URL', 'https://auth.example');
  const verifyInstallation = vi.fn(async (_installationId: number) => undefined);
  const me = vi.fn(async () => ({ login: 'octo' }));
  vi.doMock('./github', () => ({ GithubClient: class {
    verifyInstallation(installationId: number) { return verifyInstallation(installationId); }
    me() { return me(); }
  } }));
  const launchWebAuthFlow = vi.fn(async ({ url }: { url: string }) => {
    const requested = new URL(url);
    const expectedState = requested.searchParams.get('state') || '';
    return requested.pathname.endsWith('/installations/new')
      ? installationResult(expectedState)
      : oauthResult(expectedState);
  });
  vi.stubGlobal('chrome', { identity: {
    launchWebAuthFlow,
    getRedirectURL: (path: string) => `https://ahcgidlkjifgfdcalleiijiabidfehjd.chromiumapp.org/${path}`,
  } });
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ access_token: 'ghu_test', refresh_token: 'ghr_test', expires_in: 3600 }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const service = await import('./github-auth');
  return { service, launchWebAuthFlow, fetchMock, verifyInstallation, me };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.doUnmock('./github'); vi.resetModules(); });

describe('GitHub OAuth callback validation', () => {
  it('accepts matching installation and OAuth states and exchanges the code', async () => {
    const { service, fetchMock, verifyInstallation } = await setupConnect(
      (state) => callbackUrl({ state, installation_id: '42' }),
      (state) => callbackUrl({ state, code: 'single-use-code' }),
    );

    const auth = await service.connectGithub();

    expect(auth).toMatchObject({ login: 'octo', installationId: 42, accessToken: 'ghu_test' });
    expect(verifyInstallation).toHaveBeenCalledWith(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.example/token');
  });

  it.each([
    ['mismatched state', (state: string) => callbackUrl({ state: `${state}-wrong`, code: 'must-not-exchange' })],
    ['missing state', (_state: string) => callbackUrl({ code: 'must-not-exchange' })],
  ])('rejects OAuth callback with %s before token exchange', async (_name, oauthResult) => {
    const { service, fetchMock, verifyInstallation } = await setupConnect(
      (state) => callbackUrl({ state, installation_id: '42' }), oauthResult,
    );

    await expect(service.connectGithub()).rejects.toThrow('GitHub sign-in could not be verified');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(verifyInstallation).not.toHaveBeenCalled();
  });

  it('rejects a replay of a previously consumed OAuth state before exchanging its code', async () => {
    let consumedState = '';
    let oauthCount = 0;
    const { service, fetchMock } = await setupConnect(
      (state) => callbackUrl({ state, installation_id: '42' }),
      (state) => {
        oauthCount += 1;
        if (oauthCount === 1) {
          consumedState = state;
          return callbackUrl({ state, code: 'first-code' });
        }
        return callbackUrl({ state: consumedState, code: 'replayed-code' });
      },
    );

    await service.connectGithub();
    await expect(service.connectGithub()).rejects.toThrow('GitHub sign-in could not be verified');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects installation callback without installation_id', async () => {
    const { service, launchWebAuthFlow, fetchMock } = await setupConnect(
      (state) => callbackUrl({ state }),
      (state) => callbackUrl({ state, code: 'must-not-exchange' }),
    );

    await expect(service.connectGithub()).rejects.toThrow('GitHub App installation could not be verified');
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['mismatched state', (state: string) => callbackUrl({ state: `${state}-wrong`, installation_id: '42' })],
    ['malformed installation_id', (state: string) => callbackUrl({ state, installation_id: 'not-a-number' })],
  ])('rejects installation callback with %s before OAuth authorization', async (_name, installationResult) => {
    const { service, launchWebAuthFlow, fetchMock } = await setupConnect(
      installationResult,
      (state) => callbackUrl({ state, code: 'must-not-exchange' }),
    );

    await expect(service.connectGithub()).rejects.toThrow('GitHub App installation could not be verified');
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed installation callback URL without proceeding', async () => {
    const { service, launchWebAuthFlow, fetchMock } = await setupConnect(
      () => 'not a callback URL',
      (state) => callbackUrl({ state, code: 'must-not-exchange' }),
    );

    await expect(service.connectGithub()).rejects.toThrow();
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GitHub refresh-token rotation', () => {
  it.each([
    ['Client ID', '', 'production-app', 'https://auth.example'],
    ['App slug', 'client-id', '', 'https://auth.example'],
    ['Worker URL', 'client-id', 'production-app', ''],
  ])('rejects GitHub OAuth clearly when the %s build value is missing', async (_missing, clientId, slug, workerUrl) => {
    vi.resetModules();
    vi.stubEnv('VITE_GITHUB_APP_CLIENT_ID', clientId);
    vi.stubEnv('VITE_GITHUB_APP_SLUG', slug);
    vi.stubEnv('VITE_AUTH_API_BASE_URL', workerUrl);
    const service = await import('./github-auth');
    expect(service.authConfigured()).toBe(false);
    await expect(service.connectGithub()).rejects.toThrow('GitHub sign-in is not configured in this build yet.');
  });

  it('single-flights concurrent refresh requests and persists the rotated pair', async () => {
    const { service, vault } = await setup();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(JSON.stringify({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28_800, refresh_token_expires_in: 15_897_600 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const [one, two] = await Promise.all([service.getUsableAuth(auth), service.getUsableAuth(auth)]);
    expect(calls).toBe(1);
    expect(one.refreshToken).toBe('ghr_new');
    expect(two.accessToken).toBe('ghu_new');
    expect(await vault.readVaultSecrets()).toMatchObject({ github: { accessToken: 'ghu_new', refreshToken: 'ghr_new' }, githubRefreshPending: false });
  });

  it('marks an uncertain network rotation durably and never retries the old token', async () => {
    const { service, vault } = await setup();
    const fetchMock = vi.fn(async () => { throw new Error('connection dropped after request'); });
    vi.stubGlobal('fetch', fetchMock);
    await expect(service.getUsableAuth(auth)).rejects.toThrow('Reconnect GitHub');
    await expect(service.getUsableAuth(auth)).rejects.toThrow('Reconnect GitHub');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await vault.readVaultSecrets()).githubRefreshPending).toBe(true);
  });

  it('requires reconnection if rotation succeeded remotely but storing the new pair fails', async () => {
    const vaultKey = 'cfgh.credentialVault.v1';
    const { service, vault } = await setup((key, attempt) => key === vaultKey && attempt === 4);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28_800, refresh_token_expires_in: 15_897_600 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(service.getUsableAuth(auth)).rejects.toThrow('Reconnect GitHub');
    await expect(service.getUsableAuth(auth)).rejects.toThrow('Reconnect GitHub');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await vault.readVaultSecrets()).githubRefreshPending).toBe(true);
  });
});
