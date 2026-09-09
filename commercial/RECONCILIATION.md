# Billing reconciliation — runbook (Stage 4.2)

Two records describe every paying family: ours (`families/{f}.subscription`, written only by the
state machine from signed provider events and the parent's own actions) and the provider's (the
Stripe customer and subscription). They are meant to agree, and the code keeps them that way in the
ordinary run of things: the parent's cancel, undo and scheduled downgrade reach the provider before
the record changes; a deletion ends the provider's subscription before `terminate` is recorded; every
provider event goes through the inbox with an outcome. This runbook is for the rest — the cases where
a provider fault, a dashboard edit, a redelivery or a deleted family leaves the two apart — and for the
drill that proves it all in Stripe's test mode before a real family ever pays.

Nothing here edits `families/*` by hand. Every corrective action is a CLI command under the operator's
identity, writes an audit row, and is either a recorded server-side reprocessing or a **record** of
what was done at the provider. Money moves only at the provider (the dashboard), never here.

## The checks

| Command | When | What you get |
|---|---|---|
| `node scripts/support.mjs inbox` | daily | every event the server could not apply and still waits on (`requires_action`) |
| `node scripts/support.mjs inbox reconciliation_required` | daily | late events on deleted families, unresolved ones first |
| `node scripts/support.mjs inbox rejected` | weekly | events refused outright (unknown customer, mismatched checkout, unknown price…) |
| `node scripts/support.mjs family FAMILY_UUID` | on any ticket | the report; read **attention** first |
| `node scripts/support.mjs reconcile-provider FAMILY_UUID` | on any billing ticket, after any dashboard edit, weekly for every paying family | the provider's customer and subscription against ours; `match` and `findings`; open intents with provider evidence |

## Findings → action

| Finding | Meaning | Action |
|---|---|---|
| `PLAN_MISMATCH` | the provider bills a price that is neither the family's plan nor its scheduled one | if the dashboard was edited: set the price back at the provider, or apply the intended change through the parent's own flow (`/api/billing/plan`) so both sides move together; never edit the family record |
| `CANCEL_FLAG_MISMATCH` | cancel-at-period-end differs | the parent's flow (`/api/billing/cancel`, undo) sets both; if the provider alone was changed, ask the parent or set the provider flag back |
| `PERIOD_END_MISMATCH` | the provider's period end differs from ours by more than a minute | usually a renewal we have not applied: check the inbox for that customer (`requires_action`, `rejected`), then `reprocess FAMILY_UUID`; if the provider's period was changed in the dashboard, the next `invoice.paid` corrects ours |
| `NO_PROVIDER_SUBSCRIPTION` / `NO_PROVIDER_CUSTOMER` | the family is paid on our side but the provider has nothing live | the provider ended it (dunning, dashboard cancel) and we missed the `customer.subscription.deleted`: find it in the inbox and `reprocess`; if the provider never had it, the family is on a subscription it is not paying for — end it (`scripts/subscription.mjs` terminate) and tell the parent |
| `PROVIDER_SUBSCRIPTION_LIVE` | ours ended (cancelled, expired, refunded in full), the provider still bills | cancel at the provider, refund what the dashboard shows as charged after our end date, then `resolve-event` the notices that follow |
| `DELETED_FAMILY_PROVIDER_LIVE` | the family is deleted, the provider still bills (`deletions/{f}.providerCancellation` says `failed`) | cancel at the provider now; `resolve-event PROVIDER EVENT_ID cancelled_at_provider "…"` for the late notice; refund in the dashboard if a charge landed after the deletion |
| `UNKNOWN_PROVIDER_PRICE` | the provider bills a price id the adapter does not know | a price was created or changed in the dashboard: fix the `STRIPE_PRICE_*` configuration or move the subscription to a known price |
| `PROVIDER_UNREACHABLE` | no verdict this run | retry; if it persists, the key or the network, not the family |

Open change intents are listed with `providerEvidence`: `provider_on_target_plan` means the provider
applied a change we could not finalise (a `creating`/`stale` upgrade after a crash) — record it with
`reconcile-intent PROVIDER OPERATION_UUID applied_by_operator "…"` after applying the plan through the
parent's flow or an operator event, or `provider_reverted` after putting the price back;
`provider_on_other_plan` with `no_provider_change` closes an intent whose provider call never landed.

## Deleted families

A deletion cancels the provider's subscription before it records `terminate`, and the result is on the
deletion record. Anything the provider sends afterwards for that customer is recorded as
`reconciliation_required: FAMILY_DELETED` and never applied. The operator's job is at the provider —
cancel if still live, refund a charge that landed after the deletion — and then `resolve-event` with
what was done. The family record itself is a tombstone and stays one.

## Refunds

Refunds are issued in the provider's dashboard, never here. The provider's `charge.refunded` reaches
the inbox and becomes the machine's `refund` event: a partial refund is a record, a full one ends
access now. On a deleted family the same event is `reconciliation_required`; resolve it with
`refunded_at_provider`. A refund never cancels the provider's subscription by itself — cancel it too,
or `reconcile-provider` will report `PROVIDER_SUBSCRIPTION_LIVE`.

## Sandbox drill (Stripe test mode, zero cost) — run once before the pilot pays

Needs: the owner's free Stripe account in test mode with three recurring prices, `stripe` CLI, the
emulator (`DEPLOY_V3.md` §3), `.env` with `PAYMENT_PROVIDER=stripe` and the `STRIPE_*` variables.
Card `4242 4242 4242 4242` pays, `4000 0000 0000 0341` attaches but fails on renewal.

1. `stripe listen --forward-to 127.0.0.1:8787/api/webhooks/stripe` → put the printed `whsec_` in
   `WEBHOOK_SECRET_STRIPE`, start the server.
2. **Checkout**: a parent starts the starter plan, pays with 4242 → `checkout.session.completed` applied,
   `family FAMILY_UUID` shows `active`, `reconcile-provider` matches.
3. **Supersede**: start a second checkout before paying the first → the first session is expired at Stripe;
   paying it is impossible; the second completes.
4. **Redelivery and order**: `stripe events resend EVENT_ID` twice → `replayed`; resend an older invoice
   after a newer one → `ignored: STALE_EVENT`.
5. **Upgrade** through the app → Stripe invoices the proration; the intent is `applied` with the
   subscription and invoice reference; `reconcile-provider` matches.
6. **Crash between provider and finalisation**: stop the server right after Stripe answers the upgrade
   (or set `INTENT_INFLIGHT_MS` low and interrupt) → the intent is `creating`, the report lists it,
   `reconcile-provider` says `provider_on_target_plan`, a retry with the same operation id finalises it.
7. **Downgrade** → Stripe's price changes with no invoice; `stripe subscriptions update` is not needed;
   advance the test clock (`stripe test_helpers test_clocks`) past the period end → `invoice.paid` on the new
   price applies the parent's seat choice.
8. **Cancel at period end** and undo → the flag moves at Stripe each time; advance the clock past the
   period end with the flag set → `customer.subscription.deleted` → `terminate`.
9. **Dunning**: subscribe with 0341, advance the clock → `invoice.payment_failed` → `grace`, then
   `past_due`; pay the open invoice in the dashboard → `invoice.paid` → `active`.
10. **Refund**: refund the last charge in the dashboard (partial, then full) → `refund` recorded, then access
    ends; cancel the subscription too; `reconcile-provider` matches.
11. **Deletion**: request and force-execute a deletion → the subscription is cancelled at Stripe, the deletion
    record says so; resend the `customer.subscription.deleted` → `reconciliation_required`; `resolve-event`.
12. **Dashboard drift**: change the price in the dashboard → `reconcile-provider` reports `PLAN_MISMATCH`;
    put it back → matches.

Every step's evidence is in the family report, the reconciliation records and the audit rows; keep the
`stripe listen` log with the drill.
