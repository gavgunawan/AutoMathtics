# v3.0 verification record - 6 September 2026

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

The original v2.2.1 game and its database are not secured or replaced by adding this
folder. Deploy v3.0 to a separate new project and complete the remaining work in
README.md before any public paid launch.
