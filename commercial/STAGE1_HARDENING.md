# Stage 1 hardening patch 1

Baseline: `0820fe8858ea217861328c6f5072fbd3ef5ade72`, `release/v3.0`.
Date: 8 September 2026. Scope: account/session/PIN foundation only.
Status: patch candidate, not a Stage 1 sign-off or production approval.

## Implemented corrections

### S1-001: rotate session and CSRF credentials at child-mode boundaries

Handover, return to selection and successful child-PIN authentication now create
fresh opaque tokens and CSRF secrets. Each transaction deletes its predecessor
record and creates the replacement. No token is returned in JSON: the HTTP layer
sets the replacement HttpOnly cookie. Cookie restrictions are unchanged.

A separately retained predecessor cookie is rejected. In-flight writes recheck
session ownership/role in their transactions. Concurrent child-entry requests
using one predecessor can create at most one successor. Failed PIN checks do not
rotate. Child switching does not extend the original child-mode absolute expiry.

The service methods `lock`, `selector`, `selectChild` return the successor token.
Callers must explicitly authenticate that successor; an old context is not made
valid again or silently rewritten. Existing service tests were updated to follow
that contract. HTTP tests continue to check that old parent writes are denied;
an old cookie's POST is now denied at CSRF validation before role validation.

Same-browser tabs share the browser's cookie jar. Rotation does not create separate
identities for those tabs, make a stolen current cookie harmless, or retract data
already delivered before revocation. Separate legitimate parent browser sessions
are not globally logged out by one device's handover.

### S1-002: refund only a verification request that could not run/finish

The per-child record now holds `count` (completed wrong checks plus reserved checks),
`pending` (a bounded map of independent request tickets) and the existing 15-minute
window. Reservation occurs transactionally before hashing. Capacity cannot exceed
five checks in that window. A saturated budget containing pending checks reports
`PIN_SERVICE_BUSY`; five completed incorrect checks report `PIN_LOCKED`.

Hasher failure or a verification that cannot commit releases only its own ticket.
It cannot clear another request's failures, remove another reservation, or refund
a replacement window after expiry/reset. Correct proof clears completed failures
while preserving other pending reservations. Late results without a live reservation
are not accepted. Final authorization, entitlement, child status and credential
version/hash are checked before creating the authenticated successor session.

The family-wide request throttle remains in place even on service errors: refunding
a failed PIN-verification reservation is NOT removal of the anti-abuse request limit.
If the database fails while refunding, access fails closed. The reservation may remain
until the 15-minute window ends; this needs operational monitoring, not an auth bypass.
A process that dies mid-verification can similarly leave a reservation until expiry.

### S1-003: bind reauthentication continuations to the original parent and family

Authenticated parent `/me` responses include the parent's UID (not email or credentials).
Child/selector responses do not include that field. A continuation captures this UID
and family ID from `/me`. After fresh login and authenticated state reload, the draft
resumes only if role, UID and family match. This is a continuation guard; it does not
replace backend authorization or accept a browser-supplied UID as authority.

Different-account login is allowed as a login, but discards the old action's draft.
Family setup with a null family ID is still bound to its parent's UID. Nickname/icon
and family label/acknowledgement remain only in memory; PINs are cleared before reauth.
The continuation is one-shot and does not automatically submit the sensitive mutation.

Cancel verification invalidates the continuation. Session-change messages invalidate
it immediately, including while a request is running, with a deferred refresh instead
of silently dropping the message. A stale login continuation cannot resume a draft.
CSRF bootstrap is refreshed before session creation so expiry of the earlier parent
cookie does not make a completed reauthentication impossible.

Alt+Tab draft preservation remains. Actual session changes still invalidate stale
views. Child entry and child switching now broadcast session changes as well.

### S1-004: reject unavailable capacity/unknown reset targets before hashing

Creation checks seat and pilot-profile capacity before hashing, AFTER handling a valid
idempotent retry. The final transactional capacity checks remain and reject a concurrent
winner. Unknown/cross-family PIN-reset targets are rejected before hashing; the final
transaction checks again. No seat assignment, payment logic or plan limit was removed.

### S1-005: include the lockfile in the Docker context

`.dockerignore` narrowly includes `package-lock.json`; the Dockerfile still requires
`npm ci --omit=dev --ignore-scripts`. CI adds a container-build job with no image push
or deployment. It has NOT been executed by GitHub for this unpushed patch yet.

## Evidence actually executed for this patch

- Relevant baseline file contents matched the prior review's Git blob hashes, with
  the current GitHub PR still at the baseline commit. The updated emulator test's
  preimage also matches its committed blob.
- Original unmodified dependency-free suite: **48 passed, 0 failed** on Node 22.16.0.
- All four supplied review probes reproduced the old undesired behavior.
- **33 new regression tests** against the unpatched baseline: **24 failed, 9 passed**.
  Some regressions cover controls that already worked; failure counts are not a risk score.
- Patched combined suite: **81 passed, 0 failed, 0 skipped**. It includes 20 new
  service/HTTP/config tests and 13 new DOM/HTTP UI tests, plus the original 48 cases
  adapted where successor-token handling intentionally changes the service contract.
- PIN busy/recovery regression uses the actual scrypt implementation, not a fake hasher.
- Syntax checks and `git diff --check` run before packaging.

The UI regressions run the exact app.js and real HTTP/service handlers with a minimal
DOM, synthetic identity adapter and serializable in-memory store. They exercise form
mounting, same/different-account continuation, same/null family identity, cancellation,
revoked membership/MFA, cross-tab invalidation, CSRF expiry, Alt+Tab preservation,
handover, wrong/correct PIN and switching. They are NOT full browser/Firebase tests.

A separate Chromium smoke-check attempt was blocked by the execution environment's
browser policy (`ERR_BLOCKED_BY_ADMINISTRATOR` on loopback navigation). It is NOT a
passing browser result. Actual browser acceptance on the developer PC remains required.

This authoring environment could not resolve GitHub/npm hosts for direct downloads.
The checked mounted sources were used instead. No fresh dependency installation or
npm audit, live Firebase/emulator run, Docker build, cloud deployment, or real SMS
was performed here. The lockfile and dependency versions are not changed in this patch.

## How to verify on the developer PC

1. Keep the existing demo Auth/Firestore emulators in Window 1 running.
2. Stop the Node app in Window 2 before applying backend/frontend files together.
3. Apply on a clean local branch based on the baseline commit. Do not merge into main.
4. From `commercial`, run `npm test`. Expected: 81 tests passed, no failures/skips.
5. With Window 1 already running, run:

   node --env-file=.env --test tests/emulator.integration.mjs

   Do not start another `emulators:exec` on occupied ports. The file is guarded to use
   demo-am-foundation with Auth 9099 and Firestore 8088. It creates synthetic test data
   and now explicitly follows new tokens and rejects predecessor tokens.
6. Restart the app with `npm start`, then Ctrl+F5 in the browser. Sign out/re-authenticate
   for a clean browser session. The patch does not mass-delete emulator data, so do not
   assume every previously stored local session has already been rotated.
7. Re-test parent signup/login, handover, wrong/correct PIN, switching, reset, and
   reauthentication including a DIFFERENT test parent. Do not send PINs/secrets/cookies.
8. Review the diff and the dependency audit before committing/pushing. Keep PRs Draft.
9. After pushing the hardening branch, inspect both test jobs AND the new build job.

Do not enable billing, real SMS or public deployment merely to test this patch.

## Developer-PC acceptance - 8 September 2026

Completed against the hardened local branch after security-code commit `adcfc15`:

- Expanded unit/security/UI suite: **81 passed, 0 failed, 0 skipped**.
- Firebase Auth + Firestore emulator integration: **2 passed, 0 failed**.
- Total automated checks executed locally for this checkpoint: **83/83 passed**.
- Real-browser parent -> selector handover rotated the `__session` cookie.
- Real-browser selector -> authenticated child transition rotated the cookie and reached child-only mode.
- Real-browser child -> selector transition rotated the cookie again.
- One-seat entitlement and synthetic child creation behaved as expected through the hardened backend.
- Staged diff passed `git diff --cached --check` and the targeted staged-secret scan returned no matches.
- `commercial/.env` remained ignored and was not committed.
- Local Docker execution was unavailable because Docker is not installed on the developer PC; the static Docker-context regression passes and the actual container build remains a GitHub CI requirement.
- `npm audit --omit=dev` reports six moderate entries arising from one `uuid <11.1.1` advisory through Firebase Admin transitive dependencies, including the Cloud Storage dependency path.
- Reviewed AutoMathtics runtime code initializes Firebase Auth and Firestore only; no direct Cloud Storage use or direct vulnerable `uuid` v3/v5/v6 output-buffer call was identified.
- Dependency disposition: **temporary tracked exception**, not a permanent exemption. Do not use `npm audit fix --force`; re-check before public staging and whenever `firebase-admin` changes.

These checks materially strengthen the Stage 1 evidence but do not constitute a production penetration test or public-launch certification.

## Follow-up Stage 1 hardening - 8 September 2026

Security follow-up after the initial `adcfc15` hardening review:

- **S1-006 - family-creation session boundary:** fixed in `9d4009a`. Creating the first family rotates the opaque session token and CSRF value, deletes the predecessor session, and exposes the replacement only through the hardened `HttpOnly` cookie path.
- **S1-007 - CI action supply-chain pinning:** fixed in `9d4009a`. `actions/checkout`, `actions/setup-node`, and `actions/setup-java` are referenced by verified full commit SHAs rather than mutable major-version tags.
- Local unit/security/UI regression suite: **84 passed, 0 failed, 0 skipped**.
- Firebase Auth + Firestore emulator integration: **2 passed, 0 failed**.
- The real emulator path verifies that the pre-family cookie becomes invalid immediately after family creation and subsequent operations use the replacement session.
- A high-confidence credential scan across all reachable Git history returned **no matches**.
- Staged security-code diff passed whitespace/integrity and targeted credential scans before commit.
- Security-code commit: `9d4009a`.
- Earlier GitHub Actions run 34244331889 on commit `04ff517` passed unit, Firebase emulator integration, and the actual Docker runtime-image build.
- The follow-up branch containing `9d4009a` still requires a successful GitHub Actions unit, emulator and container-build run before integration into `release/v3.0`.

## Still open before sign-off

- Re-check the tracked `uuid` advisory before public staging or whenever `firebase-admin` changes; the current runtime-only exception is documented above and is not a permanent exemption.
- High-confidence reachable-history secret scanning is complete with no matches; repository/branch governance remains a pre-public-staging review item.
- Independent follow-up review identified S1-006 and S1-007; both are fixed in `9d4009a`. Re-review remains required if authentication, session, entitlement or CI trust boundaries materially change.
- Production-only IAM, secrets, real token verification, provider anti-abuse/quotas,
  proxy-aware limits, MFA recovery, privacy/retention and deletion/export controls.

The existing v2 application is not secured by this patch. Learning/game migration
is not included. Green tests establish the tested behavior, not exhaustive security.

## References

OWASP session renewal guidance:
https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
Docker excluded COPY input guidance:
https://docs.docker.com/reference/build-checks/copy-ignored-file/
