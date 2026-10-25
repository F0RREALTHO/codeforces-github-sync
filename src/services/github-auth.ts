import type { AuthState } from '../domain/types';
import { GithubClient } from './github';
import { readVaultSecrets, updateVaultSecrets } from '../storage/vault';

const CLIENT_ID = import.meta.env.VITE_GITHUB_APP_CLIENT_ID as string | undefined;
const APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined;
const AUTH_API_VALUE = import.meta.env.VITE_AUTH_API_BASE_URL as string | undefined;
const AUTH_API = AUTH_API_VALUE?.replace(/\/+$/, '');
const refreshFlights = new Map<string, Promise<AuthState>>();
const RECONNECT_MESSAGE = 'GitHub token refresh could not be safely completed. Reconnect GitHub before continuing.';

export function authConfigured(): boolean { return Boolean(CLIENT_ID && APP_SLUG && AUTH_API); }

export async function connectGithub(): Promise<AuthState> {
  if (!CLIENT_ID || !APP_SLUG || !AUTH_API) throw new Error('GitHub sign-in is not configured in this build yet.');
  const installState = randomToken(32);
  const installUrl = new URL(`https://github.com/apps/${encodeURIComponent(APP_SLUG)}/installations/new`);
  installUrl.searchParams.set('state', installState);
  const installCallback = await chrome.identity.launchWebAuthFlow({ url: installUrl.toString(), interactive: true });
  if (!installCallback) throw new Error('GitHub App installation was cancelled.');
  const installResult = new URL(installCallback);
  if (installResult.searchParams.get('state') !== installState || !/^\d+$/.test(installResult.searchParams.get('installation_id') || '')) throw new Error('GitHub App installation could not be verified. Check its configured Setup URL and retry.');
  const installationId = Number(installResult.searchParams.get('installation_id'));
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = await sha256url(verifier);
  const redirectUri = chrome.identity.getRedirectURL('github');
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', 'offline_access');
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  const callback = await chrome.identity.launchWebAuthFlow({ url: authorize.toString(), interactive: true });
  if (!callback) throw new Error('GitHub sign-in was cancelled.');
  const returned = new URL(callback);
  if (returned.searchParams.get('state') !== state) throw new Error('GitHub sign-in could not be verified. Please retry.');
  const code = returned.searchParams.get('code');
  const oauthError = returned.searchParams.get('error_description') || returned.searchParams.get('error');
  if (!code) throw new Error(oauthError || 'GitHub did not return an authorization code.');
  const token = await authRequest<{ access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>(`${AUTH_API}/token`, { code, code_verifier: verifier, redirect_uri: redirectUri });
  const provisional: AuthState = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined, refreshTokenExpiresAt: token.refresh_token_expires_in ? Date.now() + token.refresh_token_expires_in * 1000 : undefined, login: '' };
  provisional.installationId = installationId;
  const client = new GithubClient(provisional);
  await client.verifyInstallation(installationId);
  provisional.login = (await client.me()).login;
  return provisional;
}

export async function getUsableAuth(authHint: AuthState): Promise<AuthState> {
  if (authHint.refreshToken) {
    const joined = refreshFlights.get(authHint.refreshToken);
    if (joined) return joined;
  }
  const secrets = await readVaultSecrets();
  if (secrets.githubRefreshPending) {
    const joined = authHint.refreshToken ? refreshFlights.get(authHint.refreshToken) : undefined;
    if (joined) return joined;
    throw new Error(RECONNECT_MESSAGE);
  }
  const auth = secrets.github;
  if (!auth) throw new Error('Reconnect GitHub to continue.');
  if (!auth.expiresAt || auth.expiresAt > Date.now() + 60_000) return auth;
  if (!auth.refreshToken || !AUTH_API) throw new Error('GitHub authorization expired. Reconnect GitHub to continue.');
  const existing = refreshFlights.get(auth.refreshToken);
  if (existing) return existing;
  const flight = refreshAndPersist(auth);
  refreshFlights.set(auth.refreshToken, flight);
  try { return await flight; }
  finally { if (refreshFlights.get(auth.refreshToken) === flight) refreshFlights.delete(auth.refreshToken); }
}

async function refreshAndPersist(auth: AuthState): Promise<AuthState> {
  if (!AUTH_API || !auth.refreshToken) throw new Error('GitHub authorization expired. Reconnect GitHub to continue.');
  await updateVaultSecrets((current) => {
    if (current.githubRefreshPending || !current.github || current.github.refreshToken !== auth.refreshToken) throw new Error(RECONNECT_MESSAGE);
    return { ...current, githubRefreshPending: true };
  });
  let token: { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number };
  try {
    token = await authRequest(`${AUTH_API}/refresh`, { refresh_token: auth.refreshToken! });
    if (!token.access_token || !token.refresh_token || !token.expires_in || !token.refresh_token_expires_in) throw new Error('GitHub did not return a complete rotated token pair.');
  } catch {
    // Keep the durable pending marker: the refresh token may already have been consumed remotely.
    throw new Error(RECONNECT_MESSAGE);
  }
  const rotated: AuthState = {
    ...auth,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    refreshTokenExpiresAt: Date.now() + token.refresh_token_expires_in * 1000,
  };
  try {
    await updateVaultSecrets((current) => {
      if (!current.githubRefreshPending || current.github?.refreshToken !== auth.refreshToken) throw new Error(RECONNECT_MESSAGE);
      return { ...current, github: rotated, githubRefreshPending: false };
    });
  } catch {
    // The old refresh token must never be retried after a possibly successful rotation.
    throw new Error(RECONNECT_MESSAGE);
  }
  return rotated;
}

async function authRequest<T>(url: string, body: Record<string, string>): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('Could not reach the sign-in service.'); }
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'GitHub sign-in failed.');
  return result;
}
function randomToken(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
