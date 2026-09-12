#!/usr/bin/env bash
# Cloud Shell block B (DEPLOY_V3.md §4 and §4b): APIs, the runtime service account and its roles, the two
# server secrets, the build role, Firestore TTL policies. Safe to run twice: existing things are kept,
# never replaced. Stops before the Stripe secrets, which the owner creates by hand in the same terminal.
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/02-permissions.sh)
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"; : "${RUNTIME_SA:?run 01-prepare.sh first}"; : "${PROJECT_NUMBER:?run 01-prepare.sh first}"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com identitytoolkit.googleapis.com secretmanager.googleapis.com \
  firebasehosting.googleapis.com --project "$PROJECT_ID" && echo 'APIs enabled'
if gcloud iam service-accounts describe "$RUNTIME_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then echo 'runtime service account exists (kept)'
else gcloud iam service-accounts create automathtics-v3-runtime --display-name='AutoMathtics v3 runtime' --project "$PROJECT_ID" && echo 'runtime service account created'; fi
# datastore.user: Firestore. firebaseauth.admin: Stage 4 deletes sign-in accounts and removes second factors.
for ROLE in roles/datastore.user roles/firebaseauth.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role="$ROLE" --quiet >/dev/null && echo "granted $ROLE to the runtime"
done
# the identity that builds the container for `gcloud run deploy --source`
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role=roles/run.builder --quiet >/dev/null && echo 'granted roles/run.builder to the build account'
for NAME in am-v3-session am-v3-pin-pepper; do
  if gcloud secrets describe "$NAME" --project "$PROJECT_ID" >/dev/null 2>&1; then echo "$NAME exists (kept)"
  else node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | gcloud secrets create "$NAME" --data-file=- --project "$PROJECT_ID" >/dev/null && echo "$NAME created"; fi
  gcloud secrets add-iam-policy-binding "$NAME" --project "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null
done
# short-lived records expire by TTL; financial records never do (PAYMENTS.md → retention). A policy is requested only when
# none is listed (so a rerun keeps what exists), asynchronously — Firestore applies it in the background — and with its
# stderr shown: a refusal used to vanish into /dev/null while the block still said DONE. Then every group is verified:
# CREATING while existing documents are being processed, ACTIVE once done; nothing listed means no policy, which is a
# WARNING here and a different last line below, not a silent success.
TTL_WARNINGS=0
for GROUP in sessions rateLimits pinAttempts operations audit recoveries sweeps smsLadder reports outbox feedback feedbackDays leaving waitlist waitlistDays; do
  STATE="$(gcloud firestore fields ttls list --collection-group="$GROUP" --project "$PROJECT_ID" --format 'value(ttlConfig.state)')"
  if [[ -z "$STATE" ]]; then
    gcloud firestore fields ttls update expireAt --collection-group="$GROUP" --enable-ttl --project "$PROJECT_ID" --quiet --async >/dev/null && echo "TTL policy requested for $GROUP"
    sleep 3; STATE="$(gcloud firestore fields ttls list --collection-group="$GROUP" --project "$PROJECT_ID" --format 'value(ttlConfig.state)')" # a moment for the listing to catch up
  fi
  if [[ -n "$STATE" ]]; then echo "TTL $GROUP: $STATE"; else echo "WARNING: no TTL policy on $GROUP (rerun this block, or look under Firestore > Time-to-live)"; TTL_WARNINGS=$((TTL_WARNINGS + 1)); fi
done
if (( TTL_WARNINGS > 0 )); then echo "BLOCK B DONE WITH WARNINGS ($TTL_WARNINGS TTL policies missing). Next: the two Stripe secrets, typed by you."
else echo 'BLOCK B DONE. Next: the two Stripe secrets, typed by you.'; fi
