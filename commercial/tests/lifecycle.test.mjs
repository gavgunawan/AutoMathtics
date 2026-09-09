// Stage 3.4 — the subscription lifecycle: upgrade now, downgrade at renewal with the parent's seat
// choice, cancel unchanged, refunds as records that never touch a wallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, webhookSecret } from './support.mjs';
import { transition, deriveState, PLANS } from '../server/subscription.mjs';
import { signWebhook } from '../server/payments.mjs';

const DAY = 86_400_000, T0 = Date.parse('2026-09-10T00:00:00Z');
const op = () => ({ operationId: randomUUID() });
const deliver = (f, event) => { const raw = Buffer.from(JSON.stringify(event)); return f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, f.now()) }); };
const evt = (customer, type, data = {}) => ({ id: `evt_${randomUUID()}`, type, at: Date.now(), customer, data });
async function paidFamily(f, plan = 'family', kids = ['A', 'B', 'C']) {
  const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan, ...op() });
  const paid = await deliver(f, evt(co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }));
  assert.equal(paid.status, 'applied');
  const children = []; for (const n of kids) children.push((await f.child(a.ctx, n)).child);
  return { a, co, children, ids: children.map((c) => c.id) };
}
async function parentAgain(f) { f.advance(2000); return f.login('parentA'); }

test('the machine: a scheduled downgrade waits for the renewal; a refund is a record, a full refund ends access now', () => {
  const paid = transition(null, { type: 'payment.succeeded', plan: 'family', periodEnd: T0 + 30 * DAY }, T0);
  const sched = transition(paid, { type: 'plan.schedule', plan: 'starter', seatChildIds: ['a'] }, T0 + DAY);
  assert.deepEqual(sched.scheduled, { plan: 'starter', seats: 2, seatChildIds: ['a'], at: T0 + 30 * DAY, requestedAt: T0 + DAY }); assert.equal(sched.seats, 4, 'capacity untouched until then');
  assert.equal(transition(sched, { type: 'plan.schedule', plan: 'family' }, T0 + DAY).scheduled, null, 'asking for the current plan clears it');
  assert.equal(transition(sched, { type: 'plan.schedule', plan: null }, T0 + DAY).scheduled, null);
  const renewed = transition(sched, { type: 'payment.succeeded', plan: 'starter', periodEnd: T0 + 60 * DAY }, T0 + 30 * DAY);
  assert.equal(renewed.seats, 2); assert.equal(renewed.scheduled, null);
  assert.equal(transition(sched, { type: 'plan.change', plan: 'big' }, T0 + 2 * DAY).scheduled, null, 'an immediate change replaces the schedule');
  assert.equal(transition(sched, { type: 'terminate' }, T0 + 2 * DAY).scheduled, null);
  assert.throws(() => transition(paid, { type: 'plan.schedule', plan: 'trial' }, T0), rejected('INVALID_PLAN'));
  const trial = transition(null, { type: 'trial.start' }, T0);
  assert.throws(() => transition(trial, { type: 'plan.schedule', plan: 'starter' }, T0), rejected('INVALID_TRANSITION'));
  const partial = transition(paid, { type: 'refund', amountCents: 300 }, T0 + 5 * DAY);
  assert.equal(deriveState(partial, T0 + 5 * DAY), 'active'); assert.equal(partial.refunds.length, 1); assert.equal(partial.refunds[0].full, false);
  const full = transition(partial, { type: 'refund', amountCents: 900, full: true }, T0 + 6 * DAY);
  assert.equal(deriveState(full, T0 + 6 * DAY), 'cancelled'); assert.equal(full.refunds.length, 2); assert.equal(full.endedAt, T0 + 6 * DAY);
  assert.throws(() => transition(paid, { type: 'refund', amountCents: -1 }, T0), rejected('INVALID_REQUEST'));
  assert.throws(() => transition(paid, { type: 'refund' }, T0), rejected('INVALID_REQUEST'));
  assert.throws(() => transition(null, { type: 'refund', amountCents: 1 }, T0), rejected('INVALID_TRANSITION'));
});
test('a parent upgrades now: capacity grows at once, the provider is asked for the prorated difference, and a retried click is the same change', async () => {
  const f = fixture(); const { a, ids } = await paidFamily(f, 'starter', ['A', 'B']);
  f.advance(15 * DAY); const p = await parentAgain(f); // half way through the period
  const id = randomUUID(); const up = await f.payments.changePlan(p.ctx, { plan: 'family', operationId: id });
  assert.equal(up.kind, 'upgrade'); assert.equal(up.entitlement.seatLimit, 4); assert.equal(up.entitlement.plan, 'family'); assert.equal(up.entitlement.scheduled, null);
  const diff = PLANS.family.priceCents - PLANS.starter.priceCents;
  assert.equal(up.proration.simulated, true); assert.ok(Math.abs(up.proration.chargeCents - diff / 2) <= 1, `half the difference for half the period: ${JSON.stringify(up.proration)}`);
  assert.deepEqual(await f.payments.changePlan(p.ctx, { plan: 'family', operationId: id }), up, 'the same operation id is the same change');
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', operationId: id }), rejected('IDEMPOTENCY_CONFLICT'));
  const rec = await f.store.get(`families/${a.familyId}/billing/${id}`); assert.equal(rec.type, 'plan.change'); assert.equal(rec.proration.chargeCents, up.proration.chargeCents); assert.equal(rec.provider, 'fake');
  assert.deepEqual((await f.store.get(`families/${a.familyId}`)).activeChildIds, ids, 'the seated children are untouched');
  assert.ok((await f.child(p.ctx, 'C')).child.id, 'the new seat is usable at once');
  assert.equal((await f.payments.changePlan(p.ctx, { plan: 'family', ...op() })).kind, 'clear', 'asking for the current plan is a no-op clear');
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'family', seatChildIds: 'A,B', ...op() }), rejected('INVALID_SEAT_SELECTION'));
});
test('a parent downgrades: the seat choice is recorded now, nobody loses a seat mid-cycle, and the renewal applies it', async () => {
  const f = fixture(); const { a, co, ids: [A, B, C] } = await paidFamily(f, 'family', ['A', 'B', 'C']);
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'starter', ...op() }), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [A, randomUUID()], ...op() }), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [A, B, C], ...op() }), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  const down = await f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [A, B], ...op() });
  assert.equal(down.kind, 'downgrade'); assert.equal(down.proration, null); assert.equal(down.entitlement.seatLimit, 4, 'capacity stays until renewal');
  assert.equal(down.entitlement.scheduled.plan, 'starter'); assert.equal(down.entitlement.scheduled.seats, 2); assert.equal(down.entitlement.scheduled.at, down.entitlement.periodEnd);
  assert.deepEqual((await f.store.get(`families/${a.familyId}`)).activeChildIds, [A, B, C], '3.2-A: nobody is removed mid-cycle');
  assert.equal((await f.store.get(`families/${a.familyId}/children/${C}`)).status, 'active');
  assert.equal((await f.billing.view(a.ctx)).subscription.scheduled.planName, 'Starter');
  // the provider renews at the smaller price: the recorded choice applies
  const renewal = evt(co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY });
  assert.equal((await deliver(f, renewal)).status, 'applied');
  const fam = await f.store.get(`families/${a.familyId}`);
  assert.deepEqual(fam.activeChildIds, [A, B]); assert.equal(fam.subscription.seats, 2); assert.equal(fam.subscription.scheduled, null);
  assert.equal((await f.store.get(`families/${a.familyId}/children/${C}`)).status, 'inactive');
  // C's progress is intact and comes back with an upgrade that names all three
  const p = await parentAgain(f);
  const up = await f.payments.changePlan(p.ctx, { plan: 'family', seatChildIds: [A, B, C], ...op() }); assert.equal(up.kind, 'upgrade'); assert.deepEqual(up.activated, [C]);
  assert.equal((await f.store.get(`families/${a.familyId}/children/${C}`)).status, 'active');
  // a schedule can be replaced or cleared
  await f.payments.changePlan(p.ctx, { plan: 'starter', seatChildIds: [A, B], ...op() });
  assert.equal((await f.payments.changePlan(p.ctx, { plan: 'family', ...op() })).kind, 'clear');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.scheduled, null);
  // a renewal on a different plan than the scheduled one is the provider's truth: applied if the children fit, refused if not
  await f.payments.changePlan(p.ctx, { plan: 'starter', seatChildIds: [A, B], ...op() });
  assert.equal((await deliver(f, evt(co.customerRef, 'invoice.paid', { price: 'price_fake_big', periodEnd: f.now() + 90 * DAY }))).state, 'active');
  const after = await f.store.get(`families/${a.familyId}`); assert.equal(after.subscription.seats, 6); assert.equal(after.subscription.scheduled, null); assert.deepEqual(after.activeChildIds, [A, B, C]);
});
test('a renewal the machine refused is recorded as rejected; once the parent has chosen seats, the provider\'s redelivery of the same event is applied', async () => {
  const f = fixture(); const { a, co, ids: [A, B] } = await paidFamily(f, 'family', ['A', 'B', 'C']);
  const renewal = evt(co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY });
  assert.deepEqual(await deliver(f, renewal), { status: 'rejected', reason: 'SELECT_CHILDREN_FOR_DOWNGRADE' });
  assert.equal((await f.store.get(`billingEvents/fake:${renewal.id}`)).attempts, 1);
  assert.deepEqual(await deliver(f, renewal), { status: 'rejected', reason: 'SELECT_CHILDREN_FOR_DOWNGRADE' }, 'still refused while nobody has chosen');
  await f.payments.changePlan(a.ctx, { plan: 'starter', seatChildIds: [A, B], ...op() });
  const again = await deliver(f, renewal); assert.equal(again.status, 'applied'); assert.equal(again.replayed, undefined);
  const rec = await f.store.get(`billingEvents/fake:${renewal.id}`); assert.equal(rec.outcome.status, 'applied'); assert.equal(rec.attempts, 3);
  assert.deepEqual((await f.store.get(`families/${a.familyId}`)).activeChildIds, [A, B]);
  assert.deepEqual(await deliver(f, renewal), { ...again, replayed: true }, 'and from now on it is a replay');
  assert.equal((await f.store.list(`families/${a.familyId}/billing`)).length, 3, 'checkout, schedule, renewal: one row each');
  await assert.rejects(deliver(f, { ...renewal, data: { ...renewal.data, price: 'price_fake_big' } }), rejected('IDEMPOTENCY_CONFLICT'));
});
test('refunds: a partial refund is a record and access continues; a full refund from the provider ends access now; wallets are never touched', async () => {
  const f = fixture(); const { a, co, ids: [A] } = await paidFamily(f, 'starter', ['A']);
  const r1 = await f.billing.apply(a.familyId, { id: randomUUID(), type: 'refund', amountCents: 200 }, 'test-operator');
  assert.equal(r1.state, 'active'); assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.refunds.length, 1);
  await assert.rejects(f.billing.apply(a.familyId, { id: randomUUID(), type: 'refund' }, 'test-operator'), rejected('INVALID_REQUEST'));
  await assert.rejects(f.billing.apply(a.familyId, { id: randomUUID(), type: 'refund', amountCents: 5, full: 'yes' }, 'test-operator'), rejected('INVALID_REQUEST'));
  const gone = await deliver(f, evt(co.customerRef, 'charge.refunded', { amountCents: 300, full: true }));
  assert.equal(gone.status, 'applied'); assert.equal(gone.state, 'cancelled');
  assert.equal((await f.service.me(a.ctx)).family.entitlement.status, 'inactive');
  const sub = (await f.store.get(`families/${a.familyId}`)).subscription; assert.equal(sub.refunds.length, 2); assert.equal(sub.refunds[1].providerRef, co.customerRef); assert.equal(sub.refunds[1].full, true);
  assert.equal((await f.billing.view(a.ctx)).subscription.refunds, 2);
  assert.equal((await f.store.list(`families/${a.familyId}/learning/${A}/ledger`)).length, 0, 'money back through the provider never becomes coins');
  const odd = evt(co.customerRef, 'charge.refunded', {}); // a refund without an amount: recorded, refused
  assert.deepEqual(await deliver(f, odd), { status: 'rejected', reason: 'INVALID_REQUEST' });
  const sel = await f.service.authenticate(await f.service.lock(a.ctx)); await assert.rejects(f.service.selectChild(sel, A, '763829'), rejected('SUBSCRIPTION_INACTIVE'));
});
test('plan changes are parent-only, need an operation id, and are not available on a trial or without a subscription', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'family' }), rejected('OPERATION_ID_REQUIRED'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'gold', ...op() }), rejected('INVALID_PLAN'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'family', seats: 9, ...op() }), rejected('INVALID_REQUEST'));
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'family', ...op() }), rejected('NO_SUBSCRIPTION'));
  await f.billing.startTrial(a.ctx, op());
  await assert.rejects(f.payments.changePlan(a.ctx, { plan: 'family', ...op() }), rejected('CHECKOUT_REQUIRED'));
  const k = await f.childSession('parentB'); await assert.rejects(f.payments.changePlan(k.childCtx, { plan: 'family', ...op() }), rejected('PARENT_REQUIRED'));
  // and the subscription's own cancel path is unchanged by 3.4
  const c = await f.billing.cancel(a.ctx, op()); assert.equal(c.entitlement.cancelAtPeriodEnd, true); assert.equal(c.state, 'trial');
});
