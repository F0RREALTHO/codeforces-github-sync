# Chrome Web Store assets and screenshot plan

## Prepared local assets

- Extension PNG icons: `public/icons/icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png`. The manifest declares each size and uses 16/32 for the toolbar action.
- Store icon: use `public/icons/icon128.png`.
- Small promotional tile: `public/store-assets/promo-small-440x280.png` (440 × 280). It is a brand graphic, not a product screenshot.

The icon uses the extension's existing CF monogram and dark teal palette. Chrome's manifest icons must be raster assets; the standard useful sizes are 16, 32, 48, and 128 pixels. The 128px asset is used by Chrome Web Store and install surfaces. [Chrome extension icons](https://developer.chrome.com/docs/extensions/develop/ui/configure-icons)

The Web Store currently requires a small promotional image at 440 × 280 and at least one product screenshot. Screenshots should be 1280 × 800 or 640 × 400; provide up to five current screenshots. [Chrome Web Store image requirements](https://developer.chrome.com/docs/webstore/images)

## Capture plan — actual release build only

Capture screenshots directly from Chrome/Brave running the final production-configured build after OAuth setup and live integration tests. Use a dedicated Codeforces test account and private GitHub test repository populated by actual successful sync operations. Do not synthesize dashboard rows, edit displayed counts, use mockups, or use historical screenshots as proof. Keep API keys, secrets, tokens, OAuth codes, email addresses, and unrelated personal data out of frame.

Suggested five screenshots:

1. **Connect accounts and consent** — a clean profile showing the in-product data-use notice and the Codeforces/GitHub connection controls. Do not show any credentials in input fields.
2. **Repository selected** — the popup after real OAuth, showing the connected account labels, selected private test repository, and a completed import state.
3. **Sync history** — the dashboard with real history rows from the dedicated test account, including status, language, submission ID, timestamp, repository, and file path. Ensure the data is genuine and no secret or private source content is shown.
4. **Selective filters** — the actual filter controls, with a real filter configuration and resulting uploaded/skipped rows from the test repository. Do not imply that an unrun filter scenario passed.
5. **Safe collision handling** — only if safely reproduced in a disposable test repository: an actual collision failure that explains how to resolve it, with the unrelated file preserved.

Before capture, confirm each visible count/path against the actual test repository and extension state. If a scenario has not passed live integration, omit that screenshot rather than implying success. Capture clean 1280 × 800 images (or 640 × 400 where popup dimensions require it), full-bleed and legible at store scale.

## Still needed from the maintainer

- Final screenshots from the production-configured build.
- The maintainer-approved public support contact is `kartikeyaaryam03@gmail.com` and is included in `public/privacy.html`; verify that it is monitored before release.
- Public HTTPS hosting for the finished privacy policy.
- Final store listing copy and disclosure after production setup and live verification.
