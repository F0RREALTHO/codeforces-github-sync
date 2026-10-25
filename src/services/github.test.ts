import { describe, expect, it, vi } from 'vitest';
import type { AuthState, RepositoryRef } from '../domain/types';
import { FileOwnershipError, GithubClient, githubBlobSha } from './github';

const auth: AuthState = { accessToken: 'token-never-log', login: 'test-user' };
const repo: RepositoryRef = { owner: 'test-user', name: 'solutions', fullName: 'test-user/solutions', private: true, defaultBranch: 'main' };

describe('GitHub Contents API', () => {
  it('creates missing files and includes the branch and commit message', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ content: { path: 'Codeforces/1/A.cpp' } }), { status: 201 });
      return new Response('', { status: 404 });
    });
    await new GithubClient(auth, fetcher as typeof fetch).putFile(repo, 'Codeforces/1/A.cpp', 'int main() {}', 'Add A');
    const put = fetcher.mock.calls[1][1];
    expect(put?.method).toBe('PUT');
    expect(JSON.parse(String(put?.body))).toMatchObject({ message: 'Add A', branch: 'main' });
    expect(fetcher.mock.calls[1][0]).toContain('Codeforces/1/A.cpp');
  });
  it('does not create a commit when the remote file content is already identical', async () => {
    const content = 'unchanged';
    const sha = await githubBlobSha(content);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sha, content: btoa(content), encoding: 'base64' }), { status: 200 }));
    await new GithubClient(auth, fetcher as typeof fetch).putFile(repo, 'same.cpp', content, 'No-op', sha);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('replaces an existing file with its SHA for update', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'PUT'
      ? new Response('{}', { status: 200 })
      : new Response(JSON.stringify({ sha: 'existing-sha', content: btoa('old'), encoding: 'base64' }), { status: 200 }));
    await new GithubClient(auth, fetcher as typeof fetch).putFile(repo, 'same.cpp', 'new', 'Update', 'existing-sha');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).sha).toBe('existing-sha');
  });
  it('waits and retries a GitHub API rate-limit response', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async () => {
      attempts += 1;
      return attempts === 1 ? new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }) : new Response('{}', { status: 200 });
    });
    await new GithubClient(auth, fetcher as typeof fetch).me();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not treat a failed GitHub write as committed', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'PUT'
      ? new Response(JSON.stringify({ message: 'server error' }), { status: 500 })
      : new Response('', { status: 404 }));
    await expect(new GithubClient(auth, fetcher as typeof fetch).putFile(repo, 'new.cpp', 'source', 'Add')).rejects.toThrow('HTTP 500');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(3);
  });

  it('runs the cancellation guard immediately before each GitHub mutation', async () => {
    const guard = vi.fn(async () => { throw new Error('cancelled'); });
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    await expect(new GithubClient(auth, fetcher as typeof fetch, guard).putFile(repo, 'owned.cpp', 'new', 'Update')).rejects.toThrow('cancelled');
    expect(fetcher).toHaveBeenCalledTimes(1); // read attempt only; no PUT
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite an existing file without a matching ownership fingerprint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sha: 'someone-elses-sha', content: btoa('manual'), encoding: 'base64' }), { status: 200 }));
    await expect(new GithubClient(auth, fetcher as typeof fetch).putFile(repo, 'manual.cpp', 'extension', 'Update')).rejects.toBeInstanceOf(FileOwnershipError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not treat a GitHub SHA matching desired content as ownership without a durable local SHA record', async () => {
    const content = 'content already present remotely';
    const sha = await githubBlobSha(content);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sha, content: btoa(content), encoding: 'base64' }), { status: 200 }));
    await expect(new GithubClient(auth, fetcher as typeof fetch).putFile(repo, 'untracked.cpp', content, 'Update')).rejects.toBeInstanceOf(FileOwnershipError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('verifies unchanged tracked content only when the current GitHub SHA matches the saved ownership SHA', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sha: 'recorded-sha', content: 'irrelevant', encoding: 'base64' }), { status: 200 }));
    await new GithubClient(auth, fetcher as typeof fetch).verifyOwnedFile(repo, 'tracked.cpp', 'recorded-sha');
    await expect(new GithubClient(auth, fetcher as typeof fetch).verifyOwnedFile(repo, 'tracked.cpp', 'other-sha')).rejects.toBeInstanceOf(FileOwnershipError);
  });

  it('refuses to verify a tracked file from a legacy manifest that has no recorded SHA', async () => {
    const fetcher = vi.fn();
    await expect(new GithubClient(auth, fetcher as typeof fetch).verifyOwnedFile(repo, 'legacy.cpp')).rejects.toBeInstanceOf(FileOwnershipError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows a pending write replay only when the remote blob matches the prepared content', async () => {
    const content = 'prepared content';
    const sha = await githubBlobSha(content);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sha, content: btoa(content), encoding: 'base64' }), { status: 200 }));
    const plan = await new GithubClient(auth, fetcher as typeof fetch).prepareFileWrite(repo, 'pending.cpp', content, { targetExpectedAbsent: true, allowPendingContentSha: sha });
    expect(plan.noop).toBe(true);
    expect(plan.sha).toBe(sha);
  });
});
