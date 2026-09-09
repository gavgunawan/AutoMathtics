// Stage 4.1 — the Stripe adapter behind the Stage 3 gateway contract (PAYMENTS.md → adapter contract).
//
// Everything the contract asks for, and nothing the inbox already does:
//   • createCheckout: a Stripe Customer per family (found by our reference in its metadata, else
//     created) and a hosted Checkout Session in subscription mode, both with our ids as Stripe
//     idempotency keys, so a retry returns the same objects (S3.3-A);
//   • cancelCheckout: a superseded session is expired at Stripe, so a stale hosted page cannot be paid;
//   • changePlan: the customer's live subscription moves to the new price with prorations invoiced now;
//   • verify: the `Stripe-Signature` header (t=…,v1=…; HMAC-SHA256 over "<t>.<raw body>", 5-minute
//     window, constant-time) checked before a byte is parsed, then the event normalized to the inbox
//     shape. The price id comes from the provider's own objects — the invoice's line, or, for a
//     completed checkout, the subscription fetched from Stripe — never from anything we authored. Stripe
//     offers no sequence number and second-resolution timestamps, so `seq` is null and the adapter
//     fetches state where order matters (S3.3-C).
// Secrets never leave this module: a provider error surfaces as PROVIDER_ERROR with Stripe's error
// code only. Test mode (sk_test_ / whsec_) costs nothing; that is how 4.2 runs.
import { createHmac } from 'node:crypto';
import { Fault, fail, equal } from '../security.mjs';

export const STRIPE_TOLERANCE_MS = 5 * 60_000;
const PLAN_KEYS = ['starter', 'family', 'big'];
const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid']); // Stripe subscription statuses that still bill or await payment
// form-encode nested objects the way Stripe expects: a[b][c]=v
export function form(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(typeof item === 'object' ? form(item, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`));
    else if (typeof v === 'object') out.push(form(v, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.filter(Boolean).join('&');
}
/** `Stripe-Signature: t=<unix s>,v1=<hex>[,v1=<hex>]` — the scheme Stripe documents. */
export function verifyStripeSignature(secret, rawBody, header, nowMs) {
  const parts = typeof header === 'string' ? header.split(',').map((p) => p.trim().split('=')) : [];
  const t = parts.find(([k]) => k === 't')?.[1], sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!/^\d{1,16}$/.test(t || '') || !sigs.length || !sigs.every((s) => /^[a-f0-9]{64}$/.test(s || ''))) fail(401, 'WEBHOOK_SIGNATURE_INVALID');
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  if (!sigs.some((s) => equal(expected, s))) fail(401, 'WEBHOOK_SIGNATURE_INVALID');
  if (Math.abs(nowMs - Number(t) * 1000) > STRIPE_TOLERANCE_MS) fail(401, 'WEBHOOK_SIGNATURE_EXPIRED');
  return Number(t) * 1000;
}
// Two shapes of the same fact: before API 2025-03-31.basil the period sat on the subscription and the price on
// the invoice line; from basil on, the period sits on the subscription item and the line's price under
// pricing.price_details. The adapter reads both, so the endpoint's API version cannot silently break a renewal.
export const periodEndOf = (sub) => { const s = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end; return Number.isSafeInteger(s) ? s * 1000 : null; };
export const linePrice = (line) => { const p = line?.pricing?.price_details?.price ?? line?.price; return typeof p === 'string' ? p : p?.id || null; };
// A proration invoice carries the old price (negative, unused time) and the new one (positive, remaining time) on separate
// lines: the line that describes what is being paid for is a positive one, the latest period first.
export const bestLine = (lines) => {
  const priced = (lines || []).filter((l) => linePrice(l)); if (!priced.length) return null;
  const positive = priced.filter((l) => !Number.isSafeInteger(l.amount) || l.amount > 0);
  return (positive.length ? positive : priced).sort((a, b) => (b.period?.end || 0) - (a.period?.end || 0))[0];
};
const NONE = Object.freeze({ price: null, periodEnd: null, familyId: null, checkoutId: null, amountCents: null, full: null, ref: null });
export function signStripe(secret, rawBody, atMs) { const t = Math.floor(atMs / 1000); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex')}`; }

export class StripeGateway {
  name = 'stripe';
  constructor({ secretKey, webhookSecret, prices, origin, fetch = globalThis.fetch, apiBase = 'https://api.stripe.com' }) {
    if (!/^sk_(test|live)_[A-Za-z0-9]{16,}$/.test(secretKey || '')) throw Error('StripeGateway needs a Stripe secret key (sk_test_… or sk_live_…).');
    if (!/^whsec_[A-Za-z0-9]{16,}$/.test(webhookSecret || '')) throw Error('StripeGateway needs the endpoint signing secret (whsec_…).');
    for (const k of PLAN_KEYS) if (!/^price_[A-Za-z0-9]{8,}$/.test(prices?.[k] || '')) throw Error(`StripeGateway needs the Stripe price id for plan "${k}".`);
    this.secretKey = secretKey; this.webhookSecret = webhookSecret; this.prices = { ...prices }; this.origin = origin; this.fetch = fetch; this.apiBase = apiBase;
    this.live = secretKey.startsWith('sk_live_');
  }
  planFor(price) { return PLAN_KEYS.find((k) => this.prices[k] === price) || null; }
  priceFor(plan) { return this.prices[plan] || null; }
  /** One call to Stripe: form body, bearer key, optional idempotency key. Errors carry Stripe's code, never the request. */
  async api(method, path, body = null, idempotencyKey = null) {
    const headers = { Authorization: `Bearer ${this.secretKey}`, 'Stripe-Version': '2025-08-27.basil' };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let res;
    try { res = await this.fetch(`${this.apiBase}${path}`, { method, headers, body: body ? form(body) : undefined }); }
    catch { fail(502, 'PROVIDER_UNREACHABLE'); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Fault(res.status === 402 ? 402 : 502, 'PROVIDER_ERROR'); e.provider = { status: res.status, code: json?.error?.code || null, type: json?.error?.type || null }; throw e; }
    return json;
  }
  /** The Stripe Customer that carries our customer reference in its metadata; created once per reference. */
  async customer(customerRef, familyId) {
    const found = await this.api('GET', `/v1/customers/search?query=${encodeURIComponent(`metadata['customerRef']:'${customerRef}'`)}&limit=1`);
    if (found.data?.[0]) return found.data[0];
    return this.api('POST', '/v1/customers', { metadata: { customerRef, familyId } }, `customer:${customerRef}`);
  }
  async createCheckout({ checkoutId, idempotencyKey, customerRef, plan, familyId }) {
    const price = this.priceFor(plan.id); if (!price) fail(400, 'INVALID_PLAN');
    const cus = await this.customer(customerRef, familyId);
    const session = await this.api('POST', '/v1/checkout/sessions', {
      mode: 'subscription', customer: cus.id, client_reference_id: checkoutId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${this.origin}/?checkout=${checkoutId}&result=success`, cancel_url: `${this.origin}/?checkout=${checkoutId}&result=cancel`,
      metadata: { checkoutId, familyId, customerRef }, subscription_data: { metadata: { checkoutId, familyId, customerRef } },
    }, idempotencyKey);
    return { provider: this.name, checkoutId, providerCheckoutRef: session.id, providerCustomerId: cus.id, idempotencyKey, customerRef, plan: plan.id, priceId: price, url: session.url, simulated: false };
  }
  /** A superseded hosted session is expired at Stripe so it can no longer be paid (already expired or completed: nothing to do). */
  async cancelCheckout(providerCheckoutRef) {
    try { await this.api('POST', `/v1/checkout/sessions/${providerCheckoutRef}/expire`, {}, `expire:${providerCheckoutRef}`); return { expired: true }; }
    catch (error) { if (error instanceof Fault && [400, 404].includes(error.provider?.status)) return { expired: false, reason: error.provider.code }; throw error; }
  }
  /** The customer carrying our reference, without creating one: a change, a cancellation or a check never mints a customer. */
  async findCustomer(customerRef) {
    const found = await this.api('GET', `/v1/customers/search?query=${encodeURIComponent(`metadata['customerRef']:'${customerRef}'`)}&limit=1`);
    return found.data?.[0] || null;
  }
  /** The subscription that matters for a customer: a live one, else the most recent. */
  async subscriptionOf(cusId) {
    const subs = await this.api('GET', `/v1/subscriptions?customer=${cusId}&status=all&limit=10`), data = subs.data || [];
    return data.find((s) => LIVE.has(s.status)) || data[0] || null;
  }
  async liveSubscription(customerRef) {
    const cus = await this.findCustomer(customerRef); if (!cus) fail(409, 'NO_PROVIDER_SUBSCRIPTION');
    const sub = await this.subscriptionOf(cus.id); if (!sub || !LIVE.has(sub.status) || !sub.items?.data?.[0]) fail(409, 'NO_PROVIDER_SUBSCRIPTION');
    return sub;
  }
  /** Stripe's subscription in the shape the reconciliation compares (RECONCILIATION.md); nothing secret in it. */
  describe(sub) {
    const price = sub.items?.data?.[0]?.price?.id || null;
    return { ref: sub.id, status: sub.status, live: LIVE.has(sub.status), price, plan: this.planFor(price), periodEnd: periodEndOf(sub), cancelAtPeriodEnd: sub.cancel_at_period_end === true, canceledAt: sub.canceled_at ? sub.canceled_at * 1000 : null };
  }
  /**
   * Move the customer's live subscription to the new price; the prorated difference is invoiced now.
   * `payment_behavior=pending_if_incomplete`: Stripe applies the new price only once that invoice is paid — until then the
   * subscription carries `pending_update` and the answer says `pending` (Stage 4 review: a failed or unfinished upgrade
   * charge must never grant the bigger plan). A card charged on the spot answers `applied`.
   */
  async changePlan({ idempotencyKey, customerRef, to }) {
    const price = this.priceFor(to); if (!price) fail(400, 'INVALID_PLAN');
    const sub = await this.liveSubscription(customerRef);
    const updated = await this.api('POST', `/v1/subscriptions/${sub.id}`, { items: [{ id: sub.items.data[0].id, price }], proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete', expand: ['latest_invoice'], metadata: { lastChange: idempotencyKey } }, idempotencyKey);
    const invoice = updated.latest_invoice && typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null;
    const invoiceId = invoice ? invoice.id : typeof updated.latest_invoice === 'string' ? updated.latest_invoice : null;
    const applied = !updated.pending_update && updated.items?.data?.[0]?.price?.id === price;
    return { chargeCents: invoice && Number.isSafeInteger(invoice.amount_paid) ? invoice.amount_paid : null, basis: applied ? 'stripe proration, invoiced and paid' : 'stripe proration, invoice open: the update waits for its payment',
      providerOperationRef: `${updated.id}:${invoiceId || ''}`, applied, pending: !applied, invoiceRef: invoiceId, invoiceUrl: invoice?.hosted_invoice_url || null, simulated: false };
  }
  /** A scheduled change: the new price without proration, so the next invoice carries it and the current period stays as paid. */
  async schedulePlan({ idempotencyKey, customerRef, to }) {
    const price = this.priceFor(to); if (!price) fail(400, 'INVALID_PLAN');
    const sub = await this.liveSubscription(customerRef);
    const updated = await this.api('POST', `/v1/subscriptions/${sub.id}`, { items: [{ id: sub.items.data[0].id, price }], proration_behavior: 'none', metadata: { lastChange: idempotencyKey } }, idempotencyKey);
    return { providerOperationRef: updated.id, effectiveAt: periodEndOf(updated), simulated: false };
  }
  /** The parent's cancel-at-period-end, or its undo, on the provider's subscription. */
  async setCancelAtPeriodEnd({ idempotencyKey, customerRef, cancel }) {
    const sub = await this.liveSubscription(customerRef);
    const updated = await this.api('POST', `/v1/subscriptions/${sub.id}`, { cancel_at_period_end: cancel === true }, idempotencyKey);
    return { providerOperationRef: updated.id, cancelAtPeriodEnd: updated.cancel_at_period_end === true, simulated: false };
  }
  /** End the subscription now (a family's deletion). Already ended at Stripe: nothing to do. Refunds are the operator's decision in the dashboard. */
  async cancelSubscription({ customerRef }) {
    const cus = await this.findCustomer(customerRef), sub = cus ? await this.subscriptionOf(cus.id) : null;
    if (!sub) return { cancelled: false, reason: 'NO_PROVIDER_SUBSCRIPTION', simulated: false };
    if (!LIVE.has(sub.status)) return { cancelled: true, already: true, providerOperationRef: sub.id, simulated: false };
    try { await this.api('DELETE', `/v1/subscriptions/${sub.id}`); return { cancelled: true, providerOperationRef: sub.id, simulated: false }; }
    catch (error) { if (error instanceof Fault && [400, 404].includes(error.provider?.status)) return { cancelled: true, already: true, providerOperationRef: sub.id, reason: error.provider.code, simulated: false }; throw error; }
  }
  /** What Stripe holds for this customer, for the reconciliation report. Read-only. */
  async inspect(customerRef) {
    const cus = await this.findCustomer(customerRef);
    if (!cus) return { provider: this.name, customer: null, subscription: null, simulated: false };
    const sub = await this.subscriptionOf(cus.id);
    return { provider: this.name, customer: { id: cus.id }, subscription: sub ? this.describe(sub) : null, simulated: false };
  }
  /** Signature first, then Stripe's event → the inbox shape. Async: a completed checkout is resolved against the subscription Stripe holds. */
  async verify(rawBody, headers, nowMs) {
    verifyStripeSignature(this.webhookSecret, rawBody, headers['stripe-signature'], nowMs);
    let ev; try { ev = JSON.parse(rawBody.toString('utf8')); } catch { fail(400, 'INVALID_JSON'); }
    if (!ev || typeof ev.id !== 'string' || typeof ev.type !== 'string' || !Number.isSafeInteger(ev.created) || !ev.data?.object) fail(400, 'INVALID_REQUEST');
    const o = ev.data.object, at = ev.created * 1000, base = { id: ev.id, at, seq: null };
    if (at > nowMs + STRIPE_TOLERANCE_MS) fail(400, 'EVENT_IN_FUTURE'); // a far-future timestamp would make every later event stale
    const customer = typeof o.customer === 'string' ? o.customer : o.customer?.id || null;
    if (ev.type === 'checkout.session.completed') {
      if (!customer || !o.subscription) fail(400, 'INVALID_REQUEST');
      const sub = await this.api('GET', `/v1/subscriptions/${typeof o.subscription === 'string' ? o.subscription : o.subscription.id}`); // provider state, not our own metadata
      return { ...base, type: 'checkout.completed', customer, data: { ...NONE, price: sub.items?.data?.[0]?.price?.id || null, periodEnd: periodEndOf(sub), familyId: o.metadata?.familyId || null, checkoutId: o.client_reference_id || o.metadata?.checkoutId || null } };
    }
    const passthrough = (type) => ({ ...base, type, customer: customer || 'none', data: { ...NONE } }); // recorded and ignored by the inbox
    if (ev.type === 'invoice.paid' || ev.type === 'invoice.payment_failed') {
      const details = o.parent?.subscription_details || o.subscription_details || null; // basil moved it under parent
      const subId = typeof details?.subscription === 'string' ? details.subscription : typeof o.subscription === 'string' ? o.subscription : null;
      // the price the subscription is on now is the fact (a proration invoice lists the old and the new price on separate
      // lines): a paid invoice is resolved against the subscription Stripe holds; otherwise the best line answers
      let price = null, periodEnd = null;
      if (ev.type === 'invoice.paid' && subId) { const sub = await this.api('GET', `/v1/subscriptions/${subId}`); price = sub.items?.data?.[0]?.price?.id || null; periodEnd = periodEndOf(sub); }
      if (!price) { const line = bestLine(o.lines?.data); price = line ? linePrice(line) : null; periodEnd = line?.period?.end ? line.period.end * 1000 : null; }
      return { ...base, type: ev.type, customer, data: { ...NONE, price, periodEnd, familyId: details?.metadata?.familyId || o.metadata?.familyId || null } };
    }
    if (ev.type === 'customer.subscription.deleted') return { ...base, type: 'subscription.deleted', customer, data: { ...NONE, familyId: o.metadata?.familyId || null } };
    if (ev.type === 'refund.created' || ev.type === 'refund.updated') {
      // the per-refund object (Stage 4 review): its own id and amount, never the charge's running total; only a refund that succeeded counts
      if (o.status !== 'succeeded') return passthrough(`stripe.${ev.type}:${o.status || 'unknown'}`);
      const chargeId = typeof o.charge === 'string' ? o.charge : o.charge?.id; if (!chargeId || typeof o.id !== 'string') fail(400, 'INVALID_REQUEST');
      const charge = await this.api('GET', `/v1/charges/${chargeId}`); // the customer, and whether the charge is now refunded in full
      const cust = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || null; if (!cust) fail(400, 'INVALID_REQUEST');
      const full = charge.refunded === true || (Number.isSafeInteger(charge.amount_refunded) && Number.isSafeInteger(charge.amount) && charge.amount_refunded >= charge.amount);
      return { ...base, type: 'refund.created', customer: cust, data: { ...NONE, amountCents: Number.isSafeInteger(o.amount) ? o.amount : null, full, ref: o.id } };
    }
    if (ev.type === 'charge.refunded') return passthrough('stripe.charge.refunded'); // the charge's running total: recorded and ignored; refund.created carries each refund
    return passthrough(ev.type);
  }
}
