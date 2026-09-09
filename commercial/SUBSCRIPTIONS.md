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
`IDEMPOTENCY_CONFLICT` (3.2-B). Every browser billing mutation (trial, cancel, seats, checkout) **must**
carry a uuid `operationId` (`OPERATION_ID_REQUIRED` otherwise), so a retried click after a lost response
is the same event and the guarantee cannot be lost by forgetting it. Provider webhooks (3.3, `PAYMENTS.md`) are
recorded first in the global inbox `billingEvents/{provider}:{eventId}` and then reach the same
`commit()` under a uuid derived from the provider event id (3.2-C).
Operator CLI: `scripts/subscription.mjs`; signed fake webhooks: `scripts/fake-webhook.mjs`.

## Lifecycle (Stage 3.4): upgrade, downgrade, cancel, refund

`POST /api/billing/plan { plan, seatChildIds?, operationId }` (parent, recent auth, paid subscription in
`active` or `grace`; a trial becomes paid through a checkout, `CHECKOUT_REQUIRED`):

- **Upgrade** (more seats): capacity grows at once (`plan.change`); the gateway is asked for the
  prorated difference for the unused share of the period (`proration` on the event record; the fake
  gateway computes it and charges nothing). Newly freed seats can be given with `seatChildIds` or later
  with `/api/billing/seats`.
- **Downgrade** (fewer seats): **scheduled for the period end** (`plan.schedule`, visible as
  `entitlement.scheduled`). If more children are seated than the new plan holds, the parent chooses who
  keeps a seat now (`seatChildIds`, else `SELECT_CHILDREN_FOR_DOWNGRADE`); nobody loses a seat before the
  renewal (3.2-A holds). The renewal payment on the scheduled plan applies it — the provider never sends
  seat ids; the choice is the server's. This is also how a renewal the machine refused in 3.3
  (`rejected: SELECT_CHILDREN_FOR_DOWNGRADE`) resolves: once the choice is recorded, the provider's
  redelivery of the same event is processed and applied (a rejected inbox event is re-processable; an
  applied one is a replay).
- **The invoice never changes the plan on its own (S3.3-B).** A renewal at the current price is a
  renewal; a payment at another price needs one of the intents above (the scheduled change, a checkout
  for that plan, an operator) or it is recorded and rejected (`PLAN_CHANGE_NOT_AUTHORIZED`). So the
  lifecycle cannot be bypassed through the payment-success path.
- A renewal never undoes a cancellation the parent asked for: `cancelAtPeriodEnd` survives it, the
  paid period is honoured, then access ends; the operator refunds. `cancel.undo`, a fresh checkout or an
  operator event clears it.
- Asking for the current plan clears a pending schedule. `plan.change` and `terminate` clear it too.
- **Cancel** is unchanged: at period end, undoable, access never cut short.
- **Refund** is never a parent action. The operator (`scripts/subscription.mjs … refund AMOUNT_CENTS [full]`)
  or the provider (`charge.refunded`) records it on the subscription (`refunds[]`). A **full** refund ends
  access now (state `cancelled`); a partial one is a record only. A refund never touches a child wallet.

Parent actions (routes, recent authentication required): `POST /api/billing/trial` — the server decides
from the verified phone: no subscription yet, a phone on record, and `phones/{phoneKey}.trialFamilyId`
unset; it is set on success, so a second family under the same phone (new email) gets no trial. Pilot
policy: a family on an **active manual grant** is not offered the trial (`MANUAL_GRANT_ACTIVE`) — starting
one would move the family under subscription management for good, which only the operator decides.
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
