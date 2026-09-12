# Stage 2 close-out — the whole game behind the server

Stage numbering, corrected: **Stage 2 is the full product/game migration** (learning engine and
the economy). **Stage 3 is payments, subscriptions and the commercial account lifecycle.** An earlier
handoff note on this branch line called the economy "Stage 3"; that was wrong and is withdrawn.

## What closes Stage 2

On top of the Stage 1/1b foundation and the Stage 2 core (PRs #3–#6), this merge brings in:

- **Review follow-ups closed:** S1B-A (token verified locally, account throttle on the proven uid,
  one fresh Auth lookup), S1B-B (a saturated failed-login address bucket no longer blocks a valid
  signed login from the same address; bad credentials stay throttled), S2-A (durable 20-per-hour
  new-session budget per child, resume free), S2-B (canonical answer grammar: no leading zeros, no
  negative zero, fraction objects with exactly `n` and `d`, denominators non-zero), S2-C (real-emulator
  race: two attempts on the same question, exactly one commits, the other is `STALE_QUESTION`).
- **The v2 economy, server-owned** (`server/game.mjs`): catalogue and prices; purchases with
  server-chosen Surprise Box loot; Mystery Egg hatching and Storm Dragon / Thunder Hawk unlocks
  derived from trusted progress; streak shields; equip slots; the parent-configured Reward Store
  with per-child eligibility, daily caps, child requests and parent approve/reject with refund;
  the Family Rocket (build, fuel, auto-launch, force-launch, scrap, claim); weekly System Scan
  (×2, no paper advance, once per family week); parent credits and adjustments (idempotent, ledgered);
  parent-visible progress, history and fluency heatmap; per-child pace and family time zone;
  Navigator read-aloud in the browser.
- **Owner rules preserved:** practice runs pay nothing and count for no streak (PR #4); nothing
  moves between families and families are keyed to the verified phone (PR #5); the one-off v2 import
  (PR #6) now fills the real game wallet — inventory, equipped items, shields, purchases,
  redemptions, scan week — dropping and reporting any item the v3 catalogue does not know.

## Provenance of this merge

The economy code, the review-finding fixes and their tests were authored by the review team and
delivered as draft PR #7 (`hardening/stage2-completion`): two gzip+base64 patches that a
`contents: write` workflow was meant to apply and push. That mechanism was not accepted onto the
release line (a CI job applying opaque patches with push credentials is the supply-chain pattern the
audits warn against, and the new-files patch's checksum did not match the workflow's own expectation).
The patches were decoded, verified where possible, applied at their base `dbc189f`, and three-way
merged onto the current `release/v3.0` here, reconciling them with PRs #4–#6. PR #7 is closed with
this explanation; its branch remains for reference.

## Known follow-ups (not blockers)

- `server/game.mjs` and `server/learning.mjs` carry long multi-statement lines from the delivered
  patch; a formatting-only pass is worth doing before the next audit round.
- Wallet balances are mutated in place; the `ledger/*` rows are append-only evidence, not yet the
  source of truth. Deriving balances from the ledger is a Stage 3 hardening item alongside payments.
- Real iPhone Safari / Android Chrome acceptance of the child and parent game screens is manual.
- Firestore TTL policies, `TRUSTED_PROXY_HOPS`, console settings: on the real project (DEPLOY_V3.md).

## Stage 3, as defined by the team

Payment gateway and subscription webhooks; automated entitlement lifecycle from payment state;
free trial (one per `phoneKey`); upgrade/downgrade; account recovery, export and deletion; commercial
admin/support tooling; production deployment, monitoring and privacy operations.
