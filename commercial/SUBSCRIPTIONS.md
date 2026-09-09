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

Prices are placeholders until 3.3/Stage 4 attach the real provider. Seats are enforced now: fewer
seats than active children requires a keep list (`SELECT_CHILDREN_FOR_DOWNGRADE`); the others become
inactive and cannot enter.

## Events

`Subscriptions.apply(familyId, { id, type, plan?, periodEnd?, keepChildIds?, provider?, providerRef? }, actor)`.
Recorded under `families/{f}/billing/{eventId}` before acting; a replayed id returns the stored result.
Operator CLI: `scripts/subscription.mjs`. Verified webhooks arrive in 3.3 and call the same `apply()`.

Parent actions (routes, recent authentication required): `POST /api/billing/trial` — the server decides
from the verified phone: no subscription yet, a phone on record, and `phones/{phoneKey}.trialFamilyId`
unset; it is set on success, so a second family under the same phone (new email) gets no trial.
`POST /api/billing/cancel { undo }` — cancel at period end or reverse it; access is never cut short.
`GET /api/billing` — plans, the derived subscription, trial eligibility.

Nothing else is browser-initiated. Plan changes and payments come only through events.

## Rules carried into 3.3–3.5

- Payment events never touch a child wallet; if a promotion ever grants coins it posts ledger rows.
- Webhooks: verify signature, idempotent by provider event id, record before acting (the `billing/`
  collection already gives the shape).
- Trial abuse: one per `phoneKey`; farming costs a new SIM per trial and the child restarts at paper 1.
