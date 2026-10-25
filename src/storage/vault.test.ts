import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockVault, openVault, readVaultSecrets, resetVault, saveVaultSecrets, vaultStatus } from './vault';

function installStorageMocks() {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const area = (store: Map<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
    set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) store.set(key, value); }),
    remove: vi.fn(async (key: string) => { store.delete(key); }),
  });
  vi.stubGlobal('chrome', { storage: { local: area(local), session: area(session) } });
  return { local, session };
}

afterEach(() => vi.unstubAllGlobals());

describe('encrypted local credential vault', () => {
  it('encrypts credentials at rest and exposes them only after session unlock', async () => {
    const { local } = installStorageMocks();
    expect(await vaultStatus()).toEqual({ exists: false, unlocked: false });
    await openVault('correct horse battery staple');
    await saveVaultSecrets({ codeforcesCredentials: { apiKey: 'cf-key', apiSecret: 'cf-secret' }, github: { accessToken: 'ghu-token', refreshToken: 'ghr-token', login: 'ada' } });
    const serialized = JSON.stringify([...local.values()]);
    expect(serialized).not.toContain('cf-secret');
    expect(serialized).not.toContain('ghu-token');
    expect(await readVaultSecrets()).toMatchObject({ codeforcesCredentials: { apiSecret: 'cf-secret' }, github: { accessToken: 'ghu-token' } });
    await lockVault();
    expect(await vaultStatus()).toEqual({ exists: true, unlocked: false });
    await expect(readVaultSecrets()).rejects.toThrow('Unlock your local credential vault');
    await openVault('correct horse battery staple');
    expect(await readVaultSecrets()).toMatchObject({ github: { login: 'ada' } });
  });

  it('rejects wrong passwords and detects damaged encrypted data', async () => {
    const { local } = installStorageMocks();
    await openVault('correct horse battery staple');
    await saveVaultSecrets({ github: { accessToken: 'secret', login: 'ada' } });
    await lockVault();
    await expect(openVault('incorrect password')).rejects.toThrow('Vault password is incorrect');
    const record = [...local.entries()][0][1] as { ciphertext: string };
    record.ciphertext = 'AAAA';
    await expect(openVault('correct horse battery staple')).rejects.toThrow('Vault password is incorrect');
  });

  it('requires a long enough vault password and can clear a forgotten vault', async () => {
    installStorageMocks();
    await expect(openVault('short')).rejects.toThrow('at least 12 characters');
    await openVault('correct horse battery staple');
    await resetVault();
    expect(await vaultStatus()).toEqual({ exists: false, unlocked: false });
  });
});
