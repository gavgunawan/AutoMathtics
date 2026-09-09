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
- **Ordering.** `billingCustomers/{provider}:{ref}.lastEventAt` is the timestamp of the last
  applied event; an older event that arrives later is recorded and **ignored** (`STALE_EVENT`),
  so a retried old event can never roll the facts back.
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
- **Outcomes are acknowledged.** `applied`, `ignored` (unsupported type, stale) and `rejected`
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

## Collections added

- `billingEvents/{provider}:{eventId}` — the global inbox; kept forever (financial record).
- `billingCustomers/{provider}:{customerRef}` — reference → family, last applied event.
- `checkouts/{provider}:{checkoutId}` — pending/completed, `expireAt` 30 days (TTL group `checkouts`).
- `families/{f}.billing.{provider}` — the family's reference (display only in the browser).

All deny-all to browsers, like everything else.
