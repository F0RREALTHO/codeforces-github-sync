import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { SyncHistoryEntry } from '../domain/types';
import { backfillDurableOwnership, backfillLegacyHistory, getDurableOwnership, getHistoryStats, getLatestAccepted, listHistoryRepositories, noteLatestAccepted, queryHistory, recordHistoryEntry, saveDurableOwnership } from './history';
import { DEFAULT_SETTINGS } from '../domain/types';

function entry(repositoryFullName: string, number: number, overrides: Partial<SyncHistoryEntry> = {}): SyncHistoryEntry {
  return {
    id: `${repositoryFullName}\u0000${number}`, repositoryFullName, problemKey: `${number % 4}-A`, problemName: `Problem ${number}`,
    contestId: number % 4, problemIndex: 'A', tags: ['dp'], programmingLanguage: number % 2 ? 'GNU C++20' : 'Python 3',
    submissionId: number, submittedAt: Date.UTC(2024, 0, number), status: 'uploaded', recordedAt: number * 1000,
    filePath: `Codeforces/${number % 4}/A.cpp`, ...overrides,
  };
}

describe('persistent sync history ledger', () => {
  it('persists metadata outcomes and deduplicates a replay of the same submission', async () => {
    const repo = 'history-persist/repo';
    await recordHistoryEntry(entry(repo, 1));
    await recordHistoryEntry(entry(repo, 1, { status: 'updated', recordedAt: 3000 }));
    await recordHistoryEntry(entry(repo, 1, { status: 'uploaded', recordedAt: 5000, reason: 'Already synchronized; no duplicate GitHub file was created.' }));
    await recordHistoryEntry(entry(repo, 2, { status: 'failed', reason: 'GitHub temporarily unavailable.', recordedAt: 4000 }));
    const page = await queryHistory({ repositoryFullName: repo, page: 1, pageSize: 10 });
    expect(page.total).toBe(2);
    expect(page.entries[0]).toMatchObject({ submissionId: 2, status: 'failed', reason: 'GitHub temporarily unavailable.' });
    expect(page.entries.find((row) => row.submissionId === 1)?.status).toBe('updated');
    expect(page.entries.some((row) => 'source' in row || 'sourceBase64' in row)).toBe(false);
  });

  it('paginates and filters by status, language, search and UTC submission date', async () => {
    const repo = 'history-pages/repo';
    for (let id = 1; id <= 23; id += 1) {
      await recordHistoryEntry(entry(repo, id, { status: id % 5 === 0 ? 'failed' : id % 3 === 0 ? 'skipped' : 'uploaded', recordedAt: id * 1000 }));
    }
    const first = await queryHistory({ repositoryFullName: repo, page: 1, pageSize: 10 });
    const second = await queryHistory({ repositoryFullName: repo, page: 2, pageSize: 10 });
    const third = await queryHistory({ repositoryFullName: repo, page: 3, pageSize: 10 });
    expect([first.entries.length, second.entries.length, third.entries.length]).toEqual([10, 10, 3]);
    expect(new Set([...first.entries, ...second.entries, ...third.entries].map((row) => row.id)).size).toBe(23);
    const failed = await queryHistory({ repositoryFullName: repo, status: 'failed', pageSize: 10 });
    expect(failed.total).toBe(4);
    const language = await queryHistory({ repositoryFullName: repo, language: 'Python 3', search: 'Problem 2', pageSize: 10 });
    expect(language.entries.every((row) => row.programmingLanguage === 'Python 3' && row.problemName.includes('Problem 2'))).toBe(true);
    const dated = await queryHistory({ repositoryFullName: repo, fromDate: '2024-01-10', toDate: '2024-01-12', pageSize: 10 });
    expect(dated.entries.map((row) => row.submissionId)).toEqual([12, 11, 10]);
  });

  it('tracks latest accepted IDs monotonically per repository and reports aggregate outcomes', async () => {
    const repo = 'history-stats/repo';
    expect(await noteLatestAccepted(repo, '1-A', 10)).toBe(10);
    expect(await noteLatestAccepted(repo, '1-A', 8)).toBe(10);
    expect(await getLatestAccepted(repo, '1-A')).toBe(10);
    await recordHistoryEntry(entry(repo, 1, { problemKey: '1-A', status: 'uploaded' }));
    await recordHistoryEntry(entry(repo, 2, { problemKey: '2-A', status: 'updated', recordedAt: 4000 }));
    await recordHistoryEntry(entry(repo, 3, { problemKey: '3-A', status: 'skipped' }));
    await recordHistoryEntry(entry(repo, 4, { problemKey: '4-A', status: 'failed' }));
    const stats = await getHistoryStats(repo);
    expect(stats).toMatchObject({ uploadedProblems: 2, updatedProblems: 1, skippedProblems: 1, failedOperations: 1, latestSuccessfulAt: 4000 });
    expect(await listHistoryRepositories()).toContain(repo);
    expect((await queryHistory({ status: 'all', pageSize: 10 })).total).toBeGreaterThanOrEqual(29);
  });

  it('backfills v0.1 manifests idempotently and replaces placeholders on re-import', async () => {
    const repo = 'history-legacy/repo';
    const sync = { ...DEFAULT_SETTINGS.sync, synced: { '123-A': { submissionId: 9001, path: 'Codeforces/123/A.cpp', sha: 'abc' } } };
    await backfillLegacyHistory(repo, sync, 5000);
    await backfillLegacyHistory(repo, sync, 6000);
    const migrated = await queryHistory({ repositoryFullName: repo, pageSize: 10 });
    expect(migrated.total).toBe(1);
    expect(migrated.entries[0]).toMatchObject({ legacy: true, submissionId: 9001, programmingLanguage: 'Unknown (v0.1 manifest)', recordedAt: 5000 });
    expect((await queryHistory({ repositoryFullName: repo, fromDate: '2024-01-01' })).total).toBe(0);
    await recordHistoryEntry(entry(repo, 9001, { legacy: undefined, problemKey: '123-A', submittedAt: Date.UTC(2024, 0, 2), problemName: 'Re-imported exact metadata' }));
    const refreshed = await queryHistory({ repositoryFullName: repo, fromDate: '2024-01-02' });
    expect(refreshed.entries[0]).toMatchObject({ legacy: undefined, problemName: 'Re-imported exact metadata', programmingLanguage: 'GNU C++20' });
  });

  it('keeps SHA-verified ownership durable and scoped by repository and Codeforces account', async () => {
    const repo = 'ownership-recovery/repo';
    const sync = { ...DEFAULT_SETTINGS.sync, synced: {
      '123-A': { submissionId: 20, path: 'Codeforces/123/A.cpp', sha: 'recorded-sha', metadataPath: 'Codeforces/123/A.cpp.metadata.json', metadataSha: 'metadata-sha' },
      '123-B': { submissionId: 21, path: 'Codeforces/123/B.cpp' },
    } };
    await backfillDurableOwnership(repo, 'alice', sync);
    await saveDurableOwnership(repo, 'alice', '123-A', { submissionId: 10, path: 'old.cpp', sha: 'older-sha' });
    expect(await getDurableOwnership(repo, 'alice')).toEqual({
      '123-A': { submissionId: 20, path: 'Codeforces/123/A.cpp', sha: 'recorded-sha', metadataPath: 'Codeforces/123/A.cpp.metadata.json', metadataSha: 'metadata-sha' },
    });
    expect(await getDurableOwnership(repo, 'bob')).toEqual({});
    expect(await getDurableOwnership('other/repo', 'alice')).toEqual({});
    await expect(saveDurableOwnership(repo, 'alice', '123-C', { submissionId: 22, path: 'Codeforces/123/C.cpp' })).rejects.toThrow('without a GitHub SHA');
  });
});
