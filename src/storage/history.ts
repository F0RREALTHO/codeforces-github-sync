import type { SyncedFile, SyncHistoryEntry, SyncHistoryStatus, SyncState } from '../domain/types';

const DB_NAME = 'cfgh.syncHistory';
const DB_VERSION = 2;

export interface HistoryQuery {
  repositoryFullName?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: SyncHistoryStatus | 'all';
  language?: string;
  fromDate?: string;
  toDate?: string;
}
export interface HistoryPage { entries: SyncHistoryEntry[]; page: number; pageSize: number; total: number; }
export interface HistoryStats { uploadedProblems: number; updatedProblems: number; skippedProblems: number; failedOperations: number; latestSuccessfulAt?: number; }
interface LatestAccepted { id: string; repositoryFullName: string; problemKey: string; submissionId: number; }
interface DurableOwnership extends SyncedFile { id: string; repositoryFullName: string; codeforcesHandle: string; problemKey: string; savedAt: number; sha: string; }

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('events')) {
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('byRepository', 'repositoryFullName');
        events.createIndex('byRepositoryRecordedAt', ['repositoryFullName', 'recordedAt', 'submissionId']);
      }
      if (!db.objectStoreNames.contains('latest')) db.createObjectStore('latest', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('ownership')) {
        const ownership = db.createObjectStore('ownership', { keyPath: 'id' });
        ownership.createIndex('byRepositoryAndHandle', ['repositoryFullName', 'codeforcesHandle']);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { databasePromise = undefined; reject(request.error || new Error('Could not open sync history storage.')); };
    request.onblocked = () => { databasePromise = undefined; reject(new Error('Sync history storage upgrade is blocked by another extension page. Close old dashboard tabs and retry.')); };
  });
  return databasePromise;
}

export async function saveDurableOwnership(repositoryFullName: string, codeforcesHandle: string, problemKey: string, file: SyncedFile): Promise<void> {
  const sha = file.sha;
  if (!sha) throw new Error('Cannot persist file ownership without a GitHub SHA.');
  const db = await openDatabase();
  const id = `${repositoryFullName}\u0000${codeforcesHandle}\u0000${problemKey}`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('ownership', 'readwrite');
    const store = tx.objectStore('ownership');
    const request = store.get(id) as IDBRequest<DurableOwnership | undefined>;
    request.onsuccess = () => {
      const current = request.result;
      // A committed submission cannot be replaced by an older replay. Equal IDs may
      // refresh the SHA after an idempotent, extension-authorized replacement.
      if (!current || file.submissionId >= current.submissionId) {
        store.put({ ...file, sha, id, repositoryFullName, codeforcesHandle, problemKey, savedAt: Date.now() } satisfies DurableOwnership);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not persist repository file ownership.'));
    tx.onabort = () => reject(tx.error || new Error('Persisting repository file ownership was interrupted.'));
  });
}

export async function getDurableOwnership(repositoryFullName: string, codeforcesHandle: string): Promise<Record<string, SyncedFile>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('ownership', 'readonly');
    const request = tx.objectStore('ownership').index('byRepositoryAndHandle').getAll(IDBKeyRange.only([repositoryFullName, codeforcesHandle])) as IDBRequest<DurableOwnership[]>;
    request.onsuccess = () => {
      const entries: Record<string, SyncedFile> = {};
      for (const { problemKey, submissionId, path, sha, metadataPath, metadataSha } of request.result) {
        if (!sha) continue;
        entries[problemKey] = { submissionId, path, sha, ...(metadataPath ? { metadataPath } : {}), ...(metadataSha ? { metadataSha } : {}) };
      }
      resolve(entries);
    };
    request.onerror = () => reject(request.error || new Error('Could not restore repository file ownership.'));
  });
}

export async function backfillDurableOwnership(repositoryFullName: string, codeforcesHandle: string, sync: SyncState): Promise<void> {
  for (const [problemKey, file] of Object.entries(sync.synced)) {
    if (file.sha) await saveDurableOwnership(repositoryFullName, codeforcesHandle, problemKey, file);
  }
}

export async function noteLatestAccepted(repositoryFullName: string, problemKey: string, submissionId: number): Promise<number> {
  const db = await openDatabase();
  const key = `${repositoryFullName}\u0000${problemKey}`;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('latest', 'readwrite');
    const store = tx.objectStore('latest');
    let latest = submissionId;
    const get = store.get(key) as IDBRequest<LatestAccepted | undefined>;
    get.onsuccess = () => {
      latest = Math.max(submissionId, get.result?.submissionId ?? 0);
      if (!get.result || latest !== get.result.submissionId) store.put({ id: key, repositoryFullName, problemKey, submissionId: latest } satisfies LatestAccepted);
    };
    tx.oncomplete = () => resolve(latest);
    tx.onerror = () => reject(tx.error || new Error('Could not persist latest submission checkpoint.'));
    tx.onabort = () => reject(tx.error || new Error('Latest submission checkpoint was interrupted.'));
  });
}

export async function getLatestAccepted(repositoryFullName: string, problemKey: string): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('latest', 'readonly').objectStore('latest').get(`${repositoryFullName}\u0000${problemKey}`) as IDBRequest<LatestAccepted | undefined>;
    request.onsuccess = () => resolve(request.result?.submissionId ?? 0);
    request.onerror = () => reject(request.error || new Error('Could not read latest submission checkpoint.'));
  });
}

export async function recordHistoryEntry(entry: SyncHistoryEntry): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    const previousRequest = store.get(entry.id) as IDBRequest<SyncHistoryEntry | undefined>;
    previousRequest.onsuccess = () => {
      const previous = previousRequest.result;
      const duplicateReplay = !previous?.legacy && entry.reason?.startsWith('Already synchronized;')
        && previous && (previous.status === 'uploaded' || previous.status === 'updated');
      store.put({ ...entry, tags: [...entry.tags], ...(duplicateReplay ? { status: previous.status, recordedAt: previous.recordedAt, reason: previous.reason } : {}) });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save sync history.'));
    tx.onabort = () => reject(tx.error || new Error('Saving sync history was interrupted.'));
  });
}

/** Preserve the v0.1 ownership ledger across repository changes without inventing metadata. */
export async function backfillLegacyHistory(repositoryFullName: string, sync: SyncState, recordedAt = Date.now()): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    for (const [problemKey, owned] of Object.entries(sync.synced)) {
      const id = `${repositoryFullName}\u0000${owned.submissionId}`;
      const request = store.get(id) as IDBRequest<SyncHistoryEntry | undefined>;
      request.onsuccess = () => {
        if (request.result) return;
        const match = /^(\d+)-(.+)$/.exec(problemKey);
        const contestId = Number(match?.[1] || 0);
        const problemIndex = match?.[2] || problemKey;
        const problemName = owned.path.split('/').pop()?.replace(/\.[^.]+$/, '') || problemKey;
        store.put({
          id, repositoryFullName, problemKey, problemName, contestId, problemIndex,
          tags: [], programmingLanguage: 'Unknown (v0.1 manifest)', submissionId: owned.submissionId,
          status: 'uploaded', recordedAt, filePath: owned.path, legacy: true,
          reason: 'Migrated from v0.1 ownership data. Exact submission time, language and tags are unavailable until this submission is re-imported.'
        } satisfies SyncHistoryEntry);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not preserve existing sync history.'));
    tx.onabort = () => reject(tx.error || new Error('Preserving existing sync history was interrupted.'));
  });
}

export async function queryHistory(query: HistoryQuery): Promise<HistoryPage> {
  const db = await openDatabase();
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(query.pageSize || 50)));
  const offset = (page - 1) * pageSize;
  const search = query.search?.trim().toLocaleLowerCase() || '';
  const from = query.fromDate ? Date.parse(`${query.fromDate}T00:00:00Z`) : undefined;
  const to = query.toDate ? Date.parse(`${query.toDate}T23:59:59.999Z`) : undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readonly');
    const range = query.repositoryFullName
      ? IDBKeyRange.bound([query.repositoryFullName, 0, 0], [query.repositoryFullName, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])
      : undefined;
    const cursorRequest = tx.objectStore('events').index('byRepositoryRecordedAt').openCursor(range, 'prev');
    const entries: SyncHistoryEntry[] = [];
    let total = 0;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const entry = cursor.value as SyncHistoryEntry;
      const date = entry.submittedAt === undefined ? '' : new Date(entry.submittedAt).toISOString().slice(0, 10);
      const matches = (!search || entry.problemName.toLocaleLowerCase().includes(search) || String(entry.contestId).includes(search))
        && (!query.status || query.status === 'all' || entry.status === query.status)
        && (!query.language || entry.programmingLanguage === query.language)
        && (from === undefined || (entry.submittedAt !== undefined && entry.submittedAt >= from))
        && (to === undefined || (entry.submittedAt !== undefined && entry.submittedAt <= to))
        && (!query.fromDate || date >= query.fromDate)
        && (!query.toDate || date <= query.toDate);
      if (matches) {
        if (total >= offset && entries.length < pageSize) entries.push(entry);
        total += 1;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve({ entries, page, pageSize, total });
    tx.onerror = () => reject(tx.error || new Error('Could not query sync history.'));
    tx.onabort = () => reject(tx.error || new Error('Sync history query was interrupted.'));
  });
}

export async function getHistoryStats(repositoryFullName?: string): Promise<HistoryStats> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readonly');
    const request = repositoryFullName
      ? tx.objectStore('events').index('byRepository').openCursor(IDBKeyRange.only(repositoryFullName))
      : tx.objectStore('events').openCursor();
    const uploaded = new Set<string>();
    const updated = new Set<string>();
    const skipped = new Set<string>();
    let failedOperations = 0;
    let latestSuccessfulAt: number | undefined;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value as SyncHistoryEntry;
      const problemIdentity = `${entry.repositoryFullName}\u0000${entry.problemKey}`;
      if (entry.status === 'uploaded' || entry.status === 'updated') uploaded.add(problemIdentity);
      if (entry.status === 'updated') updated.add(problemIdentity);
      if (entry.status === 'skipped') skipped.add(problemIdentity);
      if (entry.status === 'failed') failedOperations += 1;
      if ((entry.status === 'uploaded' || entry.status === 'updated') && (!latestSuccessfulAt || entry.recordedAt > latestSuccessfulAt)) latestSuccessfulAt = entry.recordedAt;
      cursor.continue();
    };
    tx.oncomplete = () => resolve({ uploadedProblems: uploaded.size, updatedProblems: updated.size, skippedProblems: skipped.size, failedOperations, latestSuccessfulAt });
    tx.onerror = () => reject(tx.error || new Error('Could not calculate sync history statistics.'));
    tx.onabort = () => reject(tx.error || new Error('Sync history statistics were interrupted.'));
  });
}

export async function listHistoryRepositories(): Promise<string[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readonly');
    const request = tx.objectStore('events').index('byRepository').openKeyCursor();
    const repositories = new Set<string>();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      repositories.add(String(cursor.key));
      cursor.continue();
    };
    tx.oncomplete = () => resolve([...repositories].sort((a, b) => a.localeCompare(b)));
    tx.onerror = () => reject(tx.error || new Error('Could not list repositories in sync history.'));
  });
}

export function resetHistoryDatabaseForTests(): void { databasePromise?.then((db) => db.close()).catch(() => undefined); databasePromise = undefined; }
