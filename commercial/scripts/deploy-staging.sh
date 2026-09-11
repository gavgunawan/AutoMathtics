#!/usr/bin/env bash
# Run from Cloud Shell after completing DEPLOY_V3.md. Never source a local .env.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROJECT_ID:?Set the NEW Firebase project ID}"
: "${CONFIRM_PROJECT:?Set CONFIRM_PROJECT to the same project ID}"
: "${FIREBASE_WEB_API_KEY:?Copy the new project web apiKey}"
: "${FIREBASE_WEB_APP_ID:?Copy the new project web appId}"
: "${TRUSTED_PROXY_HOPS:?Set TRUSTED_PROXY_HOPS (0-5) after measuring X-Forwarded-For on the real origin; see DEPLOY_V3.md}"
[[ "$TRUSTED_PROXY_HOPS" =~ ^[0-5]$ ]] || { echo 'TRUSTED_PROXY_HOPS must be 0-5.' >&2; exit 1; }
if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] ||
   [[ "$PROJECT_ID" == "automathtics" || "$PROJECT_ID" == demo-* || "$CONFIRM_PROJECT" != "$PROJECT_ID" ]]; then
  echo 'Refusing unconfirmed, demo or legacy project.' >&2; exit 1
fi
if env | grep -qE '^[A-Z0-9_]*EMULATOR[A-Z0-9_]*=.'; then
  echo 'Remove emulator environment variables before cloud deployment.' >&2; exit 1
fi
for tool in node npm gcloud java git tar; do command -v "$tool" >/dev/null || { echo "Install $tool first." >&2; exit 1; }; done
if [[ ! -f package-lock.json ]]; then
  echo 'Run npm install --ignore-scripts, review and commit package-lock.json first.' >&2; exit 1
fi
# The lockfile is the dependency tree that was reviewed, tested and audited. `npm install` rewrites it whenever the
# registry offers something newer, so a helper that deployed whatever lockfile is on disk could deploy a tree nobody
# looked at. Inside a git checkout, refuse one that differs from the last commit (staged or not): commit and review first.
# (`git diff --quiet` exits 1 on a difference and above 1 on an error; either way the helper stops.)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git diff --quiet HEAD -- package-lock.json; then
  echo 'package-lock.json differs from the committed one: review and commit it (npm ci installs it; never npm install), then deploy.' >&2; exit 1
fi
if [[ ! -x node_modules/.bin/firebase ]]; then
  echo 'Run npm ci --ignore-scripts first.' >&2; exit 1
fi
REGION=asia-southeast1
SERVICE=automathtics-v3
RUNTIME_SA="automathtics-v3-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
ORIGIN="https://${PROJECT_ID}.web.app"
# IAM and the exact secret versions must already exist. Do not create/rotate them here.
gcloud iam service-accounts describe "$RUNTIME_SA" --project "$PROJECT_ID" >/dev/null
# the provider decides which secrets must exist: Stripe needs its key and endpoint secret, the fake provider its signing secret
if [[ "${PAYMENT_PROVIDER:-fake}" == stripe ]]; then
  for v in STRIPE_PRICE_STARTER STRIPE_PRICE_FAMILY STRIPE_PRICE_BIG; do [[ "${!v:-}" =~ ^price_[A-Za-z0-9]{8,}$ ]] || { echo "Set $v to the Stripe price id (price_...)." >&2; exit 1; }; done
  PROVIDER_SECRETS='am-v3-stripe-key am-v3-webhook-stripe'
else
  PROVIDER_SECRETS='am-v3-webhook-fake'
fi
for name in am-v3-session am-v3-pin-pepper $PROVIDER_SECRETS; do
  gcloud secrets versions describe 1 --secret "$name" --project "$PROJECT_ID" >/dev/null
done
# The commit being deployed travels with the service — RELEASE_SHA in the environment, a release-sha label on the revision — and
# /api/health reports it, so "which commit runs on staging" is a fact anyone can read, not a line in somebody's terminal.
# A dirty checkout would deploy code the commit does not describe: refused — and a git that cannot answer stops the helper too
# (the status is assigned first so `set -e` sees its exit code; inside `[[ -z "$(...)" ]]` a failing git would read as clean).
RELEASE_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Deploy from a git checkout: the release commit is recorded on the service.' >&2; exit 1; }
DIRTY="$(git status --porcelain --untracked-files=no)"
[[ -z "$DIRTY" ]] || { echo 'The checkout has uncommitted changes: the deployed code would not be the commit it claims. Commit or stash first.' >&2; exit 1; }
# What is uploaded is the commit itself, exported now — never the working tree as it stands minutes later, after the suites: an
# edit, a pull or a checkout in another tab while the tests run cannot reach the revision that carries this commit's label.
SRC="$(mktemp -d)"; ENV_FILE="$(mktemp)"; SERVICE_JSON="$(mktemp)"
trap 'rm -rf "$SRC"; rm -f "$ENV_FILE" "$SERVICE_JSON"' EXIT
# (from the top level: run inside commercial/, git-archive scopes the archive to the current directory INSIDE the tree-ish and exports nothing)
PREFIX="$(git rev-parse --show-prefix)"; PREFIX="${PREFIX%/}"; TOP="$(git rev-parse --show-toplevel)"
git -C "$TOP" archive --format=tar "${RELEASE_SHA}${PREFIX:+:$PREFIX}" | tar -x -C "$SRC"
for needed in Dockerfile .dockerignore .gcloudignore package.json package-lock.json server/main.mjs; do [[ -e "$SRC/$needed" ]] || { echo "The exported commit lacks $needed." >&2; exit 1; }; done
npm ci --ignore-scripts --no-fund --no-audit
npm test
npm run test:emulator
# The tests ran on the checkout: it must still be the commit that was exported (a pull or a checkout meanwhile: start again).
DIRTY="$(git status --porcelain --untracked-files=no)"
[[ "$(git rev-parse HEAD)" == "$RELEASE_SHA" && -z "$DIRTY" ]] || { echo 'The checkout changed while the tests ran: start again.' >&2; exit 1; }
# Ephemeral config contains ONLY public identifiers. Secret values never enter it.
export PROJECT_ID FIREBASE_WEB_API_KEY FIREBASE_WEB_APP_ID TRUSTED_PROXY_HOPS PAYMENT_PROVIDER STRIPE_PRICE_STARTER STRIPE_PRICE_FAMILY STRIPE_PRICE_BIG RELEASE_SHA
node --input-type=module - "$ENV_FILE" <<'NODE'
import { writeFileSync } from 'node:fs';
const p = process.env;
writeFileSync(process.argv[2], JSON.stringify({ APP_MODE: 'staging',
  APP_ORIGIN: `https://${p.PROJECT_ID}.web.app`, FIREBASE_PROJECT_ID: p.PROJECT_ID,
  FIREBASE_WEB_API_KEY: p.FIREBASE_WEB_API_KEY, FIREBASE_WEB_APP_ID: p.FIREBASE_WEB_APP_ID,
  TRUSTED_PROXY_HOPS: p.TRUSTED_PROXY_HOPS, RELEASE_SHA: p.RELEASE_SHA, PAYMENT_PROVIDER: p.PAYMENT_PROVIDER || 'fake', ...(p.PAYMENT_PROVIDER === 'stripe' ? { STRIPE_PRICE_STARTER: p.STRIPE_PRICE_STARTER, STRIPE_PRICE_FAMILY: p.STRIPE_PRICE_FAMILY, STRIPE_PRICE_BIG: p.STRIPE_PRICE_BIG } : { FAKE_PAYMENTS_ACK: 'no-real-money' }) }), { mode: 0o600 });
NODE
# Deny browser database access BEFORE publishing the new service.
./node_modules/.bin/firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only firestore:rules
gcloud run deploy "$SERVICE" --project "$PROJECT_ID" --region "$REGION"   --source "$SRC" --service-account "$RUNTIME_SA" --allow-unauthenticated   --port 8080 --memory 512Mi --cpu 1 --concurrency 4 --min-instances 0 --max-instances 3   --timeout 60 --labels "release-sha=$RELEASE_SHA" --env-vars-file "$ENV_FILE"   --set-secrets "SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1,$([ "${PAYMENT_PROVIDER:-fake}" = stripe ] && echo 'STRIPE_SECRET_KEY=am-v3-stripe-key:1,WEBHOOK_SECRET_STRIPE=am-v3-webhook-stripe:1' || echo 'WEBHOOK_SECRET_FAKE=am-v3-webhook-fake:1')"
mkdir -p .hosting  # deliberately empty; git keeps no empty directory, so make sure it exists
./node_modules/.bin/firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only hosting
# The revision this run created must be the one serving — traffic pinned to an earlier revision (a rollback per DEPLOY_V3.md §7)
# would leave the new one, with its new environment, serving nothing while the health check still answered from the old — and
# the live service must report this very commit. scripts/verify-release.mjs decides; the suite tests its decision.
gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format=json > "$SERVICE_JSON"
VERDICT="$(node scripts/verify-release.mjs "$ORIGIN" "$RELEASE_SHA" "$SERVICE_JSON")"
echo "$VERDICT"
[[ "$VERDICT" == *"is responding at"* ]] || { echo 'verify-release printed no verdict: refusing to call this deploy done.' >&2; exit 1; }
