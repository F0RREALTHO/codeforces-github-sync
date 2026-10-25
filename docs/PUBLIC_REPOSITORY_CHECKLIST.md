# Public repository readiness checklist

Complete this review before changing the project repository to public. Do not rely on `.gitignore` alone: ignored files can already be tracked, copied into a release asset, or present in Git history.

## Repository and history

- [ ] Confirm the intended repository root and inspect all files that will be committed.
- [ ] Review the complete staged diff before every commit.
- [ ] Search the complete Git history for credentials, tokens, private keys, local configuration, and personal data.
- [ ] If a secret was ever committed, revoke/rotate it; removing the file in a later commit does not remove it from history.
- [ ] Check branches, tags, Git LFS objects, release assets, and generated archives for unintended files.
- [ ] Confirm no unrelated personal documents, browser data, local paths, account data, or source submissions are included.

## Secrets and local configuration

- [ ] Keep `.env*` local files and variants out of commits; commit only clearly named example templates.
- [ ] Keep `backend/.dev.vars*`, `backend/.wrangler/`, local Worker state, and runtime traces out of commits.
- [ ] Keep `backend/wrangler.test.local.toml` ignored; only the sanitized `backend/wrangler.test.toml` template is suitable for public source control.
- [ ] Confirm production and test OAuth configuration remain separated; test IDs and local Worker URLs are not in production artifacts.
- [ ] Confirm no GitHub Client Secret, Codeforces API secret, access/refresh token, session credential, or signing private key is present in source, history, artifacts, or logs.
- [ ] Keep signing private keys, certificates, keystores, and CRX packages out of the source repository unless an explicit release process requires a public artifact.
- [ ] Verify secret scanning and repository push protection are enabled where available.

## Generated files and release assets

- [ ] Exclude `node_modules/`, `dist/`, `dist-test/`, coverage, temporary files, browser profiles, `/work/`, and local release staging directories from source commits.
- [ ] Keep generated Codex deliverables under `/outputs/` out of the public source repository unless an individual document is intentionally reviewed and moved into `docs/`.
- [ ] Build release artifacts from a clean checkout using documented commands.
- [ ] Inspect the release ZIP independently; ensure it contains only intended runtime files and has `manifest.json` at its root.
- [ ] Verify release artifact checksums and attach only the intended ZIP and release notes.
- [ ] Do not upload source maps, `.env` files, `.dev.vars`, local databases, logs, test profiles, or stale build artifacts.

## Product and privacy review

- [ ] Verify the published support email is monitored: `kartikeyaaryam03@gmail.com`.
- [ ] Publish the accurate privacy policy at the final stable HTTPS URL and link that URL from the repository README/release page before broad public distribution.
- [ ] Review README, installation instructions, troubleshooting, and release notes for accuracy and current browser restrictions.
- [ ] Remove private URLs, maintainer-specific paths, account identifiers, test repository names, and accidental personal information where not needed.
- [ ] Confirm OAuth callback/origin configuration uses the intended stable extension identity and no test App credentials.
- [ ] Review all manifest permissions and explain their purpose in the documentation.

## Final gate

- [ ] Confirm Git metadata exists and inspect `git status --short --ignored` plus `git ls-files` for accidentally tracked local files.
- [ ] Run the documented tests and production build from a clean checkout.
- [ ] Review the final public diff and release archive with at least one second-person review before making the repository public.

## Suggested explicit staging allowlist

After initializing Git yourself, stage only reviewed source and documentation paths. Do not use `git add .` for the first public commit. A conservative starting allowlist is:

```powershell
git add .gitignore .env.example .env.test.example README.md CHANGELOG.md TODO.md package.json package-lock.json tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts vitest.config.ts index.html dashboard.html public/manifest.json public/privacy.html public/icons src backend/src backend/package.json backend/package-lock.json backend/tsconfig.json backend/vitest.config.ts backend/wrangler.toml backend/wrangler.test.toml backend/.dev.vars.example docs scripts
```

Review `git status --short` and `git diff --cached --name-only` before committing. This intentionally omits local environment files, `backend/wrangler.test.local.toml`, `backend/.dev.vars`, build output, release archives, browser data, and local workspaces. Adjust the allowlist only after reviewing any new project files.
