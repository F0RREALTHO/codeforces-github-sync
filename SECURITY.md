# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | ✅ Active support  |
| < 0.3   | ❌ No longer supported |

## Reporting a Vulnerability

If you discover a security vulnerability in CommitForce, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email: **kartikeyaaryam03@gmail.com**

Include:
- A description of the vulnerability
- Steps to reproduce
- The version of CommitForce affected
- Any potential impact you've identified

I will acknowledge receipt within 48 hours and provide an initial assessment within 7 days.

## Security Architecture

### Client-Side Credential Vault
- Codeforces API key, API secret, and GitHub OAuth tokens are **never stored in plaintext**.
- All credentials are encrypted at rest using **AES-GCM-256** with keys derived via **PBKDF2-SHA256 (600,000 iterations)**, conforming to current OWASP recommendations.
- The vault master key is derived from a user-chosen passphrase and never leaves the browser profile.
- Each browser profile maintains its own isolated encrypted vault.

### OAuth Flow and the Cloudflare Worker
CommitForce uses a GitHub App (not a Personal Access Token) with minimal scoped permissions. Because browser extensions cannot securely store a client secret, a small Cloudflare Worker acts as a confidential OAuth relay:

1. The extension initiates GitHub OAuth with **PKCE** (Proof Key for Code Exchange).
2. The extension sends the one-time authorization `code` and PKCE `code_verifier` to the Worker.
3. The Worker adds `client_id` + `client_secret`, exchanges them at `github.com/login/oauth/access_token`, and returns the token pair to the extension.
4. For token refresh, the extension sends only the `refresh_token`; the Worker adds the client credentials and forwards to GitHub.

**What the Worker never receives:**
- Your Codeforces handle, API key, or API secret
- Your solution source code
- Your vault passphrase or encryption keys

The Worker source code is fully open at [`backend/src/index.ts`](https://github.com/F0RREALTHO/codeforces-github-sync/blob/main/backend/src/index.ts). It stores nothing (no database, no logs, no KV). CORS restricts requests to known extension origins only.

### Transparency Limitations
- **Deployed Worker vs. source code:** Users cannot independently verify that the deployed Cloudflare Worker runs exactly the code in this repository. This is a fundamental limitation of any hosted backend. If this concerns you, you can fork the repository and deploy your own Worker instance with your own GitHub App credentials.
- **Store builds vs. source code:** Browser store packages are built from this repository using the build commands documented in the README. Firefox AMO requires source code submission for review. The Chrome/Brave release ZIP is built from the same `npm run build` pipeline.

### Permissions
The extension requests only the permissions necessary for its function:
- `storage` — Encrypted vault and sync state
- `alarms` — Periodic background sync scheduling
- `identity` — GitHub OAuth flow
- Host permissions for `codeforces.com` and `api.github.com` — API access
- Optional Worker host permission — OAuth token exchange

### Codeforces API Security
- API requests use cryptographic request signing per the [Codeforces API specification](https://codeforces.com/apiHelp).
- A strict 2.1-second inter-request queue prevents rate limit violations.
- API credentials never leave the browser; they are used only for local signature computation.

