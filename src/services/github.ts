import type { AuthState, RepositoryRef } from '../domain/types';
import { ApiError, requestJson } from './codeforces';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
export interface GithubRepository extends RepositoryRef { id: number; }
interface GithubFile { sha: string; content: string; encoding: string; }
export interface FileWriteExpectation { ownedSha?: string; allowPendingContentSha?: string; targetExpectedAbsent: boolean; }
export interface FileWritePlan { repo: RepositoryRef; path: string; content: string; sha?: string; contentSha: string; noop: boolean; }
export class FileOwnershipError extends Error { constructor(message: string) { super(message); this.name = 'FileOwnershipError'; } }

export class GithubClient {
  constructor(auth: AuthState, private readonly fetcher: typeof fetch = fetch, private readonly beforeWrite: () => Promise<void> = async () => undefined, private readonly authProvider: () => Promise<AuthState> = async () => auth) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const activeAuth = await this.authProvider();
        const headers = new Headers(init.headers);
        headers.set('Accept', 'application/vnd.github+json');
        headers.set('Authorization', `Bearer ${activeAuth.accessToken}`);
        headers.set('X-GitHub-Api-Version', API_VERSION);
        if (init.body) headers.set('Content-Type', 'application/json');
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes((init.method || 'GET').toUpperCase())) await this.beforeWrite();
        return await requestJson<T>(`${API}${path}`, { ...init, headers }, this.fetcher);
      }
      catch (error) {
        if (error instanceof ApiError && (error.status === 429 || error.status === 403 && error.message.includes('rate limit') || error.status !== 401 && (error.status === undefined || error.status >= 500)) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, error.retryAfterMs || 500 * (2 ** attempt))));
          continue;
        }
        if (error instanceof ApiError && error.status === 403 && !error.message.includes('rate limit')) throw new ApiError('GitHub denied access. Check that the app is installed for this repository and has the required permission.', 403, error.retryAfterMs);
        throw error;
      }
    }
    throw new ApiError('GitHub request failed after retrying.');
  }
  async me(): Promise<{ login: string }> { return this.request('/user'); }
  async verifyInstallation(installationId: number): Promise<void> {
    await this.request(`/user/installations/${installationId}/repositories?per_page=1`);
  }
  async repositories(): Promise<GithubRepository[]> {
    const repos: Array<{ id: number; name: string; full_name: string; private: boolean; default_branch: string; owner: { login: string } }> = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.request<typeof repos>(`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    return repos.map((r) => ({ id: r.id, owner: r.owner.login, name: r.name, fullName: r.full_name, private: r.private, defaultBranch: r.default_branch }));
  }
  async createRepository(name: string, isPrivate: boolean): Promise<RepositoryRef> {
    const r = await this.request<{ name: string; full_name: string; private: boolean; default_branch: string; owner: { login: string } }>('/user/repos', { method: 'POST', body: JSON.stringify({ name, private: isPrivate, description: 'Accepted Codeforces solutions synced by Codeforces → GitHub Sync', auto_init: true }) });
    return { owner: r.owner.login, name: r.name, fullName: r.full_name, private: r.private, defaultBranch: r.default_branch };
  }
  async prepareFileWrite(repo: RepositoryRef, path: string, content: string, expectation: FileWriteExpectation): Promise<FileWritePlan> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const contentSha = await githubBlobSha(content);
    let existing: GithubFile | undefined;
    try {
      existing = await this.request<GithubFile>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${encodedPath}?ref=${encodeURIComponent(repo.defaultBranch)}`);
    } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    if (!existing) {
      if (expectation.ownedSha || !expectation.targetExpectedAbsent) throw new FileOwnershipError(`Tracked destination file disappeared: ${path}. Resolve the repository conflict, then retry.`);
      return { repo, path, content, contentSha, noop: false };
    }
    if (expectation.allowPendingContentSha === contentSha && existing.sha === contentSha) return { repo, path, content, sha: existing.sha, contentSha, noop: true };
    if (!expectation.ownedSha || existing.sha !== expectation.ownedSha) {
      throw new FileOwnershipError(`Destination path is occupied by an unowned or changed file: ${path}. Move or rename that file, then retry.`);
    }
    return { repo, path, content, sha: existing.sha, contentSha, noop: existing.sha === contentSha };
  }

  async verifyOwnedFile(repo: RepositoryRef, path: string, recordedSha?: string): Promise<void> {
    if (!recordedSha) throw new FileOwnershipError(`Cannot verify ownership of ${path}: this installation has no recorded GitHub SHA. Resolve the file manually or re-import with a verifiable ownership record.`);
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    let current: GithubFile;
    try {
      current = await this.request<GithubFile>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${encodedPath}?ref=${encodeURIComponent(repo.defaultBranch)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw new FileOwnershipError(`Tracked file is missing from GitHub: ${path}. Resolve the repository conflict, then retry.`);
      throw error;
    }
    if (current.sha !== recordedSha) throw new FileOwnershipError(`Tracked file was changed outside the extension: ${path}. Keep or resolve it manually, then retry.`);
  }

  async commitFileWrite(plan: FileWritePlan, message: string): Promise<string> {
    if (plan.noop) return plan.sha || plan.contentSha;
    const { repo, path } = plan;
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const body: Record<string, string> = { message, content: encodeBase64(plan.content), branch: repo.defaultBranch };
    if (plan.sha) body.sha = plan.sha;
    const result = await this.request<{ content?: { sha?: string } }>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${encodedPath}`, { method: 'PUT', body: JSON.stringify(body) });
    return result.content?.sha || plan.contentSha;
  }

  async putFile(repo: RepositoryRef, path: string, content: string, message: string, expectedSha?: string): Promise<string> {
    const plan = await this.prepareFileWrite(repo, path, content, { ownedSha: expectedSha, targetExpectedAbsent: expectedSha === undefined });
    return this.commitFileWrite(plan, message);
  }

  async deleteFile(repo: RepositoryRef, path: string, message: string, expectedSha?: string): Promise<void> {
    if (!expectedSha) throw new FileOwnershipError(`Cannot delete ${path}: ownership could not be verified.`);
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    try {
      const file = await this.request<GithubFile>(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${encodedPath}?ref=${encodeURIComponent(repo.defaultBranch)}`);
      if (file.sha !== expectedSha) throw new FileOwnershipError(`Tracked destination file was changed outside the extension: ${path}. Keep or resolve it manually, then retry.`);
      await this.request(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${encodedPath}`, { method: 'DELETE', body: JSON.stringify({ message, sha: file.sha, branch: repo.defaultBranch }) });
    } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
  }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export async function githubBlobSha(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const blob = new Uint8Array(header.length + bytes.length);
  blob.set(header); blob.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', blob);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
