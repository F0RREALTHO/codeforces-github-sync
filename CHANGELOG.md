# Changelog

## 0.2.0 — 2026-10-25

### Added

- Persistent sync history dashboard with repository scope, overview statistics, search, status/language/date filtering, pagination, and failure details.
- Configurable date, problem rating, Codeforces tag, programming language, and contest filters. All filters remain disabled by default.
- IndexedDB history records with legacy v0.1 manifest backfill that labels unavailable metadata honestly.
- Repository/account-scoped durable ownership records in IndexedDB, retained across account disconnects and repository switches, with immediate SHA persistence after confirmed GitHub writes.

### Improved

- Filter changes cancel stale jobs and request a historical re-import while preserving existing GitHub files and ownership records.
- Historical re-import and incremental catch-up apply the same filters; excluded submissions are recorded as skipped rather than uploaded.
- Re-import and retry verify the saved ownership record against the current GitHub file SHA. Unowned, missing, changed, and unverifiable legacy files are surfaced without being adopted or overwritten.
- Disconnecting or resetting the vault no longer loses the only ownership ledger needed to safely recognize previously synced files after reconnect.
- Documentation and manual integration checklist cover v0.2 history, filtering, migration, collision protection, and MV3 lifecycle limitations.

### Release notes

- The production GitHub App Client ID and Worker URL are public build configuration; the GitHub App Client Secret remains only in the Cloudflare Worker and is never bundled in the extension.
- GitHub Releases are the planned distribution channel. Installation and manual update instructions are in `README.md`.
- The maintainer-approved support email is `kartikeyaaryam03@gmail.com` and is included in the privacy policy. The final public HTTPS policy URL remains pending the repository name and GitHub Pages configuration.
