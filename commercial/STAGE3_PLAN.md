# Stage 3 — payments, subscriptions and the commercial account lifecycle

Branching point: `release/v3.0 @ bddae6500fe6ed11bceecedc1b6abf951d908452` (Stages 1 and 2 closed
for development by the review team on 9 Sep 2026). Order agreed with the team:

| Step | Scope | Status |
|---|---|---|
| 3.1 | Commercial ledger hardening — balances reconcilable and derived before money enters | merged (PR #9); hardened per audit (bootstrap, never-overwrite, safe repair) |
| 3.2 | Subscription + entitlement state machine: trial, active, grace, past-due, cancelled, expired; seat plans; one trial per `phoneKey` — see `SUBSCRIPTIONS.md` | merged (PR #10); hardened per audit (seat reactivation, event fingerprints, retry-safe parent actions, real-Firestore trial race) |
| 3.3 | Payment gateway abstraction + webhook security, with local/fake payment events (the $0 constraint holds); global provider-event inbox — see `PAYMENTS.md` | merged (PR #12); hardened per the second review (price ids → plans, no `plan.change` over webhooks) |
| 3.4 | Upgrade / downgrade / cancel / refund lifecycle — see `SUBSCRIPTIONS.md` → Lifecycle | merged (PR #14); hardened per review (PR #16) and close-out (PR #17); closed for development |
| 3.5 | Recovery, export, deletion, commercial admin/support tooling — see `SUPPORT.md` | merged (PR #18); deletion hardened per the full-system review (quiesced, batched, resumable, webhook-proof) |
| Stage 4 | **GO** (team, 9 Sep 2026; Stages 1–3 closed for development) — see `STAGE4_PLAN.md`. Acceptance list carried from Stage 3: real adapter with idempotency keys and a total event order; cancel/expire superseded provider checkouts; refund facts from the provider's refund object; reconciliation of `reconciliation_required` and `frozen`/`stale` intents; **self-service Firebase Auth account deletion after family deletion and the identity retention period**; **lost-phone / changed-number MFA recovery ceremony that does not enable takeover**; growth of `refunds[]` / `pending[]` | |

## 3.1 — what this branch delivers

`server/ledger.mjs` is now the financial source of truth for Grid Coins and Reward Points.

- **One row per movement**, immutable, under `families/{f}/learning/{c}/ledger/{id}`: `type`, signed
  `gc`/`rp` deltas, `ref`/`note`, `seq`, `prev` (the previous row's id) and `balance` (after).
  Types: `learn.session`, `learn.checkpoint`, `learn.scan`, `streak.shield`, `shop.buy`,
  `reward.request`, `reward.refund`, `rocket.fuel`, `parent.adjust`, `migrate.opening`, `ledger.opening` (the one-time opening row for a wallet that existed before the ledger).
- **`post()` is the only way a balance changes.** It writes the row and returns the progress document
  with the cached `gc`/`rp`, `ledgerSeq` and `ledgerLast` advanced, inside the caller's transaction,
  after all reads. It refuses to take a balance below zero.
- Threaded through every mutation: shop purchase (including crate and egg), reward request, reward
  refund on rejection, rocket fuel, parent adjustment, session earnings (pass, check point, scan, streak
  bonus — one row per finished session keyed by the session id), the streak-shield bonus at session
  start, and the migration's opening balance. No code path mutates `wallet.gc`/`wallet.rp` directly.
- **`derive()` / `reconcile()`** recompute the balance from the rows and check the chain: contiguous
  sequence, linked ids, honest running balances, cache equal to the sum.
- **`scripts/reconcile.mjs`** runs that check for every child in a family (read-only; `CONFIRM_REPAIR=write`
  sets the cache to the ledger's value and audits it). The store contract gained `list(collection)`.
- Tests (`tests/ledger.test.mjs`): validation, chaining, overdraft refusal, tamper and gap detection,
  an end-to-end run where every kind of movement is followed by a full reconciliation, idempotent
  replays writing no second row, the shield bonus, and a migrated child's opening row.

## Second review follow-ups (9 Sep 2026, after PR #11 and PR #12)

| Item | Status |
|---|---|
| **S3-F1** expired 24-hour operation receipt could replay non-ledger side effects (shield, egg, rocket fuel) once TTL deletes `operations/*` | **closed**: `post()` refuses an identical row (`LEDGER_REPLAYED`) — the ledger row is the durable receipt, so the transaction that rebuilt the side effects aborts; regression in `tests/game.test.mjs` deletes the receipt and replays buy and fuel |
| 3.1 opening rows only as sequence 1 | closed: `LEDGER_OPENING_NOT_FIRST` |
| 3.1 bootstrap must stop when rows exist without metadata | closed: `bootstrap()` lists the rows first, `LEDGER_DAMAGED`; the script reports and exits 3 |
| 3.2 operation ids mandatory for browser billing mutations | closed: `OPERATION_ID_REQUIRED`, uuid-validated |
| Policy: manual pilot grant vs trial | decided: an active manual grant blocks the trial (`MANUAL_GRANT_ACTIVE`); the operator chooses when a family moves to subscription management |
| 3.3 must resolve the family from the provider-customer mapping and map provider price ids to plans; never trust plan/seats/family from the payload | closed: `billingCustomers` mapping (PR #12) + price table (`FAKE_PRICES`), `UNKNOWN_PRICE`, payload naming a plan is malformed |
| 3.3 keep `plan.change` out of webhook mapping | closed: `subscription.updated` is recorded and ignored until 3.4 |

## Full-system review follow-ups (9 Sep 2026, after PR #18) — Stage 3 exit

| Item | Status |
|---|---|
| **Exit follow-up** terminate ran before the freeze (a crash or a payment between them left a terminated-but-usable family, or a tombstone with a live subscription); `login()` could still mint a session while executing | closed: the freeze is the first mutating transaction and `terminate` follows it; `login()` reads the family and refuses `FAMILY_DELETED` before any session write; regressions for a crash before the freeze, a crash between freeze and terminate with a signed renewal and a fresh login in that gap, and zero surviving sessions after deletion — in memory and against the emulator; phase 0 looks intents up by family instead of scanning the collection |
| **Blocker 1** deletion not quiesced; partial deletion after a crash; concurrent Stage 1/2 writes | closed: phase 0 sets `deletion.status = executing` atomically, `authorize()` refuses executing families, live checkouts and open intents frozen, sessions swept; the job is resumable (phase and counts recorded) — crash-after-first-phase and concurrent-write tests, in memory and against the emulator |
| **Blocker 2** whole-child deletion in one transaction (500-write limit) | closed: bounded sweeps of 300 per transaction over sessions, ledger rows and receipts; the in-memory store now refuses more than 500 writes per transaction like Firestore; tested with more than 500 rows, in memory and against the emulator |
| **Blocker 3** a late webhook could reactivate a tombstoned family | closed: `reconciliation_required: FAMILY_DELETED` recorded in the inbox for a deleted or executing family, never applied; frozen checkouts are `CHECKOUT_SUPERSEDED`; signed-webhook-after-deletion test in memory and against the emulator |
| Operator reprocessing not durably attributed | closed: `supportOperations/{id}` written under the operator before anything moves, finalised after |
| Retention declaration vs reality | closed: `audit/*` (TTL 400 days), `deletions/{f}`, `supportOperations/*` added to RETENTION and SUPPORT.md; UI wording corrected |
| Transaction-retry counters | closed: counts are returned by each transaction and accumulated in the deletion record |
| Family deletion is not Auth-account deletion; lost-MFA recovery | stated in SUPPORT.md and the UI; on the Stage 4 acceptance list |

## 3.3/3.4 close-out follow-ups (9 Sep 2026, after PR #16)

| Item | Status |
|---|---|
| **S3.3/3.4-E** a fresh checkout bypassed the plan-change lifecycle; several live checkouts per family | closed: checkout only with no subscription / trial / past_due / cancelled / expired (`USE_PLAN_CHANGE` otherwise, past-due recovery explicit); one live checkout per family and provider, the older `superseded` and its completion `CHECKOUT_SUPERSEDED` |
| **S3.4-F** takeover race: an abandoned intent could still finalise and clear another change's marker | closed: takeover marks the abandoned intent `superseded` in the same transaction; finalisation requires the subscription version *and* `families/{f}.billingIntent` naming this operation; a stale finalisation never clears a marker that is not its own; the A-stalls → B-takes-over → A-resumes race is tested in memory and against the Firestore emulator |
| **S3.4-G** change intents (and checkouts) had a 30-day TTL | closed: no `expireAt`; retention policy in `PAYMENTS.md`; TTL list in DEPLOY_V3 corrected |
| Wording: "atomicity" | corrected: idempotency + stale-state detection; the provider/local disagreement is a Stage 4 reconciliation rule with the provider operation reference kept permanently; 3.5 exposes the operator path |
| Carried to Stage 4 | real adapter supplies a total event order; refund facts from the provider's refund object; growth of `refunds[]` / `pending[]` watched |

## 3.4 review follow-ups (9 Sep 2026, after PR #15)

| Item | Status |
|---|---|
| **S3.4-A** plan-change idempotency ignored the seat selection | closed: change intent fingerprint = plan + normalized seat ids; same id + different choice → `IDEMPOTENCY_CONFLICT` (regression in `tests/review34.test.mjs`) |
| **S3.4-B** an upgrade could drop a seated child via `seatChildIds` | closed: an upgrade's seat list must contain every active child (`SEATS_CANNOT_REMOVE`) |
| **S3.4-C** the 3.4 test that let a renewal on an unrelated plan apply | closed in PR #15 (`PLAN_CHANGE_NOT_AUTHORIZED`); the rule table is in "3.3 re-check follow-ups" |
| **S3.4-D** rejected-renewal recovery relied on a provider redelivery | closed: `requires_action` outcomes are kept on the customer mapping and reprocessed by the server when the parent's change is recorded or a checkout completes; a redelivery is a replay |
| Upgrade during grace granted capacity for a zero prorated charge | closed: immediate upgrade only while `active` (`RENEWAL_REQUIRED` in grace); a downgrade can still be scheduled into the renewal |
| Refund bound | closed: `amountCents ≥ 1`; adapter derives refund facts from the provider object before Stage 4 |
| Real-provider plan-change atomicity | closed: `billingChangeIntents/{provider}:{operationId}` written before the provider call with the operation id as idempotency key, one call in flight per family (`CHANGE_IN_PROGRESS`), finalised only if the subscription version is unchanged (`SUBSCRIPTION_CHANGED`) |

## 3.3 re-check follow-ups (9 Sep 2026, after PR #14) — the 3.4 acceptance list

| # | Criterion | Where |
|---|---|---|
| S3.3-A | checkout intent persisted before the provider; strict same-id/same-plan idempotency; crash and race resume with the same key | `Payments.checkout`, `tests/recheck33.test.mjs` |
| S3.3-B / 1 | a different-plan `invoice.paid` cannot change the plan without a server-recorded intent | `transition('payment.succeeded')` → `PLAN_CHANGE_NOT_AUTHORIZED`, `CHECKOUT_REQUIRED` |
| 2 | upgrade/downgrade is a durable operation with its own id and fingerprint | `families/{f}/billing/{operationId}` (`plan.change` / `plan.schedule`) |
| 3 | provider price → plan stays server-owned | gateway table (`FAKE_PRICES`) |
| 4 | a downgrade needs the explicit seat choice before it can finalize | `plan.schedule` requires `seatChildIds` when the children do not fit |
| 5 | an upgrade preserves inactive children's progress and allows deliberate re-seating | `plan.change` with `seatChildIds`; `tests/lifecycle.test.mjs` |
| 6 | a payment for the same plan is an ordinary renewal | `tests/recheck33.test.mjs` |
| 7 | cancellation/renewal race is deterministic: an invoice never undoes a cancellation | `cancelAtPeriodEnd` survives a renewal; only `cancel.undo` / checkout / operator clears it |
| 8 | checkout intent before the provider, strict idempotency | as S3.3-A |
| 9 | real adapters use the internal checkout id as the provider-side idempotency key | `createCheckout({ idempotencyKey })`; adapter contract in `PAYMENTS.md` |
| 10 | `checkout.completed` must correspond to a known checkout | `CHECKOUT_REQUIRED` / `UNKNOWN_CHECKOUT` / `CHECKOUT_MISMATCH` / `CHECKOUT_ALREADY_COMPLETED` |
| 11 | refunds are provider-driven, idempotent, and never alter Grid Coin/RP ledgers | `refund` event; `tests/lifecycle.test.mjs` asserts zero ledger rows |
| 12 / S3.3-C | equal-time and out-of-order webhook cases; future-dated events bounded | `seq` ordering key, `EVENT_IN_FUTURE`; `tests/recheck33.test.mjs` |

## Rules for 3.2 onward

- Payment and entitlement events never touch a child wallet directly; if they ever grant coins, they post rows.
- Entitlement state lives on the family (`families/{f}.entitlement`) and changes only through the state
  machine in 3.2, driven by verified webhook events (3.3) or operator tools — never by a browser route.
- Every webhook is idempotent by provider event id, verified by signature, and recorded before it is acted on.
- Trials: one winning trial per verified phone (`phones/{key}.trialFamilyId`), however many families or emails sit under it; a family on an active manual grant is not offered one.
- Keep the emulator as the only environment until Stage 4; fake payment events are fixtures, not a sandbox account.

## Open decisions before the family cutover (from the team's Stage 2 review)

- An unfinished Mystery Egg at cutover: refund its 900 ⚡ as a `migrate.opening` component, or start fresh. **Proposed: refund.**
- Family-level Reward Store and Rocket configuration: re-enter in the parent workspace (a few items) or extend the importer. **Proposed: re-enter.**
