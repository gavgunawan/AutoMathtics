// Stage 4.1 — the Stripe adapter against a recorded Stripe surface: what we send Stripe (form shape,
// bearer key, idempotency keys), what we make of what Stripe sends us (signature, event mapping,
// provider state fetched for a completed checkout), and the whole flow through the Stage 3 inbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { StripeGateway, form, signStripe, verifyStripeSignature, STRIPE_TOLERANCE_MS, periodEndOf, linePrice } from '../server/gateways/stripe.mjs';
import { Payments } from '../server/payments.mjs';

import { KEY, WHSEC, PRICES, DAY, op, stripeServer, gateway, sub, event, signed } from './stripe-support.mjs';
void stripeServer;

test('the wire: nested form encoding, the signature scheme Stripe documents, and construction that refuses bad keys', () => {
  assert.equal(form({ mode: 'subscription', line_items: [{ price: 'price_x', quantity: 1 }], metadata: { a: 'b c' } }), 'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_x&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Ba%5D=b%20c');
  const raw = Buffer.from('{"id":"evt_1"}'), now = Date.parse('2026-09-10T00:00:00Z'), header = signStripe(WHSEC, raw, now);
  assert.match(header, /^t=\d+,v1=[a-f0-9]{64}$/);
  assert.equal(verifyStripeSignature(WHSEC, raw, header, now + 30_000), Math.floor(now / 1000) * 1000);
  assert.equal(verifyStripeSignature(WHSEC, raw, `${header},v1=${'0'.repeat(64)}`, now), Math.floor(now / 1000) * 1000, 'any listed v1 may match (key rotation)');
  assert.throws(() => verifyStripeSignature(WHSEC, Buffer.from('{"id":"evt_2"}'), header, now), rejected('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => verifyStripeSignature('whsec_other000000000000', raw, header, now), rejected('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => verifyStripeSignature(WHSEC, raw, header.replace(/t=\d+/, 't=1'), now), rejected('WEBHOOK_SIGNATURE_INVALID'), 'the timestamp is inside the MAC');
  assert.throws(() => verifyStripeSignature(WHSEC, raw, header, now + STRIPE_TOLERANCE_MS + 2000), rejected('WEBHOOK_SIGNATURE_EXPIRED'));
  for (const bad of [undefined, '', 'v1=abc', 42]) assert.throws(() => verifyStripeSignature(WHSEC, raw, bad, now), rejected('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => new StripeGateway({ secretKey: 'pk_test_' + 'a'.repeat(24), webhookSecret: WHSEC, prices: PRICES }), /secret key/);
  assert.throws(() => new StripeGateway({ secretKey: KEY, webhookSecret: 'nope', prices: PRICES }), /whsec/);
  assert.throws(() => new StripeGateway({ secretKey: KEY, webhookSecret: WHSEC, prices: { ...PRICES, big: undefined } }), /price id for plan "big"/);
  const { gw } = gateway({}); assert.equal(gw.planFor('price_1Family000'), 'family'); assert.equal(gw.planFor('price_nope'), null); assert.equal(gw.priceFor('big'), 'price_1BigFam000'); assert.equal(gw.live, false);
});
test('checkout: one Stripe customer per family carrying our reference, a hosted session under our idempotency key, and a superseded session expired at Stripe', async () => {
  let customers = [];
  const { gw, calls } = gateway({
    'GET /v1/customers/search': () => ({ data: customers }),
    'POST /v1/customers': (body) => { const c = { id: 'cus_stripe1', metadata: { customerRef: body['metadata[customerRef]'], familyId: body['metadata[familyId]'] } }; customers = [c]; return c; },
    'POST /v1/checkout/sessions': (body) => ({ id: `cs_test_${body.client_reference_id.slice(0, 8)}`, url: `https://checkout.stripe.com/c/pay/cs_test_${body.client_reference_id.slice(0, 8)}` }),
    'POST /v1/checkout/sessions/cs_test_old/expire': { id: 'cs_test_old', status: 'expired' },
    'POST /v1/checkout/sessions/cs_test_gone/expire': { status: 404, json: { error: { code: 'resource_missing', type: 'invalid_request_error' } } },
  });
  const plan = { id: 'family' }, checkoutId = randomUUID();
  const r = await gw.createCheckout({ checkoutId, idempotencyKey: checkoutId, customerRef: 'cus_ours', plan, familyId: 'fam_1' });
  assert.equal(r.providerCustomerId, 'cus_stripe1'); assert.equal(r.providerCheckoutRef, `cs_test_${checkoutId.slice(0, 8)}`); assert.ok(r.url.startsWith('https://checkout.stripe.com/')); assert.equal(r.simulated, false); assert.equal(r.priceId, 'price_1Family000');
  assert.ok(!JSON.stringify(r).includes('sk_test'), 'the key never leaves the adapter');
  const [search, create, session] = calls;
  assert.equal(search.method, 'GET'); assert.equal(new URLSearchParams(search.path.split('?')[1]).get('query'), "metadata['customerRef']:'cus_ours'");
  assert.equal(create.headers['Idempotency-Key'], 'customer:cus_ours'); assert.equal(create.headers.Authorization, `Bearer ${KEY}`); assert.equal(create.body['metadata[customerRef]'], 'cus_ours');
  assert.equal(session.headers['Idempotency-Key'], checkoutId, 'the checkout id is the provider-side idempotency key (S3.3-A)');
  assert.equal(session.body.mode, 'subscription'); assert.equal(session.body['line_items[0][price]'], 'price_1Family000'); assert.equal(session.body.customer, 'cus_stripe1'); assert.equal(session.body.client_reference_id, checkoutId); assert.equal(session.body['subscription_data[metadata][familyId]'], 'fam_1');
  assert.ok(session.body.success_url.startsWith('https://pilot.example.test/'));
  // a second checkout for the same family finds the customer instead of creating another
  calls.length = 0; await gw.createCheckout({ checkoutId: randomUUID(), idempotencyKey: 'x', customerRef: 'cus_ours', plan: { id: 'starter' }, familyId: 'fam_1' });
  assert.deepEqual(calls.map((c) => c.method + ' ' + c.path.split('?')[0]), ['GET /v1/customers/search', 'POST /v1/checkout/sessions']);
  assert.deepEqual(await gw.cancelCheckout('cs_test_old'), { expired: true });
  assert.deepEqual(await gw.cancelCheckout('cs_test_gone'), { expired: false, reason: 'resource_missing' }, 'already gone at Stripe: nothing to do');
  await assert.rejects(gw.createCheckout({ checkoutId: 'c', idempotencyKey: 'c', customerRef: 'cus_ours', plan: { id: 'trial' }, familyId: 'f' }), rejected('INVALID_PLAN'));
});
test('a plan change moves the live subscription to the new price with prorations invoiced now; provider errors carry Stripe\'s code, never the request', async () => {
  const { gw, calls } = gateway({
    'GET /v1/customers/search': { data: [{ id: 'cus_stripe1' }] },
    'GET /v1/subscriptions?customer=cus_stripe1': { data: [sub('price_1Starter00', Date.now() + 30 * DAY)] },
    'POST /v1/subscriptions/sub_1': (body) => ({ id: 'sub_1', latest_invoice: 'in_2', items: { data: [{ id: 'si_1', price: { id: body['items[0][price]'] } }] } }),
  });
  const r = await gw.changePlan({ idempotencyKey: 'op_1', customerRef: 'cus_ours', from: 'starter', to: 'family' });
  assert.equal(r.providerOperationRef, 'sub_1:in_2'); assert.equal(r.simulated, false); assert.equal(r.chargeCents, null, 'Stripe computes the proration; the invoice says what was charged');
  assert.equal(r.applied, true); assert.equal(r.pending, false);
  const update = calls.find((c) => c.path === '/v1/subscriptions/sub_1');
  assert.equal(update.headers['Idempotency-Key'], 'op_1'); assert.equal(update.body['items[0][id]'], 'si_1'); assert.equal(update.body['items[0][price]'], 'price_1Family000'); assert.equal(update.body.proration_behavior, 'always_invoice');
  assert.equal(update.body.payment_behavior, 'pending_if_incomplete', 'the new price applies only once its invoice is paid'); assert.equal(update.body['expand[0]'], 'latest_invoice');
  // the update held by Stripe until the payment lands: pending, with the invoice the parent must finish
  const held = gateway({ 'GET /v1/customers/search': { data: [{ id: 'cus_stripe1' }] }, 'GET /v1/subscriptions?customer=cus_stripe1': { data: [sub('price_1Starter00', Date.now() + 30 * DAY)] },
    'POST /v1/subscriptions/sub_1': { id: 'sub_1', pending_update: { expires_at: 1, subscription_items: [{ id: 'si_1', price: { id: 'price_1Family000' } }] }, items: { data: [{ id: 'si_1', price: { id: 'price_1Starter00' } }] }, latest_invoice: { id: 'in_3', status: 'open', amount_paid: 0, hosted_invoice_url: 'https://invoice.stripe.com/i/x' } } });
  const h = await held.gw.changePlan({ idempotencyKey: 'op_2', customerRef: 'cus_ours', from: 'starter', to: 'family' });
  assert.equal(h.pending, true); assert.equal(h.applied, false); assert.equal(h.invoiceRef, 'in_3'); assert.equal(h.invoiceUrl, 'https://invoice.stripe.com/i/x'); assert.equal(h.providerOperationRef, 'sub_1:in_3');
  const none = gateway({ 'GET /v1/customers/search': { data: [{ id: 'cus_x' }] }, 'GET /v1/subscriptions': { data: [] } });
  await assert.rejects(none.gw.changePlan({ idempotencyKey: 'o', customerRef: 'c', from: 'starter', to: 'big' }), rejected('NO_PROVIDER_SUBSCRIPTION'));
  const broken = gateway({ 'GET /v1/customers/search': { status: 401, json: { error: { code: 'api_key_expired', type: 'authentication_error' } } } });
  await assert.rejects(broken.gw.createCheckout({ checkoutId: 'c', idempotencyKey: 'c', customerRef: 'c', plan: { id: 'starter' }, familyId: 'f' }), (e) => e.code === 'PROVIDER_ERROR' && e.provider.code === 'api_key_expired' && !JSON.stringify(e).includes('sk_test'));
  const down = gateway({}); down.gw.fetch = async () => { throw Error('ECONNRESET'); };
  await assert.rejects(down.gw.createCheckout({ checkoutId: 'c', idempotencyKey: 'c', customerRef: 'c', plan: { id: 'starter' }, familyId: 'f' }), rejected('PROVIDER_UNREACHABLE'));
});
test('webhooks: signature before parsing, then Stripe\'s events become the inbox shape with the price and period taken from Stripe\'s own objects', async () => {
  const f = fixture(); const end = f.now() + 30 * DAY;
  const { gw, calls } = gateway({ 'GET /v1/subscriptions/sub_1': sub('price_1Family000', end) });
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', customer: 'cus_stripe1', subscription: 'sub_1', client_reference_id: 'chk_1', metadata: { familyId: 'fam_1', checkoutId: 'chk_1', price: 'price_1BigFam000' } });
  const { raw, headers } = signed(f, done);
  const n = await gw.verify(raw, headers, f.now());
  assert.match(n.fingerprint, /^[0-9a-f]{64}$/, 'the event fingerprinted by its own identity');
  assert.deepEqual(n, { id: done.id, at: done.created * 1000, seq: null, fingerprint: n.fingerprint, type: 'checkout.completed', customer: 'cus_stripe1', data: { price: 'price_1Family000', periodEnd: Math.floor(end / 1000) * 1000, familyId: 'fam_1', checkoutId: 'chk_1', amountCents: null, full: null, ref: null, subscriptionRef: 'sub_1' } });
  assert.equal(calls.length, 1, 'the price came from the subscription Stripe holds, not from the metadata we authored');
  const paid = event(f, 'invoice.paid', { object: 'invoice', customer: 'cus_stripe1', lines: { data: [{ price: { id: 'price_1Starter00' }, period: { end: Math.floor(end / 1000) } }] }, subscription_details: { metadata: { familyId: 'fam_1' } } });
  const np = await gw.verify(...Object.values(signed(f, paid)).slice(0, 2), f.now());
  assert.equal(np.type, 'invoice.paid'); assert.equal(np.data.price, 'price_1Starter00'); assert.equal(np.data.periodEnd, Math.floor(end / 1000) * 1000); assert.equal(np.data.familyId, 'fam_1');
  // refunds: the per-refund object, its own amount and id; the charge answers who the customer is and whether it is now refunded in full
  const charged = gateway({ 'GET /v1/charges/ch_1': { id: 'ch_1', customer: 'cus_stripe1', amount: 900, amount_refunded: 500, refunded: false } });
  const partial = event(f, 'refund.created', { object: 'refund', id: 're_1', charge: 'ch_1', amount: 300, status: 'succeeded' });
  const np1 = await charged.gw.verify(...Object.values(signed(f, partial)).slice(0, 2), f.now());
  assert.equal(np1.type, 'refund.created'); assert.equal(np1.customer, 'cus_stripe1'); assert.equal(np1.data.amountCents, 300, 'the refund object, not the running total'); assert.equal(np1.data.full, false); assert.equal(np1.data.ref, 're_1');
  const last = gateway({ 'GET /v1/charges/ch_1': { id: 'ch_1', customer: 'cus_stripe1', amount: 900, amount_refunded: 900, refunded: true } });
  const closing = event(f, 'refund.created', { object: 'refund', id: 're_2', charge: 'ch_1', amount: 400, status: 'succeeded' });
  const np2 = await last.gw.verify(...Object.values(signed(f, closing)).slice(0, 2), f.now()); assert.equal(np2.data.amountCents, 400); assert.equal(np2.data.full, true);
  const pendingRefund = event(f, 'refund.created', { object: 'refund', id: 're_3', charge: 'ch_1', amount: 100, status: 'pending' });
  const npend = await last.gw.verify(...Object.values(signed(f, pendingRefund)).slice(0, 2), f.now()); assert.equal(npend.type, 'refund.created', 'a refund counts from the moment it exists'); assert.equal(npend.data.amountCents, 100); assert.equal(npend.data.ref, 're_3');
  const total = event(f, 'charge.refunded', { object: 'charge', customer: 'cus_stripe1', amount: 900, amount_refunded: 900, refunded: true });
  assert.equal((await gw.verify(...Object.values(signed(f, total)).slice(0, 2), f.now())).type, 'stripe.charge.refunded', 'the charge running total is never a refund event');
  const gone = event(f, 'customer.subscription.deleted', { object: 'subscription', customer: 'cus_stripe1', metadata: { familyId: 'fam_1' } });
  assert.equal((await gw.verify(...Object.values(signed(f, gone)).slice(0, 2), f.now())).type, 'subscription.deleted');
  const other = event(f, 'customer.updated', { object: 'customer', id: 'cus_stripe1' });
  assert.equal((await gw.verify(...Object.values(signed(f, other)).slice(0, 2), f.now())).type, 'customer.updated', 'unknown types pass through for the inbox to record and ignore');
  await assert.rejects(gw.verify(raw, { 'stripe-signature': signStripe('whsec_wrong00000000000000', raw, f.now()) }, f.now()), rejected('WEBHOOK_SIGNATURE_INVALID'));
  await assert.rejects(gw.verify(Buffer.from('{oops'), { 'stripe-signature': signStripe(WHSEC, Buffer.from('{oops'), f.now()) }, f.now()), rejected('INVALID_JSON'));
  const future = { ...done, created: Math.floor(f.now() / 1000) + 3600 }; await assert.rejects(gw.verify(...Object.values(signed(f, future)).slice(0, 2), f.now()), rejected('EVENT_IN_FUTURE'));
});
test('the whole flow through the Stage 3 inbox: checkout, Stripe\'s own customer id resolving to the family, completion from provider state, renewal, refund — and a superseded session expired at Stripe', async () => {
  const f = fixture(); const a = await f.family('parentA', 0); const end = f.now() + 30 * DAY;
  let customers = [], expired = [], created = 0;
  const { gw, calls } = gateway({
    'GET /v1/customers/search': () => ({ data: customers }),
    'POST /v1/customers': (body) => { const c = { id: `cus_stripe${++created}`, metadata: { customerRef: body['metadata[customerRef]'] } }; customers = [c]; return c; },
    'POST /v1/checkout/sessions': (body) => ({ id: `cs_${body.client_reference_id.slice(0, 8)}`, url: 'https://checkout.stripe.com/c/pay/x' }),
    'POST /v1/checkout/sessions/': (body, all) => { expired.push(all.at(-1).path); return { status: 'expired' }; },
    'GET /v1/subscriptions/sub_1': sub('price_1Starter00', end),
  });
  const payments = new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'stripe', gateways: { stripe: gw }, now: f.now });
  const first = await payments.checkout(a.ctx, { plan: 'starter', ...op() });
  assert.equal(first.providerCustomerId, 'cus_stripe1'); assert.ok(first.url);
  const alias = await f.store.get('billingCustomers/stripe:cus_stripe1'); assert.equal(alias.familyId, a.familyId); assert.equal(alias.aliasOf, first.customerRef);
  assert.equal((await f.store.get(`families/${a.familyId}`)).providerCustomer.stripe, 'cus_stripe1');
  const second = await payments.checkout(a.ctx, { plan: 'starter', ...op() }); // supersedes the first: Stripe is told to expire it
  assert.deepEqual(expired, [`/v1/checkout/sessions/${first.providerCheckoutRef}/expire`]);
  assert.equal((await f.store.get(`checkouts/stripe:${first.checkoutId}`)).status, 'superseded');
  // Stripe reports the second session completed; the inbox resolves the family by Stripe's customer id and the price by the subscription Stripe holds
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', customer: 'cus_stripe1', subscription: 'sub_1', client_reference_id: second.checkoutId, metadata: { familyId: a.familyId, checkoutId: second.checkoutId } });
  let s = signed(f, done); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'applied', state: 'active', eventId: (await f.store.get(`billingEvents/stripe:${done.id}`)).outcome.eventId });
  let fam = await f.store.get(`families/${a.familyId}`); assert.equal(fam.subscription.plan, 'starter'); assert.equal(fam.subscription.periodEnd, Math.floor(end / 1000) * 1000); assert.equal(fam.subscription.providerRef, 'cus_stripe1');
  // the first (superseded) session completing later is refused, whatever Stripe says
  const late = event(f, 'checkout.session.completed', { object: 'checkout.session', customer: 'cus_stripe1', subscription: 'sub_1', client_reference_id: first.checkoutId, metadata: { familyId: a.familyId } });
  s = signed(f, late); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'rejected', reason: 'CHECKOUT_SUPERSEDED' });
  // a renewal invoice, then a full refund, both by Stripe's customer id
  const renew = event(f, 'invoice.paid', { object: 'invoice', customer: 'cus_stripe1', lines: { data: [{ price: { id: 'price_1Starter00' }, period: { end: Math.floor((end + 30 * DAY) / 1000) } }] } });
  s = signed(f, renew); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.periodEnd, Math.floor((end + 30 * DAY) / 1000) * 1000);
  // two partial refunds, each its own object; a redelivery of the first under a new event id counts nothing; the last one ends access
  const chargeState = { id: 'ch_9', customer: 'cus_stripe1', amount: 500, amount_refunded: 200, refunded: false };
  const stripeWithCharge = gateway({ 'GET /v1/customers/search': () => ({ data: customers }), 'GET /v1/subscriptions/sub_1': sub('price_1Starter00', end), 'GET /v1/charges/ch_9': () => chargeState });
  const pay2 = new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'stripe', gateways: { stripe: stripeWithCharge.gw }, now: f.now });
  const r1 = event(f, 'refund.created', { object: 'refund', id: 're_a', charge: 'ch_9', amount: 200, status: 'succeeded' });
  s = signed(f, r1); assert.equal((await pay2.receive('stripe', s.raw, s.headers)).status, 'applied');
  const again = { ...r1, id: `evt_${randomUUID().replace(/-/g, '')}` }; s = signed(f, again); assert.deepEqual(await pay2.receive('stripe', s.raw, s.headers), { status: 'ignored', reason: 'DUPLICATE_REFUND' });
  chargeState.amount_refunded = 500; chargeState.refunded = true;
  const r2 = event(f, 'refund.created', { object: 'refund', id: 're_b', charge: 'ch_9', amount: 300, status: 'succeeded' });
  s = signed(f, r2); assert.equal((await pay2.receive('stripe', s.raw, s.headers)).state, 'cancelled');
  const refunds = (await f.store.get(`families/${a.familyId}`)).subscription.refunds; assert.deepEqual(refunds.map((x) => x.amountCents), [200, 300], 'the record holds each refund once: 500 in total, not 700');
  assert.equal((await f.service.me(a.ctx)).family.entitlement.status, 'inactive');
  // an unknown Stripe customer, or one that belongs to another family, never reaches this family — and a Stripe id
  // already bound to family A can never be attached to family B (NO_TRANSFER), whatever Stripe answers
  const b = await f.family('parentB', 0); created = 0; customers = [];
  await assert.rejects(payments.checkout(b.ctx, { plan: 'family', ...op() }), rejected('PROVIDER_CUSTOMER_CONFLICT'));
  assert.equal((await f.store.get('billingCustomers/stripe:cus_stripe1')).familyId, a.familyId, 'the alias still points at A');
  created = 1; customers = []; const bPay = await payments.checkout(b.ctx, { plan: 'family', ...op() });
  assert.equal(bPay.providerCustomerId, 'cus_stripe2'); assert.equal((await f.store.get('billingCustomers/stripe:cus_stripe2')).familyId, b.familyId);
  const stray = event(f, 'invoice.paid', { object: 'invoice', customer: 'cus_nobody', lines: { data: [{ price: { id: 'price_1Starter00' }, period: { end: Math.floor(end / 1000) } }] } });
  s = signed(f, stray); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'rejected', reason: 'UNKNOWN_CUSTOMER' });
  assert.ok(calls.every((c) => !JSON.stringify(c.body || {}).includes('seats')), 'nothing we send Stripe names a seat count');
});
test('Stripe API basil shapes: the period on the subscription item, the line price under pricing, the subscription link under parent — same inbox events', async () => {
  const f = fixture(); const end = Math.floor((f.now() + 30 * DAY) / 1000);
  const basilSub = { id: 'sub_b', object: 'subscription', status: 'active', cancel_at_period_end: false, items: { data: [{ id: 'si_b', price: { id: 'price_1Family000' }, current_period_end: end }] }, latest_invoice: 'in_b' };
  assert.equal(periodEndOf(basilSub), end * 1000); assert.equal(periodEndOf(sub('price_1Starter00', end * 1000)), end * 1000); assert.equal(periodEndOf({ items: { data: [] } }), null);
  assert.equal(linePrice({ pricing: { price_details: { price: 'price_x' } } }), 'price_x'); assert.equal(linePrice({ price: { id: 'price_y' } }), 'price_y'); assert.equal(linePrice({}), null);
  const { gw } = gateway({ 'GET /v1/subscriptions/sub_b': basilSub });
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', customer: 'cus_b', subscription: 'sub_b', client_reference_id: 'chk_b', metadata: { familyId: 'fam_b' } });
  const n = await gw.verify(...Object.values(signed(f, done)).slice(0, 2), f.now());
  assert.equal(n.data.price, 'price_1Family000'); assert.equal(n.data.periodEnd, end * 1000);
  const paid = event(f, 'invoice.paid', { object: 'invoice', customer: 'cus_b', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_b', metadata: { familyId: 'fam_b' } } }, lines: { data: [{ pricing: { price_details: { price: 'price_1Family000', product: 'prod_x' } }, period: { end } }] } });
  const np = await gw.verify(...Object.values(signed(f, paid)).slice(0, 2), f.now());
  assert.equal(np.type, 'invoice.paid'); assert.equal(np.data.price, 'price_1Family000'); assert.equal(np.data.periodEnd, end * 1000); assert.equal(np.data.familyId, 'fam_b');
  assert.equal(gw.describe(basilSub).periodEnd, end * 1000);
});
