# Stage 3 — payments, subscriptions and the commercial account lifecycle

Branching point: `release/v3.0 @ bddae6500fe6ed11bceecedc1b6abf951d908452` (Stages 1 and 2 closed
for development by the review team on 9 Sep 2026). Order agreed with the team:

| Step | Scope | Status |
|---|---|---|
| 3.1 | Commercial ledger hardening — balances reconcilable and derived before money enters | merged (PR #9) |
| **3.2** | Subscription + entitlement state machine: trial, active, grace, past-due, cancelled, expired; seat plans; one trial per `phoneKey` — see `SUBSCRIPTIONS.md` | **this branch** |
| 3.3 | Payment gateway abstraction + webhook security, with local/fake payment events (the $0 constraint holds) | next |
| 3.4 | Upgrade / downgrade / cancel / refund lifecycle | |
| 3.5 | Recovery, export, deletion, commercial admin/support tooling | |
| Stage 4 | Real provider, staging environment, private pilot | |

## 3.1 — what this branch delivers

`server/ledger.mjs` is now the financial source of truth for Grid Coins and Reward Points.

- **One row per movement**, immutable, under `families/{f}/learning/{c}/ledger/{id}`: `type`, signed
  `gc`/`rp` deltas, `ref`/`note`, `seq`, `prev` (the previous row's id) and `balance` (after).
  Types: `learn.session`, `learn.checkpoint`, `learn.scan`, `streak.shield`, `shop.buy`,
  `reward.request`, `reward.refund`, `rocket.fuel`, `parent.adjust`, `migrate.opening`, `reconcile.repair`.
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
