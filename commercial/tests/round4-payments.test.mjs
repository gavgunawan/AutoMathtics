// Stage 4 review, fourth round — the checkout seam and the provider's truth: a checkout that owes the provider something
// (ending the previous subscription, expiring a superseded session) records the debt on its intent and settles it on
// every resume; a customer with two live subscriptions at the provider stops every money-changing operation until an
// operator has chosen; the family export and the operator's report read every audit row, in pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { Payments } from '../server/payments.mjs';
import { Support } from '../server/support.mjs';
import { PRICES, DAY, op, event, signed, stripeAccount, sub } from './stripe-support.mjs';

const OPERATOR = 'ops@example.test';
function rig() {
  const f = fixture(), account = stripeAccount(f);
  const payments = new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'stripe', gateways: { stripe: account.gw }, now: f.now });
  const support = new Support({ foundation: f.service, store: f.store, billing: f.billing, payments, now: f.now });
  return { f, account, payments, support };
}
async function subscribed(r, fam, plan = 'starter') {
  const { f, account, payments } = r;
  const chk = await payments.checkout(fam.ctx, { plan, ...op() });
  account.activate(PRICES[plan]);
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: chk.checkoutId, metadata: { familyId: fam.familyId, checkoutId: chk.checkoutId } });
  const s = signed(f, done); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  return chk;
}
/** A family past due at both ends, with a parent signed in afresh: the state a returning checkout starts from. */
async function pastDue(r, uid) {
  const fam = await r.f.family(uid, 0); await subscribed(r, fam, 'starter');
  r.f.advance(38 * DAY); r.account.state.sub.status = 'past_due';
  const ctx = (await r.f.login(uid)).ctx; r.account.calls.length = 0; // count only what the returning checkout does
  return { ...fam, ctx };
}
const family = (f, id) => f.store.get(`families/${id}`);
const down = (account) => { const real = account.gw.fetch; account.gw.fetch = async () => { throw Error('ECONNRESET'); }; return () => { account.gw.fetch = real; }; };
const deletes = (account) => account.calls.filter((c) => c.method === 'DELETE').length;
const sessions = (account) => account.calls.filter((c) => c.method === 'POST' && c.path === '/v1/checkout/sessions').length;

test('a checkout that owes the provider records the debt on its intent and settles it on every resume: a crash before the ending, a provider fault, a crash after it — one subscription ended, one session opened', async () => {
  // (a) the process dies inside the provider call that ends the old subscription: the intent stays `creating` with the debt pending; the retry settles it first
  const r = rig(), { f, account, payments } = r, a = await pastDue(r, 'parentA');
  const opA = randomUUID(), realCancel = account.gw.cancelSubscription.bind(account.gw);
  account.gw.cancelSubscription = async () => { throw Error('ECONNRESET'); };
  await assert.rejects(payments.checkout(a.ctx, { plan: 'family', operationId: opA }), /ECONNRESET/);
  let intent = await f.store.get(`checkouts/stripe:${opA}`);
  assert.equal(intent.status, 'creating'); assert.equal(intent.endPrevious.required, true); assert.equal(intent.endPrevious.status, 'pending'); assert.equal(intent.endPrevious.result, null);
  assert.equal(account.state.sub.status, 'past_due', 'the old subscription is still live at Stripe'); assert.equal(sessions(account), 0, 'no session was opened over it');
  account.gw.cancelSubscription = realCancel;
  const chk = await payments.checkout(a.ctx, { plan: 'family', operationId: opA }); assert.ok(chk.url);
  intent = await f.store.get(`checkouts/stripe:${opA}`); assert.equal(intent.status, 'pending'); assert.equal(intent.endPrevious.status, 'done'); assert.equal(intent.endPrevious.result.cancelled, true); assert.ok(intent.endPrevious.at);
  assert.equal(account.state.sub.status, 'canceled'); assert.equal(deletes(account), 1); assert.equal(sessions(account), 1);
  assert.deepEqual(await payments.checkout(a.ctx, { plan: 'family', operationId: opA }), chk, 'and a replay answers the same'); assert.equal(deletes(account), 1); assert.equal(sessions(account), 1);
  // (b) the provider is unreachable when asked to end the old subscription: the parent retries when it is back
  const g = rig(), b = await pastDue(g, 'parentB'), opB = randomUUID(), restore = down(g.account);
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'family', operationId: opB }), rejected('PROVIDER_UNREACHABLE'));
  restore(); assert.equal((await g.f.store.get(`checkouts/stripe:${opB}`)).endPrevious.status, 'pending'); assert.equal(g.account.state.sub.status, 'past_due'); assert.equal(sessions(g.account), 0);
  assert.ok((await g.payments.checkout(b.ctx, { plan: 'family', operationId: opB })).url);
  assert.equal(g.account.state.sub.status, 'canceled'); assert.equal((await g.f.store.get(`checkouts/stripe:${opB}`)).endPrevious.status, 'done'); assert.equal(deletes(g.account), 1); assert.equal(sessions(g.account), 1);
  // (c) the process dies after the ending, before the session: the debt is recorded as settled, the retry opens the session and ends nothing twice
  const h = rig(), c = await pastDue(h, 'parentC'), opC = randomUUID(), realCreate = h.account.gw.createCheckout.bind(h.account.gw); let creates = 0;
  h.account.gw.createCheckout = async (...args) => { if (creates++ === 0) throw Error('ECONNRESET'); return realCreate(...args); };
  await assert.rejects(h.payments.checkout(c.ctx, { plan: 'family', operationId: opC }), /ECONNRESET/);
  let ci = await h.f.store.get(`checkouts/stripe:${opC}`); assert.equal(ci.status, 'creating'); assert.equal(ci.endPrevious.status, 'done'); assert.equal(h.account.state.sub.status, 'canceled');
  assert.ok((await h.payments.checkout(c.ctx, { plan: 'family', operationId: opC })).url);
  ci = await h.f.store.get(`checkouts/stripe:${opC}`); assert.equal(ci.status, 'pending'); assert.equal(deletes(h.account), 1, 'ended once'); assert.equal(sessions(h.account), 1, 'the first attempt died before the provider was asked; the retry opened the one session');
  // (d) a superseded session is remembered on the intent and expired at the provider on the retry as well; a family that owes nothing records that too
  const k = rig(), d = await k.f.family('parentD', 0), first = await k.payments.checkout(d.ctx, { plan: 'starter', ...op() }); k.account.calls.length = 0;
  assert.equal((await k.f.store.get(`checkouts/stripe:${first.checkoutId}`)).endPrevious.status, 'not_applicable', 'nothing to end for a family that never paid');
  const opD = randomUUID(), rc = k.account.gw.createCheckout.bind(k.account.gw); let made = 0;
  k.account.gw.createCheckout = async (...args) => { if (made++ === 0) throw Error('ECONNRESET'); return rc(...args); };
  await assert.rejects(k.payments.checkout(d.ctx, { plan: 'starter', operationId: opD }), /ECONNRESET/);
  assert.equal((await k.f.store.get(`checkouts/stripe:${opD}`)).supersededRef, first.providerCheckoutRef);
  assert.ok((await k.payments.checkout(d.ctx, { plan: 'starter', operationId: opD })).url);
  assert.ok(k.account.state.expired.some((p) => p.includes(first.providerCheckoutRef)), 'the older session was expired at Stripe'); assert.equal(deletes(k.account), 0);
});
test('two live subscriptions at the provider: plan changes, cancellations, deletions and fresh checkouts fail closed, the report names it, and one again is back to normal', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter'); account.calls.length = 0;
  account.state.extraSubs = [sub(PRICES.family, f.now() + 20 * DAY, { id: 'sub_dashboard' })]; // a second live subscription made in the dashboard
  await assert.rejects(payments.changePlan(a.ctx, { plan: 'family', operationId: randomUUID() }), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'));
  await assert.rejects(payments.cancel(a.ctx, op()), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'));
  const fam = await family(f, a.familyId); assert.equal(fam.subscription.cancelAtPeriodEnd, false, 'nothing moved locally either'); assert.equal(fam.subscription.plan, 'starter');
  assert.equal(account.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/v1/subscriptions/')).length, 0, 'the provider was asked for nothing'); assert.equal(account.calls.filter((c) => c.method === 'DELETE').length, 0);
  const check = await support.reconcileProvider(a.familyId, OPERATOR);
  const finding = check.findings.find((x) => x.code === 'MULTIPLE_PROVIDER_SUBSCRIPTIONS'); assert.ok(finding); assert.match(finding.detail, /sub_1/); assert.match(finding.detail, /sub_dashboard/); assert.equal(check.match, false); assert.equal(check.providers[0].liveCount, 2);
  // a deletion records the refusal for the operator instead of ending one of the two blindly
  f.advance(1000); const a2 = await f.login('parentA'); await support.requestDeletion(a2.ctx, op());
  const rec = await support.executeDeletion(a.familyId, { operator: OPERATOR, force: true }); assert.equal(rec.providerCancellation.status, 'failed'); assert.equal(rec.providerCancellation.reason, 'MULTIPLE_PROVIDER_SUBSCRIPTIONS');
  assert.equal(account.state.sub.status, 'active', 'neither was touched'); assert.ok((await support.inspectAll({ operator: OPERATOR })).findings.some((x) => x.code === 'DELETED_FAMILY_PROVIDER_LIVE' && x.family === a.familyId));
  // a fresh checkout for a family past due with two live subscriptions: refused before any session, and fine once the operator has cancelled one
  const g = rig(), b = await pastDue(g, 'parentB');
  g.account.state.extraSubs = [sub(PRICES.big, g.f.now() + 20 * DAY, { id: 'sub_two' })];
  const opB = randomUUID(); await assert.rejects(g.payments.checkout(b.ctx, { plan: 'family', operationId: opB }), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'));
  assert.equal(sessions(g.account), 0); assert.equal((await g.f.store.get(`checkouts/stripe:${opB}`)).endPrevious.status, 'pending', 'the debt stays recorded');
  g.account.state.extraSubs = []; assert.ok((await g.payments.checkout(b.ctx, { plan: 'family', operationId: opB })).url, 'resolved: the same operation goes through');
  assert.equal(g.account.state.sub.status, 'canceled'); assert.equal((await g.support.reconcileProvider(b.familyId, OPERATOR)).findings.some((x) => x.code === 'MULTIPLE_PROVIDER_SUBSCRIPTIONS'), false);
});
test('the family export and the operator report read every audit row of the family in pages, oldest first, never another family\'s, and say so when the cap is hit', async () => {
  const f = fixture(), a = await f.family('parentA', 1), b = await f.family('parentB', 1);
  const support = new Support({ foundation: f.service, store: f.store, billing: f.billing, now: f.now, auditPage: 7, auditCap: 40 });
  await f.store.transaction(async (tx) => {
    for (let i = 0; i < 25; i++) tx.set(`audit/z${String(i).padStart(3, '0')}`, { action: `test.${i}`, uid: 'parentA', familyId: a.familyId, at: f.now() - (25 - i) * 1000, expireAt: f.now() + DAY });
    for (let i = 0; i < 5; i++) tx.set(`audit/y${i}`, { action: 'other', uid: 'parentB', familyId: b.familyId, at: f.now(), expireAt: f.now() + DAY });
  });
  const exp = await support.exportFamily(a.ctx), mine = exp.audit.filter((x) => x.action.startsWith('test.'));
  assert.equal(mine.length, 25); assert.deepEqual(mine.map((x) => x.action), Array.from({ length: 25 }, (_, i) => `test.${i}`), 'oldest first, across four pages'); assert.equal(exp.auditTruncated, false);
  assert.ok(!exp.audit.some((x) => x.action === 'other'), 'never another family\'s rows');
  const report = await support.familyReport(a.familyId); assert.equal(report.audit.filter((x) => x.action.startsWith('test.')).length, 25); assert.equal(report.auditTruncated, false);
  await f.store.transaction(async (tx) => { for (let i = 25; i < 60; i++) tx.set(`audit/z${String(i).padStart(3, '0')}`, { action: `test.${i}`, uid: 'parentA', familyId: a.familyId, at: f.now() + i, expireAt: f.now() + DAY }); });
  const capped = await support.exportFamily(a.ctx); assert.equal(capped.auditTruncated, true); assert.equal(capped.audit.length, 40, 'bounded, and it says so');
  assert.equal((await support.familyReport(a.familyId)).auditTruncated, true);
  // the store contract underneath: a filtered page after a document id
  const page1 = await f.store.queryAfter('audit', 'familyId', a.familyId, null, 10), page2 = await f.store.queryAfter('audit', 'familyId', a.familyId, page1.at(-1)[0], 10);
  assert.equal(page1.length, 10); assert.ok(page2.length > 0 && page2[0][0] > page1.at(-1)[0], 'strictly after the cursor'); assert.ok([...page1, ...page2].every(([, v]) => v.familyId === a.familyId));
  assert.deepEqual(await f.store.queryAfter('audit', 'familyId', 'nobody', null, 10), []);
});
