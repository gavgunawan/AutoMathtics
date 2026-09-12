#!/usr/bin/env bash
# Cloud Shell block H (DEPLOY_V3.md → Deploying from GitHub): let the release branch deploy itself, with no key anywhere.
#
# GitHub proves who it is to Google directly (Workload Identity Federation): a workflow run presents a short-lived OIDC
# token, Google checks it against GitHub's own issuer, and hands back credentials that last about an hour. Nothing is
# stored in GitHub that would work anywhere else, and nothing needs rotating — the alternative, a service account key in
# a repository secret, is a credential that works from any machine on earth until somebody notices it has leaked.
#
# The trust is narrow on purpose: only this repository, and only a push to release/v3.0. A pull request from a fork runs
# with ref refs/pull/N/merge, so it is refused before it can ask for anything. That restriction is the whole reason to
# prefer this over a key, which has no notion of who is using it.
#
# The identity it hands out is its own account with only what deploying needs — Cloud Run, Cloud Build, Artifact
# Registry, Hosting, Firestore rules, and permission to act as the runtime account. Not the runtime account, whose
# Firestore and Identity Platform powers a deploy has no use for, and not owner.
#
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/08-deploy-identity.sh)
#
# Safe to run twice: everything it makes is looked for first and kept if it is already there.
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"; : "${PROJECT_NUMBER:?run 01-prepare.sh first}"; : "${RUNTIME_SA:?run 01-prepare.sh first}"
REPO='gavgunawan/AutoMathtics' BRANCH='refs/heads/release/v3.0'
POOL=github PROVIDER=github-oidc
DEPLOYER="automathtics-v3-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com \
  --project "$PROJECT_ID" >/dev/null && echo 'federation APIs enabled'

if gcloud iam workload-identity-pools describe "$POOL" --location=global --project "$PROJECT_ID" >/dev/null 2>&1; then echo "pool $POOL exists (kept)"
else gcloud iam workload-identity-pools create "$POOL" --location=global --display-name='GitHub Actions' --project "$PROJECT_ID" >/dev/null && echo "pool $POOL created"; fi

# The condition is the security boundary: this repository, this branch, and nothing else may exchange a token here.
CONDITION="assertion.repository=='${REPO}' && assertion.ref=='${BRANCH}'"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project "$PROJECT_ID" \
    --attribute-condition="$CONDITION" >/dev/null && echo "provider $PROVIDER updated (condition re-applied)"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project "$PROJECT_ID" \
    --display-name='GitHub OIDC' --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' \
    --attribute-condition="$CONDITION" >/dev/null && echo "provider $PROVIDER created"
fi

if gcloud iam service-accounts describe "$DEPLOYER" --project "$PROJECT_ID" >/dev/null 2>&1; then echo 'deployer account exists (kept)'
else gcloud iam service-accounts create automathtics-v3-deployer --display-name='AutoMathtics v3 deployer (GitHub Actions)' --project "$PROJECT_ID" >/dev/null && echo 'deployer account created'; fi

# Exactly what scripts/deploy-staging.sh does, and nothing else: build and release the container (run, cloudbuild,
# artifactregistry, storage for Cloud Build's source bucket), publish Hosting and Firestore rules, read the project,
# and look at secret versions by name — reading their values is the runtime's business, not the deploy's.
for ROLE in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer roles/storage.admin \
            roles/firebasehosting.admin roles/firebaserules.admin roles/firebase.viewer \
            roles/secretmanager.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER" --role="$ROLE" --quiet >/dev/null && echo "granted $ROLE to the deployer"
done
# Deploying a service that RUNS AS the runtime account needs permission to act as that one account — granted on the
# account itself, not across the project, so the deployer cannot act as any other identity that exists here.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser --quiet >/dev/null && echo 'the deployer may act as the runtime account, and only that one'

PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --project "$PROJECT_ID" \
  --member="$PRINCIPAL" --role=roles/iam.workloadIdentityUser --quiet >/dev/null && echo "GitHub may become the deployer, from ${REPO} on ${BRANCH} alone"

echo
echo 'BLOCK H DONE. Put these two lines into GitHub as repository VARIABLES (Settings -> Secrets and variables ->'
echo 'Actions -> Variables). Neither is a secret: they name things, and name alone grants nothing.'
echo
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "  GCP_DEPLOY_SERVICE_ACCOUNT     = ${DEPLOYER}"
