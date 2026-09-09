# Stage 3 handoff — the economy behind the server

Stage 2 closed on `release/v3.0` with the learning engine (PR #3), unpaid practice (PR #4), the
no-transfer invariant and phone key (PR #5) and the one-off v2 import tool (this PR). The tip SHA is
recorded in the merge commit of this PR.

## What Stage 3 is

Everything a child can *spend* or *be given*, moved behind the same session/transaction pattern:

1. **Wallet ledger** — `wallet.gc` / `wallet.rp` become balances backed by an append-only ledger
   (`earn`, `spend`, `redeem`, `adjust`), each row idempotent by id, so a retried purchase cannot
   charge twice and a balance can always be re-derived.
2. **Shop** — catalogue owned by the server (ids, prices, rarity, slots), purchases as ledger rows,
   inventory and equipped cosmetics on the learning document; the v2 crate/egg/earned-pet rules only
   if they are wanted commercially.
3. **Reward store and redemptions** — parent-defined rewards per family with the per-child
   checkboxes; a child requests, a parent approves or rejects (recent-auth required), points move
   only on approval; daily limits.
4. **Family Rocket** — one shared goal per family, fuelled from each child's wallet in-family only.
5. **Weekly System Scan** — the ×2 mixed session, once per ISO week per child, server-scheduled.
6. **Parent progress view** — read-only summary of each child's tracks, wallet and last sessions
   in the parent workspace.
7. **Honouring v2 purchases** — the import tool stores `legacy.inventory`, `legacy.active`,
   `legacy.purchases` and `legacy.redemptions`; the shop slice converts them into ledger rows once.

## Rules carried forward

- Practice pays nothing (PR #4). Nothing moves between families (PR #5, `NO_TRANSFER.md`).
- Free trial, when built: one per `phoneKey` (`phones/{key}.count`).
- No route may write papers, crowns or balances directly; only ledger rows through server logic.
- Every mutation: one transaction, `authorize()` re-read inside it, idempotency key from the client.
- Firestore shape: no `undefined`, no arrays in arrays, `expireAt` on anything short-lived.

## Operator tasks that remain from Stage 2

- Run the v2 import for the owner's own children once the v3 project exists (`scripts/migrate-v2.mjs`, dry run first).
- Firestore TTL policies (`DEPLOY_V3.md` §4b), `TRUSTED_PROXY_HOPS` measurement (§5), Firebase console settings (§2).
