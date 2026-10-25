import { browserApi } from '../platform/browser';
import { acceptedLatest, problemKey, solutionContent } from '../domain/solutions';
import { filterReason } from '../domain/filters';
import type { CfSubmission, SyncHistoryEntry, SyncState } from '../domain/types';
import { fetchSubmissionPage, submissionSource } from '../services/codeforces';
import { FileOwnershipError, GithubClient } from '../services/github';
import { getUsableAuth } from '../services/github-auth';
import { backfillDurableOwnership, getDurableOwnership, noteLatestAccepted, recordHistoryEntry, saveDurableOwnership } from '../storage/history';
import { getSettings, releaseSyncLock, renewSyncLock, saveSyncForJob, setSyncErrorForJob, acquireSyncLock, updateSettings } from '../storage/state';
import { readVaultSecrets } from '../storage/vault';
import { RECOVERY_ALARM, schedulePeriodicAlarm } from './alarms';

const PAGE_SIZE = 1000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let inProcessSync = false;

class SyncCancelled extends Error { constructor() { super('Sync was cancelled because account, repository, or vault state changed.'); this.name = 'SyncCancelled'; } }

export async function runSync(mode: 'historical' | 'incremental' = 'incremental', resumePaused = false): Promise<void> {
  if (inProcessSync) return;
  inProcessSync = true;
  let lockAcquired = false;
  let generation = -1;
  let completed = false;
  try {
    if (!await acquireSyncLock()) return;
    lockAcquired = true;
    const settings = await getSettings();
    generation = settings.jobGeneration;
    if (settings.sync.phase === 'paused' && !resumePaused) return;
    if (!settings.codeforcesHandle || !settings.githubLogin || !settings.repository) throw new Error('Connect Codeforces and GitHub, then choose a repository before syncing.');
    await backfillDurableOwnership(settings.repository.fullName, settings.codeforcesHandle, settings.sync);
    const durableOwnership = await getDurableOwnership(settings.repository.fullName, settings.codeforcesHandle);
    for (const [key, durable] of Object.entries(durableOwnership)) {
      const local = settings.sync.synced[key];
      if (!local || durable.submissionId >= local.submissionId) settings.sync.synced[key] = durable;
    }
    const secrets = await readVaultSecrets();
    if (!secrets.codeforcesCredentials || !secrets.github) throw new Error('Unlock your vault and reconnect both accounts before syncing.');
    let auth = await getUsableAuth(secrets.github);
    await assertActive(generation);
    const authProvider = async () => {
      await assertActive(generation);
      auth = await getUsableAuth(auth);
      await assertActive(generation);
      return auth;
    };
    const github = new GithubClient(auth, fetch, () => assertActive(generation), authProvider);
    let sync: SyncState = mode === 'historical' && (settings.sync.done || settings.sync.needsReimport)
      ? { ...settings.sync, phase: 'historical', nextFrom: 1, submissionsSeen: 0, acceptedSeen: 0, historicalHighWaterId: undefined, scanCutoff: undefined, done: false, needsReimport: false, failed: {}, startedAt: Date.now(), error: undefined }
      : { ...settings.sync, phase: mode, startedAt: settings.sync.startedAt || Date.now(), error: undefined };
    if (sync.repositoryFullName && sync.repositoryFullName !== settings.repository.fullName) {
      throw new Error('This sync checkpoint belongs to a different repository. Select the intended repository or reset its sync state before continuing.');
    }
    sync.repositoryFullName = settings.repository.fullName;
    if (mode === 'incremental' && sync.scanCutoff === undefined) {
      sync.scanCutoff = sync.lastSubmissionId;
      sync.nextFrom = 1;
    }
    if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
    await browserApi().alarms.create(RECOVERY_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    await assertActive(generation);
    await cleanupRetiredFiles(github, settings.repository, sync, generation);

    while ((mode === 'historical' ? !sync.done : true) && sync.phase !== 'paused') {
      await assertActive(generation);
      await renewSyncLock();
      let page: CfSubmission[] | undefined;
      let requestError: unknown;
      for (let attempt = 0; attempt < 3 && !page; attempt += 1) {
        await assertActive(generation);
        try {
          page = await fetchSubmissionPage(settings.codeforcesHandle, sync.nextFrom, PAGE_SIZE, secrets.codeforcesCredentials, true);
          await assertActive(generation);
        } catch (error) {
          if (error instanceof SyncCancelled) throw error;
          requestError = error;
          const retryable = error instanceof Error && ('status' in error ? (error as { status?: number }).status === undefined || (error as { status?: number }).status === 429 || Number((error as { status?: number }).status) >= 500 : true);
          if (!retryable || attempt === 2) break;
          const retryAfter = error instanceof Error && 'retryAfterMs' in error ? Number((error as { retryAfterMs?: number }).retryAfterMs) : 0;
          await wait(Math.max(2100, retryAfter || 2100 * (2 ** attempt)));
          await assertActive(generation);
        }
      }
      if (!page) throw requestError;
      if (mode === 'historical' && sync.historicalHighWaterId === undefined) {
        sync.historicalHighWaterId = page[0]?.id ?? 0;
        sync.lastSubmissionId = Math.max(sync.lastSubmissionId, sync.historicalHighWaterId);
        if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
      }
      if (mode === 'incremental' && sync.lastSubmissionId === 0 && page[0]) sync.lastSubmissionId = page[0].id;
      const relevant = mode === 'incremental'
        ? page.filter((item) => item.id > (sync.scanCutoff ?? 0))
        : page.filter((item) => item.id <= (sync.historicalHighWaterId ?? 0));
      const latestOnPage = acceptedLatest(relevant);
      const latestOnPageIds = new Set(latestOnPage.map((submission) => submission.id));
      const accepted = relevant.filter((submission) => submission.verdict === 'OK').sort((a, b) => b.id - a.id);
      for (const submission of accepted) {
        await assertActive(generation);
        const key = problemKey(submission.problem);
        const prior = sync.synced[key];
        const historyBase = historyEntry(settings.repository.fullName, submission, key);
        if (!latestOnPageIds.has(submission.id)) {
          const newerOnPage = latestOnPage.find((item) => problemKey(item.problem) === key);
          await recordHistoryEntry({ ...historyBase, status: 'skipped', recordedAt: Date.now(), filePath: prior?.path, reason: `Superseded by newer Accepted submission ${newerOnPage?.id ?? 'on this page'}.` });
          continue;
        }
        const latestId = await noteLatestAccepted(settings.repository.fullName, key, submission.id);
        await assertActive(generation);
        if (latestId > submission.id || (prior && prior.submissionId > submission.id)) {
          const supersedingId = Math.max(latestId, prior?.submissionId ?? 0);
          await recordHistoryEntry({ ...historyBase, status: 'skipped', recordedAt: Date.now(), filePath: prior?.path, reason: `Superseded by newer Accepted submission ${supersedingId}.` });
          continue;
        }
        const excluded = filterReason(submission, settings.syncFilters);
        if (excluded) {
          await recordHistoryEntry({ ...historyBase, status: 'skipped', recordedAt: Date.now(), filePath: prior?.path, reason: `${excluded}${prior ? ' Existing synchronized file was retained.' : ''}` });
          continue;
        }
        if (prior && prior.submissionId === submission.id) {
          try {
            await github.verifyOwnedFile(settings.repository, prior.path, prior.sha);
            await assertActive(generation);
            if (prior.metadataPath) {
              await github.verifyOwnedFile(settings.repository, prior.metadataPath, prior.metadataSha);
              await assertActive(generation);
            }
            await recordHistoryEntry({ ...historyBase, status: 'uploaded', recordedAt: Date.now(), filePath: prior.path, reason: 'Already synchronized; the recorded GitHub ownership SHA still matches.' });
          } catch (error) {
            if (error instanceof SyncCancelled) throw error;
            const reason = error instanceof Error ? error.message : 'Could not verify the tracked GitHub file.';
            sync.failed[key] = `${submission.id}|${reason}`;
            await recordHistoryEntry({ ...historyBase, status: 'failed', recordedAt: Date.now(), filePath: prior.path, reason });
            if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
            if (!(error instanceof FileOwnershipError)) throw error;
          }
          continue;
        }
        const source = submissionSource(submission);
        if (typeof source !== 'string' || source.length === 0) {
          const reason = 'Codeforces did not return source for this Accepted submission.';
          sync.failed[key] = `${submission.id}|${reason}`;
          await recordHistoryEntry({ ...historyBase, status: 'failed', recordedAt: Date.now(), filePath: prior?.path, reason });
          if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
          continue;
        }
        const currentSettings = await getSettings();
        if (currentSettings.jobGeneration !== generation) throw new SyncCancelled();
        if (currentSettings.codeforcesSourceAccess !== 'confirmed') {
          await updateSettings((current) => current.jobGeneration === generation ? { ...current, codeforcesSourceAccess: 'confirmed' } : current);
          await assertActive(generation);
        }
        const file = solutionContent(submission, source);
        const content = `${file.content}${file.content.endsWith('\n') ? '' : '\n'}`;
        const title = `Sync Codeforces ${submission.problem.contestId}${submission.problem.index}: ${submission.problem.name}`;
        const savedPending = sync.pendingWrite?.problemKey === key && sync.pendingWrite.submissionId === submission.id && sync.pendingWrite.path === file.path ? sync.pendingWrite : undefined;
        const priorSha = prior?.sha;
        const priorMetadataPath = prior?.metadataPath ?? (prior && !prior.sha ? `${prior.path}.metadata.json` : undefined);
        const priorMetadataSha = prior?.metadataSha;
        try {
          const sourcePlan = await github.prepareFileWrite(settings.repository, file.path, content, savedPending
            ? { ownedSha: savedPending.expectedSha, targetExpectedAbsent: savedPending.expectedAbsent, allowPendingContentSha: savedPending.contentSha }
            : { ownedSha: prior?.path === file.path ? priorSha : undefined, targetExpectedAbsent: prior?.path !== file.path || !priorSha, adoptExactMatch: true });
          await assertActive(generation);
          const metadataPlan = file.metadataFile
            ? await github.prepareFileWrite(settings.repository, file.metadataFile.path, file.metadataFile.content, savedPending
              ? { ownedSha: savedPending.metadataExpectedSha, targetExpectedAbsent: savedPending.metadataExpectedAbsent ?? true, allowPendingContentSha: savedPending.metadataContentSha }
              : { ownedSha: priorMetadataPath === file.metadataFile.path ? priorMetadataSha : undefined, targetExpectedAbsent: priorMetadataPath !== file.metadataFile.path || !priorMetadataSha, adoptExactMatch: true })
            : undefined;
          await assertActive(generation);
          sync.pendingWrite = {
            problemKey: key, submissionId: submission.id, path: file.path, contentSha: sourcePlan.contentSha,
            expectedSha: sourcePlan.sha, expectedAbsent: !sourcePlan.sha,
            ...(metadataPlan ? { metadataPath: file.metadataFile!.path, metadataContentSha: metadataPlan.contentSha, metadataExpectedSha: metadataPlan.sha, metadataExpectedAbsent: !metadataPlan.sha } : {}),
          };
          if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
          await assertActive(generation);
          const sourceSha = await github.commitFileWrite(sourcePlan, title);
          // Persist the confirmed source-file ownership immediately. A disconnect,
          // worker shutdown, or metadata-write failure after this point must not
          // erase the only record that proves this file belongs to the extension.
          await saveDurableOwnership(settings.repository.fullName, settings.codeforcesHandle, key, {
            submissionId: submission.id,
            path: file.path,
            sha: sourceSha,
          });
          await assertActive(generation);
          const metadataSha = metadataPlan ? await github.commitFileWrite(metadataPlan, `${title} metadata`) : undefined;
          await assertActive(generation);
          if (prior && prior.path !== file.path && priorSha) sync.retiredFiles[prior.path] = priorSha;
          if (priorMetadataPath && priorMetadataPath !== file.metadataFile?.path && priorMetadataSha) sync.retiredFiles[priorMetadataPath] = priorMetadataSha;
          sync.synced[key] = { submissionId: submission.id, path: file.path, sha: sourceSha, ...(file.metadataFile && metadataSha ? { metadataPath: file.metadataFile.path, metadataSha } : {}) };
          sync.pendingWrite = undefined;
          delete sync.failed[key];
          sync.uniqueProblems = Object.keys(sync.synced).length;
          if (!sourcePlan.matchedExistingContent) sync.filesUploaded += 1;
          sync.lastSubmissionId = Math.max(sync.lastSubmissionId, submission.id);
          await saveDurableOwnership(settings.repository.fullName, settings.codeforcesHandle, key, sync.synced[key]);
          await recordHistoryEntry({ ...historyBase, status: prior ? 'updated' : 'uploaded', recordedAt: Date.now(), filePath: file.path, ...(sourcePlan.matchedExistingContent ? { reason: 'Exact generated solution content already exists in this repository; it was verified and left unchanged.' } : {}) });
          if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
          await cleanupRetiredFiles(github, settings.repository, sync, generation);
        } catch (error) {
          if (error instanceof SyncCancelled) throw error;
          await assertActive(generation);
          const reason = error instanceof Error ? error.message : 'GitHub write failed for this solution.';
          sync.failed[key] = `${submission.id}|${reason}`;
          await recordHistoryEntry({ ...historyBase, status: 'failed', recordedAt: Date.now(), filePath: file.path, reason });
          if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
          if (!(error instanceof FileOwnershipError)) throw error;
        }
      }
      await assertActive(generation);
      sync.submissionsSeen += relevant.length;
      sync.acceptedSeen += relevant.filter((item) => item.verdict === 'OK').length;
      sync.nextFrom += page.length;
      if (mode === 'historical') {
        for (const item of relevant) sync.lastSubmissionId = Math.max(sync.lastSubmissionId, item.id);
      } else if (page[0]) sync.lastSubmissionId = Math.max(sync.lastSubmissionId, page[0].id);
      const reachedIncrementalCutoff = mode === 'incremental' && page.some((item) => item.id <= (sync.scanCutoff ?? 0));
      if (reachedIncrementalCutoff) {
        sync.nextFrom = 1;
        sync.scanCutoff = undefined;
        sync.phase = 'idle';
        sync.lastRunAt = Date.now();
        if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
        await browserApi().alarms.clear(RECOVERY_ALARM);
        completed = true;
        break;
      }
      if (page.length < PAGE_SIZE) {
        sync.lastRunAt = Date.now();
        if (mode === 'historical') sync.done = true;
        sync.phase = 'idle';
        sync.nextFrom = 1;
        sync.scanCutoff = undefined;
      }
      if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
      if (sync.phase === 'idle') {
        await browserApi().alarms.clear(RECOVERY_ALARM);
        completed = true;
        if (mode === 'incremental') break;
      }
      if (page.length === PAGE_SIZE) await wait(100);
    }
    if (sync.phase === 'paused' || sync.phase === 'idle') await browserApi().alarms.clear(RECOVERY_ALARM);
  } catch (error) {
    await browserApi().alarms.clear(RECOVERY_ALARM);
    if (!(error instanceof SyncCancelled) && generation >= 0) {
      await setSyncErrorForJob(generation, error instanceof Error ? error.message : 'Unexpected synchronization error.');
    }
    if (!(error instanceof SyncCancelled)) throw error;
  } finally {
    inProcessSync = false;
    if (lockAcquired) await releaseSyncLock();
    if (completed) await schedulePeriodicAlarm().catch(() => undefined);
  }
  if (completed && mode === 'historical') {
    const current = await getSettings();
    if (current.jobGeneration === generation && current.sync.done && current.codeforcesHandle && current.githubLogin && current.repository) {
      await runSync('incremental');
    }
  }
}

async function assertActive(generation: number): Promise<void> {
  const current = await getSettings();
  if (current.jobGeneration !== generation || current.sync.phase === 'paused') throw new SyncCancelled();
}

async function cleanupRetiredFiles(github: GithubClient, repository: NonNullable<Awaited<ReturnType<typeof getSettings>>['repository']>, sync: SyncState, generation: number): Promise<void> {
  for (const [path, sha] of Object.entries(sync.retiredFiles)) {
    await assertActive(generation);
    await github.deleteFile(repository, path, `Remove outdated Codeforces solution ${path}`, sha);
    await assertActive(generation);
    delete sync.retiredFiles[path];
    if (!await saveSyncForJob(generation, sync)) throw new SyncCancelled();
  }
}

function historyEntry(repositoryFullName: string, submission: CfSubmission, key: string): Omit<SyncHistoryEntry, 'status' | 'recordedAt'> {
  return {
    id: `${repositoryFullName}\u0000${submission.id}`,
    repositoryFullName,
    problemKey: key,
    problemName: submission.problem.name,
    contestId: submission.problem.contestId ?? submission.contestId ?? 0,
    problemIndex: submission.problem.index,
    ...(submission.problem.rating !== undefined ? { rating: submission.problem.rating } : {}),
    tags: [...(submission.problem.tags ?? [])],
    programmingLanguage: submission.programmingLanguage,
    submissionId: submission.id,
    submittedAt: submission.creationTimeSeconds * 1000,
  };
}
