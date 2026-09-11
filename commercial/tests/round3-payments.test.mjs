// Stage 4 review, third round — money and entitlement: an event names the subscription it is about; the inbox
// fingerprint is the provider's event, the facts are the invoice's own; a refund is never "stale"; the server
// reprocesses under the reference the provider pends on; a deletion tells the provider whatever the state; a
// held upgrade never unseats a child seated meanwhile; a fresh checkout ends the subscription the provider still holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { Payments, signWebhook } from '../server/payments.mjs';
import { Support } from '../server/support.mjs';
import { deriveState } from '../server/subscription.mjs';
import { PRICES, DAY, op, event, signed, stripeAccount } from './stripe-support.mjs';

const OPERATOR = 'ops@example.test';
function rig() {
  const f = fixture(), account = stripeAccount(f);
  const payments = new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'stripe', gateways: { stripe: account.gw }, now: f.now });
  const support = new Support({ foundation: f.service, store: f.store, billing: f.billing, payments, now: f.now });
  return { f, account, payments, support };
}
async function subscribed(r, fam, plan = 'starter', subId = 'sub_1') {
  const { f, account, payments } = r;
  const chk = await payments.checkout(fam.ctx, { plan, ...op() });
  account.activate(PRICES[plan]); account.state.sub.id = subId;
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: account.state.customer.id, subscription: subId, client_reference_id: chk.checkoutId, metadata: { familyId: fam.familyId, checkoutId: chk.checkoutId } });
  const s = signed(f, done); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  return chk;
}
const deliver = (r, ev) => { const s = signed(r.f, ev); return r.payments.receive('stripe', s.raw, s.headers); };
const family = (f, id) => f.store.get(`families/${id}`);
const invoice = (r, id, subId, lines, more = {}) => event(r.f, 'invoice.paid', { object: 'invoice', id, customer: r.account.state.customer.id, parent: { subscription_details: { subscription: subId } }, lines: { data: lines.map(([price, amount, end]) => ({ amount, price: { id: price }, period: { end: end ?? r.account.state.sub.current_period_end } })) } }, more);

test('an event names the subscription it is about: one for another subscription of the customer is recorded and ignored; a fresh checkout from past_due ends the old subscription at Stripe before a new one can be paid for', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter');
  let fam = await family(f, a.familyId); assert.equal(fam.subscription.providerSubscriptionRef, 'sub_1', 'the checkout recorded which subscription it paid for');
  // the customer's older subscription (sub_old) ends at Stripe: the family's live one is untouched
  f.advance(60_000);
  const gone = event(f, 'customer.subscription.deleted', { object: 'subscription', id: 'sub_old', status: 'canceled', customer: account.state.customer.id, metadata: { familyId: a.familyId } });
  const out = await deliver(r, gone); assert.equal(out.status, 'ignored'); assert.equal(out.reason, 'OTHER_SUBSCRIPTION');
  fam = await family(f, a.familyId); assert.equal(deriveState(fam.subscription, f.now()), 'active'); assert.equal((await f.store.get(`billingEvents/stripe:${gone.id}`)).outcome.reason, 'OTHER_SUBSCRIPTION');
  // so does a paid invoice of that other subscription, and a failed one
  const otherPaid = invoice(r, 'in_old', 'sub_old', [[PRICES.family, 900]]); assert.equal((await deliver(r, otherPaid)).reason, 'OTHER_SUBSCRIPTION');
  assert.equal((await family(f, a.familyId)).subscription.plan, 'starter');
  // the family's own subscription ending still ends the family
  f.advance(1000); const mine = event(f, 'customer.subscription.deleted', { object: 'subscription', id: 'sub_1', status: 'canceled', customer: account.state.customer.id });
  assert.equal((await deliver(r, mine)).status, 'applied'); assert.equal(deriveState((await family(f, a.familyId)).subscription, f.now()), 'cancelled');
  // a past_due family starts a fresh checkout: the subscription Stripe still holds is ended first, and the new one becomes the family's
  const g = rig(), b = await g.f.family('parentB', 0); await subscribed(g, b, 'starter');
  g.f.advance(38 * DAY); g.account.state.sub.status = 'past_due';
  const b2 = await g.f.login('parentB'); assert.equal(deriveState((await family(g.f, b.familyId)).subscription, g.f.now()), 'past_due');
  const before = g.account.calls.length, chk = await g.payments.checkout(b2.ctx, { plan: 'family', operationId: randomUUID() });
  assert.ok(chk.url); assert.equal(g.account.state.sub.status, 'canceled', 'sub_1 was ended at Stripe'); assert.ok(g.account.calls.slice(before).some((c) => c.method === 'DELETE' && c.path.startsWith('/v1/subscriptions/sub_1')));
  assert.equal((await g.f.store.get(`checkouts/stripe:${chk.checkoutId}`)).endedPrevious.cancelled, true);
  // Stripe's notice of sub_1's end arrives, then the new subscription's completion; a late invoice of sub_1 changes nothing
  g.f.advance(1000); assert.equal((await deliver(g, event(g.f, 'customer.subscription.deleted', { object: 'subscription', id: 'sub_1', status: 'canceled', customer: g.account.state.customer.id }))).status, 'applied');
  g.account.activate(PRICES.family); g.account.state.sub.id = 'sub_2';
  const done = event(g.f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: g.account.state.customer.id, subscription: 'sub_2', client_reference_id: chk.checkoutId, metadata: { familyId: b.familyId, checkoutId: chk.checkoutId } });
  g.f.advance(1000); assert.equal((await deliver(g, done)).status, 'applied');
  let fb = await family(g.f, b.familyId); assert.equal(fb.subscription.plan, 'family'); assert.equal(fb.subscription.providerSubscriptionRef, 'sub_2'); assert.equal(deriveState(fb.subscription, g.f.now()), 'active');
  g.f.advance(1000); const late = invoice(g, 'in_late', 'sub_1', [[PRICES.starter, 500, Math.floor((g.f.now() + 30 * DAY) / 1000)]]);
  assert.equal((await deliver(g, late)).reason, 'OTHER_SUBSCRIPTION'); fb = await family(g.f, b.familyId); assert.equal(fb.subscription.plan, 'family'); assert.equal(fb.subscription.providerSubscriptionRef, 'sub_2');
  const check = await support.reconcileProvider(a.familyId, OPERATOR); void check; // the report still runs on the first family
});
test('the inbox fingerprint is the provider\'s event and the facts are the invoice\'s own: a retry after the price moved is a replay, and a retried renewal after a scheduled downgrade applies the period the parent paid for', async () => {
  // (1) a renewal applied, its ack lost; the parent upgrades; Stripe retries the same event id
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter');
  f.advance(30 * DAY + 1000); account.state.sub.current_period_end = Math.floor((f.now() + 30 * DAY) / 1000);
  const inv = invoice(r, 'in_renew', 'sub_1', [[PRICES.starter, 500]]);
  assert.equal((await deliver(r, inv)).status, 'applied');
  f.advance(60_000); const a2 = await f.login('parentA'); account.state.upgradePayment = 'paid';
  assert.equal((await payments.changePlan(a2.ctx, { plan: 'family', operationId: randomUUID() })).entitlement.plan, 'family');
  f.advance(60_000); const again = await deliver(r, inv); assert.equal(again.replayed, true, 'the same event is the same event, whatever Stripe holds now');
  assert.equal((await family(f, a.familyId)).subscription.plan, 'family');
  // (2) a renewal on Big whose first delivery got no answer; the parent schedules a downgrade (Stripe's price moves now); the retry says Big
  const g = rig(), b = await g.f.family('parentB', 0); await subscribed(g, b, 'big');
  const A = (await g.f.child(b.ctx, 'A')).child.id, B = (await g.f.child(b.ctx, 'B')).child.id, C = (await g.f.child(b.ctx, 'C')).child.id;
  g.f.advance(30 * DAY + 1000); g.account.state.sub.current_period_end = Math.floor((g.f.now() + 30 * DAY) / 1000);
  const renew = invoice(g, 'in_renew_big', 'sub_1', [[PRICES.big, 1400]]);
  g.f.advance(6 * 3_600_000); const b2 = await g.f.login('parentB');
  const d = await g.payments.changePlan(b2.ctx, { plan: 'starter', seatChildIds: [A, B], operationId: randomUUID() }); assert.equal(d.kind, 'downgrade');
  assert.equal(g.account.state.sub.items.data[0].price.id, PRICES.starter, 'Stripe carries the next price already');
  g.f.advance(3_600_000); const out = await deliver(g, renew); assert.equal(out.status, 'applied');
  const fb = await family(g.f, b.familyId); assert.equal(fb.subscription.plan, 'big'); assert.equal(fb.subscription.seats, 6); assert.deepEqual(fb.activeChildIds, [A, B, C], 'nobody loses a seat in the period that was paid for');
  assert.equal(fb.subscription.scheduled.plan, 'starter', 'the downgrade still waits for the next renewal'); assert.equal((await g.f.store.get(`billingEvents/stripe:${renew.id}`)).data.price, PRICES.big);
  const row = await g.f.store.get(`families/${b.familyId}/billing/${out.eventId}`); assert.equal(row.subscriptionRef, 'sub_1');
});
test('a refund or a dispute delivered after a newer renewal still ends access, and never moves the ordering clock back', async () => {
  const r = rig(), { f, account } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter');
  const T1 = f.now() + 29 * DAY, T2 = f.now() + 30 * DAY;
  f.advance(30 * DAY + 30_000); account.state.sub.current_period_end = Math.floor((f.now() + 30 * DAY) / 1000);
  account.state.charge = { id: 'ch_1', customer: account.state.customer.id, amount: 500, amount_refunded: 0, refunded: false };
  const renewal = invoice(r, 'in_renew', 'sub_1', [[PRICES.starter, 500]], { created: Math.floor(T2 / 1000) });
  assert.equal((await deliver(r, renewal)).status, 'applied');
  const dispute = event(f, 'charge.dispute.created', { object: 'dispute', id: 'dp_1', charge: 'ch_1', amount: 500, status: 'needs_response' }, { created: Math.floor(T1 / 1000) });
  const out = await deliver(r, dispute); assert.equal(out.status, 'applied'); assert.equal(out.state, 'cancelled', 'the dispute ended access although it is older than the renewal');
  const mapping = await f.store.get(`billingCustomers/stripe:${account.state.customer.id}`); assert.equal(mapping.lastEventAt, Math.floor(T2 / 1000) * 1000, 'the clock stays at the renewal');
  // the same on the fake provider: a full refund created before the renewal, delivered after it
  const g = fixture(), b = await g.family('parentB', 0), secret = 'c3'.repeat(32);
  const co = await g.payments.checkout(b.ctx, { plan: 'starter', operationId: randomUUID() });
  const fake = (type, data, at) => { const raw = Buffer.from(JSON.stringify({ id: `evt_${randomUUID()}`, type, at, customer: co.customerRef, data })); return g.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(secret, raw, g.now()) }); };
  assert.equal((await fake('checkout.completed', { price: 'price_fake_starter', periodEnd: g.now() + 30 * DAY, checkoutId: co.checkoutId }, g.now())).status, 'applied');
  const t1 = g.now() + 29 * DAY, t2 = g.now() + 30 * DAY; g.advance(30 * DAY + 30_000);
  assert.equal((await fake('invoice.paid', { price: 'price_fake_starter', periodEnd: g.now() + 30 * DAY }, t2)).status, 'applied');
  const refunded = await fake('charge.refunded', { amountCents: 500, full: true, ref: 're_1' }, t1); assert.equal(refunded.status, 'applied'); assert.equal(refunded.state, 'cancelled');
  assert.equal((await family(g, b.familyId)).subscription.refunds.length, 1);
});
test('the server reprocesses under the reference the provider pends on: the parent\'s seat choice applies the waiting renewal; a row that waits longer than a day is a sweep finding', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'family');
  const A = (await f.child(a.ctx, 'A')).child.id, B = (await f.child(a.ctx, 'B')).child.id;
  assert.equal((await payments.changePlan(a.ctx, { plan: 'starter', operationId: randomUUID() })).kind, 'downgrade'); // A and B fit: no choice recorded
  f.advance(2000); const a2 = await f.login('parentA'); const C = (await f.child(a2.ctx, 'C')).child.id, D = (await f.child(a2.ctx, 'D')).child.id;
  assert.deepEqual((await family(f, a.familyId)).activeChildIds, [A, B, C, D]);
  f.advance(30 * DAY + 60_000); account.state.sub.current_period_end = Math.floor((f.now() + 30 * DAY) / 1000);
  const inv = invoice(r, 'in_renew', 'sub_1', [[PRICES.starter, 500]]);
  const out = await deliver(r, inv); assert.equal(out.status, 'requires_action'); assert.equal(out.reason, 'SELECT_CHILDREN_FOR_DOWNGRADE');
  assert.deepEqual((await f.store.get(`billingCustomers/stripe:${account.state.customer.id}`)).pending, [inv.id], 'pended on the alias Stripe delivers under');
  // a day passes: the sweep names the row
  f.advance(DAY + 1000); const sweep = await support.inspectAll({ operator: OPERATOR }); assert.equal(sweep.counts.inboxWaiting, 1);
  assert.ok(sweep.findings.some((x) => x.code === 'INBOX_WAITING_STALE' && x.family === a.familyId && x.detail.includes('SELECT_CHILDREN_FOR_DOWNGRADE')));
  // the parent chooses: the server applies the renewal itself, under the alias
  const a3 = await f.login('parentA'); const fixed = await payments.changePlan(a3.ctx, { plan: 'starter', seatChildIds: [A, B], operationId: randomUUID() }); assert.equal(fixed.kind, 'downgrade');
  const row = await f.store.get(`billingEvents/stripe:${inv.id}`); assert.equal(row.outcome.status, 'applied');
  const fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'starter'); assert.deepEqual(fam.activeChildIds, [A, B]); assert.equal(deriveState(fam.subscription, f.now()), 'active');
  assert.deepEqual((await f.store.get(`billingCustomers/stripe:${account.state.customer.id}`)).pending, []);
  assert.equal((await support.inspectAll({ operator: OPERATOR })).findings.length, 0);
});
test('a held upgrade never unseats a child seated while it waited; a deletion tells the provider whatever the state, and a tombstone that never asked is a finding', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'family');
  const A = (await f.child(a.ctx, 'A')).child.id, B = (await f.child(a.ctx, 'B')).child.id;
  account.state.upgradePayment = 'requires_action'; const opB = randomUUID();
  assert.equal((await payments.changePlan(a.ctx, { plan: 'big', seatChildIds: [A, B], operationId: opB })).pending, true);
  f.advance(2000); const a2 = await f.login('parentA'); const D = (await f.child(a2.ctx, 'D')).child.id; // a free Family seat: seated on creation
  const invoiceId = account.payPending(); f.advance(1000);
  const out = await deliver(r, invoice(r, invoiceId, 'sub_1', [[PRICES.family, -300], [PRICES.big, 700]])); assert.equal(out.status, 'applied'); assert.equal(out.upgrade, opB);
  const fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'big'); assert.deepEqual([...fam.activeChildIds].sort(), [A, B, D].sort()); assert.equal((await f.store.get(`families/${a.familyId}/children/${D}`)).status, 'active');
  // deletion of a past_due family: Stripe is told, and stops dunning
  const g = rig(), b = await g.f.family('parentB', 0); await subscribed(g, b, 'starter');
  g.f.advance(38 * DAY); g.account.state.sub.status = 'past_due'; const b2 = await g.f.login('parentB');
  assert.equal(deriveState((await family(g.f, b.familyId)).subscription, g.f.now()), 'past_due');
  await g.support.requestDeletion(b2.ctx, op()); const before = g.account.calls.length;
  const rec = await g.support.executeDeletion(b.familyId, { operator: OPERATOR, force: true });
  assert.equal(rec.providerCancellation.status, 'cancelled'); assert.equal(g.account.state.sub.status, 'canceled'); assert.ok(g.account.calls.slice(before).some((c) => c.method === 'DELETE'));
  assert.equal((await g.support.inspectAll({ operator: OPERATOR })).findings.length, 0);
  // a tombstone from before this rule: the provider was never asked
  await g.f.store.transaction(async (tx) => { const t = await tx.get(`families/${b.familyId}`); tx.set(`families/${b.familyId}`, { ...t, deletion: { ...t.deletion, providerCancellation: null } }); });
  const sweep = await g.support.inspectAll({ operator: OPERATOR }); assert.ok(sweep.findings.some((x) => x.code === 'DELETED_FAMILY_PROVIDER_LIVE' && x.family === b.familyId && /never asked/.test(x.detail)));
  void rejected;
});
