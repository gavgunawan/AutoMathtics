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
  can never roll the facts back. A refund or a dispute is exempt: it is money that went back, not a
  snapshot of state, so one created before a renewal and delivered after it still ends access (its own
  id dedupes it), and an older one that applied never moves `lastEventAt` back. An event about another
  subscription of the same customer — the one a fresh checkout replaced, still winding down at the
  provider — is recorded and ignored (`OTHER_SUBSCRIPTION`): every subscription event names its
  subscription (`subscriptionRef`), the family remembers which one it paid for
  (`providerSubscriptionRef`), and a checkout from `past_due` / `cancelled` / `expired` ends the
  provider's previous subscription before a new one can be paid for. Providers expose timestamps at second resolution, so `seq` is the
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
- **Outcomes are acknowledged.** `applied`, `ignored` (unsupported type, stale), `reconciliation_required`
  (a late event for a deleted family: recorded, never revives entitlement, Stage 4 refunds/cancels at the provider), `requires_action`
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
| `subscription.paused` / `subscription.resumed` | `pause.start` / `pause.end` | `resumesAt` (the provider's own date). Stripe's `customer.subscription.updated`, and **only** when its `previous_attributes` say `pause_collection` is what changed; every other update is still recorded and ignored |
| `charge.refunded` | `refund` | `amountCents`, `full` (a full refund ends access now) — the fake provider's one-event-per-refund fixture |
| `refund.created` | `refund` | a real provider's per-refund object: `amountCents`, `full`, `ref` (its id; a second delivery of the same refund is `DUPLICATE_REFUND`) |
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
provider debts: what the intent owes the provider is written ON the intent in transaction 1 —
               endPrevious { required, status: pending | done | not_applicable, result } (a family back from
               past_due / cancelled / expired ends its previous subscription first) and supersededRef (the
               older hosted session to expire) — and settled here, before any session is opened; a fault
               propagates and leaves the debt pending, so a resume (the same operation id) settles it first
provider call: createCheckout({ idempotencyKey: operationId, … })
transaction 2: intent still creating → pending + providerCheckoutRef + result; else the other attempt's result
```

A crash or a provider fault anywhere between transaction 1 and the session therefore never opens a second
subscription over a live one: the resume finds `endPrevious.status: pending` and ends it before asking for
the session (Stage 4 review, fourth round; `tests/round4-payments.test.mjs` covers a crash before the
ending, a provider fault, and a crash after the ending). The adversarial verification of that seam added
the rest of the rules:

- a resume settles the debt only against the family it was recorded for: the intent carries the
  subscription's ref and version, and when the family moved meanwhile (the dunning invoice paid, a plan
  changed, another checkout completed) or is no longer in a checkout state, the intent goes `stale`
  (`STATE_MOVED`) and the click is refused as a fresh start would be (`USE_PLAN_CHANGE` /
  `SUBSCRIPTION_CHANGED`) — a retried click never ends a subscription just paid for;
- an intent from before the debts were recorded is owed whatever the family still shows, never presumed
  settled;
- the adapter ends only the subscription the family's record names (`subscriptionRef`); a different live
  one is answered, never ended: with a checkout of ours pending it is that checkout completing
  (`CHECKOUT_COMPLETING`: the older checkout is reinstated, the new one closed), otherwise a subscription
  the family does not know (`PROVIDER_SUBSCRIPTION_LIVE`);
- a provider that cannot find the subscription never settles the debt (`PROVIDER_SUBSCRIPTION_NOT_FOUND`,
  the debt stays pending for the retry);
- a checkout that owes no ending still inspects a customer this server already knows: two live
  subscriptions (`MULTIPLE_PROVIDER_SUBSCRIPTIONS`) or one (`PROVIDER_SUBSCRIPTION_LIVE`) refuse the session;
- the superseded session is expired before the ending, so a refused ending never leaves it payable; an
  attempt superseded or completed while it stalled records its late session (`lateSessionRef`), expires it
  and answers closed (`url: null`); a completed intent whose finalisation was lost answers closed too;
- every such refusal is deterministic, not a fault: the family is marked (`providerAttention`), an audit row
  `billing.refused` says so, a refused plan change closes its intent and releases the in-flight marker, the
  nightly sweep names the family (`PROVIDER_ATTENTION`) and a clean `reconcile-provider` clears the mark.

Two live subscriptions at the provider — a state the dashboard can make — stop every money-changing call
with `MULTIPLE_PROVIDER_SUBSCRIPTIONS` until an operator has cancelled one (`RECONCILIATION.md`).

The second adversarial pass over the whole seam (fifth round: three finders after the ten verdicts) added
these rules:

- two attempts of one operation reach the provider under one idempotency key and get one session: the
  attempt that finalises second answers that same session and expires nothing (`lateSessionRef` only ever
  names a different session); an intent superseded meanwhile answers that session closed (`url: null`);
- a resume goes stale (`STATE_MOVED`) only on what the record has seen — a state a checkout no longer starts
  from, or another subscription named — never on a version bump alone: the provider's own notice of the very
  ending the intent owed is not a move, and a payment the record has not seen is the provider's to refuse;
- a subscription the provider holds as paid and current (`active` or `trialing`, not winding down) is never
  ended for a new checkout while the family's record says past due or expired — the record is behind, its
  `invoice.paid` still on its way: the click is refused `PROVIDER_SUBSCRIPTION_PAID`, the family marked, and
  once the payment has landed the retried click is refused as a fresh start would be (`USE_PLAN_CHANGE`). A
  record this server itself ended (a full refund, a dispute, an operator's terminate: `endedAt`) is ahead of
  the provider, not behind it, and the returning checkout ends what still bills — ended and still so: a paid
  subscription clears the ending (`endedAt`), so a record refunded long ago and paid again never skips the
  provider's truth; the adapter reads the subscription once more by its id right before the ending and records
  what it saw (`status`, `periodEnd`, `cancelAtPeriodEnd`);
- every provider call resolves the family's customer by the Stripe id this server recorded when its checkout
  completed (`providerCustomer`), and by the `customerRef` metadata search only for a customer it never
  recorded: a dashboard edit of the metadata, or a search index that lags, cannot make one family's change
  land on another's subscription — and a plan change or a cancellation acts only on the subscription the
  record names (`providerSubscriptionRef`), any other live one refused `PROVIDER_SUBSCRIPTION_LIVE`;
- a customer deleted in the dashboard settles the ending debt (`CUSTOMER_DELETED`: Stripe ended its
  subscriptions with it), so the family can come back — and the session that follows is opened on a fresh
  customer, never on a second one minted because the search lagged (the session's customer is resolved by
  the recorded id too); a named subscription absent from the customer's list is asked for by its own id
  (ended: settled; never held: settles nothing) and is never substituted by another of the customer's;
  `paused` and `incomplete` can bill again and are ended, never taken for ended;
- a live subscription that is not the one the record names is a checkout of ours completing only when the
  provider says so — the subscription carries the checkout's id (`checkoutId`, stamped when the session was
  made) and that checkout of this family held a session and is not complete, whichever click superseded it:
  then it is reinstated as the family's live checkout, this attempt closed (`CHECKOUT_COMPLETING`), and a
  completion of it the inbox rejected while it was superseded is queued under every reference of the family
  and processed again — when that completion applies right there, the family is paid and the click is
  answered as a paid family's (`USE_PLAN_CHANGE`), unmarked. This holds on both paths — a returning family's
  ending and a first checkout's guard (a first checkout paid and clicked again before its completion landed
  was left superseded with its payment refused). A subscription naming no checkout of ours, or a checkout that
  never reached the provider, is the operator's (`PROVIDER_SUBSCRIPTION_LIVE`); a family being deleted
  reinstates nothing, and the rejected completion becomes the operator's (`reconciliation_required`);
- a refund or a dispute names the subscription its charge paid for (through the invoice): a full refund of
  the previous subscription's last charge — goodwill for the unused dunning month — is recorded
  `OTHER_SUBSCRIPTION` and leaves the new, paid subscription alone. Delivered before the completion it belongs
  to, a refund of a subscription the record does not name — a record that names none (a first checkout, a
  trial) included — waits on the customer mapping while the family's live checkout can still complete (a
  hosted session lives a day: `requires_action: CHECKOUT_PENDING`) and is processed again right after the
  completion, under every reference the family ever carried (a customer replaced after a deletion too) and
  in passes, so a refund delivered the same second as the completion applies after it — never access on a
  refunded charge; past the day it is the old subscription's (`OTHER_SUBSCRIPTION`), and the operator's
  `resolve-event` closes a waiting row and takes it off the customer's list; and a refund never moves the
  customer's clock, so a completion still on its way is never stale behind it;
- a session is paid only when Stripe says so: `checkout.session.completed` with `payment_status: unpaid` (a
  bank debit still clearing) or no status at all grants nothing, but is remembered on the checkout
  (`paymentPending`: the subscription it made) — on a checkout superseded meanwhile too, so the mark travels
  with a reinstatement — a later click never supersedes it (`CHECKOUT_COMPLETING`, before any provider
  call), `checkout.session.async_payment_succeeded` completes it (the mark then names its completion), a
  failed debit (`checkout.session.async_payment_failed`) releases it (`paymentFailed`) so the next click
  starts afresh, and a deletion meanwhile ends the subscription it made (`endedByDeletion`);
  `no_payment_required` (a coupon, a trial) is complete;
- a held upgrade answers the same to every attempt of its operation, and the provider's answer to a plan
  change is on the intent (`providerAnsweredAt`, `providerOperationRef`, `proration`) before the finalisation
  can fail — whatever the intent's status meanwhile (the deletion freeze, a takeover): money the provider
  moved is never without a record, it is recorded once, and the recorded answer is the one the finalisation
  applies (a provider's replay of the same operation may name another invoice);
- a family's deletion expires every hosted session of the family's still payable — the one its freeze
  superseded, the ones earlier clicks superseded whose best-effort expiry may have faulted, a session that
  arrived late — reading the family's checkouts in pages, never the first hundred (`expiredByDeletion` on each
  checkout; a provider fault is recorded, never fatal, asked again by a rerun and each night by the sweep,
  which names the family until it is settled; a session no longer open is the settled state, never downgraded
  by a rerun; a provider the running server does not configure is recorded, never skipped); a session paid
  after it was superseded is a subscription made (`SESSION_COMPLETED`), ended at deletion like a clearing one
  and standing as the deletion's provider cancellation when the record had none to end; and a payment that
  still lands on any of them is `reconciliation_required` (`FAMILY_DELETED`) for the operator, never a
  rejection nobody reads;
- a refusal's audit row (`billing.refused`) carries its `code`.

The intent is durable before the provider is contacted. Two simultaneous requests with one
operation id, or a crash between the intent and the provider, both resume the same intent and
hand the provider the same key, so a provider that honours idempotency keys returns the same
hosted session. A `checkout.completed` for an intent still `creating` (the provider did open the
session; the server crashed before recording it) completes it.

## Paused (the leaving flow, 12 Sep 2026)

A parent who is thinking of leaving may pause instead (`SUBSCRIPTIONS.md` → the flow). `POST /api/billing/pause
{ months: 1|2|3, operationId }` and `POST /api/billing/resume { operationId }`, parent session, fresh sign-in.

- **The provider hears it first**, as a cancellation does: `pauseCollection({ idempotencyKey, customerRef, customerId,
  subscriptionRef, resumesAt })` with Stripe's `pause_collection`, **behaviour `void`** — no invoice is raised at all while the
  pause lasts, so a paused month can never be collected later and a pause can never charge twice. `resumeCollection` unsets it.
  The machine must accept the transition before the provider is asked; a replayed operation tells the provider nothing; a
  provider failure changes nothing locally. A crash between the two leaves the provider paused and the record not: the parent's
  retry under the same operation id reaches the provider under the same idempotency key and finishes it, and so does the
  provider's own echo.
- **The fact, and the state.** `subscription.pause = { months, pausedAt, resumesAt, by: 'parent' | 'provider', echoed }`.
  `deriveState` honours the period already paid for — the family is `active` until `periodEnd`, pause or no pause — and is
  `paused` from then on: **inactive**, with no grace and no dunning, so no churn count can mistake it for a family that left and
  no unpaid month becomes access. `entitlementFor` carries the pause so Mission Control can say when collection starts again.
  It is `active` again when an invoice is paid: `payment.succeeded` clears the pause, whenever it arrives.
- **Only from `active`**, on a paid plan, with no cancellation already asked for (`CANCEL_SCHEDULED`): a pause must never grant an
  unpaid month, and must never quietly undo a cancellation. A trial has no collection to pause.
- **The provider is the authority.** Its echo (`by: 'provider'`) sets or clears the fact whatever this record thought, and its
  `resumesAt` wins; it may arrive for a family this record has not paused (a dashboard pause), and it is what reconciles a pause
  whose commit was lost. An echo older than the last applied event is `STALE_EVENT` and rolls nothing back; `pause.end` is
  idempotent, so the provider's echo of a resume this server already made is applied and changes nothing.
- **Cancelling a paused subscription ends it now**, here and at the provider (`cancelSubscription`, not the period-end flag):
  there is no period left to end, nothing is being collected, and ending it takes no access away.
- **Reconciliation.** `describe` reports `paused`, `pauseBehavior` and `pauseResumesAt`; `reconcile-provider` compares them both
  ways (`PAUSE_MISMATCH`, `PAUSE_RESUME_MISMATCH`, `PAUSE_BEHAVIOUR` for a pause that is not `void`), and the nightly sweep counts
  paused families and names a pause the provider never echoed (`PAUSE_NOT_ECHOED`) or one whose resume date passed a week ago with
  no invoice since (`PAUSE_OVERDUE`).
- A pause changes no plan and no seat, and no webhook can: `subscription.paused` / `subscription.resumed` carry nothing else.

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

## Stripe (Stage 4.1)

`server/gateways/stripe.mjs` implements the contract below against Stripe, selected with
`PAYMENT_PROVIDER=stripe` and `STRIPE_SECRET_KEY`, `WEBHOOK_SECRET_STRIPE`, `STRIPE_PRICE_STARTER/FAMILY/BIG`
(`config.mjs`: test keys everywhere but production, live keys only there). **Test mode costs nothing** —
that is how 4.2 is exercised: `stripe listen --forward-to 127.0.0.1:8787/api/webhooks/stripe` gives the
`whsec_` and forwards real test-mode events to the local server.

- **Customer**: one Stripe Customer per family, found by our reference in its metadata or created with
  `customer:<ref>` as the idempotency key. Stripe assigns its own id, so `Payments.checkout` records it
  as an alias mapping (`billingCustomers/stripe:cus_…` → the same family, and only that family) and on
  `families/{f}.providerCustomer.stripe`; webhooks resolve by the Stripe id.
- **Checkout**: a hosted Checkout Session in subscription mode with the checkout id as
  `client_reference_id`, in the metadata, and as the idempotency key; the browser follows `url`. A
  superseded session is **expired at Stripe** (`cancelCheckout`) so a stale hosted page cannot be paid.
- **Plan change**: the customer's active subscription moves to the new price with
  `proration_behavior=always_invoice` **and `payment_behavior=pending_if_incomplete`** under the operation id.
  Stripe applies the new price only once the proration invoice is paid: a card charged on the spot answers
  `applied` and `plan.change` commits at once; a failed charge or a card that needs authentication answers
  `pending` — the intent becomes `awaiting_payment`, the plan and the seats stay as they are, the in-flight
  marker stays (a second change is `PAYMENT_PENDING` for 24 hours), the parent gets the hosted invoice to
  finish — and the upgrade is granted **by the `invoice.paid` of that invoice**: the intent records the
  invoice reference the provider answered with (`proration.invoiceRef`), and only that invoice's payment
  completes it — another paid invoice for the customer is what it is (a renewal) and never satisfies the
  intent. The completion is the upgrade's own `plan.change` transition, as when the card was charged on the
  spot: a cancellation at the period end the parent asked for meanwhile stands, the period is not renewed by
  it, and a subscription that has since ended is not revived (`INVALID_TRANSITION`, left for the operator);
  a paid invoice whose subscription sits on a price other than the intent's target is `UPGRADE_PLAN_MISMATCH`
  (`process()` finds the intent by invoice reference, applies it with its seat choice, marks it `applied`,
  releases the marker). A held update never paid lapses after a day and may be superseded.
- **Webhooks**: `Stripe-Signature` (t, v1…) verified over the raw bytes, five-minute window, before a byte is
  parsed. `checkout.session.completed` is resolved against the **subscription Stripe holds** (price id,
  period end and subscription id fetched, never our metadata). An invoice's facts are **the invoice's own
  lines** — what was paid, for which period, for which subscription — never the subscription as Stripe holds
  it at delivery time, so a retry after the price moved says what the first delivery said; a proration
  invoice lists the old price (negative, unused time) and the new one (positive, remaining time) on separate
  lines, and the best line answers: positive amount, latest period. The inbox fingerprint is the **event's own
  identity** (id, type, time, object), never the enrichment of the moment: a redelivery after the family
  changed plan is a replay, not a conflict. `customer.subscription.deleted` → `subscription.deleted`, for
  the family's subscription only. **Refunds come from `refund.created` / `refund.updated`**, the per-refund object:
  its own id (`ref`, kept on the inbox row as `refundRef`) and amount; the charge is fetched for the customer and
  for whether it is now refunded in full; a refund not yet `succeeded` is recorded and ignored, and the same
  refund delivered under a second event id is `DUPLICATE_REFUND`. `charge.refunded` — the charge's running
  total — is recorded and ignored, never a refund event (two partial refunds of 200 and 300 are two records of
  200 and 300, not 200 and 500). A refund counts from the moment it exists (pending or succeeded: access ends as
  soon as a refund is approved); one that later fails is `refund.failed`, recorded for the operator. A card dispute
  (`charge.dispute.created`) is a full refund for the family — access ends the moment it is opened; `closed` won or
  `funds_reinstated` is `dispute.won`, recorded for the operator to restore access by hand. Stripe has no sequence number and second-resolution timestamps, so `seq` is
  null and events dated in the future are refused.
- **Provider effects (4.2)**: cancel-at-period-end and its undo update the live subscription's flag under the
  operation id; a scheduled downgrade moves it to the target price with `proration_behavior=none` (the next
  invoice carries it); a family's deletion deletes the subscription (`DELETE /v1/subscriptions/{id}`, already
  ended = nothing to do); `inspect` reads the customer and its live-or-latest subscription. None of these
  creates a customer: a family without one at Stripe gets `NO_PROVIDER_SUBSCRIPTION`.
- **Errors**: Stripe's error code and status only (`PROVIDER_ERROR`, `PROVIDER_UNREACHABLE`); the key never
  appears in a message or a record.

## Adapter contract for a real provider (Stage 4)

An adapter implements `createCheckout`, `changePlan` and `verify`. `changePlan` answers `applied` or `pending`:
a pending change is one the provider holds until its payment lands; the answer names that invoice (`invoiceRef`),
and only that invoice's `invoice.paid` (its `data.ref`) grants it (`billingChangeIntents` status `awaiting_payment`). It must:

1. pass the checkout id it is given as the provider's idempotency key, and return the provider's
   session reference and URL;
2. verify the provider's signature over the raw bytes and map the provider's event to the
   normalized shape — `price` is the provider's price id (the adapter's table maps it to a plan),
   `seq` is a total ordering key (the provider's sequence number, or a monotonic key derived from
   its event timestamp and id — if the provider offers only second-resolution timestamps, fetch the
   object's current state rather than trusting event order);
3. never place a plan name, seat count, state or family id in the normalized data.

A real provider must also carry the family's decisions and answer for its state (Stage 4.2; the
fake provider simulates all four, records the calls and holds no state):

4. `setCancelAtPeriodEnd({ idempotencyKey, customerRef, cancel })` — the parent's cancel-at-period-end
   and its undo reach the provider **before** the machine records them, keyed by the operation id,
   so the provider's next invoice agrees with the family's record; a replayed operation tells the
   provider nothing; a provider fault changes nothing locally (`Payments.cancel`);
5. `schedulePlan({ idempotencyKey, customerRef, to })` — a scheduled downgrade (and the clearing of
   one) moves the provider's subscription to the target price **without proration**, so the next
   invoice carries it — otherwise a renewal on the old price would silently drop the schedule; it
   runs through the same durable change intent, in-flight marker and version re-check as an upgrade;
6. `cancelSubscription({ idempotencyKey, customerRef })` — a family's deletion ends the provider's
   subscription now, before `terminate` is recorded; the outcome sits on
   `deletions/{f}.providerCancellation`, and a fault there is a report finding, never a stopped deletion;
7. `inspect(customerRef)` — the provider's customer and subscription (status, price, period end,
   cancel flag, and whether collection is paused and until when) for `scripts/support.mjs reconcile-provider`
   (RECONCILIATION.md). Read-only;
8. `pauseCollection({ idempotencyKey, customerRef, resumesAt })` and `resumeCollection({ idempotencyKey, customerRef })` — the
   parent's pause and its end reach the provider **before** the machine records them, keyed by the operation id, and the pause
   must raise no invoice at all while it lasts (Stripe: `pause_collection` with behaviour `void`), never one collected later.
   The adapter must also map the provider's own notice of a pause set or cleared to `subscription.paused` / `subscription.resumed`
   with the provider's `resumesAt`, and to nothing else: that echo is the authority on the paused state (see **Paused** above).



- `billingEvents/{provider}:{eventId}` — the global inbox; kept forever (financial record).
- `billingCustomers/{provider}:{customerRef}` — reference → family, last applied event.
- `checkouts/{provider}:{checkoutId}` — creating/pending/completed/superseded; kept (see retention).
- `billingChangeIntents/{provider}:{operationId}` — creating/applied/stale/superseded, with the provider's
  operation reference; kept (see retention).
- `families/{f}.checkoutIntent.{provider}` / `families/{f}.billingIntent` — the one live checkout, the one
  in-flight plan change.
- `families/{f}.billing.{provider}` — the family's reference (display only in the browser).
- `families/{f}/leaving/{operationId}` — why a family cancelled or paused, and what was offered (the leaving flow); it holds no
  money and no provider reference, and expires by TTL after 400 days (`PRIVACY.md`).

All deny-all to browsers, like everything else.

## Prices, the yearly plan and the leaving offers (13 Sep 2026)

`server/pricing.mjs` is the one place prices and reductions are computed: the public pages quote it, and the payment adapter
(Xendit, next) must charge by it. Whole rupiah in integer arithmetic; a reduction that does not come out whole is refused, never
rounded.

| Children | Monthly | Yearly (12 × monthly less 20%) | Monthly under the leaving 10% |
|---|---|---|---|
| 1 | 199,000 | 1,910,400 | 179,100 |
| 2 | 379,000 | 3,638,400 | 341,100 |
| 3 | 519,000 | 4,982,400 | 467,100 |
| 4 | 599,000 | 5,750,400 | 539,100 |

Five or more children are priced by hand: the Pricing page sends them to support, and no leaving offer is made to them.

**A charge, as the adapter records it**: `{ periodStart, periodEnd, cycle, amount, list, applied, offer, proration, refunded }` —
times in milliseconds, `cycle` `monthly` or `annual`, `applied` and `offer` exactly as `chargeFor` answered (`applied` the one
reduction the charge carried: `retention_monthly` on a monthly charge, `annual` on an annual one, otherwise null; `offer` the
leaving offer it was made under, otherwise null), `proration` true on a proration and never on a period's own charge, `refunded`
true once any of it is refunded. One record per provider charge, and the period is the **scheduled** billing period, not the day
it happened to be paid. For a month to count as paid, `isCharge` requires: not a proration; a period of 27–32 days (an annual
charge, 27–367 days, so a prorated one still reads as annual); times after 2020 (not seconds, not strings); a whole amount and
list above nothing; a monthly list price in `KNOWN_MONTHLY_LISTS` — written out, so a price change keeps the old price counting;
add the new price there as well; and no refund in any form (a `refunded` or `refundedAt` that says yes, an amount refunded under
`refundedAmount`, `amountRefunded` or `refunded_amount`, a non-empty `refunds`, or a `status` mentioning a refund in any case — a
partial refund included, which is a decision still open; `refunded: 'false'` or `refundedAt: 0` is no refund). `chargesOf` keeps
one record per period, the more cautious copy if copies disagree — so a proration left unflagged and recorded with its month's
period reads as that month charged below its list, and costs the family its offer while that month is one of its latest two.

**The leaving offers.** A family asking to cancel at `now` is eligible (`retentionEligibility`) when: its stored offer record is
null — the key must be passed, and any record of any shape means the offer is spent — and none of its charges was ever made
under either offer; no annual charge of its is running or already paid to start; a monthly charge covers `now`; its two latest monthly charges
were both in full (not below the list price) and in a row (the later started between three days before and seven days — the
grace period — after the earlier ended); and, for the prices (`retentionOffers`), it has one to four children. A family in its
grace period after a failed renewal is not offered anything until that renewal is paid. It is offered one of: 10% off the next
three monthly charges, or the yearly plan at the ordinary yearly price. `acceptRetention` works the offers out again from the
facts it is given — never from an eligibility handed to it — and returns the record to store on the family: `{ kind, acceptedAt }`.

They never stack:

- a charge carries at most one reduction — `chargeFor` names it in `applied`;
- a yearly charge is the yearly price whatever offer record the family holds, and the yearly offer is the ordinary yearly 20%,
  never 20% off the yearly price;
- a family takes one offer, once — read twice over: from the stored record, and from every charge made under either offer (its
  `offer`, or an `applied` of `retention_monthly`), so a lost or re-saved record does not reopen it. `chargeFor` refuses
  `RETENTION_REQUIRED` when the record is not passed, so no charge made under the yearly offer can miss its mark;
- the 10% is never a stored counter. Whenever an offer record exists, `chargeFor` needs the charges and the period
  (`PAID_REQUIRED` / `PERIOD_REQUIRED`), and charges reaching back to the month the offer was taken in (`PAID_INCOMPLETE`). It
  reduces the three charges after that month, found by walking the recorded monthly periods from it one at a time — each starting
  between three days before and seven days after the last ended — so a history cut short or missing a month stops the 10% at the
  gap instead of stretching it. A break in the subscription ends it the same way: a family who cancels during the three months and
  comes back pays full price. It also stops, counted loosely on the side that cannot stack, once three other charges claim the 10%
  — refunded, badly shaped or from any date — or were monthly charges below their list after the offer was taken (prorations
  aside), one per period; and nothing is reduced after the four months that follow the offer;
- a forged or malformed offer record reduces nothing.

**What the Xendit adapter must do.** Read all the family's charges (at the least, everything from the month an offer was taken
in) and its offer record in the transaction that decides; charge `chargeFor({ children, cycle, retention, paid, at })` with
`retention` always passed — null when there is none — and `at` the start of the period being charged; record each successful
charge in the shape above, with the `applied` and `offer` that `chargeFor` answered, and `proration: true` on a proration; mark
any refund on the charge it refunds; in `LeavingFlow.offers` show `retentionOffers({ paid, retention, now, children })`; accept
with `acceptRetention` and store its record on the family in the same transaction; move a family that took the yearly offer to
the yearly cycle at its next renewal. The offer's own words say the 10% is for the next three monthly payments in a row, and
ends if the subscription stops.

`tests/pricing.test.mjs` checks this five ways: the figures by hand; the rules recomputed independently, and the offers field by
field; every eligibility rule alone and at its boundaries (in a row, a month's length, an annual's, refunds and prorations); the
no-stacking rules against each way three adversarial reviews broke earlier versions — every part of a history left out among
them; and a simulation of every family of one to four children through two years of charges, cancel attempts and answers.

The seat plans in `server/subscription.mjs` (`starter`, `family`, `big`, with the Stripe sandbox price ids) predate these prices
and are replaced when the adapter lands.
