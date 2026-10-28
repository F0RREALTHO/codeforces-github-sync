import { browserApi } from '../platform/browser';
import type { CfSubmission, CodeforcesCredentials } from '../domain/types';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number) { super(message); this.name = 'ApiError'; }
}

export async function requestJson<T>(url: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try { response = await fetcher(url, init); }
  catch { throw new ApiError('Network connection failed. Check your connection and retry.'); }
  if (!response.ok) {
    const retryHeader = response.headers.get('Retry-After');
    const reset = response.headers.get('X-RateLimit-Reset');
    const rateLimited = response.status === 429 || (response.status === 403 && (response.headers.get('X-RateLimit-Remaining') === '0' || Boolean(retryHeader)));
    const retryAfterMs = retryHeader ? Number(retryHeader) * 1000 : reset ? Math.max(1000, Number(reset) * 1000 - Date.now()) : undefined;
    const message = response.status === 401 || response.status === 403
      ? rateLimited ? 'Service rate limit reached. Sync will retry later.' : 'Authorization failed or repository access is missing.'
      : response.status === 404 ? 'Requested account, repository, or file was not found.'
      : rateLimited ? 'Service rate limit reached. Sync will retry later.'
      : `Service returned HTTP ${response.status}.`;
    throw new ApiError(message, response.status, retryAfterMs);
  }
  return await response.json() as T;
}

export interface CfApiResponse<T> { status: 'OK' | 'FAILED'; comment?: string; result: T; }

/** Normalize Codeforces' optional source payload without logging or persisting the encoded form. */
export function submissionSource(submission: CfSubmission): string | undefined {
  for (const value of [submission.source, submission.sourceCode]) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  const encoded = submission.sourceBase64;
  if (typeof encoded !== 'string' || encoded.length === 0) return undefined;
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) return undefined;
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return source.length > 0 ? source : undefined;
  } catch {
    return undefined;
  }
}

const CF_LAST_CALL_KEY = 'cfgh.codeforcesLastCall';
let cfQueue: Promise<void> = Promise.resolve();
export async function rateLimitedCfJson<T>(url: string, fetcher: typeof fetch = fetch): Promise<T> {
  let unlock: () => void = () => {};
  const previousQueued = cfQueue;
  cfQueue = new Promise<void>((resolve) => { unlock = resolve; });
  await previousQueued;
  try {
    const previous = Number((await browserApi().storage.local.get(CF_LAST_CALL_KEY))[CF_LAST_CALL_KEY] || 0);
    const remaining = 2100 - (Date.now() - previous);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    await browserApi().storage.local.set({ [CF_LAST_CALL_KEY]: Date.now() });
    return await requestJson<T>(url, undefined, fetcher);
  } finally { unlock(); }
}
export async function fetchSubmissionPage(handle: string, from: number, count = 1000, credentials?: CodeforcesCredentials, includeSources = true, fetcher: typeof fetch = fetch): Promise<CfSubmission[]> {
  const url = new URL('https://codeforces.com/api/user.status');
  url.searchParams.set('handle', handle);
  url.searchParams.set('from', String(from));
  url.searchParams.set('count', String(count));
  if (includeSources) url.searchParams.set('includeSources', 'true');
  if (credentials) {
    const timestamp = Math.floor(Date.now() / 1000);
    url.searchParams.set('apiKey', credentials.apiKey);
    url.searchParams.set('time', String(timestamp));
    url.searchParams.set('apiSig', await signCodeforcesRequest(url.searchParams, 'user.status', credentials.apiSecret));
  }
  const result = await rateLimitedCfJson<CfApiResponse<CfSubmission[]>>(url.toString(), fetcher);
  if (result.status !== 'OK' || !Array.isArray(result.result)) throw new ApiError(result.comment || 'Codeforces returned an invalid response.', result.comment?.includes('Call limit') ? 429 : undefined, result.comment?.includes('Call limit') ? 2500 : undefined);
  return result.result;
}

export async function signCodeforcesRequest(parameters: URLSearchParams, method: string, secret: string): Promise<string> {
  const random = crypto.getRandomValues(new Uint8Array(3));
  const prefix = [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const sorted = [...parameters.entries()].sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB));
  const query = sorted.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const message = `${prefix}/${method}?${query}#${secret}`;
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(message));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}${hash}`;
}

export async function fetchCodeforcesProfile(handle: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = new URL('https://codeforces.com/api/user.info');
  url.searchParams.set('handles', handle);
  const result = await rateLimitedCfJson<CfApiResponse<Array<{ handle: string }>>>(url.toString(), fetcher);
  if (result.status !== 'OK' || !result.result[0]?.handle) throw new ApiError(result.comment || 'Codeforces handle could not be verified.', result.comment?.includes('Call limit') ? 429 : undefined, result.comment?.includes('Call limit') ? 2500 : undefined);
  return result.result[0].handle;
}
