# AutoMathtics v3.0 - account and security foundation

**Status: v3.0 private pilot, not a public-launch security certification.**

Start with [DEPLOY_V3.md](DEPLOY_V3.md) for GitHub upload and Firebase/Cloud Run deployment.
The version number does not mean the old learning game has been integrated.

This directory is independent of the existing v2 family prototype. It does not import,
rebuild or replace the root `index.html`, connect to its Realtime Database, or migrate
its children. The commercial server explicitly refuses the legacy Firebase project.
The spinning-ring design is retained with synthetic/illustrated profile icons.

## Implemented

- Parent signup UI, email verification, SMS MFA enrolment and sign-in through Firebase
  Authentication with Identity Platform. A verified email AND a completed phone MFA
  challenge on the same account are required by the server. Merely linking a phone
  as an alternative sign-in method is not sufficient. There is no SMS-only parent
  login or universal admin PIN.
- Server-stored opaque sessions in an HttpOnly, SameSite=Strict cookie; Secure except
  in explicitly loopback-only emulator mode. Only a hash of the random session token
  is stored. Firebase credentials stay in memory temporarily, then the SDK signs out.
- CSRF protection, exact Origin checks, bounded JSON bodies, no-store private
  responses, CSP/security headers, strict payload fields and no credential logging.
- One owner / one family for this milestone. Random child IDs, family-scoped data,
  API-only Firestore rules, repeated ownership and role checks inside write transactions.
- Children start only after an operator grants a manual pilot entitlement. Default
  allowance is ZERO. An atomic transaction reserves the child slot and creates the
  profile and credential; idempotent retries do not create duplicate children.
- Six-digit child PINs: server-only salted scrypt hash plus a server-held pepper,
  per-child cross-device attempt budget and family-level throttle. PIN reset
  increments a credential version and invalidates existing child sessions.
- Handing over the device changes the SERVER session to selector mode. Entering a PIN
  changes it to one-child mode. Old tabs cannot retain parent permissions. Returning
  to parent mode needs fresh password + SMS authentication. A server-side barrier also
  rejects a copied Firebase token from before handover, even with a new cookie.
- Paid access checked against server time and current entitlement, not localStorage,
  a hidden button or a long-lived subscribed claim. Downgrades require explicit active
  profile selection; excess child sessions stop working on their next API request.
- No browser endpoint for granting entitlements, deleting data, changing roles or
  editing a wallet. Manual pilot grants use an IAM-protected operator script.

## Not implemented in this step

The learning engine, progress ledger, reward shop, real-money payments, final privacy
consent, second guardian invitations, account deletion/export, full recovery flows,
operator UI and migration of existing children are NOT connected yet. Child mode
intentionally ends at a protected profile screen; it does not fall through to the
insecure legacy application. Losing the only MFA factor currently requires a vetted
operator recovery procedure; do not promise self-service recovery to paying customers.

Email/mobile verification and an adult checkbox are NOT legal proof of adulthood or
parental responsibility. `pilot-v1` is a test acknowledgement, not approved launch terms.
Use synthetic child data until the launch-country privacy/consent review is complete.

## Local checks (no dependencies or cloud access required)

```sh
cd commercial
npm test
```

These tests use the actual authorization service and claim-validation adapter, a
serializable in-memory transactional store, and synthetic identity-provider responses.
The scrypt test uses the real production hashing implementation. This is not the same
as a Firebase emulator or live-project integration test.

## Full local pilot with Firebase emulators

Requires Node 22+, Java 21 and internet access for installation/initial SDK downloads.

```sh
cd commercial
npm install
cp .env.example .env
# Generate TWO independent secrets and insert them into .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run emulators
# In another terminal:
npm start
```

Open `http://127.0.0.1:8787`. The Auth emulator displays verification links and SMS
codes rather than sending real messages. Enrol the SMS second factor after verifying
email, then sign in again. No fake production login exists. The browser loads the
pinned official Firebase Web SDK from gstatic; the page needs that connection even
when Auth/Firestore are local. SDK vendoring/bundling is a release-hardening item.

Create the family with synthetic data. Its family reference appears in the parent
workspace. In another terminal grant a pilot allowance (replace UUID and expiry):

```sh
npm run grant -- FAMILY_UUID 2 2026-12-31T00:00:00Z "Private pilot grant"
```

For a downgrade, append the child UUID(s) that should retain access. To remove all
seats, pass `0` and append `none`. An expired `accessUntil` blocks child access while
keeping parent account management available. The script records actor/reason but
operator identity is enforced by IAM, not by the text of the actor field.

```sh
npm run test:emulator
```

The integration test is guarded to use only `demo-am-foundation` at the specified
loopback emulator ports. It tests a real emulator-issued SMS MFA token, Firestore
concurrent seat creation, deny-all client rules and entitlement expiry.

## Data layout

- `parents/{uid}`: family association, reauthentication barrier and pilot acknowledgement.
- `families/{uuid}`: display label, child IDs, active child IDs and authoritative entitlement.
- `families/{uuid}/members/{uid}`: ownership/status.
- `families/{uuid}/children/{uuid}`: non-secret child profile.
- `families/{uuid}/credentials/{uuid}`: PIN hash and credential version; API never returns it.
- `families/{uuid}/pinAttempts/{uuid}`: server-side attempt reservations.
- `families/{uuid}/operations/{uuid}`: idempotency records; no plaintext PINs.
- `sessions/{sha256(randomToken)}`: role, owner, optional child, CSRF secret and expiry.
- `audit/{uuid}`, `rateLimits/{opaqueKey}`: security events and distributed throttles.

A parent session lasts at most 30 minutes. Selector/child mode lasts at most 12 hours,
but revocation, membership, PIN version and entitlement are rechecked at use. A parent
operation requiring fresh authentication has a five-minute authentication-age limit.
The clock barrier uses the later of server time and the original authentication time.

## Staging configuration - do not deploy to the prototype project

1. Create a **new** Firebase/GCP project. Enable Firestore and Firebase Authentication
   with Identity Platform, email/password, email verification and SMS MFA. Configure
   allowed domains, SMS destinations, provider quotas, email enumeration protection,
   enforced password policy (12+ characters), monitoring and suitable test numbers.
2. Deploy `firestore.rules` only to that new project. The Admin SDK bypasses these
   rules: restrict IAM, never expose service credentials, and keep the API checks.
3. Use separate runtime and operator identities. Supply `SESSION_SECRET` and
   `PIN_PEPPER` from Secret Manager. Do not commit `.env` or service-account JSON.
4. Deploy the API/container on Cloud Run, behind HTTPS on one canonical origin.
   Set `APP_MODE=staging`, `APP_ORIGIN`, `FIREBASE_PROJECT_ID`, new web configuration
   and the two secrets. REMOVE all emulator variables. The guarded `npm run deploy:staging` helper is documented in DEPLOY_V3.md.
5. Prefer a same-origin Firebase Hosting rewrite to the Cloud Run service. It must
   route BOTH the public shell/assets and `/api/**` to this server (otherwise replicate
   the security headers on static hosting). The `__session` cookie name is deliberate:
   Firebase Hosting strips other incoming cookies on rewritten dynamic requests.
6. Set an edge abuse limiter/bot protection, request budget alerts, CPU/memory limits,
   max instances and restrictive runtime IAM before opening registrations. The fallback
   login-IP limiter intentionally ignores untrusted X-Forwarded-For; behind a proxy it
   can group users and is NOT a substitute for a correctly configured edge limiter.
7. Real mobile/email delivery, recovery, revoked identities, multi-device handover and
   Safari/Android sign-in need testing in staging. SMS MFA is stronger than contact-only
   verification but adds SMS friction and cost at new parent sign-ins.

## Release blockers / security limits

- Generate, review and commit a package lock before staging deployment (Docker now uses
  `npm ci`; CI bootstraps a lock only when one is missing), pin action
  commit SHAs, scan dependencies, and vendor the pinned browser SDK. Direct dependencies
  are pinned, but transitive resolution is not frozen in this first draft.
- Finish learning/reward server-side authorization before connecting the old game.
- Replace the pilot acknowledgement with reviewed legal/privacy/retention controls.
- Implement export/deletion and vetted MFA recovery, backups AND restoration drills,
  revocation/expiry data cleanup and operational alerts. Expired sessions are already
  denied logically; configure a retention cleanup job rather than retaining them forever.
- All raw Firestore access is API-only. Anyone with project/service-account privileges
  can still modify data; protect IAM and review operator access separately.
- A child PIN is a convenience gate inside an authorized family context, not a
  high-entropy account credential. A browser and already-delivered content remain
  user-controlled; no claim of cheat-proof exams or uncopyable JavaScript is made.
- Have an independent deployment-level security review before a public paid launch.

## Reference implementation guidance

- Firebase SMS MFA: https://firebase.google.com/docs/auth/web/multi-factor
- Session/cookie and CSRF patterns: https://firebase.google.com/docs/auth/admin/manage-cookies
- Hosting cookie forwarding: https://firebase.google.com/docs/hosting/manage-cache
- Firestore transactions: https://firebase.google.com/docs/firestore/manage-data/transactions
- Firestore server-library authorization caveat: https://firebase.google.com/docs/firestore/security/rules-conditions
