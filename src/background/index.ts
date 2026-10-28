import { browserApi } from '../platform/browser';
import { DEFAULT_SETTINGS, type RepositoryRef, type SyncFilters, type SyncHistoryStatus } from '../domain/types';
import { normalizeSyncFilters } from '../domain/filters';
import { fetchCodeforcesProfile, fetchSubmissionPage, submissionSource } from '../services/codeforces';
import { GithubClient } from '../services/github';
import { connectGithub, getUsableAuth } from '../services/github-auth';
import { cancelSyncJob, getSettings, saveSyncFilters, updateSettings } from '../storage/state';
import { lockVault, openVault, readVaultSecrets, resetVault, updateVaultSecrets, vaultStatus } from '../storage/vault';
import { runSync } from './sync';
import { PERIODIC_ALARM, RECOVERY_ALARM, UNLOCKED_ALARM, schedulePeriodicAlarm } from './alarms';
import {
  backfillDurableOwnership,
  backfillLegacyHistory,
  getDurableOwnership,
  getHistoryStats,
  listHistoryRepositories,
  queryHistory,
  getAllAcceptedSubmissions,
  getCfActivityMeta,
  getCfActivityRecords,
  type HistoryQuery,
} from '../storage/history';
import { syncUserActivity } from '../services/activity';
import { calculateStreaks, getBrowserTimezone, type QualifyingSubmission } from '../domain/streaks';

type Command =
  | { type: 'state' }
  | { type: 'vaultUnlock'; passphrase: string }
  | { type: 'vaultLock' }
  | { type: 'vaultReset' }
  | { type: 'connectCodeforces'; handle: string; apiKey: string; apiSecret: string }
  | { type: 'connectGithub' }
  | { type: 'repositories' }
  | { type: 'createRepository'; name: string; isPrivate: boolean }
  | { type: 'selectRepository'; repository: RepositoryRef }
  | { type: 'startImport' }
  | { type: 'syncNow' }
  | { type: 'retryFailures' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'settings'; autoSync: boolean; syncMinutes: number; preferredTimezone?: string }
  | { type: 'setTimezone'; timezone: string }
  | { type: 'disconnect'; provider: 'github' | 'codeforces' }
  | { type: 'consent' }
  | { type: 'historyPage'; query: HistoryQuery }
  | { type: 'historyStats'; repositoryFullName?: string }
  | { type: 'historyRepositories' }
  | { type: 'saveFilters'; filters: Partial<SyncFilters> }
  | { type: 'acceptedSubmissions'; repositoryFullName?: string }
  | { type: 'streakSummary'; timezone?: string; definition?: 'accepted' | 'all'; refresh?: boolean }
  | { type: 'syncActivity'; force?: boolean };

async function dispatch(message: Command): Promise<unknown> {
  const settings = await getSettings();
  switch (message.type) {
    case 'state': return { ...settings, vault: await vaultStatus() };
    case 'historyRepositories': {
      const history = await listHistoryRepositories();
      return [...new Set([...history, ...(settings.repository ? [settings.repository.fullName] : [])])].sort((a, b) => a.localeCompare(b));
    }
    case 'historyPage': {
      const requested = message.query?.repositoryFullName;
      if (requested && requested !== 'all' && !(await listHistoryRepositories()).includes(requested) && settings.repository?.fullName !== requested) throw new Error('That repository has no local sync history.');
      return queryHistory({ ...message.query, repositoryFullName: requested && requested !== 'all' ? requested : undefined, search: typeof message.query?.search === 'string' ? message.query.search.slice(0, 200) : '', pageSize: Math.min(100, Math.max(10, message.query?.pageSize || 50)), status: validHistoryStatus(message.query?.status) ? message.query.status : 'all' });
    }
    case 'historyStats': {
      const requested = message.repositoryFullName;
      if (requested && requested !== 'all' && !(await listHistoryRepositories()).includes(requested) && settings.repository?.fullName !== requested) throw new Error('That repository has no local sync history.');
      const stats = await getHistoryStats(requested && requested !== 'all' ? requested : undefined);
      if (requested && requested !== 'all') return { ...stats, uploadedProblems: Math.max(stats.uploadedProblems, settings.repository?.fullName === requested ? settings.sync.uniqueProblems : 0) };
      const currentRepoStats = settings.repository ? await getHistoryStats(settings.repository.fullName) : undefined;
      const legacyManifestOnly = Math.max(0, settings.sync.uniqueProblems - (currentRepoStats?.uploadedProblems ?? 0));
      return { ...stats, uploadedProblems: stats.uploadedProblems + legacyManifestOnly };
    }
    case 'acceptedSubmissions': {
      const requested = message.repositoryFullName;
      if (settings.codeforcesHandle) {
        void getCfActivityMeta(settings.codeforcesHandle).then((meta) => {
          if (!meta || Date.now() - meta.lastFetchedAt > 30 * 60 * 1000) {
            return readVaultSecrets().then((sec) => syncUserActivity(settings.codeforcesHandle!, sec?.codeforcesCredentials)).catch(() => undefined);
          }
        });
      }
      return getAllAcceptedSubmissions(requested && requested !== 'all' ? requested : undefined, settings.codeforcesHandle);
    }
    case 'streakSummary': {
      const handle = settings.codeforcesHandle;
      const timeZone = message.timezone || settings.preferredTimezone || getBrowserTimezone();
      const definition = message.definition || 'accepted';

      if (!handle) {
        return calculateStreaks([], { timeZone, activityDefinition: definition, isCalculating: false, isHistoryComplete: true });
      }

      let meta = await getCfActivityMeta(handle);
      let cfRecords = await getCfActivityRecords(handle);

      const needsFetch = message.refresh || !meta || cfRecords.length === 0 || (Date.now() - meta.lastFetchedAt > 30 * 60 * 1000);

      if (needsFetch) {
        const secrets = await readVaultSecrets().catch(() => undefined);
        try {
          meta = await syncUserActivity(handle, secrets?.codeforcesCredentials, Boolean(message.refresh));
          cfRecords = await getCfActivityRecords(handle);
        } catch {
          // Retain whatever records are available
        }
      }

      const acceptedHistory = await getAllAcceptedSubmissions(settings.repository?.fullName, handle);

      const contestQueueItems = Object.values(settings.sync.contestQueue || {});

      // Combine and deduplicate
      const map = new Map<number, QualifyingSubmission>();
      for (const rec of cfRecords) {
        map.set(rec.id, {
          submissionId: rec.id,
          submittedAt: rec.submittedAt,
          verdict: rec.verdict,
          problemName: rec.problemName,
        });
      }
      for (const item of acceptedHistory) {
        if (!map.has(item.id) && typeof item.submittedAt === 'number' && item.submittedAt > 0) {
          map.set(item.id, {
            submissionId: item.id,
            submittedAt: item.submittedAt,
            verdict: item.verdict || 'OK',
            problemName: item.problemName,
          });
        }
      }
      for (const q of contestQueueItems) {
        if (!map.has(q.submissionId)) {
          map.set(q.submissionId, {
            submissionId: q.submissionId,
            submittedAt: q.submittedAt,
            verdict: q.verdict || 'OK',
            problemName: q.problemName,
          });
        }
      }

      const qualifying = Array.from(map.values());
      const isCalculating = Boolean(meta?.isFetching && qualifying.length === 0);
      const isHistoryComplete = meta ? meta.isComplete : false;

      return calculateStreaks(qualifying, {
        timeZone,
        activityDefinition: definition,
        isHistoryComplete,
        isCalculating,
      });
    }
    case 'syncActivity': {
      if (!settings.codeforcesHandle) throw new Error('Connect Codeforces first.');
      const secrets = await readVaultSecrets().catch(() => undefined);
      return syncUserActivity(settings.codeforcesHandle, secrets?.codeforcesCredentials, message.force);
    }
    case 'saveFilters': {
      const filters = normalizeSyncFilters(message.filters);
      if (JSON.stringify(filters) === JSON.stringify(settings.syncFilters)) return settings;
      const updated = await saveSyncFilters(filters);
      await schedulePeriodicAlarm(updated);
      return updated;
    }
    case 'vaultUnlock': {
      if (typeof message.passphrase !== 'string') throw new Error('Enter your vault password.');
      await openVault(message.passphrase);
      const fresh = await getSettings();
      await schedulePeriodicAlarm(fresh);
      if (fresh.consentAcceptedAt && fresh.codeforcesHandle && fresh.githubLogin && fresh.repository && (fresh.sync.phase === 'historical' || fresh.sync.phase === 'incremental' || fresh.autoSync)) {
        await browserApi().alarms.create(UNLOCKED_ALARM, { delayInMinutes: 0.1 });
      }
      return getSettings();
    }
    case 'vaultLock':
      await cancelSyncJob('paused');
      await lockVault(); await browserApi().alarms.clear(UNLOCKED_ALARM); await browserApi().alarms.clear(RECOVERY_ALARM);
      await schedulePeriodicAlarm(); return getSettings();
    case 'vaultReset':
      if (settings.repository) await backfillLegacyHistory(settings.repository.fullName, settings.sync, settings.sync.lastRunAt);
      if (settings.repository && settings.codeforcesHandle) await backfillDurableOwnership(settings.repository.fullName, settings.codeforcesHandle, settings.sync);
      await cancelSyncJob('idle', true);
      await resetVault();
      await browserApi().alarms.clear(UNLOCKED_ALARM); await browserApi().alarms.clear(RECOVERY_ALARM);
      await updateSettings((current) => ({ ...current, codeforcesHandle: undefined, codeforcesSourceAccess: undefined, githubLogin: undefined, repository: undefined, sync: { ...DEFAULT_SETTINGS.sync } }));
      await schedulePeriodicAlarm(); return getSettings();
    case 'consent':
      return updateSettings((current) => ({ ...current, consentAcceptedAt: Date.now() }));
    case 'connectCodeforces': {
      if (!settings.consentAcceptedAt) throw new Error('Accept the data use notice before connecting Codeforces.');
      await readVaultSecrets();
      const handle = message.handle.trim();
      if (!/^[\w-]{3,24}$/.test(handle)) throw new Error('Enter a valid Codeforces handle.');
      const apiKey = typeof message.apiKey === 'string' ? message.apiKey.trim() : '';
      const apiSecret = typeof message.apiSecret === 'string' ? message.apiSecret.trim() : '';
      if (!/^[\w-]{1,128}$/.test(apiKey) || !/^[\w-]{1,128}$/.test(apiSecret)) throw new Error('Enter the API key and secret shown in your Codeforces API settings.');
      const canonical = await fetchCodeforcesProfile(handle);
      const credentials = { apiKey, apiSecret };
      const probe = await fetchSubmissionPage(canonical, 1, 1, credentials, true);
      if ((await getSettings()).jobGeneration !== settings.jobGeneration) throw new Error('Account setup was cancelled because connection settings changed.');
      await updateVaultSecrets((current) => ({ ...current, codeforcesCredentials: credentials }));
      const sourceAccess = probe.some((submission) => submissionSource(submission) !== undefined) ? 'confirmed' as const : 'unconfirmed' as const;
      const updated = await updateSettings((current) => ({ ...current, codeforcesHandle: canonical, codeforcesSourceAccess: sourceAccess }));
      await schedulePeriodicAlarm(updated);
      void syncUserActivity(canonical, credentials).catch(() => undefined);
      return updated;
    }
    case 'connectGithub': {
      if (!settings.consentAcceptedAt) throw new Error('Accept the data use notice before connecting GitHub.');
      await readVaultSecrets();
      const auth = await connectGithub();
      if ((await getSettings()).jobGeneration !== settings.jobGeneration) throw new Error('Account setup was cancelled because connection settings changed.');
      await updateVaultSecrets((current) => ({ ...current, github: auth, githubRefreshPending: false }));
      const updated = await updateSettings((current) => ({ ...current, githubLogin: auth.login }));
      await schedulePeriodicAlarm(updated); return updated;
    }
    case 'repositories': {
      if (!settings.githubLogin) throw new Error('Connect GitHub first.');
      const secrets = await readVaultSecrets(); if (!secrets.github) throw new Error('Reconnect GitHub first.');
      const auth = await getUsableAuth(secrets.github);
      if ((await getSettings()).jobGeneration !== settings.jobGeneration) throw new Error('Repository lookup was cancelled because connection settings changed.');
      const client = new GithubClient(auth, fetch, () => assertGeneration(settings.jobGeneration), () => getUsableAuth(auth));
      return client.repositories();
    }
    case 'createRepository': {
      if (!settings.githubLogin) throw new Error('Connect GitHub first.');
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(message.name)) throw new Error('Use a repository name with letters, numbers, dots, dashes, or underscores.');
      const secrets = await readVaultSecrets(); if (!secrets.github) throw new Error('Reconnect GitHub first.');
      const auth = await getUsableAuth(secrets.github);
      if ((await getSettings()).jobGeneration !== settings.jobGeneration) throw new Error('Repository setup was cancelled because connection settings changed.');
      const repo = await new GithubClient(auth, fetch, () => assertGeneration(settings.jobGeneration), () => getUsableAuth(auth)).createRepository(message.name, message.isPrivate);
      if ((await getSettings()).jobGeneration !== settings.jobGeneration) throw new Error('Repository setup was cancelled because connection settings changed.');
      if (settings.repository) await backfillLegacyHistory(settings.repository.fullName, settings.sync, settings.sync.lastRunAt);
      if (settings.repository && settings.codeforcesHandle) await backfillDurableOwnership(settings.repository.fullName, settings.codeforcesHandle, settings.sync);
      await cancelSyncJob('idle', true);
      const updated = await updateSettings((current) => ({ ...current, repository: repo, sync: { ...DEFAULT_SETTINGS.sync } }));
      await schedulePeriodicAlarm(updated); return updated;
    }
    case 'selectRepository': {
      if (settings.repository?.fullName === message.repository.fullName) {
        const updated = await updateSettings((current) => ({ ...current, repository: message.repository }));
        await schedulePeriodicAlarm(updated); return updated;
      }
      if (settings.repository) await backfillLegacyHistory(settings.repository.fullName, settings.sync, settings.sync.lastRunAt);
      if (settings.repository && settings.codeforcesHandle) await backfillDurableOwnership(settings.repository.fullName, settings.codeforcesHandle, settings.sync);
      await cancelSyncJob('idle', true);
      await browserApi().alarms.clear(RECOVERY_ALARM); await browserApi().alarms.clear(UNLOCKED_ALARM);
      const restored = settings.codeforcesHandle ? await getDurableOwnership(message.repository.fullName, settings.codeforcesHandle) : {};
      const sync = { ...DEFAULT_SETTINGS.sync, repositoryFullName: message.repository.fullName, synced: restored, uniqueProblems: Object.keys(restored).length, filesUploaded: Object.keys(restored).length };
      const updated = await updateSettings((current) => ({ ...current, repository: message.repository, sync }));
      await schedulePeriodicAlarm(updated); return updated;
    }
    case 'startImport':
      if (!settings.consentAcceptedAt) throw new Error('Review and accept the data use notice before syncing.');
      await runSync('historical'); return getSettings();
    case 'syncNow':
      if (!settings.consentAcceptedAt) throw new Error('Review and accept the data use notice before syncing.');
      await runSync(settings.sync.done && !settings.sync.needsReimport ? 'incremental' : 'historical'); return getSettings();
    case 'retryFailures':
      if (!settings.consentAcceptedAt) throw new Error('Review and accept the data use notice before syncing.');
      await cancelSyncJob('idle');
      await updateSettings((current) => ({ ...current, sync: { ...current.sync, phase: 'historical', nextFrom: 1, submissionsSeen: 0, acceptedSeen: 0, scanCutoff: undefined, done: false, failed: {}, error: undefined } }));
      await runSync('historical'); return getSettings();
    case 'pause':
      await cancelSyncJob('paused'); await browserApi().alarms.clear(PERIODIC_ALARM); await browserApi().alarms.clear(RECOVERY_ALARM); await browserApi().alarms.clear(UNLOCKED_ALARM); return getSettings();
    case 'resume':
      if (!settings.consentAcceptedAt) throw new Error('Review and accept the data use notice before syncing.');
      await updateSettings((current) => ({ ...current, sync: { ...current.sync, phase: 'idle', error: undefined } }));
      await runSync(settings.sync.done ? 'incremental' : 'historical', true); return getSettings();
    case 'settings':
      {
        const updated = await updateSettings((current) => ({
          ...current,
          autoSync: Boolean(message.autoSync),
          syncMinutes: Math.max(60, Math.min(1440, Math.round(message.syncMinutes))),
          preferredTimezone: typeof message.preferredTimezone === 'string' ? message.preferredTimezone : current.preferredTimezone,
        }));
        await schedulePeriodicAlarm(updated); return updated;
      }
    case 'setTimezone':
      {
        const updated = await updateSettings((current) => ({
          ...current,
          preferredTimezone: typeof message.timezone === 'string' ? message.timezone : current.preferredTimezone,
        }));
        return updated;
      }
    case 'disconnect':
      if (settings.repository) await backfillLegacyHistory(settings.repository.fullName, settings.sync, settings.sync.lastRunAt);
      if (settings.repository && settings.codeforcesHandle) await backfillDurableOwnership(settings.repository.fullName, settings.codeforcesHandle, settings.sync);
      await cancelSyncJob('idle', true);
      await browserApi().alarms.clear(RECOVERY_ALARM); await browserApi().alarms.clear(UNLOCKED_ALARM);
      await updateVaultSecrets((current) => message.provider === 'github'
        ? { ...current, github: undefined, githubRefreshPending: false }
        : { ...current, codeforcesCredentials: undefined });
      const updated = await updateSettings((current) => message.provider === 'github'
        ? { ...current, githubLogin: undefined, repository: undefined, sync: { ...DEFAULT_SETTINGS.sync } }
        : { ...current, codeforcesHandle: undefined, codeforcesSourceAccess: undefined, sync: { ...DEFAULT_SETTINGS.sync } });
      await schedulePeriodicAlarm(updated); return updated;
  }
}

browserApi().runtime.onMessage.addListener((message: Command, _sender, sendResponse) => {
  dispatch(message).then((value) => sendResponse({ ok: true, value })).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unexpected error.' }));
  return true;
});

function validHistoryStatus(status: unknown): status is SyncHistoryStatus | 'all' { return status === 'all' || status === 'uploaded' || status === 'updated' || status === 'skipped' || status === 'failed'; }

browserApi().alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PERIODIC_ALARM) void runSync('incremental').catch(() => undefined);
  if (alarm.name === UNLOCKED_ALARM) void getSettings().then((settings) => runSync(settings.sync.done ? 'incremental' : 'historical', settings.sync.phase === 'paused')).catch(() => undefined);
  if (alarm.name === RECOVERY_ALARM) void getSettings().then((settings) => {
    if (settings.sync.phase === 'historical' || settings.sync.phase === 'incremental') void runSync(settings.sync.done ? 'incremental' : 'historical').catch(() => undefined);
  });
});
browserApi().runtime.onInstalled.addListener(() => { void schedulePeriodicAlarm(); });
browserApi().runtime.onStartup.addListener(() => { void getSettings().then(async (current) => { await schedulePeriodicAlarm(current); if (current.sync.phase === 'historical' || current.sync.phase === 'incremental') await runSync(current.sync.done ? 'incremental' : 'historical').catch(() => undefined); }); });
void schedulePeriodicAlarm();
void browserApi().storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
void browserApi().storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });

async function assertGeneration(expected: number): Promise<void> {
  if ((await getSettings()).jobGeneration !== expected) throw new Error('Operation cancelled because account, repository, or vault state changed.');
}
