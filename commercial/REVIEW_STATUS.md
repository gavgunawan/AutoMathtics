# Stage 1 hardening verification - 8 September 2026

The older records below are historical checkpoints. Current Stage 1b/Stage 2 completion work is described in
[STAGE1B_HARDENING.md](STAGE1B_HARDENING.md), [STAGE2_LEARNING.md](STAGE2_LEARNING.md), and
[STAGE2_COMPLETION.md](STAGE2_COMPLETION.md). No public-launch or production-security certification is implied
by a green test run.

## Stage 1b + Stage 2 completion candidate - 9 September 2026

- Base release entering the completion pass: `dbc189f20e74231b978c1ca447cc4c5e58af0777`.
- S1B-A/S1B-B follow-up login quota/shared-address hardening implemented.
- Stage 2 learning hardening adds durable per-child start throttling, canonical answer validation and a real-emulator concurrent-answer race regression.
- The remaining v2 game/economy product surface is migrated behind v3 server authority: shop/inventory/cosmetics, pets/eggs/shields, Reward Store, Family Rocket, System Scan, pace, map/fluency, read-aloud and parent game/progress controls.
- A guarded dry-run-first v2 JSON history/wallet/config migration path is included; it never connects to the old Firebase project.
- Local deterministic suite: **140/140 passed, 0 failed, 0 skipped**.
- Required GitHub `unit`, `emulator`, and `container-build` checks remain the merge gate for this candidate.
- Real iPhone Safari / Android Chrome interaction remains a manual private-pilot acceptance item.
- Stage 3 commercial payments/subscriptions/account lifecycle have not started in this branch.

## Developer-PC hardening acceptance - 8 September 2026

- Hardened security-code checkpoint: `adcfc15`.
- Local unit/security/UI tests: **81/81 passed**.
- Firebase emulator integration: **2/2 passed**.
- Manual Chrome session rotation passed for parent -> selector, selector -> child, and child -> selector.
- Targeted staged-secret scan: no matches.
- Runtime dependency audit: one tracked moderate `uuid` advisory represented by six transitive audit paths; temporary exception only, with re-review required before public staging.
- GitHub Actions run 34244331889 passed all three jobs: unit, Firebase emulator integration, and actual Docker runtime-image build.
- Stage 1 remains a private-development security foundation; production IAM, secrets, real MFA, operational controls, privacy lifecycle, and final production security review are outside this checkpoint.

## Follow-up Stage 1 hardening - 8 September 2026

- Follow-up security-code checkpoint: `9d4009a`.
- S1-006 fixed: first family creation now rotates the parent session token and CSRF value and invalidates the pre-family predecessor session.
- S1-007 fixed: all GitHub Actions used by the foundation workflow are pinned to verified immutable full commit SHAs.
- Local unit/security/UI suite after these changes: **84/84 passed**.
- Firebase Auth + Firestore emulator integration after these changes: **2/2 passed**.
- High-confidence credential scan across all reachable Git history returned no matches.
- The recurring Firebase Admin `MetadataLookupWarning` appeared during emulator execution but did not fail either integration test; it remains tracked as a non-fatal environment/dependency warning.
- The follow-up branch containing `9d4009a` must still pass GitHub Actions unit, emulator and container-build jobs before integration into `release/v3.0`.
- These results strengthen the private-development Stage 1 foundation; they are not public-production security certification.

## Initial v3.0 verification record - 6 September 2026

## Verified in the authoring environment

- The supplied Step 1 ZIP was extracted and inspected; its baseline passed 45 tests.
- The v3.0 package passed **48 tests, 0 failed, 0 skipped** on Node 22.16.0.
- The additional tests cover release-version agreement, Hosting routing and the
  health endpoint. Existing tests cover PIN hashing, role demotion, cross-family
  denial, throttling/reset, seat idempotency/expiry/downgrade and HTTP/CSRF checks.
- Node syntax checks and Bash syntax checking are run before packaging.
- Tests use synthetic identities and a serializable in-memory transactional store;
  the PIN hashing test uses real scrypt. No live Firebase records were accessed.

## Not verified / required before staging acceptance

- npm access failed with EAI_AGAIN. Dependency installation, package-lock generation,
  Firebase Auth/Firestore emulators, Docker image construction and cloud deployment
  have not been verified here. Run the included emulator/CI checks and review results.
- Real Firebase configuration, email/SMS delivery, reCAPTCHA/CSP compatibility,
  IAM, edge abuse protection, recovery, mobile-browser behavior and backup restoration.
- The deployment helper was syntax-checked, not executed against a cloud project.
- A live URL, payments, learning-game integration and production readiness are NOT
  established by the version number or by unit-test success.

The existing v2 game and its database are not secured or replaced by adding this
folder. Deploy v3.0 to a separate new project and complete the remaining work in
README.md before any public paid launch.
