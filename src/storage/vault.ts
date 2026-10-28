import { browserApi } from '../platform/browser';
import type { AuthState, CodeforcesCredentials, VaultStatus } from '../domain/types';

export interface VaultSecrets {
  codeforcesCredentials?: CodeforcesCredentials;
  github?: AuthState;
  githubRefreshPending?: boolean;
}

export interface VaultKdfMetadata {
  algorithm: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string; // Base64 encoded
}

export interface VersionedVaultRecord {
  version: 2;
  kdf: VaultKdfMetadata;
  iv: string; // Base64 encoded 96-bit IV
  ciphertext: string; // Base64 encoded ciphertext
}

// Legacy unversioned / v1 record representation
export interface LegacyVaultRecord {
  version?: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  kdf?: Partial<VaultKdfMetadata>;
}

export type StoredVaultRecord = VersionedVaultRecord | LegacyVaultRecord;

const VAULT_KEY = 'cfgh.credentialVault.v1';
const SESSION_KEY = 'cfgh.vaultSessionKey';

export const TARGET_PBKDF2_ITERATIONS = 600_000;
export const LEGACY_PBKDF2_ITERATIONS = 310_000;

let vaultMutationQueue: Promise<void> = Promise.resolve();

function serializeVaultMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = vaultMutationQueue.then(operation, operation);
  vaultMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function vaultStatus(): Promise<VaultStatus> {
  const [recordMap, keyMap] = await Promise.all([
    browserApi().storage.local.get(VAULT_KEY),
    browserApi().storage.session.get(SESSION_KEY),
  ]);
  const record = recordMap[VAULT_KEY] as StoredVaultRecord | undefined;
  const isUnlocked = Boolean(keyMap[SESSION_KEY]);

  if (!record) {
    return { exists: false, unlocked: false };
  }

  const isV2 = 'version' in record && record.version === 2 && 'kdf' in record;
  const iterations = isV2 ? record.kdf.iterations : (record as LegacyVaultRecord).kdf?.iterations || LEGACY_PBKDF2_ITERATIONS;

  return {
    exists: true,
    unlocked: isUnlocked,
    version: isV2 ? 2 : 1,
    kdfIterations: iterations,
    kdfAlgorithm: 'PBKDF2-HMAC-SHA256',
  };
}

export async function openVault(passphrase: string): Promise<{ created: boolean; migrated: boolean }> {
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw new Error('Use a vault password with at least 12 characters.');
  }

  return serializeVaultMutation(async () => {
    const stored = (await browserApi().storage.local.get(VAULT_KEY))[VAULT_KEY] as StoredVaultRecord | undefined;

    if (!stored) {
      // Create fresh v2 vault with 600,000 iterations
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(passphrase, salt, TARGET_PBKDF2_ITERATIONS);
      const empty: VaultSecrets = {};
      const record = await encryptRecord(empty, key, salt, TARGET_PBKDF2_ITERATIONS);
      await browserApi().storage.local.set({ [VAULT_KEY]: record });
      await browserApi().storage.session.set({ [SESSION_KEY]: toBase64(await crypto.subtle.exportKey('raw', key)) });
      return { created: true, migrated: false };
    }

    // Check if record is already upgraded to v2 with 600,000 iterations
    const isV2 = 'version' in stored && stored.version === 2 && 'kdf' in stored;
    if (isV2 && stored.kdf.iterations === TARGET_PBKDF2_ITERATIONS) {
      const salt = fromBase64(stored.kdf.salt);
      const key = await deriveKey(passphrase, salt, TARGET_PBKDF2_ITERATIONS);
      await decryptRecord(stored, key); // Throws if wrong passphrase or corrupted
      await browserApi().storage.session.set({ [SESSION_KEY]: toBase64(await crypto.subtle.exportKey('raw', key)) });
      return { created: false, migrated: false };
    }

    // Legacy vault migration path:
    // 1. Read existing parameters
    const oldSalt = fromBase64('kdf' in stored && stored.kdf?.salt ? stored.kdf.salt : (stored as LegacyVaultRecord).salt);
    const oldIterations = 'kdf' in stored && stored.kdf?.iterations ? stored.kdf.iterations : LEGACY_PBKDF2_ITERATIONS;

    // 2. Derive old key & decrypt
    const oldKey = await deriveKey(passphrase, oldSalt, oldIterations);
    const secrets = await decryptRecord(stored, oldKey); // Validates passphrase before any mutation

    // 3. Derive upgraded key with fresh cryptographically random salt & 600,000 iterations
    const newSalt = crypto.getRandomValues(new Uint8Array(16));
    const newKey = await deriveKey(passphrase, newSalt, TARGET_PBKDF2_ITERATIONS);

    // 4. Re-encrypt with fresh 96-bit AES-GCM IV and v2 metadata
    const newRecord = await encryptRecord(secrets, newKey, newSalt, TARGET_PBKDF2_ITERATIONS);

    // 5. Verify roundtrip decryption before persisting
    const verified = await decryptRecord(newRecord, newKey);
    if (!verified || typeof verified !== 'object') {
      throw new Error('Vault migration self-verification failed. Retaining original record.');
    }

    // 6. Atomically persist upgraded record & store session key
    await browserApi().storage.local.set({ [VAULT_KEY]: newRecord });
    await browserApi().storage.session.set({ [SESSION_KEY]: toBase64(await crypto.subtle.exportKey('raw', newKey)) });

    return { created: false, migrated: true };
  });
}

export async function readVaultSecrets(): Promise<VaultSecrets> {
  return decryptCurrentVault();
}

async function decryptCurrentVault(): Promise<VaultSecrets> {
  const record = (await browserApi().storage.local.get(VAULT_KEY))[VAULT_KEY] as StoredVaultRecord | undefined;
  if (!record) throw new Error('Set up the local credential vault before connecting accounts.');
  return decryptRecord(record, await getSessionKey());
}

export async function saveVaultSecrets(secrets: VaultSecrets): Promise<void> {
  await serializeVaultMutation(() => writeCurrentVault(secrets));
}

export async function updateVaultSecrets(update: (secrets: VaultSecrets) => VaultSecrets): Promise<VaultSecrets> {
  return serializeVaultMutation(async () => {
    const current = await decryptCurrentVault();
    const updated = update(current);
    await writeCurrentVault(updated);
    return updated;
  });
}

async function writeCurrentVault(secrets: VaultSecrets): Promise<void> {
  const stored = (await browserApi().storage.local.get(VAULT_KEY))[VAULT_KEY] as StoredVaultRecord | undefined;
  if (!stored) throw new Error('Set up the local credential vault before connecting accounts.');
  const key = await getSessionKey();

  const saltBytes = 'kdf' in stored && stored.kdf?.salt ? fromBase64(stored.kdf.salt) : fromBase64((stored as LegacyVaultRecord).salt);
  const iterations = 'kdf' in stored && stored.kdf?.iterations ? stored.kdf.iterations : TARGET_PBKDF2_ITERATIONS;

  const updatedRecord = await encryptRecord(secrets, key, saltBytes, iterations);
  await browserApi().storage.local.set({ [VAULT_KEY]: updatedRecord });
}

export async function lockVault(): Promise<void> {
  await browserApi().storage.session.remove(SESSION_KEY);
}

export async function resetVault(): Promise<void> {
  await browserApi().storage.local.remove(VAULT_KEY);
  await browserApi().storage.session.remove(SESSION_KEY);
}

async function getSessionKey(): Promise<CryptoKey> {
  const value = (await browserApi().storage.session.get(SESSION_KEY))[SESSION_KEY] as string | undefined;
  if (!value) throw new Error('Unlock your local credential vault to continue.');
  return crypto.subtle.importKey('raw', toArrayBuffer(fromBase64(value)), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptRecord(
  value: VaultSecrets,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number
): Promise<VersionedVaultRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit fresh IV
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(value)))
  );

  return {
    version: 2,
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: toBase64(salt),
    },
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

async function decryptRecord(record: StoredVaultRecord, key: CryptoKey): Promise<VaultSecrets> {
  try {
    const iv = fromBase64(record.iv);
    const ciphertext = fromBase64(record.ciphertext);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plain)) as VaultSecrets;
  } catch {
    throw new Error('Vault password is incorrect or the encrypted credential data is damaged.');
  }
}

function toBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer as ArrayBuffer;
}
