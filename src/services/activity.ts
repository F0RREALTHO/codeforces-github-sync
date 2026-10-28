import { fetchSubmissionPage } from './codeforces';
import {
  getCfActivityMeta,
  saveCfActivityMeta,
  saveCfActivityRecords,
  type CfActivityMeta,
  type CfActivityRecord,
} from '../storage/history';
import type { CodeforcesCredentials } from '../domain/types';

export interface ActivitySyncProgress {
  handle: string;
  isFetching: boolean;
  isComplete: boolean;
  totalSubmissions: number;
  newestSubmissionId?: number;
  oldestSubmissionId?: number;
  error?: string;
}

let activeSyncPromise: Promise<CfActivityMeta> | null = null;
let activeSyncHandle: string | null = null;

/**
 * Fetch and synchronize the user's complete Codeforces submission activity history.
 * Paginates through user.status with includeSources: false for fast, lightweight metadata fetching.
 * Deduplicates by submission ID, handles rate limits, persists activity records independently of
 * GitHub sync status, and updates sync completeness metadata.
 */
export async function syncUserActivity(
  handle: string,
  credentials?: CodeforcesCredentials,
  force = false,
  fetcher: typeof fetch = fetch
): Promise<CfActivityMeta> {
  const normalizedHandle = handle.trim().toLowerCase();
  if (!normalizedHandle) {
    throw new Error('A valid Codeforces handle is required to sync activity history.');
  }

  // Deduplicate in-flight syncs for the same handle
  if (activeSyncPromise && activeSyncHandle === normalizedHandle) {
    return activeSyncPromise;
  }

  activeSyncHandle = normalizedHandle;
  activeSyncPromise = (async () => {
    let meta = await getCfActivityMeta(normalizedHandle);

    // If already fetching within the last 45s, avoid duplicate concurrent runs
    if (!force && meta?.isFetching && Date.now() - meta.lastFetchedAt < 45000) {
      return meta;
    }

    const previousNewestId = force ? undefined : meta?.newestSubmissionId;
    let maxSeenId = meta?.newestSubmissionId ?? 0;
    let minSeenId = meta?.oldestSubmissionId;
    let fetchedTotal = meta?.totalSubmissions ?? 0;

    // Mark as fetching
    const fetchingMeta: CfActivityMeta = {
      handle: normalizedHandle,
      isFetching: true,
      isComplete: meta?.isComplete ?? false,
      lastFetchedAt: Date.now(),
      totalSubmissions: fetchedTotal,
      oldestSubmissionId: minSeenId,
      newestSubmissionId: maxSeenId > 0 ? maxSeenId : undefined,
    };
    await saveCfActivityMeta(fetchingMeta);

    let from = 1;
    const pageSize = 1000;
    let hasMore = true;
    let encounteredKnownSubmission = false;

    try {
      while (hasMore) {
        const page = await fetchSubmissionPage(handle, from, pageSize, credentials, false, fetcher);
        if (!page || page.length === 0) {
          hasMore = false;
          break;
        }

        const records: CfActivityRecord[] = page.map((sub) => {
          const contestId = sub.problem?.contestId ?? sub.contestId ?? 0;
          const index = sub.problem?.index || '';
          const problemKey = contestId && index ? `${contestId}-${index}` : String(sub.id);
          return {
            id: sub.id,
            handle: normalizedHandle,
            submittedAt: sub.creationTimeSeconds * 1000,
            verdict: sub.verdict || 'UNKNOWN',
            problemKey,
            problemName: sub.problem?.name || '',
            contestId,
            programmingLanguage: sub.programmingLanguage || '',
          };
        });

        await saveCfActivityRecords(records);
        fetchedTotal += records.length;

        for (const rec of records) {
          maxSeenId = Math.max(maxSeenId, rec.id);
          minSeenId = minSeenId !== undefined ? Math.min(minSeenId, rec.id) : rec.id;
        }

        // If incremental update (not forced) and we encounter an already known submission ID:
        if (!force && previousNewestId !== undefined && page.some((sub) => sub.id <= previousNewestId)) {
          encounteredKnownSubmission = true;
          hasMore = false;
          break;
        }

        // If returned fewer than requested, we reached the end of history
        if (page.length < pageSize) {
          hasMore = false;
          break;
        }

        from += page.length;
      }

      const completedMeta: CfActivityMeta = {
        handle: normalizedHandle,
        isFetching: false,
        // If we reached the end of history or merged with a previously complete history, it's complete
        isComplete: encounteredKnownSubmission ? (meta?.isComplete ?? true) : true,
        lastFetchedAt: Date.now(),
        totalSubmissions: fetchedTotal,
        newestSubmissionId: maxSeenId > 0 ? maxSeenId : undefined,
        oldestSubmissionId: minSeenId,
      };
      await saveCfActivityMeta(completedMeta);
      return completedMeta;
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      const failedMeta: CfActivityMeta = {
        handle: normalizedHandle,
        isFetching: false,
        isComplete: false, // Mark incomplete on error so UI can communicate status accurately
        lastFetchedAt: Date.now(),
        totalSubmissions: fetchedTotal,
        newestSubmissionId: maxSeenId > 0 ? maxSeenId : undefined,
        oldestSubmissionId: minSeenId,
        error: errText,
      };
      await saveCfActivityMeta(failedMeta);
      return failedMeta;
    }
  })();

  try {
    return await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
    activeSyncHandle = null;
  }
}
