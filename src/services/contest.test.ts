import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkContestProtection, clearContestCache, fetchContestList, isContestPhaseActive, type CfContest } from './contest';

describe('contest service and active detection', () => {
  const store: Record<string, unknown> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-id' },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); }),
          remove: vi.fn(async (key: string) => { delete store[key]; }),
        },
      },
    });
    clearContestCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('correctly classifies contest phases as active or finished', () => {
    expect(isContestPhaseActive('BEFORE')).toBe(true);
    expect(isContestPhaseActive('CODING')).toBe(true);
    expect(isContestPhaseActive('PENDING_SYSTEM_TEST')).toBe(true);
    expect(isContestPhaseActive('SYSTEM_TEST')).toBe(true);
    expect(isContestPhaseActive('FINISHED')).toBe(false);
    expect(isContestPhaseActive(undefined)).toBe(true); // ambiguous is treated as active
  });

  it('fetches contest list from API', async () => {
    const mockContests: CfContest[] = [
      { id: 2000, name: 'Codeforces Round 999', phase: 'CODING', type: 'CF' },
      { id: 1999, name: 'Codeforces Round 998', phase: 'FINISHED', type: 'CF' },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK', result: mockContests }),
    } as unknown as Response);

    const list = await fetchContestList(false, fetcher as unknown as typeof fetch);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(2000);
  });

  it('blocks active contest submissions and permits finished contest submissions', async () => {
    const mockContests: CfContest[] = [
      { id: 2001, name: 'Active Round', phase: 'CODING', type: 'CF' },
      { id: 2002, name: 'Testing Round', phase: 'SYSTEM_TEST', type: 'CF' },
      { id: 1990, name: 'Past Round', phase: 'FINISHED', type: 'CF' },
    ];
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK', result: mockContests }),
    } as unknown as Response);

    const codingCheck = await checkContestProtection(2001, Math.floor(Date.now() / 1000) - 300, fetcher as unknown as typeof fetch);
    expect(codingCheck.isProtected).toBe(true);
    expect(codingCheck.phase).toBe('CODING');
    expect(codingCheck.reason).toContain('Active Round');

    const testingCheck = await checkContestProtection(2002, Math.floor(Date.now() / 1000) - 300, fetcher as unknown as typeof fetch);
    expect(testingCheck.isProtected).toBe(true);
    expect(testingCheck.phase).toBe('SYSTEM_TEST');

    const finishedCheck = await checkContestProtection(1990, Math.floor(Date.now() / 1000) - 100000, fetcher as unknown as typeof fetch);
    expect(finishedCheck.isProtected).toBe(false);
    expect(finishedCheck.phase).toBe('FINISHED');
  });

  it('defers conservatively when Contest API is unavailable for recent submissions', async () => {
    const failingFetcher = vi.fn().mockRejectedValue(new Error('Network offline'));

    // Recent submission (10 minutes ago)
    const recentCheck = await checkContestProtection(3001, Math.floor(Date.now() / 1000) - 600, failingFetcher as unknown as typeof fetch);
    expect(recentCheck.isProtected).toBe(true);
    expect(recentCheck.phase).toBe('UNKNOWN_OR_UNAVAILABLE');
    expect(recentCheck.reason).toContain('deferred conservatively');

    // Ancient submission (> 48 hours ago)
    const ancientCheck = await checkContestProtection(3001, Math.floor(Date.now() / 1000) - (50 * 3600), failingFetcher as unknown as typeof fetch);
    expect(ancientCheck.isProtected).toBe(false);
  });
});
