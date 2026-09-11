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
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: chk.checkoutId, metadata: { familyId: fam.familyId, checkoutId: chk.checkoutId } });
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
    for (let i = 0; i < 25; i++) tx.set(`audit/z${String(99 - i).padStart(3, '0')}`, { action: `test.${i}`, uid: 'parentA', familyId: a.familyId, at: f.now() - (25 - i) * 1000, expireAt: f.now() + DAY }); // ids fall as time rises: only the sort by `at` can put them oldest first
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
  const done = event(t.f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: t.account.state.customer.id, subscription: 'sub_A', client_reference_id: opA2, metadata: { familyId: u.familyId, checkoutId: opA2 } });
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
test('the export with the production page and cap: five thousand and one rows are all there and not truncated (the old single bounded query stopped at five thousand)', async () => {
  const f = fixture(), a = await f.family('parentA', 1), own = (await f.store.query('audit', 'familyId', a.familyId, 100)).length, N = 5001 - own;
  for (let batch = 0; batch < N; batch += 400) await f.store.transaction(async (tx) => { for (let i = batch; i < Math.min(N, batch + 400); i++) tx.set(`audit/f${String(i).padStart(5, '0')}`, { action: 'fill', uid: 'parentA', familyId: a.familyId, at: f.now() + i, expireAt: f.now() + DAY }); });
  const exp = await f.support.exportFamily(a.ctx); assert.equal(exp.audit.length, 5001); assert.equal(exp.auditTruncated, false);
});
test('the operator report reads the family\'s rows only — never a whole collection of events, intents, checkouts or reconciliations', async () => {
  const r = rig(), { f, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter'); await f.family('parentB', 0);
  const listed = [], realList = f.store.list.bind(f.store); f.store.list = async (c) => { listed.push(c); return realList(c); };
  const report = await support.familyReport(a.familyId); f.store.list = realList;
  assert.ok(report.inbox.length >= 1); assert.ok(report.checkouts.length >= 1); assert.deepEqual(report.truncated, []);
  for (const c of ['billingEvents', 'billingChangeIntents', 'checkouts', 'billingReconciliations', 'audit']) assert.ok(!listed.includes(c), `${c} is never listed whole`);
});
test('a session completed unpaid (a bank debit still clearing) grants nothing; its async payment success is the completion', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0), chk = await payments.checkout(a.ctx, { plan: 'starter', ...op() }); account.activate(PRICES.starter);
  const session = { object: 'checkout.session', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: chk.checkoutId, metadata: { familyId: a.familyId, checkoutId: chk.checkoutId } };
  let s = signed(f, event(f, 'checkout.session.completed', { ...session, payment_status: 'unpaid' })); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'ignored', reason: 'UNSUPPORTED_EVENT' });
  assert.notEqual((await family(f, a.familyId)).subscription?.plan, 'starter', 'nothing granted'); assert.equal((await f.store.get(`checkouts/stripe:${chk.checkoutId}`)).status, 'pending');
  s = signed(f, event(f, 'checkout.session.async_payment_succeeded', { ...session, payment_status: 'paid' })); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  assert.equal((await family(f, a.familyId)).subscription.plan, 'starter'); assert.equal((await f.store.get(`checkouts/stripe:${chk.checkoutId}`)).status, 'completed');
});
test('what the second verification found: the same operation twice never expires the session the parent holds; a subscription paid at the provider while the record lags is never ended; the customer by its recorded id; a deleted customer settles the debt; a refund of the previous subscription leaves the new one alone; a held upgrade answers every attempt; the provider\'s answer survives a failed finalisation; the deletion expires the session; changes bind to the record\'s subscription; paused is ended; the refusal row carries its code', async () => {
  // (l) two attempts of one operation: the first stalls in the session call, the second (same id) finishes first; the first then finds the very same session and expires nothing
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0), opL = randomUUID(), rc = account.gw.createCheckout.bind(account.gw); let second = null;
  account.gw.createCheckout = async (args) => { account.gw.createCheckout = rc; second = await payments.checkout(a.ctx, { plan: 'starter', operationId: opL }); return rc(args); };
  const first = await payments.checkout(a.ctx, { plan: 'starter', operationId: opL });
  assert.ok(second.url); assert.deepEqual(first, second, 'both attempts answer the one session'); assert.equal(account.state.expired.length, 0, 'nothing was expired'); assert.equal(sessions(account), 2, 'asked twice under one idempotency key');
  const iL = await f.store.get(`checkouts/stripe:${opL}`); assert.equal(iL.status, 'pending'); assert.equal(iL.lateSessionRef, undefined);
  // (m) the record says past due; the provider says paid and current (its invoice.paid still on its way): nothing is ended, the click is refused and the family marked; once the payment has landed the retried click is refused as a fresh start would be
  const g = rig(), b = await pastDue(g, 'parentB'), opM = randomUUID(); g.account.state.sub.status = 'active'; g.account.state.sub.current_period_end = Math.floor((g.f.now() + 30 * DAY) / 1000);
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'family', operationId: opM }), rejected('PROVIDER_SUBSCRIPTION_PAID'));
  assert.equal(deletes(g.account), 0, 'the paid subscription was not ended'); assert.equal(sessions(g.account), 0); assert.equal((await family(g.f, b.familyId)).providerAttention.code, 'PROVIDER_SUBSCRIPTION_PAID');
  assert.equal((await g.f.store.get(`checkouts/stripe:${opM}`)).endPrevious.status, 'pending', 'the debt stays recorded');
  const paid = event(g.f, 'invoice.paid', { object: 'invoice', id: 'in_late', customer: g.account.state.customer.id, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ amount: 500, price: { id: PRICES.starter }, period: { end: g.account.state.sub.current_period_end } }] } });
  let sg = signed(g.f, paid); assert.equal((await g.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied');
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'family', operationId: opM }), rejected('USE_PLAN_CHANGE')); assert.equal((await g.f.store.get(`checkouts/stripe:${opM}`)).status, 'stale');
  const checkM = await g.support.reconcileProvider(b.familyId, OPERATOR); assert.equal(checkM.match, true); assert.equal(checkM.attentionCleared, true);
  // ...and a subscription winding down (cancel at the period end) is still ended for the returning checkout
  const h = rig(), c = await pastDue(h, 'parentC'); h.account.state.sub.status = 'active'; h.account.state.sub.cancel_at_period_end = true;
  assert.ok((await h.payments.checkout(c.ctx, { plan: 'family', ...op() })).url); assert.equal(h.account.state.sub.status, 'canceled');
  // (n) the customer is found by the id this server recorded, not by a search that lags; one deleted in the dashboard (Stripe ended its subscriptions) settles the debt by that fact
  const m = rig(), e = await pastDue(m, 'parentE'); m.account.state.searchHidden = true;
  assert.ok((await m.payments.checkout(e.ctx, { plan: 'family', ...op() })).url); assert.equal(m.account.state.sub.status, 'canceled', 'found by the recorded id, ended'); assert.equal(deletes(m.account), 1);
  const k = rig(), d = await pastDue(k, 'parentD'), opN = randomUUID(); k.account.state.searchHidden = true; k.account.state.deletedCustomers = [k.account.state.customer.id];
  assert.ok((await k.payments.checkout(d.ctx, { plan: 'family', operationId: opN })).url);
  const iN = await k.f.store.get(`checkouts/stripe:${opN}`); assert.equal(iN.endPrevious.status, 'done'); assert.equal(iN.endPrevious.result.reason, 'CUSTOMER_DELETED'); assert.equal(deletes(k.account), 0, 'nothing to end');
  // (o) a full refund of the previous subscription's last charge — goodwill for the unused dunning month — is that subscription's: recorded, the new paid one untouched; a refund of the new one's charge ends access as before
  const n = rig(), p = await pastDue(n, 'parentF'), opO = randomUUID(), A = await n.payments.checkout(p.ctx, { plan: 'family', operationId: opO }); assert.ok(A.url);
  const oldSub = n.account.state.sub; n.account.activate(PRICES.family); n.account.state.sub.id = 'sub_A'; n.account.state.extraSubs = [oldSub];
  const doneO = event(n.f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: n.account.state.customer.id, subscription: 'sub_A', client_reference_id: opO, metadata: { familyId: p.familyId, checkoutId: opO } });
  sg = signed(n.f, doneO); assert.equal((await n.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied'); assert.equal((await family(n.f, p.familyId)).subscription.providerSubscriptionRef, 'sub_A');
  n.account.state.invoiceOf = { in_old: { id: 'in_old', object: 'invoice', parent: { subscription_details: { subscription: 'sub_1' } } }, in_new: { id: 'in_new', object: 'invoice', subscription: 'sub_A' } };
  n.account.state.charge = { id: 'ch_old', object: 'charge', customer: n.account.state.customer.id, amount: 500, amount_refunded: 500, refunded: true, invoice: 'in_old' };
  sg = signed(n.f, event(n.f, 'refund.created', { object: 'refund', id: 're_old', charge: 'ch_old', amount: 500, status: 'succeeded' })); assert.deepEqual(await n.payments.receive('stripe', sg.raw, sg.headers), { status: 'ignored', reason: 'OTHER_SUBSCRIPTION' });
  let famF = await family(n.f, p.familyId); assert.equal(deriveState(famF.subscription, n.f.now()), 'active'); assert.equal(famF.subscription.plan, 'family');
  n.account.state.charge = { id: 'ch_new', object: 'charge', customer: n.account.state.customer.id, amount: 900, amount_refunded: 900, refunded: true, invoice: 'in_new' };
  sg = signed(n.f, event(n.f, 'refund.created', { object: 'refund', id: 're_new', charge: 'ch_new', amount: 900, status: 'succeeded' })); assert.equal((await n.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied');
  famF = await family(n.f, p.familyId); assert.notEqual(deriveState(famF.subscription, n.f.now()), 'active', 'a full refund of the current subscription ends access');
  // (p) two attempts of one plan change whose upgrade the provider holds: the second answers the invoice too, never SUBSCRIPTION_CHANGED, and the marker stays for the payment
  const q = rig(), s2 = await q.f.family('parentG', 0); await subscribed(q, s2, 'starter'); q.account.state.upgradePayment = 'requires_action';
  const opP = randomUUID(), realChange = q.account.gw.changePlan.bind(q.account.gw); let other = null;
  q.account.gw.changePlan = async (args) => { q.account.gw.changePlan = realChange; other = await q.payments.changePlan(s2.ctx, { plan: 'family', operationId: opP }); return realChange(args); };
  const mine = await q.payments.changePlan(s2.ctx, { plan: 'family', operationId: opP });
  assert.equal(other.pending, true); assert.deepEqual(mine, other, 'both attempts answer the held upgrade'); assert.ok(mine.invoiceUrl);
  assert.equal((await q.f.store.get(`billingChangeIntents/stripe:${opP}`)).status, 'awaiting_payment'); assert.equal((await family(q.f, s2.familyId)).billingIntent.operationId, opP, 'the marker stays for the payment');
  // (q) the provider answered, then the finalisation died: the answer is on the intent before anything else can fail, and the retry finalises
  const t = rig(), u = await t.f.family('parentH', 0); await subscribed(t, u, 'starter'); const opQ = randomUUID(), realTx = t.f.store.transaction.bind(t.f.store), realChange2 = t.account.gw.changePlan.bind(t.account.gw); let armed = false, blown = 0;
  t.account.gw.changePlan = async (args) => { const answer = await realChange2(args); armed = true; return answer; };
  t.f.store.transaction = (fn, opts) => { if (armed && ++blown === 2) { armed = false; return Promise.reject(Error('ECONNRESET')); } return realTx(fn, opts); }; // the answer's own transaction lands; the finalisation dies
  await assert.rejects(t.payments.changePlan(u.ctx, { plan: 'family', operationId: opQ }), /ECONNRESET/); t.f.store.transaction = realTx;
  const iq = await t.f.store.get(`billingChangeIntents/stripe:${opQ}`); assert.equal(iq.status, 'creating'); assert.ok(iq.providerAnsweredAt); assert.ok(iq.providerOperationRef); assert.equal(iq.proration.applied, true);
  assert.equal(t.account.state.sub.items.data[0].price.id, PRICES.family, 'the provider applied the change'); assert.equal((await family(t.f, u.familyId)).subscription.plan, 'starter', 'not yet finalised');
  assert.equal((await t.payments.changePlan(u.ctx, { plan: 'family', operationId: opQ })).entitlement.plan, 'family'); assert.equal((await t.f.store.get(`billingChangeIntents/stripe:${opQ}`)).status, 'applied');
  // (r) the deletion expires the hosted session its freeze superseded; a payment that still lands on it is the operator's, never a rejection nobody reads
  const v = rig(), w = await v.f.family('parentI', 0), opR = randomUUID(), R = await v.payments.checkout(w.ctx, { plan: 'starter', operationId: opR }); assert.ok(R.url);
  await v.support.requestDeletion(w.ctx, op()); await v.support.executeDeletion(w.familyId, { operator: OPERATOR, force: true });
  const frozen = await v.f.store.get(`checkouts/stripe:${opR}`); assert.equal(frozen.status, 'superseded_by_deletion'); assert.equal(frozen.expiredByDeletion.expired, true); assert.ok(v.account.state.expired.some((x) => x.includes(R.providerCheckoutRef)), 'expired at Stripe');
  v.account.activate(PRICES.starter);
  const lateR = event(v.f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: v.account.state.customer.id, subscription: 'sub_1', client_reference_id: opR, metadata: { familyId: w.familyId, checkoutId: opR } });
  sg = signed(v.f, lateR); assert.deepEqual(await v.payments.receive('stripe', sg.raw, sg.headers), { status: 'reconciliation_required', reason: 'FAMILY_DELETED' });
  assert.equal((await v.f.store.get(`billingEvents/stripe:${lateR.id}`)).outcome.status, 'reconciliation_required');
  // (s) a plan change or a cancellation acts only on the subscription the family's record names: the provider's live one being another, nothing is posted and the family is marked
  const x = rig(), y = await x.f.family('parentJ', 0); await subscribed(x, y, 'starter'); x.account.state.sub.id = 'sub_other'; x.account.calls.length = 0;
  await assert.rejects(x.payments.changePlan(y.ctx, { plan: 'family', operationId: randomUUID() }), rejected('PROVIDER_SUBSCRIPTION_LIVE'));
  await assert.rejects(x.payments.cancel(y.ctx, op()), rejected('PROVIDER_SUBSCRIPTION_LIVE'));
  assert.equal(x.account.calls.filter((call) => call.method === 'POST').length, 0, 'nothing was posted'); assert.equal((await family(x.f, y.familyId)).providerAttention.code, 'PROVIDER_SUBSCRIPTION_LIVE');
  // (t) a paused subscription can bill again: ended for the returning checkout, never taken for ended
  const z = rig(), zz = await pastDue(z, 'parentK'); z.account.state.sub.status = 'paused';
  assert.ok((await z.payments.checkout(zz.ctx, { plan: 'family', ...op() })).url); assert.equal(z.account.state.sub.status, 'canceled'); assert.equal(deletes(z.account), 1);
  // (u) the refusal's audit row carries its code, and no childId
  const rows = (await x.f.store.list('audit')).filter((row) => row.action === 'billing.refused' && row.familyId === y.familyId); assert.ok(rows.length >= 2); assert.ok(rows.every((row) => row.code === 'PROVIDER_SUBSCRIPTION_LIVE' && row.childId === null));
});
