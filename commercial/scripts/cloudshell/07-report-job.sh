#!/usr/bin/env bash
# Cloud Shell block G: the weekly progress email (email-v1) as a Cloud Run job from the service's own image, started by Cloud
# Scheduler every Monday at 07:00 Singapore time; each family gets the last complete week in its own time zone (DEPLOY_V3.md →
# Email). A copy of block E. Safe to rerun: the TTL policies, the job and the schedule are updated in place.
# EMAIL_PROVIDER=fake (the default) records every email in Firestore's outbox for 14 days instead of sending it: the staging
# preview. EMAIL_PROVIDER=resend sends through Resend with the key in the secret am-v3-email-key, which the owner creates first.
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/07-report-job.sh)
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"; : "${RUNTIME_SA:?run 01-prepare.sh first}"
REGION=asia-southeast1 JOB=automathtics-v3-report SERVICE=automathtics-v3
EMAIL_PROVIDER="${EMAIL_PROVIDER:-fake}"; EMAIL_FROM="${EMAIL_FROM:-AutoMathtics <onboarding@resend.dev>}"
[[ "$EMAIL_PROVIDER" == fake || "$EMAIL_PROVIDER" == resend ]] || { echo 'BLOCK G FAILED: EMAIL_PROVIDER must be fake or resend'; return 1 2>/dev/null || exit 1; }
# SESSION_SECRET signs the buttons in the email (the service checks them with the same secret); the key is only for Resend
SECRETS='SESSION_SECRET=am-v3-session:1'
if [[ "$EMAIL_PROVIDER" == resend ]]; then
  gcloud secrets versions describe 1 --secret am-v3-email-key --project "$PROJECT_ID" >/dev/null 2>&1 || { echo 'BLOCK G FAILED: create the secret am-v3-email-key first (DEPLOY_V3.md → Email)'; return 1 2>/dev/null || exit 1; }
  gcloud secrets add-iam-policy-binding am-v3-email-key --project "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null && echo 'the runtime account may read the email key'
  SECRETS="$SECRETS,EMAIL_API_KEY=am-v3-email-key:1"
fi
gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT_ID" >/dev/null && echo 'Cloud Scheduler API enabled'
IMAGE=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(spec.template.spec.containers[0].image)')
[[ -n "$IMAGE" ]] || { echo 'deploy the service first (block C)'; return 1 2>/dev/null || exit 1; }
# the report claims (status only, never content) expire after 400 days and the fake provider's outbox after 14: TTL policies,
# requested only when none is listed and then verified, as block B does
TTL_WARNINGS=0
for GROUP in reports outbox; do
  STATE="$(gcloud firestore fields ttls list --collection-group="$GROUP" --project "$PROJECT_ID" --format 'value(ttlConfig.state)')"
  if [[ -z "$STATE" ]]; then
    gcloud firestore fields ttls update expireAt --collection-group="$GROUP" --enable-ttl --project "$PROJECT_ID" --quiet --async >/dev/null && echo "TTL policy requested for $GROUP"
    sleep 3; STATE="$(gcloud firestore fields ttls list --collection-group="$GROUP" --project "$PROJECT_ID" --format 'value(ttlConfig.state)')"
  fi
  if [[ -n "$STATE" ]]; then echo "TTL $GROUP: $STATE"; else echo "WARNING: no TTL policy on $GROUP (rerun this block, or look under Firestore > Time-to-live)"; TTL_WARNINGS=$((TTL_WARNINGS + 1)); fi
done
# the sender's display name has a space and angle brackets, so the variables use | between them (gcloud topic escaping)
# OWNER_EMAIL is where the monthly leaving report goes (FEEDBACK_TO wins when the service has one): the same Monday run that sends
# the monthly family reports sends it, for the month just ended, so there is one schedule and not two (DEPLOY_V3.md → 5b).
ENV_VARS="^|^APP_MODE=staging|FIREBASE_PROJECT_ID=$PROJECT_ID|CONFIRM_PROJECT=$PROJECT_ID|OPERATOR_ID=scheduler@$PROJECT_ID|APP_ORIGIN=https://$PROJECT_ID.web.app|EMAIL_PROVIDER=$EMAIL_PROVIDER|EMAIL_FROM=$EMAIL_FROM"
if [[ -n "${OWNER_EMAIL:-}" ]]; then ENV_VARS="$ENV_VARS|OWNER_EMAIL=$OWNER_EMAIL"; echo "the monthly leaving report will go to $OWNER_EMAIL"; else echo 'no OWNER_EMAIL: the monthly leaving report is skipped with a log line (rerun this block with OWNER_EMAIL set)'; fi
VERB=create; gcloud run jobs describe "$JOB" --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1 && VERB=update
gcloud run jobs "$VERB" "$JOB" --project "$PROJECT_ID" --region "$REGION" --image "$IMAGE" --service-account "$RUNTIME_SA" \
  --command node --args scripts/report.mjs,send --max-retries 0 --task-timeout 20m --memory 512Mi \
  --set-env-vars "$ENV_VARS" --set-secrets "$SECRETS" >/dev/null && echo "job $JOB ${VERB}d from $IMAGE (EMAIL_PROVIDER=$EMAIL_PROVIDER)"
gcloud run jobs add-iam-policy-binding "$JOB" --project "$PROJECT_ID" --region "$REGION" --member="serviceAccount:$RUNTIME_SA" --role=roles/run.invoker --quiet >/dev/null && echo 'the runtime account may start the job'
SCHED=automathtics-v3-report-weekly URI="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$JOB:run"
if gcloud scheduler jobs describe "$SCHED" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHED" --project "$PROJECT_ID" --location "$REGION" --schedule '0 7 * * 1' --time-zone 'Asia/Singapore' --uri "$URI" --http-method POST --oauth-service-account-email "$RUNTIME_SA" >/dev/null && echo 'schedule updated: Mondays 07:00 Singapore'
else
  gcloud scheduler jobs create http "$SCHED" --project "$PROJECT_ID" --location "$REGION" --schedule '0 7 * * 1' --time-zone 'Asia/Singapore' --uri "$URI" --http-method POST --oauth-service-account-email "$RUNTIME_SA" >/dev/null && echo 'schedule created: Mondays 07:00 Singapore'
fi
# a dry run now: every family's decision in the job's log, nothing claimed, nothing sent
echo 'dry run now (sends nothing):'; gcloud run jobs execute "$JOB" --project "$PROJECT_ID" --region "$REGION" --args scripts/report.mjs,send,--dry-run --wait >/dev/null && echo 'dry run finished: read its log in Cloud Run → Jobs → automathtics-v3-report' || echo 'WARNING: the dry run failed: read its log in Cloud Run → Jobs'
if (( TTL_WARNINGS > 0 )); then echo "BLOCK G DONE WITH WARNINGS ($TTL_WARNINGS TTL policies missing)"; else echo 'BLOCK G DONE'; fi
