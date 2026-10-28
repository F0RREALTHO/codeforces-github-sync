import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncUserActivity } from './activity';
import { getCfActivityMeta, getCfActivityRecords, resetHistoryDatabaseForTests } from '../storage/history';
import type { CfSubmission } from '../domain/types';

describe('Codeforces user activity sync service', () => {
  beforeEach(() => {
    resetHistoryDatabaseForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetHistoryDatabaseForTests();
  });

  it('paginates submission history, persists activity records, and marks history complete', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });

    const page1: CfSubmission[] = [
      {
        id: 1002,
        contestId: 100,
        creationTimeSeconds: 1700000000,
        verdict: 'OK',
        programmingLanguage: 'C++',
        problem: { contestId: 100, index: 'A', name: 'Problem A' },
      },
      {
        id: 1001,
        contestId: 100,
        creationTimeSeconds: 1699900000,
        verdict: 'WRONG_ANSWER',
        programmingLanguage: 'Python 3',
        problem: { contestId: 100, index: 'B', name: 'Problem B' },
      },
    ];

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('handle')).toBe('testuser');
      expect(url.searchParams.get('includeSources')).toBeNull(); // sources are not included for speed
      return new Response(JSON.stringify({ status: 'OK', result: page1 }), { status: 200 });
    });

    const meta = await syncUserActivity('testuser', undefined, false, fetcher as typeof fetch);

    expect(meta.isComplete).toBe(true);
    expect(meta.isFetching).toBe(false);
    expect(meta.totalSubmissions).toBe(2);
    expect(meta.newestSubmissionId).toBe(1002);
    expect(meta.oldestSubmissionId).toBe(1001);

    const records = await getCfActivityRecords('testuser');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id)).toEqual(expect.arrayContaining([1001, 1002]));

    const persistedMeta = await getCfActivityMeta('testuser');
    expect(persistedMeta?.isComplete).toBe(true);
  });

  it('handles API failure conservatively and marks history as incomplete', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });

    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'FAILED', comment: 'Call limit exceeded' }), { status: 200 });
    });

    const meta = await syncUserActivity('failinguser', undefined, false, fetcher as typeof fetch);

    expect(meta.isComplete).toBe(false);
    expect(meta.isFetching).toBe(false);
    expect(meta.error).toContain('Call limit exceeded');
  });

  it('stops incremental pagination when encountering an already cached submission ID', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });

    // Seed existing activity
    const initialPage: CfSubmission[] = [
      {
        id: 2001,
        contestId: 200,
        creationTimeSeconds: 1700000000,
        verdict: 'OK',
        programmingLanguage: 'C++',
        problem: { contestId: 200, index: 'A', name: 'Problem A' },
      },
    ];

    const initialFetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'OK', result: initialPage }), { status: 200 });
    });
    await syncUserActivity('incrementaluser', undefined, false, initialFetcher as typeof fetch);

    // New incremental run with 1 new and 1 old submission
    const incrementalPage: CfSubmission[] = [
      {
        id: 2002,
        contestId: 200,
        creationTimeSeconds: 1700100000,
        verdict: 'OK',
        programmingLanguage: 'C++',
        problem: { contestId: 200, index: 'B', name: 'Problem B' },
      },
      {
        id: 2001, // Already cached!
        contestId: 200,
        creationTimeSeconds: 1700000000,
        verdict: 'OK',
        programmingLanguage: 'C++',
        problem: { contestId: 200, index: 'A', name: 'Problem A' },
      },
    ];

    const incrementalFetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'OK', result: incrementalPage }), { status: 200 });
    });

    const meta = await syncUserActivity('incrementaluser', undefined, false, incrementalFetcher as typeof fetch);
    expect(meta.isComplete).toBe(true);
    expect(meta.newestSubmissionId).toBe(2002);
    expect(incrementalFetcher).toHaveBeenCalledTimes(1);
  });
});
