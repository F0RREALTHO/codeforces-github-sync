# v0.2 Chrome integration checklist

Use only the test extension build, a dedicated Codeforces account, and a private GitHub test repository. Never capture or share Codeforces keys, OAuth codes, tokens, source code, or signed request URLs. Do not use the production OAuth configuration.

## Build and upgrade

- [ ] Run `npm test`, `npm run build`, and `npm run build:test`.
- [ ] Load `dist-test/` as an unpacked extension. Confirm the extension ID and local Worker configuration are the test values.
- [ ] Upgrade a v0.1 test profile without removing the extension. Unlock the vault and confirm accounts/repository remain connected.
- [ ] Confirm the dashboard reports the current ownership-manifest total even before detailed history exists.
- [ ] Run **Re-import history** once. For records with saved ownership SHAs that still match GitHub, confirm no duplicate commits and detailed history rows appear with no source text or credentials. If a legacy record has no SHA or the remote file changed, confirm it is surfaced for manual resolution and is never silently adopted or overwritten.
- [ ] Before re-import, switch away from a v0.1 repository and back. Confirm legacy rows remain under the old repository; entries without saved GitHub SHAs must be presented as unverifiable rather than silently accepted as owned.

## History dashboard

- [ ] Open **Sync history & filters** from the popup. Close/reopen the page and restart Brave; history rows and filters remain.
- [ ] With more than 50 rows, navigate forward/back. Confirm no repeated or missing row IDs across pages.
- [ ] Search by problem name and contest ID. Filter by uploaded, updated, skipped, and failed status, exact language, and inclusive UTC date range.
- [ ] Switch repository scope between a specific repository and **All repositories**. Confirm rows show the correct repository and file path.
- [ ] Cause a safe upload failure and confirm its row gives a readable reason. Use **Retry failed operations** and verify replay does not create duplicate files.
- [ ] After a successful sync, manually edit or remove an extension-tracked remote file, then re-import/retry the same submission. Confirm the dashboard reports a changed/missing tracked file and does not silently report success or overwrite it.
- [ ] Close the dashboard and terminate the extension service worker, then reopen the dashboard. Confirm IndexedDB history survives independently of worker memory. Restart Brave and verify again.

## Selective synchronization

- [ ] On a clean test profile, confirm all filter toggles start disabled and all submissions remain eligible.
- [ ] Enable a single date, rating, tag, language, or contest filter at a time. Re-import and confirm included/excluded outcomes in history.
- [ ] Enable several filters together. Confirm they are AND-combined; for tags, confirm any selected tag is sufficient. Confirm date boundaries are UTC and inclusive, and a submission with no rating is excluded when rating filtering is enabled.
- [ ] Change filters while a historical import is active. Confirm the active job stops, the popup says re-import is required, automatic sync is suspended, and no prior owned files are deleted.
- [ ] Change filters during an in-flight Codeforces page request and during an in-flight GitHub contents/write request. Confirm stale filters do not lead to a subsequent write, a new job starts with the saved filters, and interrupted writes recover without duplicate commits.
- [ ] Start the requested re-import. Confirm it takes a new high-water snapshot, retains ownership records, records excluded submissions as skipped, and runs incremental catch-up after historical completion.
- [ ] Create a new Accepted submission excluded by the active filters. Run incremental sync; confirm its cursor advances and it is logged as skipped, not uploaded. Broaden filters and re-import; confirm the eligible latest submission is synced.
- [ ] Confirm older Accepted submissions never replace a newer Accepted submission that was skipped by a filter.

## Ownership and failure recovery

- [ ] Place an unrelated file at a generated solution path. Re-import; confirm the operation is failed with a collision reason, and remote content is unchanged.
- [ ] Retry while the collision remains; confirm it stays failed and does not overwrite the file. Move the unrelated file, retry, and confirm the solution is written once.
- [ ] Change the programming language for a later Accepted solution to force a new extension. Confirm the replacement is written before an owned old path is removed; unrelated paths remain untouched.
- [ ] Switch repositories during an import. Confirm the old job is cancelled, its checkpoints are not reused for the new repository, and both repositories' history remains available.
- [ ] Switch repositories immediately after an upload completes and while a write is pending. Confirm prior repository history remains available and any uncertain remote commit is resolved by the durable pending-write/ownership checks before retry.

## MV3 lifecycle and account integration

- [ ] Start a long historical import, stop the extension service worker from Brave's extension service-worker inspector, then reopen the popup. Confirm the recovery alarm resumes the durable checkpoint without duplicate files.
- [ ] Restart Brave during an import. Unlock the vault and confirm the operation recovers; verify the history ledger persists across the restart.
- [ ] Pause, disconnect Codeforces, disconnect GitHub, and lock the vault while requests are pending. Confirm cancellation stops subsequent writes and recovery does not silently continue with stale credentials.
- [ ] With a dedicated test GitHub App, exercise token refresh near expiry. Confirm authorization remains usable after one rotated pair is persisted; simulate refresh/network/storage failures in automated tests (live timing alone is not an adequate failure-injection test).
- [ ] Confirm final repository visibility is private, expected files contain the newest accepted source, unrelated files are unchanged, and the extension reports no unresolved failures.

Chrome/Brave lifecycle behavior, live OAuth/token expiry, and actual Codeforces source access require manual testing with the configured test accounts. Unit tests do not prove those browser or external-service behaviors.
