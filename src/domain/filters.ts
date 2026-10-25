import { DEFAULT_SYNC_FILTERS, type CfSubmission, type SyncFilters, type SyncState } from './types';

export function normalizeSyncFilters(input: Partial<SyncFilters> | undefined): SyncFilters {
  const value = { ...DEFAULT_SYNC_FILTERS, ...input };
  const list = (items: unknown, limit: number, maxLength = 100): string[] => [...new Set((Array.isArray(items) ? items : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength)).filter(Boolean))].slice(0, limit);
  const tags = list(value.tags, 100, 50);
  const languages = list(value.languages, 100, 100);
  const contests = [...new Set((Array.isArray(value.contests) ? value.contests : [])
    .filter((item): item is number => Number.isSafeInteger(item) && item > 0))].slice(0, 500);
  const dateFrom = validDate(value.dateFrom) ? value.dateFrom : undefined;
  const dateTo = validDate(value.dateTo) ? value.dateTo : undefined;
  const ratingMin = validRating(value.ratingMin) ? value.ratingMin : undefined;
  const ratingMax = validRating(value.ratingMax) ? value.ratingMax : undefined;
  if (value.dateEnabled && !dateFrom && !dateTo) throw new Error('Set a start date or end date for the date filter.');
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('The date filter start must be on or before its end.');
  if (value.ratingEnabled && ratingMin === undefined && ratingMax === undefined) throw new Error('Set a minimum or maximum rating.');
  if (ratingMin !== undefined && ratingMax !== undefined && ratingMin > ratingMax) throw new Error('Minimum rating cannot exceed maximum rating.');
  if (value.tagsEnabled && tags.length === 0) throw new Error('Choose at least one Codeforces tag.');
  if (value.languagesEnabled && languages.length === 0) throw new Error('Choose at least one programming language.');
  if (value.contestsEnabled && contests.length === 0) throw new Error('Choose at least one contest ID.');
  return {
    dateEnabled: Boolean(value.dateEnabled), dateFrom, dateTo,
    ratingEnabled: Boolean(value.ratingEnabled), ratingMin, ratingMax,
    tagsEnabled: Boolean(value.tagsEnabled), tags,
    languagesEnabled: Boolean(value.languagesEnabled), languages,
    contestsEnabled: Boolean(value.contestsEnabled), contests,
  };
}

export function filterReason(submission: CfSubmission, filters: SyncFilters): string | undefined {
  const date = new Date(submission.creationTimeSeconds * 1000).toISOString().slice(0, 10);
  if (filters.dateEnabled && ((filters.dateFrom && date < filters.dateFrom) || (filters.dateTo && date > filters.dateTo))) return 'Outside the selected submission date range.';
  if (filters.ratingEnabled) {
    const rating = submission.problem.rating;
    if (rating === undefined || (filters.ratingMin !== undefined && rating < filters.ratingMin) || (filters.ratingMax !== undefined && rating > filters.ratingMax)) return 'Outside the selected problem rating range.';
  }
  if (filters.tagsEnabled && !submission.problem.tags?.some((tag) => filters.tags.includes(tag))) return 'Does not match any selected Codeforces tag.';
  if (filters.languagesEnabled && !filters.languages.includes(submission.programmingLanguage)) return 'Programming language is not selected.';
  if (filters.contestsEnabled && !filters.contests.includes(submission.problem.contestId ?? submission.contestId ?? 0)) return 'Contest is not selected.';
  return undefined;
}

export function markFilterChange(sync: SyncState, force = false): SyncState {
  const scanned = force || sync.done || sync.submissionsSeen > 0 || sync.uniqueProblems > 0 || sync.phase === 'historical' || sync.phase === 'incremental';
  if (!scanned) return sync;
  return {
    ...sync,
    phase: 'idle',
    needsReimport: true,
    nextFrom: 1,
    submissionsSeen: 0,
    acceptedSeen: 0,
    historicalHighWaterId: undefined,
    scanCutoff: undefined,
    failed: {},
    error: undefined,
  };
}

function validDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function validRating(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5000; }
