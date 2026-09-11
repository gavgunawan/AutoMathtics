// Stage 3.2 — the subscription and entitlement state machine.
//
// A family's `subscription` holds only facts that events set: plan, seats, trial end, period end,
// cancel-at-period-end, first payment failure. The effective state — trial, active, grace,
// past_due, cancelled, expired — is derived from those facts and the clock, so no scheduler is
// needed and every check is consistent with "now". Foundation.entitlement() reads the derived
// entitlement, which is how every child and parent route inherits it without change.
//
// Events reach the machine through Subscriptions.apply() (operator CLI now, verified webhooks in
// 3.3) or the parent actions (start a trial, cancel at period end, give a free seat to a child).
// Every event is recorded under families/{f}/billing/{eventId} with a fingerprint of its content
// before it acts: the same id with the same content is a replay and returns the stored result;
// the same id with different content is IDEMPOTENCY_CONFLICT.
//
// Seats: a plan gives capacity; `seatChildIds` on an event says which existing children occupy
// it for the cycle, so a downgrade deactivates and a later upgrade can reactivate a child with
// all their progress intact. A parent may only *add* a child to a free seat between events —
// never swap children within a paid cycle.
import { fail, object, uuid, sha256 } from './security.mjs';

const DAY = 86_400_000;
export const TRIAL_DAYS = 7, GRACE_DAYS = 7, DUNNING_DAYS = 30, MAX_SEATS = 20;
// Prices are placeholders until Stage 3.3/4 attach the real provider; seats are the product truth.
export const PLANS = Object.freeze({
  trial: { id: 'trial', name: '7-day free trial', seats: 2, priceCents: 0, purchasable: false },
  starter: { id: 'starter', name: 'Starter', seats: 2, priceCents: 500, purchasable: true },
  family: { id: 'family', name: 'Family', seats: 4, priceCents: 900, purchasable: true },
  big: { id: 'big', name: 'Big family', seats: 6, priceCents: 1400, purchasable: true },
});
export const STATES = Object.freeze(['none', 'trial', 'active', 'grace', 'past_due', 'cancelled', 'expired']);
export const EVENTS = Object.freeze(['trial.start', 'payment.succeeded', 'payment.failed', 'plan.change', 'plan.schedule', 'cancel.request', 'cancel.undo', 'terminate', 'seats.assign', 'refund']);
const ACCESS = new Set(['trial', 'active', 'grace']);
export const publicPlan = (p) => ({ id: p.id, name: p.name, seats: p.seats, priceCents: p.priceCents, purchasable: p.purchasable });

/** The state a subscription is in at `now`, from its facts alone. */
export function deriveState(sub, now) {
  if (!sub) return 'none';
  if (sub.state === 'cancelled' || sub.state === 'expired') return sub.state;
  if (sub.state === 'trial') return now < sub.trialEndsAt ? 'trial' : (sub.cancelAtPeriodEnd ? 'cancelled' : 'expired');
  if (sub.state === 'active') {
    if (now < sub.periodEnd) return 'active';
    if (sub.cancelAtPeriodEnd) return 'cancelled';
    if (now < sub.periodEnd + GRACE_DAYS * DAY) return 'grace';
    return now < sub.periodEnd + (GRACE_DAYS + DUNNING_DAYS) * DAY ? 'past_due' : 'expired';
  }
  return 'expired';
}
/** When access ends if nothing else happens: trial end, period end, or the end of grace. */
export function accessUntil(sub, now) {
  const state = deriveState(sub, now);
  if (state === 'trial') return sub.trialEndsAt;
  if (state === 'active') return sub.periodEnd;
  if (state === 'grace') return sub.periodEnd + GRACE_DAYS * DAY;
  return 0;
}
/** The entitlement shape Foundation.entitlement() and the parent UI read. */
export function entitlementFor(sub, now) {
  const state = deriveState(sub, now), until = accessUntil(sub, now);
  return { status: ACCESS.has(state) && until > now ? 'active' : 'inactive', seatLimit: sub.seats, accessUntil: until, version: sub.version, source: 'subscription',
    state, plan: sub.plan, planName: PLANS[sub.plan]?.name || sub.plan, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd, periodEnd: sub.periodEnd || null, trialEndsAt: sub.trialEndsAt || null,
    graceUntil: sub.state === 'active' && sub.periodEnd ? sub.periodEnd + GRACE_DAYS * DAY : null, failedAt: sub.failedAt || null,
    scheduled: sub.scheduled ? { plan: sub.scheduled.plan, planName: PLANS[sub.scheduled.plan]?.name || sub.scheduled.plan, seats: sub.scheduled.seats, at: sub.scheduled.at } : null,
    refunds: (sub.refunds || []).length };
}
/** A subscription wins over a manual pilot grant; a family with neither has no entitlement. */
export function effectiveEntitlement(family, now) {
  return family.subscription ? entitlementFor(family.subscription, now) : (family.entitlement || null);
}

/** Pure transition. Throws on an event the current state does not accept. */
export function transition(sub, event, now) {
  const state = deriveState(sub, now), version = (sub?.version || 0) + 1;
  const plan = (id) => { const p = PLANS[id]; if (!p || !p.purchasable) fail(400, 'INVALID_PLAN'); return p; };
  switch (event.type) {
    case 'trial.start':
      if (sub) fail(409, 'SUBSCRIPTION_EXISTS');
      return { plan: 'trial', seats: PLANS.trial.seats, state: 'trial', trialEndsAt: now + TRIAL_DAYS * DAY, periodEnd: null, cancelAtPeriodEnd: false, failedAt: null, failures: 0,
        startedAt: now, updatedAt: now, version: 1, provider: event.provider || 'manual', providerRef: event.providerRef || null };
    case 'payment.succeeded': {
      const p = plan(event.plan);
      if (!Number.isSafeInteger(event.periodEnd) || event.periodEnd <= now || event.periodEnd > now + 400 * DAY) fail(400, 'INVALID_PERIOD');
      // S3.3-B: a payment renews the plan the family is on. Any other plan needs an intent the
      // server recorded — the parent's scheduled change (3.4), a checkout the server opened
      // (`authorized`, set only by a bound checkout.completed or an operator) — never the invoice alone.
      const current = sub && sub.plan !== 'trial' ? sub.plan : null;
      if (!current && !event.authorized) fail(409, 'CHECKOUT_REQUIRED'); // the first paid plan comes from a checkout
      if (current && current !== p.id && sub.scheduled?.plan !== p.id && !event.authorized) fail(409, 'PLAN_CHANGE_NOT_AUTHORIZED');
      // A renewal never undoes a cancellation the parent asked for: only cancel.undo or a fresh
      // intent (checkout / operator) clears it. The paid period is honoured; the operator refunds.
      const cancelAtPeriodEnd = event.authorized ? false : !!sub?.cancelAtPeriodEnd;
      // A scheduled change is applied by the renewal on its plan (or replaced by a fresh intent); a renewal on the plan the family
      // is already on - a retried older invoice, a provider that has not moved the price yet - leaves it waiting for the next one.
      const scheduled = event.authorized || !sub?.scheduled || sub.scheduled.plan === p.id ? null : { ...sub.scheduled, at: event.periodEnd };
      return { ...(sub || {}), plan: p.id, seats: p.seats, state: 'active', trialEndsAt: null, endedAt: null, periodEnd: event.periodEnd, cancelAtPeriodEnd, failedAt: null, failures: 0, scheduled, // endedAt: a paid subscription never carries the previous one's ending
        lastPaymentAt: now, startedAt: sub?.startedAt || now, updatedAt: now, version, provider: event.provider || sub?.provider || 'manual', providerRef: event.providerRef ?? sub?.providerRef ?? null,
        providerSubscriptionRef: event.subscriptionRef ?? sub?.providerSubscriptionRef ?? null }; // the provider's subscription this payment was for: events about another one are not this family's
    }
    case 'payment.failed':
      if (!['active', 'grace', 'past_due'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, failedAt: sub.failedAt || now, failures: (sub.failures || 0) + 1, updatedAt: now, version }; // access runs on to the end of grace; time does the rest
    case 'plan.change': {
      const p = plan(event.plan);
      if (!['trial', 'active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, plan: p.id, seats: p.seats, scheduled: null, updatedAt: now, version };
    }
    case 'plan.schedule': { // 3.4: a downgrade waits for the period end — nobody loses a seat mid-cycle (3.2-A); the renewal applies it with the choice recorded here
      if (!['active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      if (!event.plan || plan(event.plan).id === sub.plan) return { ...sub, scheduled: null, updatedAt: now, version };
      const p = PLANS[event.plan];
      return { ...sub, scheduled: { plan: p.id, seats: p.seats, seatChildIds: event.seatChildIds ? [...new Set(event.seatChildIds)] : null, at: sub.periodEnd, requestedAt: now }, updatedAt: now, version };
    }
    case 'refund': { // 3.4: money went back through the provider. A partial refund is a record; a full one ends access now. Never a wallet.
      if (state === 'none') fail(409, 'INVALID_TRANSITION');
      if (!Number.isSafeInteger(event.amountCents) || event.amountCents < 1 || (event.full !== undefined && typeof event.full !== 'boolean')) fail(400, 'INVALID_REQUEST'); // a zero-cent 'full' refund cannot cancel anyone, even by operator mistake
      const refunds = [...(sub.refunds || []), { amountCents: event.amountCents, full: event.full === true, providerRef: event.providerRef || null, at: now }];
      return { ...sub, refunds, ...(event.full === true ? { state: 'cancelled', endedAt: now, scheduled: null } : {}), updatedAt: now, version };
    }
    case 'cancel.request':
      if (!['trial', 'active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, cancelAtPeriodEnd: true, updatedAt: now, version };
    case 'cancel.undo':
      if (!sub?.cancelAtPeriodEnd || !['trial', 'active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, cancelAtPeriodEnd: false, updatedAt: now, version };
    case 'terminate':
      if (state === 'none') fail(409, 'INVALID_TRANSITION');
      return { ...sub, state: 'cancelled', endedAt: now, scheduled: null, updatedAt: now, version };
    case 'seats.assign':
      if (!ACCESS.has(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, updatedAt: now, version }; // capacity unchanged; the occupants change in assignSeats()
    default: fail(400, 'INVALID_EVENT');
  }
}
/**
 * Who occupies the seats after an event. With `seatChildIds` the list is the new occupancy
 * (children not on it go inactive, children on it come back — progress untouched). Without it,
 * the current occupants stay if they fit, else the event must say who keeps a seat.
 */
export function assignSeats(family, seats, seatChildIds) {
  const all = family.childIds || [], active = family.activeChildIds || [];
  if (seatChildIds === undefined || seatChildIds === null) {
    if (active.length <= seats) return { activeChildIds: active, activated: [], deactivated: [] };
    fail(409, 'SELECT_CHILDREN_FOR_DOWNGRADE');
  }
  if (!Array.isArray(seatChildIds)) fail(400, 'INVALID_SEAT_SELECTION');
  const next = [...new Set(seatChildIds)];
  for (const id of next) uuid(id);
  if (next.length > seats || next.some((id) => !all.includes(id))) fail(409, 'SELECT_CHILDREN_FOR_DOWNGRADE');
  return { activeChildIds: next, activated: next.filter((id) => !active.includes(id)), deactivated: active.filter((id) => !next.includes(id)) };
}
const fingerprintOf = (event) => sha256(JSON.stringify({ type: event.type, provider: event.provider || null, providerRef: event.providerRef || null, plan: event.plan || null, periodEnd: event.periodEnd || null, seatChildIds: event.seatChildIds ? [...new Set(event.seatChildIds)].sort() : null, amountCents: event.amountCents ?? null, full: event.full === true }));

export class Subscriptions {
  constructor({ foundation = null, store, now = Date.now, audit = null }) {
    this.foundation = foundation; this.store = store; this.now = now;
    this.audit = audit || ((tx, action, actor, familyId) => foundation.audit(tx, action, actor, familyId));
  }
  // Shared commit: reads first (event record, children), then the transition, then writes.
  async commit(tx, familyId, family, event, actor, now) {
    const path = `families/${familyId}`, evPath = `${path}/billing/${event.id}`, fingerprint = fingerprintOf(event);
    const seen = await tx.get(evPath);
    if (seen) {
      if (seen.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT'); // same id, different event: never silently the first result
      return seen.result;
    }
    const children = [];
    for (const id of family.childIds || []) children.push([id, await tx.get(`${path}/children/${id}`)]);
    const prior = family.subscription || null, sub = transition(prior, event, now);
    // A scheduled downgrade records the parent's seat choice without applying it; the renewal on
    // that plan applies it (the provider never sends seat ids). Everything else uses the event's own.
    const scheduledIds = event.type === 'payment.succeeded' && prior?.scheduled && prior.scheduled.plan === sub.plan ? prior.scheduled.seatChildIds ?? undefined : undefined;
    const seatIds = event.type === 'plan.schedule' ? undefined : (event.seatChildIds ?? scheduledIds);
    const { activeChildIds, activated, deactivated } = assignSeats(family, sub.seats, seatIds);
    tx.set(path, { ...family, subscription: sub, activeChildIds });
    for (const [id, c] of children) {
      if (!c) continue;
      if (deactivated.includes(id)) tx.set(`${path}/children/${id}`, { ...c, status: 'inactive' });
      else if (activated.includes(id)) tx.set(`${path}/children/${id}`, { ...c, status: 'active' });
    }
    const result = { state: deriveState(sub, now), entitlement: entitlementFor(sub, now), activeChildIds, activated, deactivated };
    tx.set(evPath, { id: event.id, type: event.type, plan: event.plan || null, periodEnd: event.periodEnd || null, provider: event.provider || null, providerRef: event.providerRef || null,
      seatChildIds: event.seatChildIds ? [...new Set(event.seatChildIds)].sort() : null, amountCents: event.amountCents ?? null, full: event.full === true, proration: event.proration || null, authorized: event.authorized === true, subscriptionRef: event.subscriptionRef || null, fingerprint, actor, at: now, result });
    this.audit(tx, `billing.${event.type}`, actor, familyId);
    return result;
  }
  /** Operator / webhook path (no browser session). Idempotent by event id + content. */
  async apply(familyId, event, actor = 'system') {
    uuid(familyId); object(event, ['id', 'type', 'plan', 'periodEnd', 'seatChildIds', 'provider', 'providerRef', 'amountCents', 'full']); uuid(event.id);
    if (!EVENTS.includes(event.type)) fail(400, 'INVALID_EVENT');
    if (event.type === 'trial.start') fail(400, 'TRIAL_IS_PARENT_ACTION'); // eligibility lives with the parent's verified phone
    return this.store.transaction(async (tx) => {
      const family = await tx.get(`families/${familyId}`);
      if (!family) fail(404, 'FAMILY_NOT_FOUND');
      return this.commit(tx, familyId, family, { ...event, authorized: true }, actor, this.now()); // an operator is an intent in person
    });
  }
  async parent(tx, ctx, recent) {
    const a = await this.foundation.authorize(tx, ctx, ['parent']);
    if (recent) this.foundation.requireRecent(a.s);
    const ledger = a.parent.phoneKey ? await tx.get(`phones/${a.parent.phoneKey}`) : null;
    return { ...a, ledger };
  }
  trialEligibility(family, parent, ledger, now) {
    if (family.subscription) return { eligible: false, reason: 'SUBSCRIPTION_EXISTS' };
    // Pilot policy: a family on an active manual grant is not offered the trial. Starting one would
    // move the family under subscription management for good, which the operator did not choose.
    const grant = family.entitlement;
    if (grant && grant.status === 'active' && Number.isSafeInteger(grant.accessUntil) && grant.accessUntil > now) return { eligible: false, reason: 'MANUAL_GRANT_ACTIVE' };
    if (!parent.phoneKey) return { eligible: false, reason: 'TRIAL_REQUIRES_VERIFIED_PHONE' };
    if (ledger?.trialFamilyId) return { eligible: false, reason: 'TRIAL_ALREADY_USED' }; // one trial per verified phone, however many emails
    return { eligible: true, reason: null };
  }
  // Every browser billing mutation names its operation, so a retried click after a lost response is
  // the same event. A request that forgets is refused rather than silently losing that guarantee.
  eventId(body) { if (!body || typeof body.operationId !== 'string') fail(400, 'OPERATION_ID_REQUIRED'); return uuid(body.operationId); }
  async view(ctx) {
    return this.store.transaction(async (tx) => {
      const { s, family, parent, ledger } = await this.parent(tx, ctx, false);
      const now = this.now();
      return { plans: Object.values(PLANS).filter((p) => p.purchasable).map(publicPlan), trialDays: TRIAL_DAYS, graceDays: GRACE_DAYS,
        subscription: family.subscription ? entitlementFor(family.subscription, now) : null, manualGrant: family.subscription ? null : (family.entitlement || null),
        trial: this.trialEligibility(family, parent, ledger, now), activeChildIds: family.activeChildIds || [], familyId: s.familyId, customer: family.billing || null };
    }, { readOnly: true });
  }
  /** The parent starts the free trial. The server decides eligibility from the verified phone. */
  async startTrial(ctx, body) {
    object(body, ['operationId']); const eventId = this.eventId(body);
    return this.store.transaction(async (tx) => {
      const { s, family, parent, ledger } = await this.parent(tx, ctx, true);
      const replay = await tx.get(`families/${s.familyId}/billing/${eventId}`);
      if (replay && replay.type === 'trial.start') return replay.result; // a retried click after a lost response
      const now = this.now();
      const e = this.trialEligibility(family, parent, ledger, now);
      if (!e.eligible) fail(e.reason === 'TRIAL_REQUIRES_VERIFIED_PHONE' ? 403 : 409, e.reason);
      const result = await this.commit(tx, s.familyId, family, { id: eventId, type: 'trial.start', provider: 'trial' }, s.uid, now);
      tx.set(`phones/${parent.phoneKey}`, { ...(ledger || { families: [s.familyId], count: 1, firstAt: now, lastAt: now }), trialFamilyId: s.familyId, trialAt: now });
      return result;
    });
  }
  /** Cancel at the end of the current period, or undo that. Access is never cut short by this. */
  async cancel(ctx, body) {
    object(body, ['undo', 'operationId']); const eventId = this.eventId(body);
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.parent(tx, ctx, true);
      if (!family.subscription) fail(409, 'NO_SUBSCRIPTION');
      return this.commit(tx, s.familyId, family, { id: eventId, type: body.undo === true ? 'cancel.undo' : 'cancel.request' }, s.uid, this.now());
    });
  }
  /** Give free seats to existing children. Adding only: swapping children within a paid cycle is not a parent action. */
  async seats(ctx, body) {
    object(body, ['childIds', 'operationId']); const eventId = this.eventId(body);
    if (!Array.isArray(body.childIds)) fail(400, 'INVALID_SEAT_SELECTION');
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.parent(tx, ctx, true);
      if (!family.subscription) fail(409, 'NO_SUBSCRIPTION');
      const current = family.activeChildIds || [];
      if (current.some((id) => !body.childIds.includes(id))) fail(409, 'SEATS_CANNOT_REMOVE'); // only a downgrade event removes; the parent may only add
      return this.commit(tx, s.familyId, family, { id: eventId, type: 'seats.assign', seatChildIds: body.childIds }, s.uid, this.now());
    });
  }
}
