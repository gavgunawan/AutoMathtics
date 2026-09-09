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
import { sha256 } from '../server/security.mjs';
import { deriveState } from '../server/subscription.mjs';

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
  assert.equal(account.state.sub.status, 'past_due', 'the old subscription is still live at Stripe'); assert.equal(sessions(account), 0, 'no session was opened over it');
  account.gw.cancelSubscription = realCancel;
  const chk = await payments.checkout(a.ctx, { plan: 'family', operationId: opA }); assert.ok(chk.url);
  assert.equal(account.state.sub.status, 'canceled', 'the retry ended it before opening anything'); assert.equal(deletes(account), 1); assert.equal(sessions(account), 1);
  let intent = await f.store.get(`checkouts/stripe:${opA}`); assert.equal(intent.status, 'pending'); assert.equal(intent.endPrevious.required, true); assert.equal(intent.endPrevious.status, 'done'); assert.equal(intent.endPrevious.result.cancelled, true); assert.ok(intent.endPrevious.at);
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
  const opD = randomUUID(), rc = k.account.gw.createCheckout.bind(k.account.gw), rx = k.account.gw.cancelCheckout.bind(k.account.gw); let made = 0, expiries = 0;
  k.account.gw.cancelCheckout = async (...args) => { if (expiries++ === 0) throw Error('ECONNRESET'); return rx(...args); }; // the first expiry faults (best effort, swallowed); the retry's one lands
  k.account.gw.createCheckout = async (...args) => { if (made++ === 0) throw Error('ECONNRESET'); return rc(...args); };
  await assert.rejects(k.payments.checkout(d.ctx, { plan: 'starter', operationId: opD }), /ECONNRESET/);
  assert.equal((await k.f.store.get(`checkouts/stripe:${opD}`)).supersededRef, first.providerCheckoutRef); assert.equal(k.account.state.expired.length, 0, 'the first expiry faulted');
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
const fingerprintFor = (plan) => sha256(JSON.stringify({ provider: 'stripe', plan, priceId: PRICES[plan] }));
test('what the verification found: an intent from before the debts still owes its ending; a stalled attempt superseded meanwhile never hands out its session; a completed intent without a result answers closed; a checkout that owes no ending still asks the provider; a refused ending never blocks the expiry; two live subscriptions are reported, not chosen; a just-paid subscription is never ended for a new checkout', async () => {
  // (e) an intent written by the previous code — no endPrevious, no endedPrevious — is owed whatever the family still shows
  const r = rig(), { f, account, payments } = r, a = await pastDue(r, 'parentA'), opE = randomUUID(), realCancel = account.gw.cancelSubscription.bind(account.gw);
  account.gw.cancelSubscription = async () => { throw Error('ECONNRESET'); };
  await assert.rejects(payments.checkout(a.ctx, { plan: 'family', operationId: opE }), /ECONNRESET/); account.gw.cancelSubscription = realCancel;
  await f.store.transaction(async (tx) => { const { endPrevious, supersededRef, supersededId, ...legacy } = await tx.get(`checkouts/stripe:${opE}`); void endPrevious; void supersededRef; void supersededId; tx.set(`checkouts/stripe:${opE}`, legacy); });
  assert.ok((await payments.checkout(a.ctx, { plan: 'family', operationId: opE })).url); assert.equal(account.state.sub.status, 'canceled', 'the resume ended the old subscription first'); assert.equal(deletes(account), 1);
  assert.equal((await f.store.get(`checkouts/stripe:${opE}`)).endPrevious.status, 'done');
  // (f) X stalls in its ending; the parent refreshes and clicks again (Y): Y supersedes X, ends the subscription, opens its session; X's late session never reaches the parent and is expired
  const g = rig(), b = await pastDue(g, 'parentB'), opX = randomUUID(), opY = randomUUID(), real2 = g.account.gw.cancelSubscription.bind(g.account.gw); let yAnswer = null;
  g.account.gw.cancelSubscription = async (args) => { g.account.gw.cancelSubscription = real2; yAnswer = await g.payments.checkout(b.ctx, { plan: 'family', operationId: opY }); return real2(args); };
  const xAnswer = await g.payments.checkout(b.ctx, { plan: 'family', operationId: opX });
  assert.ok(yAnswer.url, 'Y opened the family\'s session'); assert.equal(xAnswer.url, null); assert.equal(xAnswer.superseded, true);
  const x = await g.f.store.get(`checkouts/stripe:${opX}`); assert.equal(x.status, 'superseded'); assert.ok(x.lateSessionRef, 'X\'s late session is on the record'); assert.ok(g.account.state.expired.some((q) => q.includes(x.lateSessionRef)), 'and expired at Stripe');
  assert.equal((await g.f.store.get(`checkouts/stripe:${opY}`)).status, 'pending'); assert.equal(g.account.state.sub.status, 'canceled'); assert.equal(deletes(g.account), 1, 'ended once: X found it ended already');
  // (g) an intent its webhook completed while the finalisation was lost: a replay answers closed and asks the provider nothing
  const h = rig(), c = await h.f.family('parentC', 0), opG = randomUUID();
  await h.f.store.transaction(async (tx) => { tx.set(`checkouts/stripe:${opG}`, { provider: 'stripe', checkoutId: opG, familyId: c.familyId, customerRef: 'cus_lost', plan: 'starter', priceId: PRICES.starter, fingerprint: fingerprintFor('starter'), status: 'completed', providerCheckoutRef: null, createdAt: h.f.now(), completedAt: h.f.now(), result: null }); });
  const before = h.account.calls.length; assert.deepEqual(await h.payments.checkout(c.ctx, { plan: 'starter', operationId: opG }), { checkoutId: opG, url: null, status: 'completed' }); assert.equal(h.account.calls.length, before, 'no provider call');
  // (h) a family that never paid, whose customer exists at the provider: two live subscriptions there, or one, refuse the session; a first-time family asks nothing
  const k = rig(), d = await k.f.family('parentD', 0), firstD = await k.payments.checkout(d.ctx, { plan: 'starter', ...op() }); assert.ok(firstD.url);
  k.account.activate(PRICES.family); k.account.state.extraSubs = [sub(PRICES.big, k.f.now() + 20 * DAY, { id: 'sub_two' })];
  await assert.rejects(k.payments.checkout(d.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'));
  k.account.state.extraSubs = []; await assert.rejects(k.payments.checkout(d.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('PROVIDER_SUBSCRIPTION_LIVE'), 'one live subscription the family knows nothing of');
  assert.equal(sessions(k.account), 1, 'no further session was opened');
  const m = rig(), e = await m.f.family('parentE', 0); assert.ok((await m.payments.checkout(e.ctx, { plan: 'starter', ...op() })).url); assert.equal(m.account.calls.filter((q) => q.path.startsWith('/v1/subscriptions')).length, 0, 'a first-time family: nothing to inspect');
  // (i) a refused ending (two live subscriptions) still expires the superseded session, which comes first
  const n = rig(), p = await pastDue(n, 'parentF'), first = await n.payments.checkout(p.ctx, { plan: 'family', ...op() }); assert.ok(first.url);
  n.account.state.extraSubs = [sub(PRICES.big, n.f.now() + 20 * DAY, { id: 'sub_two' }), sub(PRICES.family, n.f.now() + 20 * DAY, { id: 'sub_three' })];
  await assert.rejects(n.payments.checkout(p.ctx, { plan: 'family', operationId: randomUUID() }), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'));
  assert.ok(n.account.state.expired.some((q) => q.includes(first.providerCheckoutRef)), 'the superseded session was expired before the ending was even tried');
  // (j) the report with two live subscriptions names them, chooses none, and calls an open intent's evidence ambiguous
  const q = rig(), s2 = await q.f.family('parentG', 0); await subscribed(q, s2, 'starter'); q.account.state.upgradePayment = 'requires_action';
  assert.equal((await q.payments.changePlan(s2.ctx, { plan: 'family', operationId: randomUUID() })).pending, true);
  q.account.state.extraSubs = [sub(PRICES.big, q.f.now() + 20 * DAY, { id: 'sub_dash' })];
  const rep = await q.support.reconcileProvider(s2.familyId, OPERATOR); assert.equal(rep.providers[0].subscription, null); assert.equal(rep.providers[0].liveCount, 2); assert.equal(rep.intents[0].providerEvidence, 'ambiguous_multiple_subscriptions');
  // (k) the parent pays checkout A and clicks again before A's webhook lands: B finds a live subscription that is not the family's old one, ends nothing, closes itself and reinstates A; A's webhook then applies
  const t = rig(), u = await pastDue(t, 'parentH'), opA2 = randomUUID(), A = await t.payments.checkout(u.ctx, { plan: 'family', operationId: opA2 }); assert.ok(A.url);
  const old = t.account.state.sub; t.account.activate(PRICES.family); t.account.state.sub.id = 'sub_A'; t.account.state.extraSubs = [old]; // paid: sub_A live, sub_1 ended
  const opB2 = randomUUID(); await assert.rejects(t.payments.checkout(u.ctx, { plan: 'family', operationId: opB2 }), rejected('CHECKOUT_COMPLETING'));
  assert.equal(t.account.state.sub.status, 'active', 'the paid subscription was not touched'); assert.equal(deletes(t.account), 1, 'only A\'s ending');
  assert.equal((await t.f.store.get(`checkouts/stripe:${opB2}`)).status, 'superseded'); assert.equal((await t.f.store.get(`checkouts/stripe:${opA2}`)).status, 'pending', 'A reinstated'); assert.equal((await family(t.f, u.familyId)).checkoutIntent.stripe, opA2);
  const done = event(t.f, 'checkout.session.completed', { object: 'checkout.session', customer: t.account.state.customer.id, subscription: 'sub_A', client_reference_id: opA2, metadata: { familyId: u.familyId, checkoutId: opA2 } });
  const sg = signed(t.f, done); assert.equal((await t.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied');
  const famH = await family(t.f, u.familyId); assert.equal(famH.subscription.plan, 'family'); assert.equal(famH.subscription.providerSubscriptionRef, 'sub_A');
  assert.deepEqual(await t.payments.checkout(u.ctx, { plan: 'family', operationId: opB2 }), { checkoutId: opB2, url: null, superseded: true }, 'B stays closed');
});
test('a resumed ending is settled only against the family it was recorded for: paid meanwhile, the intent goes stale and the click is refused as a fresh start would be; a provider that cannot find the subscription never counts as settled', async () => {
  // the dunning invoice is paid while the first attempt sits on a provider fault; the retried click must not end the paid subscription
  const r = rig(), { f, account, payments } = r, a = await pastDue(r, 'parentA'), opA = randomUUID(), restore = down(account);
  await assert.rejects(payments.checkout(a.ctx, { plan: 'family', operationId: opA }), rejected('PROVIDER_UNREACHABLE')); restore();
  account.state.sub.status = 'active'; account.state.sub.current_period_end = Math.floor((f.now() + 30 * DAY) / 1000);
  const paid = event(f, 'invoice.paid', { object: 'invoice', id: 'in_dunning', customer: account.state.customer.id, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ amount: 500, price: { id: PRICES.starter }, period: { end: account.state.sub.current_period_end } }] } });
  const sg = signed(f, paid); assert.equal((await payments.receive('stripe', sg.raw, sg.headers)).status, 'applied'); assert.equal(deriveState((await family(f, a.familyId)).subscription, f.now()), 'active');
  await assert.rejects(payments.checkout(a.ctx, { plan: 'family', operationId: opA }), rejected('USE_PLAN_CHANGE'), 'the retried click is refused as a fresh start would be');
  assert.equal(account.state.sub.status, 'active', 'the paid subscription was not ended'); assert.equal(deletes(account), 0); assert.equal(sessions(account), 0);
  const stale = await f.store.get(`checkouts/stripe:${opA}`); assert.equal(stale.status, 'stale'); assert.equal(stale.staleReason, 'STATE_MOVED'); assert.equal((await family(f, a.familyId)).checkoutIntent.stripe, null, 'the family carries no live checkout any more');
  // a subscription the provider cannot find (a search that missed, a customer deleted in the dashboard): the debt stays pending, the family is marked, the retry settles it
  const g = rig(), b = await pastDue(g, 'parentB'), opB = randomUUID(), cus = g.account.state.customer; g.account.state.customer = null;
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'family', operationId: opB }), rejected('PROVIDER_SUBSCRIPTION_NOT_FOUND'));
  assert.equal((await g.f.store.get(`checkouts/stripe:${opB}`)).endPrevious.status, 'pending', 'never presumed settled'); assert.equal((await family(g.f, b.familyId)).providerAttention.code, 'PROVIDER_SUBSCRIPTION_NOT_FOUND'); assert.equal(sessions(g.account), 0);
  g.account.state.customer = cus; assert.ok((await g.payments.checkout(b.ctx, { plan: 'family', operationId: opB })).url); assert.equal(g.account.state.sub.status, 'canceled'); assert.equal(deletes(g.account), 1);
});
test('a refusal on the provider\'s truth leaves a trace: the plan change closes its intent and releases the marker, the family is marked, the nightly sweep names it, and a clean reconciliation clears it', async () => {
  const r = rig(), { f, account, payments, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter');
  account.state.extraSubs = [sub(PRICES.family, f.now() + 20 * DAY, { id: 'sub_dashboard' })];
  const opA = randomUUID(); await assert.rejects(payments.changePlan(a.ctx, { plan: 'family', operationId: opA }), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'));
  assert.equal((await f.store.get(`billingChangeIntents/stripe:${opA}`)).status, 'stale'); assert.equal((await family(f, a.familyId)).billingIntent, null, 'the marker is released: a deterministic refusal is not a fault to resume from');
  await assert.rejects(payments.changePlan(a.ctx, { plan: 'family', operationId: randomUUID() }), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'), 'another try answers the truth, not CHANGE_IN_PROGRESS');
  await assert.rejects(payments.cancel(a.ctx, op()), rejected('MULTIPLE_PROVIDER_SUBSCRIPTIONS'));
  assert.equal((await family(f, a.familyId)).providerAttention.code, 'MULTIPLE_PROVIDER_SUBSCRIPTIONS'); assert.ok((await f.store.list('audit')).some((x) => x.action === 'billing.refused' && x.familyId === a.familyId));
  const sweep = await support.inspectAll({ operator: OPERATOR }); assert.ok(sweep.findings.some((x) => x.code === 'PROVIDER_ATTENTION' && x.family === a.familyId)); assert.equal(sweep.counts.providerAttention, 1);
  // the operator cancels the dashboard's subscription and reconciles: clean, the mark goes, the sweep is quiet, the parent can change plan again
  account.state.extraSubs = []; const check = await support.reconcileProvider(a.familyId, OPERATOR); assert.equal(check.match, true); assert.equal(check.attentionCleared, true);
  assert.equal((await family(f, a.familyId)).providerAttention, null); assert.equal((await support.inspectAll({ operator: OPERATOR })).findings.length, 0);
  assert.equal((await payments.changePlan(a.ctx, { plan: 'family', operationId: randomUUID() })).entitlement.plan, 'family');
});
test('the export\'s cap: exactly the cap is every row and not truncated; one more is', async () => {
  const f = fixture(), a = await f.family('parentA', 1), own = (await f.store.query('audit', 'familyId', a.familyId, 100)).length; assert.ok(own <= 6);
  const support = new Support({ foundation: f.service, store: f.store, billing: f.billing, now: f.now, auditPage: 3, auditCap: 6 });
  await f.store.transaction(async (tx) => { for (let i = own; i < 6; i++) tx.set(`audit/x${i}`, { action: `fill.${i}`, uid: 'parentA', familyId: a.familyId, at: f.now() + i, expireAt: f.now() + DAY }); });
  const exact = await support.exportFamily(a.ctx); assert.equal(exact.audit.length, 6); assert.equal(exact.auditTruncated, false, 'exactly the cap is every row');
  await f.store.transaction(async (tx) => { tx.set('audit/x99', { action: 'fill.99', uid: 'parentA', familyId: a.familyId, at: f.now() + 99, expireAt: f.now() + DAY }); });
  const over = await support.exportFamily(a.ctx); assert.equal(over.audit.length, 6); assert.equal(over.auditTruncated, true);
});
