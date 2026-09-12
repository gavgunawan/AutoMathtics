// The 3.3/3.4 close-out: a checkout cannot bypass the plan-change lifecycle and only one is live
// per family (S3.3/3.4-E); an abandoned change intent that is taken over can never finalise or
// disturb its successor (S3.4-F); intents and checkouts are kept, not TTL-collected (S3.4-G).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, rejected, webhookSecret } from './support.mjs';
import { signWebhook, INTENT_INFLIGHT_MS } from '../server/payments.mjs';

const DAY = 86_400_000;
const op = () => ({ operationId: randomUUID() });
const deliver = (f, event) => { const raw = Buffer.from(JSON.stringify(event)); return f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, f.now()) }); };
const evt = (f, customer, type, data = {}, more = {}) => ({ id: `evt_${randomUUID()}`, type, at: f.now(), customer, data, ...more });
const complete = (f, co, plan) => deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }));
async function paidFamily(f, plan = 'starter', kids = ['A']) {
  const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan, ...op() });
  assert.equal((await complete(f, co, plan)).status, 'applied');
  const children = []; for (const n of kids) children.push((await f.child(a.ctx, n)).child);
  return { a, co, ids: children.map((c) => c.id) };
}
const parentAgain = async (f) => { f.advance(2000); return f.login('parentA'); };
const settle = () => new Promise((r) => setTimeout(r, 20));

test('S3.3/3.4-E: a paid family cannot start a checkout — the plan changes through /billing/plan; trial, past-due, cancelled and expired families can', async () => {
  const f = fixture(); const { a, co } = await paidFamily(f, 'starter', ['A']);
  await assert.rejects(f.payments.checkout(a.ctx, { plan: 'family', ...op() }), rejected('USE_PLAN_CHANGE'));
  await assert.rejects(f.payments.checkout(a.ctx, { plan: 'starter', ...op() }), rejected('USE_PLAN_CHANGE'), 'not even for the same plan');
  f.advance(31 * DAY); let p = await parentAgain(f); assert.equal((await f.billing.view(p.ctx)).subscription.state, 'grace');
  await assert.rejects(f.payments.checkout(p.ctx, { plan: 'family', ...op() }), rejected('USE_PLAN_CHANGE'), 'grace: the renewal comes first');
  f.advance(8 * DAY); p = await parentAgain(f); assert.equal((await f.billing.view(p.ctx)).subscription.state, 'past_due');
  const recover = await f.payments.checkout(p.ctx, { plan: 'family', ...op() }); // past-due recovery: explicit policy, any plan
  assert.equal((await complete(f, recover, 'family')).status, 'applied'); assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.plan, 'family');
  // and the plain dunning invoice on the plan on record is the other recovery path
  f.advance(40 * DAY); p = await parentAgain(f); assert.equal((await f.billing.view(p.ctx)).subscription.state, 'past_due');
  assert.equal((await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_family', periodEnd: f.now() + 30 * DAY }))).state, 'active');
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'terminate' }, 'test-operator'); p = await parentAgain(f);
  assert.equal((await complete(f, await f.payments.checkout(p.ctx, { plan: 'big', ...op() }), 'big')).state, 'active', 'cancelled: a checkout is the way back');
  const g = fixture(); const b = await g.family('parentB', 0); await g.billing.startTrial(b.ctx, op());
  assert.ok((await g.payments.checkout(b.ctx, { plan: 'starter', ...op() })).checkoutId, 'trial: a checkout is how it becomes paid');
});
test('S3.3/3.4-E: one live checkout per family and provider — a newer one supersedes the older, whose later completion is refused', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  const first = await f.payments.checkout(a.ctx, { plan: 'starter', ...op() });
  const second = await f.payments.checkout(a.ctx, { plan: 'family', ...op() });
  const rec1 = await f.store.get(`checkouts/fake:${first.checkoutId}`); assert.equal(rec1.status, 'superseded'); assert.equal(rec1.supersededBy, second.checkoutId);
  assert.equal((await f.store.get(`families/${a.familyId}`)).checkoutIntent.fake, second.checkoutId);
  assert.deepEqual(await f.payments.checkout(a.ctx, { plan: 'starter', operationId: first.checkoutId }), { ...first, url: null, superseded: true }, 'the superseded checkout replays as superseded, never with a session to pay');
  assert.deepEqual(await complete(f, first, 'starter'), { status: 'rejected', reason: 'CHECKOUT_SUPERSEDED' }, 'paying the old session cannot transition the family');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription, undefined);
  assert.equal((await complete(f, second, 'family')).status, 'applied');
  assert.equal((await f.store.get(`families/${a.familyId}`)).checkoutIntent.fake, null, 'the live-checkout marker is released on completion');
  assert.deepEqual(await complete(f, first, 'starter'), { status: 'rejected', reason: 'CHECKOUT_SUPERSEDED' }, 'and still cannot afterwards');
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.plan, 'family');
});
test('S3.4-F: A stalls at the provider, B takes over after the window, A resumes before B finalises — A is refused, B\'s marker survives, B finalises', async () => {
  const f = fixture(); const { a } = await paidFamily(f, 'starter', ['A']);
  const gates = new Map(); const real = f.gateway.changePlan.bind(f.gateway);
  f.gateway.changePlan = async (args) => { const gate = gates.get(args.idempotencyKey); if (gate) await gate; return real(args); };
  const idA = randomUUID(), idB = randomUUID(); let openA, openB;
  gates.set(idA, new Promise((r) => { openA = r; })); gates.set(idB, new Promise((r) => { openB = r; }));
  const pA = f.payments.changePlan(a.ctx, { plan: 'family', operationId: idA }); await settle();
  assert.equal((await f.store.get(`billingChangeIntents/fake:${idA}`)).status, 'creating'); assert.equal((await f.store.get(`families/${a.familyId}`)).billingIntent.operationId, idA);
  f.advance(INTENT_INFLIGHT_MS + 1000); const p = await parentAgain(f);
  const pB = f.payments.changePlan(p.ctx, { plan: 'big', operationId: idB }); await settle();
  assert.equal((await f.store.get(`billingChangeIntents/fake:${idA}`)).status, 'superseded', 'the takeover supersedes A in the same transaction');
  assert.equal((await f.store.get(`families/${a.familyId}`)).billingIntent.operationId, idB);
  openA(); await assert.rejects(pA, rejected('SUBSCRIPTION_CHANGED')); // A resumes first: it may not finalise
  const fam = await f.store.get(`families/${a.familyId}`);
  assert.equal(fam.subscription.plan, 'starter', 'nothing finalised against A\'s old facts'); assert.equal(fam.billingIntent.operationId, idB, 'B\'s marker was not cleared by A');
  assert.equal((await f.store.get(`billingChangeIntents/fake:${idA}`)).status, 'superseded');
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'family', operationId: idA }), rejected('SUBSCRIPTION_CHANGED'), 'and A stays refused');
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', ...op() }), rejected('CHANGE_IN_PROGRESS'), 'a third change waits for B');
  openB(); const done = await pB; assert.equal(done.kind, 'upgrade'); assert.equal(done.entitlement.plan, 'big');
  const after = await f.store.get(`families/${a.familyId}`); assert.equal(after.subscription.seats, 6); assert.equal(after.billingIntent, null);
  const intentB = await f.store.get(`billingChangeIntents/fake:${idB}`); assert.equal(intentB.status, 'applied'); assert.equal(intentB.providerOperationRef, `fake_op_${idB}`, 'the provider reference is kept for reconciliation');
  assert.equal((await f.store.list(`families/${a.familyId}/billing`)).filter((e) => e.type === 'plan.change').length, 1, 'exactly one plan change landed');
});
test('S3.4-G: checkouts and change intents carry no expiry and the deployment TTL list no longer names them', async () => {
  const f = fixture(); const { a, co } = await paidFamily(f, 'starter', ['A']);
  const id = randomUUID(); await f.payments.changePlan(a.ctx, { plan: 'family', operationId: id });
  for (const path of [`checkouts/fake:${co.checkoutId}`, `billingChangeIntents/fake:${id}`, `billingEvents/fake:${(await f.store.list('billingEvents'))[0].providerEventId}`, `billingCustomers/fake:${co.customerRef}`]) {
    const doc = await f.store.get(path); assert.ok(doc, path); assert.equal(doc.expireAt, undefined, `${path} must not be TTL-collected`);
  }
  const deploy = await readFile(new URL('../DEPLOY_V3.md', import.meta.url), 'utf8');
  const ttl = deploy.match(/for GROUP in ([^;]+); do/)[1].split(/\s+/);
  for (const group of ['checkouts', 'billingChangeIntents', 'billingEvents', 'billingCustomers', 'billing']) assert.ok(!ttl.includes(group), `${group} is financial evidence, not a TTL group`);
});
