// Stage 3.3 — the payment gateway abstraction and webhook security: signed fixtures, a global
// inbox that records before it acts, customer references that bind a provider to one family,
// and a browser that can only ask for a checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fixture, rejected, webhookSecret, secret } from './support.mjs';
import { signWebhook, verifyWebhook, derivedEventId, normalizeEvent, SIGNATURE_TOLERANCE_MS, WEBHOOK_BODY_LIMIT, PROVIDER_EVENTS } from '../server/payments.mjs';
import { uuid } from '../server/security.mjs';
import { createApp } from '../server/http.mjs';

const DAY = 86_400_000;
// a signed provider event, the way the operator script or a real provider would send it
function signed(f, event, { secret: s = webhookSecret, at = f.now() } = {}) {
  const raw = Buffer.from(JSON.stringify(event));
  return { raw, headers: { 'x-webhook-signature': signWebhook(s, raw, at), 'content-type': 'application/json' } };
}
const deliver = (f, event, opts) => { const { raw, headers } = signed(f, event, opts); return f.payments.receive('fake', raw, headers); };
const evt = (customer, type, data = {}, more = {}) => ({ id: `evt_${randomUUID()}`, type, at: Date.now(), customer, data, ...more });
async function subscribed(f, plan = 'family') {
  const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan, operationId: randomUUID() });
  const paid = await deliver(f, evt(co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }));
  assert.equal(paid.status, 'applied');
  return { a, co };
}

test('the signature covers the raw bytes and the timestamp, in constant time, inside a five-minute window', () => {
  const raw = Buffer.from('{"id":"evt_1"}'), now = Date.parse('2026-09-10T00:00:00Z'), header = signWebhook(webhookSecret, raw, now);
  assert.match(header, /^t=\d+,v1=[a-f0-9]{64}$/);
  assert.equal(verifyWebhook(webhookSecret, raw, header, now + 1000), now);
  assert.throws(() => verifyWebhook(webhookSecret, Buffer.from('{"id":"evt_2"}'), header, now), rejected('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => verifyWebhook(secret, raw, header, now), rejected('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => verifyWebhook(webhookSecret, raw, header.replace(/t=\d+/, `t=${now + 1}`), now), rejected('WEBHOOK_SIGNATURE_INVALID')); // the timestamp is inside the MAC
  for (const bad of [undefined, '', 'v1=abc', header.slice(0, -1), header.toUpperCase(), ['a'], 42]) assert.throws(() => verifyWebhook(webhookSecret, raw, bad, now), rejected('WEBHOOK_SIGNATURE_INVALID'));
  assert.throws(() => verifyWebhook(webhookSecret, raw, header, now + SIGNATURE_TOLERANCE_MS + 1), rejected('WEBHOOK_SIGNATURE_EXPIRED'));
  assert.throws(() => verifyWebhook(webhookSecret, raw, header, now - SIGNATURE_TOLERANCE_MS - 1), rejected('WEBHOOK_SIGNATURE_EXPIRED'));
  assert.equal(verifyWebhook(webhookSecret, raw, header, now + SIGNATURE_TOLERANCE_MS), now);
});
test('a derived event id is uuid-shaped and stable; the normalized event has a fixed shape', () => {
  const id = derivedEventId('fake:evt_1'); assert.equal(uuid(id), id); assert.equal(derivedEventId('fake:evt_1'), id); assert.notEqual(derivedEventId('fake:evt_2'), id);
  const n = normalizeEvent({ id: 'evt_1', type: 'invoice.paid', at: 5, customer: 'cus_1', data: { price: 'price_fake_starter', periodEnd: 9 } });
  assert.deepEqual(Object.keys(n), ['id', 'type', 'at', 'customer', 'data']); assert.deepEqual(n.data, { price: 'price_fake_starter', periodEnd: 9, familyId: null, checkoutId: null });
  for (const bad of [{ id: 'evt 1', type: 'x', at: 1, customer: 'c', data: {} }, { id: 'evt_1', type: 'x', at: -1, customer: 'c', data: {} }, { id: 'evt_1', type: 'x', at: 1, customer: 'c', data: { amount: 5 } },
    { id: 'evt_1', type: 'x', at: 1, customer: 'c', data: { plan: 'gold' } }, { id: 'evt_1', type: 'x', at: 1, customer: 'c', data: [] }, 'nope', null]) assert.throws(() => normalizeEvent(bad));
  assert.deepEqual(normalizeEvent({ id: 'evt_1', type: 'x', at: 1, customer: 'c' }).data, { price: null, periodEnd: null, familyId: null, checkoutId: null }); // data is optional
});
test('checkout: a parent chooses a purchasable plan; the server mints one customer reference per family and never takes one from the browser', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  for (const plan of ['trial', 'gold', 5, undefined]) await assert.rejects(f.payments.checkout(a.ctx, { plan }), rejected('INVALID_PLAN'));
  await assert.rejects(f.payments.checkout(a.ctx, { plan: 'starter', customerRef: 'cus_x' }), rejected('INVALID_REQUEST'));
  const op = randomUUID(); const co = await f.payments.checkout(a.ctx, { plan: 'starter', operationId: op });
  assert.equal(co.simulated, true); assert.equal(co.url, null); assert.equal(co.plan, 'starter'); assert.equal(co.checkoutId, op); assert.match(co.customerRef, /^cus_[0-9a-f-]{36}$/);
  assert.deepEqual(await f.payments.checkout(a.ctx, { plan: 'family', operationId: op }), co, 'a retried operation id is the same checkout, whatever the browser says now');
  const second = await f.payments.checkout(a.ctx, { plan: 'family', operationId: randomUUID() });
  assert.equal(second.customerRef, co.customerRef, 'one reference per family per provider');
  const fam = await f.store.get(`families/${a.familyId}`); assert.deepEqual(fam.billing, { fake: co.customerRef });
  const mapping = await f.store.get(`billingCustomers/fake:${co.customerRef}`); assert.equal(mapping.familyId, a.familyId); assert.equal(mapping.lastEventAt, 0);
  const rec = await f.store.get(`checkouts/fake:${op}`); assert.equal(rec.status, 'pending'); assert.equal(rec.familyId, a.familyId); assert.ok(rec.expireAt > f.now());
  assert.equal((await f.billing.view(a.ctx)).customer.fake, co.customerRef);
  const b = await f.family('parentB', 0); const cob = await f.payments.checkout(b.ctx, { plan: 'starter', operationId: randomUUID() });
  assert.notEqual(cob.customerRef, co.customerRef);
  await assert.rejects(f.payments.checkout(b.ctx, { plan: 'starter', operationId: op }), rejected('IDEMPOTENCY_CONFLICT')); // another family cannot replay A's checkout
  const k = await f.childSession('parentC'); await assert.rejects(f.payments.checkout(k.childCtx, { plan: 'starter', operationId: randomUUID() }), rejected('PARENT_REQUIRED'));
  f.advance(6 * 60_000); await assert.rejects(f.payments.checkout(a.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('REAUTHENTICATE'));
  assert.equal(co.priceId, 'price_fake_starter', 'the checkout names the provider price the plan maps to');
});
test('the whole life of a subscription through signed webhooks: checkout → paid → renewal failed → downgrade → deleted', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan: 'family', operationId: randomUUID() });
  const kids = []; await assert.rejects(f.child(a.ctx, 'One'), rejected('SUBSCRIPTION_INACTIVE'));
  const paidEvent = evt(co.customerRef, 'checkout.completed', { price: 'price_fake_family', periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId });
  const paid = await deliver(f, paidEvent);
  assert.deepEqual(paid, { status: 'applied', state: 'active', eventId: derivedEventId(`fake:${paidEvent.id}`) });
  assert.equal((await f.service.me(a.ctx)).family.entitlement.state, 'active'); assert.equal((await f.service.me(a.ctx)).family.entitlement.seatLimit, 4);
  for (const n of ['One', 'Two', 'Three']) kids.push((await f.child(a.ctx, n)).child);
  // recorded in the global inbox and as the family's own billing event, with the provider reference
  const inbox = await f.store.get(`billingEvents/fake:${paidEvent.id}`);
  assert.equal(inbox.familyId, a.familyId); assert.equal(inbox.outcome.status, 'applied'); assert.equal(typeof inbox.fingerprint, 'string'); assert.equal(inbox.customer, co.customerRef);
  const own = await f.store.get(`families/${a.familyId}/billing/${paid.eventId}`); assert.equal(own.type, 'payment.succeeded'); assert.equal(own.provider, 'fake'); assert.equal(own.providerRef, co.customerRef); assert.equal(own.actor, 'webhook:fake');
  assert.equal((await f.store.get(`checkouts/fake:${co.checkoutId}`)).status, 'completed');
  assert.equal((await f.store.get(`billingCustomers/fake:${co.customerRef}`)).lastEventId, paidEvent.id);
  // renewal failure: access runs on; the facts record it
  const failed = await deliver(f, evt(co.customerRef, 'invoice.payment_failed'));
  assert.equal(failed.status, 'applied'); assert.equal(failed.state, 'active'); assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.failures, 1);
  // a plan change the provider announces is not mapped in 3.3 (paid up/downgrade and the seat choice are 3.4): recorded, ignored, capacity untouched
  const changed = await deliver(f, evt(co.customerRef, 'subscription.updated', { price: 'price_fake_big' }));
  assert.deepEqual(changed, { status: 'ignored', reason: 'UNSUPPORTED_EVENT' });
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.seats, 4);
  // a payment whose price the gateway does not know: recorded, rejected, nothing applied
  const odd = evt(co.customerRef, 'invoice.paid', { price: 'price_fake_platinum', periodEnd: f.now() + 30 * DAY });
  assert.deepEqual(await deliver(f, odd), { status: 'rejected', reason: 'UNKNOWN_PRICE' });
  assert.equal((await f.store.get(`billingEvents/fake:${odd.id}`)).outcome.reason, 'UNKNOWN_PRICE');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.version, 2);
  // the provider ends it: cancelled now, children out
  const gone = await deliver(f, evt(co.customerRef, 'subscription.deleted')); assert.equal(gone.state, 'cancelled');
  assert.equal((await f.service.me(a.ctx)).family.entitlement.status, 'inactive');
  const sel = await f.service.authenticate(await f.service.lock(a.ctx)); await assert.rejects(f.service.selectChild(sel, kids[0].id, '763829'), rejected('SUBSCRIPTION_INACTIVE'));
  // and a new payment brings it back
  const small = await deliver(f, evt(co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY }));
  assert.deepEqual(small, { status: 'rejected', reason: 'SELECT_CHILDREN_FOR_DOWNGRADE' }, 'three seated children do not fit a two-seat comeback without a choice');
  const back = await deliver(f, evt(co.customerRef, 'invoice.paid', { price: 'price_fake_family', periodEnd: f.now() + 30 * DAY })); assert.equal(back.state, 'active');
  // nothing in any of that touched a wallet or wrote a ledger row
  for (const k of kids) assert.equal((await f.store.list(`families/${a.familyId}/learning/${k.id}/ledger`)).length, 0);
});
test('3.2-C: the inbox records before it acts — replay returns the stored outcome, a different payload under the same id is a conflict, an older event is ignored', async () => {
  const f = fixture(); const { a, co } = await subscribed(f, 'starter');
  const e = evt(co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY });
  const first = await deliver(f, e); assert.equal(first.status, 'applied');
  const version = (await f.store.get(`families/${a.familyId}`)).subscription.version;
  const again = await deliver(f, e); assert.deepEqual(again, { ...first, replayed: true });
  f.advance(1000); assert.deepEqual(await deliver(f, e), { ...first, replayed: true }); // and again, later, with a fresh signature
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.version, version, 'nothing moved twice');
  assert.equal((await f.store.list(`families/${a.familyId}/billing`)).length, 2, 'one family event per provider event');
  await assert.rejects(deliver(f, { ...e, data: { ...e.data, price: 'price_fake_big' } }), rejected('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(deliver(f, { ...e, type: 'subscription.deleted', data: {} }), rejected('IDEMPOTENCY_CONFLICT'));
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.plan, 'starter');
  // an event dated before the last applied one arrives late (provider retry after an outage): recorded, ignored
  const late = evt(co.customerRef, 'subscription.deleted', {}, { at: e.at - 1 });
  assert.deepEqual(await deliver(f, late), { status: 'ignored', reason: 'STALE_EVENT' });
  assert.equal((await f.store.get(`billingEvents/fake:${late.id}`)).outcome.reason, 'STALE_EVENT');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.state, 'active');
  // a provider event type the machine does not model is acknowledged, recorded and ignored
  const other = evt(co.customerRef, 'customer.updated');
  assert.deepEqual(await deliver(f, other), { status: 'ignored', reason: 'UNSUPPORTED_EVENT' });
  assert.equal((await f.store.get(`billingEvents/fake:${other.id}`)).type, 'customer.updated');
});
test('a webhook reaches a family only through the reference minted at checkout: unknown, mismatched or another family\'s references do nothing', async () => {
  const f = fixture(); const { a, co } = await subscribed(f, 'starter');
  const b = await f.family('parentB', 0); const cob = await f.payments.checkout(b.ctx, { plan: 'starter', operationId: randomUUID() });
  const before = await f.store.get(`families/${a.familyId}`);
  assert.deepEqual(await deliver(f, evt('cus_nobody', 'invoice.paid', { price: 'price_fake_big', periodEnd: f.now() + 30 * DAY })), { status: 'rejected', reason: 'UNKNOWN_CUSTOMER' });
  // B's reference naming A's family: refused, and B's own family is not subscribed either
  assert.deepEqual(await deliver(f, evt(cob.customerRef, 'invoice.paid', { price: 'price_fake_big', periodEnd: f.now() + 30 * DAY, familyId: a.familyId })), { status: 'rejected', reason: 'FAMILY_MISMATCH' });
  // B's reference naming A's checkout
  assert.deepEqual(await deliver(f, evt(cob.customerRef, 'checkout.completed', { price: 'price_fake_big', periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId })), { status: 'rejected', reason: 'CHECKOUT_MISMATCH' });
  // A's own reference, but paid for a plan other than the one this checkout was opened for
  assert.deepEqual(await deliver(f, evt(co.customerRef, 'checkout.completed', { price: 'price_fake_big', periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId })), { status: 'rejected', reason: 'CHECKOUT_MISMATCH' });
  assert.deepEqual(await f.store.get(`families/${a.familyId}`), before);
  assert.equal((await f.store.get(`families/${b.familyId}`)).subscription, undefined);
  assert.equal((await f.store.get(`checkouts/fake:${co.checkoutId}`)).status, 'completed');
  // a family cannot be told to pay under a reference it did not mint: the browser never supplies one
  await assert.rejects(f.payments.checkout(b.ctx, { plan: 'starter', operationId: randomUUID(), customerRef: co.customerRef }), rejected('INVALID_REQUEST'));
  await assert.rejects(f.payments.receive('stripe', Buffer.from('{}'), {}), rejected('NOT_FOUND'));
  await assert.rejects(f.payments.receive('constructor', Buffer.from('{}'), {}), rejected('NOT_FOUND'));
  await assert.rejects(f.payments.receive('fake', Buffer.alloc(WEBHOOK_BODY_LIMIT + 1), {}), rejected('REQUEST_TOO_LARGE'));
  await assert.rejects(f.payments.receive('fake', '{}', {}), rejected('INVALID_REQUEST'));
});
test('a signed body that is not a well-formed event is refused after the signature check, and is not recorded', async () => {
  const f = fixture(); const { co } = await subscribed(f, 'starter');
  const bad = signed(f, { id: 'evt_bad', type: 'invoice.paid', at: f.now(), customer: co.customerRef, data: { price: 'price fake' } });
  await assert.rejects(f.payments.receive('fake', bad.raw, bad.headers), rejected('INVALID_REQUEST'));
  // a payload that names a server plan, a seat count or a state is malformed by definition: the server never reads those from a provider
  for (const data of [{ plan: 'big' }, { seats: 6 }, { state: 'active' }, { price: 'price_fake_starter', plan: 'starter' }]) {
    const named = signed(f, { id: 'evt_named', type: 'invoice.paid', at: f.now(), customer: co.customerRef, data });
    await assert.rejects(f.payments.receive('fake', named.raw, named.headers), rejected('INVALID_REQUEST'));
  }
  assert.equal(await f.store.get('billingEvents/fake:evt_named'), null);
  const notJson = Buffer.from('{not json'); await assert.rejects(f.payments.receive('fake', notJson, { 'x-webhook-signature': signWebhook(webhookSecret, notJson, f.now()) }), rejected('INVALID_JSON'));
  assert.equal(await f.store.get('billingEvents/fake:evt_bad'), null);
  for (const t of Object.keys(PROVIDER_EVENTS)) assert.ok(['payment.succeeded', 'payment.failed', 'terminate'].includes(PROVIDER_EVENTS[t]));
  assert.ok(!Object.values(PROVIDER_EVENTS).includes('plan.change'), 'no webhook changes seat capacity before 3.4');
});
async function serverTest(t) {
  const f = fixture();
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, proxyHops: 0, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg, { billing: f.billing, payments: f.payments });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const hook = (event, { headers = {}, sign = true, method = 'POST', provider = 'fake', body } = {}) => {
    const raw = body ?? Buffer.from(JSON.stringify(event));
    return fetch(`${base}/api/webhooks/${provider}`, { method, headers: { 'Content-Type': 'application/json', ...(sign ? { 'X-Webhook-Signature': signWebhook(webhookSecret, raw, f.now()) } : {}), ...headers }, ...(method === 'POST' ? { body: raw } : {}) });
  };
  return { f, base, hook };
}
test('HTTP: the webhook route needs no cookie, CSRF token or Origin, only a valid signature; everything else about it fails closed', async (t) => {
  const s = await serverTest(t); const { a, co } = await subscribed(s.f, 'starter');
  const ok = await s.hook(evt(co.customerRef, 'invoice.paid', { price: 'price_fake_family', periodEnd: s.f.now() + 30 * DAY }));
  assert.equal(ok.status, 200); assert.equal((await ok.json()).status, 'applied'); assert.equal((await s.f.store.get(`families/${a.familyId}`)).subscription.plan, 'family');
  assert.equal(ok.headers.get('set-cookie'), null);
  const e = evt(co.customerRef, 'invoice.payment_failed');
  assert.equal((await s.hook(e, { sign: false })).status, 401);
  assert.equal((await s.hook(e, { headers: { 'X-Webhook-Signature': signWebhook(secret, Buffer.from(JSON.stringify(e)), s.f.now()) } })).status, 401);
  assert.equal((await s.hook(e, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await s.hook(e, { method: 'GET' })).status, 405);
  assert.equal((await s.hook(e, { provider: 'stripe' })).status, 404);
  assert.equal((await s.hook(e, { provider: 'FAKE' })).status, 404);
  assert.equal((await s.hook(e, { body: Buffer.alloc(WEBHOOK_BODY_LIMIT + 1, 32) })).status, 413);
  assert.equal((await s.hook(e, { body: Buffer.from('{oops') })).status, 400);
  assert.equal((await s.f.store.get(`families/${a.familyId}`)).subscription.failures, 0, 'none of that reached the machine');
  const r = await s.hook(e); assert.equal(r.status, 200); assert.equal((await r.json()).state, 'active'); assert.equal((await s.f.store.get(`families/${a.familyId}`)).subscription.failures, 1);
  const again = await s.hook(e); assert.equal((await again.json()).replayed, true);
  assert.equal((await s.hook({ ...e, type: 'subscription.deleted' })).status, 409);
});
test('HTTP: bad signatures from one address are budgeted; a checkout still needs the browser session, CSRF and a parent', async (t) => {
  const s = await serverTest(t); const { co } = await subscribed(s.f, 'starter');
  const e = evt(co.customerRef, 'invoice.payment_failed');
  let status; for (let i = 0; i < 61; i++) status = (await s.hook(e, { sign: false })).status;
  assert.equal(status, 429);
  assert.equal((await s.hook(e)).status, 200, 'a valid signature still lands: like login, the budget counts failures only, so a shared address cannot lock the provider out');
  assert.equal((await fetch(`${s.base}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"plan":"starter"}' })).status, 403);
  const bootstrap = await fetch(`${s.base}/api/bootstrap`); const cookie = bootstrap.headers.get('set-cookie').split(';')[0]; const { csrf } = await bootstrap.json();
  const anon = await fetch(`${s.base}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://pilot.example.test', 'X-CSRF-Token': csrf }, body: '{"plan":"starter"}' });
  assert.equal(anon.status, 401);
});
