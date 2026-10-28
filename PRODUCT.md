# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Competitive programmers practicing on Codeforces who want to track, showcase, and version-control their Accepted solutions directly in their personal GitHub repositories without manual copy-pasting.

## Product Purpose

Automatically import past Accepted submissions (backfill) and continuously poll for new Accepted solutions, packaging and committing them to a designated GitHub repository in an organized folder structure with zero secret leakage.

## Positioning

Unlike conventional sync extensions that require broad GitHub Personal Access Tokens (PATs) or overwrite files unpredictably, Codeforces → GitHub Sync features an isolated client-side encrypted vault (PBKDF2 + AES-GCM) with no token leakage, alongside Git blob SHA-1 hash verification to prevent file conflicts and duplicate commits.

## Operating Context

- Operates primarily as a browser extension (Manifest V3) running across Google Chrome, Brave, Mozilla Firefox, and Microsoft Edge.
- User surfaces include a quick browser popup for sync status, authentication, and manual triggers, plus a dedicated full dashboard for configuration, tag/rating filters, sync history, and logs.
- Network environment interacts with the Codeforces public API and GitHub REST/GraphQL APIs with exponential backoff and jitter.

## Capabilities and Constraints

- **Historical Backfill & Live Polling:** Backfills past AC solutions while periodically checking for new contest/practice solutions.
- **Client-Side Vault Security:** Master passphrase encryption using PBKDF2 + AES-GCM; credentials never leave local browser storage unencrypted.
- **Conflict Prevention:** Git-blob SHA-1 hash checks before commit to prevent accidental overwrites or duplicate history.
- **Directory Structure:** Solutions organized by rating and problem name (`Codeforces/<rating>/<index>_<title>.<ext>`).
- **Selective Filtering:** Granular sync filters based on contest types, rating limits, and problem tags.
- **Cross-Browser Vault Isolation:** Independent vault storage profiles per browser (Chrome, Firefox, Edge).
- **Design Flexibility:** Open to reimagining and modernizing the visual identity and theme across popup and dashboard surfaces.

## Brand Commitments

- **Name:** Codeforces → GitHub Sync
- **Tone:** Technical, trustworthy, security-conscious, focused, and developer-centric.
- **Visual Stance:** Clean, readable, and intentional. Open to refreshing and elevating the current visual theme into a state-of-the-art developer interface.

## Evidence on Hand

- Production extension codebase with active Chrome, Firefox, and Edge build targets.
- 100+ passing Vitest unit/integration tests (`npm test`).
- Existing popup (`src/popup/`) and dashboard (`src/dashboard/`) implementations with real sync workflow and filter options.
- Visual documentation assets in `docs/images/` (`sync-overview.png`, `sync-filters.png`, `submission-history.png`).

## Product Principles

1. **Security & Privacy First:** Zero secret leakage. Security is paramount; credentials must remain encrypted in the client-side vault at all times.
2. **Never Clobber History:** Respect existing repositories and files. Check Git blob SHAs before committing and avoid destructive writes.
3. **Frictionless Resilience:** Handle API rate limits, network outages, and pagination quirks silently with exponential backoff and jitter.
4. **Transparent Control:** Provide users full visibility and granular control over what gets synced via clear statuses, logs, and custom filters.

## Accessibility & Inclusion

Ensure high contrast across dark and light modes, accessible form inputs, clear focus rings for keyboard navigation, and explicit aria labels for icon buttons and status indicators.
