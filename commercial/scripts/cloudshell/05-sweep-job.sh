#!/usr/bin/env bash
# Cloud Shell block E: the nightly invariant sweep as a Cloud Run job from the service's own image, triggered by
# Cloud Scheduler (RECONCILIATION.md → Routine sweep). Safe to rerun: the job and the schedule are updated in place.
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/05-sweep-job.sh)
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"; : "${RUNTIME_SA:?run 01-prepare.sh first}"
REGION=asia-southeast1 JOB=automathtics-v3-sweep SERVICE=automathtics-v3
# The sweep builds the services the server does, so it runs with the service's mode, provider and origin: staging's by default (staging,
# Stripe with its sandbox prices and secrets, the project's web.app host). A live project exports APP_MODE=production, PAYMENT_PROVIDER=none
# and APP_ORIGIN=https://automathtics.net; none (payments not open) names no price and binds no provider secret.
APP_MODE="${APP_MODE:-staging}" PAYMENT_PROVIDER="${PAYMENT_PROVIDER:-stripe}" APP_ORIGIN="${APP_ORIGIN:-https://$PROJECT_ID.web.app}"
[[ "$APP_MODE" == staging || "$APP_MODE" == production ]] || { echo 'BLOCK E FAILED: APP_MODE must be staging or production'; return 1 2>/dev/null || exit 1; }
[[ "$APP_ORIGIN" =~ ^https://[a-z0-9.-]+$ ]] || { echo 'BLOCK E FAILED: APP_ORIGIN must be https://host, with no path or trailing slash'; return 1 2>/dev/null || exit 1; }
case "$PAYMENT_PROVIDER" in
  stripe)
    PROVIDER_ENV=",PAYMENT_PROVIDER=stripe,STRIPE_PRICE_STARTER=${STRIPE_PRICE_STARTER:-price_1UDktFEAg0w7lrNU8ixmQg6g},STRIPE_PRICE_FAMILY=${STRIPE_PRICE_FAMILY:-price_1UDktZEAg0w7lrNU0kJdqUxK},STRIPE_PRICE_BIG=${STRIPE_PRICE_BIG:-price_1UDktlEAg0w7lrNUb4AwLnP3}"
    PROVIDER_SECRETS=',STRIPE_SECRET_KEY=am-v3-stripe-key:1,WEBHOOK_SECRET_STRIPE=am-v3-webhook-stripe:1' ;;
  none)
    PROVIDER_ENV=',PAYMENT_PROVIDER=none' PROVIDER_SECRETS='' ;;
  *) echo 'BLOCK E FAILED: PAYMENT_PROVIDER must be stripe or none'; return 1 2>/dev/null || exit 1 ;;
esac
gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT_ID" >/dev/null && echo 'Cloud Scheduler API enabled'
IMAGE=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(spec.template.spec.containers[0].image)')
[[ -n "$IMAGE" ]] || { echo 'deploy the service first (block C)'; return 1 2>/dev/null || exit 1; }
VERB=create; gcloud run jobs describe "$JOB" --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1 && VERB=update
gcloud run jobs "$VERB" "$JOB" --project "$PROJECT_ID" --region "$REGION" --image "$IMAGE" --service-account "$RUNTIME_SA" \
  --command node --args scripts/support.mjs,sweep --max-retries 0 --task-timeout 20m --memory 512Mi \
  --set-env-vars "APP_MODE=$APP_MODE,FIREBASE_PROJECT_ID=$PROJECT_ID,CONFIRM_PROJECT=$PROJECT_ID,OPERATOR_ID=scheduler@$PROJECT_ID,APP_ORIGIN=$APP_ORIGIN$PROVIDER_ENV" \
  --set-secrets "SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1$PROVIDER_SECRETS" >/dev/null && echo "job $JOB ${VERB}d from $IMAGE ($APP_MODE, PAYMENT_PROVIDER=$PAYMENT_PROVIDER)"
gcloud run jobs add-iam-policy-binding "$JOB" --project "$PROJECT_ID" --region "$REGION" --member="serviceAccount:$RUNTIME_SA" --role=roles/run.invoker --quiet >/dev/null && echo 'the runtime account may start the job'
SCHED=automathtics-v3-sweep-nightly URI="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$JOB:run"
if gcloud scheduler jobs describe "$SCHED" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHED" --project "$PROJECT_ID" --location "$REGION" --schedule '15 3 * * *' --time-zone 'Asia/Singapore' --uri "$URI" --http-method POST --oauth-service-account-email "$RUNTIME_SA" >/dev/null && echo 'schedule updated: 03:15 Singapore, nightly'
else
  gcloud scheduler jobs create http "$SCHED" --project "$PROJECT_ID" --location "$REGION" --schedule '15 3 * * *' --time-zone 'Asia/Singapore' --uri "$URI" --http-method POST --oauth-service-account-email "$RUNTIME_SA" >/dev/null && echo 'schedule created: 03:15 Singapore, nightly'
fi
echo 'first run now:'; gcloud run jobs execute "$JOB" --project "$PROJECT_ID" --region "$REGION" --wait && echo 'BLOCK E DONE (no findings)' || echo 'BLOCK E DONE — the sweep reported findings or failed: read its log in Cloud Run → Jobs'
