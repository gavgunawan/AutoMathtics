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
    'GET /v1/subscriptions?customer=': () => ({ data: state.sub ? [state.sub] : [] }),
    'GET /v1/subscriptions/': () => state.sub || missing,
    'POST /v1/subscriptions/': (body) => {
      if (!state.sub) return missing;
      if (body.cancel_at_period_end !== undefined) state.sub.cancel_at_period_end = body.cancel_at_period_end === 'true';
      if (body['items[0][price]']) state.sub.items.data[0].price.id = body['items[0][price]'];
      state.sub.latest_invoice = `in_${++state.invoices}`;
      return state.sub;
    },
    'DELETE /v1/subscriptions/': (body, calls) => {
      if (!state.sub || state.sub.status === 'canceled') return { status: 400, json: { error: { code: 'resource_missing', type: 'invalid_request_error' } } };
      state.sub.status = 'canceled'; state.sub.canceled_at = Math.floor(f.now() / 1000); state.deleted.push(calls.at(-1).path); return state.sub;
    },
  };
  const { gw, calls } = gateway(routes);
  return { gw, calls, state, activate(price = PRICES.starter, periodEnd = f.now() + 30 * DAY) { state.sub = sub(price, periodEnd); return state.sub; } };
}
