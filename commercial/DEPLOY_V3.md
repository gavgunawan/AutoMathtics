# AutoMathtics v3.0: GitHub and live private-pilot deployment

## What this release is

v3.0 is the Step 1 account/security foundation. It is NOT the old game with a new
login screen: learning, progress, rewards and payments are not connected yet.
Keep the existing root `index.html` and its v2.2.1 Firebase project unchanged.
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

## 5. Deploy v3.0

```bash
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
connected in this release. Do not send users back into v2.2.1 with this session.

The GitHub branch/PR itself does not deploy or merge anything. A manual Cloud Run
and Hosting deployment publishes a pilot URL only after your cloud setup succeeds.
To roll back a later pilot revision, restore the previously tested Cloud Run revision
and compatible Hosting release in their consoles. This does not revert database
writes. Keep tested backups. Do not delete the new project/secrets as a rollback.
The original v2.2.1 site is unaffected throughout.

## Official references checked for this release

- Cloud Run with Hosting: https://firebase.google.com/docs/hosting/cloud-run
- Source deploy/IAM: https://cloud.google.com/run/docs/deploying-source-code
- SMS MFA and authorized domains: https://firebase.google.com/docs/auth/web/multi-factor
- Cookie forwarding: https://firebase.google.com/docs/hosting/manage-cache
