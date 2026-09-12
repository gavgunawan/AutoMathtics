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
import { PLANS, PAUSE_MONTHS, deriveState, assignSeats, transition } from './subscription.mjs';

const MINUTE = 60_000, DAY = 86_400_000;
export const SIGNATURE_TOLERANCE_MS = 5 * MINUTE;
export const WEBHOOK_BODY_LIMIT = 65_536;
export const SIGNATURE_HEADER = 'x-webhook-signature';
export const INTENT_INFLIGHT_MS = 2 * MINUTE; // an upgrade's provider call is presumed abandoned after this
export const AWAITING_PAYMENT_MS = 24 * 60 * MINUTE; // an upgrade the provider holds until its invoice is paid blocks other changes this long (Stripe discards a pending update after about 23 hours)
// States in which a family may start a checkout. A paid family (active/grace) changes plan through
// /api/billing/plan, never through a fresh checkout (S3.3/3.4-E); past_due recovery is explicit policy:
// pay the dunning invoice (a renewal on the plan on record) or start a checkout for any plan.
export const CHECKOUT_STATES = new Set(['none', 'trial', 'past_due', 'cancelled', 'expired']);
/** Deterministic refusals from the provider's truth (never faults): the family is marked for the operator and the nightly sweep names it (PROVIDER_ATTENTION). */
const CHECKOUT_WAIT_MS = 24 * 60 * 60 * 1000; // a hosted session lives a day: a refund waits for a completion no longer than that
export const PROVIDER_REFUSALS = new Set(['MULTIPLE_PROVIDER_SUBSCRIPTIONS', 'PROVIDER_SUBSCRIPTION_LIVE', 'CHECKOUT_COMPLETING', 'PROVIDER_SUBSCRIPTION_NOT_FOUND', 'PROVIDER_SUBSCRIPTION_PAID']);
/** A family that has, or had, a paid subscription with this provider still owes its ending before a new checkout (trials and operator grants have no provider side). */
const owesEndingWith = (gwName) => (family) => !!family.subscription && family.subscription.provider === gwName && family.subscription.plan !== 'trial' && !!family.billing?.[gwName];
// Outcomes a later server-side action can resolve (S3.4-D): kept on the customer mapping and reprocessed by the server.
export const ACTIONABLE = new Set(['SELECT_CHILDREN_FOR_DOWNGRADE', 'PLAN_CHANGE_NOT_AUTHORIZED', 'CHECKOUT_REQUIRED']);
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
  // Leaving (12 Sep 2026): the provider's echo that collection is paused or resumed (Stripe: customer.subscription.updated
  // carrying pause_collection). It moves no plan and no seat: only the pause fact, and the provider is its authority.
  'subscription.paused': 'pause.start',
  'subscription.resumed': 'pause.end',
  'charge.refunded': 'refund', // the fake provider's refund fixture: one event per refund
  'refund.created': 'refund', // a real provider's per-refund object (never the charge's running total)
  'dispute.opened': 'refund', // a card dispute takes the money back the moment it is opened: access ends then (the owner's policy)
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
export function normalizeEvent(body, now) {
  object(body, ['id', 'type', 'at', 'seq', 'customer', 'data']);
  const id = ref(body.id), customer = ref(body.customer), type = text(body.type, 1, 64);
  if (!Number.isSafeInteger(body.at) || body.at < 0) fail(400, 'INVALID_REQUEST');
  // S3.3-C: a validly signed event dated in the future would pin `lastEventAt` there and make every
  // real event after it "stale". The provider's clock may drift by the signature window, no more.
  if (now !== undefined && body.at > now + SIGNATURE_TOLERANCE_MS) fail(400, 'EVENT_IN_FUTURE');
  // `seq` is the adapter's ordering key within one timestamp (providers expose seconds); a real
  // adapter must supply a total order — see PAYMENTS.md → Ordering.
  if (body.seq !== undefined && (!Number.isSafeInteger(body.seq) || body.seq < 0)) fail(400, 'INVALID_REQUEST');
  const d = object(body.data ?? {}, ['price', 'periodEnd', 'familyId', 'checkoutId', 'amountCents', 'full', 'ref', 'subscriptionRef', 'resumesAt']); // no plan, no seats: those are the server's to decide
  if (d.ref !== undefined) ref(d.ref); // the provider's own id of the object (a refund, an invoice): dedupe evidence
  if (d.subscriptionRef !== undefined) ref(d.subscriptionRef); // the provider's subscription the event is about
  if (d.price !== undefined) ref(d.price);
  if (d.periodEnd !== undefined && !Number.isSafeInteger(d.periodEnd)) fail(400, 'INVALID_REQUEST');
  if (d.resumesAt !== undefined && d.resumesAt !== null && !Number.isSafeInteger(d.resumesAt)) fail(400, 'INVALID_REQUEST'); // when collection resumes, as the provider states it
  if (d.familyId !== undefined) text(d.familyId, 1, 64);
  if (d.checkoutId !== undefined) ref(d.checkoutId);
  if (d.amountCents !== undefined && (!Number.isSafeInteger(d.amountCents) || d.amountCents < 0)) fail(400, 'INVALID_REQUEST');
  if (d.full !== undefined && typeof d.full !== 'boolean') fail(400, 'INVALID_REQUEST');
  return { id, type, at: body.at, seq: body.seq ?? null, customer, data: { price: d.price ?? null, periodEnd: d.periodEnd ?? null, familyId: d.familyId ?? null, checkoutId: d.checkoutId ?? null, amountCents: d.amountCents ?? null, full: d.full ?? null, ref: d.ref ?? null, subscriptionRef: d.subscriptionRef ?? null, resumesAt: d.resumesAt ?? null } };
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
  // No money moves and no browser is redirected: the operator completes the checkout with a signed
  // checkout.completed event. `idempotencyKey` is what a real adapter hands the provider so that a
  // retried creation returns the same hosted session (S3.3-A); the fake one records it.
  async createCheckout({ checkoutId, idempotencyKey, customerRef, plan }) {
    return { provider: this.name, checkoutId, providerCheckoutRef: `fake_cs_${checkoutId}`, idempotencyKey, customerRef, plan: plan.id, priceId: this.priceFor(plan.id), url: null, simulated: true };
  }
  // Proration the way a provider would compute it: the price difference for the unused share of the period. Nothing is charged.
  async changePlan({ idempotencyKey, from, to, periodStart, periodEnd, now }) {
    const end = periodEnd || now, total = Math.max(1, end - (periodStart || now)), remaining = Math.min(total, Math.max(0, end - now));
    const diff = (PLANS[to]?.priceCents || 0) - (PLANS[from]?.priceCents || 0);
    return { chargeCents: Math.max(0, Math.round(diff * remaining / total)), basis: 'unused share of the current period', providerOperationRef: `fake_op_${idempotencyKey}`, applied: true, pending: false, simulated: true };
  }
  // Stage 4.2 provider effects, simulated: recorded on `calls`, nothing charged, no state held (inspect reports none).
  record(...call) { (this.calls ||= []).push(call); }
  async schedulePlan({ idempotencyKey, customerRef, to }) { this.record('schedulePlan', customerRef, to); return { providerOperationRef: `fake_op_${idempotencyKey}`, effectiveAt: null, simulated: true }; }
  // Leaving (12 Sep 2026): collection paused with behaviour 'void' — no invoice is raised while it lasts, so a pause can never charge twice.
  async pauseCollection({ idempotencyKey, customerRef, resumesAt = null }) { this.record('pauseCollection', customerRef, resumesAt); return { providerOperationRef: `fake_op_${idempotencyKey}`, paused: true, behavior: 'void', resumesAt: Number.isSafeInteger(resumesAt) ? resumesAt : null, simulated: true }; }
  async resumeCollection({ idempotencyKey, customerRef }) { this.record('resumeCollection', customerRef); return { providerOperationRef: `fake_op_${idempotencyKey}`, paused: false, resumesAt: null, simulated: true }; }
  async setCancelAtPeriodEnd({ idempotencyKey, customerRef, cancel }) { this.record('setCancelAtPeriodEnd', customerRef, cancel); return { providerOperationRef: `fake_op_${idempotencyKey}`, cancelAtPeriodEnd: cancel === true, simulated: true }; }
  async cancelSubscription({ idempotencyKey, customerRef }) { this.record('cancelSubscription', customerRef); return { cancelled: true, providerOperationRef: `fake_op_${idempotencyKey}`, simulated: true }; }
  async inspect(customerRef) { this.record('inspect', customerRef); return { provider: this.name, customer: { id: customerRef }, subscription: null, simulated: true }; }
  sign(rawBody, at) { return signWebhook(this.secret, rawBody, at); }
  verify(rawBody, headers, now) {
    verifyWebhook(this.secret, rawBody, headers[SIGNATURE_HEADER], now);
    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { fail(400, 'INVALID_JSON'); }
    return normalizeEvent(body, now);
  }
}

export class Payments {
  constructor({ foundation, store, billing, gateways, provider, now = Date.now, audit = null, inflightMs = INTENT_INFLIGHT_MS }) {
    this.foundation = foundation; this.store = store; this.billing = billing; this.gateways = gateways; this.provider = provider; this.now = now; this.inflightMs = inflightMs;
    this.audit = audit || ((tx, action, actor, familyId, extra) => foundation.audit(tx, action, actor, familyId, null, extra)); // extra facts (a refusal's code) ride on the row, never in childId
    if (!gateways[provider]) throw Error(`No gateway for provider ${provider}`);
  }
  gateway(name) { const g = Object.hasOwn(this.gateways, name) ? this.gateways[name] : null; if (!g) fail(404, 'NOT_FOUND'); return g; }
  /**
   * Parent action: start a checkout for a purchasable plan. The family's customer reference for
   * the provider is minted here once and bound to this family forever; the browser never supplies
   * one. S3.3-A: the checkout *intent* is durable before the provider is contacted —
   *   intent (status creating, fingerprint of provider+plan) → provider call with the checkout id
   *   as the provider-side idempotency key → intent pending with the provider's reference.
   * The same operation id with the same plan replays; with another plan it is a conflict. A
   * crash between the intent and the provider, or two simultaneous requests, both resume the same
   * intent and hand the provider the same key, so it can return the same session.
   */
  async checkout(ctx, body) {
    object(body, ['plan', 'operationId']);
    const plan = typeof body.plan === 'string' ? PLANS[body.plan] : null;
    if (!plan || !plan.purchasable) fail(400, 'INVALID_PLAN');
    const gw = this.gateway(this.provider), checkoutId = this.billing.eventId(body), path = `checkouts/${gw.name}:${checkoutId}`, owesEnding = owesEndingWith(gw.name);
    const fingerprint = sha256(JSON.stringify({ provider: gw.name, plan: plan.id, priceId: gw.priceFor(plan.id) }));
    const prepared = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true);
      const existing = await tx.get(path);
      if (existing) {
        if (existing.familyId !== s.familyId || existing.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT'); // same id, another plan or family: never the first checkout
        if (existing.status === 'superseded') return { done: { ...(existing.result || {}), checkoutId, url: null, superseded: true } }; // never redisplay a superseded hosted session
        if (existing.status !== 'creating') return { done: existing.result ?? { checkoutId, url: null, status: existing.status } }; // completed with its finalisation lost: a closed answer, never a fresh session
        // an earlier attempt stopped between the intent and the provider: resume with the same key, and with whatever it still owed
        // the provider — the intent records those debts, so a crash or a fault before they were settled cannot skip them (fourth round).
        // An intent from before the debts were recorded is owed whatever the family still shows, never presumed settled.
        const owed = existing.endPrevious ? existing.endPrevious.status === 'pending' : !existing.endedPrevious && owesEnding(family);
        // A debt is settled only against the family it was recorded for. Moved since — the dunning invoice paid, a plan changed, another
        // checkout completed, so the state is no longer one a checkout starts from, or the record names another subscription — the intent
        // is stale and the family's state answers as it would a fresh start (USE_PLAN_CHANGE), so a retried click never ends a subscription
        // that has just been paid for. A payment the record has not seen yet is the provider's to refuse (`unlessPaid`, below); an ending
        // the record saw meanwhile (the provider's own notice of the very ending this intent owed) is not a move — the ending is idempotent.
        const state = family.subscription ? deriveState(family.subscription, this.now()) : 'none';
        const moved = !CHECKOUT_STATES.has(state) || (owed && !!existing.subscriptionRef && family.subscription?.providerSubscriptionRef !== existing.subscriptionRef);
        if (moved) {
          tx.set(path, { ...existing, status: 'stale', staleReason: 'STATE_MOVED', staleAt: this.now() });
          if (family.checkoutIntent?.[gw.name] === checkoutId) tx.set(`families/${s.familyId}`, { ...family, checkoutIntent: { ...family.checkoutIntent, [gw.name]: null } });
          return { refused: CHECKOUT_STATES.has(state) ? 'SUBSCRIPTION_CHANGED' : 'USE_PLAN_CHANGE' };
        }
        return { familyId: s.familyId, uid: s.uid, customerRef: existing.customerRef, endPrevious: owed ? 'pending' : 'done', supersededRef: existing.supersededRef || null, supersededId: existing.supersededId || null,
          subscriptionRef: existing.subscriptionRef || family.subscription?.providerSubscriptionRef || null, customerId: family.providerCustomer?.[gw.name] || null, customerKnown: !!family.billing?.[gw.name], recordEnded: state === 'cancelled' && !!family.subscription?.endedAt }; // ended by this server and still so: a later paid subscription clears it
      }
      const now = this.now(), state = family.subscription ? deriveState(family.subscription, now) : 'none';
      if (!CHECKOUT_STATES.has(state)) fail(409, 'USE_PLAN_CHANGE'); // a paid family changes plan through the 3.4 lifecycle, not a fresh checkout (S3.3/3.4-E)
      const customerRef = family.billing?.[gw.name] || `cus_${randomUUID()}`;
      const mappingPath = `billingCustomers/${gw.name}:${customerRef}`, mapping = await tx.get(mappingPath);
      if (mapping && mapping.familyId !== s.familyId) fail(403, 'ACCESS_DENIED'); // a reference belongs to exactly one family
      // one live checkout per family and provider: a newer one supersedes the older, whose later completion is refused
      const live = family.checkoutIntent?.[gw.name] || null, older = live ? await tx.get(`checkouts/${gw.name}:${live}`) : null;
      if (older && older.status === 'pending' && older.paymentPending) return { refused: 'CHECKOUT_COMPLETING', familyId: s.familyId }; // its session was completed and the payment is clearing (a bank debit): never superseded, its async success completes it
      if (!mapping) tx.set(mappingPath, { provider: gw.name, customerRef, familyId: s.familyId, createdAt: now, lastEventAt: 0, lastEventSeq: null, lastEventId: null });
      tx.set(`families/${s.familyId}`, { ...family, billing: { ...(family.billing || {}), [gw.name]: customerRef }, checkoutIntent: { ...(family.checkoutIntent || {}), [gw.name]: checkoutId } });
      if (older && ['creating', 'pending'].includes(older.status)) tx.set(`checkouts/${gw.name}:${live}`, { ...older, status: 'superseded', supersededBy: checkoutId, supersededAt: now });
      // no expireAt: a checkout intent is idempotency and recovery evidence, kept under the financial retention policy (S3.4-G)
      // a family coming back from past_due / cancelled / expired may still have a subscription winding down at the provider: it is
      // ended before a new one is opened, so one customer never carries two (third round). What the intent owes the provider — that
      // ending, the expiry of a superseded session — is written on the intent itself, so a resume after a crash or a provider fault
      // finds the debt and settles it first (fourth round: the resume used to skip straight to the session).
      const endPrevious = owesEnding(family), supersedes = older && ['creating', 'pending'].includes(older.status);
      const supersededRef = supersedes ? older.providerCheckoutRef || null : null, supersededId = supersedes ? live : null;
      tx.set(path, { provider: gw.name, checkoutId, familyId: s.familyId, customerRef, plan: plan.id, priceId: gw.priceFor(plan.id), fingerprint, status: 'creating', providerCheckoutRef: null,
        endPrevious: { required: endPrevious, status: endPrevious ? 'pending' : 'not_applicable', result: null, at: null }, supersededRef, supersededId,
        subscriptionRef: family.subscription?.providerSubscriptionRef || null, subscriptionVersion: family.subscription?.version ?? null, createdAt: now, completedAt: null, result: null }); // the subscription the debt is against
      this.audit(tx, 'billing.checkout', s.uid, s.familyId);
      return { familyId: s.familyId, uid: s.uid, customerRef, endPrevious: endPrevious ? 'pending' : 'done', supersededRef, supersededId, subscriptionRef: family.subscription?.providerSubscriptionRef || null, customerId: family.providerCustomer?.[gw.name] || null, customerKnown: !!family.billing?.[gw.name], recordEnded: state === 'cancelled' && !!family.subscription?.endedAt }; // ended by this server and still so: a later paid subscription clears it
    });
    if ('done' in prepared) return prepared.done;
    if (prepared.refused === 'CHECKOUT_COMPLETING') await this.refuse(prepared.familyId, prepared.refused);
    if (prepared.refused) fail(409, prepared.refused);
    // The debts, the harmless one first: a superseded hosted session is expired at the provider (best effort, retried on every
    // resume — its completion is refused regardless), and a refused ending below must not leave it payable.
    if (prepared.supersededRef && typeof gw.cancelCheckout === 'function') { try { await gw.cancelCheckout(prepared.supersededRef); } catch { /* recorded by the provider; the inbox refuses a late completion anyway */ } }
    if (prepared.endPrevious === 'pending' && typeof gw.cancelSubscription === 'function') {
      // a provider fault here propagates: the intent stays `creating` with the debt still `pending`, and no session is opened over a
      // subscription still live; the parent's retry (the same operation id) lands here again. Only the subscription the family's
      // record names is ended: a different live one is a checkout completing — just paid for — and is never ended for a new one.
      let ended;
      // `unlessPaid`: a payment the record has not seen is the provider's to refuse — unless the record was ended by this server itself
      // (a full refund, a dispute, an operator's terminate: `endedAt`), when the provider still billing is exactly what the checkout ends
      try { ended = await gw.cancelSubscription({ idempotencyKey: `end:${checkoutId}`, customerRef: prepared.customerRef, customerId: prepared.customerId, subscriptionRef: prepared.subscriptionRef, unlessPaid: !prepared.recordEnded }); }
      catch (error) { if (error instanceof Fault && PROVIDER_REFUSALS.has(error.code)) await this.refuse(prepared.familyId, error.code); throw error; }
      if (ended.cancelled === false && ended.reason === 'NO_PROVIDER_SUBSCRIPTION') await this.refuse(prepared.familyId, 'PROVIDER_SUBSCRIPTION_NOT_FOUND'); // nothing was ended: the debt stays pending (a search that missed is retried), never presumed settled
      if (ended.cancelled === false && ended.reason === 'SUBSCRIPTION_PAID') await this.refuse(prepared.familyId, 'PROVIDER_SUBSCRIPTION_PAID'); // paid and current at the provider while the family's record says otherwise: the record is behind (its invoice.paid still on its way) and a paid subscription is never ended for a new one
      if (ended.cancelled === false && ended.reason === 'ANOTHER_SUBSCRIPTION_LIVE') {
        // a live subscription that is not the one the record names: a checkout of ours completing — the provider names that checkout
        // on the subscription it made, and that checkout held a session — is reinstated as the family's live checkout and this one
        // closed, whichever click superseded it; anything else (a subscription the dashboard made, a checkout that never reached the
        // provider) is the operator's
        const named = await this.namedCheckout(gw, prepared.familyId, ended.liveCheckoutId);
        if (named) await this.reinstate(gw, prepared, checkoutId, path, named);
        await this.refuse(prepared.familyId, 'PROVIDER_SUBSCRIPTION_LIVE');
      }
      await this.store.transaction(async (tx) => { const intent = await tx.get(path); if (intent && intent.status === 'creating') tx.set(path, { ...intent, endPrevious: { ...(intent.endPrevious || { required: true }), status: 'done', result: ended, at: this.now() }, endedPrevious: ended }); });
    }
    // The provider's truth before a session is opened, for a customer this server already knows: two live subscriptions, or one
    // the family's record does not know of (dashboard drift), and nothing is opened over them — the operator resolves it first.
    if (prepared.customerKnown && typeof gw.inspect === 'function') {
      const st = await gw.inspect(prepared.customerRef, { customerId: prepared.customerId });
      if (st.multiple) await this.refuse(prepared.familyId, 'MULTIPLE_PROVIDER_SUBSCRIPTIONS');
      if (!st.simulated && ((st.openCount ?? st.liveCount) || 0) >= 1) { // live, or able to bill again
        // a first checkout paid at the provider and clicked again before its completion landed: the subscription names that checkout,
        // which is reinstated (never left superseded with its completion refused) — anything else is the operator's (fifth round)
        let named = null; for (const x of st.subscriptions || []) { named = await this.namedCheckout(gw, prepared.familyId, x.checkoutId); if (named) break; }
        if (named) await this.reinstate(gw, prepared, checkoutId, path, named);
        await this.refuse(prepared.familyId, 'PROVIDER_SUBSCRIPTION_LIVE');
      }
    }
    const result = await gw.createCheckout({ checkoutId, idempotencyKey: checkoutId, customerRef: prepared.customerRef, customerId: prepared.customerId, plan, familyId: prepared.familyId });
    const finished = await this.store.transaction(async (tx) => {
      const intent = await tx.get(path);
      const family = await tx.get(`families/${prepared.familyId}`);
      // a provider that assigns its own customer id (Stripe does): that id resolves to this family too — and only this family
      const providerId = result.providerCustomerId && result.providerCustomerId !== prepared.customerRef ? result.providerCustomerId : null;
      const aliasPath = providerId ? `billingCustomers/${gw.name}:${providerId}` : null, alias = aliasPath ? await tx.get(aliasPath) : null;
      if (!intent || intent.status !== 'creating') {
        // superseded or completed while this attempt was stalled: the session just opened must never reach the parent — it is
        // recorded on the intent, expired below, and the answer is closed. Unless it is the very session the intent already holds:
        // two attempts of one operation reach the provider under one idempotency key and get one session, and the attempt that
        // finalised second must not expire what the first handed the parent (fifth round) — it answers the same session again.
        const same = !!result.providerCheckoutRef && intent?.providerCheckoutRef === result.providerCheckoutRef;
        if (intent && !same) tx.set(path, { ...intent, lateSessionRef: result.providerCheckoutRef || null });
        const closed = intent?.status === 'superseded' ? { ...(intent.result || {}), checkoutId, url: null, superseded: true } : intent?.result ?? { checkoutId, url: null, status: intent?.status || 'unknown' };
        if (aliasPath && !alias) tx.set(aliasPath, { provider: gw.name, customerRef: providerId, aliasOf: prepared.customerRef, familyId: prepared.familyId, createdAt: this.now(), lastEventAt: 0, lastEventSeq: null, lastEventId: null, pending: [] }); // the provider's customer is this family's regardless: a payment on the late session is attributed
        return { late: same ? null : result.providerCheckoutRef || null, answer: same && intent.status === 'pending' ? intent.result : closed };
      }
      if (alias && alias.familyId !== prepared.familyId) fail(409, 'PROVIDER_CUSTOMER_CONFLICT'); // NO_TRANSFER: the provider's id can belong to one family only
      tx.set(path, { ...intent, status: 'pending', providerCheckoutRef: result.providerCheckoutRef || null, providerCustomerId: providerId, result });
      if (aliasPath && !alias) tx.set(aliasPath, { provider: gw.name, customerRef: providerId, aliasOf: prepared.customerRef, familyId: prepared.familyId, createdAt: this.now(), lastEventAt: 0, lastEventSeq: null, lastEventId: null, pending: [] });
      if (providerId && family && family.providerCustomer?.[gw.name] !== providerId) tx.set(`families/${prepared.familyId}`, { ...family, providerCustomer: { ...(family.providerCustomer || {}), [gw.name]: providerId } });
      return { answer: result };
    });
    if (finished.late && typeof gw.cancelCheckout === 'function') { try { await gw.cancelCheckout(finished.late); } catch { /* the inbox refuses its completion regardless */ } }
    return finished.answer;
  }
  /**
   * Parent action: cancel at the period end, or undo it — at the provider first (Stage 4.2), so
   * its next invoice agrees with the family's record, then in the machine. The machine must accept
   * the transition before the provider is told; a replayed operation tells the provider nothing; a
   * provider failure changes nothing here. A trial, or a subscription the operator granted, has no
   * provider side.
   */
  async cancel(ctx, body) {
    object(body, ['undo', 'operationId']); const eventId = this.billing.eventId(body), undo = body.undo === true;
    const prepared = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true), now = this.now();
      const sub = family.subscription; if (!sub) fail(409, 'NO_SUBSCRIPTION');
      if (await tx.get(`families/${s.familyId}/billing/${eventId}`)) return { replay: true }; // commit() answers a replay (or a conflict) itself
      transition(sub, { type: undo ? 'cancel.undo' : 'cancel.request' }, now); // refused here, the provider is never asked
      const gw = Object.hasOwn(this.gateways, sub.provider || '') ? this.gateways[sub.provider] : null, customerRef = family.billing?.[sub.provider] || null;
      // A paused subscription has no period left to end: its cancellation is an ending now, at the provider too, so no invoice
      // can ever be raised for it again (the machine ends it in the same way — subscription.mjs cancel.request).
      const paused = !undo && deriveState(sub, now) === 'paused';
      const able = gw && sub.plan !== 'trial' && !!customerRef && typeof gw[paused ? 'cancelSubscription' : 'setCancelAtPeriodEnd'] === 'function';
      return { provider: able ? sub.provider : null, paused, customerRef, customerId: family.providerCustomer?.[sub.provider] || null, subscriptionRef: sub.providerSubscriptionRef || null, familyId: s.familyId };
    }, { readOnly: true });
    if (prepared.provider) {
      const gw = this.gateways[prepared.provider], args = { idempotencyKey: eventId, customerRef: prepared.customerRef, customerId: prepared.customerId, subscriptionRef: prepared.subscriptionRef };
      try { await (prepared.paused ? gw.cancelSubscription(args) : gw.setCancelAtPeriodEnd({ ...args, cancel: !undo })); }
      catch (error) { if (error instanceof Fault && PROVIDER_REFUSALS.has(error.code)) await this.refuse(prepared.familyId, error.code); throw error; }
    }
    return this.billing.cancel(ctx, body);
  }
  /**
   * Parent action (the leaving flow): pause collection for 1, 2 or 3 months instead of leaving. The provider hears it first, so
   * its next invoice is never raised — a pause that the record held but the provider did not would charge for a month the family
   * was told it would not be charged for. The machine must accept the transition before the provider is asked; a replayed
   * operation tells the provider nothing; a provider failure changes nothing here, and the parent's retry under the same
   * operation id reaches the provider under the same idempotency key, so nothing is ever paused twice. A crash between the
   * provider and the record leaves the provider paused and the record not: the parent's retry finishes it, and so does the
   * provider's own echo (customer.subscription.updated → pause.start), which is also what reconciles a late or out-of-order one.
   */
  async pause(ctx, body) {
    object(body, ['months', 'operationId']); const eventId = this.billing.eventId(body);
    if (!PAUSE_MONTHS.includes(body.months)) fail(400, 'INVALID_MONTHS');
    const prepared = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true), now = this.now();
      const sub = family.subscription; if (!sub) fail(409, 'NO_SUBSCRIPTION');
      if (await tx.get(`families/${s.familyId}/billing/${eventId}`)) return { replay: true }; // commit() answers a replay (or a conflict) itself
      const next = transition(sub, { type: 'pause.start', months: body.months, by: 'parent' }, now); // refused here, the provider is never asked
      const gw = Object.hasOwn(this.gateways, sub.provider || '') ? this.gateways[sub.provider] : null, customerRef = family.billing?.[sub.provider] || null;
      return { provider: gw && typeof gw.pauseCollection === 'function' && sub.plan !== 'trial' && customerRef ? sub.provider : null, customerRef, customerId: family.providerCustomer?.[sub.provider] || null,
        subscriptionRef: sub.providerSubscriptionRef || null, familyId: s.familyId, resumesAt: next.pause.resumesAt };
    }, { readOnly: true });
    if (prepared.provider) {
      try { await this.gateways[prepared.provider].pauseCollection({ idempotencyKey: eventId, customerRef: prepared.customerRef, customerId: prepared.customerId, subscriptionRef: prepared.subscriptionRef, resumesAt: prepared.resumesAt }); }
      catch (error) { if (error instanceof Fault && PROVIDER_REFUSALS.has(error.code)) await this.refuse(prepared.familyId, error.code); throw error; }
    }
    return this.billing.pause(ctx, body);
  }
  /** Parent action: end the pause early. The provider first again, so the invoice it raises next is the one that brings the family back. */
  async resume(ctx, body) {
    object(body, ['operationId']); const eventId = this.billing.eventId(body);
    const prepared = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true);
      const sub = family.subscription; if (!sub) fail(409, 'NO_SUBSCRIPTION');
      if (await tx.get(`families/${s.familyId}/billing/${eventId}`)) return { replay: true };
      if (!sub.pause) fail(409, 'NOT_PAUSED');
      const gw = Object.hasOwn(this.gateways, sub.provider || '') ? this.gateways[sub.provider] : null, customerRef = family.billing?.[sub.provider] || null;
      return { provider: gw && typeof gw.resumeCollection === 'function' && sub.plan !== 'trial' && customerRef ? sub.provider : null, customerRef, customerId: family.providerCustomer?.[sub.provider] || null,
        subscriptionRef: sub.providerSubscriptionRef || null, familyId: s.familyId };
    }, { readOnly: true });
    if (prepared.provider) {
      try { await this.gateways[prepared.provider].resumeCollection({ idempotencyKey: eventId, customerRef: prepared.customerRef, customerId: prepared.customerId, subscriptionRef: prepared.subscriptionRef }); }
      catch (error) { if (error instanceof Fault && PROVIDER_REFUSALS.has(error.code)) await this.refuse(prepared.familyId, error.code); throw error; }
    }
    return this.billing.resume(ctx, body);
  }
  /**
   * A deterministic refusal on the provider's truth — two live subscriptions, one the family does not know, a checkout completing,
   * a subscription the provider cannot find — is not a fault to retry into silence: the family is marked (`providerAttention`), an
   * audit row says so, the nightly sweep names it until `reconcile-provider` finds the provider clean, and the caller gets a 409.
   */
  async refuse(familyId, code) {
    await this.store.transaction(async (tx) => {
      const family = familyId ? await tx.get(`families/${familyId}`) : null;
      if (family && family.deleted !== true && family.deletion?.status !== 'executing') tx.set(`families/${familyId}`, { ...family, providerAttention: { code, at: this.now() } }); // a tombstone carries no mark
      this.audit(tx, 'billing.refused', `provider:${this.provider}`, familyId, { code });
    });
    fail(409, code);
  }
  /** The checkout of this family the provider names on its live subscription: it reached the provider (a session) and is not complete — the one completing, whichever click superseded it. */
  async namedCheckout(gw, familyId, liveCheckoutId) {
    if (!liveCheckoutId) return null;
    const c = await this.store.get(`checkouts/${gw.name}:${liveCheckoutId}`);
    return c && c.familyId === familyId && !!(c.providerCheckoutRef || c.lateSessionRef) && ['superseded', 'pending', 'creating'].includes(c.status) ? c : null;
  }
  /**
   * The named checkout is completing at the provider: it is reinstated as the family's live checkout, this attempt closed, and a
   * completion of it the inbox rejected while it was superseded is queued and processed again — never left as a rejection nobody
   * reads; when that completion applies here the family is paid, and the click is answered as a paid family's would be. On a
   * family being deleted nothing is reinstated: the freeze owns the checkouts, the rejected completion becomes the operator's, and
   * the refusal says so.
   */
  async reinstate(gw, prepared, checkoutId, path, named) {
    const done = await this.store.transaction(async (tx) => {
      const mine = await tx.get(path), family = await tx.get(`families/${prepared.familyId}`), olderPath = `checkouts/${gw.name}:${named.checkoutId}`, older = await tx.get(olderPath), now = this.now();
      const gone = !family || family.deleted === true || family.deletion?.status === 'executing';
      const rejected = (await tx.query('billingEvents', 'checkoutRef', named.checkoutId, 20)).map(([id, r]) => [id, r]).filter(([, r]) => r.outcome?.status === 'rejected' && r.outcome?.reason === 'CHECKOUT_SUPERSEDED');
      if (gone) { for (const [id, r] of rejected) tx.set(`billingEvents/${id}`, { ...r, outcome: { status: 'reconciliation_required', reason: 'FAMILY_DELETED', was: r.outcome } }); return { deleted: true }; }
      const mappings = new Map(); for (const [, r] of rejected) { const mp = `billingCustomers/${gw.name}:${r.customer}`; if (!mappings.has(mp)) mappings.set(mp, await tx.get(mp)); }
      if (mine && mine.status === 'creating') tx.set(path, { ...mine, status: 'superseded', supersededBy: named.checkoutId, supersededAt: now, closedReason: 'CHECKOUT_COMPLETING' });
      if (older && ['superseded', 'pending', 'creating'].includes(older.status)) {
        if (older.status === 'superseded') tx.set(olderPath, { ...older, status: 'pending', supersededBy: null, supersededAt: null, reinstatedAt: now });
        if (family.checkoutIntent?.[gw.name] !== named.checkoutId) tx.set(`families/${prepared.familyId}`, { ...family, checkoutIntent: { ...(family.checkoutIntent || {}), [gw.name]: named.checkoutId } });
      }
      let requeued = 0;
      for (const [mp, m] of mappings) { if (!m) continue; const ids = rejected.filter(([, r]) => `billingCustomers/${gw.name}:${r.customer}` === mp).map(([, r]) => r.providerEventId).filter((id) => !(m.pending || []).includes(id)); if (ids.length) { tx.set(mp, { ...m, pending: [...(m.pending || []), ...ids] }); requeued += ids.length; } }
      return { deleted: false, requeued };
    });
    if (done.deleted) fail(409, 'FAMILY_DELETED');
    if (done.requeued) {
      const results = await this.reprocessFamily(gw.name, prepared.familyId); // the completion that landed while the checkout was superseded applies now
      if (results.some((r) => r.status === 'applied' && !r.replayed && r.type === 'checkout.completed')) fail(409, 'USE_PLAN_CHANGE'); // paid: the click is a paid family's click
    }
    await this.refuse(prepared.familyId, 'CHECKOUT_COMPLETING');
  }
  /** A family's deletion ends the provider's subscription. Best effort, never throws for a provider fault: the outcome is recorded and the report flags a subscription left live. */
  async cancelAtProvider(family, idempotencyKey) {
    const name = family.subscription?.provider || null, gw = name && Object.hasOwn(this.gateways, name) ? this.gateways[name] : null, customerRef = name ? family.billing?.[name] || null : null;
    if (!gw || typeof gw.cancelSubscription !== 'function' || family.subscription.plan === 'trial' || !customerRef) return { provider: name, status: 'not_applicable', at: this.now() };
    try { const r = await gw.cancelSubscription({ idempotencyKey, customerRef, customerId: family.providerCustomer?.[name] || null, subscriptionRef: family.subscription.providerSubscriptionRef || null }); return { provider: name, status: r.cancelled ? 'cancelled' : r.reason === 'ANOTHER_SUBSCRIPTION_LIVE' ? 'failed' : 'none', already: r.already === true, providerOperationRef: r.providerOperationRef || null, reason: r.reason || null, simulated: r.simulated === true, at: this.now() }; }
    catch (error) { if (!(error instanceof Fault)) throw error; return { provider: name, status: 'failed', reason: error.code, at: this.now() }; }
  }
  /** What the provider holds for a customer reference (Stage 4.2 reconciliation). A provider fault is a value, not an exception. */
  async providerState(provider, customerRef, customerId = null) {
    const gw = Object.hasOwn(this.gateways, provider) ? this.gateways[provider] : null;
    if (!gw || typeof gw.inspect !== 'function') return { provider, available: false };
    try { return { provider, available: true, ...(await gw.inspect(customerRef, { customerId })) }; }
    catch (error) { if (!(error instanceof Fault)) throw error; return { provider, available: true, error: error.code, detail: error.provider || null }; }
  }
  /**
   * Parent action (3.4): change plan, through a durable change intent
   * billingChangeIntents/{provider}:{operationId} (review S3.4, the S3.3-A pattern generalised):
   *   intent { family, subscription version, from, to, seat choice, kind, fingerprint, status }
   *   → upgrade: the provider is asked for the prorated difference with the operation id as its
   *     idempotency key, one such call in flight per family (CHANGE_IN_PROGRESS); then, only if the
   *     subscription version is unchanged, plan.change commits and the intent is `applied` —
   *     otherwise the intent is `stale` and the parent is told the subscription moved
   *     (SUBSCRIPTION_CHANGED). A crash between intent and finalisation resumes with the same key.
   *   → downgrade / clear: scheduled (plan.schedule) and the intent applied in one transaction.
   * Same operation id + same fingerprint (plan and seat choice) → replay; different → conflict (S3.4-A).
   * Up: only while `active` — in grace the renewal comes first (RENEWAL_REQUIRED). A seat list on an
   * upgrade may add children but never omit a seated one (SEATS_CANNOT_REMOVE, S3.4-B). Down: at the
   * period end with the parent's seat choice — nobody loses a seat mid-cycle. A trial becomes paid
   * through a checkout, never a plan change. Afterwards, provider events that were waiting on this
   * choice are reprocessed by the server itself (S3.4-D).
   */
  async changePlan(ctx, body) {
    object(body, ['plan', 'seatChildIds', 'operationId']);
    const plan = typeof body.plan === 'string' ? PLANS[body.plan] : null;
    if (!plan || !plan.purchasable) fail(400, 'INVALID_PLAN');
    if (body.seatChildIds !== undefined) { if (!Array.isArray(body.seatChildIds)) fail(400, 'INVALID_SEAT_SELECTION'); for (const id of body.seatChildIds) uuid(id); }
    const operationId = this.billing.eventId(body), gw = this.gateway(this.provider), path = `billingChangeIntents/${gw.name}:${operationId}`;
    const seatIds = body.seatChildIds ? [...new Set(body.seatChildIds)] : null; // the parent's order is the seating order; the fingerprint is order-free
    const fingerprint = sha256(JSON.stringify({ action: 'plan', provider: gw.name, plan: plan.id, seatChildIds: seatIds ? [...seatIds].sort() : null }));
    const prepared = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true), now = this.now();
      const intent = await tx.get(path);
      if (intent) {
        if (intent.familyId !== s.familyId || intent.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT'); // S3.4-A: the seat choice is part of the request
        if (intent.status === 'applied') return { done: intent.result, familyId: s.familyId };
        if (intent.status === 'awaiting_payment') return { done: { pending: true, kind: 'upgrade', plan: intent.toPlan, invoiceUrl: intent.proration?.invoiceUrl || null, state: deriveState(family.subscription, now) }, familyId: s.familyId }; // the provider holds it until its invoice is paid; the webhook finishes it
        if (intent.status !== 'creating') fail(409, 'SUBSCRIPTION_CHANGED'); // stale, superseded or reconciled: closed for good
        return { intent, familyId: s.familyId }; // creating: an earlier attempt stopped before finalising — resume with the same key
      }
      const sub = family.subscription; if (!sub) fail(409, 'NO_SUBSCRIPTION');
      const state = deriveState(sub, now);
      if (state === 'trial') fail(409, 'CHECKOUT_REQUIRED');
      if (!['active', 'grace'].includes(state)) fail(409, 'INVALID_TRANSITION');
      const kind = plan.id === sub.plan ? 'clear' : plan.seats > sub.seats ? 'upgrade' : 'downgrade';
      const record = { provider: gw.name, operationId, familyId: s.familyId, uid: s.uid, customerRef: family.billing?.[gw.name] || null, customerId: family.providerCustomer?.[gw.name] || null, subscriptionRef: sub.providerSubscriptionRef || null, subscriptionVersion: sub.version, fromPlan: sub.plan, toPlan: plan.id,
        seatChildIds: seatIds, kind, fingerprint, periodStart: sub.lastPaymentAt || sub.startedAt || now, periodEnd: sub.periodEnd || null, status: 'creating', proration: null, providerOperationRef: null, result: null, createdAt: now }; // no expireAt: financial recovery evidence (S3.4-G)
      if (kind === 'downgrade') assignSeats(family, plan.seats, seatIds ?? undefined); // the choice must be complete now, although it applies at renewal
      // Stage 4.2: a scheduled change reaches the provider too — its next invoice must carry the new price, or a
      // renewal on the old one would silently drop the schedule. Nothing to tell it when nothing is scheduled.
      const providerCall = kind === 'upgrade' || (typeof gw.schedulePlan === 'function' && sub.provider === gw.name && !!record.customerRef && (kind === 'downgrade' || !!sub.scheduled));
      if (!providerCall) { // no provider involved: schedule (or clear) and record the intent in this one transaction
        const event = { id: operationId, type: 'plan.schedule', plan: plan.id, ...(seatIds ? { seatChildIds: seatIds } : {}) };
        const result = { ...(await this.billing.commit(tx, s.familyId, family, event, s.uid, now)), kind, proration: null };
        tx.set(path, { ...record, status: 'applied', result });
        return { done: result, familyId: s.familyId };
      }
      if (kind === 'upgrade') {
        if (state !== 'active') fail(409, 'RENEWAL_REQUIRED'); // in grace the renewal comes first; the larger plan can be scheduled into it, not granted for free
        if (seatIds && (family.activeChildIds || []).some((id) => !seatIds.includes(id))) fail(409, 'SEATS_CANNOT_REMOVE'); // S3.4-B: an upgrade may add, never drop a seated child
        if (seatIds) assignSeats(family, plan.seats, seatIds); // members and capacity checked now
      }
      const inflight = family.billingIntent;
      if (inflight && inflight.operationId !== operationId && inflight.at > now - this.inflightMs) fail(409, 'CHANGE_IN_PROGRESS'); // one provider call in flight per family
      // S3.4-F: taking over an abandoned marker supersedes that intent in the same transaction, so it can never finalise later
      const abandoned = inflight && inflight.operationId !== operationId ? await tx.get(`billingChangeIntents/${gw.name}:${inflight.operationId}`) : null;
      // an upgrade the provider holds until its invoice is paid is not abandoned: no second change while that payment can still land
      if (abandoned && abandoned.status === 'awaiting_payment' && abandoned.awaitingSince > now - AWAITING_PAYMENT_MS) fail(409, 'PAYMENT_PENDING');
      if (abandoned && (abandoned.status === 'creating' || abandoned.status === 'awaiting_payment')) tx.set(`billingChangeIntents/${gw.name}:${inflight.operationId}`, { ...abandoned, status: 'superseded', supersededBy: operationId, supersededAt: now });
      tx.set(`families/${s.familyId}`, { ...family, billingIntent: { operationId, at: now } });
      tx.set(path, record);
      return { intent: record, familyId: s.familyId };
    });
    if (prepared.done) { await this.reprocessFamily(gw.name, prepared.familyId); return prepared.done; }
    const intent = prepared.intent, up = intent.kind === 'upgrade';
    let proration;
    try {
      proration = up
        ? await gw.changePlan({ idempotencyKey: operationId, customerRef: intent.customerRef, customerId: intent.customerId || null, subscriptionRef: intent.subscriptionRef || null, from: intent.fromPlan, to: intent.toPlan, periodStart: intent.periodStart, periodEnd: intent.periodEnd, now: this.now() })
        : await gw.schedulePlan({ idempotencyKey: operationId, customerRef: intent.customerRef, customerId: intent.customerId || null, subscriptionRef: intent.subscriptionRef || null, to: intent.kind === 'clear' ? intent.fromPlan : intent.toPlan }); // the price the next invoice must carry
    } catch (error) {
      if (error instanceof Fault && PROVIDER_REFUSALS.has(error.code)) { // deterministic: the intent closes and the marker is released — a retry after the operator has resolved it starts afresh
        await this.store.transaction(async (tx) => {
          const current = await tx.get(path), family = await tx.get(`families/${intent.familyId}`);
          if (current && current.status === 'creating') tx.set(path, { ...current, status: 'stale', staleReason: error.code, staleAt: this.now() });
          if (family && family.billingIntent?.operationId === operationId) tx.set(`families/${intent.familyId}`, { ...family, billingIntent: null });
        });
        await this.refuse(intent.familyId, error.code);
      }
      throw error;
    }
    // the provider's answer is on the record before anything else can fail: a finalisation refused below (the session revoked
    // meanwhile, the deletion freeze landing) must never lose a proration the provider charged (fifth round)
    // ...whatever the intent's status meanwhile (the deletion freeze, a takeover): money the provider moved is on the record that asked for it.
    // Recorded once: an answer already on the record is the one the finalisation applies — a provider's replay may differ from it.
    const recorded = await this.store.transaction(async (tx) => {
      const current = await tx.get(path); if (!current) return null;
      if (current.providerAnsweredAt) return { answered: true, proration: current.proration, providerOperationRef: current.providerOperationRef || null };
      if (!['applied', 'awaiting_payment'].includes(current.status)) tx.set(path, { ...current, providerAnsweredAt: this.now(), providerOperationRef: proration?.providerOperationRef || null, proration: up ? proration : null });
      return { answered: false };
    });
    let opRef = proration?.providerOperationRef || null;
    if (recorded?.answered) { opRef = recorded.providerOperationRef; if (up && recorded.proration) proration = recorded.proration; }
    const finished = await this.store.transaction(async (tx) => {
      const { s, family } = await this.billing.parent(tx, ctx, true);
      const current = await tx.get(path);
      if (!current || current.status === 'applied') return { result: current?.result ?? null };
      // a held upgrade answers the same to every attempt of its operation: the second of two concurrent attempts finds the first's finalisation, not a change
      if (current.status === 'awaiting_payment') return { result: { pending: true, kind: 'upgrade', plan: current.toPlan, invoiceUrl: current.proration?.invoiceUrl || null, state: deriveState(family.subscription, this.now()) } };
      if (current.status !== 'creating') return { stale: true }; // stale, superseded or reconciled by an operator meanwhile
      const mine = family.billingIntent?.operationId === operationId;
      if (!mine || (family.subscription?.version ?? null) !== current.subscriptionVersion) {
        // the subscription moved, or another change took this one over, while the provider was being asked:
        // never finalise against old facts, and never touch a marker that is not ours (S3.4-F)
        tx.set(path, { ...current, status: 'stale', proration: up ? proration : null, providerOperationRef: opRef });
        if (mine) tx.set(`families/${s.familyId}`, { ...family, billingIntent: null });
        return { stale: true };
      }
      if (up && (proration.pending === true || proration.applied === false)) {
        // Stage 4 review: the provider accepted the change but holds it until its proration invoice is paid (pending_if_incomplete).
        // Nothing changes here — the seats stay as they are — until the payment of the invoice recorded here (`proration.invoiceRef`)
        // arrives as invoice.paid (process()); no other invoice completes this intent.
        // The in-flight marker stays, so no second change starts while that payment can still land.
        tx.set(path, { ...current, status: 'awaiting_payment', proration, providerOperationRef: opRef, awaitingSince: this.now() });
        this.audit(tx, 'billing.upgrade_awaiting_payment', s.uid, s.familyId);
        return { result: { pending: true, kind: 'upgrade', plan: plan.id, invoiceUrl: proration.invoiceUrl || null, state: deriveState(family.subscription, this.now()) } };
      }
      const event = up
        ? { id: operationId, type: 'plan.change', plan: plan.id, provider: gw.name, providerRef: intent.customerRef, proration, ...(intent.seatChildIds ? { seatChildIds: intent.seatChildIds } : {}) }
        : { id: operationId, type: 'plan.schedule', plan: plan.id, ...(intent.seatChildIds ? { seatChildIds: intent.seatChildIds } : {}) };
      const result = { ...(await this.billing.commit(tx, s.familyId, { ...family, billingIntent: null }, event, s.uid, this.now())), kind: intent.kind, proration: up ? proration : null };
      tx.set(path, { ...current, status: 'applied', proration: up ? proration : null, providerOperationRef: opRef, result }); // the provider's reference is kept for reconciliation (Stage 4)
      return { result };
    });
    if (finished.stale) fail(409, 'SUBSCRIPTION_CHANGED');
    await this.reprocessFamily(gw.name, prepared.familyId);
    return finished.result;
  }
  /**
   * A provider webhook. Authenticate (MAC over raw bytes, timestamp window), normalize, then in
   * one transaction: replay check against the global inbox, resolve the family through the
   * customer mapping, apply through the same commit() every other billing event uses, and record
   * the outcome. A rejected or ignored event is recorded too and acknowledged, so the provider
   * stops retrying and an operator can see exactly what arrived. An event that waits on a
   * server-side action (the parent's seat choice, a checkout completing) is `requires_action`
   * and is reprocessed by this server when that action happens (S3.4-D) — never by hoping the
   * provider redelivers an acknowledged event.
   */
  async receive(providerName, rawBody, headers) {
    const gw = this.gateway(providerName);
    if (!Buffer.isBuffer(rawBody)) fail(400, 'INVALID_REQUEST');
    if (rawBody.length > WEBHOOK_BODY_LIMIT) fail(413, 'REQUEST_TOO_LARGE');
    const now = this.now(), ev = await gw.verify(rawBody, headers, now); // a real adapter may fetch provider state here
    // a real adapter fingerprints the provider's event itself (id, type, time, object); the fake one has nothing but the event
    const outcome = await this.process(gw, ev, ev.fingerprint || sha256(JSON.stringify(ev)), now);
    if (outcome.status === 'applied' && !outcome.replayed && ev.type === 'checkout.completed') { // an early invoice, a refund of the new subscription, was waiting for this — under any of the family's references
      const mapping = await this.store.get(`billingCustomers/${gw.name}:${ev.customer}`);
      if (mapping?.familyId) await this.reprocessFamily(gw.name, mapping.familyId); else await this.reprocess(gw.name, ev.customer);
    }
    return outcome;
  }
  /** Every reference the provider may have pended events under for this family: ours, the ids the provider assigned (Stripe's cus_…, S3.4-D — third-round review), and the ones it assigned before (a customer replaced after a deletion). */
  async reprocessFamily(providerName, familyId) {
    const family = familyId ? await this.store.get(`families/${familyId}`) : null;
    const mapped = familyId ? (await this.store.query('billingCustomers', 'familyId', familyId, 50)).map(([, m]) => m).filter((m) => m.provider === providerName).map((m) => m.customerRef) : [];
    const refs = [...new Set([family?.billing?.[providerName], family?.providerCustomer?.[providerName], ...mapped].filter(Boolean))];
    const results = []; for (const ref of refs) results.push(...(await this.reprocess(providerName, ref))); return results;
  }
  /**
   * Events recorded `requires_action` for this customer, reprocessed by the server in provider order. Idempotent; safe to call any
   * time (3.5 tooling). A completion applied in a pass lets what waited on it (a refund of the new subscription, delivered the same
   * second) apply in the next.
   */
  async reprocess(providerName, customerRef) {
    const gw = this.gateway(providerName), results = [];
    for (let pass = 0, again = true; again && pass < 3; pass++) {
      const mapping = await this.store.get(`billingCustomers/${gw.name}:${customerRef}`), records = [];
      for (const id of mapping?.pending || []) { const rec = await this.store.get(`billingEvents/${gw.name}:${id}`); if (rec) records.push(rec); }
      records.sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));
      again = false;
      for (const rec of records) {
        const ev = { id: rec.providerEventId, type: rec.type, at: rec.at, seq: rec.seq ?? null, customer: rec.customer, data: rec.data };
        const outcome = await this.process(gw, ev, rec.fingerprint, this.now());
        results.push({ id: rec.providerEventId, type: rec.type, ...outcome });
        if (outcome.status === 'applied' && !outcome.replayed && rec.type === 'checkout.completed') again = true;
      }
    }
    return results;
  }
  /** One normalized event through the inbox, the customer mapping and the state machine, in one transaction. */
  async process(gw, ev, fingerprint, now) {
    const inboxPath = `billingEvents/${gw.name}:${ev.id}`, internalType = PROVIDER_EVENTS[ev.type] || null;
    return this.store.transaction(async (tx) => {
      const seen = await tx.get(inboxPath);
      if (seen) {
        if (seen.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT');
        // an event that applied nothing — rejected, or waiting on a server-side action — is processed again; anything else is a replay
        if (!['rejected', 'requires_action'].includes(seen.outcome.status)) return { ...seen.outcome, replayed: true };
      }
      const mappingPath = `billingCustomers/${gw.name}:${ev.customer}`, mapping = await tx.get(mappingPath);
      const familyId = mapping?.familyId || null;
      const checkoutPath = ev.data.checkoutId ? `checkouts/${gw.name}:${ev.data.checkoutId}` : null;
      const checkout = checkoutPath ? await tx.get(checkoutPath) : null; // read now: commit() writes next
      const plan = ev.data.price ? gw.planFor(ev.data.price) : null; // the provider's price id through the gateway's table; the payload never names a plan
      // Stage 4 review: an upgrade the provider held until its invoice was paid completes here — from the payment of *that* invoice,
      // the one the intent recorded when the provider answered `pending`, never from another paid invoice that happens to name
      // this customer (second round: bound by the invoice reference, not by family and target plan)
      const awaiting = familyId && ev.type === 'invoice.paid' && typeof ev.data.ref === 'string' ? (await tx.query('billingChangeIntents', 'familyId', familyId, 100)).map(([, i]) => i).find((i) => i.provider === gw.name && i.status === 'awaiting_payment' && i.proration?.invoiceRef === ev.data.ref) || null : null;
      // a real provider sends one event per refund object; the same refund delivered under a second event id must not be counted twice
      const duplicateRefund = internalType === 'refund' && ev.data.ref ? (await tx.query('billingEvents', 'refundRef', ev.data.ref, 5)).some(([id, r]) => id !== `${gw.name}:${ev.id}` && r.outcome?.status === 'applied') : false;
      // S3.3-C ordering: older timestamp, or the same timestamp with a lower adapter sequence, is stale.
      const older = mapping && (ev.at < mapping.lastEventAt || (ev.at === mapping.lastEventAt && ev.seq !== null && mapping.lastEventSeq != null && ev.seq < mapping.lastEventSeq));
      // a refund or a dispute is money that went back, not a snapshot of state: delivered after a newer renewal it still counts (its own id dedupes it)
      const stale = older && internalType !== 'refund';
      const family = familyId ? await tx.get(`families/${familyId}`) : null;
      // the family's live checkout, when a refund names a subscription the record does not: it may be the new subscription's, refunded
      // before its completion landed — it waits while that checkout can still complete (a hosted session lives a day)
      const liveId = family?.checkoutIntent?.[gw.name] || null, live = liveId && liveId !== ev.data.checkoutId ? await tx.get(`checkouts/${gw.name}:${liveId}`) : liveId ? checkout : null;
      const canComplete = !!live && ['creating', 'pending'].includes(live.status) && live.createdAt > now - CHECKOUT_WAIT_MS;
      // an event about another subscription of the same customer — the one a fresh checkout replaced, still winding down at the
      // provider — is not this family's (Stage 4 review, third round); a completed checkout is the moment the subscription changes
      const other = !!ev.data.subscriptionRef && !!family?.subscription?.providerSubscriptionRef && ev.type !== 'checkout.completed' && family.subscription.providerSubscriptionRef !== ev.data.subscriptionRef;
      const unnamed = !!ev.data.subscriptionRef && ev.type !== 'checkout.completed' && (family?.subscription?.providerSubscriptionRef ?? null) !== ev.data.subscriptionRef; // named by nobody's record yet: a record that names none (a first checkout, a trial) included
      let outcome;
      if (ev.type === 'checkout.payment_pending') {
        // a session completed with a payment still clearing (a bank debit): nothing is granted, but the checkout remembers it so a later
        // click never supersedes it and the deletion can end what it made; the provider's async success is the completion (fifth round).
        // Remembered on a checkout superseded meanwhile too (a second click's window): the mark travels with its reinstatement.
        if (checkout && checkout.familyId === familyId && ev.data.subscriptionRef && ['creating', 'pending', 'superseded'].includes(checkout.status) && !checkout.paymentPending) tx.set(checkoutPath, { ...checkout, paymentPending: { eventId: ev.id, subscriptionRef: ev.data.subscriptionRef, status: ev.data.ref || null, at: ev.at } });
        outcome = { status: 'ignored', reason: 'PAYMENT_PENDING' };
      }
      else if (ev.type === 'checkout.payment_failed') {
        // the debit failed: the provider ends the subscription it made; the checkout is released so the next click starts afresh
        if (checkout && checkout.familyId === familyId && checkout.paymentPending) tx.set(checkoutPath, { ...checkout, paymentPending: null, paymentFailed: { eventId: ev.id, subscriptionRef: ev.data.subscriptionRef || checkout.paymentPending.subscriptionRef || null, was: checkout.paymentPending, at: ev.at } });
        outcome = { status: 'ignored', reason: 'PAYMENT_FAILED' };
      }
      else if (!internalType) outcome = { status: 'ignored', reason: 'UNSUPPORTED_EVENT' };
      else if (!mapping) outcome = { status: 'rejected', reason: 'UNKNOWN_CUSTOMER' };
      else if (ev.data.familyId && ev.data.familyId !== familyId) outcome = { status: 'rejected', reason: 'FAMILY_MISMATCH' };
      // checkout.completed means exactly that: the completion of a checkout this server opened
      else if (ev.type === 'checkout.completed' && !ev.data.checkoutId) outcome = { status: 'rejected', reason: 'CHECKOUT_REQUIRED' };
      else if (ev.type === 'checkout.completed' && !checkout) outcome = { status: 'rejected', reason: 'UNKNOWN_CHECKOUT' };
      else if (checkout && checkout.familyId !== familyId) outcome = { status: 'rejected', reason: 'CHECKOUT_MISMATCH' };
      else if (internalType === 'payment.succeeded' && !plan) outcome = { status: 'rejected', reason: 'UNKNOWN_PRICE' };
      else if (awaiting && plan !== awaiting.toPlan) outcome = { status: 'rejected', reason: 'UPGRADE_PLAN_MISMATCH' }; // the provider holds a price other than the plan this intent asked for: the operator decides
      else if (checkout && plan && checkout.plan !== plan) outcome = { status: 'rejected', reason: 'CHECKOUT_MISMATCH' }; // paid for a different plan than the one this checkout was opened for
      else if (ev.type === 'checkout.completed' && checkout.status === 'completed') outcome = { status: 'rejected', reason: 'CHECKOUT_ALREADY_COMPLETED' };
      else if (ev.type === 'checkout.completed' && checkout.status === 'superseded_by_deletion') outcome = { status: 'reconciliation_required', reason: 'FAMILY_DELETED' }; // paid on a session the deletion superseded: a live subscription for a deleted family, for the operator (fifth round)
      else if (ev.type === 'checkout.completed' && checkout.status === 'superseded' && (family?.deleted === true || family?.deletion?.status === 'executing')) outcome = { status: 'reconciliation_required', reason: 'FAMILY_DELETED' }; // a live subscription for a deleted family: the operator's, never a rejection nobody reads
      else if (ev.type === 'checkout.completed' && checkout.status === 'superseded') outcome = { status: 'rejected', reason: 'CHECKOUT_SUPERSEDED' }; // a newer checkout replaced it: no double transition (reinstate() queues it again when that checkout turns out to be completing)
      else if (duplicateRefund) outcome = { status: 'ignored', reason: 'DUPLICATE_REFUND' };
      // a refund of a subscription the record does not name yet, while a checkout of this family is still pending: it may be the new
      // subscription's, refunded before its completion landed — it waits on the customer mapping and is processed again after the
      // completion (an old subscription's refund is then ignored as OTHER_SUBSCRIPTION); never granted access on a refunded charge
      else if (unnamed && internalType === 'refund' && canComplete) outcome = { status: 'requires_action', reason: 'CHECKOUT_PENDING' };
      else if (other) outcome = { status: 'ignored', reason: 'OTHER_SUBSCRIPTION' }; // recorded for the operator; the family's own subscription is untouched
      else if (stale) outcome = { status: 'ignored', reason: 'STALE_EVENT' }; // an older event arriving after a newer one never rolls the facts back
      else {
        if (!family) outcome = { status: 'rejected', reason: 'FAMILY_NOT_FOUND' };
        // A deleted family (or one being deleted) is recorded for support and Stage 4 reconciliation — a refund, a cancellation at the provider — and never regains product entitlement.
        else if (family.deleted === true || family.deletion?.status === 'executing') outcome = { status: 'reconciliation_required', reason: 'FAMILY_DELETED' };
        else {
          // Only a bound checkout carries an intent to be on a plan; a renewal invoice never does (S3.3-B). The paid proration
          // invoice of a held upgrade is that upgrade's own transition — plan.change, as when the card was charged on the spot —
          // not a payment.succeeded: what the parent decided meanwhile (a cancellation at the period end) stands, the period is
          // not renewed by it, and a subscription that has since ended is not revived (Stage 4 review, second round).
          const event = awaiting
            // a child seated while the upgrade waited (a free seat, a new profile) keeps the seat: the list is the union, never a removal
            ? { id: derivedEventId(`${gw.name}:${ev.id}`), type: 'plan.change', plan: awaiting.toPlan, provider: gw.name, providerRef: ev.customer, proration: awaiting.proration || null, ...(awaiting.seatChildIds ? { seatChildIds: [...new Set([...awaiting.seatChildIds, ...(family.activeChildIds || [])])] } : {}) }
            : { id: derivedEventId(`${gw.name}:${ev.id}`), type: internalType, provider: gw.name, providerRef: ev.customer, authorized: ev.type === 'checkout.completed',
              ...(plan ? { plan } : {}), ...(ev.data.periodEnd ? { periodEnd: ev.data.periodEnd } : {}), ...(ev.data.subscriptionRef ? { subscriptionRef: ev.data.subscriptionRef } : {}),
              // the provider is the authority on a pause: `by: 'provider'` lets the machine take its word for it and for when collection resumes
              ...(internalType === 'pause.start' || internalType === 'pause.end' ? { by: 'provider', ...(Number.isSafeInteger(ev.data.resumesAt) ? { resumesAt: ev.data.resumesAt } : {}) } : {}),
              ...(internalType === 'refund' ? { amountCents: ev.data.amountCents ?? undefined, full: ev.data.full === true } : {}) };
          try {
            let done = ev.type === 'checkout.completed' && family.checkoutIntent?.[gw.name] === checkout.checkoutId ? { ...family, checkoutIntent: { ...family.checkoutIntent, [gw.name]: null } } : family;
            if (awaiting && family.billingIntent?.operationId === awaiting.operationId) done = { ...done, billingIntent: null }; // the upgrade's marker is released with its payment
            const result = await this.billing.commit(tx, familyId, done, event, `webhook:${gw.name}`, now);
            if (awaiting) tx.set(`billingChangeIntents/${gw.name}:${awaiting.operationId}`, { ...awaiting, status: 'applied', appliedBy: ev.id, appliedAt: now, result: { ...result, kind: 'upgrade', proration: awaiting.proration || null } });
            outcome = { status: 'applied', state: result.state, eventId: event.id, ...(awaiting ? { upgrade: awaiting.operationId } : {}) };
          } catch (error) {
            if (!(error instanceof Fault)) throw error; // infrastructure: let the provider retry
            // the machine refused it: waiting on a server-side action it can resolve later, or a hard rejection for the operator
            outcome = { status: ACTIONABLE.has(error.code) ? 'requires_action' : 'rejected', reason: error.code };
          }
        }
      }
      if (mapping) {
        const before = mapping.pending || [], pending = before.filter((id) => id !== ev.id);
        if (outcome.status === 'requires_action') pending.push(ev.id);
        const next = { ...mapping, pending };
        if (outcome.status === 'applied' && !older && internalType !== 'refund') { next.lastEventAt = ev.at; next.lastEventSeq = ev.seq; next.lastEventId = ev.id; } // a refund is money back, not a state snapshot: it never moves the clock (an older one never back, a newer one never forward past a completion still on its way)
        if (outcome.status === 'applied' || pending.length !== before.length || outcome.status === 'requires_action') tx.set(mappingPath, next);
        if (outcome.status === 'applied' && checkout && ev.type === 'checkout.completed') tx.set(checkoutPath, { ...checkout, status: 'completed', completedAt: now, completedBy: ev.id, ...(checkout.paymentPending ? { paymentPending: { ...checkout.paymentPending, completedBy: ev.id } } : {}) }); // a `creating` intent whose session the provider did open is completed too
      }
      tx.set(inboxPath, { provider: gw.name, providerEventId: ev.id, type: ev.type, at: ev.at, seq: ev.seq ?? null, receivedAt: seen?.receivedAt ?? now, lastReceivedAt: now, attempts: (seen?.attempts || 0) + 1, customer: ev.customer, familyId, data: ev.data, refundRef: /^(refund|dispute)\./.test(ev.type) || internalType === 'refund' ? ev.data.ref || null : null, invoiceRef: ev.type.startsWith('invoice.') ? ev.data.ref || null : null, checkoutRef: ev.data.checkoutId || null, fingerprint, outcome });
      this.audit(tx, `webhook.${outcome.status}`, `webhook:${gw.name}`, familyId);
      return outcome;
    });
  }
}
