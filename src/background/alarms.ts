import type { Settings } from '../domain/types';
import { getSettings } from '../storage/state';
import { vaultStatus } from '../storage/vault';

export const PERIODIC_ALARM = 'cfgh.periodicSync';
export const RECOVERY_ALARM = 'cfgh.recovery';
export const UNLOCKED_ALARM = 'cfgh.unlockedSync';

export async function schedulePeriodicAlarm(settings?: Settings): Promise<void> {
  await chrome.alarms.clear(PERIODIC_ALARM);
  const current = settings ?? await getSettings();
  const unlocked = (await vaultStatus()).unlocked;
  if (current.autoSync && current.sync.done && !current.sync.needsReimport && current.sync.phase !== 'paused' && current.codeforcesHandle && current.githubLogin && current.repository && current.consentAcceptedAt && unlocked) {
    await chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: Math.max(60, current.syncMinutes) });
  }
}
