export interface CfProblem {
  contestId?: number;
  index: string;
  name: string;
  rating?: number;
  tags?: string[];
}

export interface CfSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  verdict?: string;
  programmingLanguage: string;
  problem: CfProblem;
  source?: string;
  sourceCode?: string;
  sourceBase64?: string;
}

export interface RepositoryRef { owner: string; name: string; fullName: string; private: boolean; defaultBranch: string; }
export interface SyncFilters {
  dateEnabled: boolean;
  dateFrom?: string;
  dateTo?: string;
  ratingEnabled: boolean;
  ratingMin?: number;
  ratingMax?: number;
  tagsEnabled: boolean;
  tags: string[];
  languagesEnabled: boolean;
  languages: string[];
  contestsEnabled: boolean;
  contests: number[];
}
export type SyncHistoryStatus = 'uploaded' | 'updated' | 'skipped' | 'failed';
export interface SyncHistoryEntry {
  id: string;
  repositoryFullName: string;
  problemKey: string;
  problemName: string;
  contestId: number;
  problemIndex: string;
  rating?: number;
  tags: string[];
  programmingLanguage: string;
  submissionId: number;
  submittedAt?: number;
  status: SyncHistoryStatus;
  recordedAt: number;
  filePath?: string;
  reason?: string;
  legacy?: boolean;
}
export interface AuthState { accessToken: string; refreshToken?: string; expiresAt?: number; refreshTokenExpiresAt?: number; login: string; installationId?: number; }
export interface CodeforcesCredentials { apiKey: string; apiSecret: string; }
export interface VaultStatus { exists: boolean; unlocked: boolean; }
export type SyncPhase = 'idle' | 'historical' | 'incremental' | 'paused' | 'error';
export interface SyncedFile { submissionId: number; path: string; sha?: string; metadataPath?: string; metadataSha?: string; }
export interface SyncState {
  phase: SyncPhase;
  nextFrom: number;
  submissionsSeen: number;
  acceptedSeen: number;
  uniqueProblems: number;
  filesUploaded: number;
  lastSubmissionId: number;
  historicalHighWaterId?: number;
  repositoryFullName?: string;
  scanCutoff?: number;
  done: boolean;
  needsReimport?: boolean;
  startedAt?: number;
  lastRunAt?: number;
  error?: string;
  failed: Record<string, string>;
  synced: Record<string, SyncedFile>;
  pendingWrite?: { problemKey: string; submissionId: number; path: string; contentSha: string; expectedSha?: string; expectedAbsent: boolean; metadataPath?: string; metadataContentSha?: string; metadataExpectedSha?: string; metadataExpectedAbsent?: boolean };
  retiredFiles: Record<string, string>;
}
export interface Settings {
  codeforcesHandle?: string;
  codeforcesSourceAccess?: 'unconfirmed' | 'confirmed';
  githubLogin?: string;
  repository?: RepositoryRef;
  autoSync: boolean;
  syncMinutes: number;
  syncFilters: SyncFilters;
  consentAcceptedAt?: number;
  jobGeneration: number;
  sync: SyncState;
}
export const DEFAULT_SYNC: SyncState = { phase: 'idle', nextFrom: 1, submissionsSeen: 0, acceptedSeen: 0, uniqueProblems: 0, filesUploaded: 0, lastSubmissionId: 0, historicalHighWaterId: undefined, done: false, failed: {}, synced: {}, retiredFiles: {} };
export const DEFAULT_SYNC_FILTERS: SyncFilters = { dateEnabled: false, ratingEnabled: false, tagsEnabled: false, tags: [], languagesEnabled: false, languages: [], contestsEnabled: false, contests: [] };
export const DEFAULT_SETTINGS: Settings = { autoSync: true, syncMinutes: 360, jobGeneration: 0, sync: DEFAULT_SYNC, syncFilters: DEFAULT_SYNC_FILTERS };
