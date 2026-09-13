# AutoMathtics v3.0: GitHub and live private-pilot deployment

## What this release is

v3 is the commercial build: the parent account and security foundation (Stage 1), the whole
learning game behind the server (Stage 2), subscriptions and payments (Stage 3), and the Stage 4
provider, recovery and pilot work (`STAGE4_PLAN.md`).
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
  This is cloud operating cost, not customer subscription payments. Blaze has no
  monthly fee; the free allowances of Firestore, Cloud Run, Hosting, Secret Manager
  and logging cover pilot scale, and SMS is billed per message. In Google Cloud
  Billing → Budgets & alerts create a budget of 5 USD for the project with alerts
  at 50, 90 and 100 %. Alerts and max-instance settings are NOT absolute spending caps.
- Create the default Cloud Firestore database in Native mode, production/locked
  rules. Singapore (`asia-southeast1`) is the example location used by this guide;
  review your data-location obligations before choosing. Do not create an open
  test-mode database or copy the live children's records.
- Upgrade Authentication to Identity Platform. Enable Email/Password and, under
  Sign-in method > Advanced, SMS Multi-factor Authentication. This build requires
  email verification and phone MFA on the SAME parent account. SMS-only login is
  not accepted. Under Authentication > Settings > SMS region policy allow only the
  countries your parents live in, so nobody elsewhere can run up SMS charges; set
  a daily SMS quota. Do not add your own mobile as a *test phone number* unless you want it to
  receive no SMS at all: a test number gets a fixed code and the provider sends nothing, which
  looks exactly like a lost SMS.
  The app adds its own resend ladder on top (section 5, block F): one code at once,
  then 5 seconds, 5 seconds, 2 minutes, 15 minutes, 1 hour, 6 hours and 12 hours
  before the next ones, and a day before the ninth.
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
npm ci --ignore-scripts --no-fund --no-audit
npm test
npm run test:emulator
```

`npm ci`, never `npm install`. The committed `commercial/package-lock.json` (and `functions/package-lock.json`
for the SMS ladder) is the dependency tree that was reviewed, tested and audited, and `npm ci` installs exactly
that. `npm install` resolves afresh against the registry and rewrites the lockfile, so a deploy after it would
ship a tree nobody looked at: the deployment helper refuses a lockfile that differs from the committed one,
CI fails without one, and the Dockerfile builds only from it. To change a dependency: edit `package.json`, run
`npm install --ignore-scripts` on your own machine, review the lockfile diff, run both suites and the audit
below, commit. Do not deploy with failing tests, unaccepted security advisories or an installation error.
If using a private repository, authenticate Git using GitHub's normal flow.

CI runs `npm audit --omit=dev --audit-level=high` against the committed lockfile after the unit suite: a
high or critical advisory in a production dependency fails the build. Accepted advisories as of 9 Sep 2026,
to revisit at the next dependency bump:

- GHSA-w5hq-g745-h8pq (moderate; `uuid` < 11.1.1, a missing buffer bounds check in v3/v5/v6 when a buffer
  is supplied), reached only through `firebase-admin` → `@google-cloud/storage` → `teeny-request` /
  `retry-request`, and through `gaxios`. Cloud Storage is not used anywhere in v3 and gaxios calls only
  `uuid.v4`, so the vulnerable functions never run. `firebase-admin` 14.3.0 and `firebase-functions` 7.3.2
  carry no upstream fix; the only "fix" npm offers is a downgrade to firebase-admin 10, which is no fix.

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
  --member="serviceAccount:$RUNTIME_SA" --role=roles/firebaseauth.admin   # Stage 4: deletes sign-in accounts and removes second factors

node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | \
  gcloud secrets create am-v3-session --data-file=- --project "$PROJECT_ID"
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | \
  gcloud secrets create am-v3-pin-pepper --data-file=- --project "$PROJECT_ID"
for SECRET in am-v3-session am-v3-pin-pepper; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
done
```

**Only with `PAYMENT_PROVIDER=fake`** (Stage 3.3, no real money): the signing secret of the fake
provider's webhooks (see `PAYMENTS.md`). Skip this block when deploying with Stripe.

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | \
  gcloud secrets create am-v3-webhook-fake --data-file=- --project "$PROJECT_ID"
gcloud secrets add-iam-policy-binding am-v3-webhook-fake --project "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
```

**Stage 4.1 — Stripe instead of the fake provider** (only when the owner has a Stripe account;
test mode has no fees, and `config.mjs` refuses a live key anywhere but production):

```bash
# from the Stripe dashboard (test view): the secret key, then the endpoint's signing secret
printf '%s' 'sk_test_...' | gcloud secrets create am-v3-stripe-key --data-file=- --project "$PROJECT_ID"
printf '%s' 'whsec_...'   | gcloud secrets create am-v3-webhook-stripe --data-file=- --project "$PROJECT_ID"
for SECRET in am-v3-stripe-key am-v3-webhook-stripe; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
done
```

The endpoint address is known before anything is deployed: it is
`https://PROJECT_ID.web.app/api/webhooks/stripe`. In the Stripe sandbox (Developers → Webhooks →
Add endpoint) register it for the events `checkout.session.completed`, `invoice.paid`,
`invoice.payment_failed`, `customer.subscription.deleted`, `refund.created`, `refund.updated`,
`charge.dispute.created`, `charge.dispute.closed`, and copy the endpoint's
signing secret (`whsec_…`) into `am-v3-webhook-stripe` above. Deploy with
`PAYMENT_PROVIDER=stripe STRIPE_PRICE_STARTER=price_… STRIPE_PRICE_FAMILY=price_…
STRIPE_PRICE_BIG=price_…` in front of `scripts/deploy-staging.sh`; the helper then requires the two
Stripe secrets instead of the fake one. Locally, `stripe listen --forward-to
127.0.0.1:8787/api/webhooks/stripe` prints a `whsec_` for `WEBHOOK_SECRET_STRIPE` and forwards real
test-mode events to the emulator-backed server (`PAYMENTS.md` → Stripe).

Run creation commands once. If a resource already exists, inspect and reuse it;
do NOT generate replacement PIN peppers, overwrite secrets or delete resources to
make a command succeed. Deployment uses secret version `1`. Rotation requires an
explicit migration/recovery plan. Secret values are piped directly to Secret Manager.
The runtime account can access only the individually granted secrets.

### 4b. Firestore TTL policies (once per project)

The server stamps short-lived records with an `expireAt` timestamp; Firestore deletes them only
if a TTL policy names that field for the collection group. Run once, after the database exists:

```bash
for GROUP in sessions rateLimits pinAttempts operations audit recoveries sweeps reports outbox feedback feedbackDays leaving; do
  gcloud firestore fields ttls update expireAt --collection-group="$GROUP" \
    --enable-ttl --project "$PROJECT_ID"
done
```

`checkouts`, `billingChangeIntents`, `billingReconciliations`, `deletions`, `billingEvents`, `billingCustomers` and `families/*/billing` carry no
`expireAt` on purpose: they are financial idempotency and recovery evidence and are kept under the
retention policy in `PAYMENTS.md`, never by TTL (S3.4-G). `supportOperations` and `incidents` carry
none either: the first records which operator started which corrective action, the second is the
incident log a postmortem is written from (`INCIDENTS.md`; `SUPPORT.md` → retention). The audit rows
those actions write do expire, with every other audit row, 400 days after each row.

`emailPrefs` (email-v1) has no `expireAt` either: it is the parent account's consent record and lives as long as the sign-in
account. `reports` (the weekly email's claim and outcome, 400 days) and `outbox` (the fake mail provider's copies, 14 days) do
expire; on a project set up before email-v1, block G requests those two policies (section 5b). `feedback` (the notes from
*Send feedback*, 400 days) and `feedbackDays` (their daily counts, 8 days) expire the same way; on a project set up before
them, rerun block B, which requests only the policies not yet listed (section 5c). `leaving` (why a family cancelled or paused,
400 days after each record) expires too, and block G requests it as well.

Learning sessions live under `families/*/learning/*/sessions`, whose collection group is
`sessions` as well, so the first line covers them. Deletion runs within about 24 hours of the
timestamp; nothing in the code relies on it for correctness, only for bounded growth.

Blocks B, F and G request each policy with `--async` only when none is listed, then verify every group with
`gcloud firestore fields ttls list --collection-group=GROUP --project "$PROJECT_ID" --format 'value(ttlConfig.state)'`
and print `TTL GROUP: STATE`: `CREATING` while Firestore applies it to existing documents, `ACTIVE` once
done. A group that shows nothing has no policy at all — the case that used to hide behind a discarded
stderr — so the block names it in a `WARNING` line and ends with `BLOCK B DONE WITH WARNINGS` (or
`BLOCK F …`) instead of `DONE`: rerun the block, or look under Firestore → Time-to-live in the console.

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
`TRUSTED_PROXY_HOPS=2`, then from any machine run
`curl -H 'X-Forwarded-For: 203.0.113.250' https://PROJECT_ID.web.app/api/health`. The answer carries
`forwarded`, the number of entries the server saw in that header, and `leading` when your fake
entry survived (addresses are otherwise never returned). The value to keep is `forwarded` minus one
if `leading` is present, else `forwarded`: `{"forwarded":3,"leading":"203.0.113.250"}` means 2. If
it differs from 2, redeploy with that number.

The raw `*.run.app` hostname stays reachable — Hosting's rewrites need the service public — and a
caller who goes there passes one Google hop, not two, so with the hop count measured through Hosting
it could forge the client entry of `X-Forwarded-For` and pick its own rate-limit key. The server
therefore spends every address budget twice: on the client's key and on the *peer's* — the last entry,
appended by the Google frontend that accepted the connection, which nobody can forge. Through Hosting
the peer is Hosting's egress, shared by every visitor, so that budget is twenty times the client's
(`peerFactor` in `createApp`); straight at the run.app hostname the peer is the caller itself. The
recovery forms have the same second wall and a cap per instance. Keep advertising only the
`web.app` address.

**Which commit is running.** The deploy helper records the commit it deploys from as `RELEASE_SHA` in
the service's environment and as a `release-sha` label on the revision, refuses to deploy from a dirty or
commitless checkout (and stops when git cannot answer), uploads the commit itself — exported with
`git archive` from the repository's top level before the suites run (from inside `commercial/` git would scope
the archive to the current directory and export nothing; the suite runs that export, the needed-files check, the
re-check after the suites and the verdict gate in a throwaway repository), byte-exact whatever the operator's
line-ending configuration (`-c core.autocrlf=false`),
never the working tree as it stands minutes later — re-checks the
checkout after the suites, and after the deploy `scripts/verify-release.mjs` (tested by the suite) requires
that `/api/health` reports that very commit (`release`) and that the revision just created is the ready one,
labelled with it and serving all traffic: a rollback that pinned traffic to an older revision of the same
commit would otherwise let a redeploy with a new environment pass while serving nothing. So `curl https://PROJECT_ID.web.app/api/health` answers "which code is on staging" with a
commit hash anyone can compare with the release branch — that is the evidence a device test is against
a given release, not a line in a terminal. The nightly sweep job does not carry it (it runs from the same
image; `gcloud run jobs describe` shows the image digest).

**Open tabs learn of a new release.** `/api/bootstrap` carries the same `release` (the version when there is no commit). The app
remembers the first one it saw and compares again on every refresh, and in the background (GET `/api/health`, which reads and
sets no cookie, and never while a request is in flight) whenever the tab comes back into view and every five minutes while it
is in view; a different release shows a bar, *A new version of AutoMathtics is ready.*, whose *Update now* reloads the
page. It never reloads by itself, and on the kids' tablet it waits until a paper ends. A tab coming back into view refreshes
nothing itself: a change of session made in another tab reaches it by the tabs' own signal, so it can never overwrite a cookie
that other tab has just rotated. During a deploy's traffic switch the first answers may come from either revision, so a tab may
show the bar once too often (tapping it reloads what is already the new version) or once too late (the next check shows it).
Tabs opened before the first release that has this checker need one manual reload (`ACCEPTANCE.md` U1).

```bash
export TRUSTED_PROXY_HOPS=2
npm run deploy:staging
```

After the first deployment, schedule the nightly invariant sweep (`RECONCILIATION.md` → Routine sweep)
with `scripts/cloudshell/05-sweep-job.sh`: a Cloud Run job from the same image running
`node scripts/support.mjs sweep` under the runtime account, triggered by Cloud Scheduler at 03:15
Singapore time. Both are inside the free tiers at pilot scale; a failed job is the alert.

Then the SMS resend ladder (`scripts/cloudshell/06-sms-ladder.sh`, block F): an Identity Platform
*blocking function* (`functions/index.js`, Cloud Functions 2nd gen, inside the free tier at pilot scale)
that the provider consults before every verification SMS — a parent enrolling a mobile, the second
factor at sign-in — and that refuses while the number is on a rung it has not waited out: 5 seconds
after the first code and 5 seconds after the second (the owner's burst of three: 30 seconds on 11 Sep 2026, 5 on 13 Sep), then
2 minutes, 15 minutes, 1 hour, 6 hours, 12 hours, and a day before the ninth; a day without a code to
that number starts the ladder over (`functions/ladder.mjs`). The last rung and the quiet period are the
same day, so a run holds at most eight codes and the ninth, a day later, is the first rung of a new run.
The record
(`smsLadder/{hmac}`) holds timestamps under an HMAC of the number (secret `AM_V3_SMS_PEPPER`), never
the number, and expires by TTL after two days. The block creates the secret; the function's own service
account `automathtics-v3-sms-ladder@PROJECT_ID.iam.gserviceaccount.com`, holding `roles/datastore.user` on
the project and `roles/secretmanager.secretAccessor` on `AM_V3_SMS_PEPPER` and nothing else (the v3 runtime
account carries `roles/firebaseauth.admin` and every server secret, far more than a function reachable through
the identity provider should run as); the TTL policy (verified, section 4b); and `functions/.env.PROJECT_ID`
(that account, no secrets). It deploys the function with the Firebase CLI — which registers it under
Authentication → Settings → Blocking functions → *Before SMS is sent* — prints that registration, and only
then takes back the pepper grant an earlier run gave the runtime account. The provider's own SMS quota and
the region policy (section 2) still apply underneath.

In the browser the Send button of the verify-mobile, sign-in challenge and change-mobile screens is disabled
until a code may go, and counts down in hours, minutes and seconds (`0:12:48`), ticking every second. It counts
from the provider's seconds when the refusal is relayed, which arrives as `auth/internal-error` carrying
`HTTP Cloud Function returned an error … Message: SMS_WAIT:<seconds>`. Do not count on that: no refusal has yet
been seen at a browser. The bare `auth/internal-error-encountered.` of 10 Sep 2026 belongs to a send the ladder
*allowed*, and decodes back to the provider's own generic "Internal error encountered.", i.e. the provider
failing rather than our refusal being forwarded. `public/sms-schedule.js` reads the wait from the error's code as
well as its message, because a provider string with no ` : ` in it is folded whole into the code. Otherwise the
button counts from the device's own copy of the ladder: `public/sms-schedule.js` carries the same table
(`tests/sms-ladder.test.mjs` fails if it ever differs from `functions/ladder.mjs`), and `public/auth.js` keeps
the times of the codes this device asked for in `localStorage` (those the provider accepted, and failures that
may have been the ladder's refusal), one record per destination under an HMAC keyed on the device (the typed
number, or the enrolled factor on a sign-in challenge), never the number in clear. That copy is display only and is also the device's throttle between sends; the function stays the
authority. With neither the provider's seconds nor a record on the device, `public/app.js` answers a refusal
that carries nothing with a sentence covering both a spaced-out code and a provider fault.

**A rung is spent when the provider asks, not when an SMS arrives.** A blocking function is consulted before
the send and no hook reports delivery, so codes the provider then fails to send still climb the ladder: a
parent hitting a delivery fault is pushed past the two 30-second rungs to 2 minutes, then 15 minutes, by
failures alone. When that happens, clear the number's record before asking them to try again. The ids in
`smsLadder` are opaque HMACs that nobody can map back to a number, so during the pilot delete the collection's
documents in the Firestore console (they hold only timestamps and expire by TTL after two days anyway).
Clearing the record does not reach the parent's device: its countdown counts the codes it asked for, so a device
that sent codes which never arrived still counts down to its own next rung. The parent can wait for zero, or use a
private window, which starts with no record. Or have the parent open the app once with `?resetsms` added to its address (for example `https://automathtics-v3-staging.web.app/?resetsms`): that removes every countdown record on that device, and the address is tidied again at once.

The provider gives a blocking function 7 seconds and treats silence as an error, so the function keeps its own
clock: no record is written once 4 s have passed (a commit landing after the provider gave up would count a
code that was never sent), and the whole transaction is raced against 6 s. On that deadline, a Firestore
error or any other infrastructure failure the SMS is *allowed* and one log line says `allowed-on-error`
with the reason and the milliseconds: the ladder is abuse protection, and a parent must still be able to
sign in when a rate limiter hiccups. A deploy without the pepper is not a hiccup: every SMS then fails
with `SMS_LADDER_MISCONFIGURED` and the log says `misconfigured`, so the missing secret is noticed at once.

The block also grants `roles/cloudbuild.builds.builder` to the project's default compute account
(`PROJECT_NUMBER-compute@developer.gserviceaccount.com`): the Firebase CLI builds the function with Cloud
Build, which runs on that account, and since Google stopped giving it Editor by default it cannot build
without an explicit role. The builder role is broader than the build needs. Once a deploy has succeeded,
retry with `roles/run.builder` alone (the role block B already grants that account for Cloud Run source
deploys): remove the builder binding, rerun the block, and if the function still deploys leave the builder
role out for good.

```bash
source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/06-sms-ladder.sh)
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
The footer should show `v3.0 · 6 Sep 2026` and `/api/health` should report `3.0.0`.
Cloud Run's infrastructure permits unauthenticated HTTP so the sign-in page can
open; private API operations still require the application's authenticated session.
No edge abuse-protection system is configured by this helper. Keep the pilot
unadvertised and configure/test that protection before broad registration.

## 5b. Email: the weekly progress report (email-v1)

Every Monday at 07:00 Singapore time a Cloud Run job (`node scripts/report.mjs send`, from the service's own image) sends each
family one email about the last complete ISO week in Singapore, the same week for every family: per child what was right and
fast, right but slow, and wrong again and again, the totals, a goldilocks pace and a System Scan focus offer. It goes to the
owner's current address at the identity provider, and only if that address is verified and the account not disabled; if the
identity provider cannot be asked, the family fails and the next run tries again. There is no email for a week without play,
with the weekly report switched off, or without an active entitlement. `reports/{familyId}:{week}` holds one claim and its
outcome per family and week (status only, TTL 400 days), so overlapping or repeated runs never send twice.

**The time-zone edge.** Each family's answers count by the family's own local dates, but the week is Singapore's. A family
west of Singapore is still in its Sunday at Monday 07:00 Singapore time: answers it gives later that Sunday are dated in the
reported week, arrive after its email, and no report counts them. One week per run is deliberate: computed family by family,
a run near a daylight-saving change or a midnight could report two different weeks, and never the same one twice.

The buttons in an email open the app, which says what the button does and changes nothing until the parent taps Confirm.
Mail apps get RFC 8058 one-click unsubscribe at `https://PROJECT_ID.web.app/api/email/unsubscribe`. The buttons carry their
tokens in the URL fragment (`/#email=…`), which never reaches a server or its request logs; the List-Unsubscribe URL has to
carry its stop-the-report token in the query, because the mailbox provider posts to it, so Cloud Run's request log does record
those tokens, which can switch the weekly report off and nothing else (`PRIVACY.md`). The web service needs
nothing new: the buttons are signed with `SESSION_SECRET` (under a key derived for them alone), which it already has, and
rotating that secret voids every button already sent.

**Before a Resend account exists** (only the owner can open one), run block G as it is. `EMAIL_PROVIDER=fake` sends nothing:
each rendered email lands in Firestore → `outbox` for 14 days (TTL), where it can be read, and a family's deletion removes its
copies at once.

**With Resend** (free: 3,000 emails a month, 100 a day, no branding):

1. The owner signs up at https://resend.com with their own email address and creates an API key with *sending access* only.
2. In Cloud Shell the owner types the key into Secret Manager, never into a chat or a file:
   `printf '%s' 're_...' | gcloud secrets create am-v3-email-key --data-file=- --project "$PROJECT_ID"`
3. Rerun block G with the provider named. It grants the runtime account the key, updates the job and the schedule, and ends
   with a dry run that sends nothing:
   `EMAIL_PROVIDER=resend source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/07-report-job.sh)`

**The pilot sender limitation.** Until a domain is verified at Resend the sender is `AutoMathtics <onboarding@resend.dev>`, and
Resend delivers only to the address that owns the Resend account. That is enough for the pilot, where the owner is the only
parent. **Before any other family**: verify a domain at Resend (its SPF and DKIM records in the domain's DNS), rerun block G with
`EMAIL_FROM='AutoMathtics <reports@THE-DOMAIN>'`, and put the email wording through the legal review with the rest of the
privacy terms (`PRIVACY.md` → Before real families).

Block G (`scripts/cloudshell/07-report-job.sh`) is a copy of block E. It sets TTL policies on `reports` (400 days) and `outbox`
(14 days), requested and verified like block B. It creates the job `automathtics-v3-report`, running
`node scripts/report.mjs send` with `APP_MODE`, `FIREBASE_PROJECT_ID`, `CONFIRM_PROJECT`, `OPERATOR_ID=scheduler@PROJECT_ID`,
`APP_ORIGIN`, `EMAIL_PROVIDER` and `EMAIL_FROM`, the secret `SESSION_SECRET=am-v3-session:1` and, with Resend only,
`EMAIL_API_KEY=am-v3-email-key:1`. It schedules `automathtics-v3-report-weekly` at `0 7 * * 1` Asia/Singapore, then does a dry
run. A run in which any family fails, or is found still held by another run (`busy`: a claim younger than 15 minutes), exits 2,
so Cloud Run shows it failed; one family's failure never stops the others.
Executing the job again retries what failed. Each send carries the Idempotency-Key `report:FAMILY:WEEK`, which Resend keeps for
24 hours: a retry inside them with the same bytes gets the first answer back and no second email, and the same report does
render the same bytes, because every button's expiry follows from the week and nothing else in the email moves with the clock.
If the email changed meanwhile (the parent changed a pace between the attempts, say), Resend refuses the key as reused with
another body (409 `invalid_idempotent_request`): an email under that key reached Resend already, so the family is recorded as
`sent_unconfirmed` and never sent again. A key whose first request is still in flight (409 `concurrent_idempotent_requests`)
says nothing yet: the family is recorded as `failed` (`PROVIDER_IN_FLIGHT`), and the next run retries it, when Resend answers
with the first email. A retry more than 24 hours after a first attempt whose answer was lost can deliver a second email.

```bash
source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/07-report-job.sh)
```

To see every family's decision without sending anything, execute the job with overrides:
`gcloud run jobs execute automathtics-v3-report --region asia-southeast1 --args scripts/report.mjs,send,--dry-run --wait`, then
read its log (one line per family: `sent`, `sent_unconfirmed`, `skipped` with the reason, `busy` while another run holds it, or
`failed` with its code; never an address or a token). `--family FAMILY_UUID` and `--week 2026-W36` narrow a run; `preview
FAMILY_UUID` prints one family's email with inert links. A past week's email goes out without the pace and scan-focus buttons
once they have expired (14 days after the week), with a line that says so and points to the app; a week whose stop-the-report
link would be dead (a year after it) is refused (`WEEK_TOO_OLD`), since no email may carry a dead link. The arguments are strict: an unknown word, a repeated option or an option without its value exits 64 with the
usage, so a slip can never widen a run to every family.

**Weekly, monthly or off (the leaving flow, 12 Sep 2026).** A parent may have the progress report weekly, once a month, or not at
all (`emailPrefs.cadence`; off is the old *progress* switch). A monthly family gets one email on the **first Monday of the
month**, covering the four complete weeks before it — the same report over a longer span, with the same buttons and the same
claim — so the job skips it on every other Monday with the log reason `monthly_not_due`. The week that sends is the one whose
following Monday falls on the 1st to the 7th, which follows from the week alone, so `--week` decides what the scheduled run
decided.

**The monthly leaving report.** On that same first Monday the job also emails the owner one plain report of the month just ended:
how many families cancelled, paused, downgraded or asked for fewer emails, each as a share of the families active when the month
began, the reasons ranked, the offers shown against the offers taken, the plan, seat and cohort mixes, and the three months
before for the trend. It goes to `FEEDBACK_TO`, or to `OWNER_EMAIL` when that is not set; with neither it is skipped with the log
line `no_owner_address`, never guessed at — pass `OWNER_EMAIL=…` when running block G to set it. `reports/leaving:{YYYY-MM}` is
its claim, so overlapping or repeated runs send one email a month; a month in which nothing happened writes a log line and sends
nothing; a month still running is refused (`MONTH_NOT_COMPLETE`). Months are UTC. By hand:
`gcloud run jobs execute automathtics-v3-report --region asia-southeast1 --args scripts/report.mjs,leaving,--month,2026-08 --wait`
(add `,--dry-run` to decide it and send nothing). It signs no buttons, so it needs neither `SESSION_SECRET` nor `APP_ORIGIN`.

## 5c. Feedback

*Send feedback* sits under the sign-in screen and under every parent screen, never in kid mode (from *Hand over to kids* until a
parent signs in again on that device, remembered across reloads). A note is 1 to 2000 characters and names the screen it came from; on the sign-in screen the sender may
add an address to be answered at. The server decides who sent it: a parent's session names the parent and the family, the
sign-in screen names nobody, and a child's or the launch pad's session is refused. Each note is kept in `feedback/{id}` for 400
days (TTL, block B), with the release it was sent from. A parent's session is rechecked as on every
session route: one revoked by a password change, or superseded, sends nothing. A retried send carries the same operation id and
stays one note. Budgets are signed-out senders' and parents' apart, so that no signed-out traffic (a forged `X-Forwarded-For` straight at
the run.app host, or an IPv6 /56 rotating its /64s through Hosting) can spend what a parent needs. Signed out, an hour: 5 per
address (an IPv6 /64 counts as one address), 10 per IPv6 /56, 20 per peer (the front end the request came through), 20 per
instance, and 10 a day per pre-authentication cookie. Parents, an hour: 5 per address, twenty times that per peer, 100 per
instance, and 10 a day per session. Every budget is looked at before the note's transaction, so a flood of refusals locks
nothing, and spent in it, only for a note that is kept; an instance's slot is taken at its check and given back when the note
is refused or is a retry. Per UTC day (`feedbackDays/{day}`, TTL 8 days), whatever the
addresses or cookies: at most 100 notes from signed-out senders, all of them together (after that 429 `FEEDBACK_BUSY` for them,
never for a parent), and at most 20 copies to the owner, 5 of them for notes sent signed out; past a copy cap the note is still
kept, and the CLI below reads it. A family's deletion removes the notes its parents sent, and the sign-in account's deletion those it sent
without a family; the family export carries the family's notes (`PRIVACY.md`).

To read them, in Cloud Shell with the variables `scripts/support.mjs` uses (`APP_MODE=staging`, `FIREBASE_PROJECT_ID`,
`CONFIRM_PROJECT`, `OPERATOR_ID`): `node scripts/report.mjs feedback --days 7` prints one JSON line per note, newest first:
when, the screen, the release, the parent and family when signed in, the address to answer when one was given, and the words.
`--days` takes 1 to 400.

**The waiting list's own sender.** `/join` writes one email back to every new address (server/waitlist.mjs), so it should not
write as the address parents reply to. Export `WAITLIST_FROM='AutoMathtics <no-reply@THE-DOMAIN>'` and
`WAITLIST_REPLY_TO='support@THE-DOMAIN'` before block C: the list then writes as no-reply, and a reader who answers anyway
reaches a person. Without them the list writes as `EMAIL_FROM`, which is blunt but never wrong. Every message carries an
unsubscribe signed for that one address (`/api/waitlist/leave`), working as a click and as RFC 8058 one-click; rotating
`SESSION_SECRET` voids every link already sent, and a reader whose link no longer works can be removed by address by hand.

**A copy in the owner's inbox.** With Resend set up (5b: the key in `am-v3-email-key`, and block G rerun with
`EMAIL_PROVIDER=resend`, which grants the runtime account the key), deploy with the owner's address:
`export FEEDBACK_TO=owner@example.com EMAIL_PROVIDER=resend`, then block C. Each note, within the day's copy caps, then also arrives by email, and Reply goes
to the parent's account address or to the address given on the sign-in screen. The copy is best effort with a three-second
limit: a slow or failing provider never loses the note or fails the parent's request. Every deploy states the service's whole
environment, so keep `FEEDBACK_TO` exported for every later run of block C; a deploy without it stops the copies (the notes are
still kept). With `EMAIL_PROVIDER=fake`, or without `FEEDBACK_TO`, the service emails nothing.

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

## 6b. The operator dashboard - a private file, not a page

There is no dashboard URL and no operator login: no browser route in this release is a generic admin
surface, and adding one would be a new attack surface for one person's convenience. The dashboard is a
read-only command that writes ONE self-contained HTML file wherever you tell it to. Run it in Cloud Shell
or locally with the same operator environment `scripts/support.mjs` needs, then open the file from your own
machine:

```bash
export APP_MODE=staging
export FIREBASE_PROJECT_ID="$PROJECT_ID"
export CONFIRM_PROJECT="$PROJECT_ID"
export OPERATOR_ID='YOUR_OPERATOR_EMAIL'
# SESSION_SECRET, PIN_PEPPER and the provider secret are read from the same place the server reads them
node scripts/dashboard.mjs --out dashboard.html                       # the whole report
node scripts/dashboard.mjs --out dashboard.html --json dashboard.json # and the numbers behind it
node scripts/dashboard.mjs --days 180 --by age                        # a longer daily series, columns by age
```

In Cloud Shell, `cloudshell download dashboard.html` brings it to your machine; delete the copy in the
shell afterwards. The file is plain HTML with inline CSS and one inline SVG: no script, no web font, no
request of any kind, so it opens with the network off. It is never uploaded, never published and has no
URL - if it needs to reach somebody else, that is a decision about a document, not a login to grant.

What it holds, and the rule that keeps it safe to hold:

- **Section 1, households**: how many families there are, when they were created, who is active in the
  last 7 and 30 days, who has been quiet for 30 and 60, the region *derived from the time zone on the
  family record* (the service stores no city and no address), children per household, ages, year levels
  and starting options, a month-by-month subscription calendar from the last 3 months to the next 6
  (trial ends, renewals, cancel-at-period-end dates, the ends of the grace windows, pilot-grant
  expiries), and daily active children per **local** day with 7- and 28-day means and a sparkline.
- **Section 2, speed matrices**: Engine then Navigator, the paper bands the history records down the side
  and year level (or age) across. Each cell is the median seconds per question over the sessions that
  passed with every question correct, with the median share of the allowance used and how many such
  sessions there were. Sessions imported from v2 carry seconds without an allowance and are skipped. Two
  review flags, about a band and never about a child: *passed unusually easily* (median share below 0.5
  and at least 35 % faster than the neighbouring bands of the same sector and kind) and *unusually hard*
  (median share at or above 0.9, or a pass rate below 40 %).
- **Section 3, rewards and the shop**: parent-entered reward names folded into categories by keyword
  (English and Indonesian - `uang jajan` is pocket money, `jajan` a snack, `main game` the console,
  `nonton` watching something), with families, costs, redemptions, approvals, refusals, cost bands and
  the wait to a first redemption; then the shop from the ledger - what is bought and ignored, the share
  of children owning each item, the balance held at the moment of purchase, and what each currency does
  (earned, spent, saved, spent as a share of earned). An appendix lists the de-duplicated raw reward
  names, one per line, with nothing beside them.
- **The suppression rule**: any number computed from fewer than `--min-cell` families (default **5**) is
  not in the file at all - it prints as a dash and is absent from the JSON too. During the pilot that is
  nearly every number, and the header says so plainly so a reader does not mistake it for a fault. Only
  the cohort's own size (how many families and tombstones the report covers) is printed regardless,
  because a reader cannot understand the dashes without it. `--min-cell 1` shows everything; use it only
  where you could defend it, and delete what it produces.
- **Nothing identifying, by construction**: the collector does not even read a nickname or a family
  label, and there is no family, child or parent reference anywhere in the output. A test renders the
  page from a synthetic multi-family store and fails if an id, a nickname or a label appears in the HTML
  or the JSON.

Each run writes exactly one row to the project: `audit/{uuid}` with `action: operator.dashboard`, your
`OPERATOR_ID`, the run's settings and how many families it covered - never which ones. It expires with
the same 400-day TTL as every other audit row (section 4b). Treat the file itself as confidential
working material: `PRIVACY.md` has its inventory row.

## 7. Acceptance and rollback

Run `ACCEPTANCE.md` on the real devices: email and SMS delivery, PIN lockout and reset,
handover in old tabs, seat limits and expiry, placement and the learning game, money in test
mode, recovery, export and deletion, failure states. Verify no secrets reach responses,
logs, page source or Git. A green health check only proves the server is responding.
The pilot family's cutover from v2 follows `PILOT.md`; until then nobody plays in both.

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
- Blocking functions (Identity Platform), including *before SMS is sent*: https://cloud.google.com/identity-platform/docs/blocking-functions
- Firestore TTL policies and their state (`CREATING` → `ACTIVE`): https://cloud.google.com/sdk/gcloud/reference/firestore/fields/ttls/list
- Cookie forwarding: https://firebase.google.com/docs/hosting/manage-cache
