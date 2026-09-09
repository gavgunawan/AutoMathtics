# Payments: the gateway abstraction and webhook security (Stage 3.3)

`server/payments.mjs`. No money moves in this stage and no provider account exists: the only
gateway is `fake`, whose webhooks are signed fixtures the operator sends. Everything a real
provider will need in Stage 4 — checkout, customer references, signature verification, the
inbox, idempotency, ordering — is built and tested against the fake one now, so attaching a
real provider is an adapter, not a redesign. The $0 constraint holds.

## The shape of it

```
parent ──POST /api/billing/checkout {plan, operationId}──▶ server mints cus_<uuid> once per family,
        records checkouts/{provider}:{checkoutId} (pending), asks the gateway for a checkout
        (fake: nothing; real: a hosted page URL) ──▶ browser shows the reference / follows the URL

provider ──POST /api/webhooks/{provider}, X-Webhook-Signature──▶ verify MAC over the raw bytes
        ──▶ normalize ──▶ ONE transaction: inbox replay check → customer → family → commit() → record
```

## Webhook security

- **Authentication is the signature, nothing else.** The route runs before the browser checks:
  no cookie, no CSRF token, no Origin. `X-Webhook-Signature: t=<unix ms>,v1=<hex>` where
  `v1 = HMAC-SHA256(secret, "<t>." + rawBody)`. The timestamp is inside the MAC; comparison is
  constant-time; the window is ±5 minutes; the body limit is 64 KB and JSON only. Nothing in
  the body is parsed before the MAC passes. The secret is `WEBHOOK_SECRET_FAKE` (Secret Manager
  `am-v3-webhook-fake` in the cloud), distinct from every other secret.
- **Bad signatures are budgeted per client address** (60 per 10 minutes), like bad logins, and
  like logins a valid signature still lands on a saturated address, so a shared IP cannot lock the
  provider out.
- **Recorded before it acts (3.2-C).** `billingEvents/{provider}:{eventId}` holds every event
  that passed the signature: provider id, type, timestamp, customer, data, a content fingerprint
  and the outcome. The same event again → the stored outcome with `replayed: true`. The same id
  with different content → `409 IDEMPOTENCY_CONFLICT`. Three concurrent deliveries of one event
  against real Firestore apply it exactly once (emulator suite).
- **Ordering (S3.3-C).** `billingCustomers/{provider}:{ref}` keeps `lastEventAt` and
  `lastEventSeq` of the last applied event. An event with an older timestamp, or the same
  timestamp and a lower `seq`, is recorded and **ignored** (`STALE_EVENT`), so a retried old event
  can never roll the facts back. Providers expose timestamps at second resolution, so `seq` is the
  adapter's ordering key *within* a second; two events sharing a timestamp with no `seq` are
  processed in delivery order — a real adapter must supply a total order (see the adapter
  contract below). A signed event dated beyond the signature window is malformed
  (`EVENT_IN_FUTURE`, 400, never recorded), so a provider clock error cannot pin `lastEventAt`
  in the future and make every real event stale.
- **A payment renews the plan on record (S3.3-B).** The invoice's price id says what was paid
  for; it does not authorise a plan change. `payment.succeeded` on a different plan than the
  family's current one needs an intent the server recorded — the parent's scheduled change
  (3.4), a checkout this server opened (a bound `checkout.completed`), or an operator — else it is
  recorded and rejected (`PLAN_CHANGE_NOT_AUTHORIZED`). The first paid plan comes from a checkout
  (`CHECKOUT_REQUIRED` for an invoice that arrives before its checkout event; the provider's
  retry then lands as a renewal). A cancelled or expired family comes back on its own plan by
  invoice, on another plan only through a checkout. A renewal never clears a cancellation the
  parent asked for (`cancelAtPeriodEnd` stays; the paid period is honoured, then it ends); only
  `cancel.undo`, a fresh checkout or an operator clears it.
- **`checkout.completed` means exactly that.** It must carry the id of a checkout this server
  opened, for this family and plan, not yet completed (`CHECKOUT_REQUIRED`, `UNKNOWN_CHECKOUT`,
  `CHECKOUT_MISMATCH`, `CHECKOUT_ALREADY_COMPLETED`). A recurring `invoice.paid` carries none.
- **The family is found only through the customer reference the server minted at checkout.**
  A reference belongs to one family forever. An event whose `data.familyId` or `data.checkoutId`
  names a different family is recorded and rejected (`FAMILY_MISMATCH`, `CHECKOUT_MISMATCH`).
  The browser never supplies a reference. This keeps the no-transfer invariant: a webhook can
  subscribe, renew or end the family that started the checkout and no other, and it never touches
  a child wallet (`NO_TRANSFER.md`).
- **Nothing in the payload names a plan, a seat count, a state or a family.** The plan comes from
  the provider's *price id* through the gateway's server-side table (`price_fake_starter` →
  `starter`); a payment with an unknown price is recorded and rejected (`UNKNOWN_PRICE`); a
  completed checkout must agree with the price it was opened for (`CHECKOUT_MISMATCH`). A payload
  carrying `plan`, `seats` or `state` is malformed (400) and never recorded. `periodEnd` is the
  provider's signed statement of the paid period and is range-checked by the state machine.
  `subscription.updated` is deliberately **not** mapped: a webhook cannot change seat capacity.
  Plan changes are the parent's (`POST /api/billing/plan`, 3.4, `SUBSCRIPTIONS.md` → Lifecycle);
  the provider then bills the prorated difference or renews at the scheduled price.
- **Outcomes are acknowledged.** `applied`, `ignored` (unsupported type, stale), `requires_action`
  (the machine refused for want of a server-side action — the parent's seat choice or plan change, a
  checkout completing — kept on `billingCustomers/{…}.pending` and reprocessed by the server when that
  action happens, S3.4-D) and `rejected`
  (unknown customer, unknown price, mismatch, or the state machine refused — e.g. a renewal on a
  plan smaller than the seated children, `SELECT_CHILDREN_FOR_DOWNGRADE`) all return 200 so the
  provider stops retrying; the inbox row is the operator's audit trail. A **rejected** event applied
  nothing, so a redelivery with the same content is processed again (`attempts` counts them) — that
  is how a renewal refused for want of a seat choice lands once the parent has scheduled the
  downgrade (3.4); an `applied` or `ignored` event is a replay. Only signature failures (401),
  malformed events (400), size (413) and infrastructure errors (500, retry) are not acknowledged.

## Provider events → machine events

| provider event | internal event | data used |
|---|---|---|
| `checkout.completed` | `payment.succeeded` | `price` → plan, `periodEnd`, `checkoutId` (marks the checkout completed) |
| `invoice.paid` | `payment.succeeded` | `price` → plan, `periodEnd` |
| `invoice.payment_failed` | `payment.failed` | — |
| `subscription.deleted` | `terminate` | — |
| `charge.refunded` | `refund` | `amountCents`, `full` (a full refund ends access now) |
| `subscription.updated` (and anything else) | — | recorded, ignored until 3.4 |

The family's own record `families/{f}/billing/{uuid}` is written by the same `commit()` as every
other billing event, with `provider`, `providerRef` and actor `webhook:<provider>`; the uuid is
derived from the provider event id, so the family record and the inbox row always agree.

## Zero-cost operation

```
WEBHOOK_SECRET_FAKE=<hex> node scripts/fake-webhook.mjs http://127.0.0.1:8787 cus_… checkout.completed starter 2026-10-10T00:00:00Z <checkoutId>
```

The parent sees the reference on the billing view after choosing a plan; the operator completes
it with that command. `EVENT_ID=` re-delivers (watch the replay); `EVENT_AT=` sends an old event
(watch it ignored). Non-loopback targets need `CONFIRM_WEBHOOK_TARGET=<origin>`.

Outside the emulator the server refuses to start with the fake provider unless
`FAKE_PAYMENTS_ACK=no-real-money` is set, so a pilot can never be mistaken for a shop.

## Checkout intent (S3.3-A)

```
transaction 1: authorise parent → checkouts/{provider}:{operationId} exists?
               same family + same fingerprint(provider, plan, price) → resume (creating) or replay (pending/completed)
               otherwise IDEMPOTENCY_CONFLICT
               new: mint/reuse cus_… → write intent { status: creating, fingerprint, priceId, … }
provider call: createCheckout({ idempotencyKey: operationId, … })
transaction 2: intent still creating → pending + providerCheckoutRef + result; else the other attempt's result
```

The intent is durable before the provider is contacted. Two simultaneous requests with one
operation id, or a crash between the intent and the provider, both resume the same intent and
hand the provider the same key, so a provider that honours idempotency keys returns the same
hosted session. A `checkout.completed` for an intent still `creating` (the provider did open the
session; the server crashed before recording it) completes it.

## Checkout eligibility and the one live checkout (S3.3/3.4-E)

A family may start a checkout with no subscription, on a trial, or when cancelled, expired or
past due. A paid family in `active` or `grace` is refused (`USE_PLAN_CHANGE`): plan changes go
through `/api/billing/plan`, so the downgrade-at-renewal rule, the proration and the change
intent cannot be bypassed with a fresh checkout. Past-due recovery is explicit policy: pay the
dunning invoice (a renewal on the plan on record) or start a checkout for any plan. One checkout
is live per family and provider (`families/{f}.checkoutIntent`): a newer one supersedes the
older in the same transaction, and the older one's later completion is refused
(`CHECKOUT_SUPERSEDED`) — never two transitions for two paid sessions. Replaying a superseded checkout's
operation id returns it marked `superseded` with no URL: a superseded hosted session is never shown again.
Stage 4: the adapter cancels or expires the provider's session where the provider allows it; where it
cannot, a late payment on it is reconciled and refunded (`SUPPORT.md`).

## What the change intent does and does not give (S3.4-F, honest wording)

The intent gives **idempotency and stale-state detection**, not a distributed transaction: no
database transaction spans Firestore and the provider. A taken-over intent is marked
`superseded` in the takeover transaction, and finalisation requires both that the subscription
version is the one the intent saw *and* that `families/{f}.billingIntent` still names this
operation; a stale finalisation never touches a marker that is not its own. What remains — the
provider charged, then the subscription moved locally, so finalisation is refused as
`SUBSCRIPTION_CHANGED` — is a **reconciliation** problem for Stage 4: the provider's operation
reference is stored on the intent permanently; the adapter fetches the provider's subscription
state; the signed provider state is the final authority; and 3.5's support tooling exposes the
operator path (list stale/superseded intents and `requires_action` events, replay, reconcile).

## Retention (S3.4-G)

`checkouts`, `billingChangeIntents`, `billingEvents`, `billingCustomers` and `families/*/billing`
carry no `expireAt` and are never TTL-collected: they are the idempotency and recovery evidence
for money that may have moved. A provider's own idempotency window is not assumed to last;
without these records a reused operation id could reach the provider again. Terminal records
may one day be archived under a deliberate financial-retention policy, not garbage collection.

## Adapter contract for a real provider (Stage 4)

An adapter implements `createCheckout`, `changePlan` and `verify`. It must:

1. pass the checkout id it is given as the provider's idempotency key, and return the provider's
   session reference and URL;
2. verify the provider's signature over the raw bytes and map the provider's event to the
   normalized shape — `price` is the provider's price id (the adapter's table maps it to a plan),
   `seq` is a total ordering key (the provider's sequence number, or a monotonic key derived from
   its event timestamp and id — if the provider offers only second-resolution timestamps, fetch the
   object's current state rather than trusting event order);
3. never place a plan name, seat count, state or family id in the normalized data.



- `billingEvents/{provider}:{eventId}` — the global inbox; kept forever (financial record).
- `billingCustomers/{provider}:{customerRef}` — reference → family, last applied event.
- `checkouts/{provider}:{checkoutId}` — creating/pending/completed/superseded; kept (see retention).
- `billingChangeIntents/{provider}:{operationId}` — creating/applied/stale/superseded, with the provider's
  operation reference; kept (see retention).
- `families/{f}.checkoutIntent.{provider}` / `families/{f}.billingIntent` — the one live checkout, the one
  in-flight plan change.
- `families/{f}.billing.{provider}` — the family's reference (display only in the browser).

All deny-all to browsers, like everything else.
