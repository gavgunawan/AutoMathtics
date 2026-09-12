// Leaving, part two: the pause. The period already paid for is honoured, a paused family has no access and is never churn, the
// provider hears every pause and resume first, a crash in the middle is finished by the retry or by the provider's own echo, a
// late or out-of-order echo never rolls anything back, the renewal after a pause charges once, and the reconciliation and the
// nightly sweep both learn the paused state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, webhookSecret } from './support.mjs';
import { signWebhook } from '../server/payments.mjs';
import { Payments } from '../server/payments.mjs';
import { Support } from '../server/support.mjs';
import { deriveState, entitlementFor, transition, monthsAfter, PAUSE_MONTHS, GRACE_DAYS, DUNNING_DAYS } from '../server/subscription.mjs';
import { GRACE_AFTER_PAUSE_MS } from '../server/support.mjs';
import { PRICES, DAY, op, event, signed, stripeAccount } from './stripe-support.mjs';

const OPERATOR = 'ops@example.test';
const evt = (f, customer, type, data = {}, more = {}) => ({ id: `evt_${randomUUID()}`, type, at: f.now(), customer, data, ...more });
function deliver(f, ev, { at = f.now() } = {}) {
  const raw = Buffer.from(JSON.stringify(ev));
  return f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, at), 'content-type': 'application/json' });
}
/** A family paying for `plan` through the fake provider, with one child seated. */
async function paid(f, uid = 'parentA', plan = 'family') {
  const a = await f.family(uid, 0);
  const co = await f.payments.checkout(a.ctx, { plan, operationId: randomUUID() });
  const done = await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }));
  assert.equal(done.status, 'applied');
  const { child } = await f.child(a.ctx, 'Allison');
  return { a, co, child, periodEnd: f.now() + 30 * DAY };
}
const fresh = async (f, uid = 'parentA') => (await f.login(uid)).ctx;
const subOf = async (f, familyId) => (await f.store.get(`families/${familyId}`)).subscription;
const audits = async (f, action) => (await f.store.list('audit')).filter((r) => r.action === action);

test('the period already paid for is honoured, then a paused family has no access — and never counts as churn, however long it lasts', async (t) => {
  const f = fixture(), { a, child, periodEnd } = await paid(f);
  const r = await f.payments.pause(a.ctx, { months: 2, operationId: randomUUID() });
  assert.equal(r.state, 'active', 'the paid period runs to its end');
  const sub = await subOf(f, a.familyId);
  assert.deepEqual(sub.pause, { months: 2, pausedAt: f.now(), resumesAt: monthsAfter(periodEnd, 2), by: 'parent', echoed: false });
  let e = r.entitlement;
  assert.equal(e.status, 'active'); assert.equal(e.accessUntil, periodEnd); assert.equal(e.graceUntil, null, 'a paused subscription raises no invoice, so it has no grace to fall into');
  assert.deepEqual(e.pause, { months: 2, pausedAt: sub.pause.pausedAt, resumesAt: sub.pause.resumesAt, by: 'parent' });
  f.advance(30 * DAY - 1000); assert.equal(deriveState(sub, f.now()), 'active', 'still inside the paid period');
  f.advance(2000);
  e = entitlementFor(sub, f.now());
  assert.deepEqual([e.state, e.status, e.accessUntil, e.seatLimit], ['paused', 'inactive', 0, 4], 'past the period end: paused, and nothing granted');
  const sel = await f.service.authenticate(await f.service.lock(await fresh(f)));
  await assert.rejects(f.service.selectChild(sel, child.id, '763829'), rejected('SUBSCRIPTION_INACTIVE'));
  // however long it lasts, a pause is never cancelled, expired or past due: no churn count can mistake it for a family that left
  f.advance((GRACE_DAYS + DUNNING_DAYS + 60) * DAY);
  assert.equal(deriveState(sub, f.now()), 'paused');
  assert.equal((await f.service.me(await fresh(f))).family.entitlement.state, 'paused');
  t.diagnostic('a paused family holds its seats and its children keep their progress; it simply cannot play');
});

test('the invoice after the resume date brings the family back, and the same invoice delivered twice charges once', async () => {
  const f = fixture(), { a, co, periodEnd } = await paid(f);
  await f.payments.pause(a.ctx, { months: 1, operationId: randomUUID() });
  const resumesAt = (await subOf(f, a.familyId)).pause.resumesAt;
  f.advance(monthsAfter(periodEnd, 1) - f.now() + DAY);
  const renewal = evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_family', periodEnd: resumesAt + 30 * DAY });
  const back = await deliver(f, renewal);
  assert.deepEqual([back.status, back.state], ['applied', 'active']);
  const sub = await subOf(f, a.familyId);
  assert.equal(sub.pause, null, 'money arrived: the pause is over'); assert.equal(sub.periodEnd, resumesAt + 30 * DAY);
  const again = await deliver(f, renewal);
  assert.equal(again.replayed, true); assert.equal((await subOf(f, a.familyId)).periodEnd, resumesAt + 30 * DAY, 'no second period for one invoice');
  assert.equal((await subOf(f, a.familyId)).version, sub.version, 'and no second transition');
  assert.equal((await f.service.me(await fresh(f))).family.entitlement.status, 'active');
});

test('the provider hears the pause first, with behaviour void and the resume date; a retried tap is the same pause and tells the provider nothing', async () => {
  const f = fixture(), { a, periodEnd } = await paid(f), id = randomUUID();
  f.gateway.calls = [];
  const first = await f.payments.pause(a.ctx, { months: 3, operationId: id });
  assert.deepEqual(f.gateway.calls, [['pauseCollection', (await f.store.get(`families/${a.familyId}`)).billing.fake, monthsAfter(periodEnd, 3)]]);
  assert.equal((await f.gateway.pauseCollection({ idempotencyKey: id, customerRef: 'cus_x', resumesAt: 1 })).behavior, 'void', 'nothing is invoiced while it lasts, so a pause can never charge twice');
  const replay = await f.payments.pause(a.ctx, { months: 3, operationId: id });
  assert.deepEqual(replay, first, 'the same operation id is the same pause');
  assert.equal(f.gateway.calls.filter((c) => c[0] === 'pauseCollection').length, 2, 'the retry reaches the provider under the same idempotency key, which is what makes it harmless');
  await assert.rejects(f.payments.pause(a.ctx, { months: 1, operationId: id }), rejected('IDEMPOTENCY_CONFLICT'));
  assert.equal((await subOf(f, a.familyId)).pause.months, 3);
  assert.equal((await audits(f, 'billing.pause.start')).length, 1, 'one audit row for one pause');
  const row = await f.store.get(`families/${a.familyId}/billing/${id}`);
  assert.deepEqual([row.type, row.months, row.resumesAt, row.by, row.actor], ['pause.start', 3, null, 'parent', a.ctx.uid ?? row.actor]);
});

test('a resume ends it early: the provider first, then the record; a resume with nothing paused is refused', async () => {
  const f = fixture(), { a } = await paid(f);
  await f.payments.pause(a.ctx, { months: 2, operationId: randomUUID() });
  f.gateway.calls = [];
  const id = randomUUID(), r = await f.payments.resume(a.ctx, { operationId: id });
  assert.equal(r.state, 'active'); assert.equal((await subOf(f, a.familyId)).pause, null);
  assert.deepEqual(f.gateway.calls, [['resumeCollection', (await f.store.get(`families/${a.familyId}`)).billing.fake]]);
  assert.deepEqual(await f.payments.resume(a.ctx, { operationId: id }), r, 'the same operation id replays');
  assert.equal(f.gateway.calls.filter((c) => c[0] === 'resumeCollection').length, 1, 'a replay tells the provider nothing');
  await assert.rejects(f.payments.resume(a.ctx, { operationId: randomUUID() }), rejected('NOT_PAUSED'));
  assert.equal((await audits(f, 'billing.pause.end')).length, 1);
});

test('a crash between the provider and the record: the parent\'s retry finishes it, and so does the provider\'s echo on its own', async () => {
  const f = fixture(), { a, co, periodEnd } = await paid(f), id = randomUUID();
  const real = f.billing.pause.bind(f.billing);
  f.billing.pause = async () => { throw Error('the store went away after the provider was told'); };
  await assert.rejects(f.payments.pause(a.ctx, { months: 1, operationId: id }), /store went away/);
  assert.equal((await subOf(f, a.familyId)).pause, null, 'the provider is paused; the record is not');
  assert.equal(f.gateway.calls.filter((c) => c[0] === 'pauseCollection').length, 1);
  f.billing.pause = real;
  const done = await f.payments.pause(a.ctx, { months: 1, operationId: id }); // the same operation id: the same provider key, and the record catches up
  assert.equal(done.state, 'active'); assert.equal((await subOf(f, a.familyId)).pause.months, 1);
  // the same crash on another family, where the parent never came back: the provider's own echo is what reconciles it
  const b = await paid(f, 'parentB');
  f.billing.pause = async () => { throw Error('gone again'); };
  await assert.rejects(f.payments.pause(b.a.ctx, { months: 2, operationId: randomUUID() }), /gone again/);
  f.billing.pause = real;
  const echo = await deliver(f, evt(f, b.co.customerRef, 'subscription.paused', { resumesAt: monthsAfter(b.periodEnd, 2) }));
  assert.deepEqual([echo.status, echo.state], ['applied', 'active']);
  const sub = await subOf(f, b.a.familyId);
  assert.deepEqual(sub.pause, { months: null, pausedAt: f.now(), resumesAt: monthsAfter(b.periodEnd, 2), by: 'provider', echoed: true }, 'the provider is the authority: its date, and the months it never knew are null');
  assert.equal(deriveState(sub, b.periodEnd + 1), 'paused');
  void periodEnd;
});

test('the provider\'s echo of the server\'s own pause confirms it and changes nothing else; a pause the provider echoed is marked as echoed', async () => {
  const f = fixture(), { a, co, periodEnd } = await paid(f);
  await f.payments.pause(a.ctx, { months: 2, operationId: randomUUID() });
  const before = await subOf(f, a.familyId);
  const echo = await deliver(f, evt(f, co.customerRef, 'subscription.paused', { resumesAt: before.pause.resumesAt }));
  assert.equal(echo.status, 'applied');
  const after = await subOf(f, a.familyId);
  assert.deepEqual(after.pause, { ...before.pause, echoed: true }, 'the same pause, now confirmed by the provider');
  assert.equal(after.pausedAt, before.pausedAt); assert.equal(after.version, before.version + 1);
  // the provider says it resumes later than this server asked for: the provider wins, and the reconciliation has already seen it
  const later = await deliver(f, evt(f, co.customerRef, 'subscription.paused', { resumesAt: monthsAfter(periodEnd, 3) }));
  assert.equal(later.status, 'applied');
  assert.equal((await subOf(f, a.familyId)).pause.resumesAt, monthsAfter(periodEnd, 3));
  assert.equal((await subOf(f, a.familyId)).pause.months, 2, 'what the parent asked for is still on the record');
});

test('a late or out-of-order echo never rolls a pause back: an older one is stale, and a resume the server already made is a no-op', async () => {
  const f = fixture(), { a, co } = await paid(f);
  await f.payments.pause(a.ctx, { months: 1, operationId: randomUUID() });
  const pauseEcho = evt(f, co.customerRef, 'subscription.paused', { resumesAt: (await subOf(f, a.familyId)).pause.resumesAt });
  assert.equal((await deliver(f, pauseEcho)).status, 'applied');
  f.advance(60_000);
  const resumeEcho = evt(f, co.customerRef, 'subscription.resumed');
  assert.equal((await deliver(f, resumeEcho)).status, 'applied');
  assert.equal((await subOf(f, a.familyId)).pause, null);
  // the pause echo delivered again out of order (a provider retry after an outage), dated before the resume: ignored
  const stale = evt(f, co.customerRef, 'subscription.paused', { resumesAt: 1 }, { at: resumeEcho.at - 1 });
  assert.deepEqual(await deliver(f, stale), { status: 'ignored', reason: 'STALE_EVENT' });
  assert.equal((await subOf(f, a.familyId)).pause, null, 'the resume stands');
  // and a resume echo for a family that is not paused (the parent resumed first, then the provider echoed) changes nothing
  f.advance(60_000);
  const again = await deliver(f, evt(f, co.customerRef, 'subscription.resumed'));
  assert.equal(again.status, 'applied'); assert.equal((await subOf(f, a.familyId)).pause, null);
  assert.equal((await deliver(f, resumeEcho)).replayed, true, 'and the same echo again is a replay, not a second transition');
});

test('what a pause refuses: a trial, a cancellation already asked for, a period that is over, a month nobody offered, a child, a stale sign-in', async () => {
  const f = fixture();
  const trial = await f.family('parentTrial', 0);
  await f.billing.startTrial(trial.ctx, { operationId: randomUUID() });
  await assert.rejects(f.payments.pause(trial.ctx, { months: 1, operationId: randomUUID() }), rejected('INVALID_TRANSITION'), 'a trial collects nothing, so there is nothing to pause');
  const { a } = await paid(f);
  await f.payments.cancel(a.ctx, { operationId: randomUUID() });
  await assert.rejects(f.payments.pause(a.ctx, { months: 1, operationId: randomUUID() }), rejected('CANCEL_SCHEDULED'), 'a pause must never quietly undo a cancellation');
  await f.payments.cancel(a.ctx, { undo: true, operationId: randomUUID() });
  const grace = await paid(f, 'parentGrace'); f.advance(31 * DAY);
  await assert.rejects(f.payments.pause(await fresh(f, 'parentGrace'), { months: 1, operationId: randomUUID() }), rejected('INVALID_TRANSITION'), 'in grace the renewal comes first: an unpaid month is never paused into access');
  const none = await f.family('parentNone', 0);
  await assert.rejects(f.payments.pause(none.ctx, { months: 1, operationId: randomUUID() }), rejected('NO_SUBSCRIPTION'));
  await assert.rejects(f.payments.resume(none.ctx, { operationId: randomUUID() }), rejected('NO_SUBSCRIPTION'));
  for (const months of [0, 4, 12, '2', 1.5, null, undefined]) await assert.rejects(f.payments.pause(a.ctx, { months, operationId: randomUUID() }), rejected('INVALID_MONTHS'), String(months));
  await assert.rejects(f.payments.pause(a.ctx, { months: 1 }), rejected('OPERATION_ID_REQUIRED'));
  await assert.rejects(f.payments.pause(a.ctx, { months: 1, operationId: randomUUID(), until: 5 }), rejected('INVALID_REQUEST'));
  const k = await f.childSession('parentKid');
  await assert.rejects(f.payments.pause(k.childCtx, { months: 1, operationId: randomUUID() }), rejected('PARENT_REQUIRED'));
  const late = await fresh(f); f.advance(6 * 60_000);
  await assert.rejects(f.payments.pause(late, { months: 1, operationId: randomUUID() }), rejected('REAUTHENTICATE'), 'a pause is a money decision: it needs a fresh sign-in');
  assert.equal((await subOf(f, a.familyId)).pause, null, 'none of that paused anything');
  assert.deepEqual([...PAUSE_MONTHS], [1, 2, 3]);
});

test('cancelling a paused subscription ends it now, and ends it at the provider: no invoice can ever be raised for it again', async () => {
  const f = fixture(), { a, periodEnd } = await paid(f);
  await f.payments.pause(a.ctx, { months: 2, operationId: randomUUID() });
  f.advance(periodEnd - f.now() + DAY); // past the paid period: the family is paused
  const ctx = await fresh(f);
  assert.equal(deriveState(await subOf(f, a.familyId), f.now()), 'paused');
  f.gateway.calls = [];
  const r = await f.payments.cancel(ctx, { operationId: randomUUID() });
  assert.equal(r.state, 'cancelled');
  const sub = await subOf(f, a.familyId);
  assert.deepEqual([sub.state, sub.pause, sub.endedAt, sub.cancelAtPeriodEnd], ['cancelled', null, f.now(), true]);
  assert.deepEqual(f.gateway.calls.map((c) => c[0]), ['cancelSubscription'], 'a paused subscription is ended at the provider, not marked to end at a period end already past');
  await assert.rejects(f.payments.cancel(ctx, { undo: true, operationId: randomUUID() }), rejected('INVALID_TRANSITION'), 'it is over: subscribing again is a checkout');
  // an active subscription still cancels the old way
  const b = await paid(f, 'parentB'); f.gateway.calls = [];
  await f.payments.cancel(b.a.ctx, { operationId: randomUUID() });
  assert.deepEqual(f.gateway.calls.map((c) => c[0]), ['setCancelAtPeriodEnd']);
  assert.equal((await subOf(f, b.a.familyId)).state, 'active');
});

test('the machine on its own: an operator may pause and resume, the provider\'s echo may arrive in states this record did not expect, and a paid invoice always clears a pause', async () => {
  const f = fixture(), { a } = await paid(f);
  const applied = await f.billing.apply(a.familyId, { id: randomUUID(), type: 'pause.start', months: 1, by: 'parent' }, OPERATOR);
  assert.equal(applied.state, 'active'); assert.ok((await subOf(f, a.familyId)).pause);
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'pause.end', by: 'parent' }, OPERATOR);
  assert.equal((await subOf(f, a.familyId)).pause, null);
  // the pure transition, at the edges
  const base = { plan: 'family', seats: 4, state: 'active', periodEnd: 1000, version: 1 };
  assert.throws(() => transition(base, { type: 'pause.start', months: 2, by: 'parent' }, 2000), rejected('INVALID_TRANSITION'), 'the period is over: nothing to pause');
  assert.throws(() => transition(null, { type: 'pause.start', months: 2 }, 0), rejected('NO_SUBSCRIPTION'));
  assert.throws(() => transition(null, { type: 'pause.end' }, 0), rejected('NO_SUBSCRIPTION'));
  assert.equal(transition({ ...base, pause: { months: 1, pausedAt: 0, resumesAt: 5, by: 'parent', echoed: true } }, { type: 'pause.end' }, 10).pause, null);
  assert.equal(transition(base, { type: 'pause.end' }, 10).pause, null, 'a resume with nothing paused clears nothing twice');
  // a provider echo on a family whose record is past due (its pause never reached us, its invoices failed): the provider wins
  const late = transition({ ...base, periodEnd: 1000 }, { type: 'pause.start', by: 'provider', resumesAt: 9000 }, 1000 + (GRACE_DAYS + 1) * DAY);
  assert.deepEqual([late.pause.by, late.pause.resumesAt, late.pause.months, late.pause.echoed], ['provider', 9000, null, true]);
  // an echo about a subscription that has ended is for the operator, not for the machine
  assert.throws(() => transition({ ...base, state: 'cancelled' }, { type: 'pause.start', by: 'provider', resumesAt: 9000 }, 2000), rejected('INVALID_TRANSITION'));
  // and a terminate or a full refund takes the pause with it
  assert.equal(transition({ ...base, pause: { months: 1, pausedAt: 0, resumesAt: 5, by: 'parent', echoed: true } }, { type: 'terminate' }, 10).pause, null);
  assert.equal(transition({ ...base, pause: { months: 1, pausedAt: 0, resumesAt: 5, by: 'parent', echoed: true } }, { type: 'refund', amountCents: 900, full: true }, 10).pause, null);
});

// ---- Stripe: the calls, the echo and the reconciliation
function rig() {
  const f = fixture(), account = stripeAccount(f);
  const payments = new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'stripe', gateways: { stripe: account.gw }, now: f.now });
  const support = new Support({ foundation: f.service, store: f.store, billing: f.billing, payments, now: f.now });
  return { f, account, payments, support };
}
async function stripeSubscribed(r, uid = 'parentA', plan = 'family') {
  const { f, account, payments } = r, fam = await f.family(uid, 0);
  const chk = await payments.checkout(fam.ctx, { plan, ...op() });
  account.activate(PRICES[plan], f.now() + 30 * DAY);
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: chk.checkoutId, metadata: { familyId: fam.familyId, checkoutId: chk.checkoutId } });
  const s = signed(f, done); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  return { fam, chk };
}

test('Stripe: a pause is pause_collection with behaviour void and the resume date in seconds, keyed by the operation; a resume unsets it', async () => {
  const r = rig(), { f, account, payments } = r, { fam } = await stripeSubscribed(r);
  const periodEnd = (await subOf(f, fam.familyId)).periodEnd;
  account.calls.length = 0;
  const id = randomUUID();
  await payments.pause(fam.ctx, { months: 2, operationId: id });
  const call = account.calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1');
  assert.equal(call.body['pause_collection[behavior]'], 'void', 'void: Stripe raises no invoice at all, so nothing is collected later for a month the family did not have');
  assert.equal(Number(call.body['pause_collection[resumes_at]']), Math.floor(monthsAfter(periodEnd, 2) / 1000));
  assert.equal(call.headers['Idempotency-Key'], id, 'the operation id is the provider-side key: a retry pauses nothing twice');
  assert.deepEqual(account.state.sub.pause_collection, { behavior: 'void', resumes_at: Math.floor(monthsAfter(periodEnd, 2) / 1000) });
  assert.equal(account.gw.describe(account.state.sub).paused, true);
  assert.equal(account.gw.describe(account.state.sub).pauseResumesAt, Math.floor(monthsAfter(periodEnd, 2) / 1000) * 1000);
  account.calls.length = 0;
  await payments.resume(fam.ctx, { operationId: randomUUID() });
  const off = account.calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1');
  assert.equal(off.body.pause_collection, '', 'the empty value is how Stripe is told to remove it');
  assert.equal(account.state.sub.pause_collection, null); assert.equal(account.gw.describe(account.state.sub).paused, false);
  assert.equal((await subOf(f, fam.familyId)).pause, null);
});

test('Stripe: customer.subscription.updated is mapped only when it is pause_collection that changed, and the echo applies through the inbox', async () => {
  const r = rig(), { f, account, payments } = r, { fam } = await stripeSubscribed(r);
  const cus = account.state.customer.id, resumes = Math.floor((f.now() + 90 * DAY) / 1000);
  const paused = event(f, 'customer.subscription.updated', { object: 'subscription', id: 'sub_1', customer: cus, status: 'active', pause_collection: { behavior: 'void', resumes_at: resumes } }, { data: { object: { object: 'subscription', id: 'sub_1', customer: cus, status: 'active', pause_collection: { behavior: 'void', resumes_at: resumes } }, previous_attributes: { pause_collection: null } } });
  const ps = signed(f, paused); assert.equal((await payments.receive('stripe', ps.raw, ps.headers)).status, 'applied');
  const sub = await subOf(f, fam.familyId);
  assert.deepEqual([sub.pause.by, sub.pause.resumesAt, sub.pause.echoed], ['provider', resumes * 1000, true]);
  assert.equal((await f.store.get(`billingEvents/stripe:${paused.id}`)).type, 'subscription.paused');
  f.advance(1000);
  const resumed = event(f, 'customer.subscription.updated', { object: 'subscription', id: 'sub_1', customer: cus, status: 'active' }, { data: { object: { object: 'subscription', id: 'sub_1', customer: cus, status: 'active' }, previous_attributes: { pause_collection: { behavior: 'void' } } } });
  const rs = signed(f, resumed); assert.equal((await payments.receive('stripe', rs.raw, rs.headers)).status, 'applied');
  assert.equal((await subOf(f, fam.familyId)).pause, null);
  // an update that is not about a pause is recorded and ignored, exactly as every customer.subscription.updated was before
  f.advance(1000);
  const other = event(f, 'customer.subscription.updated', { object: 'subscription', id: 'sub_1', customer: cus, status: 'active' }, { data: { object: { object: 'subscription', id: 'sub_1', customer: cus, status: 'active' }, previous_attributes: { default_payment_method: 'pm_old' } } });
  const os = signed(f, other);
  assert.deepEqual(await payments.receive('stripe', os.raw, os.headers), { status: 'ignored', reason: 'UNSUPPORTED_EVENT' });
  assert.equal((await f.store.get(`billingEvents/stripe:${other.id}`)).type, 'customer.subscription.updated');
  assert.equal((await subOf(f, fam.familyId)).pause, null, 'and no webhook has moved a plan or a seat');
});

test('reconcile-provider compares the pause both ways, and the nightly sweep reports paused families and names a pause nobody echoed or that should have ended', async () => {
  const r = rig(), { f, account, payments, support } = r, { fam } = await stripeSubscribed(r);
  await payments.pause(fam.ctx, { months: 1, operationId: randomUUID() });
  let rec = await support.reconcileProvider(fam.familyId, OPERATOR);
  assert.deepEqual(rec.findings, [], 'paused at both ends, on the same date');
  assert.equal(rec.local.paused, true); assert.equal(rec.providers[0].subscription.paused, true); assert.equal(rec.match, true);
  // somebody un-paused it in the dashboard: the family would be charged for a month it was told it would not be
  account.state.sub.pause_collection = null;
  rec = await support.reconcileProvider(fam.familyId, OPERATOR);
  assert.deepEqual(rec.findings.map((x) => x.code), ['PAUSE_MISMATCH']);
  assert.match(rec.findings[0].detail, /the family is paused.*the provider is collecting as usual/);
  // and the other way: paused at the provider, not on the record
  await payments.resume(fam.ctx, { operationId: randomUUID() });
  account.state.sub.pause_collection = { behavior: 'keep_as_draft', resumes_at: Math.floor((f.now() + 60 * DAY) / 1000) };
  rec = await support.reconcileProvider(fam.familyId, OPERATOR);
  assert.deepEqual(rec.findings.map((x) => x.code), ['PAUSE_MISMATCH', 'PAUSE_BEHAVIOUR']);
  assert.match(rec.findings[1].detail, /"keep_as_draft", not "void"/);
  // the sweep: a paused family is counted, never a finding on its own
  account.state.sub.pause_collection = null;
  await payments.pause(fam.ctx, { months: 1, operationId: randomUUID() });
  let sweep = await support.inspectAll({ operator: OPERATOR });
  assert.equal(sweep.counts.paused, 1); assert.deepEqual(sweep.findings.map((x) => x.code), []);
  // a day on and the provider has still never echoed it: named, because a pause the provider does not have will charge
  f.advance(DAY + 1000);
  sweep = await support.inspectAll({ operator: OPERATOR });
  assert.deepEqual(sweep.findings.map((x) => x.code), ['PAUSE_NOT_ECHOED']);
  const echo = event(f, 'customer.subscription.updated', { object: 'subscription', id: 'sub_1', customer: account.state.customer.id, status: 'active', pause_collection: { behavior: 'void', resumes_at: Math.floor((await subOf(f, fam.familyId)).pause.resumesAt / 1000) } },
    { data: { object: { object: 'subscription', id: 'sub_1', customer: account.state.customer.id, status: 'active', pause_collection: { behavior: 'void', resumes_at: Math.floor((await subOf(f, fam.familyId)).pause.resumesAt / 1000) } }, previous_attributes: { pause_collection: null } } });
  const es = signed(f, echo); await payments.receive('stripe', es.raw, es.headers);
  sweep = await support.inspectAll({ operator: OPERATOR });
  assert.deepEqual(sweep.findings.map((x) => x.code), [], 'echoed: nothing to say');
  // the resume date has passed and no invoice was ever paid: the family is waiting for money that is not coming
  f.advance((await subOf(f, fam.familyId)).pause.resumesAt - f.now() + GRACE_AFTER_PAUSE_MS + 1000);
  sweep = await support.inspectAll({ operator: OPERATOR });
  assert.deepEqual(sweep.findings.map((x) => x.code), ['PAUSE_OVERDUE']);
  assert.equal(deriveState(await subOf(f, fam.familyId), f.now()), 'paused', 'and it is still not churn');
});
