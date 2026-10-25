# Codeforces → GitHub Sync

A Manifest V3 Chrome extension that imports Accepted Codeforces solutions to a user-selected GitHub repository, then periodically checks for newer Accepted submissions.

## Current status

Version `0.2.0` includes the sync history dashboard and selective synchronization filters. The maintainer reports that production GitHub OAuth is connected and a historical import completed successfully. The repository and release archive still require the public-release steps listed below. No Personal Access Token (PAT) is used. See [CHANGELOG.md](CHANGELOG.md) for this release's changes.

## Local development

Requirements: Node.js 22+, npm, Chrome 120+.

```sh
npm ci
npm test
npm run build
```

To build locally, keep the maintainer's public production build values in the ignored `.env.local`; never put the GitHub App Client Secret there. Run `npm run build`, then open `chrome://extensions` (Chrome) or `brave://extensions` (Brave), enable Developer mode, choose **Load unpacked**, and select `dist/`. For isolated local testing, set test-only public values in ignored `.env.test.local`, run `npm run build:test`, and load `dist-test/`. `backend/wrangler.test.toml` is a sanitized test template. Copy it to the ignored `backend/wrangler.test.local.toml`, set your test App identifiers there, and use that local override only with the test Worker. Keep the test App secret in ignored `backend/.dev.vars`. Never use test configuration to produce a production release.

## GitHub authentication setup (release maintainer)

The extension uses a GitHub App and PKCE. The App Client Secret stays in the Cloudflare Worker. The Worker handles only code exchange and token refresh; solution source and repository API traffic stay between the extension and Codeforces/GitHub. Production App, extension identity, and Worker settings are documented in [Production OAuth and Worker configuration](docs/PRODUCTION_CONFIGURATION.md). The production App is distinct from the test App; the Client ID and slug are public configuration, while only the App Client Secret is a Worker secret.

## Install from a GitHub Release

The planned public distribution channel is GitHub Releases, not the Chrome Web Store. Download and extract the versioned extension ZIP, then:

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json` at its root.
4. Pin the extension if desired, open it, and follow its connection and vault prompts.

Keep the extracted folder in a stable location. The production manifest pins the extension identity so the same build identity is preserved across releases.

## Update an unpacked GitHub Release install

Updates are manual; this project does not implement automatic GitHub Release updates. Download and extract the newer ZIP, replace the files in the existing unpacked-extension folder, then open the browser's extensions page and select **Reload** for the extension. Keep the same folder path and do not remove the extension to update it: removing an extension can clear its local vault, history, and ownership records. Verify the version shown on the extension details page after reload.

Maintainers can run `npm ci`, `npm test`, `npm run build`, and then `.\scripts\package-release.ps1` from PowerShell to create a clean ZIP from the production `dist/`. The packager checks the manifest and runtime assets, excludes non-runtime store assets and source maps, and refuses to overwrite an existing archive. Review its file list and SHA-256 before attaching it to a GitHub Release.

## Troubleshooting

- **“GitHub sign-in is not configured in this build yet.”** The release was built without one or more required public production settings. Download a correctly configured release and report the version to the maintainer; users should not add credentials to the extension files.
- **“Could not reach the sign-in service.”** Check connectivity and the service status, then retry. Never send the Client Secret or OAuth codes to support.
- **“API credentials accepted; source access unconfirmed.”** Codeforces may not return source for a submission. Confirm the handle and API access; source is only expected for the account owner. The extension records missing source as a failure instead of substituting older code.
- **A destination path collision is reported.** The remote file is unowned or has changed since the ownership record was saved. Move or rename the conflicting file in GitHub, then retry. The extension will not adopt or overwrite it automatically.
- **The vault is locked after restarting the browser.** Unlock it with the vault password. If the password is lost, reset the vault and reconnect; credentials cannot be recovered from the encrypted vault.
- **An import is taking a long time or was interrupted.** Historical imports are sequential and resumable. Reopen the extension and allow recovery to continue. Re-import can reconcile offset-paginated history after submissions become quiescent.

Privacy policy source: [`public/privacy.html`](public/privacy.html). For privacy or support questions, email [kartikeyaaryam03@gmail.com](mailto:kartikeyaaryam03@gmail.com). The policy is prepared as a standalone static page, but its final public URL is pending the repository name and GitHub Pages configuration; publish it and add the canonical HTTPS link here before distribution.

## Sync behavior

- Codeforces `user.status` is read in descending submission-ID pages of 1,000 and globally rate-limited to one call per 2.1 seconds per browser profile.
- Source retrieval requires the user's own API key and secret from `codeforces.com/settings/api`. Requests are signed locally using the official SHA-512 protocol; only the API key and signature are sent to Codeforces, never the secret. Credentials and GitHub tokens are stored only as ciphertext in the local AES-GCM vault; the vault key remains in session-only trusted extension storage.
- Historical import persists its initial high-water submission ID and processes only entries at or below that cutoff. It deduplicates by submission ID, then runs an incremental catch-up for entries above the cutoff. Checkpoints replay the current offset page after interruption.
- Selecting a different GitHub repository resets repository-specific checkpoints and advances the job generation so the previous repository's in-flight work cannot continue. The **Change** control opens the repository picker while preserving the current choice until another repository is selected.
- Codeforces connection confirms that the handle exists and the signed API call was accepted. It does not prove account ownership. The UI reports source access as unconfirmed until Codeforces returns source for that handle. An empty history can be valid and remains unconfirmed.
- An interruption replays the current page. GitHub writes compare contents before committing and use existing file SHA values for updates. The latest submission ID wins; older Accepted code cannot replace newer code.
- Periodic sync uses `chrome.alarms`. An additional short recovery alarm resumes an interrupted historical/incremental operation after worker termination or browser restart.
- If Codeforces omits source, the extension records the exact problem/submission as failed, does not fall back to an older submission, and offers a retry that rescans history.
- File paths use `Codeforces/<contestId>/<index>_<sanitized problem name>.<ext>`. Source metadata is written as valid comments for supported languages; unknown languages receive a JSON sidecar.
- **Sync history** opens as a separate extension page. It keeps compact submission metadata and final per-submission outcomes in IndexedDB; source text, API credentials, and tokens are never stored in the history ledger. Search, repository/status/language/date filters, and page navigation are applied to the persistent ledger. A repeated submission ID in the same repository updates its row instead of creating a duplicate row.
- The summary uses the existing per-problem ownership manifest for current uploaded totals and history records for updated/skipped/failed outcomes. Before a repository switch, disconnect, or vault reset clears a v0.1 manifest, the dashboard preserves its owned files as clearly labeled legacy rows. A v0.1 manifest does not contain exact per-submission names, languages, or timestamps; use **Re-import history** once to replace placeholders with Codeforces metadata. This replay retains the manifest and uses GitHub SHA ownership checks.
- Selective sync filters are disabled by default. Enabled filters are combined with AND; selected tags use any-match. Dates are UTC and inclusive. Rating, tag, exact programming-language, and contest-ID filters apply to the newest Accepted submission for each problem. If excluded, it is recorded as skipped, an older Accepted solution is not substituted, and any existing synchronized file is retained.
- Saving changed filters cancels an active scan and marks a full historical re-import as required. Automatic periodic sync is suspended until that re-import completes. The re-import takes a new high-water snapshot, preserves existing ownership records, applies the new filters, then runs incremental catch-up. Changing filters never deletes existing GitHub files.
- **Retry failed** rescans the historical snapshot with the ownership manifest intact. An unowned or externally changed path remains a visible failure; retries do not adopt or overwrite it.
- Extension ownership records are also kept in IndexedDB, separately for each GitHub repository and Codeforces handle. Disconnecting either account, switching repositories, or resetting the vault does not discard these records. On reconnect, the extension restores only records for the matching repository and handle, then checks the current GitHub blob SHA against the recorded SHA before treating a remote file as owned. The ownership ledger stores paths and SHAs, not source text or credentials.
- If the browser profile's extension data was cleared, or an earlier build already erased its only ownership SHA, the extension cannot safely reconstruct ownership from GitHub or history rows. Such files remain collisions until the user resolves them manually; the extension never adopts a remote file based only on its existence or SHA.

## Permissions

Required: `storage`, `alarms`, and `identity`. Host access: `codeforces.com` and `api.github.com`. The authentication Worker host is an optional permission and is requested only when the user connects GitHub. GitHub authorization pages use Chrome's identity flow and do not require broad `github.com` host access. There are no content scripts or broad website access.

## Tests

Automated tests exercise the production sync engine, state and vault storage modules, IndexedDB history ledger, filter evaluator, Codeforces/GitHub clients, and token refresh service. They cover checkpoint replay, cancellation, repository reset, history persistence/pagination, filter combinations and re-import invalidation, storage/network/GitHub failures, token rotation concurrency, source-access status, and safe file replacement. Account-level integration (Chrome service-worker lifecycle, OAuth redirect behavior, Codeforces ownership/source availability, and live GitHub permission behavior) requires configured external accounts and a real Chrome run; mocked unit tests do not verify those behaviors.

## Security and known limits

- API credentials and GitHub tokens are encrypted at rest with AES-256-GCM using a key derived from a user-chosen passphrase (PBKDF2-SHA-256, 310,000 iterations). The key is kept in session-only trusted extension storage. Users must unlock the vault after restarting Chrome. Forgetting the passphrase requires resetting the vault and reconnecting both accounts.
- GitHub authorization is not available until the maintainer registers the App and deploys the token exchange Worker.
- Codeforces does not document OAuth login for this integration. `includeSources=true` is documented for the user's own account only; a valid handle does not by itself prove ownership. Missing sources are surfaced individually.
- Very large imports are sequential and resumable to stay within Codeforces/GitHub API limits; they can take substantial time. GitHub API rate limits and Codeforces availability can delay progress.
- Codeforces provides offset pagination, not a server-side snapshot or submission-ID cursor. The high-water cutoff and catch-up avoid mixing later submissions into the historical import, but concurrent arrivals can shift offsets and cause an entry from the initial snapshot to be missed in that pass. Once submissions become quiescent, use **Re-import history** to reconcile the full history; it keeps the ownership manifest so already synced files are not treated as unowned collisions. No finite offset scan can guarantee a complete snapshot under continuous arrivals.
- Sync writes and updates generated solution paths; it does not delete unrelated user files. If the latest solution changes extension, the previous tracked solution path is removed after its replacement is uploaded.
- An older local sync record without a stored GitHub blob SHA cannot authorize overwriting or deleting the remote file. Move/rename that file manually or choose a clean destination before syncing; a matching submission marker or live GitHub SHA is not enough to adopt it.
- Detailed v0.2 history is local to this browser profile. Clearing extension site data clears the IndexedDB ledger. A v0.1 installation can show its current manifest total immediately, but exact historic per-submission fields are available only after a historical re-import. History is not synchronized between devices.
- Filtered entries represent the newest Accepted submission considered for each problem. If the newest Accepted submission is filtered out, an older Accepted solution will not be selected as a fallback. When filters are later broadened, run the requested historical re-import; existing files remain until an eligible newer submission is successfully written.
