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
    expect(await vaultStatus()).toMatchObject({ exists: true, unlocked: false, version: 2, kdfIterations: 600_000 });
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

  describe('PBKDF2 security upgrade and backward compatibility', () => {
    it('creates new vaults with v2 schema, 600,000 iterations, and reports metadata', async () => {
      const { local } = installStorageMocks();
      const result = await openVault('my-secure-long-password-123');
      expect(result.created).toBe(true);
      expect(result.migrated).toBe(false);

      const status = await vaultStatus();
      expect(status.exists).toBe(true);
      expect(status.unlocked).toBe(true);
      expect(status.version).toBe(2);
      expect(status.kdfIterations).toBe(600_000);
      expect(status.kdfAlgorithm).toBe('PBKDF2-HMAC-SHA256');

      const stored = local.get('cfgh.credentialVault.v1') as Record<string, unknown>;
      expect(stored.version).toBe(2);
      expect((stored.kdf as { iterations: number }).iterations).toBe(600_000);
    });

    it('migrates legacy v1 vaults (310,000 iterations) seamlessly on unlock without losing credentials', async () => {
      const { local } = installStorageMocks();
      // Setup a legacy v1 vault manually:
      const passphrase = 'legacy-password-for-vault-123';
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Derive key with old 310,000 iterations
      const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
      const legacyKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      const legacySecrets = {
        codeforcesCredentials: { apiKey: 'cf-old-key', apiSecret: 'cf-old-secret' },
        github: { accessToken: 'gho-legacy-token', login: 'octocat' },
      };
      const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        legacyKey,
        new TextEncoder().encode(JSON.stringify(legacySecrets))
      );

      // Store unversioned legacy record in storage
      const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
      const legacyRecord = {
        salt: toB64(salt),
        iv: toB64(iv),
        ciphertext: toB64(ciphertextBuffer),
      };
      local.set('cfgh.credentialVault.v1', legacyRecord);

      // Verify initial status reflects v1 legacy
      const preStatus = await vaultStatus();
      expect(preStatus.exists).toBe(true);
      expect(preStatus.unlocked).toBe(false);
      expect(preStatus.version).toBe(1);
      expect(preStatus.kdfIterations).toBe(310_000);

      // Unlock legacy vault - should trigger atomic migration to v2 (600,000 iterations)
      const openResult = await openVault(passphrase);
      expect(openResult.migrated).toBe(true);

      // Verify status is now v2 with 600,000 iterations
      const postStatus = await vaultStatus();
      expect(postStatus.version).toBe(2);
      expect(postStatus.kdfIterations).toBe(600_000);

      // Verify all secrets are intact!
      const readSecrets = await readVaultSecrets();
      expect(readSecrets.codeforcesCredentials?.apiKey).toBe('cf-old-key');
      expect(readSecrets.codeforcesCredentials?.apiSecret).toBe('cf-old-secret');
      expect(readSecrets.github?.accessToken).toBe('gho-legacy-token');
      expect(readSecrets.github?.login).toBe('octocat');

      // Verify storage was upgraded to v2 format
      const migratedRecord = local.get('cfgh.credentialVault.v1') as Record<string, unknown>;
      expect(migratedRecord.version).toBe(2);
      expect((migratedRecord.kdf as { iterations: number }).iterations).toBe(600_000);

      // Subsequent unlock uses v2 parameters directly without migrating again
      await lockVault();
      const secondUnlock = await openVault(passphrase);
      expect(secondUnlock.migrated).toBe(false);
      expect((await readVaultSecrets()).github?.login).toBe('octocat');
    });

    it('rejects wrong password on legacy vault without modifying the stored record', async () => {
      const { local } = installStorageMocks();
      const passphrase = 'valid-legacy-password-123';
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
      const legacyKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, legacyKey, new TextEncoder().encode('{}'));
      const originalRecord = { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ciphertext) };
      local.set('cfgh.credentialVault.v1', structuredClone(originalRecord));

      // Attempt unlock with wrong password
      await expect(openVault('wrong-passphrase-attempt-456')).rejects.toThrow('Vault password is incorrect');

      // Storage record must remain identical and uncorrupted
      expect(local.get('cfgh.credentialVault.v1')).toEqual(originalRecord);
    });

    it('handles corrupted legacy ciphertext without corrupting storage or unlocking', async () => {
      const { local } = installStorageMocks();
      local.set('cfgh.credentialVault.v1', {
        salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
        iv: 'BBBBBBBBBBBBBBBB',
        ciphertext: 'not-valid-encrypted-data',
      });

      await expect(openVault('any-12-character-password')).rejects.toThrow('Vault password is incorrect');
      expect((await vaultStatus()).unlocked).toBe(false);
    });
  });
});

