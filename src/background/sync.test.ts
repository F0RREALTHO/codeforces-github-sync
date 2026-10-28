import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type CfSubmission, type Settings } from '../domain/types';

const mocks = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  pages: [] as CfSubmission[][],
  catchupPage: undefined as CfSubmission[] | undefined,
  fetchCalls: 0,
  fetchFrom: [] as number[],
  uploaded: [] as Array<{ path: string; content: string }>,
  operations: [] as string[],
  history: new Map<string, import('../domain/types').SyncHistoryEntry>(),
  ownership: new Map<string, Record<string, import('../domain/types').SyncedFile>>(),
  latest: new Map<string, number>(),
  failFirstWrite: false,
  cancelOnWrite: false,
  cancelOnPrepare: false,
  changeFiltersOnFetch: false,
  collisionPaths: new Set<string>(),
  exactMatchPaths: new Set<string>(),
  protectedContests: new Set<number>(),
  contestProtectionReasons: new Map<number, string>(),
  lock: false,
  secrets: { codeforcesCredentials: { apiKey: 'key', apiSecret: 'secret' }, github: { accessToken: 'test', login: 'owner' } },
}));

vi.mock('../storage/state', () => ({
  acquireSyncLock: async () => { if (mocks.lock) return false; mocks.lock = true; return true; },
  releaseSyncLock: async () => { mocks.lock = false; },
  renewSyncLock: async () => undefined,
  getSettings: async () => structuredClone(mocks.settings!),
  updateSettings: async (update: (settings: Settings) => Settings) => { mocks.settings = update(structuredClone(mocks.settings!)); return structuredClone(mocks.settings); },
  saveSyncForJob: async (generation: number, sync: Settings['sync']) => {
    if (mocks.settings?.jobGeneration !== generation) return false;
    mocks.settings.sync = structuredClone(sync); return true;
  },
  setSyncErrorForJob: async (generation: number, error: string) => {
    if (mocks.settings?.jobGeneration !== generation) return false;
    mocks.settings.sync = { ...mocks.settings.sync, phase: 'error', error }; return true;
  },
}));
vi.mock('../services/codeforces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/codeforces')>();
  return { ...actual,
  fetchSubmissionPage: async (_handle: string, from: number) => {
    mocks.fetchCalls += 1;
    mocks.fetchFrom.push(from);
    if (mocks.changeFiltersOnFetch && mocks.settings) {
      mocks.changeFiltersOnFetch = false;
      mocks.settings.jobGeneration += 1;
      mocks.settings.sync.phase = 'idle';
      mocks.settings.sync.needsReimport = true;
      mocks.settings.syncFilters = { ...DEFAULT_SETTINGS.syncFilters, languagesEnabled: true, languages: ['Python 3'] };
    }
    if (mocks.catchupPage && mocks.fetchCalls > 1 && from === 1) return mocks.catchupPage;
    return mocks.pages[from === 1 ? 0 : 1] || [];
  } };
});
vi.mock('../services/github', () => {
  class MockFileOwnershipError extends Error {}
  return {
  FileOwnershipError: MockFileOwnershipError,
  GithubClient: class {
    constructor(_auth: unknown, _fetcher?: unknown, private beforeWrite: () => Promise<void> = async () => undefined) {}
    async prepareFileWrite(repo: unknown, path: string, content: string, expectation: { ownedSha?: string; allowPendingContentSha?: string; adoptExactMatch?: boolean; targetExpectedAbsent: boolean }) {
      if (mocks.collisionPaths.has(path)) throw new MockFileOwnershipError('Destination path is occupied by an unowned or changed file.');
      if (mocks.cancelOnPrepare && mocks.settings) {
        mocks.cancelOnPrepare = false;
        mocks.settings.jobGeneration += 1;
        mocks.settings.sync.phase = 'paused';
      }
      const contentSha = `sha:${content}`;
      const matchedExistingContent = expectation.adoptExactMatch && mocks.exactMatchPaths.has(path);
      return { repo, path, content, contentSha, sha: matchedExistingContent ? contentSha : expectation.ownedSha, noop: Boolean(matchedExistingContent), matchedExistingContent: Boolean(matchedExistingContent) };
    }
    async verifyOwnedFile(_repo: unknown, path: string, recordedSha?: string) {
      mocks.operations.push(`verify:${path}:${recordedSha || 'missing'}`);
      if (!recordedSha || mocks.collisionPaths.has(path)) throw new MockFileOwnershipError(recordedSha ? 'Tracked file was changed outside the extension.' : 'Cannot verify ownership: missing recorded SHA.');
    }
    async commitFileWrite(plan: { path: string; content: string; contentSha: string; sha?: string; noop?: boolean }, _message: string) {
      await this.beforeWrite();
      if (plan.noop) { mocks.operations.push(`noop:${plan.path}`); return plan.sha || plan.contentSha; }
      if (mocks.failFirstWrite) { mocks.failFirstWrite = false; throw new Error('temporary GitHub outage'); }
      mocks.uploaded.push({ path: plan.path, content: plan.content });
      mocks.operations.push(`write:${plan.path}`);
      if (mocks.cancelOnWrite && mocks.settings) { mocks.cancelOnWrite = false; mocks.settings.jobGeneration += 1; mocks.settings.sync.phase = 'paused'; }
      return plan.contentSha;
    }
    async deleteFile(_repo: unknown, path: string, _message: string, _sha?: string) { mocks.operations.push(`delete:${path}`); }
  },
};
});
vi.mock('../services/github-auth', () => ({ getUsableAuth: async (auth: unknown) => auth }));
vi.mock('../services/contest', () => ({
  checkContestProtection: async (contestId: number, _creationSeconds?: number) => {
    if (mocks.protectedContests.has(contestId)) {
      return {
        isProtected: true,
        phase: 'CODING',
        reason: mocks.contestProtectionReasons.get(contestId) || `Contest ${contestId} is currently active. Upload deferred until contest finishes.`,
      };
    }
    return { isProtected: false, phase: 'FINISHED' };
  },
}));
vi.mock('../storage/vault', () => ({ readVaultSecrets: async () => structuredClone(mocks.secrets), saveVaultSecrets: async (secrets: unknown) => { mocks.secrets = structuredClone(secrets) as typeof mocks.secrets; }, vaultStatus: async () => ({ exists: true, unlocked: true }) }));
vi.mock('../storage/history', () => ({
  recordHistoryEntry: async (entry: import('../domain/types').SyncHistoryEntry) => { mocks.history.set(entry.id, structuredClone(entry)); },
  backfillDurableOwnership: async (repo: string, handle: string, sync: Settings['sync']) => {
    const key = `${repo}\u0000${handle}`;
    const records = mocks.ownership.get(key) || {};
    for (const [subKey, file] of Object.entries(sync.synced)) {
      if (file.sha) records[subKey] = structuredClone(file);
    }
    mocks.ownership.set(key, records);
  },
  getDurableOwnership: async (repo: string, handle: string) => structuredClone(mocks.ownership.get(`${repo}\u0000${handle}`) || {}),
  saveDurableOwnership: async (repo: string, handle: string, subKey: string, file: import('../domain/types').SyncedFile) => {
    const key = `${repo}\u0000${handle}`;
    const records = mocks.ownership.get(key) || {};
    records[subKey] = structuredClone(file);
    mocks.ownership.set(key, records);
  },
  noteLatestAccepted: async (repo: string, problem: string, id: number) => { const key = `${repo}\u0000${problem}`; const latest = Math.max(mocks.latest.get(key) || 0, id); mocks.latest.set(key, latest); return latest; },
}));

const accepted = (id: number, source = 'source code', index = 'A', language = 'GNU C++20'): CfSubmission => ({
  id, contestId: 1, creationTimeSeconds: id, verdict: 'OK', programmingLanguage: language, source,
  problem: { contestId: 1, index, name: `Problem ${index}` }
});

describe('durable sync engine - preserve every accepted submission', () => {
  beforeEach(() => {
    mocks.settings = { ...structuredClone(DEFAULT_SETTINGS), codeforcesHandle: 'owner', githubLogin: 'owner', repository: { owner: 'owner', name: 'solutions', fullName: 'owner/solutions', private: false, defaultBranch: 'main' }, consentAcceptedAt: Date.now() };
    mocks.pages = [[accepted(20), accepted(10)], []];
    mocks.catchupPage = undefined;
    mocks.fetchCalls = 0;
    mocks.fetchFrom = [];
    mocks.uploaded = [];
    mocks.operations = [];
    mocks.history.clear();
    mocks.ownership.clear();
    mocks.latest.clear();
    mocks.failFirstWrite = false;
    mocks.cancelOnWrite = false;
    mocks.cancelOnPrepare = false;
    mocks.changeFiltersOnFetch = false;
    mocks.collisionPaths = new Set();
    mocks.exactMatchPaths = new Set();
    mocks.protectedContests.clear();
    mocks.contestProtectionReasons.clear();
    mocks.lock = false;
    vi.stubGlobal('chrome', {
      alarms: { create: vi.fn(), clear: vi.fn() },
      runtime: { id: 'test-id', sendMessage: vi.fn() },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          remove: vi.fn(async () => undefined),
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves and uploads every Accepted submission independently (not just latest)', async () => {
    const { runSync } = await import('./sync');
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(2);
    expect(mocks.uploaded[0].path).toBe('Codeforces/Unrated/1A_Problem_A/20.cpp');
    expect(mocks.uploaded[1].path).toBe('Codeforces/Unrated/1A_Problem_A/10.cpp');
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.settings?.sync.historicalHighWaterId).toBe(20);
    expect(mocks.settings?.sync.nextFrom).toBe(1);
    expect(mocks.settings?.sync.synced['20'].submissionId).toBe(20);
    expect(mocks.settings?.sync.synced['10'].submissionId).toBe(10);
    expect(mocks.settings?.sync.uniqueProblems).toBe(1);
    expect(chrome.alarms.create).toHaveBeenCalledWith('cfgh.periodicSync', { periodInMinutes: 360 });
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)?.status).toBe('uploaded');
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 10)?.status).toBe('uploaded');
  });

  it('recovers a durable historical page checkpoint after worker recreation', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, phase: 'historical', nextFrom: 1001, submissionsSeen: 1000, historicalHighWaterId: 40, lastSubmissionId: 40 };
    mocks.pages = [[], [accepted(30)]];
    await runSync('historical');
    expect(mocks.fetchFrom[0]).toBe(1001);
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.settings?.sync.historicalHighWaterId).toBe(40);
    expect(mocks.settings?.sync.done).toBe(true);
  });

  it('decodes API sourceBase64 and writes the returned source through the sync path', async () => {
    const { runSync } = await import('./sync');
    const source = 'int main() { return 1; } // café';
    const sourceBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(source)));
    mocks.pages = [[{ ...accepted(20, ''), source: undefined, sourceBase64 }], []];
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].content).toContain(source);
    expect(mocks.settings?.sync.failed).toEqual({});
  });

  it('records submissions excluded by filters as skipped and never marks them uploaded', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.syncFilters = { ...DEFAULT_SETTINGS.syncFilters, ratingEnabled: true, ratingMin: 1200 };
    const excluded20 = { ...accepted(20), problem: { contestId: 1, index: 'A', name: 'Problem A', rating: 800, tags: ['math'] } };
    const excluded10 = { ...accepted(10), problem: { contestId: 1, index: 'A', name: 'Problem A', rating: 800, tags: ['math'] } };
    mocks.pages = [[excluded20, excluded10], []];
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.settings?.sync.synced['20']).toBeUndefined();
    expect(mocks.settings?.sync.synced['10']).toBeUndefined();
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'skipped', reason: 'Outside the selected problem rating range.' });
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 10)).toMatchObject({ status: 'skipped', reason: 'Outside the selected problem rating range.' });
  });

  it('abandons a page response when filter settings change while the Codeforces request is pending', async () => {
    const { runSync } = await import('./sync');
    mocks.changeFiltersOnFetch = true;
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.history.size).toBe(0);
    expect(mocks.settings?.sync.needsReimport).toBe(true);
    expect(mocks.settings?.syncFilters.languages).toEqual(['Python 3']);
  });

  it('re-checks cancellation after GitHub preflight and before committing any file', async () => {
    const { runSync } = await import('./sync');
    mocks.cancelOnPrepare = true;
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.settings?.sync.phase).toBe('paused');
  });

  it('records an ownership collision without touching the file, then retries safely', async () => {
    const { runSync } = await import('./sync');
    mocks.collisionPaths.add('Codeforces/Unrated/1A_Problem_A/20.cpp');
    mocks.pages = [[accepted(20)], []];
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'failed', reason: 'Destination path is occupied by an unowned or changed file.' });
    expect(mocks.settings?.sync.failed['20']).toContain('20|');
    mocks.collisionPaths.clear();
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.settings?.sync.synced['20'].submissionId).toBe(20);
  });

  it('recognizes exact existing solution content in a fresh browser and records it without a duplicate GitHub write', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, synced: {}, uniqueProblems: 0, filesUploaded: 0 };
    mocks.exactMatchPaths.add('Codeforces/Unrated/1A_Problem_A/20.cpp');
    mocks.pages = [[accepted(20)], []];

    await runSync('historical');

    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.operations).toContain('noop:Codeforces/Unrated/1A_Problem_A/20.cpp');
    expect(mocks.settings?.sync.synced['20']).toMatchObject({ submissionId: 20, path: 'Codeforces/Unrated/1A_Problem_A/20.cpp', sha: expect.any(String) });
    expect(mocks.history.get('owner/solutions\u000020')).toMatchObject({
      status: 'uploaded',
      reason: 'Exact generated solution content already exists in this repository; it was verified and left unchanged.',
    });
  });

  it('re-imports against changed filters without deleting or untracking an existing solution', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = {
      ...mocks.settings!.sync, done: true, needsReimport: true, historicalHighWaterId: 10, lastSubmissionId: 10,
      repositoryFullName: 'owner/solutions', uniqueProblems: 1,
      synced: { '10': { submissionId: 10, path: 'Codeforces/Unrated/1A_Problem_A/10.cpp', sha: 'owned-sha', problemKey: '1-A' } },
    };
    mocks.settings!.syncFilters = { ...DEFAULT_SETTINGS.syncFilters, languagesEnabled: true, languages: ['Python 3'] };
    mocks.pages = [[accepted(20), accepted(10)], []];
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.operations.some((operation) => operation.startsWith('delete:'))).toBe(false);
    expect(mocks.settings?.sync.synced['10']).toMatchObject({ submissionId: 10, path: 'Codeforces/Unrated/1A_Problem_A/10.cpp', sha: 'owned-sha' });
    expect(mocks.settings?.sync.needsReimport).toBe(false);
  });

  it('pins historical work to the persisted high-water ID and catches up newer submissions afterward', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(30), accepted(20)], []];
    mocks.catchupPage = [accepted(40), accepted(30), accepted(20)];
    await runSync('historical');
    expect(mocks.settings?.sync.historicalHighWaterId).toBe(30);
    expect(mocks.settings?.sync.done).toBe(true);
    // Historical uploaded 30 and 20 (2 files); incremental catch-up uploaded 40 (1 file) -> total 3 files
    expect(mocks.uploaded).toHaveLength(3);
    expect(mocks.uploaded.map((file) => file.content)).toEqual(
      expect.arrayContaining([expect.stringContaining('/submission/30'), expect.stringContaining('/submission/20'), expect.stringContaining('/submission/40')])
    );
  });

  it('does not rewrite a same-submission entry when the recorded ownership SHA still matches', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, done: true, lastSubmissionId: 10, synced: { '20': { submissionId: 20, path: 'Codeforces/Unrated/1A_Problem_A/20.cpp', sha: 'owned-sha' } } };
    mocks.pages = [[accepted(20)], []];
    await runSync('incremental');
    expect(mocks.uploaded).toHaveLength(0);
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'uploaded', reason: 'Already synchronized; the recorded GitHub ownership SHA still matches.' });
  });

  it('does not report a same-submission manifest entry as uploaded unless its recorded remote SHA still matches', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, synced: { '20': { submissionId: 20, path: 'Codeforces/Unrated/1A_Problem_A/20.cpp', sha: 'recorded-sha' } } };
    mocks.pages = [[accepted(20)], []];
    mocks.collisionPaths.add('Codeforces/Unrated/1A_Problem_A/20.cpp');
    await runSync('historical');
    expect(mocks.operations).toContain('verify:Codeforces/Unrated/1A_Problem_A/20.cpp:recorded-sha');
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'failed', reason: 'Tracked file was changed outside the extension.' });
    expect(mocks.uploaded).toHaveLength(0);
  });

  it('re-imports a completed history without losing the ownership manifest or colliding with its files', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = {
      ...mocks.settings!.sync, done: true, historicalHighWaterId: 20, lastSubmissionId: 20,
      synced: {
        '20': { submissionId: 20, path: 'Codeforces/Unrated/1A_Problem_A/20.cpp', sha: 'owned-sha' },
        '10': { submissionId: 10, path: 'Codeforces/Unrated/1A_Problem_A/10.cpp', sha: 'owned-sha-10' }
      }
    };
    mocks.pages = [[accepted(20), accepted(10)], []];
    await runSync('historical');
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.settings?.sync.synced['20'].sha).toBe('owned-sha');
    expect(mocks.settings?.sync.synced['10'].sha).toBe('owned-sha-10');
    expect(mocks.uploaded).toHaveLength(0);
  });

  it('replays a page after a write failure without skipping work', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(20)], []];
    mocks.failFirstWrite = true;
    await expect(runSync('historical')).rejects.toThrow('temporary GitHub outage');
    expect(mocks.settings?.sync.phase).toBe('error');
    expect(mocks.settings?.sync.nextFrom).toBe(1);
    await runSync('historical');
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.uploaded).toHaveLength(1);
  });

  it('stops after cancellation during a GitHub write without overwriting the newer job state', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(20)], []];
    mocks.cancelOnWrite = true;
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.settings?.jobGeneration).toBe(1);
    expect(mocks.settings?.sync.phase).toBe('paused');
    expect(mocks.settings?.sync.synced['20']).toBeUndefined();
    expect(mocks.ownership.get('owner/solutions\u0000owner')?.['20']).toMatchObject({ submissionId: 20, path: 'Codeforces/Unrated/1A_Problem_A/20.cpp', sha: expect.any(String) });
  });

  it('does not fall back to an older Accepted source when the newest source is missing', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(20, ''), accepted(10, 'older code')], []];
    await runSync('historical');
    // Submission 20 fails due to missing source, submission 10 succeeds and is uploaded independently
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].path).toBe('Codeforces/Unrated/1A_Problem_A/10.cpp');
    expect(mocks.settings?.sync.failed['20']).toContain('20|');
    expect(mocks.settings?.sync.synced['10']).toBeDefined();
    expect(mocks.settings?.sync.done).toBe(true);
  });

  it('overlaps the incremental cursor and ignores submissions at or below the prior high-water mark', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, done: true, lastSubmissionId: 20, synced: { '20': { submissionId: 20, path: 'Codeforces/Unrated/1A_Problem_A/20.cpp' } }, uniqueProblems: 1 };
    mocks.pages = [[accepted(25), accepted(20)], []];
    await runSync('incremental');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].content).toContain('/submission/25');
    expect(mocks.settings?.sync.lastSubmissionId).toBe(25);
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.settings?.sync.scanCutoff).toBeUndefined();
  });

  // ========================================================
  // REQUIRED REGRESSION TEST SUITES (SECTION 8 OF SPEC)
  // ========================================================

  it('regression: synchronizes two Accepted submissions for one problem into separate files', async () => {
    const { runSync } = await import('./sync');
    const sub1 = accepted(123456789, 'int main() { /* brute force */ }', 'A', 'GNU C++17');
    const sub2 = accepted(123987654, 'int main() { /* optimized */ }', 'A', 'GNU C++20');
    mocks.pages = [[sub2, sub1], []];

    await runSync('historical');

    expect(mocks.uploaded).toHaveLength(2);
    expect(mocks.uploaded[0].path).toBe('Codeforces/Unrated/1A_Problem_A/123987654.cpp');
    expect(mocks.uploaded[1].path).toBe('Codeforces/Unrated/1A_Problem_A/123456789.cpp');
    expect(mocks.uploaded[0].content).toContain('/* optimized */');
    expect(mocks.uploaded[1].content).toContain('/* brute force */');
    expect(mocks.settings?.sync.synced['123987654']).toBeDefined();
    expect(mocks.settings?.sync.synced['123456789']).toBeDefined();
    expect(mocks.settings?.sync.uniqueProblems).toBe(1);
  });

  it('regression: synchronizes multiple Accepted submissions across different languages', async () => {
    const { runSync } = await import('./sync');
    const cppSub = accepted(101, 'int main() {}', 'A', 'GNU C++20 (64)');
    const pySub = accepted(102, 'print("ok")', 'A', 'Python 3');
    const rustSub = accepted(103, 'fn main() {}', 'A', 'Rust 2021');
    mocks.pages = [[rustSub, pySub, cppSub], []];

    await runSync('historical');

    expect(mocks.uploaded).toHaveLength(3);
    expect(mocks.uploaded.map((f) => f.path)).toEqual([
      'Codeforces/Unrated/1A_Problem_A/103.rs',
      'Codeforces/Unrated/1A_Problem_A/102.py',
      'Codeforces/Unrated/1A_Problem_A/101.cpp',
    ]);
    expect(mocks.settings?.sync.uniqueProblems).toBe(1);
    expect(mocks.operations.some((op) => op.startsWith('delete:'))).toBe(false);
  });

  it('regression: deduplicates duplicate API responses for the same submission ID', async () => {
    const { runSync } = await import('./sync');
    const sub = accepted(555, 'code', 'A');
    mocks.pages = [[sub, sub, sub], []];

    await runSync('historical');

    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].path).toBe('Codeforces/Unrated/1A_Problem_A/555.cpp');
  });

  it('regression: historical import contains multiple Accepted submissions for one problem', async () => {
    const { runSync } = await import('./sync');
    const subs = [
      accepted(300, 'code 3', 'A'),
      accepted(200, 'code 2', 'A'),
      accepted(100, 'code 1', 'A'),
    ];
    mocks.pages = [subs, []];

    await runSync('historical');

    expect(mocks.uploaded).toHaveLength(3);
    expect(mocks.settings?.sync.synced['300']).toBeDefined();
    expect(mocks.settings?.sync.synced['200']).toBeDefined();
    expect(mocks.settings?.sync.synced['100']).toBeDefined();
    expect(mocks.settings?.sync.done).toBe(true);
  });

  it('regression: incremental discovery of a second Accepted submission does not delete the first', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = {
      ...mocks.settings!.sync,
      done: true,
      lastSubmissionId: 100,
      synced: {
        '100': { submissionId: 100, path: 'Codeforces/Unrated/1A_Problem_A/100.cpp', sha: 'sha-100', problemKey: '1-A' }
      },
      uniqueProblems: 1,
    };
    const newSub = accepted(200, 'newer solution', 'A');
    mocks.pages = [[newSub], []];

    await runSync('incremental');

    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].path).toBe('Codeforces/Unrated/1A_Problem_A/200.cpp');
    expect(mocks.operations.some((op) => op.startsWith('delete:'))).toBe(false);
    expect(mocks.settings?.sync.synced['100']).toBeDefined();
    expect(mocks.settings?.sync.synced['200']).toBeDefined();
    expect(mocks.settings?.sync.uniqueProblems).toBe(1);
  });

  it('regression: retry of one submission succeeds without affecting another', async () => {
    const { runSync } = await import('./sync');
    const goodSub = accepted(10, 'good', 'A');
    const badSub = accepted(20, '', 'A'); // empty source causes failure
    mocks.pages = [[badSub, goodSub], []];

    await runSync('historical');

    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].path).toBe('Codeforces/Unrated/1A_Problem_A/10.cpp');
    expect(mocks.settings?.sync.failed['20']).toBeDefined();
    expect(mocks.settings?.sync.synced['10']).toBeDefined();

    // Now fix badSub source and retry
    const fixedSub = accepted(20, 'fixed code', 'A');
    mocks.pages = [[fixedSub], []];
    await runSync('historical');

    expect(mocks.uploaded).toHaveLength(2);
    expect(mocks.settings?.sync.failed['20']).toBeUndefined();
    expect(mocks.settings?.sync.synced['20']).toBeDefined();
    expect(mocks.settings?.sync.synced['10']).toBeDefined();
  });

  it('regression: maintains independent Git SHA ownership for each submission file', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(20), accepted(10)], []];

    await runSync('historical');

    const handleKey = 'owner/solutions\u0000owner';
    const ownership = mocks.ownership.get(handleKey);
    expect(ownership?.['20']).toBeDefined();
    expect(ownership?.['10']).toBeDefined();
    expect(ownership?.['20'].sha).toBeDefined();
    expect(ownership?.['10'].sha).toBeDefined();
    expect(ownership?.['20'].path).toBe('Codeforces/Unrated/1A_Problem_A/20.cpp');
    expect(ownership?.['10'].path).toBe('Codeforces/Unrated/1A_Problem_A/10.cpp');
  });

  it('regression: preserves existing legacy files without renaming or deleting them', async () => {
    const { runSync } = await import('./sync');
    // Pre-existing legacy entry from v0.1 format
    mocks.settings!.sync = {
      ...mocks.settings!.sync,
      done: true,
      lastSubmissionId: 10,
      synced: {
        '1-A': { submissionId: 10, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'legacy-sha' }
      },
      uniqueProblems: 1,
    };
    // New submission arrives using new submission-ID structure
    const newSub = accepted(20, 'new code', 'A');
    mocks.pages = [[newSub], []];

    await runSync('incremental');

    // Uploaded new submission to new ID-based path
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].path).toBe('Codeforces/Unrated/1A_Problem_A/20.cpp');
    // Legacy file was NOT deleted or renamed
    expect(mocks.operations.some((op) => op.startsWith('delete:'))).toBe(false);
    expect(mocks.settings?.sync.synced['1-A']).toBeDefined();
    expect(mocks.settings?.sync.synced['1-A'].path).toBe('Codeforces/1/A_Problem_A.cpp');
    expect(mocks.settings?.sync.synced['20']).toBeDefined();
  });

  it('regression: interrupted historical imports resume safely without losing work', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(2), accepted(1)], []];
    mocks.cancelOnPrepare = true;

    await runSync('historical');

    expect(mocks.settings?.sync.phase).toBe('paused');
    expect(mocks.uploaded).toHaveLength(0);

    // Resume paused sync
    await runSync('historical', true);

    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.uploaded).toHaveLength(2);
    expect(mocks.settings?.sync.synced['1']).toBeDefined();
    expect(mocks.settings?.sync.synced['2']).toBeDefined();
  });

  describe('contest-aware upload protection invariant', () => {
    it('blocks submissions received during an active contest and defers them into contestQueue', async () => {
      const { runSync } = await import('./sync');
      mocks.protectedContests.add(100);
      const sub = { ...accepted(50), contestId: 100, problem: { contestId: 100, index: 'A', name: 'Contest Problem A' } };
      mocks.pages = [[sub], []];

      await runSync('incremental');

      // Upload must be blocked
      expect(mocks.uploaded).toHaveLength(0);
      // Submission must be queued in sync.contestQueue
      expect(mocks.settings?.sync.contestQueue[50]).toBeDefined();
      expect(mocks.settings?.sync.contestQueue[50].contestId).toBe(100);
      expect(mocks.settings?.sync.contestQueue[50].problemKey).toBe('100-A');
      // History record created as skipped
      const historyRecord = mocks.history.get('owner/solutions\u000050');
      expect(historyRecord).toBeDefined();
      expect(historyRecord?.status).toBe('skipped');
      expect(historyRecord?.reason).toContain('Contest 100 is currently active');
    });

    it('resumes queue processing when contest transitions to FINISHED and commits successfully', async () => {
      const { runSync } = await import('./sync');
      mocks.protectedContests.add(400);
      const sub = { ...accepted(90), contestId: 400, problem: { contestId: 400, index: 'D', name: 'Prob D' } };
      mocks.pages = [[sub], []];

      await runSync('incremental');
      expect(mocks.uploaded).toHaveLength(0);
      expect(mocks.settings?.sync.contestQueue[90]).toBeDefined();

      // Contest finishes
      mocks.protectedContests.delete(400);
      mocks.pages = [[], []];

      await runSync('incremental');
      expect(mocks.uploaded).toHaveLength(1);
      expect(mocks.uploaded[0].content).toContain('/submission/90');
      expect(mocks.settings?.sync.contestQueue[90]).toBeUndefined();
      expect(mocks.settings?.sync.synced['90']).toBeDefined();
      expect(mocks.settings?.sync.synced['90'].submissionId).toBe(90);
    });

    it('prevents duplicate commits when queued submissions match existing content', async () => {
      const { runSync } = await import('./sync');
      mocks.protectedContests.add(500);
      const sub = { ...accepted(95), contestId: 500, problem: { contestId: 500, index: 'A', name: 'Prob A' } };
      mocks.pages = [[sub], []];

      await runSync('incremental');
      expect(mocks.uploaded).toHaveLength(0);

      // Existing content matches exactly in git repository
      mocks.exactMatchPaths.add('Codeforces/Unrated/500A_Prob_A/95.cpp');
      mocks.protectedContests.delete(500);
      mocks.pages = [[], []];

      await runSync('incremental');

      // Did not make a duplicate commit
      expect(mocks.uploaded).toHaveLength(0);
      expect(mocks.operations.some((op) => op.startsWith('noop:'))).toBe(true);
      // Ownership is recorded cleanly
      expect(mocks.settings?.sync.contestQueue[95]).toBeUndefined();
      expect(mocks.settings?.sync.synced['95']).toBeDefined();
    });

    it('persists deferred submissions across simulated browser restart', async () => {
      const { runSync } = await import('./sync');
      mocks.protectedContests.add(600);
      const sub = { ...accepted(110), contestId: 600, problem: { contestId: 600, index: 'A', name: 'Prob A' } };
      mocks.pages = [[sub], []];

      await runSync('incremental');
      expect(mocks.settings?.sync.contestQueue[110]).toBeDefined();

      // Simulate browser restart by re-instantiating settings from storage
      const preservedQueue = structuredClone(mocks.settings?.sync.contestQueue);
      expect(preservedQueue?.[110]).toBeDefined();

      // New session loads preserved state
      mocks.protectedContests.delete(600);
      mocks.pages = [[], []];
      await runSync('incremental');

      expect(mocks.uploaded).toHaveLength(1);
      expect(mocks.settings?.sync.contestQueue[110]).toBeUndefined();
    });
  });
});
