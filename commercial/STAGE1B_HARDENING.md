# Stage 1b hardening — response to the independent Stage 1 review

Base: `release/v3.0` at `a96af8425daff25a8191b47b6a665cee4829e642`.
Branch: `hardening/stage-1b`. Review findings are numbered as in the independent audit report
(`AutoMathtics_Stage1_Independent_Audit.md`, 8 September 2026).

Every change below has a regression test in `tests/stage1b.test.mjs`; the existing suite still runs.

## Fixed in code

### F1 — login lockout through the shared proxy address (High)
- `clientAddress()` in `http.mjs` derives the client from `X-Forwarded-For` using
  `TRUSTED_PROXY_HOPS`: the number of trusted proxies, each of which appended the address it
  accepted the connection from, so the earliest of the last *hops* entries is the client.
  Hosting in front of Cloud Run is 2. `0` uses the socket address.
- Config refuses staging/production without an explicit `TRUSTED_PROXY_HOPS` (0–5), because the
  socket address behind Hosting/Cloud Run is the proxy itself and would throttle every visitor as one.
- Only **failed** logins are counted per address (30 per 10 min). There is no pre-login address
  denial anymore: a saturated office/NAT address may still present a valid signed token. Invalid
  attempts remain 429. Successful sign-ins spend nothing in the address bucket and are limited
  **per account** inside `login()` after the token UID is cryptographically proven (10 per 10 min).
- Still to do on the real origin: measure how many trailing entries Hosting + Cloud Run add and set
  the value in the deploy environment (see DEPLOY_V3.md). Until then, staging refuses to start.

### F2 — `authorize()` did not enforce child revocation or entitlement (Medium)
- For `role === 'child'`, `authorize()` now reads the child and credential inside the same
  transaction and requires active status, entitlement and the current PIN version; it returns them.
- `selector()` opts out explicitly with `allowRevokedChild` so a revoked child can still step back
  to the selector, and nothing else.
- `me()` no longer duplicates these checks.

### F3 — uncached per-request identity lookup (Medium)
- `FirebaseIdentity` caches `getUser` per uid for 60 s (bounded map). Login always fetches fresh.
  **Trade-off:** disabling a parent, revoking their tokens, or changing their email/MFA upstream
  now takes effect within one minute plus one request, not instantly. Two existing tests were
  updated to step past the window.
- `http.mjs` throttles authenticated requests per session (120 per minute, per process).

### F5 — second device stranded after family creation (Low)
- A session whose `familyId` no longer matches the parent record is **superseded**: `authorize()`
  returns `401 SIGN_IN_REQUIRED`, which the client already handles, instead of `403 ACCESS_DENIED`.

### F6 — child-mode sign-out moved the parent re-auth marker (Low)
- `logout()` bumps `reauthAfter` only when the session ending is a parent session.

### F7 — broad CSP script sources (Low)
- `script-src`, `img-src`, `connect-src` and `frame-src` are path-scoped
  (`/recaptcha/`, `/firebasejs/`, `/__/auth/`); no bare `https://www.google.com` remains.
  Vendoring the Firebase SDK for full `'self'` remains a public-launch item.

### F8 — PIN hash had no pepper version (Low)
- Hashes are now `scrypt-v2:<kid>:<salt>:<hash>` where `kid` is the first 8 hex of the pepper's
  SHA-256. `PIN_PEPPER_PREVIOUS` (comma-separated) keeps retired peppers verifying. The unnamed
  legacy `scrypt-v1` format is tried against every known pepper.
- A correct PIN stored under a retired pepper or the legacy format is re-hashed on entry; the
  credential version is unchanged so the child's sessions survive.

### F9 — read-only paths used locking transactions (Low)
- Store contract gained `transaction(fn, { readOnly })`; `me()` uses it. The in-memory test store
  refuses writes inside a read-only transaction.

### F10 — family throttles spent before the role check (Low)
- `rateIn(tx, …)` throttles inside the authorizing transaction, after `authorize()`, with its
  write deferred behind all reads. Standalone `rate()` remains for login.

### F12 — cookie lifetime exceeded the session (Informational)
- Parent cookies carry `Max-Age=1800`; selector/child cookies `43200`.


### Follow-up S1B-A / S1B-B - login quota and shared-IP hardening
- Login performs `verifyIdToken(token, false)` first. This verifies the signed Firebase token without
  asking Auth for a second revocation lookup. Once the signed UID is available, the distributed
  account limiter runs **before** the one fresh `getUser(uid)` call.
- The fresh user record remains authoritative for disabled state, current verified email, current
  phone MFA enrollment and `tokensValidAfterTime` revocation.
- A failed-address bucket no longer pre-blocks a subsequently valid signed login from that address.
  This closes the remaining same-NAT denial found in the follow-up audit.
- Regression tests verify that the 11th signed login does not perform another `getUser` lookup and
  that a valid user can sign in after 30 bad attempts from the same public address.

## Not code — still open

- **F4:** code now stamps Firestore `Timestamp` TTL fields and deployment commands are documented; the real project TTL policies still need to be enabled once at staging.
- **F11:** closed in the staff Stage 2 merge; child-create replay fingerprints no longer commit to the PIN.
- **F13:** closed operationally: the active `release-lines` GitHub ruleset covers the default branch and `release/*`, blocks deletion/non-fast-forward, requires PRs and requires `unit`, `emulator`, and `container-build`. It currently requires zero approving reviews.
- **F14** digest-pin the Docker base image; add an informational `npm audit` job.
- **F15** the live v2 database — addressed separately on `main` (v2.3.1 anonymous sign-in + rules).
- Measure `TRUSTED_PROXY_HOPS` and the Auth Admin `accounts:lookup` quota on the staging origin.
