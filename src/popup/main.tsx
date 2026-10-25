import { browserApi } from '../platform/browser';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Settings, VaultStatus } from '../domain/types';
import type { GithubRepository } from '../services/github';
import './styles.css';

const authApi = import.meta.env.VITE_AUTH_API_BASE_URL as string | undefined;
const githubAppClientId = import.meta.env.VITE_GITHUB_APP_CLIENT_ID as string | undefined;
const githubAppSlug = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined;
type UiSettings = Settings & { vault: VaultStatus };

type Message = Record<string, unknown> & { type: string };
async function send<T>(message: Message): Promise<T> {
  const response = await browserApi().runtime.sendMessage(message) as { ok: boolean; value?: T; error?: string };
  if (!response?.ok) throw new Error(response?.error || 'The extension background worker did not respond.');
  return response.value as T;
}

function App() {
  const [settings, setSettings] = useState<UiSettings | null>(null);
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [cfApiKey, setCfApiKey] = useState('');
  const [cfApiSecret, setCfApiSecret] = useState('');
  const [cfConnectOpen, setCfConnectOpen] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [newRepo, setNewRepo] = useState('competitive-programming');
  const [privateRepo, setPrivateRepo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => { try { setSettings(await send<UiSettings>({ type: 'state' })); } catch (e) { setError(message(e)); } };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1200); return () => window.clearInterval(timer); }, []);
  const action = async <T,>(label: string, message: Message, done?: (value: T) => void) => {
    setBusy(true); setError(''); setNotice('');
    try { const value = await send<T>(message); done?.(value); await refresh(); setNotice(label); }
    catch (e) { setError(messageText(e)); }
    finally { setBusy(false); }
  };
  const loadRepositories = async () => {
    setRepoPickerOpen(true);
    setBusy(true); setError('');
    try { setRepositories(await send<GithubRepository[]>({ type: 'repositories' })); }
    catch (e) { setError(messageText(e)); }
    finally { setBusy(false); }
  };
  const connectGithub = async () => {
    if (!githubAppClientId || !githubAppSlug || !authApi) { setError('GitHub sign-in is not configured in this build. It needs the GitHub App Client ID, App slug, and authentication Worker URL.'); return; }
    try {
      const origin = new URL(authApi).origin;
      const granted = await browserApi().permissions.request({ origins: [`${origin}/*`] });
      if (!granted) { setError('Permission for the sign-in service is required to connect GitHub.'); return; }
      await action('GitHub connected.', { type: 'connectGithub' });
    } catch (e) { setError(messageText(e)); }
  };
  if (!settings) return <main className="app"><p className="muted">Loading your sync settings…</p>{error && <section className="notice-card" role="alert"><p className="inline-error">{error}</p><button className="outline" onClick={() => { setError(''); void refresh(); }}>Retry loading settings</button></section>}</main>;
  const connected = Boolean(settings.codeforcesHandle && settings.githubLogin && settings.repository);
  const sync = settings.sync;
  const isRunning = sync.phase === 'historical' || sync.phase === 'incremental';

  return <main className="app">
    <header className="top"><div className="brand-mark">CF</div><div><p className="eyebrow">DEVELOPER TOOL</p><h1>Solution sync</h1></div><span className={`status-dot ${isRunning ? 'live' : ''}`} title={isRunning ? 'Sync running' : 'Ready'} /></header>
    {!settings.consentAcceptedAt && <section className="notice-card">
      <p className="eyebrow">BEFORE YOU CONNECT</p><h2>Your code stays yours.</h2>
      <p>This extension reads your Codeforces submissions and sends Accepted solution files and problem metadata directly to the GitHub repository you choose. Your Codeforces API key and secret and GitHub tokens are encrypted in a local vault. The Codeforces secret is used only to sign requests and is never sent. No analytics or unrelated server receives your source code.</p>
      <label className="checkline"><input type="checkbox" id="consent" /> I understand what data this extension accesses and where it goes.</label>
      <button className="primary" onClick={() => { if (!(document.getElementById('consent') as HTMLInputElement).checked) { setError('Please check the consent box to continue.'); return; } void action('Data use notice accepted.', { type: 'consent' }); }}>Continue</button>
      <a className="privacy-link" href="privacy.html" target="_blank">Privacy details</a>
    </section>}

    {settings.consentAcceptedAt && !settings.vault.unlocked && <section className="vault-card">
      <p className="eyebrow">LOCAL CREDENTIAL VAULT</p><h2>{settings.vault.exists ? 'Unlock to continue' : 'Protect your account keys'}</h2>
      <p className="helper">{settings.vault.exists ? 'Enter your vault password to unlock encrypted Codeforces and GitHub credentials for this Chrome session.' : 'Choose a password of at least 12 characters. Your Codeforces API secret and GitHub tokens are encrypted with AES-256-GCM and remain on this device.'}</p>
      <input aria-label="Vault password" type="password" autoComplete="current-password" placeholder={settings.vault.exists ? 'Vault password' : 'Create vault password'} value={vaultPassphrase} onChange={(e) => setVaultPassphrase(e.target.value)} />
      {!settings.vault.exists && <input aria-label="Confirm vault password" type="password" autoComplete="new-password" placeholder="Confirm vault password" id="vault-confirm" />}
      <div className="cf-form-footer"><span className="muted">Password is never stored or sent.</span><button className="primary" disabled={busy || vaultPassphrase.length < 12} onClick={() => { const confirmation = document.getElementById('vault-confirm') as HTMLInputElement | null; if (!settings.vault.exists && confirmation?.value !== vaultPassphrase) { setError('Vault passwords do not match.'); return; } void action('Credential vault unlocked.', { type: 'vaultUnlock', passphrase: vaultPassphrase }, () => setVaultPassphrase('')); }}> {settings.vault.exists ? 'Unlock vault' : 'Create vault'}</button></div>
      {settings.vault.exists && <button className="quiet" onClick={() => void action('Vault reset. Reconnect your accounts.', { type: 'vaultReset' })}>Forget vault and reconnect</button>}
    </section>}

    {settings.consentAcceptedAt && settings.vault.unlocked && <>
      <section className="accounts">
        <div className="section-title"><span>ACCOUNTS</span><span className="muted">{[settings.codeforcesHandle, settings.githubLogin].filter(Boolean).length}/2 connected</span></div>
        <div className="account-row"><div className="service-icon cf-icon">CF</div><div className="account-copy"><strong>Codeforces</strong><small>{settings.codeforcesHandle ? `${settings.codeforcesHandle} · ${settings.codeforcesSourceAccess === 'confirmed' ? 'source access confirmed' : 'API credentials accepted; source access unconfirmed'}` : 'Connect with API credentials'}</small></div>
          {settings.codeforcesHandle ? <button className="quiet" onClick={() => void action('Codeforces disconnected.', { type: 'disconnect', provider: 'codeforces' })}>Disconnect</button> : <button className="small-button" disabled={busy} onClick={() => setCfConnectOpen((open) => { if (open) setCfApiSecret(''); return !open; })}>{cfConnectOpen ? 'Close' : 'Connect'}</button>}
        </div>
        <div className="account-row"><div className="service-icon gh-icon">⌘</div><div className="account-copy"><strong>GitHub</strong><small>{settings.githubLogin || 'Connect with GitHub'}</small></div>{settings.githubLogin ? <button className="quiet" onClick={() => void action('GitHub disconnected.', { type: 'disconnect', provider: 'github' })}>Disconnect</button> : <button className="small-button" disabled={busy} onClick={() => void connectGithub()}>Install &amp; connect</button>}</div>
      </section>

      {!settings.codeforcesHandle && cfConnectOpen && <section className="cf-form"><p className="eyebrow">CODEFORCES API ACCESS</p><p className="helper">Source retrieval requires an API key and secret from your own Codeforces account. Credentials are stored encrypted in the local vault; the secret is used only to sign Codeforces requests.</p><input aria-label="Codeforces handle" placeholder="Codeforces handle" value={handle} onChange={(e) => setHandle(e.target.value)} /><input aria-label="Codeforces API key" placeholder="API key" autoComplete="off" value={cfApiKey} onChange={(e) => setCfApiKey(e.target.value)} /><input aria-label="Codeforces API secret" placeholder="API secret" type="password" autoComplete="new-password" value={cfApiSecret} onChange={(e) => setCfApiSecret(e.target.value)} /><div className="cf-form-footer"><a href="https://codeforces.com/settings/api" target="_blank">Create API key on Codeforces ↗</a><button className="small-button" disabled={busy || !handle.trim() || !cfApiKey.trim() || !cfApiSecret.trim()} onClick={() => void action<Settings>('Codeforces connected.', { type: 'connectCodeforces', handle, apiKey: cfApiKey, apiSecret: cfApiSecret }, () => { setCfApiSecret(''); setCfApiKey(''); setCfConnectOpen(false); })}>Verify &amp; connect</button></div></section>}

      {settings.githubLogin && <section className="repo-card">
        <div className="section-title"><span>DESTINATION</span>{settings.repository && <span className="badge">{settings.repository.private ? 'PRIVATE' : 'PUBLIC'}</span>}</div>
        {settings.repository && !repoPickerOpen ? <div className="repo-selected"><div className="repo-icon">↗</div><div><strong>{settings.repository.fullName}</strong><small>Codeforces/{settings.repository.defaultBranch}</small></div><button className="quiet" disabled={busy} onClick={() => void loadRepositories()}>Change</button></div>
          : <><p className="helper">Choose where accepted solutions will be backed up. Changing the repository resets its sync checkpoints.</p><button className="outline full" disabled={busy} onClick={() => void loadRepositories()}>{repositories.length ? 'Refresh repositories' : 'Select existing repository'}</button><div className="create-row"><input aria-label="New repository name" value={newRepo} onChange={(e) => setNewRepo(e.target.value)} /><button className="small-button" disabled={busy || !newRepo.trim()} onClick={() => void action('Repository created.', { type: 'createRepository', name: newRepo, isPrivate: privateRepo }, () => setRepoPickerOpen(false))}>Create</button></div><label className="checkline compact"><input type="checkbox" checked={privateRepo} onChange={(e) => setPrivateRepo(e.target.checked)} /> Make repository private</label>
            {repositories.length > 0 && <div className="repo-list" role="listbox" aria-label="Repositories">{repositories.map((repo) => <button key={repo.id} className="repo-option" onClick={() => void action('Repository selected.', { type: 'selectRepository', repository: repo }, () => setRepoPickerOpen(false))}><span>{repo.fullName}</span><span className="muted">{repo.private ? 'Private' : 'Public'}</span></button>)}</div>}
            {settings.repository && <button className="quiet" disabled={busy} onClick={() => setRepoPickerOpen(false)}>Cancel</button>}
          </>}
      </section>}

      {connected && <>
        <section className="stats"><div><strong>{sync.acceptedSeen.toLocaleString()}</strong><small>Accepted seen</small></div><div><strong>{sync.uniqueProblems.toLocaleString()}</strong><small>Problems synced</small></div></section>
        <section className="sync-card">
          <div className="sync-head"><div><p className="eyebrow">{sync.done ? 'AUTOMATIC SYNC' : 'INITIAL IMPORT'}</p><h2>{sync.phase === 'historical' ? 'Import in progress' : sync.phase === 'incremental' ? 'Checking submissions' : sync.phase === 'paused' ? 'Import paused' : sync.phase === 'error' ? 'Needs attention' : sync.done ? 'All caught up' : 'Ready to import'}</h2></div><span className={`status-pill ${isRunning ? 'running' : sync.phase === 'error' ? 'failed' : ''}`}>{isRunning ? 'SYNCING' : sync.phase.toUpperCase()}</span></div>
          <div className={`progress-track ${isRunning ? 'indeterminate' : ''}`}><span style={{ width: sync.done ? '100%' : sync.submissionsSeen ? '8%' : '0%' }} /></div>
          <p className="progress-copy">{sync.needsReimport ? 'Filters changed. Re-import history to apply them to existing submissions; synchronized files will be retained.' : sync.done ? `${sync.uniqueProblems} problems in ${settings.repository?.fullName}` : `${sync.submissionsSeen.toLocaleString()} submissions discovered · ${sync.failed ? Object.keys(sync.failed).length : 0} items need review`}</p>
          {sync.error && <p className="inline-error">{sync.error}</p>}
          {Object.keys(sync.failed).length > 0 && <p className="inline-error">{Object.keys(sync.failed).length} operation(s) need review. Open sync history for details.</p>}
          <div className="button-row">{sync.needsReimport ? <button className="primary" disabled={busy || isRunning} onClick={() => void action('Re-import with updated filters started.', { type: 'startImport' })}>Re-import with updated filters</button> : !sync.done && sync.phase !== 'paused' ? <button className="primary" disabled={busy || isRunning} onClick={() => void action('Import finished.', { type: 'startImport' })}>{isRunning ? 'Syncing…' : sync.submissionsSeen ? 'Resume import' : 'Start historical import'}</button> : sync.phase === 'paused' ? <button className="primary" disabled={busy} onClick={() => void action('Import resumed.', { type: 'resume' })}>Resume import</button> : <button className="primary" disabled={busy || isRunning} onClick={() => void action('Sync complete.', { type: 'syncNow' })}>Sync now</button>}{sync.done && !sync.needsReimport && <button className="outline" disabled={busy || isRunning} onClick={() => void action('Historical import reconciled.', { type: 'startImport' })}>Re-import history</button>}{isRunning && <button className="outline" disabled={busy} onClick={() => void action('Import paused.', { type: 'pause' })}>Pause</button>}{Object.keys(sync.failed).length > 0 && <button className="outline" disabled={busy || isRunning} onClick={() => void action('Failed items retried.', { type: 'retryFailures' })}>Retry failed</button>}</div>
          <a className="dashboard-link" href="dashboard.html" target="_blank">Open sync history &amp; filters ↗</a>
          {sync.lastRunAt && <small className="last-run">Last sync {new Date(sync.lastRunAt).toLocaleString()}</small>}
        </section>
        <section className="settings-row"><div><strong>Automatic sync</strong><small>Frequency</small></div><select aria-label="Sync frequency" value={settings.syncMinutes} onChange={(e) => void action('Sync settings saved.', { type: 'settings', autoSync: settings.autoSync, syncMinutes: Number(e.target.value) })}><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="720">Every 12 hours</option><option value="1440">Daily</option></select><input type="checkbox" aria-label="Automatic synchronization" checked={settings.autoSync} onChange={(e) => void action('Sync settings saved.', { type: 'settings', autoSync: e.target.checked, syncMinutes: settings.syncMinutes })} /></section>
        <button className="quiet" onClick={() => void action('Vault locked.', { type: 'vaultLock' })}>Lock credential vault</button>
      </>}
    </>}
    {(error || notice) && <div className={error ? 'toast error-toast' : 'toast'} role="status">{error || notice}<button aria-label="Dismiss" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}
    <footer><span>Codeforces → GitHub Sync</span><a href="privacy.html">Privacy</a></footer>
  </main>;
}

function message(e: unknown): string { return e instanceof Error ? e.message : 'Could not load extension settings.'; }
function messageText(e: unknown): string { return e instanceof Error ? e.message : 'Something went wrong. Try again.'; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
