#!/usr/bin/env bash
# Cloud Shell block J (DEPLOY_V3.md → The move itself): at the cutover, in quiet time, copy everything from automathtics-v3-staging into
# automathtics-live as it is. Staging's schedules are paused first: its nightly sweep and its weekly email would otherwise go on acting on a
# copy of families that now live elsewhere. Then Firestore's own export and import copies every document, field type and time as stored,
# and scripts/move-auth.mjs copies every sign-in account with its password and second factor and checks live against staging. The bucket
# that carries the export exists for those minutes only and is removed whether the copy worked or not. Safe to rerun: the import writes the
# same documents again, and the account copy imports only what live still lacks.
#   CONFIRM_MOVE=automathtics-live source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/10-move-to-live.sh)
set -uo pipefail
FROM=automathtics-v3-staging TO=automathtics-live REGION=asia-southeast1
stop() { echo "BLOCK J FAILED: $1"; }
[[ "${CONFIRM_MOVE:-}" == "$TO" ]] || { stop "set CONFIRM_MOVE=$TO to copy staging into it"; return 1 2>/dev/null || exit 1; }
{ cd ~/AutoMathtics/commercial && git pull -q --ff-only && [[ -f scripts/move-auth.mjs ]]; } || { stop 'run block A in this tab first: it clones the release this block runs'; return 1 2>/dev/null || exit 1; }
FROM_NUMBER="$(gcloud projects describe "$FROM" --format='value(projectNumber)')" && TO_NUMBER="$(gcloud projects describe "$TO" --format='value(projectNumber)')" \
  || { stop 'both projects must be readable by this account'; return 1 2>/dev/null || exit 1; }

for SCHED in automathtics-v3-sweep-nightly automathtics-v3-report-weekly; do
  if gcloud scheduler jobs pause "$SCHED" --project "$FROM" --location "$REGION" >/dev/null 2>&1; then echo "staging's $SCHED is paused"
  else echo "staging's $SCHED was not paused (it is missing or already paused): gcloud scheduler jobs list --project $FROM --location $REGION"; fi
done

# Firestore's own service agents do the reading and writing: staging's writes the export, live's reads it back
gcloud beta services identity create --service=firestore.googleapis.com --project "$TO" --quiet >/dev/null 2>&1
BUCKET="gs://$TO-move-$(date -u +%Y%m%d%H%M%S)"
gcloud storage buckets create "$BUCKET" --project "$TO" --location "$REGION" --uniform-bucket-level-access >/dev/null || { stop "the bucket $BUCKET could not be made"; return 1 2>/dev/null || exit 1; }
COPIED=1
for NUMBER in "$FROM_NUMBER" "$TO_NUMBER"; do
  gcloud storage buckets add-iam-policy-binding "$BUCKET" --member "serviceAccount:service-$NUMBER@gcp-sa-firestore.iam.gserviceaccount.com" --role roles/storage.admin >/dev/null || COPIED=0
done
[[ $COPIED == 1 ]] && gcloud firestore export "$BUCKET/staging" --project "$FROM" --database '(default)' && gcloud firestore import "$BUCKET/staging" --project "$TO" --database '(default)' || COPIED=0
gcloud storage rm --recursive "$BUCKET" --quiet >/dev/null 2>&1 && echo "the export and its bucket are removed" || echo "REMOVE BY HAND: gcloud storage rm --recursive $BUCKET"
[[ $COPIED == 1 ]] || { stop 'the Firestore copy did not finish: nothing about sign-in was changed. Read the lines above, then run this block again'; return 1 2>/dev/null || exit 1; }
echo "Firestore: $FROM copied into $TO"

TOKEN="$(gcloud auth print-access-token)" node scripts/move-auth.mjs --write || { stop 'the sign-in accounts do not match staging yet: read the lines above, then run this block again'; return 1 2>/dev/null || exit 1; }
echo 'BLOCK J DONE: every document and every sign-in account is on automathtics-live. Next: move the domain (DEPLOY_V3.md → Moving the domain).'
