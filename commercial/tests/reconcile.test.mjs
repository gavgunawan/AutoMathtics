// Stage 4.2 — the family's decisions reach the provider, and the provider's truth is compared with
// the family's record: cancel-at-period-end and its undo, a scheduled downgrade, the deletion of
// a family; `reconcile-provider` findings; `resolve-event` for rows the server could not apply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { Payments } from '../server/payments.mjs';
import { Support } from '../server/support.mjs';
import { PRICES, DAY, op, event, signed, stripeAccount } from './stripe-support.mjs';

const OPERATOR = 'ops@example.test';
/** A fixture whose payments run against a recorded Stripe account. */
function rig() {
  const f = fixture(), account = stripeAccount(f);
  const payments = new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'stripe', gateways: { stripe: account.gw }, now: f.now });
  const support = new Support({ foundation: f.service, store: f.store, billing: f.billing, payments, now: f.now });
  return { f, account, payments, support };
}
/** Checkout, then Stripe's completion event: the family holds a paid subscription and Stripe holds the matching one. */
async function subscribed(r, fam, plan = 'starter') {
  const { f, account, payments } = r;
  const chk = await payments.checkout(fam.ctx, { plan, ...op() });
  account.activate(PRICES[plan]);
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: chk.checkoutId, metadata: { familyId: fam.familyId, checkoutId: chk.checkoutId } });
  const s = signed(f, done); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  return chk;
}
const family = async (f, id) => f.store.get(`families/${id}`);
const down = (account) => { const real = account.gw.fetch; account.gw.fetch = async () => { throw Error('ECONNRESET'); }; return () => { account.gw.fetch = real; }; };

test('cancel at period end, and its undo, reach Stripe under the operation id before the record changes; a replay, an invalid transition and a trial tell the provider nothing; a provider fault changes nothing', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0); await subscribed(r, a);
  const before = account.calls.length, opc = randomUUID();
  const res = await payments.cancel(a.ctx, { operationId: opc });
  assert.equal(res.entitlement.cancelAtPeriodEnd, true); assert.equal(account.state.sub.cancel_at_period_end, true, 'Stripe will not renew');
  const call = account.calls.slice(before).find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1');
  assert.equal(call.body.cancel_at_period_end, 'true'); assert.equal(call.headers['Idempotency-Key'], opc);
  assert.ok(!account.calls.slice(before).some((c) => c.method === 'POST' && c.path === '/v1/customers'), 'a cancellation never creates a customer');
  const n = account.calls.length; assert.equal((await payments.cancel(a.ctx, { operationId: opc })).entitlement.cancelAtPeriodEnd, true); assert.equal(account.calls.length, n, 'a replayed click tells the provider nothing');
  await assert.rejects(payments.cancel(a.ctx, { operationId: opc, undo: true }), rejected('IDEMPOTENCY_CONFLICT'));
  const opu = randomUUID(); await payments.cancel(a.ctx, { operationId: opu, undo: true });
  assert.equal(account.state.sub.cancel_at_period_end, false); assert.equal((await family(f, a.familyId)).subscription.cancelAtPeriodEnd, false);
  assert.equal(account.calls.at(-1).headers['Idempotency-Key'], opu);
  const m = account.calls.length; await assert.rejects(payments.cancel(a.ctx, { operationId: randomUUID(), undo: true }), rejected('INVALID_TRANSITION')); assert.equal(account.calls.length, m, 'the machine refuses first; the provider is never asked');
  const restore = down(account);
  await assert.rejects(payments.cancel(a.ctx, { operationId: randomUUID() }), rejected('PROVIDER_UNREACHABLE'));
  restore(); assert.equal((await family(f, a.familyId)).subscription.cancelAtPeriodEnd, false, 'nothing changed locally while the provider was down');
  await assert.rejects(payments.cancel(a.ctx, { undo: true }), rejected('OPERATION_ID_REQUIRED'));
  // a trial has no provider side
  const b = await f.family('parentB', 0); await f.billing.startTrial(b.ctx, op());
  const t = account.calls.length; assert.equal((await payments.cancel(b.ctx, op())).entitlement.cancelAtPeriodEnd, true); assert.equal(account.calls.length, t);
  await assert.rejects(payments.cancel((await f.family('parentC', 0)).ctx, op()), rejected('NO_SUBSCRIPTION'));
});
test('a scheduled downgrade moves Stripe to the new price without proration through the durable intent; clearing it moves back; the renewal on the new price applies it', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'big');
  const opd = randomUUID(), res = await payments.changePlan(a.ctx, { plan: 'starter', operationId: opd });
  assert.equal(res.kind, 'downgrade'); assert.equal(res.entitlement.scheduled.plan, 'starter'); assert.equal(res.proration, null);
  const call = account.calls.find((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1');
  assert.equal(call.body['items[0][price]'], PRICES.starter); assert.equal(call.body.proration_behavior, 'none', 'nothing is charged or credited now'); assert.equal(call.headers['Idempotency-Key'], opd);
  assert.equal(account.state.sub.items.data[0].price.id, PRICES.starter, 'the next invoice carries the new price');
  const intent = await f.store.get(`billingChangeIntents/stripe:${opd}`); assert.equal(intent.status, 'applied'); assert.equal(intent.providerOperationRef, 'sub_1'); assert.equal(intent.proration, null);
  let fam = await family(f, a.familyId); assert.equal(fam.billingIntent, null); assert.equal(fam.subscription.plan, 'big'); assert.equal(fam.subscription.scheduled.plan, 'starter');
  const n = account.calls.length; assert.equal((await payments.changePlan(a.ctx, { plan: 'starter', operationId: opd })).kind, 'downgrade'); assert.equal(account.calls.length, n, 'replay: nothing sent');
  // clearing the schedule puts Stripe back on the plan the family is on
  const opk = randomUUID(); assert.equal((await payments.changePlan(a.ctx, { plan: 'big', operationId: opk })).kind, 'clear');
  assert.equal(account.state.sub.items.data[0].price.id, PRICES.big); assert.equal((await family(f, a.familyId)).subscription.scheduled, null);
  assert.equal((await f.store.get(`billingChangeIntents/stripe:${opk}`)).providerOperationRef, 'sub_1');
  const m = account.calls.length; await payments.changePlan(a.ctx, { plan: 'big', operationId: randomUUID() }); assert.equal(account.calls.length, m, 'clearing nothing sends nothing');
  // schedule again; a provider fault leaves the schedule unset and the intent open for a retry
  const restore = down(account), opx = randomUUID();
  await assert.rejects(payments.changePlan(a.ctx, { plan: 'starter', operationId: opx }), rejected('PROVIDER_UNREACHABLE'));
  restore(); fam = await family(f, a.familyId); assert.equal(fam.subscription.scheduled, null); assert.equal((await f.store.get(`billingChangeIntents/stripe:${opx}`)).status, 'creating');
  assert.equal((await payments.changePlan(a.ctx, { plan: 'starter', operationId: opx })).entitlement.scheduled.plan, 'starter', 'the same operation resumes');
  // the renewal invoice carries the scheduled price: the family lands on starter
  const end = account.state.sub.current_period_end * 1000;
  const renew = event(f, 'invoice.paid', { object: 'invoice', customer: account.state.customer.id, lines: { data: [{ price: { id: PRICES.starter }, period: { end: Math.floor((end + 30 * DAY) / 1000) } }] } });
  const s = signed(f, renew); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'starter'); assert.equal(fam.subscription.scheduled, null); assert.equal(fam.subscription.seats, 2, 'starter seats');
});
test('a deletion ends the subscription at Stripe before terminate is recorded; the late notice from Stripe is reconciliation_required until the operator resolves it; a provider fault is recorded and flagged, never fatal', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'family');
  await support.requestDeletion(a.ctx, op());
  const rec = await support.executeDeletion(a.familyId, { operator: OPERATOR, force: true });
  assert.equal(rec.providerCancellation.status, 'cancelled'); assert.equal(rec.providerCancellation.providerOperationRef, 'sub_1'); assert.equal(rec.providerCancellation.simulated, false);
  assert.deepEqual(account.state.deleted, ['/v1/subscriptions/sub_1']); assert.equal(account.state.sub.status, 'canceled', 'Stripe stops billing');
  assert.equal((await family(f, a.familyId)).deleted, true);
  const gone = event(f, 'customer.subscription.deleted', { object: 'subscription', customer: account.state.customer.id, metadata: { familyId: a.familyId } });
  let s = signed(f, gone); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'reconciliation_required', reason: 'FAMILY_DELETED' });
  let report = await support.familyReport(a.familyId); assert.equal(report.attention.reconciliationRequired, 1);
  await assert.rejects(support.resolveEvent('stripe', gone.id, { operator: OPERATOR, outcome: 'closed', note: 'x' }), rejected('INVALID_REQUEST'));
  await assert.rejects(support.resolveEvent('stripe', gone.id, { operator: 'x', outcome: 'cancelled_at_provider', note: 'x' }), rejected('OPERATOR_REQUIRED'));
  await assert.rejects(support.resolveEvent('stripe', 'evt_nope', { operator: OPERATOR, outcome: 'cancelled_at_provider', note: 'x' }), rejected('EVENT_NOT_FOUND'));
  const res = await support.resolveEvent('stripe', gone.id, { operator: OPERATOR, outcome: 'cancelled_at_provider', note: 'Ended by the deletion job; Stripe confirmed.' });
  assert.equal(res.kind, 'event'); assert.equal(res.previousOutcome, 'reconciliation_required'); assert.equal(res.reason, 'FAMILY_DELETED'); assert.equal(res.familyId, a.familyId);
  assert.equal((await f.store.get(`billingReconciliations/${res.id}`)).operator, OPERATOR);
  const row = await f.store.get(`billingEvents/stripe:${gone.id}`); assert.equal(row.outcome.status, 'reconciliation_required'); assert.equal(row.outcome.resolution.outcome, 'cancelled_at_provider');
  report = await support.familyReport(a.familyId); assert.equal(report.attention.reconciliationRequired, 0); assert.equal(report.inbox.at(-1).outcome.resolution.operator, OPERATOR);
  assert.equal((await support.inbox('reconciliation_required')).at(-1).outcome.resolution.outcome, 'cancelled_at_provider');
  await assert.rejects(support.resolveEvent('stripe', gone.id, { operator: OPERATOR, outcome: 'no_action_needed', note: 'again' }), rejected('EVENT_ALREADY_RESOLVED'));
  s = signed(f, gone); assert.equal((await payments.receive('stripe', s.raw, s.headers)).replayed, true, 'a redelivery is a replay, the resolution stays');
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'support.event_resolved' && x.uid === OPERATOR));
  // an applied event is not open to resolution; a rejected one is
  const applied = report.inbox.find((e) => e.outcome.status === 'applied'); await assert.rejects(support.resolveEvent('stripe', applied.id, { operator: OPERATOR, outcome: 'no_action_needed', note: 'x' }), rejected('EVENT_NOT_OPEN'));
  const stray = event(f, 'invoice.paid', { object: 'invoice', customer: 'cus_nobody', lines: { data: [{ price: { id: PRICES.starter }, period: { end: Math.floor((f.now() + 30 * DAY) / 1000) } }] } });
  s = signed(f, stray); assert.equal((await payments.receive('stripe', s.raw, s.headers)).reason, 'UNKNOWN_CUSTOMER');
  assert.equal((await support.resolveEvent('stripe', stray.id, { operator: OPERATOR, outcome: 'no_action_needed', note: 'a test-mode customer created in the dashboard' })).familyId, null);
  // the provider being down does not stop a deletion: the failure is on the record, and the report flags the subscription left live
  const r2 = rig(), b = await r2.f.family('parentB', 0); await subscribed(r2, b); await r2.support.requestDeletion(b.ctx, op());
  const restore = down(r2.account);
  const rec2 = await r2.support.executeDeletion(b.familyId, { operator: OPERATOR, force: true });
  assert.equal(rec2.providerCancellation.status, 'failed'); assert.equal(rec2.providerCancellation.reason, 'PROVIDER_UNREACHABLE'); assert.equal((await family(r2.f, b.familyId)).deleted, true);
  restore(); assert.equal(r2.account.state.sub.status, 'active', 'still billing at Stripe');
  const check = await r2.support.reconcileProvider(b.familyId, OPERATOR);
  assert.deepEqual(check.findings.map((x) => x.code), ['DELETED_FAMILY_PROVIDER_LIVE']); assert.equal(check.deleted, true); assert.equal(check.match, false);
  // a rerun of the job on the tombstone changes nothing at the provider
  const d = r2.account.calls.length; await r2.support.executeDeletion(b.familyId, { operator: OPERATOR, force: true }); assert.equal(r2.account.calls.length, d);
});
test('reconcile-provider: Stripe agrees, then drifts on plan, cancel flag and period end; a scheduled downgrade explains a different price; a lost subscription, a lost customer and an unreachable provider are findings, not exceptions; open intents carry provider evidence', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'family');
  let c = await support.reconcileProvider(a.familyId, OPERATOR);
  assert.equal(c.kind, 'provider_state'); assert.equal(c.match, true); assert.deepEqual(c.findings, []); assert.equal(c.operator, OPERATOR);
  assert.equal(c.providers[0].subscription.plan, 'family'); assert.equal(c.providers[0].customer.id, 'cus_live1'); assert.equal(c.local.plan, 'family'); assert.equal(c.local.state, 'active');
  assert.ok(!JSON.stringify(c).includes('sk_test'), 'nothing secret in the record');
  assert.equal((await f.store.get(`billingReconciliations/${c.id}`)).match, true);
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'support.provider_reconciled' && x.uid === OPERATOR && x.match === true));
  let report = await support.familyReport(a.familyId); assert.deepEqual(report.attention.providerCheck, { at: c.at, match: true, findings: [] });
  assert.ok(!account.calls.some((x) => x.method !== 'GET' && x.path.includes('customers') && x.path !== '/v1/customers'), 'a check never writes at the provider');
  // drift: the dashboard moved the price, set the cancel flag and pushed the period end
  account.state.sub.items.data[0].price.id = PRICES.big; account.state.sub.cancel_at_period_end = true; account.state.sub.current_period_end += 10 * 86_400;
  f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR);
  assert.deepEqual(c.findings.map((x) => x.code).sort(), ['CANCEL_FLAG_MISMATCH', 'PERIOD_END_MISMATCH', 'PLAN_MISMATCH']); assert.equal(c.match, false);
  assert.match(c.findings.find((x) => x.code === 'PLAN_MISMATCH').detail, /provider big; family family/);
  report = await support.familyReport(a.familyId); assert.equal(report.attention.providerCheck.match, false); assert.equal(report.attention.providerCheck.findings.length, 3);
  account.state.sub.items.data[0].price.id = PRICES.family; account.state.sub.cancel_at_period_end = false; account.state.sub.current_period_end -= 10 * 86_400;
  // a scheduled downgrade explains the provider's price
  await payments.changePlan(a.ctx, { plan: 'starter', operationId: randomUUID() });
  f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.deepEqual(c.findings, []); assert.equal(c.providers[0].subscription.plan, 'starter'); assert.equal(c.local.scheduledPlan, 'starter');
  // an unknown price at the provider
  account.state.sub.items.data[0].price.id = 'price_legacy'; f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.deepEqual(c.findings.map((x) => x.code), ['UNKNOWN_PROVIDER_PRICE']);
  account.state.sub.items.data[0].price.id = PRICES.starter;
  // an open intent with provider evidence
  const opi = randomUUID(); await f.store.transaction(async (tx) => tx.set(`billingChangeIntents/stripe:${opi}`, { provider: 'stripe', operationId: opi, familyId: a.familyId, kind: 'upgrade', fromPlan: 'family', toPlan: 'big', status: 'creating', providerOperationRef: 'sub_1:in_9', createdAt: f.now() }));
  f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.equal(c.intents.length, 1); assert.equal(c.intents[0].providerEvidence, 'provider_on_other_plan');
  account.state.sub.items.data[0].price.id = PRICES.big; f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.equal(c.intents[0].providerEvidence, 'provider_on_target_plan'); assert.deepEqual(c.findings.map((x) => x.code), ['PLAN_MISMATCH']);
  account.state.sub.items.data[0].price.id = PRICES.starter; await support.reconcileIntent('stripe', opi, { operator: OPERATOR, outcome: 'no_provider_change', note: 'checked' });
  // Stripe lost the subscription, then the customer
  const kept = account.state.sub; account.state.sub = { ...kept, status: 'canceled' }; f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.deepEqual(c.findings.map((x) => x.code), ['NO_PROVIDER_SUBSCRIPTION']); assert.equal(c.intents.length, 0);
  account.state.sub = null; f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.deepEqual(c.findings.map((x) => x.code), ['NO_PROVIDER_SUBSCRIPTION']);
  const cus = account.state.customer; account.state.customer = null; f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.deepEqual(c.findings.map((x) => x.code), ['NO_PROVIDER_CUSTOMER']);
  account.state.customer = cus; account.state.sub = kept;
  // unreachable: a finding and no verdict, never an exception
  const restore = down(account); f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.deepEqual(c.findings.map((x) => x.code), ['PROVIDER_UNREACHABLE']); assert.equal(c.match, null); restore();
  // a cancelled family whose subscription still bills at the provider
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'terminate' }, OPERATOR);
  f.advance(1000); c = await support.reconcileProvider(a.familyId, OPERATOR); assert.deepEqual(c.findings.map((x) => x.code), ['PROVIDER_SUBSCRIPTION_LIVE']);
  // the fake provider holds no state: simulated, no findings, no verdict
  const b = await f.family('parentB', 0); await f.payments.checkout(b.ctx, { plan: 'starter', ...op() });
  const sim = await f.support.reconcileProvider(b.familyId, OPERATOR); assert.equal(sim.providers[0].simulated, true); assert.deepEqual(sim.findings, []); assert.equal(sim.match, null);
  await assert.rejects(support.reconcileProvider(randomUUID(), OPERATOR), rejected('FAMILY_NOT_FOUND'));
  await assert.rejects(support.reconcileProvider(a.familyId, ''), rejected('OPERATOR_REQUIRED'));
});
test('the fake provider simulates the same effects: the pilot sees what would be sent, nothing is charged', async () => {
  const f = fixture(), a = await f.family('parentA', 0);
  const chk = await f.payments.checkout(a.ctx, { plan: 'big', ...op() });
  const done = { id: 'evt_done', type: 'checkout.completed', at: f.now(), seq: 1, customer: chk.customerRef, data: { price: 'price_fake_big', periodEnd: f.now() + 30 * DAY, familyId: a.familyId, checkoutId: chk.checkoutId } };
  const raw = Buffer.from(JSON.stringify(done)); assert.equal((await f.payments.receive('fake', raw, { 'x-webhook-signature': f.gateway.sign(raw, f.now()) })).status, 'applied');
  await f.payments.cancel(a.ctx, op()); await f.payments.changePlan(a.ctx, { plan: 'starter', operationId: randomUUID() });
  assert.deepEqual(f.gateway.calls.map((c) => c[0]), ['setCancelAtPeriodEnd', 'schedulePlan']); assert.equal(f.gateway.calls[0][2], true); assert.equal(f.gateway.calls[1][2], 'starter');
  await f.support.requestDeletion(a.ctx, op()); const rec = await f.support.executeDeletion(a.familyId, { operator: OPERATOR, force: true });
  assert.equal(rec.providerCancellation.status, 'cancelled'); assert.equal(rec.providerCancellation.simulated, true); assert.equal(f.gateway.calls.at(-1)[0], 'cancelSubscription');
});
test('an upgrade is granted only when its payment is: charged on the spot → new plan now; held by Stripe (failed or needs authentication) → old plan stays, seats stay, no second change; the paid invoice applies it once', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter');
  // charged on the spot
  const opA = randomUUID(); account.state.upgradePayment = 'paid';
  const up = await payments.changePlan(a.ctx, { plan: 'family', operationId: opA }); assert.equal(up.kind, 'upgrade'); assert.equal(up.pending, undefined); assert.equal(up.entitlement.plan, 'family');
  let fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'family'); assert.equal(fam.subscription.seats, 4); assert.equal(fam.billingIntent, null);
  assert.equal((await f.store.get(`billingChangeIntents/stripe:${opA}`)).status, 'applied');
  // the card fails, or needs authentication: Stripe holds the update
  const opB = randomUUID(); account.state.upgradePayment = 'requires_action';
  const held = await payments.changePlan(a.ctx, { plan: 'big', operationId: opB });
  assert.equal(held.pending, true); assert.equal(held.kind, 'upgrade'); assert.equal(held.plan, 'big'); assert.match(held.invoiceUrl, /^https:\/\/invoice\.stripe\.com\//); assert.equal(held.state, 'active');
  fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'family', 'the old plan stays'); assert.equal(fam.subscription.seats, 4, 'no seat is granted'); assert.equal(fam.billingIntent.operationId, opB, 'the marker stays');
  const intent = await f.store.get(`billingChangeIntents/stripe:${opB}`); assert.equal(intent.status, 'awaiting_payment'); assert.equal(intent.proration.pending, true); assert.ok(intent.awaitingSince);
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'billing.upgrade_awaiting_payment'));
  assert.deepEqual(await payments.changePlan(a.ctx, { plan: 'big', operationId: opB }), held, 'the same request answers the same');
  f.advance(3 * 60_000); await assert.rejects(payments.changePlan(a.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('PAYMENT_PENDING'), 'no other change while the payment can still land');
  let report = await support.familyReport(a.familyId); assert.deepEqual(report.attention.openIntents, [opB]); assert.equal(report.attention.inFlight.operationId, opB);
  // a failed proration invoice: recorded, the plan unchanged, the intent still waiting
  const failed = event(f, 'invoice.payment_failed', { object: 'invoice', customer: account.state.customer.id, lines: { data: [{ amount: -300, price: { id: PRICES.family }, period: { end: account.state.sub.current_period_end } }, { amount: 700, price: { id: PRICES.big }, period: { end: account.state.sub.current_period_end } }] } });
  let s = signed(f, failed); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'family'); assert.equal((await f.store.get(`billingChangeIntents/stripe:${opB}`)).status, 'awaiting_payment');
  // the parent finishes the payment: Stripe applies the update and sends the paid invoice — that is what grants the plan, exactly once
  const invoiceId = account.payPending();
  const paid = event(f, 'invoice.paid', { object: 'invoice', id: invoiceId, customer: account.state.customer.id, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ amount: -300, price: { id: PRICES.family }, period: { end: account.state.sub.current_period_end } }, { amount: 700, price: { id: PRICES.big }, period: { end: account.state.sub.current_period_end } }] } });
  s = signed(f, paid); const outcome = await payments.receive('stripe', s.raw, s.headers); assert.equal(outcome.status, 'applied'); assert.equal(outcome.upgrade, opB);
  fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'big'); assert.equal(fam.subscription.seats, 6); assert.equal(fam.billingIntent, null, 'the marker is released with the payment');
  const applied = await f.store.get(`billingChangeIntents/stripe:${opB}`); assert.equal(applied.status, 'applied'); assert.equal(applied.appliedBy, paid.id);
  s = signed(f, paid); assert.equal((await payments.receive('stripe', s.raw, s.headers)).replayed, true, 'a redelivery applies nothing twice');
  report = await support.familyReport(a.familyId); assert.deepEqual(report.attention.openIntents, []); assert.equal(report.attention.inFlight, null);
  // a held upgrade that never gets paid lapses after a day and a new change may supersede it
  const opC = randomUUID(); account.state.upgradePayment = 'fails';
  assert.equal((await payments.changePlan(a.ctx, { plan: 'big', operationId: opC })).kind, 'clear'); // already on big: nothing to hold
  const g = rig(), b = await g.f.family('parentB', 0); await subscribed(g, b, 'starter'); g.account.state.upgradePayment = 'fails';
  const opD = randomUUID(); assert.equal((await g.payments.changePlan(b.ctx, { plan: 'family', operationId: opD })).pending, true);
  g.f.advance(25 * 60 * 60_000); g.account.state.upgradePayment = 'paid'; const b2 = await g.f.login('parentB');
  const opE = randomUUID(); assert.equal((await g.payments.changePlan(b2.ctx, { plan: 'family', operationId: opE })).entitlement.plan, 'family');
  assert.equal((await g.f.store.get(`billingChangeIntents/stripe:${opD}`)).status, 'superseded');
});
test('a proration invoice with the old and the new price on separate lines resolves to the price the subscription is on', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter');
  const end = account.state.sub.current_period_end;
  // Stripe already moved the subscription to family; the invoice lists starter (negative) first
  account.state.sub.items.data[0].price.id = PRICES.family;
  const lines = { data: [{ amount: -200, price: { id: PRICES.starter }, period: { end } }, { amount: 600, price: { id: PRICES.family }, period: { end } }] };
  const paid = event(f, 'invoice.paid', { object: 'invoice', customer: account.state.customer.id, parent: { subscription_details: { subscription: 'sub_1', metadata: { familyId: a.familyId } } }, lines });
  const n = await account.gw.verify(...Object.values(signed(f, paid)).slice(0, 2), f.now()); assert.equal(n.data.price, PRICES.family); assert.equal(n.data.periodEnd, end * 1000);
  const failed = event(f, 'invoice.payment_failed', { object: 'invoice', customer: account.state.customer.id, lines });
  const nf = await account.gw.verify(...Object.values(signed(f, failed)).slice(0, 2), f.now()); assert.equal(nf.data.price, PRICES.family, 'without a fetch, the positive line wins over the negative one');
  const { bestLine } = await import('../server/gateways/stripe.mjs');
  assert.equal(bestLine([{ amount: -1, price: { id: 'a' }, period: { end: 9 } }, { amount: -1, price: { id: 'b' }, period: { end: 5 } }]).price.id, 'a', 'all negative: the latest period');
  assert.equal(bestLine([{ price: { id: 'c' } }, { amount: 5, pricing: { price_details: { price: 'd' } }, period: { end: 1 } }]).pricing.price_details.price, 'd');
  assert.equal(bestLine([]), null);
  void payments;
});
test('a held upgrade completes only from its own invoice, through plan.change: a cancellation made while it waited stands, an unrelated paid invoice grants nothing, an ended subscription is not revived, and the provider agrees', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter');
  const opB = randomUUID(); account.state.upgradePayment = 'requires_action';
  assert.equal((await payments.changePlan(a.ctx, { plan: 'family', operationId: opB })).pending, true);
  const intent = await f.store.get(`billingChangeIntents/stripe:${opB}`); assert.match(intent.proration.invoiceRef, /^in_/); assert.equal(intent.proration.invoiceRef, account.state.pendingInvoice, 'the intent names the invoice Stripe opened');
  // the parent cancels at the period end while the payment waits: locally and at Stripe
  f.advance(1000); assert.equal((await payments.cancel(a.ctx, op())).entitlement.cancelAtPeriodEnd, true); assert.equal(account.state.sub.cancel_at_period_end, true);
  const end = account.state.sub.current_period_end, cus = account.state.customer.id, subLink = { subscription_details: { subscription: 'sub_1' } };
  const invoice = (id, lines) => event(f, 'invoice.paid', { object: 'invoice', id, customer: cus, parent: subLink, lines: { data: lines.map(([price, amount]) => ({ amount, price: { id: price }, period: { end } })) } });
  // an unrelated paid invoice for this customer — a renewal on the current price — is a renewal and nothing more
  f.advance(1000); const renewal = invoice('in_renewal', [[PRICES.starter, 500]]);
  let s = signed(f, renewal), out = await payments.receive('stripe', s.raw, s.headers); assert.equal(out.status, 'applied'); assert.equal(out.upgrade, undefined);
  let fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'starter'); assert.equal(fam.subscription.cancelAtPeriodEnd, true, 'a renewal never undoes a cancellation');
  assert.equal((await f.store.get(`billingChangeIntents/stripe:${opB}`)).status, 'awaiting_payment'); assert.equal((await f.store.get(`billingEvents/stripe:${renewal.id}`)).invoiceRef, 'in_renewal');
  // a paid invoice that is not the intent's, even while Stripe shows the target price: not this upgrade — unauthorised, for the operator
  account.state.sub.items.data[0].price.id = PRICES.family; f.advance(1000);
  s = signed(f, invoice('in_other', [[PRICES.family, 400]])); out = await payments.receive('stripe', s.raw, s.headers); assert.equal(out.status, 'requires_action'); assert.equal(out.reason, 'PLAN_CHANGE_NOT_AUTHORIZED');
  account.state.sub.items.data[0].price.id = PRICES.starter;
  fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'starter'); assert.equal((await f.store.get(`billingChangeIntents/stripe:${opB}`)).status, 'awaiting_payment');
  // the intent's own invoice: Stripe applies the held update and sends its payment — the target plan and seats apply once, through plan.change, and the cancellation stands
  const invoiceId = account.payPending(); f.advance(1000);
  const paid = invoice(invoiceId, [[PRICES.starter, -300], [PRICES.family, 700]]);
  s = signed(f, paid); out = await payments.receive('stripe', s.raw, s.headers); assert.equal(out.status, 'applied'); assert.equal(out.upgrade, opB);
  fam = await family(f, a.familyId); assert.equal(fam.subscription.plan, 'family'); assert.equal(fam.subscription.seats, 4); assert.equal(fam.subscription.cancelAtPeriodEnd, true, 'the cancellation the parent asked for stands'); assert.equal(fam.subscription.periodEnd, end * 1000, 'a proration invoice renews nothing'); assert.equal(fam.billingIntent, null);
  const row = await f.store.get(`families/${a.familyId}/billing/${out.eventId}`); assert.equal(row.type, 'plan.change'); assert.equal(row.plan, 'family'); assert.equal(row.authorized, false); assert.equal(row.proration.invoiceRef, invoiceId);
  const applied = await f.store.get(`billingChangeIntents/stripe:${opB}`); assert.equal(applied.status, 'applied'); assert.equal(applied.appliedBy, paid.id); assert.equal(applied.result.kind, 'upgrade');
  s = signed(f, paid); assert.equal((await payments.receive('stripe', s.raw, s.headers)).replayed, true, 'a redelivery applies nothing twice');
  const check = await support.reconcileProvider(a.familyId, OPERATOR); assert.equal(check.match, true); assert.deepEqual(check.findings, []); assert.equal(check.local.cancelAtPeriodEnd, true); assert.equal(check.providers[0].subscription.cancelAtPeriodEnd, true); assert.equal(check.providers[0].subscription.plan, 'family');
  // an ended subscription is not revived by the late payment of a held upgrade: the row is rejected and the intent left for the operator
  const g = rig(), b = await g.f.family('parentB', 0); await subscribed(g, b, 'starter');
  const opC = randomUUID(); g.account.state.upgradePayment = 'requires_action'; assert.equal((await g.payments.changePlan(b.ctx, { plan: 'family', operationId: opC })).pending, true);
  g.f.advance(1000); g.account.state.charge = { id: 'ch_1', object: 'charge', customer: g.account.state.customer.id, amount: 500, amount_refunded: 500, refunded: true };
  let t = signed(g.f, event(g.f, 'refund.created', { object: 'refund', id: 're_1', charge: 'ch_1', amount: 500, status: 'succeeded' }));
  assert.equal((await g.payments.receive('stripe', t.raw, t.headers)).state, 'cancelled', 'a full refund ended access');
  const lateId = g.account.payPending(); g.f.advance(1000);
  t = signed(g.f, event(g.f, 'invoice.paid', { object: 'invoice', id: lateId, customer: g.account.state.customer.id, parent: subLink, lines: { data: [{ amount: 400, price: { id: PRICES.family }, period: { end: g.account.state.sub.current_period_end } }] } }));
  const late = await g.payments.receive('stripe', t.raw, t.headers); assert.equal(late.status, 'rejected'); assert.equal(late.reason, 'INVALID_TRANSITION');
  const gone = await family(g.f, b.familyId); assert.equal(gone.subscription.state, 'cancelled'); assert.equal(gone.subscription.plan, 'starter'); assert.equal((await g.f.store.get(`billingChangeIntents/stripe:${opC}`)).status, 'awaiting_payment', 'left for the operator');
  // the intent's invoice paid, but Stripe's subscription on some other price: the operator decides
  const h = rig(), c = await h.f.family('parentC', 0); await subscribed(h, c, 'starter');
  const opD = randomUUID(); h.account.state.upgradePayment = 'requires_action'; assert.equal((await h.payments.changePlan(c.ctx, { plan: 'family', operationId: opD })).pending, true);
  const dId = h.account.payPending(); h.account.state.sub.items.data[0].price.id = PRICES.big; h.f.advance(1000);
  t = signed(h.f, event(h.f, 'invoice.paid', { object: 'invoice', id: dId, customer: h.account.state.customer.id, parent: subLink, lines: { data: [{ amount: 900, price: { id: PRICES.big }, period: { end: h.account.state.sub.current_period_end } }] } }));
  const odd = await h.payments.receive('stripe', t.raw, t.headers); assert.equal(odd.status, 'rejected'); assert.equal(odd.reason, 'UPGRADE_PLAN_MISMATCH');
  assert.equal((await family(h.f, c.familyId)).subscription.plan, 'starter'); assert.equal((await h.f.store.get(`billingChangeIntents/stripe:${opD}`)).status, 'awaiting_payment');
});
