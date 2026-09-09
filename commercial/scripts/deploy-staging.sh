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
for tool in node npm gcloud java; do command -v "$tool" >/dev/null || { echo "Install $tool first." >&2; exit 1; }; done
if [[ ! -f package-lock.json ]]; then
  echo 'Run npm install --ignore-scripts, review and commit package-lock.json first.' >&2; exit 1
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
npm ci --ignore-scripts --no-fund --no-audit
npm test
npm run test:emulator
# Ephemeral config contains ONLY public identifiers. Secret values never enter it.
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
export PROJECT_ID FIREBASE_WEB_API_KEY FIREBASE_WEB_APP_ID TRUSTED_PROXY_HOPS PAYMENT_PROVIDER STRIPE_PRICE_STARTER STRIPE_PRICE_FAMILY STRIPE_PRICE_BIG
node --input-type=module - "$ENV_FILE" <<'NODE'
import { writeFileSync } from 'node:fs';
const p = process.env;
writeFileSync(process.argv[2], JSON.stringify({ APP_MODE: 'staging',
  APP_ORIGIN: `https://${p.PROJECT_ID}.web.app`, FIREBASE_PROJECT_ID: p.PROJECT_ID,
  FIREBASE_WEB_API_KEY: p.FIREBASE_WEB_API_KEY, FIREBASE_WEB_APP_ID: p.FIREBASE_WEB_APP_ID,
  TRUSTED_PROXY_HOPS: p.TRUSTED_PROXY_HOPS, PAYMENT_PROVIDER: p.PAYMENT_PROVIDER || 'fake', ...(p.PAYMENT_PROVIDER === 'stripe' ? { STRIPE_PRICE_STARTER: p.STRIPE_PRICE_STARTER, STRIPE_PRICE_FAMILY: p.STRIPE_PRICE_FAMILY, STRIPE_PRICE_BIG: p.STRIPE_PRICE_BIG } : { FAKE_PAYMENTS_ACK: 'no-real-money' }) }), { mode: 0o600 });
NODE
# Deny browser database access BEFORE publishing the new service.
./node_modules/.bin/firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only firestore:rules
gcloud run deploy "$SERVICE" --project "$PROJECT_ID" --region "$REGION"   --source . --service-account "$RUNTIME_SA" --allow-unauthenticated   --port 8080 --memory 512Mi --cpu 1 --concurrency 4 --min-instances 0 --max-instances 3   --timeout 60 --env-vars-file "$ENV_FILE"   --set-secrets "SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1,$([ "${PAYMENT_PROVIDER:-fake}" = stripe ] && echo 'STRIPE_SECRET_KEY=am-v3-stripe-key:1,WEBHOOK_SECRET_STRIPE=am-v3-webhook-stripe:1' || echo 'WEBHOOK_SECRET_FAKE=am-v3-webhook-fake:1')"
mkdir -p .hosting  # deliberately empty; git keeps no empty directory, so make sure it exists
./node_modules/.bin/firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only hosting
node --input-type=module - "$ORIGIN" <<'NODE'
const origin = process.argv[2];
const health = await fetch(`${origin}/api/health`);
const result = await health.json();
if (!health.ok || result.version !== '3.0.0') throw Error('Live v3.0 health check failed; inspect Cloud Run logs.');
console.log(`v${result.version} is responding at ${origin}. Now complete the staging acceptance checklist.`);
NODE
