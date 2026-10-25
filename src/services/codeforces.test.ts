import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSubmissionPage, requestJson, signCodeforcesRequest, submissionSource } from './codeforces';

afterEach(() => vi.unstubAllGlobals());

describe('Codeforces API client', () => {
  it('requests source-inclusive user.status pages with stable pagination', async () => {
    const now = Date.now();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({ 'cfgh.codeforcesLastCall': now })), set: vi.fn(async () => undefined) } } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/user.status');
      expect(url.searchParams.get('handle')).toBe('tourist');
      expect(url.searchParams.get('from')).toBe('1001');
      expect(url.searchParams.get('count')).toBe('1000');
      expect(url.searchParams.get('includeSources')).toBe('true');
      expect(url.searchParams.get('apiKey')).toBe('public-key');
      expect(url.searchParams.get('apiSig')).toMatch(/^[a-f0-9]{134}$/);
      expect(url.searchParams.toString()).not.toContain('private-secret');
      return new Response(JSON.stringify({ status: 'OK', result: [{ id: 42, source: 'print(1)' }] }), { status: 200 });
    });
    const page = await fetchSubmissionPage('tourist', 1001, 1000, { apiKey: 'public-key', apiSecret: 'private-secret' }, true, fetcher as typeof fetch);
    expect(page).toHaveLength(1);
    expect(page[0].source).toBe('print(1)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('signs requests with a 6-character nonce and a SHA-512 signature', async () => {
    const params = new URLSearchParams({ apiKey: 'key', handle: 'my_handle', time: '123' });
    const sig = await signCodeforcesRequest(params, 'user.status', 'private-secret');
    expect(sig).toMatch(/^[a-f0-9]{134}$/);
    expect([...params.keys()]).not.toContain('apiSig');
    expect(sig).not.toContain('private-secret');
  });
  it('surfaces Codeforces API failures instead of treating them as empty pages', async () => {
    const now = Date.now();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({ 'cfgh.codeforcesLastCall': now })), set: vi.fn(async () => undefined) } } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'FAILED', comment: 'Call limit exceeded' }), { status: 200 }));
    await expect(fetchSubmissionPage('tourist', 1, 10, { apiKey: 'key', apiSecret: 'secret' }, true, fetcher as typeof fetch)).rejects.toThrow('Call limit exceeded');
  });
  it('decodes Codeforces sourceBase64 as UTF-8 and prefers plain source fields', () => {
    const encodedUtf8 = btoa(String.fromCharCode(...new TextEncoder().encode('int main() { return 1; } // café')));
    expect(submissionSource({ id: 1, creationTimeSeconds: 1, programmingLanguage: 'C++', problem: { index: 'A', name: 'A' }, sourceBase64: encodedUtf8 })).toBe('int main() { return 1; } // café');
    expect(submissionSource({ id: 2, creationTimeSeconds: 1, programmingLanguage: 'C++', problem: { index: 'A', name: 'A' }, source: 'plain', sourceBase64: encodedUtf8 })).toBe('plain');
    expect(submissionSource({ id: 3, creationTimeSeconds: 1, programmingLanguage: 'C++', problem: { index: 'A', name: 'A' }, sourceBase64: '%%%invalid%%%' })).toBeUndefined();
    expect(submissionSource({ id: 4, creationTimeSeconds: 1, programmingLanguage: 'C++', problem: { index: 'A', name: 'A' }, sourceBase64: btoa('') })).toBeUndefined();
  });
  it('distinguishes an empty but valid history from rejected API credentials', async () => {
    const now = Date.now();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({ 'cfgh.codeforcesLastCall': now })), set: vi.fn(async () => undefined) } } });
    const validEmpty = vi.fn(async () => new Response(JSON.stringify({ status: 'OK', result: [] }), { status: 200 }));
    await expect(fetchSubmissionPage('some-handle', 1, 1, { apiKey: 'key', apiSecret: 'secret' }, true, validEmpty as typeof fetch)).resolves.toEqual([]);
    const rejected = vi.fn(async () => new Response(JSON.stringify({ status: 'FAILED', comment: 'Invalid API key' }), { status: 200 }));
    await expect(fetchSubmissionPage('some-handle', 1, 1, { apiKey: 'wrong', apiSecret: 'wrong' }, true, rejected as typeof fetch)).rejects.toThrow('Invalid API key');
  });
  it('rejects an unknown handle instead of presenting it as connected', async () => {
    const now = Date.now();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({ 'cfgh.codeforcesLastCall': now })), set: vi.fn(async () => undefined) } } });
    const notFound = vi.fn(async () => new Response(JSON.stringify({ status: 'FAILED', comment: 'handle not found' }), { status: 200 }));
    const { fetchCodeforcesProfile } = await import('./codeforces');
    await expect(fetchCodeforcesProfile('not-a-real-user', notFound as typeof fetch)).rejects.toThrow('handle not found');
  });
  it('converts HTTP failures into safe, actionable errors', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }));
    await expect(requestJson('https://codeforces.com/api/test', undefined, fetcher as typeof fetch)).rejects.toThrow('HTTP 503');
  });
  it('surfaces network failures without converting them into an empty history', async () => {
    const now = Date.now();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({ 'cfgh.codeforcesLastCall': now })), set: vi.fn(async () => undefined) } } });
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    await expect(fetchSubmissionPage('tourist', 1, 10, { apiKey: 'key', apiSecret: 'secret' }, true, fetcher as typeof fetch)).rejects.toThrow('Network connection failed');
  });
});
