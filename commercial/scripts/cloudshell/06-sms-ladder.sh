#!/usr/bin/env bash
# Cloud Shell block F: the SMS resend ladder — an Identity Platform blocking function (Cloud Functions 2nd gen, free
# tier at pilot scale) that the provider consults before every verification SMS (DEPLOY_V3.md → section 5).
# Safe to rerun: the secret, the function's own service account and its grants, the TTL policy, the parameter file and
# the function are created or updated in place; the pepper grant an earlier run gave the runtime account goes last.
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/06-sms-ladder.sh)
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"; : "${RUNTIME_SA:?run 01-prepare.sh first}"; : "${PROJECT_NUMBER:?run 01-prepare.sh first}"
cd ~/AutoMathtics/commercial || { echo "run 01-prepare.sh first"; return 1 2>/dev/null || exit 1; }
# a refused pull (local edits, a diverged branch) used to print nothing and deploy whatever was on disk
git pull --ff-only -q || { echo 'BLOCK F FAILED: git pull was refused — the checkout in ~/AutoMathtics has local edits or has diverged; fix that before deploying'; return 1 2>/dev/null || exit 1; }
echo "source at $(git rev-parse --short HEAD)"
gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com identitytoolkit.googleapis.com --project "$PROJECT_ID" >/dev/null && echo 'APIs enabled'
SECRET=AM_V3_SMS_PEPPER
if gcloud secrets describe "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then echo "$SECRET exists (kept)"
else node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | gcloud secrets create "$SECRET" --data-file=- --project "$PROJECT_ID" >/dev/null && echo "$SECRET created (random, never shown)"; fi
# the function's own identity: Firestore and this one secret, nothing else. It used to run as the runtime account, which
# holds firebaseauth.admin and every server secret — far more than a function the identity provider calls should carry.
LADDER_SA="automathtics-v3-sms-ladder@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$LADDER_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then echo 'ladder service account exists (kept)'
else gcloud iam service-accounts create automathtics-v3-sms-ladder --display-name='AutoMathtics v3 SMS ladder' --project "$PROJECT_ID" && echo 'ladder service account created'; fi
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$LADDER_SA" --role=roles/datastore.user --quiet >/dev/null && echo 'granted roles/datastore.user to the ladder account'
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT_ID" --member="serviceAccount:$LADDER_SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null && echo 'the ladder account may read the pepper'
# functions are built by Cloud Build on the project's default compute account, which no longer gets Editor by default. The
# builder role is broader than the build needs: once a deploy has succeeded, retry with roles/run.builder alone (DEPLOY_V3.md → section 5)
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role=roles/cloudbuild.builds.builder --quiet >/dev/null && echo 'the build account may build'
# the TTL policy: requested (asynchronously, stderr shown) only when none is listed, then verified — CREATING while Firestore
# applies it, ACTIVE once done. Nothing listed means no policy: a WARNING and a different last line, not a silent success.
TTL_STATE="$(gcloud firestore fields ttls list --collection-group=smsLadder --project "$PROJECT_ID" --format 'value(ttlConfig.state)')"
if [[ -z "$TTL_STATE" ]]; then
  gcloud firestore fields ttls update expireAt --collection-group=smsLadder --enable-ttl --project "$PROJECT_ID" --quiet --async >/dev/null && echo 'TTL policy requested for smsLadder'
  sleep 3; TTL_STATE="$(gcloud firestore fields ttls list --collection-group=smsLadder --project "$PROJECT_ID" --format 'value(ttlConfig.state)')" # a moment for the listing to catch up
fi
BLOCK_F_END='BLOCK F DONE'
if [[ -n "$TTL_STATE" ]]; then echo "TTL smsLadder: $TTL_STATE"; else echo 'WARNING: no TTL policy on smsLadder (rerun this block, or look under Firestore > Time-to-live)'; BLOCK_F_END='BLOCK F DONE WITH WARNINGS'; fi
printf 'SMS_LADDER_SERVICE_ACCOUNT=%s\n' "$LADDER_SA" > "functions/.env.$PROJECT_ID" && echo "functions/.env.$PROJECT_ID written (the ladder account; no secrets)"
(cd functions && npm ci --no-audit --no-fund 2>&1 | tail -1)
# pipefail: the status is the CLI's, not tail's. A failed deploy stops here, before the runtime account loses its grant
./node_modules/.bin/firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only functions --non-interactive --force 2>&1 | tail -8 \
  || { echo 'BLOCK F FAILED: the function did not deploy; the runtime account keeps its old pepper grant until it does'; return 1 2>/dev/null || exit 1; }
# earlier runs granted the pepper to the runtime account; the function now runs as its own, so take that back (no binding: silent)
gcloud secrets remove-iam-policy-binding "$SECRET" --project "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null 2>&1 && echo 'the runtime account no longer reads the pepper (grant from an earlier run removed)'
# The CLI deployed the function but left the identity provider's trigger unset (15.29.0, observed 9 Sep 2026), so the block
# registers it itself: the provider's config takes the function's URL under blockingFunctions.triggers.beforeSendSms (the
# admin API needs a quota project header), and the function must be callable without credentials — the provider proves
# itself with a signed token that firebase-functions verifies. Idempotent: the same URL twice is a no-op.
URI="$(gcloud functions describe smsLadder --region asia-southeast1 --project "$PROJECT_ID" --format 'value(serviceConfig.uri)')"
if [[ -n "$URI" ]]; then
  gcloud run services add-iam-policy-binding smsladder --region asia-southeast1 --project "$PROJECT_ID" --member allUsers --role roles/run.invoker --quiet >/dev/null && echo 'the identity provider may call the function (it proves itself with a signed token)'
  TOKEN="$(gcloud auth print-access-token)"; CFG="https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config"
  BODY="{\"blockingFunctions\":{\"triggers\":{\"beforeSendSms\":{\"functionUri\":\"$URI\"}}}}"
  curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_ID" -H 'Content-Type: application/json' "$CFG?updateMask=blockingFunctions.triggers.beforeSendSms" -d "$BODY" > /tmp/blocking.json
  grep -q '"functionUri"' /tmp/blocking.json && echo 'beforeSendSms trigger registered' || { echo 'WARNING: the trigger could not be registered:'; head -c 300 /tmp/blocking.json; echo; BLOCK_F_END='BLOCK F DONE WITH WARNINGS'; }
else echo 'WARNING: the function has no URL yet; rerun this block'; BLOCK_F_END='BLOCK F DONE WITH WARNINGS'; fi
echo; echo 'the blocking trigger at the identity provider:'
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: $PROJECT_ID" "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config" \
  | node -e "let s='';process.stdin.on('data',(d)=>{s+=d;}).on('end',()=>{const c=JSON.parse(s);const t=(c.blockingFunctions&&c.blockingFunctions.triggers)||{};console.log(t.beforeSendSms?'beforeSendSms -> '+t.beforeSendSms.functionUri:'NOT REGISTERED: Firebase console > Authentication > Settings > Blocking functions > attach smsLadder to Before SMS is sent');});"
echo "$BLOCK_F_END"
