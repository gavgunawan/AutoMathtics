// The review team's 3.4 findings: S3.4-A (the seat choice is part of the request), S3.4-B (an
// upgrade never drops a seated child), grace upgrades, the refund bound, and the durable change
// intent that makes a real provider's plan change atomic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, webhookSecret } from './support.mjs';
import { signWebhook, INTENT_INFLIGHT_MS } from '../server/payments.mjs';

const DAY = 86_400_000;
const op = () => ({ operationId: randomUUID() });
const deliver = (f, event) => { const raw = Buffer.from(JSON.stringify(event)); return f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, f.now()) }); };
const evt = (f, customer, type, data = {}, more = {}) => ({ id: `evt_${randomUUID()}`, type, at: f.now(), customer, data, ...more });
async function paidFamily(f, plan = 'starter', kids = ['A']) {
  const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan, ...op() });
  assert.equal((await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }))).status, 'applied');
  const children = []; for (const n of kids) children.push((await f.child(a.ctx, n)).child);
  return { a, co, ids: children.map((c) => c.id) };
}
const parentAgain = async (f) => { f.advance(2000); return f.login('parentA'); };

test('S3.4-A: the same operation id with a different seat choice is a conflict, not a replay', async () => {
  const f = fixture(); const { a, ids: [A, B, C] } = await paidFamily(f, 'family', ['A', 'B', 'C']);
  const id = randomUUID();
  const first = await f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [A, B], operationId: id });
  assert.equal(first.kind, 'downgrade');
  assert.deepEqual(await f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [B, A], operationId: id }), first, 'same choice in another order: the same request');
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [A, C], operationId: id }), rejected('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'starter', operationId: id }), rejected('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'big', seatChildIds: [A, B], operationId: id }), rejected('IDEMPOTENCY_CONFLICT'));
  assert.deepEqual((await f.store.get(`families/${a.familyId}`)).subscription.scheduled.seatChildIds, [A, B], 'the first choice stands');
  const intent = await f.store.get(`billingChangeIntents/fake:${id}`); assert.equal(intent.status, 'applied'); assert.equal(intent.kind, 'downgrade'); assert.deepEqual(intent.seatChildIds, [A, B]);
  const b = await f.family('parentB', 0); await assert.rejects(f.payments.changePlan(b.ctx, { plan: 'starter', seatChildIds: [A, B], operationId: id }), rejected('IDEMPOTENCY_CONFLICT'));
});
test('S3.4-B: an upgrade may seat more children but can never drop a seated one', async () => {
  const f = fixture(); const { a, ids: [A, B] } = await paidFamily(f, 'starter', ['A', 'B']);
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'family', seatChildIds: [A], ...op() }), rejected('SEATS_CANNOT_REMOVE'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'family', seatChildIds: [], ...op() }), rejected('SEATS_CANNOT_REMOVE'));
  const fam = await f.store.get(`families/${a.familyId}`); assert.deepEqual(fam.activeChildIds, [A, B]); assert.equal(fam.subscription.seats, 2, 'nothing moved');
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'family', seatChildIds: [A, B, randomUUID()], ...op() }), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  const up = await f.payments.changePlan(a.ctx, { plan: 'family', seatChildIds: [A, B], ...op() }); assert.equal(up.kind, 'upgrade'); assert.deepEqual(up.activeChildIds, [A, B]);
});
test('an upgrade in grace is refused (the renewal comes first); a downgrade can still be scheduled into it', async () => {
  const f = fixture(); const { a, co, ids: [A] } = await paidFamily(f, 'family', ['A']);
  f.advance(31 * DAY); const p = await parentAgain(f);
  assert.equal((await f.billing.view(p.ctx)).subscription.state, 'grace');
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', ...op() }), rejected('RENEWAL_REQUIRED'));
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.seats, 4, 'no free capacity for a zero prorated charge');
  const down = await f.payments.changePlan(p.ctx, { plan: 'starter', seatChildIds: [A], ...op() }); assert.equal(down.kind, 'downgrade');
  const renewal = await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY }));
  assert.equal(renewal.status, 'applied'); assert.equal(renewal.state, 'active'); assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.seats, 2);
  const p2 = await parentAgain(f); assert.equal((await f.payments.changePlan(p2.ctx, { plan: 'big', ...op() })).kind, 'upgrade', 'active again: upgrades are back');
});
test('durable change intent: one provider call in flight per family, resumed after a crash with the same key, never finalised against a subscription that moved', async () => {
  const f = fixture(); const { a } = await paidFamily(f, 'starter', ['A']);
  const calls = []; const real = f.gateway.changePlan.bind(f.gateway); let hook = null; // eslint-disable-line prefer-const
  f.gateway.changePlan = async (args) => { calls.push(args.idempotencyKey); if (hook) { const h = hook; hook = null; await h(); } return real(args); };
  // two simultaneous, different upgrades: exactly one reaches the provider
  const [x, y] = await Promise.allSettled([f.payments.changePlan(a.ctx, { plan: 'family', ...op() }), f.payments.changePlan(a.ctx, { plan: 'big', ...op() })]);
  assert.equal([x, y].filter((r) => r.status === 'fulfilled').length, 1); assert.equal([x, y].find((r) => r.status === 'rejected').reason.code, 'CHANGE_IN_PROGRESS');
  assert.equal(calls.length, 1); const seats = (await f.store.get(`families/${a.familyId}`)).subscription.seats; assert.ok(seats === 4 || seats === 6);
  assert.equal((await f.store.get(`families/${a.familyId}`)).billingIntent, null, 'the in-flight marker is cleared');
  // the provider call succeeds but the server dies before finalising: the retry resumes the same intent with the same key
  const p = await parentAgain(f); const id = randomUUID(); calls.length = 0;
  hook = async () => { throw Error('server died'); };
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', operationId: id }), /server died/);
  assert.equal((await f.store.get(`billingChangeIntents/fake:${id}`)).status, 'creating');
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', ...op() }), rejected('CHANGE_IN_PROGRESS'), 'another change waits while this one is in flight');
  const done = await f.payments.changePlan(p.ctx, { plan: 'big', operationId: id }); assert.equal(done.kind, 'upgrade');
  assert.deepEqual(calls, [id, id], 'the same idempotency key both times');
  assert.equal((await f.store.get(`billingChangeIntents/fake:${id}`)).status, 'applied');
  assert.deepEqual(await f.payments.changePlan(p.ctx, { plan: 'big', operationId: id }), done, 'and afterwards a replay');
  // the subscription moves while the provider is being asked: the intent goes stale and nothing is finalised against old facts
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'starter', periodEnd: f.now() + 30 * DAY }, 'test-operator'); // back to starter (operator intent)
  const p2 = await parentAgain(f); const id2 = randomUUID(); const version = (await f.store.get(`families/${a.familyId}`)).subscription.version;
  hook = async () => { await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.failed' }, 'test-operator'); };
  await assert.rejects(f.payments.changePlan(p2.ctx, { plan: 'family', operationId: id2 }), rejected('SUBSCRIPTION_CHANGED'));
  const stale = await f.store.get(`billingChangeIntents/fake:${id2}`); assert.equal(stale.status, 'stale'); assert.equal(stale.subscriptionVersion, version);
  const fam = await f.store.get(`families/${a.familyId}`); assert.equal(fam.subscription.plan, 'starter'); assert.equal(fam.billingIntent, null);
  await assert.rejects(f.payments.changePlan(p2.ctx, { plan: 'family', operationId: id2 }), rejected('SUBSCRIPTION_CHANGED'), 'the stale intent stays stale');
  assert.equal((await f.payments.changePlan(p2.ctx, { plan: 'family', ...op() })).kind, 'upgrade', 'a fresh request against the current facts works');
  // an abandoned in-flight intent stops blocking after the in-flight window
  const p3 = await parentAgain(f); const id3 = randomUUID(); hook = async () => { throw Error('server died'); };
  await assert.rejects(f.payments.changePlan(p3.ctx, { plan: 'big', operationId: id3 }), /server died/);
  f.advance(INTENT_INFLIGHT_MS + 1000); const p4 = await parentAgain(f);
  assert.equal((await f.payments.changePlan(p4.ctx, { plan: 'big', ...op() })).kind, 'upgrade', 'a later change may take over');
  await assert.rejects(f.payments.changePlan(p4.ctx, { plan: 'big', operationId: id3 }), rejected('SUBSCRIPTION_CHANGED'), 'and the abandoned one can no longer finalise');
});
test('refunds need a positive amount, from the operator and from the provider', async () => {
  const f = fixture(); const { a, co } = await paidFamily(f, 'starter', ['A']);
  await assert.rejects(f.billing.apply(a.familyId, { id: randomUUID(), type: 'refund', amountCents: 0, full: true }, 'test-operator'), rejected('INVALID_REQUEST'));
  assert.deepEqual(await deliver(f, evt(f, co.customerRef, 'charge.refunded', { amountCents: 0, full: true })), { status: 'rejected', reason: 'INVALID_REQUEST' });
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.state, 'active');
});
