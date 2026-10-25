import { describe, expect, it } from 'vitest';
import { filterReason, markFilterChange, normalizeSyncFilters } from './filters';
import { DEFAULT_SYNC, DEFAULT_SYNC_FILTERS, type CfSubmission } from './types';

const submission: CfSubmission = {
  id: 7, contestId: 1613, creationTimeSeconds: Date.UTC(2022, 0, 15) / 1000,
  verdict: 'OK', programmingLanguage: 'GNU C++20',
  problem: { contestId: 1613, index: 'B', name: 'Problem B', rating: 1200, tags: ['dp', 'graphs'] },
};

describe('selective sync filters', () => {
  it('leaves all v0.1 behavior eligible by default', () => {
    expect(filterReason(submission, DEFAULT_SYNC_FILTERS)).toBeUndefined();
  });
  it('applies every enabled filter as an intersection and tags as any-of', () => {
    const filters = normalizeSyncFilters({
      ...DEFAULT_SYNC_FILTERS, dateEnabled: true, dateFrom: '2022-01-15', dateTo: '2022-01-15',
      ratingEnabled: true, ratingMin: 1000, ratingMax: 1400, tagsEnabled: true, tags: ['graphs'],
      languagesEnabled: true, languages: ['GNU C++20'], contestsEnabled: true, contests: [1613],
    });
    expect(filterReason(submission, filters)).toBeUndefined();
    expect(filterReason({ ...submission, programmingLanguage: 'Python 3' }, filters)).toBe('Programming language is not selected.');
    expect(filterReason({ ...submission, problem: { ...submission.problem, tags: ['math'] } }, filters)).toBe('Does not match any selected Codeforces tag.');
    expect(filterReason({ ...submission, problem: { ...submission.problem, rating: undefined } }, filters)).toBe('Outside the selected problem rating range.');
    expect(filterReason({ ...submission, problem: { ...submission.problem, contestId: 1000 } }, filters)).toBe('Contest is not selected.');
    expect(filterReason({ ...submission, creationTimeSeconds: Date.UTC(2022, 0, 16) / 1000 }, filters)).toBe('Outside the selected submission date range.');
  });
  it('rejects enabled filters with empty or impossible ranges', () => {
    expect(() => normalizeSyncFilters({ ...DEFAULT_SYNC_FILTERS, tagsEnabled: true, tags: [] })).toThrow('Choose at least one Codeforces tag.');
    expect(() => normalizeSyncFilters({ ...DEFAULT_SYNC_FILTERS, dateEnabled: true })).toThrow('Set a start date or end date');
    expect(() => normalizeSyncFilters({ ...DEFAULT_SYNC_FILTERS, ratingEnabled: true, ratingMin: 1600, ratingMax: 800 })).toThrow('Minimum rating cannot exceed maximum');
  });
  it('normalizes duplicate and invalid contest inputs', () => {
    const filters = normalizeSyncFilters({ ...DEFAULT_SYNC_FILTERS, contestsEnabled: true, contests: [1, 1, -2, Number.MAX_SAFE_INTEGER + 1] });
    expect(filters.contests).toEqual([1]);
  });
  it('invalidates an in-progress checkpoint for a new filter snapshot but preserves ownership', () => {
    const sync = { ...DEFAULT_SYNC, phase: 'historical' as const, nextFrom: 2001, submissionsSeen: 2000, historicalHighWaterId: 5000, repositoryFullName: 'owner/repo', synced: { '1-A': { submissionId: 12, path: 'Codeforces/1/A.cpp', sha: 'owned' } } };
    expect(markFilterChange(sync)).toMatchObject({ phase: 'idle', needsReimport: true, nextFrom: 1, historicalHighWaterId: undefined, synced: sync.synced, repositoryFullName: 'owner/repo' });
    expect(markFilterChange({ ...DEFAULT_SYNC, phase: 'historical' }, true).needsReimport).toBe(true);
    expect(markFilterChange(DEFAULT_SYNC).needsReimport).toBeUndefined();
  });
});
