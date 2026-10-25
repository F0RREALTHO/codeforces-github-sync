# Edge Add-ons and Firefox AMO submission guide

## Current state

- The maintainer reports live sync working in Chrome, Brave, Edge, and Firefox.
- Edge and Firefox production builds are separate and built with the commands below.
- Firefox AMO version 0.2.0 has been submitted and is awaiting review.
- The corrected Edge v0.2.0 package omits `manifest.key`, was accepted by Partner Center, and is in review. Partner Center assigned CRX ID `jpenndpejbklhljfpghhddiollhikdgk`.
- The production Worker configuration includes the Edge origin and callback, and the maintainer reports deploying it. Ensure the Edge callback is saved in GitHub App settings before testing Edge OAuth.
- Current extension version is `0.2.0`.
- The live privacy policy is **https://f0rrealtho.github.io/codeforces-github-sync/public/privacy.html**. The hostname contains a zero (`f0`), not the letter `o`. The correct URL was checked and returned HTTP 200 on 2026-10-25; the lookalike hostname with an `o` returns 404.

## Build the packages

From the project root:

```powershell
npm ci
npm test
npm run build:edge
npm run build:firefox
./scripts/package-browser-stores.ps1
```

The script creates:

- `outputs/store-submissions-v0.2.0-edge-keyfix/Codeforces-GitHub-Sync-Edge-v0.2.0.zip`
- `outputs/store-submissions-v0.2.0-edge-keyfix/Codeforces-GitHub-Sync-Firefox-v0.2.0.zip`
- `outputs/store-submissions-v0.2.0-edge-keyfix/Codeforces-GitHub-Sync-Firefox-Source-v0.2.0.zip`
- `outputs/store-submissions-v0.2.0-edge-keyfix/listing-assets/edge/` with Edge logo/tile and `listing-assets/firefox/` with genuine product screenshots.

The production packages are generated from `dist-edge/` and `dist-firefox/`, with `manifest.json` at the archive root. The Firefox build declares Firefox 142+ so its built-in data-transmission disclosure is supported on desktop and Android; the project does not claim Android compatibility in the AMO listing until separately tested. The Firefox source archive includes the sources, lockfile, build script, and build guidance; it excludes local `.env` files, `.dev.vars`, signing keys, dependencies, runtime output, and the generated packages. Do not upload the source ZIP as the Firefox extension package.

## Edge Add-ons listing

1. Sign into the Microsoft Partner Center Edge developer dashboard using the maintainer account.
2. The corrected Edge ZIP above is already uploaded and in review. It intentionally omits `manifest.key` because Partner Center rejects that field.
3. Partner Center assigned CRX ID `jpenndpejbklhljfpghhddiollhikdgk`. The Worker config contains the exact origin/callback and has reportedly been deployed. Confirm the callback is saved in GitHub App settings. After approval, install the store-associated package and verify its runtime ID and `identity.getRedirectURL('github')` match before testing OAuth.
4. Complete availability, category, privacy, permission justifications, data-use declarations, and the English listing. Use the assets supplied under `listing-assets/`.
5. Review the listing text and certification notes below, save the draft, then submit it for Microsoft certification when ready.

Microsoft currently requires a 1:1 store logo (recommended 300x300; at least 128x128) and a detailed description of 250–10,000 characters. The 440x280 small promotional tile is optional. Screenshots are optional, up to six, and must be 640x480 or 1280x800. The included extension icon is 128x128 and the included tile is 440x280. The supplied genuine screenshots are retained in their original sizes; upload them only if Partner Center accepts them or prepare correctly sized versions from actual browser captures. [Microsoft Edge publishing requirements](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)

### Suggested Edge listing text

**Name:** Codeforces → GitHub Sync

**Short description:** Back up Accepted Codeforces solutions to a GitHub repository you choose, then sync newer Accepted submissions automatically.

**Description:**

> Codeforces → GitHub Sync copies your Accepted Codeforces solutions into a GitHub repository that you select. Connect using your Codeforces API credentials and authorize the GitHub App, choose a repository and branch, then run an initial history import. The extension can periodically check for newer Accepted submissions and save the latest accepted solution for each problem. A persistent history dashboard records uploaded, skipped, and failed operations, and optional filters can limit synchronization by submission date, problem rating, tags, programming language, or contest. Credentials are encrypted in a local vault in your browser profile. OAuth token exchange and refresh are handled by the project's Cloudflare Worker. The extension does not use a GitHub Personal Access Token. Existing or changed repository files are protected: files are only treated as owned when a durable local ownership record matches the current GitHub file SHA. Source code may be unavailable for some Codeforces submissions; those items are reported and older submissions are not substituted. Each browser profile stores its own vault and history.

**Privacy policy:** https://f0rrealtho.github.io/codeforces-github-sync/public/privacy.html

**Support contact:** kartikeyaaryam03@gmail.com

**Permission justification notes:** `storage` and IndexedDB persist encrypted account data, preferences, checkpoints, history, and ownership records; `alarms` schedules periodic sync and recovery; `identity` runs GitHub OAuth; Codeforces and GitHub host access is needed for their APIs and submission source; the optional Worker host permission is requested for OAuth exchange and token refresh. No remotely hosted JavaScript is executed.

## Firefox AMO listing

1. Sign into the maintainer's Mozilla/AMO developer account.
2. Submit the Firefox runtime ZIP for an AMO listing and follow the validator results.
3. When asked for source code, upload the matching Firefox Source ZIP. The production bundle is created using Vite/esbuild, so reviewers need the unminified source, lockfile, and local build commands.
4. Set the add-on ID to the manifest's Gecko ID, `codeforces-github-sync@forrealtho`; do not create a second add-on ID for updates.
5. Provide the working privacy policy URL above, support email, summary, description, categories, and license selection. The project has no checked-in license file; choose the intended license in AMO deliberately rather than implying an open-source license.
6. Add reviewer notes explaining that sign-in uses the production GitHub App and Worker, that users provide their own Codeforces API credentials and GitHub authorization, and that reviewers can exercise the visible workflow with their own accounts. Do not send reviewer passwords, OAuth codes, API secrets, or tokens.
7. Submit for Mozilla review/signing. Keep the generated package and source archive paired with the exact version submitted.

If AMO reports the two `UNSAFE_VAR_ASSIGNMENT` warnings observed for this build, they point into the bundled React DOM runtime. The extension source contains no `dangerouslySetInnerHTML` usage; explain the warnings to reviewers if asked, and do not suppress them.

AMO accepts ZIP/XPI/CRX packages. Because this extension bundles and transforms JavaScript, provide source code and build instructions for every submitted version. Firefox screenshots are optional; if uploaded, the listing guide recommends 1280x800 and a 1.6:1 ratio. [AMO submission guide](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) · [AMO source code requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/) · [Firefox listing screenshots](https://extensionworkshop.com/documentation/publish/create-an-appealing-listing/)

### Suggested Firefox summary

Back up Accepted Codeforces solutions to a GitHub repository you choose, import history, filter submissions, and sync newer accepted code automatically.

## Manual release checks still required

- Store account ownership/eligibility and listing forms must be completed by the maintainer in Partner Center and AMO.
- Verify the Edge store package's identity and callback in the actual store-installed build after approval.
- Complete Edge certification and AMO validation/review. Store acceptance and public availability are not verified by local builds.
- Select a license in AMO; none is declared in the repository.
- Upload store screenshots only when the portal accepts the supplied original dimensions, or capture/resize genuine screens to the store's required dimensions. Do not use mockups or invented data.
- After each store package is signed/approved, install from the store and repeat OAuth, repository access, sync, restart, and update checks.
