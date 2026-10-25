import { browserApi } from '../platform/browser';
import type { AuthState, CodeforcesCredentials } from '../domain/types';

export interface VaultSecrets { codeforcesCredentials?: CodeforcesCredentials; github?: AuthState; githubRefreshPending?: boolean; }
interface VaultRecord { salt: string; iv: string; ciphertext: string; }
const VAULT_KEY = 'cfgh.credentialVault.v1';
const SESSION_KEY = 'cfgh.vaultSessionKey';
const ITERATIONS = 310_000;
let vaultMutationQueue: Promise<void> = Promise.resolve();

function serializeVaultMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = vaultMutationQueue.then(operation, operation);
  vaultMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function vaultStatus(): Promise<{ exists: boolean; unlocked: boolean }> {
  const [record, key] = await Promise.all([browserApi().storage.local.get(VAULT_KEY), browserApi().storage.session.get(SESSION_KEY)]);
  return { exists: Boolean(record[VAULT_KEY]), unlocked: Boolean(key[SESSION_KEY]) };
}

export async function openVault(passphrase: string): Promise<{ created: boolean }> {
  if (passphrase.length < 12) throw new Error('Use a vault password with at least 12 characters.');
  const stored = (await browserApi().storage.local.get(VAULT_KEY))[VAULT_KEY] as VaultRecord | undefined;
  if (stored) {
    const key = await deriveKey(passphrase, fromBase64(stored.salt));
    await decrypt(stored, key);
    await browserApi().storage.session.set({ [SESSION_KEY]: toBase64(await crypto.subtle.exportKey('raw', key)) });
    return { created: false };
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const empty: VaultSecrets = {};
  const record = await encrypt(empty, key, toBase64(salt));
  await browserApi().storage.local.set({ [VAULT_KEY]: record });
  await browserApi().storage.session.set({ [SESSION_KEY]: toBase64(await crypto.subtle.exportKey('raw', key)) });
  return { created: true };
}

export async function readVaultSecrets(): Promise<VaultSecrets> {
  return decryptCurrentVault();
}

async function decryptCurrentVault(): Promise<VaultSecrets> {
  const record = (await browserApi().storage.local.get(VAULT_KEY))[VAULT_KEY] as VaultRecord | undefined;
  if (!record) throw new Error('Set up the local credential vault before connecting accounts.');
  return decrypt(record, await getSessionKey());
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
  const stored = (await browserApi().storage.local.get(VAULT_KEY))[VAULT_KEY] as VaultRecord | undefined;
  if (!stored) throw new Error('Set up the local credential vault before connecting accounts.');
  const key = await getSessionKey();
  await browserApi().storage.local.set({ [VAULT_KEY]: await encrypt(secrets, key, stored.salt) });
}

export async function lockVault(): Promise<void> { await browserApi().storage.session.remove(SESSION_KEY); }
export async function resetVault(): Promise<void> { await browserApi().storage.local.remove(VAULT_KEY); await browserApi().storage.session.remove(SESSION_KEY); }

async function getSessionKey(): Promise<CryptoKey> {
  const value = (await browserApi().storage.session.get(SESSION_KEY))[SESSION_KEY] as string | undefined;
  if (!value) throw new Error('Unlock your local credential vault to continue.');
  return crypto.subtle.importKey('raw', toArrayBuffer(fromBase64(value)), 'AES-GCM', true, ['encrypt', 'decrypt']);
}
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(new TextEncoder().encode(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function encrypt(value: VaultSecrets, key: CryptoKey, salt: string): Promise<VaultRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(new TextEncoder().encode(JSON.stringify(value))));
  return { salt, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}
async function decrypt(record: VaultRecord, key: CryptoKey): Promise<VaultSecrets> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(fromBase64(record.iv)) }, key, toArrayBuffer(fromBase64(record.ciphertext)));
    return JSON.parse(new TextDecoder().decode(plain)) as VaultSecrets;
  } catch { throw new Error('Vault password is incorrect or the encrypted credential data is damaged.'); }
}
function toBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function toArrayBuffer(value: Uint8Array): ArrayBuffer { return new Uint8Array(value).buffer as ArrayBuffer; }
