import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSyncJob, getSettings, saveSyncFilters, saveSyncForJob, updateSettings } from './state';

function installStorage() {
  const data = new Map<string, unknown>();
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: data.get(key) })),
    set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value)); }),
    remove: vi.fn(async (key: string) => { data.delete(key); }),
  } } });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('serialized sync state updates', () => {
  it('migrates a v0.1 settings record with all selective filters disabled', async () => {
    const data = installStorage();
    data.set('cfgh.settings.v1', { autoSync: false, syncMinutes: 360, jobGeneration: 2, sync: { phase: 'idle', nextFrom: 1, submissionsSeen: 0, acceptedSeen: 0, uniqueProblems: 4, filesUploaded: 4, lastSubmissionId: 10, done: true, failed: {}, synced: {}, retiredFiles: {} } });
    const migrated = await getSettings();
    expect(migrated.syncFilters).toMatchObject({ dateEnabled: false, ratingEnabled: false, tagsEnabled: false, languagesEnabled: false, contestsEnabled: false });
    expect(migrated.sync.uniqueProblems).toBe(4);
  });

  it('merges sync progress into the latest settings instead of restoring a stale snapshot', async () => {
    installStorage();
    await updateSettings((settings) => ({ ...settings, codeforcesHandle: 'new-handle' }));
    const progress = await getSettings();
    progress.sync.submissionsSeen = 10;
    await updateSettings((settings) => ({ ...settings, githubLogin: 'new-login' }));
    expect(await saveSyncForJob(0, progress.sync)).toBe(true);
    expect(await getSettings()).toMatchObject({ codeforcesHandle: 'new-handle', githubLogin: 'new-login', sync: { submissionsSeen: 10 } });
  });

  it('rejects stale job checkpoints and durably advances cancellation generation', async () => {
    installStorage();
    const cancelled = await cancelSyncJob('paused');
    expect(cancelled.jobGeneration).toBe(1);
    expect(cancelled.sync.phase).toBe('idle');
    expect(await saveSyncForJob(0, { ...cancelled.sync, phase: 'historical' })).toBe(false);
    expect((await getSettings()).sync.phase).toBe('idle');
  });

  it('clears repository-specific paths and checkpoints when a repository switch is committed', async () => {
    installStorage();
    await updateSettings((settings) => ({ ...settings, repository: { owner: 'old', name: 'repo', fullName: 'old/repo', private: false, defaultBranch: 'main' }, sync: { ...settings.sync, done: true, nextFrom: 1001, historicalHighWaterId: 500, repositoryFullName: 'old/repo', synced: { '1-A': { submissionId: 2, path: 'Codeforces/1/A.cpp', sha: 'old' } } } }));
    await cancelSyncJob('idle', true);
    const reset = await updateSettings((settings) => ({ ...settings, repository: { owner: 'new', name: 'repo', fullName: 'new/repo', private: true, defaultBranch: 'main' } }));
    expect(reset.sync).toMatchObject({ nextFrom: 1, done: false, synced: {} });
    expect(reset.sync.repositoryFullName).toBeUndefined();
    expect(reset.jobGeneration).toBe(1);
  });

  it('surfaces storage failures instead of reporting a durable checkpoint', async () => {
    installStorage();
    chrome.storage.local.set = vi.fn(async () => { throw new Error('quota exceeded'); });
    await expect(updateSettings((settings) => ({ ...settings, codeforcesHandle: 'alice' }))).rejects.toThrow('quota exceeded');
  });

  it('cancels an active scan and marks a repository-preserving re-import for saved filter changes', async () => {
    installStorage();
    await updateSettings((settings) => ({
      ...settings,
      repository: { owner: 'alice', name: 'solutions', fullName: 'alice/solutions', private: true, defaultBranch: 'main' },
      sync: { ...settings.sync, phase: 'historical', nextFrom: 2001, submissionsSeen: 2000, historicalHighWaterId: 9000, repositoryFullName: 'alice/solutions', synced: { '1-A': { submissionId: 20, path: 'Codeforces/1/A.cpp', sha: 'owned-sha' } } },
    }));
    const updated = await saveSyncFilters({ ...getFilterDefaults(), languagesEnabled: true, languages: ['Python 3'] });
    expect(updated.jobGeneration).toBe(1);
    expect(updated.sync).toMatchObject({ phase: 'idle', needsReimport: true, nextFrom: 1, historicalHighWaterId: undefined, repositoryFullName: 'alice/solutions', synced: { '1-A': { sha: 'owned-sha' } } });
    expect(updated.syncFilters).toMatchObject({ languagesEnabled: true, languages: ['Python 3'] });
  });

  it('does not require a historical re-import when filters are configured before the first scan', async () => {
    installStorage();
    const updated = await saveSyncFilters({ ...getFilterDefaults(), ratingEnabled: true, ratingMin: 1000 });
    expect(updated.sync.needsReimport).toBeUndefined();
    expect(updated.sync.nextFrom).toBe(1);
  });
});

function getFilterDefaults() { return { dateEnabled: false, ratingEnabled: false, tagsEnabled: false, tags: [], languagesEnabled: false, languages: [], contestsEnabled: false, contests: [] }; }
