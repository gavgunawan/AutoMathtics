#!/usr/bin/env bash
# Cloud Shell block I (DEPLOY_V3.md → Moving to a live project): give automathtics-live staging's sign-in rules. The password policy, the
# email enumeration protection and the SMS country allow-list are copied field for field from staging's own settings, and the authorized
# domains become localhost, the live project's two hosts and automathtics.net. Safe to rerun. It prints the settings, never a secret.
#   source <(curl -fsSL https://raw.githubusercontent.com/gavgunawan/AutoMathtics/release/v3.0/commercial/scripts/cloudshell/09-live-sign-in.sh)
set -uo pipefail
FROM=automathtics-v3-staging TO=automathtics-live API=https://identitytoolkit.googleapis.com/admin/v2/projects
[[ -z "${PROJECT_ID:-}" || "$PROJECT_ID" == "$TO" ]] || { echo "BLOCK I FAILED: this tab points at $PROJECT_ID; run it in the $TO tab"; return 1 2>/dev/null || exit 1; }
TOKEN="$(gcloud auth print-access-token)" || { echo 'BLOCK I FAILED: gcloud could not give a token'; return 1 2>/dev/null || exit 1; }
# Only the fields copied leave node: the settings answer also carries the password hash parameters, which are never printed or kept.
BODY="$(curl -fsS -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $FROM" "$API/$FROM/config" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const c = JSON.parse(s), p = c.passwordPolicyConfig || {};
  const body = {
    passwordPolicyConfig: { passwordPolicyEnforcementState: p.passwordPolicyEnforcementState, passwordPolicyVersions: (p.passwordPolicyVersions || []).map((v) => ({ customStrengthOptions: v.customStrengthOptions })), forceUpgradeOnSignin: Boolean(p.forceUpgradeOnSignin) },
    emailPrivacyConfig: { enableImprovedEmailPrivacy: Boolean(c.emailPrivacyConfig && c.emailPrivacyConfig.enableImprovedEmailPrivacy) },
    smsRegionConfig: c.smsRegionConfig,
    authorizedDomains: ["localhost", "automathtics-live.firebaseapp.com", "automathtics-live.web.app", "automathtics.net"],
  };
  const regions = body.smsRegionConfig && body.smsRegionConfig.allowlistOnly && body.smsRegionConfig.allowlistOnly.allowedRegions;
  if (p.passwordPolicyEnforcementState !== "ENFORCE" || !body.emailPrivacyConfig.enableImprovedEmailPrivacy || !(regions && regions.length)) process.exit(3);
  process.stdout.write(JSON.stringify(body));
});')"
case $? in
  0) ;;
  3) echo "BLOCK I FAILED: staging's sign-in settings are not as expected (policy enforced, enumeration protection, an SMS allow-list), so live was not changed"; return 1 2>/dev/null || exit 1 ;;
  *) echo "BLOCK I FAILED: staging's sign-in settings could not be read"; return 1 2>/dev/null || exit 1 ;;
esac
curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $TO" -H 'Content-Type: application/json' \
  "$API/$TO/config?updateMask=passwordPolicyConfig,emailPrivacyConfig,smsRegionConfig,authorizedDomains" --data "$BODY" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const a = JSON.parse(s), v = ((a.passwordPolicyConfig || {}).passwordPolicyVersions || [])[0] || {};
  console.log("live sign-in settings:", JSON.stringify({ policy: (a.passwordPolicyConfig || {}).passwordPolicyEnforcementState, minLength: (v.customStrengthOptions || {}).minPasswordLength,
    enumerationProtection: Boolean((a.emailPrivacyConfig || {}).enableImprovedEmailPrivacy), smsRegions: ((a.smsRegionConfig || {}).allowlistOnly || {}).allowedRegions,
    secondFactor: (a.mfa || {}).state, domains: a.authorizedDomains }));
});' || { echo "BLOCK I FAILED: live's sign-in settings were not changed"; return 1 2>/dev/null || exit 1; }
unset TOKEN BODY
echo 'BLOCK I DONE. Check secondFactor says ENABLED: if not, turn on SMS multi-factor in the console (Authentication → Sign-in method) first.'
