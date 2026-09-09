#!/usr/bin/env bash
# Cloud Shell block A (DEPLOY_V3.md §3): clone the release, point the shell at the staging project,
# install the pinned dependencies, run the unit tests. Source it so the exports survive:
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/01-prepare.sh)
# Public identifiers only; no secret is ever written here.
set -uo pipefail
export PROJECT_ID='automathtics-v3-staging'
export CONFIRM_PROJECT="$PROJECT_ID"
export FIREBASE_WEB_API_KEY='AIzaSyCoVfsQwXV3AFoK789V99ncDJknMoPmWUI'
export FIREBASE_WEB_APP_ID='1:1059646051128:web:df1a942e7a4136bd9d67cd'
export PROJECT_NUMBER='1059646051128'
export RUNTIME_SA="automathtics-v3-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
cd ~ || return 1
if [[ ! -d AutoMathtics ]]; then git clone --quiet --branch release/v3.0 https://github.com/gavgunawan/AutoMathtics.git || return 1; fi
cd AutoMathtics && git fetch --quiet origin release/v3.0 && git checkout --quiet release/v3.0 && git pull --quiet --ff-only && cd commercial || return 1
gcloud config set project "$PROJECT_ID" --quiet
echo "node $(node --version)  java: $(java -version 2>&1 | head -1)"
npm ci --ignore-scripts --no-fund --no-audit --loglevel=error || { echo 'BLOCK A FAILED: npm ci'; return 1; }
# `set -o pipefail` above makes the pipeline's status the suite's, not tail's: a red suite stops here instead of reading DONE
npm test 2>&1 | tail -4 || { echo 'BLOCK A FAILED: unit tests'; return 1; }
echo "BLOCK A DONE in $(pwd)"
