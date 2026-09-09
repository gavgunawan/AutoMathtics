// A recorded Stripe for the adapter tests: answers by method + longest matching path prefix,
// remembers every call (method, path, headers, decoded form body). `stripeAccount` adds one
// customer and one subscription that the adapter's own calls mutate, so a test can read back
// what Stripe would now hold.
import { randomUUID } from 'node:crypto';
import { StripeGateway, signStripe } from '../server/gateways/stripe.mjs';

export const KEY = 'sk_test_' + 'a1b2c3d4'.repeat(3), WHSEC = 'whsec_' + 'z9y8x7w6'.repeat(3);
export const PRICES = { starter: 'price_1Starter00', family: 'price_1Family000', big: 'price_1BigFam000' };
export const DAY = 86_400_000, op = () => ({ operationId: randomUUID() });
/** Routes: `'METHOD /path/prefix': object | { status, json } | (body, calls) => …`. The longest matching prefix wins. */
export function stripeServer(routes = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
    calls.push({ method, path: u.pathname + (u.search || ''), headers: init.headers || {}, body });
    const key = Object.keys(routes).filter((k) => { const [m, p] = k.split(' '); return m === method && (u.pathname + u.search).startsWith(p); }).sort((x, y) => y.length - x.length)[0];
    const answer = key ? (typeof routes[key] === 'function' ? routes[key](body, calls) : routes[key]) : { status: 404, json: { error: { code: 'resource_missing', type: 'invalid_request_error' } } };
    const envelope = typeof answer.status === 'number' && 'json' in answer ? answer : { status: 200, json: answer };
    return { ok: envelope.status < 400, status: envelope.status, json: async () => envelope.json };
  };
  return { fetch, calls };
}
export const gateway = (routes, extra = {}) => { const srv = stripeServer(routes); return { gw: new StripeGateway({ secretKey: KEY, webhookSecret: WHSEC, prices: PRICES, origin: 'https://pilot.example.test', fetch: srv.fetch, ...extra }), calls: srv.calls }; };
export const sub = (price, end, more = {}) => ({ id: 'sub_1', object: 'subscription', status: 'active', cancel_at_period_end: false, current_period_end: Math.floor(end / 1000), items: { data: [{ id: 'si_1', price: { id: price } }] }, latest_invoice: 'in_1', ...more });
export const event = (f, type, object, more = {}) => ({ id: `evt_${randomUUID().replace(/-/g, '')}`, object: 'event', type, created: Math.floor(f.now() / 1000), data: { object }, ...more });
export const signed = (f, ev, at = f.now()) => { const raw = Buffer.from(JSON.stringify(ev)); return { raw, headers: { 'stripe-signature': signStripe(WHSEC, raw, at) } }; };
const missing = { status: 404, json: { error: { code: 'resource_missing', type: 'invalid_request_error' } } };
/** One Stripe customer and, once `activate()`d, one subscription; the adapter's updates, expiries and deletions land on `state`. */
export function stripeAccount(f, { customerId = 'cus_live1' } = {}) {
  const state = { customer: null, sub: null, expired: [], deleted: [], invoices: 1 };
  const routes = {
    'GET /v1/customers/search': () => ({ data: state.customer ? [state.customer] : [] }),
    'POST /v1/customers': (body) => { state.customer = { id: customerId, metadata: { customerRef: body['metadata[customerRef]'] } }; return state.customer; },
    'POST /v1/checkout/sessions': (body) => ({ id: `cs_${body.client_reference_id.slice(0, 8)}`, url: 'https://checkout.stripe.com/c/pay/x' }),
    'POST /v1/checkout/sessions/': (body, calls) => { state.expired.push(calls.at(-1).path); return { status: 'expired' }; },
    'GET /v1/subscriptions?customer=': () => ({ data: [state.sub, ...(state.extraSubs || [])].filter(Boolean) }), // extraSubs: what the dashboard added behind the server's back
    'GET /v1/subscriptions/': () => state.sub || missing,
    'POST /v1/subscriptions/': (body) => {
      if (!state.sub) return missing;
      if (body.cancel_at_period_end !== undefined) state.sub.cancel_at_period_end = body.cancel_at_period_end === 'true';
      const price = body['items[0][price]'], invoiceId = `in_${++state.invoices}`;
      if (price && body.payment_behavior === 'pending_if_incomplete' && state.upgradePayment && state.upgradePayment !== 'paid') {
        // Stripe holds the update: the price stays, pending_update is set, the invoice is open (a failed charge, or a card that needs authentication)
        state.sub.pending_update = { expires_at: Math.floor(f.now() / 1000) + 82_800, subscription_items: [{ id: 'si_1', price: { id: price } }] };
        state.pendingPrice = price; state.pendingInvoice = invoiceId;
        return { ...state.sub, latest_invoice: { id: invoiceId, status: 'open', amount_due: 400, amount_paid: 0, hosted_invoice_url: `https://invoice.stripe.com/i/${invoiceId}` } };
      }
      if (price) { state.sub.items.data[0].price.id = price; state.sub.pending_update = null; }
      state.sub.latest_invoice = invoiceId;
      return { ...state.sub, latest_invoice: price ? { id: invoiceId, status: 'paid', amount_due: 400, amount_paid: 400, hosted_invoice_url: `https://invoice.stripe.com/i/${invoiceId}` } : invoiceId };
    },
    'GET /v1/charges/': () => state.charge || missing,
    'DELETE /v1/subscriptions/': (body, calls) => {
      const id = calls.at(-1).path.split('/').pop(), target = [state.sub, ...(state.extraSubs || [])].find((s) => s && s.id === id);
      if (!target || target.status === 'canceled') return { status: 400, json: { error: { code: 'resource_missing', type: 'invalid_request_error' } } };
      target.status = 'canceled'; target.canceled_at = Math.floor(f.now() / 1000); state.deleted.push(calls.at(-1).path); return target;
    },
  };
  const { gw, calls } = gateway(routes);
  return { gw, calls, state, activate(price = PRICES.starter, periodEnd = f.now() + 30 * DAY) { state.sub = sub(price, periodEnd); return state.sub; },
    /** Stripe applies the held update the moment its invoice is paid. */
    payPending() { if (!state.pendingPrice) throw Error('nothing pending'); state.sub.items.data[0].price.id = state.pendingPrice; state.sub.pending_update = null; const id = state.pendingInvoice; state.pendingPrice = null; state.pendingInvoice = null; return id; } };
}
