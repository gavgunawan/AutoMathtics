# Stage 4 — real provider, staging, real MFA, private pilot

Entered 9 Sep 2026 with Stages 1–3 closed for development at `release/v3.0 @ ab16a40`. Stage 4 works
*against* that foundation; nothing below redesigns it. "Closed for development" is not a public-production
certification — Stage 4 is where the external systems and real-user conditions get proven. The owner's
constraint stands: **zero cost for as long as possible**; every step that spends money is marked and needs
the owner's go.

| Workstream | What it proves | Cost / owner action |
|---|---|---|
| **4.0 foundation** | supported CI runtimes on immutable SHAs; self-service sign-in account deletion completing the parent lifecycle; this plan | none |
| **4.1 Stripe adapter** — built, unit-tested against a recorded Stripe surface | the Stage 3 gateway contract against a real provider: hosted checkout, provider idempotency keys, `Stripe-Signature` verification, price ids → plans, refund facts from the provider object, superseded sessions expired at the provider, provider state fetched where event order is not total (`PAYMENTS.md` → Stripe) | none to build; **Stripe account in test mode** (free, no fees) to exercise in 4.2 — owner creates it |
| **4.2 reconciliation** — code built and unit-tested (provider effects of cancel / scheduled downgrade / deletion, `reconcile-provider`, `resolve-event`, RECONCILIATION.md runbook and sandbox drill); **the sandbox drill itself waits for the owner's Stripe test account** | `reconciliation_required`, stale/frozen/superseded intents, provider-charged-but-local-finalisation-failed, webhook retries and out-of-order delivery, dunning, cancellations, refunds, reconciliation reports — with `stripe listen` forwarding real test-mode events to the local server | none (Stripe test mode + emulator) — owner creates the free test account and runs RECONCILIATION.md → sandbox drill with the operator |
| **4.3 staging** | a separate v3 Firebase project with production-equivalent IAM, Secret Manager, HTTPS origin, `TRUSTED_PROXY_HOPS` measured, TTL policies, logging, rollback; never connected to the v2 `automathtics` project | **Blaze billing account** (Cloud Run min 0, expected near-zero at pilot scale; budget alerts first) — owner's go |
| **4.4 real MFA + recovery** — policy and ceremony built (`RECOVERY.md`: self-service, seven-day wait, proof by the provider's own password reset, cancelled by any full sign-in, operator can only cancel; tested in memory and against the Auth emulator) | real SMS second factor (Identity Platform on the staging project) and the lost-phone / changed-number recovery ceremony that cannot be socially engineered through support | **SMS cost per message** once real phones are used (4.3 staging); the ceremony itself costs nothing |
| **4.5 private pilot + migration** | real parent/family/child accounts; dry-run comparison of the children's v2 exports; import into the v3 child ids; the pilot family uses v3 — and stops progressing in v2 after cutover | none beyond 4.3 |
| **4.6 device acceptance** | iPhone Safari, Android Chrome, desktop: sign-up, MFA, handover, placement, learning, read-aloud, games, plan changes, recovery, sign-out and failure states | owner's devices and time |
| **4.7 operational and privacy readiness** — `RECONCILIATION.md` (payments) and `PRIVACY.md` (inventory, retention, the parent's rights, what is not collected, what the legal review must settle) written; monitoring/backup/rollback runbooks wait for the staging project | runbooks (payment reconciliation, deletion/export verification, rollback), monitoring, backup assumptions, privacy disclosures and the retention table against the staging infrastructure | none |

## Ground rules

- `PR #1` (release → main) stays **draft**. v2 stays live and untouched until the pilot family has cut over
  and the owner says so.
- The provider adapter keeps the Stage 3 contract (`PAYMENTS.md` → adapter contract). If the contract needs a
  change, that is a Stage 3 hardening PR with the review team, not an adapter shortcut.
- Nothing in Stage 4 may add a browser route that writes arbitrary state; operator work stays in the CLI.
- Every workstream ends with the same gate: unit + emulator + container-build green on the exact release push.

## Order

4.0 → 4.1 → 4.2 (all zero-cost; the owner needs only a free Stripe test account for 4.2) → 4.3 when the owner
opens the billing account → 4.4 → 4.5 → 4.6 → 4.7 alongside.
