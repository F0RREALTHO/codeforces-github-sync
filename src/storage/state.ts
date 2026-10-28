import { browserApi } from '../platform/browser';
import { DEFAULT_SETTINGS, type Settings } from '../domain/types';
import { markFilterChange, normalizeSyncFilters } from '../domain/filters';
import type { SyncFilters } from '../domain/types';

const SETTINGS_KEY = 'cfgh.settings.v1';
const LOCK_KEY = 'cfgh.syncLock';
let mutationQueue: Promise<void> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getSettings(): Promise<Settings> {
  const value = (await browserApi().storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  let syncFilters = DEFAULT_SETTINGS.syncFilters;
  try { syncFilters = normalizeSyncFilters(value?.syncFilters); } catch { /* Preserve safe defaults when upgrading malformed legacy local settings. */ }
  return { ...DEFAULT_SETTINGS, ...value, syncFilters, sync: { ...DEFAULT_SETTINGS.sync, ...value?.sync, failed: { ...DEFAULT_SETTINGS.sync.failed, ...value?.sync?.failed }, synced: { ...DEFAULT_SETTINGS.sync.synced, ...value?.sync?.synced }, retiredFiles: { ...DEFAULT_SETTINGS.sync.retiredFiles, ...value?.sync?.retiredFiles }, contestQueue: { ...DEFAULT_SETTINGS.sync.contestQueue, ...value?.sync?.contestQueue } } };
}
export async function saveSettings(settings: Settings): Promise<void> { await serialized(() => browserApi().storage.local.set({ [SETTINGS_KEY]: settings })); }
export async function updateSettings(update: (settings: Settings) => Settings): Promise<Settings> {
  return serialized(async () => {
    const next = update(await getSettings());
    await browserApi().storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
}
export async function saveSyncForJob(generation: number, sync: Settings['sync']): Promise<boolean> {
  return serialized(async () => {
    const settings = await getSettings();
    if (settings.jobGeneration !== generation) return false;
    settings.sync = sync;
    await browserApi().storage.local.set({ [SETTINGS_KEY]: settings });
    return true;
  });
}
export async function setSyncErrorForJob(generation: number, error: string): Promise<boolean> {
  return serialized(async () => {
    const settings = await getSettings();
    if (settings.jobGeneration !== generation) return false;
    settings.sync = { ...settings.sync, phase: 'error', error };
    await browserApi().storage.local.set({ [SETTINGS_KEY]: settings });
    return true;
  });
}
export async function cancelSyncJob(phase: 'paused' | 'idle' = 'paused', reset = false): Promise<Settings> {
  return updateSettings((settings) => ({
    ...settings,
    jobGeneration: settings.jobGeneration + 1,
    sync: reset ? { ...DEFAULT_SETTINGS.sync } : {
      ...settings.sync,
      phase: settings.sync.phase === 'historical' || settings.sync.phase === 'incremental' ? phase : settings.sync.phase,
      error: phase === 'paused' && (settings.sync.phase === 'historical' || settings.sync.phase === 'incremental') ? 'Sync paused because account, repository, or vault state changed.' : settings.sync.error,
    },
  }));
}
export async function saveSyncFilters(filters: SyncFilters): Promise<Settings> {
  const before = await getSettings();
  const scanned = before.sync.done || before.sync.submissionsSeen > 0 || before.sync.uniqueProblems > 0 || before.sync.phase === 'historical' || before.sync.phase === 'incremental';
  await cancelSyncJob('idle');
  return updateSettings((current) => ({ ...current, syncFilters: filters, sync: scanned ? markFilterChange(current.sync, true) : current.sync }));
}
export async function acquireSyncLock(): Promise<boolean> {
  const now = Date.now();
  const lock = (await browserApi().storage.local.get(LOCK_KEY))[LOCK_KEY] as { until: number } | undefined;
  if (lock && lock.until > now) return false;
  await browserApi().storage.local.set({ [LOCK_KEY]: { until: now + 90_000 } });
  return true;
}
export async function renewSyncLock(): Promise<void> { await browserApi().storage.local.set({ [LOCK_KEY]: { until: Date.now() + 90_000 } }); }
export async function releaseSyncLock(): Promise<void> { await browserApi().storage.local.remove(LOCK_KEY); }
