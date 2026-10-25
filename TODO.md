# Codeforces → GitHub Sync v0.2.0 public release status

## Confirmed by automated checks

- [x] Production and test extension builds are separate.
- [x] Manifest v3 has a pinned production public key; the test build removes it.
- [x] Tests cover sync lifecycle, history, selective filters, ownership, OAuth callbacks, CORS preflight, and Worker token routes.
- [x] Production extension, test extension, and Worker type checks pass in the current checkout.

## Remaining before a public GitHub release

- [ ] Create the intended Git repository after reviewing the full staged file list; the current workspace has no root Git metadata.
- [x] Replace the support-contact placeholder in `public/privacy.html` with the maintainer-approved support email; verify that the inbox is monitored before public release.
- [ ] Publish the privacy policy at a stable public HTTPS URL and link it from the repository README/release page.
- [x] Replace maintainer-specific test App identifiers in the tracked test template with placeholders; preserve local testing in ignored `backend/wrangler.test.local.toml`.
- [x] Rebuild and create a fresh release ZIP from current `dist/`; the earlier archive is stale and missing manifest-declared icons.
- [x] Re-run tests, production build, Worker check, inspect the clean ZIP, verify byte-identical repackaging, and record its checksum.
- [ ] Attach only `release/v0.2.0/Codeforces-GitHub-Sync-v0.2.0-public-candidate.zip`; do not attach the older stale ZIP in the same folder.
- [ ] Publish only after the repository, documentation, hosted privacy URL, and final archive have been reviewed.

## Distribution

The planned distribution channel is GitHub Releases. Chrome Web Store tasks in `docs/STORE_RELEASE_CHECKLIST.md` are not requirements for this channel.
