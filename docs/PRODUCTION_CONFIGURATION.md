# Production OAuth and Worker configuration

This documents the pinned production extension and OAuth Worker. Production OAuth configuration and a successful production history import were reported by the maintainer. Public build identifiers are not secrets; the GitHub App Client Secret is a Worker secret and must never be put in extension build configuration.

## Production identity and endpoints

| Setting | Production value | Location |
| --- | --- | --- |
| Extension ID | `ahcgidlkjifgfdcalleiijiabidfehjd` | Pinned public key in `public/manifest.json` |
| Extension origin | `chrome-extension://ahcgidlkjifgfdcalleiijiabidfehjd` | Worker `EXTENSION_ORIGIN` |
| OAuth redirect URI | `https://ahcgidlkjifgfdcalleiijiabidfehjd.chromiumapp.org/github` | GitHub App Callback URL and Setup URL; Worker `GITHUB_REDIRECT_URI` |
| GitHub App slug | `codeforces-github-sync` | Extension `VITE_GITHUB_APP_SLUG` |
| Worker name | `cfgh-auth` | `backend/wrangler.toml` |
| Worker base URL | `https://cfgh-auth.kartikeyaaryam7.workers.dev` | Extension `VITE_AUTH_API_BASE_URL` |

The GitHub App numeric ID is not the OAuth Client ID. `GITHUB_APP_CLIENT_ID` in the Worker and `VITE_GITHUB_APP_CLIENT_ID` in the extension build must contain the same production App Client ID. These public identifiers are set in local production configuration; do not print or copy the Client Secret into project files.

## GitHub App settings

For the production GitHub App **Codeforces GitHub Sync** (`codeforces-github-sync`):

1. Set both **Callback URL** and **Setup URL** to the exact OAuth redirect URI shown above. The extension uses `chrome.identity.getRedirectURL('github')` and validates the installation callback before starting OAuth.
2. Keep wildcard callback matching disabled. Leave **Request user authorization (OAuth) during installation** disabled; the extension performs a separate PKCE authorization flow after installation.
3. Enable expiring user-to-server tokens and refresh-token support. The extension requests `offline_access`.
4. Grant **Metadata: Read-only** and **Contents: Read and write**. Grant **Repository creation: Read and write** only while the create-repository feature is enabled. Restrict App installation to repositories the user chooses. No webhook URL or events are used.

GitHub references: [setup URL behavior](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url), [user authorization and token flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), and [App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

## Worker behavior

- `backend/wrangler.toml` is the production config. `backend/wrangler.test.toml` is a sanitized test template; copy it to ignored `backend/wrangler.test.local.toml` and enter test-only public identifiers there. Keep the test secret in ignored `backend/.dev.vars`. Never deploy the template or local override as production.
- The production manifest requests only `https://cfgh-auth.kartikeyaaryam7.workers.dev/*` as an optional host permission. Test builds replace it with the local Worker origin.
- The Worker accepts only the exact configured extension `Origin`, `POST`/`OPTIONS`, and `/token` or `/refresh`. A custom Worker domain would require a matching extension optional host permission and a rebuild.
- `/token` requires the exact configured redirect URI and a valid PKCE verifier. The extension verifies the OAuth `state` before calling the Worker. The Worker itself does not validate state.
- The installation callback has a separate state check and numeric `installation_id` check in the extension.
- The only secret required by the Worker source is `GITHUB_APP_CLIENT_SECRET`. Its value is hidden in Cloudflare and must never be placed in `wrangler.toml`, `.env.local`, `VITE_*`, source control, or support messages.

The extension build uses these public variables in ignored `.env.local`:

```dotenv
VITE_GITHUB_APP_CLIENT_ID=<production GitHub App Client ID>
VITE_GITHUB_APP_SLUG=codeforces-github-sync
VITE_AUTH_API_BASE_URL=https://cfgh-auth.kartikeyaaryam7.workers.dev
```

Only maintainers configuring a fresh local checkout should create `.env.local` from `.env.example`. Never include it in a public repository or release archive.

## Maintainer deployment reference

The production Worker is reported deployed. Do not run the secret or deploy commands as part of an ordinary extension release. For a later Worker update, run from `backend` and review the target config first:

```powershell
npx wrangler@4 whoami
npm run check
npx wrangler@4 deploy --dry-run --config .\wrangler.toml
```

Only after review and explicit authorization, deploy the production config:

```powershell
npx wrangler@4 deploy --config .\wrangler.toml
```

Important: `wrangler secret put GITHUB_APP_CLIENT_SECRET --config .\wrangler.toml` prompts for the value but immediately creates and deploys a Worker version. Do not run it casually or as a verification command. To verify presence without reading a value, use `wrangler secret list`; it lists names only. See [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Public-release readiness

- Production OAuth and Worker setup are not blockers according to the maintainer's live-test report.
- The maintainer-approved support email is present in the privacy policy. Its final stable public HTTPS URL remains pending the repository name and GitHub Pages configuration; verify the email inbox is monitored before release.
- Production configuration must remain separate from the test App and `backend/wrangler.test.local.toml`.
- Inspect each production build and release archive for test identifiers, local URLs, `.env*`, `.dev.vars`, source maps, secrets, and private signing material before distribution.
