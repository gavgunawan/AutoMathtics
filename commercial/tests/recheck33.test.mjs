// The review team's 3.3 re-check: S3.3-A durable checkout intent, S3.3-B no plan change by
// invoice alone, S3.3-C ordering semantics, checkout.completed bound to a known checkout, and the
// cancellation/renewal race — everything a real provider will need before Stage 4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, webhookSecret } from './support.mjs';
import { signWebhook, normalizeEvent, SIGNATURE_TOLERANCE_MS } from '../server/payments.mjs';

const DAY = 86_400_000;
const op = () => ({ operationId: randomUUID() });
const deliver = (f, event) => { const raw = Buffer.from(JSON.stringify(event)); return f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, f.now()) }); };
// events carry the fixture's clock: a real provider's timestamp must sit inside the signature window
const evt = (f, customer, type, data = {}, more = {}) => ({ id: `evt_${randomUUID()}`, type, at: f.now(), customer, data, ...more });
async function paidFamily(f, plan = 'starter', kids = ['A']) {
  const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan, ...op() });
  const paid = await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }));
  assert.equal(paid.status, 'applied', JSON.stringify(paid));
  const children = []; for (const n of kids) children.push((await f.child(a.ctx, n)).child);
  return { a, co, ids: children.map((c) => c.id) };
}

test('S3.3-A: the checkout intent is durable before the provider is called; a crash or a race between intent and provider resumes with the same idempotency key', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  const calls = []; const real = f.gateway.createCheckout.bind(f.gateway); let failNext = true;
  f.gateway.createCheckout = async (args) => { calls.push(args.idempotencyKey); if (failNext) { failNext = false; throw Error('provider unreachable'); } return real(args); };
  const id = randomUUID();
  await assert.rejects(f.payments.checkout(a.ctx, { plan: 'starter', operationId: id }), /provider unreachable/);
  const intent = await f.store.get(`checkouts/fake:${id}`);
  assert.equal(intent.status, 'creating'); assert.equal(intent.plan, 'starter'); assert.equal(intent.familyId, a.familyId); assert.equal(intent.result, null); // the intent survived the crash
  const co = await f.payments.checkout(a.ctx, { plan: 'starter', operationId: id }); // the browser retries
  assert.equal(co.checkoutId, id); assert.equal((await f.store.get(`checkouts/fake:${id}`)).status, 'pending');
  assert.deepEqual(calls, [id, id], 'the provider saw the same key both times, so it can return the same session');
  await assert.rejects(f.payments.checkout(a.ctx, { plan: 'family', operationId: id }), rejected('IDEMPOTENCY_CONFLICT'));
  // two simultaneous clicks with one operation id: one intent, one result, the provider only ever sees that key
  const id2 = randomUUID(); calls.length = 0;
  const both = await Promise.all([f.payments.checkout(a.ctx, { plan: 'family', operationId: id2 }), f.payments.checkout(a.ctx, { plan: 'family', operationId: id2 })]);
  assert.deepEqual(both[0], both[1]); assert.ok(calls.length >= 1 && calls.every((k) => k === id2), JSON.stringify(calls));
  assert.equal((await f.store.list('checkouts')).filter((c) => c.checkoutId === id2).length, 1);
  // a checkout.completed for an intent the provider did open but the server never marked pending (crash after the provider call) still completes it
  const id3 = randomUUID(); failNext = true;
  await assert.rejects(f.payments.checkout(a.ctx, { plan: 'family', operationId: id3 }), /provider unreachable/);
  const done = await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_family', periodEnd: f.now() + 30 * DAY, checkoutId: id3 }));
  assert.equal(done.status, 'applied'); assert.equal((await f.store.get(`checkouts/fake:${id3}`)).status, 'completed');
});
test('checkout.completed must name a checkout this server opened, for this family and plan, and only once', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan: 'starter', ...op() });
  const pay = (data) => deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY, ...data }));
  assert.deepEqual(await pay({}), { status: 'rejected', reason: 'CHECKOUT_REQUIRED' });
  assert.deepEqual(await pay({ checkoutId: randomUUID() }), { status: 'rejected', reason: 'UNKNOWN_CHECKOUT' });
  assert.deepEqual(await pay({ checkoutId: co.checkoutId, price: 'price_fake_big' }), { status: 'rejected', reason: 'CHECKOUT_MISMATCH' });
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription, undefined, 'none of that subscribed anyone');
  assert.equal((await pay({ checkoutId: co.checkoutId })).status, 'applied');
  assert.deepEqual(await pay({ checkoutId: co.checkoutId }), { status: 'rejected', reason: 'CHECKOUT_ALREADY_COMPLETED' }, 'a second, different completion event for the same checkout');
  const b = await f.family('parentB', 0); const cob = await f.payments.checkout(b.ctx, { plan: 'starter', ...op() });
  assert.deepEqual(await deliver(f, evt(f, cob.customerRef, 'checkout.completed', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId })), { status: 'rejected', reason: 'CHECKOUT_MISMATCH' });
});
test('S3.3-B: an invoice renews the plan on record; any other plan needs a server-recorded intent — a scheduled change, a checkout, or an operator', async () => {
  const f = fixture(); const { a, co, ids: [A] } = await paidFamily(f, 'family', ['A']); // four seats, one child seated: the "fits" case
  const renew = (plan, more = {}) => deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: `price_fake_${plan}`, periodEnd: f.now() + 60 * DAY }, more));
  assert.deepEqual(await renew('starter'), { status: 'requires_action', reason: 'PLAN_CHANGE_NOT_AUTHORIZED' }, 'a smaller plan the child would fit is still not a plan the family chose');
  assert.deepEqual(await renew('big'), { status: 'requires_action', reason: 'PLAN_CHANGE_NOT_AUTHORIZED' }, 'nor is a bigger one');
  let fam = await f.store.get(`families/${a.familyId}`); assert.equal(fam.subscription.plan, 'family'); assert.equal(fam.subscription.seats, 4);
  assert.equal((await renew('family')).status, 'applied', 'the same plan is an ordinary renewal');
  // the parent's scheduled downgrade is the intent: the renewal at that price lands and applies the seat choice
  await f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [A], ...op() });
  assert.equal((await renew('starter')).status, 'applied'); fam = await f.store.get(`families/${a.familyId}`); assert.equal(fam.subscription.seats, 2); assert.equal(fam.subscription.scheduled, null);
  // after an upgrade applied now (plan.change), the provider's next invoice at the new price is a renewal
  f.advance(2000); const p = await f.login('parentA');
  assert.equal((await f.payments.changePlan(p.ctx, { plan: 'big', ...op() })).kind, 'upgrade');
  assert.equal((await renew('big')).status, 'applied'); assert.equal((await renew('family')).outcome ?? (await renew('family')).reason, 'PLAN_CHANGE_NOT_AUTHORIZED');
  // a new checkout is an intent for the plan it was opened for — and for that plan only
  const co2 = await f.payments.checkout(p.ctx, { plan: 'starter', ...op() });
  assert.deepEqual(await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_family', periodEnd: f.now() + 30 * DAY, checkoutId: co2.checkoutId })), { status: 'rejected', reason: 'CHECKOUT_MISMATCH' });
  assert.equal((await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY, checkoutId: co2.checkoutId }))).status, 'applied');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.plan, 'starter');
  // the operator is an intent in person
  assert.equal((await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'big', periodEnd: f.now() + 30 * DAY }, 'test-operator')).entitlement.plan, 'big');
});
test('S3.3-B: the first paid plan comes from a checkout — an invoice that arrives before the checkout event is refused, then lands as a renewal on redelivery', async () => {
  const f = fixture(); const a = await f.family('parentA', 0); await f.billing.startTrial(a.ctx, op());
  const co = await f.payments.checkout(a.ctx, { plan: 'starter', ...op() });
  const invoice = evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY });
  assert.deepEqual(await deliver(f, invoice), { status: 'requires_action', reason: 'CHECKOUT_REQUIRED' });
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.state, 'trial');
  assert.equal((await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }))).status, 'applied');
  assert.equal((await f.store.get(`billingEvents/fake:${invoice.id}`)).outcome.status, 'applied', 'S3.4-D: the server reprocessed the waiting invoice itself when the checkout completed');
  assert.equal((await deliver(f, invoice)).replayed, true, 'the provider retrying it is a replay');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.state, 'active');
  // a cancelled or expired family comes back on its own plan by invoice, on another only through a checkout
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'terminate' }, 'test-operator');
  assert.deepEqual(await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_family', periodEnd: f.now() + 30 * DAY })), { status: 'requires_action', reason: 'PLAN_CHANGE_NOT_AUTHORIZED' });
  assert.equal((await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY }))).state, 'active');
});
test('cancellation/renewal race: a renewal never undoes a cancellation the parent asked for; the paid period is honoured and then it ends', async () => {
  const f = fixture(); const { a, co } = await paidFamily(f, 'starter', ['A']);
  await f.billing.cancel(a.ctx, op());
  const end = f.now() + 60 * DAY, r = await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: end }));
  assert.equal(r.status, 'applied'); const sub = (await f.store.get(`families/${a.familyId}`)).subscription;
  assert.equal(sub.cancelAtPeriodEnd, true, 'still cancelling'); assert.equal(sub.periodEnd, end, 'the period the provider charged for is honoured');
  const v = (await f.billing.view(a.ctx)).subscription; assert.equal(v.state, 'active'); assert.equal(v.cancelAtPeriodEnd, true);
  f.advance(60 * DAY + 1); const p = await f.login('parentA');
  assert.equal((await f.billing.view(p.ctx)).subscription.state, 'cancelled', 'no grace after a requested cancellation');
  // a fresh checkout is a fresh intent: it clears the old cancellation
  const co2 = await f.payments.checkout(p.ctx, { plan: 'starter', ...op() });
  await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY, checkoutId: co2.checkoutId }));
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.cancelAtPeriodEnd, false);
});
test('S3.3-C ordering: equal timestamps are ordered by the adapter sequence; an event dated in the future is refused before it can pin the clock', async () => {
  const f = fixture(); const { a, co } = await paidFamily(f, 'starter', ['A']);
  const at = f.now() + 1000;
  assert.equal((await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY }, { at, seq: 2 }))).status, 'applied');
  assert.deepEqual(await deliver(f, evt(f, co.customerRef, 'subscription.deleted', {}, { at, seq: 1 })), { status: 'ignored', reason: 'STALE_EVENT' }, 'same second, earlier in the provider\'s order');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.state, 'active');
  assert.equal((await f.store.get(`billingCustomers/fake:${co.customerRef}`)).lastEventSeq, 2);
  assert.equal((await deliver(f, evt(f, co.customerRef, 'subscription.deleted', {}, { at, seq: 3 }))).state, 'cancelled', 'same second, later in the provider\'s order');
  // without a sequence, events sharing a timestamp are processed in delivery order (documented: a real adapter must supply a total order)
  const at2 = at + 1;
  assert.equal((await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 90 * DAY }, { at: at2 }))).status, 'applied');
  assert.equal((await deliver(f, evt(f, co.customerRef, 'invoice.payment_failed', {}, { at: at2 }))).status, 'applied');
  // the future: a signed event dated beyond the signature window is malformed, not recorded
  const future = evt(f, co.customerRef, 'subscription.deleted', {}, { at: f.now() + SIGNATURE_TOLERANCE_MS + 60_000 });
  await assert.rejects(deliver(f, future), rejected('EVENT_IN_FUTURE'));
  assert.equal(await f.store.get(`billingEvents/fake:${future.id}`), null);
  assert.equal((await f.store.get(`billingCustomers/fake:${co.customerRef}`)).lastEventAt, at2, 'the clock was not pinned');
  assert.equal((await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 120 * DAY }, { at: at2 + 1 }))).status, 'applied', 'ordinary events still land');
  assert.throws(() => normalizeEvent({ id: 'e', type: 'x', at: 10, seq: -1, customer: 'c' }), rejected('INVALID_REQUEST'));
  assert.throws(() => normalizeEvent({ id: 'e', type: 'x', at: 10, seq: 'a', customer: 'c' }), rejected('INVALID_REQUEST'));
  assert.equal(normalizeEvent({ id: 'e', type: 'x', at: 10, seq: 7, customer: 'c' }, 10).seq, 7);
});
