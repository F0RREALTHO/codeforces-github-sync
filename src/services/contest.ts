import { browserApi } from '../platform/browser';
import { rateLimitedCfJson, type CfApiResponse } from './codeforces';

export type ContestPhase = 'BEFORE' | 'CODING' | 'PENDING_SYSTEM_TEST' | 'SYSTEM_TEST' | 'FINISHED';

export interface CfContest {
  id: number;
  name: string;
  type?: string;
  phase: ContestPhase;
  frozen?: boolean;
  durationSeconds?: number;
  startTimeSeconds?: number;
  relativeTimeSeconds?: number;
}

export interface ContestCheckResult {
  isProtected: boolean;
  phase?: ContestPhase | 'UNKNOWN_OR_UNAVAILABLE';
  contest?: CfContest;
  reason?: string;
}

const CONTEST_CACHE_KEY = 'cfgh.contestCache.v1';
const CACHE_TTL_ACTIVE_MS = 2 * 60 * 1000; // 2 minutes for active contests
const CACHE_TTL_FINISHED_MS = 24 * 60 * 60 * 1000; // 24 hours for confirmed finished contests

interface CachedContestRecord {
  contest: CfContest;
  cachedAt: number;
}

interface ContestCacheStore {
  updatedAt: number;
  contests: Record<number, CachedContestRecord>;
}

let inMemoryContestCache: ContestCacheStore | null = null;

export function isContestPhaseActive(phase: string | undefined): boolean {
  if (!phase) return true; // unknown is treated as active/ambiguous
  return phase === 'BEFORE' || phase === 'CODING' || phase === 'PENDING_SYSTEM_TEST' || phase === 'SYSTEM_TEST';
}

/** Fetch public contest list from Codeforces API. */
export async function fetchContestList(gym = false, fetcher: typeof fetch = fetch): Promise<CfContest[]> {
  const url = new URL('https://codeforces.com/api/contest.list');
  if (gym) url.searchParams.set('gym', 'true');
  const response = await rateLimitedCfJson<CfApiResponse<CfContest[]>>(url.toString(), fetcher);
  if (response.status !== 'OK' || !Array.isArray(response.result)) {
    throw new Error(response.comment || 'Codeforces contest API returned an invalid response.');
  }
  return response.result;
}

/** Read cached contest map from storage. */
async function getStoredContestCache(): Promise<ContestCacheStore> {
  if (inMemoryContestCache) return inMemoryContestCache;
  try {
    const raw = (await browserApi().storage.local.get(CONTEST_CACHE_KEY))[CONTEST_CACHE_KEY] as ContestCacheStore | undefined;
    if (raw && typeof raw.contests === 'object') {
      inMemoryContestCache = raw;
      return raw;
    }
  } catch {
    // If storage is unavailable or corrupt, start fresh
  }
  inMemoryContestCache = { updatedAt: 0, contests: {} };
  return inMemoryContestCache;
}

/** Save updated contest cache into local storage. */
async function saveStoredContestCache(store: ContestCacheStore): Promise<void> {
  inMemoryContestCache = store;
  try {
    await browserApi().storage.local.set({ [CONTEST_CACHE_KEY]: store });
  } catch {
    // Non-fatal if storage write fails
  }
}

/** Refresh contest list and update cache. */
export async function refreshContestCache(fetcher: typeof fetch = fetch): Promise<ContestCacheStore> {
  const now = Date.now();
  const store = await getStoredContestCache();
  try {
    const list = await fetchContestList(false, fetcher);
    for (const contest of list) {
      store.contests[contest.id] = { contest, cachedAt: now };
    }
    store.updatedAt = now;
    await saveStoredContestCache(store);
  } catch (error) {
    // If regular contest fetch fails, rethrow so callers know API was unreachable
    throw error;
  }
  return store;
}

/** Check if a submission belonging to contestId is currently protected from uploading. */
export async function checkContestProtection(
  contestId: number | undefined,
  submissionCreationSeconds?: number,
  fetcher: typeof fetch = fetch
): Promise<ContestCheckResult> {
  if (!contestId || contestId <= 0) {
    return { isProtected: false };
  }

  const now = Date.now();
  const store = await getStoredContestCache();
  let cached = store.contests[contestId];

  // Determine if cache needs refreshing
  const cacheAge = cached ? now - cached.cachedAt : Infinity;
  const isExpired = !cached || (isContestPhaseActive(cached.contest.phase) ? cacheAge > CACHE_TTL_ACTIVE_MS : cacheAge > CACHE_TTL_FINISHED_MS);

  if (isExpired) {
    try {
      const updatedStore = await refreshContestCache(fetcher);
      cached = updatedStore.contests[contestId];
    } catch {
      // API call failed: fallback to conservative handling
      if (cached && cached.contest.phase === 'FINISHED') {
        // Previously positively confirmed FINISHED
        return { isProtected: false, phase: 'FINISHED', contest: cached.contest };
      }

      // If submission occurred in the last 48 hours or contest is not confirmed finished, block conservatively!
      const isRecent = submissionCreationSeconds ? now / 1000 - submissionCreationSeconds < 48 * 3600 : true;
      if (isRecent) {
        return {
          isProtected: true,
          phase: 'UNKNOWN_OR_UNAVAILABLE',
          reason: `Codeforces contest status for contest ${contestId} could not be verified; deferred conservatively for contest protection.`,
        };
      }
    }
  }

  if (cached) {
    if (isContestPhaseActive(cached.contest.phase)) {
      return {
        isProtected: true,
        phase: cached.contest.phase,
        contest: cached.contest,
        reason: `Contest ${cached.contest.id} (${cached.contest.name}) is currently in phase ${cached.contest.phase}. Upload deferred until contest is positively finished.`,
      };
    }
    return { isProtected: false, phase: 'FINISHED', contest: cached.contest };
  }

  // If contestId was not found in standard contest list (e.g. Gym contest):
  // If recent, defer conservatively. If very old (e.g. submitted over 30 days ago), allow.
  const isRecent = submissionCreationSeconds ? now / 1000 - submissionCreationSeconds < 48 * 3600 : true;
  if (isRecent) {
    return {
      isProtected: true,
      phase: 'UNKNOWN_OR_UNAVAILABLE',
      reason: `Contest ${contestId} status is unconfirmed; deferred conservatively for contest protection.`,
    };
  }

  return { isProtected: false, phase: 'FINISHED' };
}

/** Clear in-memory and stored contest cache (useful for tests). */
export async function clearContestCache(): Promise<void> {
  inMemoryContestCache = null;
  try {
    await browserApi().storage.local.remove(CONTEST_CACHE_KEY);
  } catch {
    // ignore
  }
}
