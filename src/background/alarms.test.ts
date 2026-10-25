import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../domain/types';

const mocks = vi.hoisted(() => ({ settings: undefined as Settings | undefined, unlocked: true }));
vi.mock('../storage/state', () => ({ getSettings: async () => structuredClone(mocks.settings!) }));
vi.mock('../storage/vault', () => ({ vaultStatus: async () => ({ exists: true, unlocked: mocks.unlocked }) }));

afterEach(() => vi.unstubAllGlobals());

describe('periodic sync alarms', () => {
  it('does not resume automatic sync before a filter-triggered historical re-import', async () => {
    const { schedulePeriodicAlarm } = await import('./alarms');
    mocks.settings = {
      ...structuredClone(DEFAULT_SETTINGS), codeforcesHandle: 'alice', githubLogin: 'alice', consentAcceptedAt: 1,
      repository: { owner: 'alice', name: 'repo', fullName: 'alice/repo', private: true, defaultBranch: 'main' },
      sync: { ...structuredClone(DEFAULT_SETTINGS.sync), done: true, needsReimport: true },
    };
    const create = vi.fn();
    vi.stubGlobal('chrome', { alarms: { clear: vi.fn(async () => true), create } });
    await schedulePeriodicAlarm();
    expect(create).not.toHaveBeenCalled();
    mocks.settings.sync.needsReimport = false;
    await schedulePeriodicAlarm();
    expect(create).toHaveBeenCalledWith('cfgh.periodicSync', { periodInMinutes: 360 });
  });
});
