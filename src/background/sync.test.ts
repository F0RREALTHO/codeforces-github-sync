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
    async prepareFileWrite(repo: unknown, path: string, content: string, expectation: { ownedSha?: string; allowPendingContentSha?: string; targetExpectedAbsent: boolean }) {
      if (mocks.collisionPaths.has(path)) throw new MockFileOwnershipError('Destination path is occupied by an unowned or changed file.');
      if (mocks.cancelOnPrepare && mocks.settings) {
        mocks.cancelOnPrepare = false;
        mocks.settings.jobGeneration += 1;
        mocks.settings.sync.phase = 'paused';
      }
      const contentSha = `sha:${content}`;
      return { repo, path, content, contentSha, sha: expectation.ownedSha, noop: expectation.allowPendingContentSha === contentSha };
    }
    async verifyOwnedFile(_repo: unknown, path: string, recordedSha?: string) {
      mocks.operations.push(`verify:${path}:${recordedSha || 'missing'}`);
      if (!recordedSha || mocks.collisionPaths.has(path)) throw new MockFileOwnershipError(recordedSha ? 'Tracked file was changed outside the extension.' : 'Cannot verify ownership: missing recorded SHA.');
    }
    async commitFileWrite(plan: { path: string; content: string; contentSha: string }, _message: string) {
      await this.beforeWrite();
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
vi.mock('../storage/vault', () => ({ readVaultSecrets: async () => structuredClone(mocks.secrets), saveVaultSecrets: async (secrets: unknown) => { mocks.secrets = structuredClone(secrets) as typeof mocks.secrets; }, vaultStatus: async () => ({ exists: true, unlocked: true }) }));
vi.mock('../storage/history', () => ({
  recordHistoryEntry: async (entry: import('../domain/types').SyncHistoryEntry) => { mocks.history.set(entry.id, structuredClone(entry)); },
  backfillDurableOwnership: async (repo: string, handle: string, sync: Settings['sync']) => {
    const key = `${repo}\u0000${handle}`;
    const records = mocks.ownership.get(key) || {};
    for (const [problem, file] of Object.entries(sync.synced)) if (file.sha && (!records[problem] || records[problem].submissionId <= file.submissionId)) records[problem] = structuredClone(file);
    mocks.ownership.set(key, records);
  },
  getDurableOwnership: async (repo: string, handle: string) => structuredClone(mocks.ownership.get(`${repo}\u0000${handle}`) || {}),
  saveDurableOwnership: async (repo: string, handle: string, problem: string, file: import('../domain/types').SyncedFile) => {
    const key = `${repo}\u0000${handle}`; const records = mocks.ownership.get(key) || {}; if (!records[problem] || records[problem].submissionId <= file.submissionId) records[problem] = structuredClone(file); mocks.ownership.set(key, records);
  },
  noteLatestAccepted: async (repo: string, problem: string, id: number) => { const key = `${repo}\u0000${problem}`; const latest = Math.max(mocks.latest.get(key) || 0, id); mocks.latest.set(key, latest); return latest; },
}));

const accepted = (id: number, source = 'source code', index = 'A'): CfSubmission => ({ id, contestId: 1, creationTimeSeconds: id, verdict: 'OK', programmingLanguage: 'GNU C++20', source, problem: { contestId: 1, index, name: `Problem ${index}` } });

describe('durable sync engine', () => {
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
    mocks.lock = false;
    vi.stubGlobal('chrome', { alarms: { create: vi.fn(), clear: vi.fn() } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('imports only the newest Accepted solution and records a completed checkpoint', async () => {
    const { runSync } = await import('./sync');
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].content).toContain('Submission: https://codeforces.com/contest/1/submission/20');
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.settings?.sync.historicalHighWaterId).toBe(20);
    expect(mocks.settings?.sync.nextFrom).toBe(1);
    expect(mocks.settings?.sync.synced['1-A'].submissionId).toBe(20);
    expect(chrome.alarms.create).toHaveBeenCalledWith('cfgh.periodicSync', { periodInMinutes: 360 });
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)?.status).toBe('uploaded');
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 10)).toMatchObject({ status: 'skipped', reason: 'Superseded by newer Accepted submission 20.' });
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
    const excluded = { ...accepted(20), problem: { contestId: 1, index: 'A', name: 'Problem A', rating: 800, tags: ['math'] } };
    mocks.pages = [[excluded, accepted(10, 'older code')], []];
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.settings?.sync.synced['1-A']).toBeUndefined();
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'skipped', reason: 'Outside the selected problem rating range.' });
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 10)?.reason).toContain('Superseded by newer Accepted submission 20');
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
    mocks.collisionPaths.add('Codeforces/1/A_Problem_A.cpp');
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'failed', reason: 'Destination path is occupied by an unowned or changed file.' });
    expect(mocks.settings?.sync.failed['1-A']).toContain('20|');
    mocks.collisionPaths.clear();
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.settings?.sync.synced['1-A'].submissionId).toBe(20);
  });

  it('applies filters during incremental catch-up and advances the submission cursor for skipped entries', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, done: true, lastSubmissionId: 10, synced: {}, uniqueProblems: 0 };
    mocks.settings!.syncFilters = { ...DEFAULT_SETTINGS.syncFilters, languagesEnabled: true, languages: ['Python 3'] };
    const rejectedByFilter = { ...accepted(20), programmingLanguage: 'GNU C++20' };
    mocks.pages = [[rejectedByFilter, accepted(10)], []];
    await runSync('incremental');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.settings?.sync.lastSubmissionId).toBe(20);
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'skipped', reason: 'Programming language is not selected.' });
  });

  it('re-imports against changed filters without deleting or untracking an existing solution', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = {
      ...mocks.settings!.sync, done: true, needsReimport: true, historicalHighWaterId: 10, lastSubmissionId: 10,
      repositoryFullName: 'owner/solutions', uniqueProblems: 1,
      synced: { '1-A': { submissionId: 10, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'owned-sha' } },
    };
    mocks.settings!.syncFilters = { ...DEFAULT_SETTINGS.syncFilters, languagesEnabled: true, languages: ['Python 3'] };
    mocks.pages = [[accepted(20), accepted(10)], []];
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.operations.some((operation) => operation.startsWith('delete:'))).toBe(false);
    expect(mocks.settings?.sync.synced['1-A']).toMatchObject({ submissionId: 10, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'owned-sha' });
    expect(mocks.settings?.sync.needsReimport).toBe(false);
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'skipped', reason: 'Programming language is not selected. Existing synchronized file was retained.' });
  });

  it('pins historical work to the persisted high-water ID and catches up newer submissions afterward', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(30), accepted(20)], []];
    mocks.catchupPage = [accepted(40), accepted(30), accepted(20)];
    await runSync('historical');
    // Historical imports the 30 snapshot, then its follow-up incremental pass sees 40.
    expect(mocks.settings?.sync.historicalHighWaterId).toBe(30);
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.uploaded).toHaveLength(2);
    expect(mocks.uploaded.map((file) => file.content)).toEqual(expect.arrayContaining([expect.stringContaining('/submission/30'), expect.stringContaining('/submission/40')]));
  });

  it('does not rewrite a same-submission entry when the recorded ownership SHA still matches', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, done: true, lastSubmissionId: 10, synced: { '1-A': { submissionId: 20, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'owned-sha' } } };
    mocks.pages = [[accepted(20), accepted(10)], []];
    await runSync('incremental');
    expect(mocks.uploaded).toHaveLength(0);
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'uploaded', reason: 'Already synchronized; the recorded GitHub ownership SHA still matches.' });
  });

  it('does not report a same-submission manifest entry as uploaded unless its recorded remote SHA still matches', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, synced: { '1-A': { submissionId: 20, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'recorded-sha' } } };
    mocks.pages = [[accepted(20)], []];
    mocks.collisionPaths.add('Codeforces/1/A_Problem_A.cpp');
    await runSync('historical');
    expect(mocks.operations).toContain('verify:Codeforces/1/A_Problem_A.cpp:recorded-sha');
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'failed', reason: 'Tracked file was changed outside the extension.' });
    expect(mocks.uploaded).toHaveLength(0);
  });

  it('restores a disconnected repository ownership manifest before replaying history', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, synced: {}, uniqueProblems: 0, filesUploaded: 0 };
    mocks.ownership.set('owner/solutions\u0000owner', { '1-A': { submissionId: 20, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'previously-recorded-sha' } });
    mocks.pages = [[accepted(20)], []];
    await runSync('historical');
    expect(mocks.operations).toContain('verify:Codeforces/1/A_Problem_A.cpp:previously-recorded-sha');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.history.get('owner/solutions\u000020')).toMatchObject({ status: 'uploaded', reason: 'Already synchronized; the recorded GitHub ownership SHA still matches.' });
  });

  it('does not treat a v0.1 same-submission record without a durable SHA as verified ownership', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, synced: { '1-A': { submissionId: 20, path: 'Codeforces/1/A_Problem_A.cpp' } } };
    mocks.pages = [[accepted(20)], []];
    await runSync('historical');
    expect([...mocks.history.values()].find((entry) => entry.submissionId === 20)).toMatchObject({ status: 'failed', reason: 'Cannot verify ownership: missing recorded SHA.' });
    expect(mocks.uploaded).toHaveLength(0);
  });

  it('re-imports a completed history without losing the ownership manifest or colliding with its files', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, done: true, historicalHighWaterId: 20, lastSubmissionId: 20, synced: { '1-A': { submissionId: 20, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'owned-sha' } } };
    mocks.pages = [[accepted(20), accepted(10)], []];
    await runSync('historical');
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.settings?.sync.synced['1-A'].sha).toBe('owned-sha');
    expect(mocks.uploaded).toHaveLength(0);
  });

  it('replays a page after a write failure without skipping work', async () => {
    const { runSync } = await import('./sync');
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
    mocks.cancelOnWrite = true;
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.settings?.jobGeneration).toBe(1);
    expect(mocks.settings?.sync.phase).toBe('paused');
    expect(mocks.settings?.sync.synced['1-A']).toBeUndefined();
    expect(mocks.ownership.get('owner/solutions\u0000owner')?.['1-A']).toMatchObject({ submissionId: 20, path: 'Codeforces/1/A_Problem_A.cpp', sha: expect.any(String) });
  });

  it('uploads the replacement before deleting the previously tracked extension path', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = {
      ...mocks.settings!.sync,
      synced: { '1-A': { submissionId: 10, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'old-sha', metadataPath: 'Codeforces/1/A_Problem_A.cpp.metadata.json', metadataSha: 'old-meta-sha' } },
    };
    mocks.pages = [[{ ...accepted(20), programmingLanguage: 'Python 3' }], []];
    await runSync('historical');
    const writeIndex = mocks.operations.findIndex((entry) => entry.startsWith('write:Codeforces/1/A_Problem_A.py'));
    const deleteIndex = mocks.operations.findIndex((entry) => entry === 'delete:Codeforces/1/A_Problem_A.cpp');
    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(writeIndex);
    expect(mocks.settings?.sync.synced['1-A'].path).toMatch(/\.py$/);
  });

  it('keeps the previous working file when replacement upload fails', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = {
      ...mocks.settings!.sync,
      synced: { '1-A': { submissionId: 10, path: 'Codeforces/1/A_Problem_A.cpp', sha: 'old-sha' } },
    };
    mocks.pages = [[{ ...accepted(20), programmingLanguage: 'Python 3' }], []];
    mocks.failFirstWrite = true;
    await expect(runSync('historical')).rejects.toThrow('temporary GitHub outage');
    expect(mocks.operations.some((entry) => entry.startsWith('delete:'))).toBe(false);
    expect(mocks.settings?.sync.synced['1-A'].path).toBe('Codeforces/1/A_Problem_A.cpp');
  });

  it('does not fall back to an older Accepted source when the newest source is missing', async () => {
    const { runSync } = await import('./sync');
    mocks.pages = [[accepted(20, ''), accepted(10, 'older code')], []];
    await runSync('historical');
    expect(mocks.uploaded).toHaveLength(0);
    expect(mocks.settings?.sync.failed['1-A']).toContain('20|');
    expect(mocks.settings?.sync.done).toBe(true);
  });

  it('overlaps the incremental cursor and ignores submissions at or below the prior high-water mark', async () => {
    const { runSync } = await import('./sync');
    mocks.settings!.sync = { ...mocks.settings!.sync, done: true, lastSubmissionId: 20, synced: { '1-A': { submissionId: 20, path: 'Codeforces/1/A_Problem_A.cpp' } }, uniqueProblems: 1 };
    mocks.pages = [[accepted(25), accepted(20)], []];
    await runSync('incremental');
    expect(mocks.uploaded).toHaveLength(1);
    expect(mocks.uploaded[0].content).toContain('/submission/25');
    expect(mocks.settings?.sync.lastSubmissionId).toBe(25);
    expect(mocks.settings?.sync.done).toBe(true);
    expect(mocks.settings?.sync.scanCutoff).toBeUndefined();
  });
});
