# Production extension identity

The production extension identity is pinned by the public `key` field in `public/manifest.json`. Chromium derives the extension ID from the SHA-256 hash of the public key, so the ID is stable across build output paths and compatible Chromium browsers when the same manifest key is used.

The current production ID derived from that public key is `ahcgidlkjifgfdcalleiijiabidfehjd`. The test build deliberately removes the production `key` in `scripts/prepare-test-dist.mjs`; keep the test identity separate.

## Keep the signing key safe

The corresponding private key is stored outside the project in a maintainer-controlled protected location. The exact filesystem path is intentionally not recorded in this public-facing document. The project contains only the public key. The private key is not needed for loading unpacked extensions or creating the current GitHub Release ZIP; it would only be needed for a separately chosen signed CRX distribution. Never copy it into the repository, a build folder, a GitHub release, or a chat. The `.gitignore` excludes PEM files as an additional safeguard.

Back up the private key by placing an encrypted copy in a reputable password manager's secure file storage or on encrypted offline media. Store the encryption password separately from the backup, restrict access to the backup, and verify that a recovery copy can be restored before relying on it. Do not email it or store it in ordinary cloud file storage. Keep the original and backup protected; losing both means future signed packages cannot use this identity.

The public manifest key is not confidential and can be committed. It is an identity value, not a signing credential. Anyone can see it, but only a holder of the private key can produce a package signed by that identity.

## Verify the ID in Chrome and Brave

1. From the project root, run `npm run build`.
2. In Chrome, open `chrome://extensions`; in Brave, open `brave://extensions`. Enable Developer mode and choose **Load unpacked**.
3. Select the production `dist/` folder. Record the ID shown on the extension card/details page; it should match the ID above in both browsers.
4. To check path independence, remove the unpacked instance from the browser, move or copy the built `dist/` folder to a different path, then use **Load unpacked** on that new path. Verify the ID is unchanged. Do not load the separate `dist-test/` build for this check.
5. Repeat after a later production build. The ID should remain the same as long as the manifest public key is unchanged.

This verifies the ID in local Chromium browsers. The production GitHub App callback, redirect URI, and Worker origin are configured for this pinned ID; see [production OAuth and Worker configuration](PRODUCTION_CONFIGURATION.md).
