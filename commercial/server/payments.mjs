// Stage 3.3 — the payment gateway abstraction and webhook security.
//
// A gateway turns a provider's signed webhook into one normalized event, and turns a parent's
// plan choice into a checkout. The only gateway today is `fake`: it moves no money, its
// checkout is a record the operator completes by sending a signed event (scripts/fake-webhook.mjs),
// and its signature scheme is the one a real provider will be adapted to in Stage 4. The $0
// constraint holds: fake events are fixtures, not a sandbox account.
//
// Every webhook is authenticated by an HMAC over the raw bytes and a timestamp inside a short
// window — no cookie, no CSRF, no Origin, nothing else is trusted before the MAC. It is then
// recorded in the global inbox billingEvents/{provider}:{eventId} BEFORE it acts (review
// finding 3.2-C): the same event delivered again is a replay of the stored outcome; the same id
// with different content is IDEMPOTENCY_CONFLICT. Events reach a family only through the
// customer reference the server minted at checkout (billingCustomers/{provider}:{ref}), so a
// webhook can never move a subscription to a family that did not start the checkout, and a
// webhook never touches a child wallet.
import { randomUUID, createHmac } from 'node:crypto';
import { Fault, fail, equal, object, text, uuid, sha256 } from './security.mjs';
import { PLANS, deriveState, assignSeats } from './subscription.mjs';

const MINUTE = 60_000, DAY = 86_400_000;
export const SIGNATURE_TOLERANCE_MS = 5 * MINUTE;
export const WEBHOOK_BODY_LIMIT = 65_536;
export const SIGNATURE_HEADER = 'x-webhook-signature';
export const CHECKOUT_TTL_MS = 30 * DAY;
export const PROVIDERS = Object.freeze(['fake']);

// Provider event types the machine understands, and the internal event each becomes. Anything
// else a provider sends is acknowledged, recorded and ignored — including a provider-announced
// plan change: paid upgrade/downgrade with proration and seat choice is Stage 3.4, so 3.3 does
// not let a webhook change seat capacity directly.
export const PROVIDER_EVENTS = Object.freeze({
  'checkout.completed': 'payment.succeeded',
  'invoice.paid': 'payment.succeeded',
  'invoice.payment_failed': 'payment.failed',
  'subscription.deleted': 'terminate',
  'charge.refunded': 'refund',
});
// The fake provider's price ids. A payload never names a server plan; the gateway's own table
// turns the provider's price id into one (a real provider's price ids go in its adapter's table).
export const FAKE_PRICES = Object.freeze({ price_fake_starter: 'starter', price_fake_family: 'family', price_fake_big: 'big' });

/** A uuid-shaped id derived from the provider event, so a re-delivered event maps to the same family billing record and commit() sees a replay, never a second event. */
export function derivedEventId(seed) {
  const h = sha256(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** `t=<unix ms>,v1=<hex hmac-sha256(secret, "<t>." + rawBody)>` — the timestamp is inside the MAC, so it cannot be moved. */
export function signWebhook(secret, rawBody, at) {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.`).update(rawBody).digest('hex')}`;
}
/** Verify the header against the raw bytes: signature first (constant time), then the window. Returns the signed timestamp. */
export function verifyWebhook(secret, rawBody, header, now) {
  const m = typeof header === 'string' ? header.match(/^t=(\d{1,16}),v1=([a-f0-9]{64})$/) : null;
  if (!m) fail(401, 'WEBHOOK_SIGNATURE_INVALID');
  const at = Number(m[1]);
  if (!equal(createHmac('sha256', secret).update(`${m[1]}.`).update(rawBody).digest('hex'), m[2])) fail(401, 'WEBHOOK_SIGNATURE_INVALID');
  if (!Number.isSafeInteger(at) || Math.abs(now - at) > SIGNATURE_TOLERANCE_MS) fail(401, 'WEBHOOK_SIGNATURE_EXPIRED');
  return at;
}
const ref = (v) => { text(v, 1, 128); if (!/^[A-Za-z0-9_.-]+$/.test(v)) fail(400, 'INVALID_REQUEST'); return v; };
/** The one shape every gateway hands to the inbox. Keys are fixed and ordered, so its JSON is canonical for fingerprinting. */
export function normalizeEvent(body) {
  object(body, ['id', 'type', 'at', 'customer', 'data']);
  const id = ref(body.id), customer = ref(body.customer), type = text(body.type, 1, 64);
  if (!Number.isSafeInteger(body.at) || body.at < 0) fail(400, 'INVALID_REQUEST');
  const d = object(body.data ?? {}, ['price', 'periodEnd', 'familyId', 'checkoutId', 'amountCents', 'full']); // no plan, no seats: those are the server's to decide
  if (d.price !== undefined) ref(d.price);
  if (d.periodEnd !== undefined && !Number.isSafeInteger(d.periodEnd)) fail(400, 'INVALID_REQUEST');
  if (d.familyId !== undefined) text(d.familyId, 1, 64);
  if (d.checkoutId !== undefined) ref(d.checkoutId);
  if (d.amountCents !== undefined && (!Number.isSafeInteger(d.amountCents) || d.amountCents < 0)) fail(400, 'INVALID_REQUEST');
  if (d.full !== undefined && typeof d.full !== 'boolean') fail(400, 'INVALID_REQUEST');
  return { id, type, at: body.at, customer, data: { price: d.price ?? null, periodEnd: d.periodEnd ?? null, familyId: d.familyId ?? null, checkoutId: d.checkoutId ?? null, amountCents: d.amountCents ?? null, full: d.full ?? null } };
}

/** The zero-cost gateway: a checkout is a record, a webhook is a signed fixture. */
export class FakeGateway {
  name = 'fake';
  constructor({ secret }) {
    if (!/^[a-f0-9]{64,}$/.test(secret || '')) throw Error('FakeGateway needs a hex webhook secret of at least 32 bytes.');
    this.secret = secret;
  }
  planFor(price) { return Object.hasOwn(FAKE_PRICES, price) ? FAKE_PRICES[price] : null; }
  priceFor(plan) { return Object.keys(FAKE_PRICES).find((p) => FAKE_PRICES[p] === plan) || null; }
  // No money moves and no browser is redirected: the operator completes the checkout with a signed checkout.completed event.
  async createCheckout({ checkoutId, customerRef, plan }) {
    return { provider: this.name, checkoutId, customerRef, plan: plan.id, priceId: this.priceFor(plan.id), url: null, simulated: true };
  }
  // Proration the way a provider would compute it: the price difference for the unused share of the period. Nothing is charged.
  async changePlan({ from, to, periodStart, periodEnd, now }) {
    const end = periodEnd || now, total = Math.max(1, end - (periodStart || now)), remaining = Math.min(total, Math.max(0, end - now));
    const diff = (PLANS[to]?.priceCents || 0) - (PLANS[from]?.priceCents || 0);
    return { chargeCents: Math.max(0, Math.round(diff * remaining / total)), basis: 'unused share of the current period', simulated: true };
  }
  sign(rawBody, at) { return signWebhook(this.secret, rawBody, at); }
  verify(rawBody, headers, now) {
    verifyWebhook(this.secret, rawBody, headers[SIGNATURE_HEADER], now);
    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { fail(400, 'INVALID_JSON'); }
    return normalizeEvent(body);
  }
}

export class Payments {
  constructor({ foundation, store, billing, gateways, provider, now = Date.now, audit = null }) {
    this.foundation = foundation; this.store = store; this.billing = billing; this.gateways = gateways; this.provider = provider; this.now = now;
    this.audit = audit || ((tx, action, actor, familyId) => foundation.audit(tx, action, actor, familyId));
    if (!gateways[provider]) throw Error(`No gateway for provider ${provider}`);
  }
  gateway(name) { const g = Object.hasOwn(this.gateways, name) ? this.gateways[name] : null; if (!g) fail(404, 'NOT_FOUND'); return g; }
  /**
   * Parent action: start a checkout for a purchasable plan. The family's customer reference for
   * the provider is minted here once and bound to this family forever; the browser never supplies
   * one. Idempotent by operationId. The provider call happens outside the transactions so a retry
   * never creates a second provider-side session.
   */
  async checkout(ctx, body) {
    object(body, ['plan', 'operationId']);
    const plan = typeof body.plan === 'string' ? PLANS[body.plan] : null;
    if (!plan || !plan.purchasable) fail(400, 'INVALID_PLAN');
    const gw = this.gateway(this.provider), checkoutId = this.billing.eventId(body), path = `checkouts/${gw.name}:${checkoutId}`;
    const prepared = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true);
      const existing = await tx.get(path);
      if (existing) { if (existing.familyId !== s.familyId) fail(409, 'IDEMPOTENCY_CONFLICT'); return { familyId: s.familyId, uid: s.uid, existing }; }
      const customerRef = family.billing?.[gw.name] || `cus_${randomUUID()}`;
      const mappingPath = `billingCustomers/${gw.name}:${customerRef}`, mapping = await tx.get(mappingPath);
      if (mapping && mapping.familyId !== s.familyId) fail(403, 'ACCESS_DENIED'); // a reference belongs to exactly one family
      if (!mapping) tx.set(mappingPath, { provider: gw.name, customerRef, familyId: s.familyId, createdAt: this.now(), lastEventAt: 0, lastEventId: null });
      if (family.billing?.[gw.name] !== customerRef) tx.set(`families/${s.familyId}`, { ...family, billing: { ...(family.billing || {}), [gw.name]: customerRef } });
      return { familyId: s.familyId, uid: s.uid, customerRef, existing: null };
    });
    if (prepared.existing) return prepared.existing.result;
    const result = await gw.createCheckout({ checkoutId, customerRef: prepared.customerRef, plan, familyId: prepared.familyId });
    return this.store.transaction(async (tx) => {
      const seen = await tx.get(path);
      if (seen) return seen.result; // the same operation raced itself
      const now = this.now();
      tx.set(path, { provider: gw.name, checkoutId, familyId: prepared.familyId, customerRef: prepared.customerRef, plan: plan.id, status: 'pending', createdAt: now, completedAt: null, expireAt: now + CHECKOUT_TTL_MS, result });
      this.audit(tx, 'billing.checkout', prepared.uid, prepared.familyId);
      return result;
    });
  }
  /**
   * Parent action (3.4): change plan. Up: capacity now, and the provider is asked for the prorated
   * difference (fake: computed, nothing charged). Down: scheduled for the period end with the
   * parent's seat choice — nobody loses a seat mid-cycle (3.2-A) — and applied by the renewal
   * event on that plan. Asking for the current plan clears a pending schedule. A trial becomes
   * paid through a checkout, never a plan change. Idempotent by operationId.
   */
  async changePlan(ctx, body) {
    object(body, ['plan', 'seatChildIds', 'operationId']);
    const plan = typeof body.plan === 'string' ? PLANS[body.plan] : null;
    if (!plan || !plan.purchasable) fail(400, 'INVALID_PLAN');
    if (body.seatChildIds !== undefined) { if (!Array.isArray(body.seatChildIds)) fail(400, 'INVALID_SEAT_SELECTION'); for (const id of body.seatChildIds) uuid(id); }
    const eventId = this.billing.eventId(body), gw = this.gateway(this.provider);
    const prepared = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true);
      const seen = await tx.get(`families/${s.familyId}/billing/${eventId}`);
      if (seen) { // the same click again: the stored result, whatever the state is now
        if (seen.plan !== plan.id || !['plan.change', 'plan.schedule'].includes(seen.type)) fail(409, 'IDEMPOTENCY_CONFLICT');
        return { replay: { ...seen.result, kind: seen.type === 'plan.change' ? 'upgrade' : (seen.result.entitlement.scheduled ? 'downgrade' : 'clear'), proration: seen.proration || null } };
      }
      const sub = family.subscription; if (!sub) fail(409, 'NO_SUBSCRIPTION');
      const state = deriveState(sub, this.now());
      if (state === 'trial') fail(409, 'CHECKOUT_REQUIRED');
      if (!['active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      const kind = plan.id === sub.plan ? 'clear' : plan.seats > sub.seats ? 'upgrade' : 'downgrade';
      if (kind === 'downgrade') assignSeats(family, plan.seats, body.seatChildIds); // the choice must be complete now, although it applies at renewal
      return { sub, kind, customerRef: family.billing?.[gw.name] || null };
    });
    if (prepared.replay) return prepared.replay;
    const now = this.now();
    const proration = prepared.kind === 'upgrade'
      ? await gw.changePlan({ customerRef: prepared.customerRef, from: prepared.sub.plan, to: plan.id, periodStart: prepared.sub.lastPaymentAt || prepared.sub.startedAt, periodEnd: prepared.sub.periodEnd, now })
      : null;
    return this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true);
      const seats = body.seatChildIds ? { seatChildIds: body.seatChildIds } : {};
      const event = prepared.kind === 'upgrade'
        ? { id: eventId, type: 'plan.change', plan: plan.id, provider: gw.name, providerRef: prepared.customerRef, proration, ...seats }
        : { id: eventId, type: 'plan.schedule', plan: plan.id, ...seats }; // the current plan clears; a smaller one schedules
      const result = await this.billing.commit(tx, s.familyId, family, event, s.uid, this.now());
      return { ...result, kind: prepared.kind, proration };
    });
  }
  /**
   * A provider webhook. Authenticate (MAC over raw bytes, timestamp window), normalize, then in
   * one transaction: replay check against the global inbox, resolve the family through the
   * customer mapping, apply through the same commit() every other billing event uses, and record
   * the outcome. A rejected or ignored event is recorded too and acknowledged, so the provider
   * stops retrying and an operator can see exactly what arrived.
   */
  async receive(providerName, rawBody, headers) {
    const gw = this.gateway(providerName);
    if (!Buffer.isBuffer(rawBody)) fail(400, 'INVALID_REQUEST');
    if (rawBody.length > WEBHOOK_BODY_LIMIT) fail(413, 'REQUEST_TOO_LARGE');
    const now = this.now(), ev = gw.verify(rawBody, headers, now);
    const inboxPath = `billingEvents/${gw.name}:${ev.id}`, fingerprint = sha256(JSON.stringify(ev)), internalType = PROVIDER_EVENTS[ev.type] || null;
    return this.store.transaction(async (tx) => {
      const seen = await tx.get(inboxPath);
      if (seen) {
        if (seen.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT');
        // A rejected event applied nothing, so the provider's redelivery is processed again — this is
        // how a renewal refused for want of a seat choice lands once the parent has made one (3.4).
        if (seen.outcome.status !== 'rejected') return { ...seen.outcome, replayed: true };
      }
      const mappingPath = `billingCustomers/${gw.name}:${ev.customer}`, mapping = await tx.get(mappingPath);
      const familyId = mapping?.familyId || null;
      const checkoutPath = ev.data.checkoutId ? `checkouts/${gw.name}:${ev.data.checkoutId}` : null;
      const checkout = checkoutPath ? await tx.get(checkoutPath) : null; // read now: commit() writes next
      const plan = ev.data.price ? gw.planFor(ev.data.price) : null; // the provider's price id through the gateway's table; the payload never names a plan
      let outcome;
      if (!internalType) outcome = { status: 'ignored', reason: 'UNSUPPORTED_EVENT' };
      else if (!mapping) outcome = { status: 'rejected', reason: 'UNKNOWN_CUSTOMER' };
      else if (ev.data.familyId && ev.data.familyId !== familyId) outcome = { status: 'rejected', reason: 'FAMILY_MISMATCH' };
      else if (checkout && checkout.familyId !== familyId) outcome = { status: 'rejected', reason: 'CHECKOUT_MISMATCH' };
      else if (internalType === 'payment.succeeded' && !plan) outcome = { status: 'rejected', reason: 'UNKNOWN_PRICE' };
      else if (checkout && plan && checkout.plan !== plan) outcome = { status: 'rejected', reason: 'CHECKOUT_MISMATCH' }; // paid for a different plan than the one this checkout was opened for
      else if (ev.at < mapping.lastEventAt) outcome = { status: 'ignored', reason: 'STALE_EVENT' }; // an older event arriving after a newer one never rolls the facts back
      else {
        const family = await tx.get(`families/${familyId}`);
        if (!family) outcome = { status: 'rejected', reason: 'FAMILY_NOT_FOUND' };
        else {
          const event = { id: derivedEventId(`${gw.name}:${ev.id}`), type: internalType, provider: gw.name, providerRef: ev.customer,
            ...(plan ? { plan } : {}), ...(ev.data.periodEnd ? { periodEnd: ev.data.periodEnd } : {}),
            ...(internalType === 'refund' ? { amountCents: ev.data.amountCents ?? undefined, full: ev.data.full === true } : {}) };
          try {
            const result = await this.billing.commit(tx, familyId, family, event, `webhook:${gw.name}`, now);
            outcome = { status: 'applied', state: result.state, eventId: event.id };
          } catch (error) {
            if (!(error instanceof Fault)) throw error; // infrastructure: let the provider retry
            outcome = { status: 'rejected', reason: error.code }; // the machine refused it (e.g. a downgrade that needs a seat choice): recorded for the operator
          }
        }
      }
      if (outcome.status === 'applied') {
        tx.set(mappingPath, { ...mapping, lastEventAt: ev.at, lastEventId: ev.id });
        if (checkout && checkout.status === 'pending' && ev.type === 'checkout.completed') tx.set(checkoutPath, { ...checkout, status: 'completed', completedAt: now });
      }
      tx.set(inboxPath, { provider: gw.name, providerEventId: ev.id, type: ev.type, at: ev.at, receivedAt: seen?.receivedAt ?? now, lastReceivedAt: now, attempts: (seen?.attempts || 0) + 1, customer: ev.customer, familyId, data: ev.data, fingerprint, outcome });
      this.audit(tx, `webhook.${outcome.status}`, `webhook:${gw.name}`, familyId);
      return outcome;
    });
  }
}
