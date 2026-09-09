#!/usr/bin/env bash
# Cloud Shell block D: Hosting only (after Cloud Run is already out), then the health and proxy-depth probes.
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/04-hosting.sh)
set -uo pipefail
: "${PROJECT_ID:?run 01-prepare.sh first}"
cd ~/AutoMathtics/commercial || { echo "run 01-prepare.sh first"; return 1 2>/dev/null || exit 1; }
mkdir -p .hosting
./node_modules/.bin/firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only hosting 2>&1 | tail -6
echo; echo "proxy depth probe:"; curl -s -H "X-Forwarded-For: 203.0.113.250" "https://${PROJECT_ID}.web.app/healthz"; echo
curl -s -o /dev/null -w "home page: %{http_code}\n" "https://${PROJECT_ID}.web.app/"
echo "BLOCK D DONE"
