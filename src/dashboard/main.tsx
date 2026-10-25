import { browserApi } from '../platform/browser';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SYNC_FILTERS, type Settings, type SyncFilters, type SyncHistoryEntry, type SyncHistoryStatus, type VaultStatus } from '../domain/types';
import type { HistoryPage, HistoryStats } from '../storage/history';
import './styles.css';

type DashboardState = Settings & { vault: VaultStatus };
type QueryDraft = { search: string; status: SyncHistoryStatus | 'all'; language: string; fromDate: string; toDate: string };
type Message = Record<string, unknown> & { type: string };
async function send<T>(message: Message): Promise<T> {
  const response = await browserApi().runtime.sendMessage(message) as { ok: boolean; value?: T; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'The extension background worker did not respond.');
  return response.value as T;
}

function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [repositories, setRepositories] = useState<string[]>([]);
  const [repository, setRepository] = useState('');
  const [filters, setFilters] = useState<SyncFilters>(DEFAULT_SYNC_FILTERS);
  const [draft, setDraft] = useState<QueryDraft>({ search: '', status: 'all', language: '', fromDate: '', toDate: '' });
  const [query, setQuery] = useState<QueryDraft>({ search: '', status: 'all', language: '', fromDate: '', toDate: '' });
  const [pageNo, setPageNo] = useState(1);
  const [page, setPage] = useState<HistoryPage>({ entries: [], page: 1, pageSize: 50, total: 0 });
  const [stats, setStats] = useState<HistoryStats>({ uploadedProblems: 0, updatedProblems: 0, skippedProblems: 0, failedOperations: 0 });
  const [busy, setBusy] = useState(false);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async (targetPage = pageNo, targetRepo = repository, targetQuery = query) => {
    setBusy(true); setError('');
    try {
      const current = await send<DashboardState>({ type: 'state' });
      const selectedRepo = targetRepo || current.repository?.fullName || 'all';
      const [repoList, historyPage, historyStats] = await Promise.all([
        send<string[]>({ type: 'historyRepositories' }),
        send<HistoryPage>({ type: 'historyPage', query: { repositoryFullName: selectedRepo, page: targetPage, pageSize: 50, ...targetQuery } }),
        send<HistoryStats>({ type: 'historyStats', repositoryFullName: selectedRepo }),
      ]);
      setState(current); setRepositories(repoList); if (!filtersLoaded) { setFilters(current.syncFilters || DEFAULT_SYNC_FILTERS); setFiltersLoaded(true); } setRepository((previous) => previous || selectedRepo); setPage(historyPage); setStats(historyStats);
    } catch (e) { setError(text(e)); }
    finally { setBusy(false); }
  }, [pageNo, query, repository]);

  useEffect(() => { void refresh(pageNo, repository, query); }, [pageNo, repository, query]);

  const applySearch = () => { setPageNo(1); setQuery({ ...draft }); };
  const edit = <K extends keyof SyncFilters>(key: K, value: SyncFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const saveFilters = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await send<Settings>({ type: 'saveFilters', filters });
      setNotice('Sync filters saved. Existing synchronized files were retained.');
      await refresh(1, repository, query);
    } catch (e) { setError(text(e)); }
    finally { setBusy(false); }
  };
  const retryFailures = async () => {
    if (!window.confirm('Retrying failed operations rescans the historical snapshot. Existing files are checked against the ownership manifest; unrelated files are not overwritten or deleted. Continue?')) return;
    setBusy(true); setError(''); setNotice('');
    try { await send<Settings>({ type: 'retryFailures' }); setNotice('Failed operations were queued for a safe historical retry.'); await refresh(1, repository, query); }
    catch (e) { setError(text(e)); }
    finally { setBusy(false); }
  };
  const pageCount = Math.max(1, Math.ceil(page.total / page.pageSize));
  const languages = filters.languages;
  const latestSuccessfulAt = stats.latestSuccessfulAt || 0;

  return <main className="dashboard">
    <header className="dash-header">
      <a className="brand" href="index.html"><span className="brand-mark">CF</span><span><small>CODEFORCES → GITHUB</small><strong>Sync history</strong></span></a>
      <div className="header-actions"><button className="button secondary" disabled={busy} onClick={() => void refresh()}>Refresh</button><a href="index.html" className="button secondary">Open sync controls</a></div>
    </header>
    {error && <div className="banner danger" role="alert">{error}</div>}
    {notice && <div className="banner success" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    {!state ? <div className="panel">Loading sync history…</div> : <>
      {state.sync.needsReimport && <div className="banner warning">Sync filters changed. Start a historical re-import from the popup to apply them to existing submissions. Existing GitHub files will be retained.</div>}
      <section className="stats-grid" aria-label="Sync overview">
        <Stat label="Uploaded problems" value={repository === 'all' ? stats.uploadedProblems : Math.max(stats.uploadedProblems, state.repository?.fullName === repository ? state.sync.uniqueProblems : 0)} />
        <Stat label="Updated problems" value={stats.updatedProblems} />
        <Stat label="Skipped problems" value={stats.skippedProblems} />
        <Stat label="Failed operations" value={stats.failedOperations} />
        <Stat label="Latest successful sync" value={latestSuccessfulAt ? new Date(latestSuccessfulAt).toLocaleString() : '—'} compact />
      </section>

      <section className="panel filters-panel">
        <div className="panel-heading"><div><p className="eyebrow">SELECTIVE SYNCHRONIZATION</p><h2>Sync filters</h2></div><button className="button primary" disabled={busy} onClick={() => void saveFilters()}>Save filters</button></div>
        <p className="muted">All filters start disabled. When a filter is enabled, the newest Accepted submission for a problem must satisfy every enabled filter. Excluded submissions are recorded as skipped; their existing files are not removed.</p>
        <div className="filter-grid">
          <fieldset className="filter-card"><legend><label><input type="checkbox" checked={filters.dateEnabled} onChange={(e) => edit('dateEnabled', e.target.checked)} /> Submission date</label></legend><div className="two-fields"><label>From (UTC)<input type="date" value={filters.dateFrom || ''} onChange={(e) => edit('dateFrom', e.target.value || undefined)} /></label><label>Through (UTC)<input type="date" value={filters.dateTo || ''} onChange={(e) => edit('dateTo', e.target.value || undefined)} /></label></div></fieldset>
          <fieldset className="filter-card"><legend><label><input type="checkbox" checked={filters.ratingEnabled} onChange={(e) => edit('ratingEnabled', e.target.checked)} /> Problem rating</label></legend><div className="two-fields"><label>Minimum<input type="number" min="0" max="5000" value={filters.ratingMin ?? ''} onChange={(e) => edit('ratingMin', e.target.value === '' ? undefined : Number(e.target.value))} /></label><label>Maximum<input type="number" min="0" max="5000" value={filters.ratingMax ?? ''} onChange={(e) => edit('ratingMax', e.target.value === '' ? undefined : Number(e.target.value))} /></label></div></fieldset>
          <fieldset className="filter-card"><legend><label><input type="checkbox" checked={filters.tagsEnabled} onChange={(e) => edit('tagsEnabled', e.target.checked)} /> Codeforces tags</label></legend><label>Match any comma-separated tag<input value={filters.tags.join(', ')} onChange={(e) => edit('tags', splitList(e.target.value))} placeholder="dp, graphs, math" /></label></fieldset>
          <fieldset className="filter-card"><legend><label><input type="checkbox" checked={filters.languagesEnabled} onChange={(e) => edit('languagesEnabled', e.target.checked)} /> Programming languages</label></legend><label>Exact language names, comma-separated<input value={languages.join(', ')} onChange={(e) => edit('languages', splitList(e.target.value))} placeholder="GNU C++20, Python 3" /></label></fieldset>
          <fieldset className="filter-card"><legend><label><input type="checkbox" checked={filters.contestsEnabled} onChange={(e) => edit('contestsEnabled', e.target.checked)} /> Contest IDs</label></legend><label>Comma-separated IDs<input inputMode="numeric" value={filters.contests.join(', ')} onChange={(e) => edit('contests', splitList(e.target.value).map(Number).filter(Number.isSafeInteger))} placeholder="1613, 1900" /></label></fieldset>
        </div>
        {state.sync.failed && Object.keys(state.sync.failed).length > 0 && <div className="filter-actions"><p className="muted">Retry uses the existing historical replay and ownership checks.</p><button className="button secondary" disabled={busy || state.sync.phase === 'historical' || state.sync.phase === 'incremental'} onClick={() => void retryFailures()}>Retry failed operations</button></div>}
      </section>

      <section className="panel history-panel">
        <div className="panel-heading"><div><p className="eyebrow">PERSISTENT ACTIVITY</p><h2>Submission history</h2></div><label className="repo-filter">Repository<select value={repository} onChange={(e) => { setRepository(e.target.value); setPageNo(1); }}><option value="all">All repositories</option>{repositories.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
        <div className="query-grid">
          <label className="search-field">Problem or contest<input value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && applySearch()} placeholder="Name or contest ID" /></label>
          <label>Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as QueryDraft['status'] })}><option value="all">All statuses</option><option value="uploaded">Uploaded</option><option value="updated">Updated</option><option value="skipped">Skipped</option><option value="failed">Failed</option></select></label>
          <label>Language<input value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} placeholder="Exact language" /></label>
          <label>From<input type="date" value={draft.fromDate} onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })} /></label>
          <label>To<input type="date" value={draft.toDate} onChange={(e) => setDraft({ ...draft, toDate: e.target.value })} /></label>
          <button className="button secondary apply-button" disabled={busy} onClick={applySearch}>Apply filters</button>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Problem</th><th>Language</th><th>Submission</th><th>Status</th><th>Submitted</th><th>Repository · file path</th><th>Details</th></tr></thead><tbody>
          {page.entries.map((entry) => <HistoryRow key={entry.id} entry={entry} />)}
          {!page.entries.length && <tr><td colSpan={7} className="empty">{busy ? 'Loading…' : 'No history rows match this view. On a v0.1 profile, re-import history once to backfill detailed entries for existing synchronized files.'}</td></tr>}
        </tbody></table></div>
        <div className="pagination"><span>{page.total.toLocaleString()} entries · page {pageNo} of {pageCount}</span><div><button className="button secondary" disabled={busy || pageNo <= 1} onClick={() => setPageNo((p) => Math.max(1, p - 1))}>Previous</button><button className="button secondary" disabled={busy || pageNo >= pageCount} onClick={() => setPageNo((p) => Math.min(pageCount, p + 1))}>Next</button></div></div>
      </section>
    </>}
    <footer className="dash-footer">Sync history stores submission metadata and outcomes only. Source code and credentials are not copied into the history database.</footer>
  </main>;
}

function Stat({ label, value, compact = false }: { label: string; value: number | string; compact?: boolean }) { return <article className={`stat-card ${compact ? 'compact' : ''}`}><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString() : value}</strong></article>; }
function HistoryRow({ entry }: { entry: SyncHistoryEntry }) {
  return <tr><td><strong>{entry.problemName}</strong><small>{entry.contestId}-{entry.problemIndex}</small></td><td>{entry.programmingLanguage}</td><td><a href={`https://codeforces.com/contest/${entry.contestId}/submission/${entry.submissionId}`} target="_blank" rel="noreferrer">{entry.submissionId}</a></td><td><span className={`status ${entry.status}`}>{entry.status}</span>{entry.legacy && <small>v0.1 manifest</small>}</td><td>{entry.submittedAt === undefined ? 'Unknown (v0.1)' : new Date(entry.submittedAt).toLocaleString()}</td><td><strong>{entry.repositoryFullName}</strong><small>{entry.filePath || '—'}</small></td><td className={entry.status === 'failed' || entry.status === 'skipped' || entry.legacy ? 'detail' : 'muted'}>{entry.reason || '—'}</td></tr>;
}
function splitList(value: string): string[] { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
function text(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Try again.'; }

createRoot(document.getElementById('root')!).render(<Dashboard />);
