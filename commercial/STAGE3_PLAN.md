# Stage 3 — payments, subscriptions and the commercial account lifecycle

Branching point: `release/v3.0 @ bddae6500fe6ed11bceecedc1b6abf951d908452` (Stages 1 and 2 closed
for development by the review team on 9 Sep 2026). Order agreed with the team:

| Step | Scope | Status |
|---|---|---|
| 3.1 | Commercial ledger hardening — balances reconcilable and derived before money enters | merged (PR #9); hardened per audit (bootstrap, never-overwrite, safe repair) |
| 3.2 | Subscription + entitlement state machine: trial, active, grace, past-due, cancelled, expired; seat plans; one trial per `phoneKey` — see `SUBSCRIPTIONS.md` | merged (PR #10); hardened per audit (seat reactivation, event fingerprints, retry-safe parent actions, real-Firestore trial race) |
| 3.3 | Payment gateway abstraction + webhook security, with local/fake payment events (the $0 constraint holds); global provider-event inbox — see `PAYMENTS.md` | merged (PR #12); hardened per the second review (price ids → plans, no `plan.change` over webhooks) |
| 3.4 | Upgrade / downgrade / cancel / refund lifecycle (including resolving a provider downgrade that needs a seat choice — 3.3 records it as rejected) — see `SUBSCRIPTIONS.md` → Lifecycle | **this branch** |
| 3.5 | Recovery, export, deletion, commercial admin/support tooling | next |
| Stage 4 | Real provider, staging environment, private pilot | |

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
- Trials: one per `phoneKey`; a family with `phones/{key}.count > 1` gets no trial.
- Keep the emulator as the only environment until Stage 4; fake payment events are fixtures, not a sandbox account.

## Open decisions before the family cutover (from the team's Stage 2 review)

- An unfinished Mystery Egg at cutover: refund its 900 ⚡ as a `migrate.opening` component, or start fresh. **Proposed: refund.**
- Family-level Reward Store and Rocket configuration: re-enter in the parent workspace (a few items) or extend the importer. **Proposed: re-enter.**
