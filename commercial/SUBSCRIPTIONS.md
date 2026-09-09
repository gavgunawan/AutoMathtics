# Subscriptions and entitlement (Stage 3.2)

`server/subscription.mjs`. A family's `subscription` record holds **facts** that only events set;
the **state** is derived from those facts and the clock, so there is no scheduler and every check
agrees with "now". `Foundation.entitlement()` reads the derived entitlement, which is how every
child and parent route inherits it without change. A subscription wins over a manual pilot grant;
once a family has one, `grant.mjs` refuses (`SUBSCRIPTION_MANAGED`).

## States and how they are reached

```
none ──trial.start (parent, one per verified phone)──▶ trial ──payment.succeeded──▶ active
trial ──7 days, no payment──▶ expired            trial ──cancel.request──▶ cancelled at trial end
active ──period end──▶ grace (7 days, access continues) ──▶ past_due (30 days, access paused) ──▶ expired
active/grace/past_due ──payment.succeeded──▶ active (new period; failures cleared)
active/grace ──cancel.request──▶ cancelled at period end (cancel.undo reverses while the period runs)
any ──terminate (operator)──▶ cancelled now       cancelled/expired ──payment.succeeded──▶ active
active/grace/past_due ──payment.failed──▶ (fact only: failedAt, failures; time decides the rest)
```

Access (`entitlement.status === 'active'`) holds in `trial`, `active` and `grace`. `accessUntil` is the
trial end, the period end, or the end of grace.

## Plans

| id | seats | price | note |
|---|---|---|---|
| trial | 2 | 0 | 7 days; parent-started; not purchasable |
| starter | 2 | placeholder | |
| family | 4 | placeholder | |
| big | 6 | placeholder | |

Prices are placeholders until 3.3/Stage 4 attach the real provider.

## Seats: capacity versus occupancy

A plan gives **capacity** (`seats`). **Occupancy** is `family.activeChildIds`, and every child
document's `status` agrees with it. An event may carry `seatChildIds` — the children who occupy the
seats for the cycle: children left off go inactive (progress kept), children on it come back. Without
it the current occupants stay if they fit; if they don't, the event is refused
(`SELECT_CHILDREN_FOR_DOWNGRADE`). So a downgrade A/B/C → A/B and a later upgrade with A/B/C brings C
back with everything intact (audit finding 3.2-A).

Between events a parent may **add** a child to a free seat (`POST /api/billing/seats { childIds }`),
never remove one (`SEATS_CANNOT_REMOVE`): the set of children served in a paid cycle can grow to the
capacity but cannot be rotated, which closes "four kids on a one-seat plan, one at a time".

## Events

`Subscriptions.apply(familyId, { id, type, plan?, periodEnd?, seatChildIds?, provider?, providerRef? }, actor)`.
Recorded under `families/{f}/billing/{eventId}` with a fingerprint of its content before acting: the
same id with the same content returns the stored result; the same id with different content is
`IDEMPOTENCY_CONFLICT` (3.2-B). Parent actions accept a browser `operationId` for the same reason, so
a retried click after a lost response is the same event. Provider webhooks (3.3, `PAYMENTS.md`) are
recorded first in the global inbox `billingEvents/{provider}:{eventId}` and then reach the same
`commit()` under a uuid derived from the provider event id (3.2-C).
Operator CLI: `scripts/subscription.mjs`; signed fake webhooks: `scripts/fake-webhook.mjs`.

Parent actions (routes, recent authentication required): `POST /api/billing/trial` — the server decides
from the verified phone: no subscription yet, a phone on record, and `phones/{phoneKey}.trialFamilyId`
unset; it is set on success, so a second family under the same phone (new email) gets no trial.
`POST /api/billing/cancel { undo }` — cancel at period end or reverse it; access is never cut short.
`GET /api/billing` — plans, the derived subscription, trial eligibility, the family's payment reference.
`POST /api/billing/checkout { plan, operationId }` — start a checkout (3.3); the plan is applied only when
the provider's signed event arrives.

Nothing else is browser-initiated. Plan changes and payments come only through events: operator CLI or
signed webhooks.

## Rules carried into 3.3–3.5

- Payment events never touch a child wallet; if a promotion ever grants coins it posts ledger rows.
- Webhooks: verify signature, idempotent by provider event id, record before acting (the `billing/`
  collection already gives the shape).
- Trial abuse: one per `phoneKey`; farming costs a new SIM per trial and the child restarts at paper 1.
