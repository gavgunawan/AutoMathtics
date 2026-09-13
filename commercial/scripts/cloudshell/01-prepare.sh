#!/usr/bin/env bash
# Cloud Shell block A (DEPLOY_V3.md §3): clone the release, point the shell at the project, install the pinned dependencies, run the
# unit tests. Source it so the exports survive:
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/01-prepare.sh)
# Public identifiers only; no secret is ever written here.
#
# The project is staging unless PROJECT_ID is exported first. Staging's identifiers are the defaults, and only for staging: for any other
# project (automathtics-live: DEPLOY_V3.md → Moving to a live project) export its FIREBASE_WEB_API_KEY, FIREBASE_WEB_APP_ID, PROJECT_NUMBER,
# APP_MODE, PAYMENT_PROVIDER and APP_ORIGIN before sourcing this, and none of them may still name staging. One Cloud Shell tab per project:
# a value exported for one project is otherwise taken for the other.
set -uo pipefail
STAGING_PROJECT='automathtics-v3-staging' STAGING_API_KEY='AIzaSyCoVfsQwXV3AFoK789V99ncDJknMoPmWUI' STAGING_APP_ID='1:1059646051128:web:df1a942e7a4136bd9d67cd' STAGING_NUMBER='1059646051128'
export PROJECT_ID="${PROJECT_ID:-$STAGING_PROJECT}"
export CONFIRM_PROJECT="$PROJECT_ID"
if [[ "$PROJECT_ID" == "$STAGING_PROJECT" ]]; then
  export FIREBASE_WEB_API_KEY="${FIREBASE_WEB_API_KEY:-$STAGING_API_KEY}"
  export FIREBASE_WEB_APP_ID="${FIREBASE_WEB_APP_ID:-$STAGING_APP_ID}"
  export PROJECT_NUMBER="${PROJECT_NUMBER:-$STAGING_NUMBER}"
else
  for NAME in FIREBASE_WEB_API_KEY FIREBASE_WEB_APP_ID PROJECT_NUMBER APP_MODE PAYMENT_PROVIDER APP_ORIGIN; do
    [[ -n "${!NAME:-}" ]] || { echo "BLOCK A FAILED: export $NAME for $PROJECT_ID first (DEPLOY_V3.md → Moving to a live project)"; return 1 2>/dev/null || exit 1; }
  done
  for NAME in FIREBASE_WEB_API_KEY FIREBASE_WEB_APP_ID PROJECT_NUMBER RUNTIME_SA APP_ORIGIN FIREBASE_AUTH_DOMAIN; do
    case "${!NAME:-}" in
      *"$STAGING_PROJECT"*|"$STAGING_API_KEY"|"$STAGING_APP_ID"|"$STAGING_NUMBER") echo "BLOCK A FAILED: $NAME still names staging; export $PROJECT_ID's own value (or open a fresh Cloud Shell tab)"; return 1 2>/dev/null || exit 1 ;;
    esac
  done
  export FIREBASE_WEB_API_KEY FIREBASE_WEB_APP_ID PROJECT_NUMBER APP_MODE PAYMENT_PROVIDER APP_ORIGIN
fi
export RUNTIME_SA="${RUNTIME_SA:-automathtics-v3-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
[[ "$RUNTIME_SA" == *"@${PROJECT_ID}.iam.gserviceaccount.com" ]] || { echo "BLOCK A FAILED: RUNTIME_SA ($RUNTIME_SA) is not an account of $PROJECT_ID (open a fresh Cloud Shell tab)"; return 1 2>/dev/null || exit 1; }
echo "project $PROJECT_ID (number $PROJECT_NUMBER), web app $FIREBASE_WEB_APP_ID, runtime $RUNTIME_SA"
cd ~ || return 1
if [[ ! -d AutoMathtics ]]; then git clone --quiet --branch release/v3.0 https://github.com/gavgunawan/AutoMathtics.git || return 1; fi
cd AutoMathtics && git fetch --quiet origin release/v3.0 && git checkout --quiet release/v3.0 && git pull --quiet --ff-only && cd commercial || return 1
gcloud config set project "$PROJECT_ID" --quiet
echo "node $(node --version)  java: $(java -version 2>&1 | head -1)"
npm ci --ignore-scripts --no-fund --no-audit --loglevel=error || { echo 'BLOCK A FAILED: npm ci'; return 1; }
# `set -o pipefail` above makes the pipeline's status the suite's, not tail's: a red suite stops here instead of reading DONE
npm test 2>&1 | tail -4 || { echo 'BLOCK A FAILED: unit tests'; return 1; }
echo "BLOCK A DONE in $(pwd)"
