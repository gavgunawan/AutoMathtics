// Stage 3.2 — the subscription and entitlement state machine.
//
// A family's `subscription` holds only facts that events set: plan, seats, trial end, period end,
// cancel-at-period-end, first payment failure. The effective state — trial, active, grace,
// past_due, cancelled, expired — is derived from those facts and the clock, so no scheduler is
// needed and every check is consistent with "now". Foundation.entitlement() reads the derived
// entitlement, which is how every child and parent route inherits it without change.
//
// Events reach the machine through Subscriptions.apply() (operator CLI now, verified webhooks in
// 3.3) or the two parent actions (start a trial, cancel at period end). Never through a browser
// field. Every event is recorded under families/{f}/billing/{eventId} before it acts, so a
// replayed event returns the stored result and money-like state changes at most once.
import { randomUUID } from 'node:crypto';
import { fail, object, uuid } from './security.mjs';

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
export const EVENTS = Object.freeze(['trial.start', 'payment.succeeded', 'payment.failed', 'plan.change', 'cancel.request', 'cancel.undo', 'terminate']);
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
    graceUntil: sub.state === 'active' && sub.periodEnd ? sub.periodEnd + GRACE_DAYS * DAY : null, failedAt: sub.failedAt || null };
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
      return { ...(sub || {}), plan: p.id, seats: p.seats, state: 'active', trialEndsAt: null, periodEnd: event.periodEnd, cancelAtPeriodEnd: false, failedAt: null, failures: 0,
        lastPaymentAt: now, startedAt: sub?.startedAt || now, updatedAt: now, version, provider: event.provider || sub?.provider || 'manual', providerRef: event.providerRef ?? sub?.providerRef ?? null };
    }
    case 'payment.failed':
      if (!['active', 'grace', 'past_due'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, failedAt: sub.failedAt || now, failures: (sub.failures || 0) + 1, updatedAt: now, version }; // access runs on to the end of grace; time does the rest
    case 'plan.change': {
      const p = plan(event.plan);
      if (!['trial', 'active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, plan: p.id, seats: p.seats, updatedAt: now, version };
    }
    case 'cancel.request':
      if (!['trial', 'active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, cancelAtPeriodEnd: true, updatedAt: now, version };
    case 'cancel.undo':
      if (!sub?.cancelAtPeriodEnd || !['trial', 'active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      return { ...sub, cancelAtPeriodEnd: false, updatedAt: now, version };
    case 'terminate':
      if (state === 'none') fail(409, 'INVALID_TRANSITION');
      return { ...sub, state: 'cancelled', endedAt: now, updatedAt: now, version };
    default: fail(400, 'INVALID_EVENT');
  }
}
/** Fewer seats than active children: the event must say who keeps a seat; the others go inactive. */
export function fitSeats(family, seats, keepChildIds) {
  const active = family.activeChildIds || [];
  if (active.length <= seats) return { activeChildIds: active, deactivated: [] };
  if (!Array.isArray(keepChildIds)) fail(409, 'SELECT_CHILDREN_FOR_DOWNGRADE');
  const keep = [...new Set(keepChildIds)];
  if (keep.length > seats || keep.some((id) => !(family.childIds || []).includes(id))) fail(409, 'SELECT_CHILDREN_FOR_DOWNGRADE');
  return { activeChildIds: keep, deactivated: active.filter((id) => !keep.includes(id)) };
}

export class Subscriptions {
  constructor({ foundation = null, store, now = Date.now, audit = null }) {
    this.foundation = foundation; this.store = store; this.now = now;
    this.audit = audit || ((tx, action, actor, familyId) => foundation.audit(tx, action, actor, familyId));
  }
  // Shared commit: reads are done by the caller; this validates, records the event, and writes.
  async commit(tx, familyId, family, event, actor, now) {
    const path = `families/${familyId}`, evPath = `${path}/billing/${event.id}`;
    const seen = await tx.get(evPath);
    if (seen) return seen.result; // a replayed event acts once
    const children = [];
    for (const id of family.childIds || []) children.push([id, await tx.get(`${path}/children/${id}`)]);
    const sub = transition(family.subscription || null, event, now);
    const { activeChildIds, deactivated } = fitSeats(family, sub.seats, event.keepChildIds);
    tx.set(path, { ...family, subscription: sub, activeChildIds });
    for (const [id, c] of children) if (c && deactivated.includes(id)) tx.set(`${path}/children/${id}`, { ...c, status: 'inactive' });
    const result = { state: deriveState(sub, now), entitlement: entitlementFor(sub, now), deactivated };
    tx.set(evPath, { id: event.id, type: event.type, plan: event.plan || null, periodEnd: event.periodEnd || null, provider: event.provider || null, providerRef: event.providerRef || null, actor, at: now, result });
    this.audit(tx, `billing.${event.type}`, actor, familyId);
    return result;
  }
  /** Operator / webhook path (no browser session). Idempotent by event id. */
  async apply(familyId, event, actor = 'system') {
    uuid(familyId); object(event, ['id', 'type', 'plan', 'periodEnd', 'keepChildIds', 'provider', 'providerRef']); uuid(event.id);
    if (!EVENTS.includes(event.type)) fail(400, 'INVALID_EVENT');
    if (event.type === 'trial.start') fail(400, 'TRIAL_IS_PARENT_ACTION'); // eligibility lives with the parent's verified phone
    return this.store.transaction(async (tx) => {
      const family = await tx.get(`families/${familyId}`);
      if (!family) fail(404, 'FAMILY_NOT_FOUND');
      return this.commit(tx, familyId, family, event, actor, this.now());
    });
  }
  async parent(tx, ctx, recent) {
    const a = await this.foundation.authorize(tx, ctx, ['parent']);
    if (recent) this.foundation.requireRecent(a.s);
    const ledger = a.parent.phoneKey ? await tx.get(`phones/${a.parent.phoneKey}`) : null;
    return { ...a, ledger };
  }
  trialEligibility(family, parent, ledger) {
    if (family.subscription) return { eligible: false, reason: 'SUBSCRIPTION_EXISTS' };
    if (!parent.phoneKey) return { eligible: false, reason: 'TRIAL_REQUIRES_VERIFIED_PHONE' };
    if (ledger?.trialFamilyId) return { eligible: false, reason: 'TRIAL_ALREADY_USED' }; // one trial per verified phone, however many emails
    return { eligible: true, reason: null };
  }
  async view(ctx) {
    return this.store.transaction(async (tx) => {
      const { s, family, parent, ledger } = await this.parent(tx, ctx, false);
      const now = this.now();
      return { plans: Object.values(PLANS).filter((p) => p.purchasable).map(publicPlan), trialDays: TRIAL_DAYS, graceDays: GRACE_DAYS,
        subscription: family.subscription ? entitlementFor(family.subscription, now) : null, manualGrant: family.subscription ? null : (family.entitlement || null),
        trial: this.trialEligibility(family, parent, ledger), activeCount: (family.activeChildIds || []).length, familyId: s.familyId };
    }, { readOnly: true });
  }
  /** The parent starts the free trial. The server decides eligibility from the verified phone. */
  async startTrial(ctx) {
    const eventId = randomUUID();
    return this.store.transaction(async (tx) => {
      const { s, family, parent, ledger } = await this.parent(tx, ctx, true);
      const e = this.trialEligibility(family, parent, ledger);
      if (!e.eligible) fail(e.reason === 'TRIAL_REQUIRES_VERIFIED_PHONE' ? 403 : 409, e.reason);
      const now = this.now();
      const result = await this.commit(tx, s.familyId, family, { id: eventId, type: 'trial.start', provider: 'trial' }, s.uid, now);
      tx.set(`phones/${parent.phoneKey}`, { ...(ledger || { families: [s.familyId], count: 1, firstAt: now, lastAt: now }), trialFamilyId: s.familyId, trialAt: now });
      return result;
    });
  }
  /** Cancel at the end of the current period, or undo that. Access is never cut short by this. */
  async cancel(ctx, body) {
    object(body, ['undo']);
    const eventId = randomUUID();
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.parent(tx, ctx, true);
      if (!family.subscription) fail(409, 'NO_SUBSCRIPTION');
      return this.commit(tx, s.familyId, family, { id: eventId, type: body.undo === true ? 'cancel.undo' : 'cancel.request' }, s.uid, this.now());
    });
  }
}
