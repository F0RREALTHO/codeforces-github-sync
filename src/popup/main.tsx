import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browserApi, hasExtensionRuntime, sendRuntimeMessage } from '../platform/browser';
import { calculateStreaks, getBrowserTimezone, type StreakResult } from '../domain/streaks';
import { fmtMins } from '../domain/solutions';
import type { Settings, VaultStatus } from '../domain/types';
import type { AcceptedSubmissionRecord } from '../storage/history';
import type { GithubRepository } from '../services/github';
import { ThemeToggle } from '../components/ThemeToggle';
import { StreakFire } from '../components/StreakFire';
import {
  IconCf,
  IconGithub,
  IconSync,
  IconLock,
  IconShield,
  IconPause,
  IconPlay,
  IconFolder,
  IconExternalLink,
  IconAlert,
  IconCheck,
} from '../components/Icons';
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import './styles.css';

const authApi = import.meta.env.VITE_AUTH_API_BASE_URL as string | undefined;
const githubAppClientId = import.meta.env.VITE_GITHUB_APP_CLIENT_ID as string | undefined;
const githubAppSlug = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined;

type UiSettings = Settings & { vault: VaultStatus };
type Message = Record<string, unknown> & { type: string };

async function send<T>(message: Message): Promise<T> {
  return sendRuntimeMessage<T>(message);
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
  const [showSettings, setShowSettings] = useState(false);
  const [acceptedSubmissions, setAcceptedSubmissions] = useState<AcceptedSubmissionRecord[]>([]);
  const [serverStreak, setServerStreak] = useState<StreakResult | null>(null);

  const refresh = async () => {
    try {
      if (!hasExtensionRuntime()) {
        const mockSettings: UiSettings = {
          codeforcesHandle: 'tourist',
          repository: { name: 'codeforces-solutions', fullName: 'tourist/codeforces-solutions', defaultBranch: 'main', owner: 'tourist', private: false },
          sync: {
            phase: 'idle',
            nextFrom: 0,
            submissionsSeen: 142,
            acceptedSeen: 87,
            uniqueProblems: 54,
            filesUploaded: 87,
            lastSubmissionId: 265001122,
            done: true,
            failed: {},
            synced: {},
            retiredFiles: {},
            contestQueue: {},
            lastRunAt: Date.now() - 1000 * 60 * 35,
          },
          vault: { exists: true, unlocked: true },
          consentAcceptedAt: Date.now() - 86400000 * 30,
          autoSync: true,
          syncMinutes: 360,
          jobGeneration: 1,
          syncFilters: {
            dateEnabled: false,
            ratingEnabled: false,
            tagsEnabled: false,
            tags: [],
            languagesEnabled: false,
            languages: [],
            contestsEnabled: false,
            contests: [],
          },
        };
        const mockStreak: StreakResult = {
          currentStreak: 42,
          longestStreak: 42,
          longestStreakLast365: 28,
          longestStreakLast30: 7,
          totalActiveDays: 184,
          activeDaysLast365: 140,
          last365DaysCount: 140,
          timeZone: 'Asia/Kolkata',
          activeToday: true,
          activeYesterday: true,
          activityDefinition: 'accepted',
          isHistoryComplete: true,
          isCalculating: false,
          activityByDate: {},
          heatmapDays: [],
        };
        const mockSubs: AcceptedSubmissionRecord[] = [
          {
            id: 265001122,
            submittedAt: Date.now() - 1000 * 60 * 60 * 4,
            verdict: 'OK',
            problemKey: '1985-E',
            problemName: 'Secret Box',
          },
          {
            id: 222111555,
            submittedAt: Date.now() - 1000 * 60 * 60 * 70,
            verdict: 'OK',
            problemKey: '1872-A',
            problemName: 'Two Vessels',
          },
          {
            id: 222111000,
            submittedAt: Date.now() - 1000 * 60 * 60 * 72,
            verdict: 'OK',
            problemKey: '1872-A',
            problemName: 'Two Vessels',
          },
        ];
        setSettings(mockSettings);
        setServerStreak(mockStreak);
        setAcceptedSubmissions(mockSubs);
        return;
      }

      const [nextSettings, subs, streakData] = await Promise.all([
        send<UiSettings>({ type: 'state' }),
        send<AcceptedSubmissionRecord[]>({ type: 'acceptedSubmissions' }).catch(() => []),
        send<StreakResult>({ type: 'streakSummary' }).catch(() => null),
      ]);
      setSettings(nextSettings);
      setAcceptedSubmissions(subs || []);
      if (streakData) setServerStreak(streakData);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, []);

  const action = async <T,>(label: string, message: Message, done?: (value: T) => void) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await send<T>(message);
      done?.(value);
      await refresh();
      setNotice(label);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const loadRepositories = async () => {
    setRepoPickerOpen(true);
    setBusy(true);
    setError('');
    try {
      setRepositories(await send<GithubRepository[]>({ type: 'repositories' }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const connectGithub = async () => {
    if (!githubAppClientId || !githubAppSlug || !authApi) {
      setError('GitHub sign-in is not configured in this build. Needs Client ID, slug, and auth Worker URL.');
      return;
    }
    try {
      const origin = new URL(authApi).origin;
      const granted = await browserApi().permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        setError('Permission for the sign-in service is required to connect GitHub.');
        return;
      }
      await action('GitHub connected.', { type: 'connectGithub' });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!settings) {
    return (
      <main className="popup-app">
        <header className="popup-header">
          <div className="popup-brand">
            <span className="popup-logo">CF</span>
            <div>
              <h1 className="popup-title">Solution Sync</h1>
              <p className="popup-subtitle">Loading sync state…</p>
            </div>
          </div>
          <ThemeToggle />
        </header>
        {error && (
          <div className="alert-box alert-danger" role="alert">
            <IconAlert size={14} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0 }}>{error}</p>
              <button className="btn btn-ghost" style={{ marginTop: 6, height: 24, padding: '0 6px' }} onClick={() => { setError(''); void refresh(); }}>
                Retry
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  const sync = settings.sync;
  const isRunning = sync.phase === 'historical' || sync.phase === 'incremental';
  const isPaused = sync.phase === 'paused';
  const isError = sync.phase === 'error' || Boolean(sync.error);
  const connected = Boolean(settings.codeforcesHandle && settings.githubLogin && settings.repository);
  const failedCount = sync.failed ? Object.keys(sync.failed).length : 0;
  const contestQueueList = Object.values(sync.contestQueue || {});
  const contestQueueCount = contestQueueList.length;
  const allQualifying = [
    ...acceptedSubmissions.map((sub) => ({
      submissionId: sub.id,
      submittedAt: sub.submittedAt || 0,
      verdict: sub.verdict,
    })),
    ...contestQueueList.map((q) => ({
      submissionId: q.submissionId,
      submittedAt: q.submittedAt,
      verdict: q.verdict,
    })),
  ];
  const streak: StreakResult = serverStreak || calculateStreaks(allQualifying, {
    timeZone: settings.preferredTimezone || getBrowserTimezone(),
    nowMs: Date.now(),
  });

  // Calculate next scheduled sync
  const lastRunTime = sync.lastRunAt || 0;
  const nextScheduledTime = lastRunTime && settings.autoSync ? lastRunTime + settings.syncMinutes * 60 * 1000 : null;
  const nextScheduledLabel = nextScheduledTime && nextScheduledTime > Date.now()
    ? `in ${fmtMins(Math.round((nextScheduledTime - Date.now()) / (60 * 1000)))}`
    : settings.autoSync
    ? 'scheduled'
    : 'paused';

  return (
    <main className="popup-app">
      {/* Top Header */}
      <header className="popup-header">
        <div className="popup-brand">
          <span className="popup-logo">CF</span>
          <div>
            <h1 className="popup-title">CommitForce</h1>
            <p className="popup-subtitle">
              {connected ? `${settings.codeforcesHandle} → ${settings.repository?.name}` : 'Setup & Authentication'}
            </p>
          </div>
        </div>
        <div className="popup-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            title={isRunning ? 'Sync running' : isPaused ? 'Sync paused' : isError ? 'Needs attention' : 'Ready'}
          >
            <span
              className={`status-dot ${isRunning ? 'live' : isPaused ? 'paused' : isError ? 'error' : ''}`}
            />
            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              {isRunning ? 'LIVE' : isPaused ? 'PAUSED' : isError ? 'ALERT' : 'READY'}
            </span>
          </div>
          <ThemeToggle />
          <a
            href="dashboard.html"
            target="_blank"
            className="btn-icon"
            title="Open Full Dashboard"
            aria-label="Open Full Dashboard"
          >
            <IconExternalLink size={14} />
          </a>
        </div>
      </header>

      {/* Screen 1: Data Consent */}
      {!settings.consentAcceptedAt && (
        <section className="card">
          <h2 className="card-title">Data privacy &amp; security</h2>
          <p className="card-text">
            This extension connects directly to your personal Codeforces account and GitHub repository. 
            All Codeforces secrets and GitHub tokens are encrypted in an isolated local vault (PBKDF2 + AES-GCM).
            Your code is never shared with third-party servers or telemetry.
          </p>
          <label className="checkbox-line">
            <input type="checkbox" id="consent-check" />
            <span>I understand what data this extension accesses and where it goes.</span>
          </label>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                const el = document.getElementById('consent-check') as HTMLInputElement;
                if (!el?.checked) {
                  setError('Please check the confirmation box to proceed.');
                  return;
                }
                void action('Privacy notice accepted.', { type: 'consent' });
              }}
            >
              Accept &amp; Continue
            </button>
            <a href="privacy.html" target="_blank" className="footer-link">
              Privacy details ↗
            </a>
          </div>
        </section>
      )}

      {/* Screen 2: Local Vault Setup or Unlock */}
      {settings.consentAcceptedAt && !settings.vault.unlocked && (
        <section className="card">
          <h2 className="card-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconLock size={15} style={{ color: 'var(--accent)' }} />
              {settings.vault.exists ? 'Unlock credential vault' : 'Initialize credential vault'}
            </span>
          </h2>
          <p className="card-text">
            {settings.vault.exists
              ? 'Enter your master passphrase to unlock encrypted Codeforces credentials and GitHub tokens for this session.'
              : 'Create a master passphrase (minimum 12 characters). Your API keys and tokens are encrypted locally with AES-256-GCM.'}
          </p>
          <div className="input-group">
            <input
              type="password"
              placeholder={settings.vault.exists ? 'Vault passphrase' : 'Create master passphrase'}
              autoComplete="current-password"
              value={vaultPassphrase}
              onChange={(e) => setVaultPassphrase(e.target.value)}
            />
          </div>
          {!settings.vault.exists && (
            <div className="input-group">
              <input
                id="vault-confirm"
                type="password"
                placeholder="Confirm master passphrase"
                autoComplete="new-password"
              />
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              {vaultPassphrase.length < 12 ? `${vaultPassphrase.length}/12 chars minimum` : 'Passphrase ready'}
            </span>
            <button
              className="btn btn-primary"
              disabled={busy || vaultPassphrase.length < 12}
              onClick={() => {
                const confirmation = document.getElementById('vault-confirm') as HTMLInputElement | null;
                if (!settings.vault.exists && confirmation?.value !== vaultPassphrase) {
                  setError('Vault passphrases do not match.');
                  return;
                }
                void action(
                  'Credential vault unlocked.',
                  { type: 'vaultUnlock', passphrase: vaultPassphrase },
                  () => setVaultPassphrase('')
                );
              }}
            >
              {settings.vault.exists ? 'Unlock vault' : 'Create vault'}
            </button>
          </div>
          {settings.vault.exists && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 8, fontSize: 'var(--text-xs)', padding: 0 }}
              onClick={() => {
                if (window.confirm('Resetting the vault erases local credentials. Reconnection will be required. Continue?')) {
                  void action('Vault reset. Reconnect accounts.', { type: 'vaultReset' });
                }
              }}
            >
              Reset vault and re-authenticate
            </button>
          )}
        </section>
      )}

      {/* Screen 3: Unlocked / Main Connected UI */}
      {settings.consentAcceptedAt && settings.vault.unlocked && (
        <>
          {/* Main Sync Hero Card */}
          <section className="sync-hero-card">
            <div className="sync-hero-top">
              <div>
                <h2 className="sync-phase-title">
                  {sync.phase === 'historical'
                    ? 'Importing solutions'
                    : sync.phase === 'incremental'
                    ? 'Polling Codeforces'
                    : isPaused
                    ? 'Sync paused'
                    : isError
                    ? 'Needs attention'
                    : sync.done
                    ? 'Synchronized'
                    : 'Ready to import'}
                </h2>
                <div className="sync-phase-detail">
                  {sync.needsReimport
                    ? 'Filters updated · Re-import recommended'
                    : sync.lastRunAt
                    ? `Last checked: ${new Date(sync.lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Next: ${nextScheduledLabel}`
                    : 'No synchronization executed yet'}
                </div>
              </div>
              <span
                className={`badge ${
                  isRunning
                    ? 'badge-accent'
                    : isPaused
                    ? 'badge-warning'
                    : isError
                    ? 'badge-danger'
                    : 'badge-success'
                }`}
              >
                {isRunning ? 'SYNCING' : sync.phase.toUpperCase()}
              </span>
            </div>

            {/* Progress bar */}
            <div className="progress-container">
              <div className={`progress-track ${isRunning ? 'indeterminate' : ''}`}>
                <div
                  className="progress-fill"
                  style={{
                    width: sync.done ? '100%' : isRunning ? '45%' : sync.submissionsSeen ? '15%' : '0%',
                  }}
                />
              </div>
            </div>

            {/* Metrics Row */}
            <div className="metrics-row">
              <div className="metric-item">
                <span className="metric-value">{sync.uniqueProblems.toLocaleString()}</span>
                <span className="metric-label">Problems</span>
              </div>
              <div className="metric-item streak-metric-box">
                <div className="streak-value-row">
                  <StreakFire
                    streakDays={streak.currentStreak}
                    activeToday={streak.activeToday}
                    activeYesterday={streak.activeYesterday}
                    size={20}
                  />
                  <span className="metric-value">
                    {streak.isCalculating ? 'Calc…' : !streak.isHistoryComplete && streak.currentStreak === 0 ? 'Incomplete' : `${streak.currentStreak}d`}
                  </span>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 2 }}
                  title={
                    streak.activeToday
                      ? `Current streak: ${streak.currentStreak}d (Solved today) · Record: ${streak.longestStreak}d`
                      : streak.activeYesterday
                      ? `Current streak: ${streak.currentStreak}d (Alive · solve today) · Record: ${streak.longestStreak}d`
                      : `Current streak: ${streak.currentStreak}d · All-time record: ${streak.longestStreak}d`
                  }
                >
                  <span className="metric-label" style={{ margin: 0 }}>STREAK</span>
                  {(streak.activeToday || streak.activeYesterday) && (
                    <span
                      style={{
                        fontSize: '8px',
                        fontFamily: 'var(--font-mono)',
                        padding: '1px 4px',
                        borderRadius: '3px',
                        background: streak.activeToday ? 'var(--success-bg)' : 'var(--warning-bg)',
                        color: streak.activeToday ? 'var(--success)' : 'var(--warning)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        lineHeight: 1.1,
                      }}
                    >
                      {streak.activeToday ? 'Active' : 'Alive'}
                    </span>
                  )}
                </div>
                {streak.longestStreak > 0 && !streak.isCalculating && (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '-2px' }}>
                    Max: {streak.longestStreak}d
                  </span>
                )}
              </div>
              <div className="metric-item">
                <span
                  className="metric-value"
                  style={{ color: contestQueueCount > 0 ? 'var(--contest)' : failedCount > 0 ? 'var(--danger)' : undefined }}
                >
                  {contestQueueCount > 0 ? `${contestQueueCount} held` : failedCount > 0 ? `${failedCount} fail` : '0 held'}
                </span>
                <span className="metric-label">{contestQueueCount > 0 ? 'Waiting' : failedCount > 0 ? 'Failures' : 'Waiting'}</span>
              </div>
            </div>

            {/* Contest Protection Status Strip */}
            <div className="contest-banner">
              <IconShield size={14} className="contest-banner-icon" />
              <div className="contest-banner-text">
                <strong>Contest Protection: </strong>
                {sync.error?.includes('contest') || sync.error?.includes('Contest')
                  ? 'Status unavailable · Deferred conservatively'
                  : contestQueueCount > 0
                  ? `Active contest · ${contestQueueCount} solution${contestQueueCount === 1 ? '' : 's'} waiting`
                  : isRunning
                  ? 'Sync running · Solutions verified'
                  : isPaused
                  ? 'Uploads paused · Submissions queued'
                  : 'No contest running, syncing normally'}
              </div>
            </div>

            {/* Sync Controls */}
            <div className="btn-group">
              {isRunning ? (
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() => void action('Sync paused.', { type: 'pause' })}
                >
                  <IconPause size={13} /> Pause
                </button>
              ) : isPaused ? (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() => void action('Sync resumed.', { type: 'resume' })}
                >
                  <IconPlay size={13} /> Resume
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={busy || !connected}
                  onClick={() => void action('Sync finished.', { type: 'syncNow' })}
                >
                  <IconSync size={13} /> Sync now
                </button>
              )}

              {sync.needsReimport && (
                <button
                  className="btn"
                  disabled={busy || isRunning}
                  onClick={() => void action('Re-import started.', { type: 'startImport' })}
                >
                  Apply filters
                </button>
              )}

              {failedCount > 0 && (
                <button
                  className="btn btn-danger"
                  disabled={busy || isRunning}
                  onClick={() => void action('Failed retried.', { type: 'retryFailures' })}
                >
                  Retry ({failedCount})
                </button>
              )}
            </div>
          </section>

          {/* Accounts & Destination Section */}
          <section className="card">
            <div className="section-header">
              <span className="section-title">Connected Accounts</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                {[settings.codeforcesHandle, settings.githubLogin].filter(Boolean).length}/2 linked
              </span>
            </div>

            {/* Codeforces Row */}
            <div className="account-item">
              <div className="account-left">
                <span className="account-icon">
                  <IconCf size={14} />
                </span>
                <div className="account-details">
                  <span className="account-name">Codeforces</span>
                  <span className="account-sub">
                    {settings.codeforcesHandle
                      ? `${settings.codeforcesHandle} (${settings.codeforcesSourceAccess === 'confirmed' ? 'verified' : 'unverified'})`
                      : 'Not connected'}
                  </span>
                </div>
              </div>
              {settings.codeforcesHandle ? (
                <button
                  className="btn btn-danger"
                  style={{ height: 26, fontSize: 'var(--text-xs)', padding: '0 8px' }}
                  onClick={() => void action('Codeforces disconnected.', { type: 'disconnect', provider: 'codeforces' })}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="btn"
                  style={{ height: 26, fontSize: 'var(--text-xs)', padding: '0 8px' }}
                  onClick={() => setCfConnectOpen((prev) => !prev)}
                >
                  {cfConnectOpen ? 'Close' : 'Connect'}
                </button>
              )}
            </div>

            {/* Codeforces Connect Drawer */}
            {!settings.codeforcesHandle && cfConnectOpen && (
              <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  Provide Codeforces API credentials to retrieve your submission source code.
                </p>
                <div className="input-group">
                  <input
                    type="text"
                    placeholder="Handle (e.g. tourist)"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                  />
                </div>
                <div className="input-group">
                  <input
                    type="text"
                    placeholder="API Key"
                    value={cfApiKey}
                    onChange={(e) => setCfApiKey(e.target.value)}
                  />
                </div>
                <div className="input-group">
                  <input
                    type="password"
                    placeholder="API Secret"
                    value={cfApiSecret}
                    onChange={(e) => setCfApiSecret(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <a href="https://codeforces.com/settings/api" target="_blank" className="footer-link">
                    Generate API key ↗
                  </a>
                  <button
                    className="btn btn-primary"
                    style={{ height: 26, fontSize: 'var(--text-xs)' }}
                    disabled={busy || !handle.trim() || !cfApiKey.trim() || !cfApiSecret.trim()}
                    onClick={() =>
                      void action(
                        'Codeforces connected.',
                        { type: 'connectCodeforces', handle, apiKey: cfApiKey, apiSecret: cfApiSecret },
                        () => {
                          setCfApiSecret('');
                          setCfApiKey('');
                          setCfConnectOpen(false);
                        }
                      )
                    }
                  >
                    Verify &amp; Link
                  </button>
                </div>
              </div>
            )}

            {/* GitHub Row */}
            <div className="account-item">
              <div className="account-left">
                <span className="account-icon">
                  <IconGithub size={14} />
                </span>
                <div className="account-details">
                  <span className="account-name">GitHub</span>
                  <span className="account-sub">{settings.githubLogin || 'Not connected'}</span>
                </div>
              </div>
              {settings.githubLogin ? (
                <button
                  className="btn btn-danger"
                  style={{ height: 26, fontSize: 'var(--text-xs)', padding: '0 8px' }}
                  onClick={() => void action('GitHub disconnected.', { type: 'disconnect', provider: 'github' })}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  style={{ height: 26, fontSize: 'var(--text-xs)', padding: '0 8px' }}
                  disabled={busy}
                  onClick={() => void connectGithub()}
                >
                  Connect
                </button>
              )}
            </div>

            {/* Repository Row */}
            {settings.githubLogin && (
              <div className="account-item" style={{ borderBottom: 'none' }}>
                <div className="account-left">
                  <span className="account-icon">
                    <IconFolder size={14} />
                  </span>
                  <div className="account-details">
                    <span className="account-name">Target Repository</span>
                    <span className="account-sub">
                      {settings.repository
                        ? `${settings.repository.fullName} (${settings.repository.private ? 'Private' : 'Public'})`
                        : 'No repository chosen'}
                    </span>
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ height: 26, fontSize: 'var(--text-xs)', padding: '0 6px' }}
                  disabled={busy}
                  onClick={() => void loadRepositories()}
                >
                  {settings.repository ? 'Change' : 'Choose'}
                </button>
              </div>
            )}

            {/* Repository Picker Drawer */}
            {repoPickerOpen && (
              <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>Choose Repository</span>
                <div className="repo-picker-box">
                  {repositories.map((repo) => (
                    <button
                      key={repo.id}
                      className="repo-picker-item"
                      onClick={() =>
                        void action(
                          'Repository selected.',
                          { type: 'selectRepository', repository: repo },
                          () => setRepoPickerOpen(false)
                        )
                      }
                    >
                      <span style={{ fontWeight: 500 }}>{repo.fullName}</span>
                      <span className="badge">{repo.private ? 'Private' : 'Public'}</span>
                    </button>
                  ))}
                  {repositories.length === 0 && (
                    <div style={{ padding: 8, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      Loading repositories…
                    </div>
                  )}
                </div>
                {/* Create repository inline */}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input
                    type="text"
                    style={{ flex: 1 }}
                    placeholder="new-repo-name"
                    value={newRepo}
                    onChange={(e) => setNewRepo(e.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ height: 32 }}
                    disabled={busy || !newRepo.trim()}
                    onClick={() =>
                      void action(
                        'Repository created.',
                        { type: 'createRepository', name: newRepo, isPrivate: privateRepo },
                        () => setRepoPickerOpen(false)
                      )
                    }
                  >
                    Create
                  </button>
                </div>
                <label className="checkbox-line" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={privateRepo}
                    onChange={(e) => setPrivateRepo(e.target.checked)}
                  />
                  <span>Create as private repository</span>
                </label>
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 6, width: '100%' }}
                  onClick={() => setRepoPickerOpen(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </section>

          {/* Quick Settings Drawer Toggle */}
          <section className="card" style={{ padding: '8px 12px' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setShowSettings((s) => !s)}
            >
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>Sync &amp; Vault Preferences</span>
              <button className="btn-icon" style={{ width: 22, height: 22 }}>
                {showSettings ? '▲' : '▼'}
              </button>
            </div>

            {showSettings && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                <div className="settings-strip">
                  <div>
                    <strong>Automatic Synchronization</strong>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      Periodic polling in background
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoSync}
                    onChange={(e) =>
                      void action('Sync preference saved.', {
                        type: 'settings',
                        autoSync: e.target.checked,
                        syncMinutes: settings.syncMinutes,
                      })
                    }
                  />
                </div>

                <div className="settings-strip">
                  <div>
                    <strong>Sync Frequency</strong>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      Interval between checks
                    </div>
                  </div>
                  <select
                    value={settings.syncMinutes}
                    onChange={(e) =>
                      void action('Frequency updated.', {
                        type: 'settings',
                        autoSync: settings.autoSync,
                        syncMinutes: Number(e.target.value),
                      })
                    }
                  >
                    <option value="60">Every hour</option>
                    <option value="360">Every 6 hours</option>
                    <option value="720">Every 12 hours</option>
                    <option value="1440">Daily</option>
                  </select>
                </div>

                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 'var(--text-xs)' }}
                    onClick={() => void action('Vault locked.', { type: 'vaultLock' })}
                  >
                    <IconLock size={12} /> Lock credential vault
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* Notifications / Error Banner */}
      {error && (
        <div className="alert-box alert-danger" role="alert">
          <IconAlert size={14} />
          <span style={{ flex: 1 }}>{error}</span>
          <button className="btn-icon" style={{ width: 18, height: 18, border: 0 }} onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="alert-box alert-success" role="status">
          <IconCheck size={14} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button className="btn-icon" style={{ width: 18, height: 18, border: 0 }} onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="popup-footer">
        <a href="dashboard.html" target="_blank" className="footer-link">
          Open Full Dashboard ↗
        </a>
        <a href="privacy.html" target="_blank" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Privacy
        </a>
      </footer>
    </main>
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'An unexpected error occurred.';
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
