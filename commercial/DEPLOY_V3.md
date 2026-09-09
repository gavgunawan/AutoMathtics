# AutoMathtics v3.0: GitHub and live private-pilot deployment

## What this release is

v3.0 is the Step 1 account/security foundation. It is NOT the old game with a new
login screen: learning, progress, rewards and payments are not connected yet.
Keep the existing root `index.html` and its v2 Firebase project unchanged.
Deploy this `commercial/` folder separately to a NEW Firebase project.
A successful deployment creates a browser-accessible pilot, not a commercial
security certification. Use synthetic child profiles until the privacy and
production-security work in README.md is complete.

GitHub stores the code. Cloud Run executes the Node server. Firebase Hosting gives
it one HTTPS origin. Firebase Authentication and Firestore provide identity/storage.
Uploading the ZIP to GitHub Pages alone will NOT run this application.

## 1. Put the files in GitHub

The intended branch is `release/v3.0` in `gavgunawan/AutoMathtics`.
If that branch already contains this release, do not upload the ZIP again.
Otherwise create a branch from `main`, extract the ZIP, then upload the CONTENTS
of the extracted folder into the repository root using Add file > Upload files.
The layout must be `.github/workflows/...` and `commercial/...`, not
`AutoMathtics-v3.0/commercial/...`. Include hidden `.github` and ignore files.
Do not upload `.env`, service-account keys or node_modules. Do not replace the
root game's index.html. Open a pull request rather than changing the live game.

## 2. Create the separate Firebase project

In https://console.firebase.google.com create a new project, for example with
an available ID similar to `automathtics-v3-staging`. Record the actual PROJECT ID,
not its display name. Do not use `automathtics`; the server explicitly rejects it.

- Link a billing account (Blaze is required for the Cloud Run integration).
  This is cloud operating cost, not customer subscription payments. Set budgets
  and alerts. Alerts and max-instance settings are NOT absolute spending caps.
- Create the default Cloud Firestore database in Native mode, production/locked
  rules. Singapore (`asia-southeast1`) is the example location used by this guide;
  review your data-location obligations before choosing. Do not create an open
  test-mode database or copy the live children's records.
- Upgrade Authentication to Identity Platform. Enable Email/Password and, under
  Sign-in method > Advanced, SMS Multi-factor Authentication. This build requires
  email verification and phone MFA on the SAME parent account. SMS-only login is
  not accepted. Configure allowed SMS countries, quotas and test numbers.
- In Authentication settings, authorize `YOUR_PROJECT_ID.web.app` and
  `YOUR_PROJECT_ID.firebaseapp.com`; configure email templates, an enforced
  password policy (12+ characters) and email-enumeration protection.
- Register a Web app under Project settings > Your apps. Copy `apiKey` and `appId`.
  These are public Firebase web identifiers, NOT a service-account private key.
- Enable Firebase Hosting for this new project's default site. Do not run
  `firebase init` over the supplied configuration or select the old project.

## 3. Open Google Cloud Shell and install/test

Open https://console.cloud.google.com, select the NEW project and open Cloud Shell.
Commands below assume Bash, Node 22+ and Java 21. Check `node --version` and
`java -version`; install/select those versions before running the emulator suite.
Cloud Shell already provides `gcloud` and Git. Use your own logged-in account;
never paste cloud credentials into ChatGPT or GitHub.

```bash
git clone --branch release/v3.0 https://github.com/gavgunawan/AutoMathtics.git
cd AutoMathtics/commercial
export PROJECT_ID='YOUR_NEW_PROJECT_ID'
export CONFIRM_PROJECT="$PROJECT_ID"
export FIREBASE_WEB_API_KEY='YOUR_NEW_WEB_API_KEY'
export FIREBASE_WEB_APP_ID='YOUR_NEW_WEB_APP_ID'
gcloud config set project "$PROJECT_ID"
npm install --ignore-scripts --no-fund
npm test
npm run test:emulator
```

The authoring environment could not access npm. Therefore no fabricated lockfile
is supplied. Review the installed versions and dependency audit, commit the generated
`commercial/package-lock.json`, and keep it for later `npm ci` builds. Do not deploy
with failing tests, unresolved security advisories or an installation error.
The deployment helper and Dockerfile refuse to build without the lockfile.
If using a private repository, authenticate Git using GitHub's normal flow.

## 4. One-time cloud permissions and secrets

These commands change ONLY the explicitly named new project. Review each command.
The setup account needs permission to enable services, create service accounts,
grant the listed IAM roles, and deploy. Do not give the runtime Owner or Editor.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com \
  identitytoolkit.googleapis.com secretmanager.googleapis.com \
  firebasehosting.googleapis.com --project "$PROJECT_ID"

gcloud iam service-accounts create automathtics-v3-runtime \
  --display-name='AutoMathtics v3 runtime' --project "$PROJECT_ID"
export RUNTIME_SA="automathtics-v3-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/firebaseauth.viewer

node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | \
  gcloud secrets create am-v3-session --data-file=- --project "$PROJECT_ID"
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | \
  gcloud secrets create am-v3-pin-pepper --data-file=- --project "$PROJECT_ID"
for SECRET in am-v3-session am-v3-pin-pepper; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
done
```

Run creation commands once. If a resource already exists, inspect and reuse it;
do NOT generate replacement PIN peppers, overwrite secrets or delete resources to
make a command succeed. Deployment uses secret version `1`. Rotation requires an
explicit migration/recovery plan. Secret values are piped directly to Secret Manager.
The runtime account can access only the two individually granted secrets.

### 4b. Firestore TTL policies (once per project)

The server stamps short-lived records with an `expireAt` timestamp; Firestore deletes them only
if a TTL policy names that field for the collection group. Run once, after the database exists:

```bash
for GROUP in sessions rateLimits pinAttempts operations audit; do
  gcloud firestore fields ttls update expireAt --collection-group="$GROUP" \
    --enable-ttl --project "$PROJECT_ID"
done
```

Learning sessions live under `families/*/learning/*/sessions`, whose collection group is
`sessions` as well, so the first line covers them. Deletion runs within about 24 hours of the
timestamp; nothing in the code relies on it for correctness, only for bounded growth.

Cloud Run source builds also require `roles/run.builder` on the actual BUILD
service account. Current defaults commonly use the Compute Engine default account;
check Cloud Build settings first. An administrator can grant the documented build
role to that account (or a dedicated build account) without giving it Owner/Editor.
The build and deployment identities are separate from the runtime identity.
See the official source-deployment permissions guide linked at the bottom.

Authenticate Firebase CLI if it requests it:

```bash
./node_modules/.bin/firebase login --no-localhost
```

## 4c. Optional v2 JSON migration - never connect the old project

Stage 2 includes a dry-run-first migration tool for a reviewed JSON export of the old family game.
It never opens the legacy Realtime Database or legacy Firebase project. Prepare a bundle described in
`STAGE2_LEARNING.md`, then inspect the mapping locally:

```bash
npm run migrate -- FAMILY_UUID CHILD_UUID path/to/child-export.json "reason"   # dry run; add CONFIRM_MIGRATION=write to import
```

The default is **dry run**: Firebase Admin is not even loaded. The report shows mapped tracks, balances,
inventory counts, history rows, pace and warnings. Only after reviewing that output, target the new v3
project and add `--apply`. Existing progress/game config is refused unless `--overwrite` is explicitly added.
For a cloud import, `CONFIRM_PROJECT` must exactly equal the new v3 project and `OPERATOR_ID` must be set.
Never use `automathtics` (the legacy project) as `FIREBASE_PROJECT_ID`.

## 5. Deploy v3.0

The server refuses to start in staging/production without `TRUSTED_PROXY_HOPS`: the number of
trusted proxies in front of it. Each one appends to `X-Forwarded-For` the address it accepted the
connection from, so with N trusted proxies the last N entries are trustworthy and the earliest of
those is the real client. Rate limiting keys on that entry; a wrong count either throttles every
visitor as one client (too small) or lets a client choose its own address (too large). Hosting in
front of Cloud Run is normally 2. Measure it once on the real origin: deploy with
`TRUSTED_PROXY_HOPS=2`, then from a machine whose public address you know (`curl ifconfig.me`)
send `curl -H 'X-Forwarded-For: 203.0.113.250' https://PROJECT_ID.web.app/healthz` while a
temporary log line in `/healthz` prints `req.headers['x-forwarded-for']` (remove it afterwards).
In the Cloud Run log you should see `203.0.113.250, <your address>, <hosting address>`: the
number of entries after the fake one is the value to set. If your address is missing, Hosting
replaced the header and the value is one less.

```bash
export TRUSTED_PROXY_HOPS=2
npm run deploy:staging
```

This helper verifies the new project and secret metadata, runs unit and emulator
tests, deploys deny-all client Firestore rules, builds/deploys Cloud Run, then deploys
Firebase Hosting. The service is `automathtics-v3` in `asia-southeast1`.
It uses 512 MiB memory, 1 CPU, concurrency 4, minimum 0 and maximum 3 instances.
These are pilot defaults, not load-tested production capacity or a cost guarantee.
The script never deploys the old root index.html or changes the legacy database.

Hosting forwards BOTH `/` and `/api/**` to Cloud Run using `firebase.staging.json`.
The `.hosting` folder is deliberately empty. Do NOT set the hosting public folder
to `public/` or the repository root. The server supplies the security headers.
The `__session` cookie name is deliberate because Hosting strips other cookies
on rewritten dynamic requests.

Open `https://YOUR_PROJECT_ID.web.app`. Use that canonical address, not the raw
Cloud Run URL or the alternative firebaseapp.com site; Origin checks require it.
The footer should show `v3.0 · 6 Sep 2026` and `/healthz` should report `3.0.0`.
Cloud Run's infrastructure permits unauthenticated HTTP so the sign-in page can
open; private API operations still require the application's authenticated session.
No edge abuse-protection system is configured by this helper. Keep the pilot
unadvertised and configure/test that protection before broad registration.

## 6. Activate your test family

Sign up with your adult email, verify it, enrol the mobile MFA factor, then sign in
again with password + SMS. Create the family and copy its Family reference.
Every new family starts with ZERO child seats; there is no self-activation button.
Use a separate operator identity with authorized Firestore access to grant test seats:

```bash
export APP_MODE=staging
export FIREBASE_PROJECT_ID="$PROJECT_ID"
export OPERATOR_ID='YOUR_OPERATOR_EMAIL'
# Configure operator Application Default Credentials when your environment needs it:
gcloud auth application-default login
npm run grant:cloud -- FAMILY_UUID 2 2026-12-31T00:00:00Z 'Private v3 pilot'
```

Replace FAMILY_UUID and the expiry with your actual test family and intended end.
The operator tool does not need access to the PIN pepper or session secret.
Refresh the parent workspace. Two seats permit two enabled child profiles.
For a downgrade, append the UUIDs that keep seats; with zero seats append `none`.
Use the UI and staging tests to verify the result. Do not edit Firestore by hand to
bypass application invariants. OPERATOR_ID is an audit label; IAM is the permission.

## 7. Acceptance and rollback

Test email and SMS delivery, iPhone Safari and Android Chrome, incorrect PIN lockout,
parent-to-child handover in old tabs, PIN reset, one-seat/two-seat limits, expiry,
concurrent child creation and cross-family denial. Verify no secrets reach responses,
logs, page source or Git. A green health check only proves the server is responding.
The child screen intentionally stops at the protected profile; no maths game is
connected in this release. Do not send users back into the existing v2 application with this session.

The GitHub branch/PR itself does not deploy or merge anything. A manual Cloud Run
and Hosting deployment publishes a pilot URL only after your cloud setup succeeds.
To roll back a later pilot revision, restore the previously tested Cloud Run revision
and compatible Hosting release in their consoles. This does not revert database
writes. Keep tested backups. Do not delete the new project/secrets as a rollback.
The existing v2 site is unaffected throughout.

## Official references checked for this release

- Cloud Run with Hosting: https://firebase.google.com/docs/hosting/cloud-run
- Source deploy/IAM: https://cloud.google.com/run/docs/deploying-source-code
- SMS MFA and authorized domains: https://firebase.google.com/docs/auth/web/multi-factor
- Cookie forwarding: https://firebase.google.com/docs/hosting/manage-cache
