#!/usr/bin/env bash
# Cloud Shell block F: the SMS resend ladder — an Identity Platform blocking function (Cloud Functions 2nd gen, free
# tier at pilot scale) that the provider consults before every verification SMS (DEPLOY_V3.md → section 5).
# Safe to rerun: the secret, the policy, the parameter file and the function are created or updated in place.
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/06-sms-ladder.sh)
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"; : "${RUNTIME_SA:?run 01-prepare.sh first}"; : "${PROJECT_NUMBER:?run 01-prepare.sh first}"
cd ~/AutoMathtics/commercial || { echo "run 01-prepare.sh first"; return 1 2>/dev/null || exit 1; }
git pull --ff-only -q && echo "source at $(git rev-parse --short HEAD)"
gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com identitytoolkit.googleapis.com --project "$PROJECT_ID" >/dev/null && echo 'APIs enabled'
SECRET=AM_V3_SMS_PEPPER
if gcloud secrets describe "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then echo "$SECRET exists (kept)"
else node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | gcloud secrets create "$SECRET" --data-file=- --project "$PROJECT_ID" >/dev/null && echo "$SECRET created (random, never shown)"; fi
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor --quiet >/dev/null && echo 'the runtime account may read it'
# functions are built by Cloud Build on the project's default compute account
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role=roles/cloudbuild.builds.builder --quiet >/dev/null && echo 'the build account may build'
gcloud firestore fields ttls update expireAt --collection-group=smsLadder --enable-ttl --project "$PROJECT_ID" --quiet --async >/dev/null 2>&1 && echo 'TTL policy requested for smsLadder'
printf 'SMS_LADDER_SERVICE_ACCOUNT=%s\n' "$RUNTIME_SA" > "functions/.env.$PROJECT_ID" && echo "functions/.env.$PROJECT_ID written (the runtime account; no secrets)"
(cd functions && npm ci --no-audit --no-fund 2>&1 | tail -1)
./node_modules/.bin/firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only functions --non-interactive --force 2>&1 | tail -8
echo; echo 'the blocking trigger at the identity provider:'
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" "https://identitytoolkit.googleapis.com/admin/v2/projects/$PROJECT_ID/config" \
  | node -e "let s='';process.stdin.on('data',(d)=>{s+=d;}).on('end',()=>{const c=JSON.parse(s);const t=(c.blockingFunctions&&c.blockingFunctions.triggers)||{};console.log(t.beforeSendSms?'beforeSendSms -> '+t.beforeSendSms.functionUri:'NOT REGISTERED: Firebase console > Authentication > Settings > Blocking functions > attach smsLadder to Before SMS is sent');});"
echo 'BLOCK F DONE'
