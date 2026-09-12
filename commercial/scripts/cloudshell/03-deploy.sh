#!/usr/bin/env bash
# Cloud Shell block C (DEPLOY_V3.md §5): grant the Stripe secrets to the runtime, sign the Firebase CLI in
# if needed, deploy rules + Cloud Run + Hosting through scripts/deploy-staging.sh, then measure the proxy
# depth with one curl (the answer's `forwarded` and `leading` fields).
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/03-deploy.sh)
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"; : "${RUNTIME_SA:?run 01-prepare.sh first}"
for NAME in am-v3-stripe-key am-v3-webhook-stripe; do
  gcloud secrets versions describe 1 --secret "$NAME" --project "$PROJECT_ID" >/dev/null 2>&1 || { echo "$NAME is missing: create it first (the two lines the owner types)"; return 1 2>/dev/null || exit 1; }
  gcloud secrets add-iam-policy-binding "$NAME" --project "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null && echo "$NAME granted to the runtime"
done
export PAYMENT_PROVIDER=stripe
export STRIPE_PRICE_STARTER='price_1UDktFEAg0w7lrNU8ixmQg6g' STRIPE_PRICE_FAMILY='price_1UDktZEAg0w7lrNU0kJdqUxK' STRIPE_PRICE_BIG='price_1UDktlEAg0w7lrNUb4AwLnP3'
export TRUSTED_PROXY_HOPS="${TRUSTED_PROXY_HOPS:-2}"
cd ~/AutoMathtics/commercial || { echo 'run 01-prepare.sh first'; return 1 2>/dev/null || exit 1; }
# a refused pull (local edits, a diverged branch) used to print nothing and deploy whatever was on disk
git pull --quiet --ff-only || { echo 'BLOCK C FAILED: git pull was refused — the checkout in ~/AutoMathtics has local edits or has diverged; fix that before deploying'; return 1 2>/dev/null || exit 1; }
echo "deploying $(git log --format='%h %s' -1)"
if ! ./node_modules/.bin/firebase projects:list --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo 'The Firebase CLI needs a sign-in: follow the link it prints, then paste the code back here.'
  ./node_modules/.bin/firebase login --no-localhost
fi
# Send feedback copies each note to FEEDBACK_TO when it is set (by Resend with EMAIL_PROVIDER=resend): DEPLOY_V3.md → 5c
[[ -n "${FEEDBACK_TO:-}" ]] && export FEEDBACK_TO EMAIL_PROVIDER="${EMAIL_PROVIDER:-fake}" && echo "feedback is copied to $FEEDBACK_TO (EMAIL_PROVIDER=$EMAIL_PROVIDER)"
npm run deploy:staging && { echo; echo 'proxy depth probe:'; curl -s -H 'X-Forwarded-For: 203.0.113.250' "https://${PROJECT_ID}.web.app/api/health"; echo; echo 'BLOCK C DONE'; }
