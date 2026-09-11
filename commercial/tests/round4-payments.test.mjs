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
  const old = t.account.state.sub; t.account.activate(PRICES.family, undefined, { id: 'sub_A', metadata: { checkoutId: opA2 } }); t.account.state.extraSubs = [old]; // paid: sub_A live and naming checkout A (as createCheckout stamps it), sub_1 ended
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
test('the export with the production page and cap: five thousand and one rows are all there and not truncated (a guard against the third round\'s single bounded query, which stopped at five thousand)', async () => {
  const f = fixture(), a = await f.family('parentA', 1), own = (await f.store.query('audit', 'familyId', a.familyId, 100)).length, N = 5001 - own;
  for (let batch = 0; batch < N; batch += 400) await f.store.transaction(async (tx) => { for (let i = batch; i < Math.min(N, batch + 400); i++) tx.set(`audit/f${String(i).padStart(5, '0')}`, { action: 'fill', uid: 'parentA', familyId: a.familyId, at: f.now() + i, expireAt: f.now() + DAY }); });
  const exp = await f.support.exportFamily(a.ctx); assert.equal(exp.audit.length, 5001); assert.equal(exp.auditTruncated, false);
});
test('the operator report reads the family\'s rows only — never a whole collection of events, intents, checkouts or reconciliations', async () => {
  const r = rig(), { f, support } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter'); await f.family('parentB', 0);
  const listed = [], realList = f.store.list.bind(f.store); f.store.list = async (c) => { listed.push(c); return realList(c); };
  const report = await support.familyReport(a.familyId); f.store.list = realList;
  assert.ok(report.inbox.length >= 1); assert.ok(report.checkouts.length >= 1);
  for (const c of ['billingEvents', 'billingChangeIntents', 'checkouts', 'billingReconciliations', 'audit']) assert.ok(!listed.includes(c), `${c} is never listed whole`);
  assert.deepEqual(report.truncated, []);
  // the order: by time, ties by receipt then id; intents and checkouts by creation; a capped collection is named once and capped once
  const ref = r.account.state.customer.id, t0 = f.now(), row = (id, at, receivedAt) => ({ provider: 'stripe', providerEventId: id, type: 'stripe.noop', at, seq: null, receivedAt, lastReceivedAt: receivedAt, attempts: 1, customer: ref, familyId: a.familyId, data: {}, refundRef: null, invoiceRef: null, checkoutRef: null, fingerprint: id, outcome: { status: 'ignored', reason: 'UNSUPPORTED_EVENT' } });
  await f.store.transaction(async (tx) => {
    for (const [id, at, rc] of [['e3', t0 + 30, t0], ['e1', t0 + 10, t0], ['e2', t0 + 20, t0], ['e5', t0 + 40, t0 + 2], ['e4', t0 + 40, t0 + 1]]) tx.set(`billingEvents/stripe:${id}`, row(id, at, rc));
    for (const [id, createdAt] of [['c2', t0 - 5], ['c1', t0 - 9]]) tx.set(`checkouts/stripe:${id}`, { provider: 'stripe', checkoutId: id, familyId: a.familyId, customerRef: 'x', plan: 'starter', priceId: PRICES.starter, fingerprint: id, status: 'superseded', providerCheckoutRef: null, createdAt, completedAt: null, result: null });
  });
  const ordered = await support.familyReport(a.familyId);
  assert.deepEqual(ordered.inbox.map((e) => e.id).filter((id) => /^e\d$/.test(id)), ['e1', 'e2', 'e3', 'e4', 'e5']); assert.deepEqual(ordered.checkouts.map((c) => c.checkoutId).slice(0, 2), ['c1', 'c2']);
  const small = new Support({ foundation: f.service, store: f.store, billing: f.billing, payments: r.payments, now: f.now, auditPage: 2, auditCap: 3 }), capped = await small.familyReport(a.familyId);
  assert.deepEqual(capped.truncated, ['billingEvents']); assert.equal(capped.inbox.length, 3);
});
test('a session completed unpaid (a bank debit still clearing) grants nothing; its async payment success is the completion', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0), chk = await payments.checkout(a.ctx, { plan: 'starter', ...op() }); account.activate(PRICES.starter);
  const session = { object: 'checkout.session', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: chk.checkoutId, metadata: { familyId: a.familyId, checkoutId: chk.checkoutId } };
  let s = signed(f, event(f, 'checkout.session.completed', { ...session, payment_status: 'unpaid' })); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'ignored', reason: 'PAYMENT_PENDING' });
  assert.notEqual((await family(f, a.familyId)).subscription?.plan, 'starter', 'nothing granted'); const remembered = await f.store.get(`checkouts/stripe:${chk.checkoutId}`); assert.equal(remembered.status, 'pending'); assert.equal(remembered.paymentPending.subscriptionRef, 'sub_1'); assert.equal(remembered.paymentPending.status, 'unpaid');
  const still = event(f, 'checkout.session.async_payment_succeeded', { ...session, payment_status: 'unpaid' }); s = signed(f, still); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'ignored', reason: 'PAYMENT_PENDING' }, 'a success that still says unpaid grants nothing'); assert.equal((await f.store.get(`billingEvents/stripe:${still.id}`)).type, 'checkout.payment_pending');
  s = signed(f, event(f, 'checkout.session.async_payment_succeeded', { ...session, payment_status: 'paid' })); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  assert.equal((await family(f, a.familyId)).subscription.plan, 'starter'); assert.equal((await f.store.get(`checkouts/stripe:${chk.checkoutId}`)).status, 'completed');
  // a session with no payment status at all is never paid; one with nothing to pay (a coupon, a trial) is complete
  const g = rig(), b = await g.f.family('parentB', 0), chkB = await g.payments.checkout(b.ctx, { plan: 'starter', ...op() }); g.account.activate(PRICES.starter);
  const sessionB = { object: 'checkout.session', customer: g.account.state.customer.id, subscription: 'sub_1', client_reference_id: chkB.checkoutId, metadata: { familyId: b.familyId, checkoutId: chkB.checkoutId } };
  const noStatus = event(g.f, 'checkout.session.completed', sessionB); s = signed(g.f, noStatus); assert.deepEqual(await g.payments.receive('stripe', s.raw, s.headers), { status: 'ignored', reason: 'PAYMENT_PENDING' }); assert.equal((await g.f.store.get(`checkouts/stripe:${chkB.checkoutId}`)).paymentPending.status, 'unknown'); assert.notEqual((await family(g.f, b.familyId)).subscription?.plan, 'starter');
  s = signed(g.f, event(g.f, 'checkout.session.completed', { ...sessionB, payment_status: 'no_payment_required' })); assert.equal((await g.payments.receive('stripe', s.raw, s.headers)).status, 'applied'); assert.equal((await family(g.f, b.familyId)).subscription.plan, 'starter'); assert.equal((await g.f.store.get(`checkouts/stripe:${chkB.checkoutId}`)).status, 'completed');
});
test('what the second verification found: the same operation twice never expires the session the parent holds; a subscription paid at the provider while the record lags is never ended; the customer by its recorded id; a deleted customer settles the debt; a refund of the previous subscription leaves the new one alone; a held upgrade answers every attempt; the provider\'s answer survives a failed finalisation; the deletion expires the session; changes bind to the record\'s subscription; paused is ended; the refusal row carries its code', async () => {
  // (l) two attempts of one operation: the first stalls in the session call, the second (same id) finishes first; the first then finds the very same session and expires nothing
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0), opL = randomUUID(), rc = account.gw.createCheckout.bind(account.gw); let second = null;
  account.gw.createCheckout = async (args) => { account.gw.createCheckout = rc; second = await payments.checkout(a.ctx, { plan: 'starter', operationId: opL }); return rc(args); };
  const first = await payments.checkout(a.ctx, { plan: 'starter', operationId: opL });
  assert.ok(second.url); assert.deepEqual(first, second, 'both attempts answer the one session'); assert.equal(account.state.expired.length, 0, 'nothing was expired'); assert.equal(sessions(account), 2, 'asked twice under one idempotency key');
  const iL = await f.store.get(`checkouts/stripe:${opL}`); assert.equal(iL.status, 'pending'); assert.equal(iL.lateSessionRef, undefined);
  // ...and when the intent was superseded meanwhile — attempt 1 of A finalised, B superseded A and expired A's session, attempt 2 of A returns with that very session — the answer is closed, nothing is expired twice
  const r2 = rig(), a2 = await r2.f.family('parentA2', 0), opA2 = randomUUID(), opB2 = randomUUID(), rc2 = r2.account.gw.createCheckout.bind(r2.account.gw); let att1 = null, B = null;
  r2.account.gw.createCheckout = async (args) => { r2.account.gw.createCheckout = rc2; att1 = await r2.payments.checkout(a2.ctx, { plan: 'starter', operationId: opA2 }); B = await r2.payments.checkout(a2.ctx, { plan: 'starter', operationId: opB2 }); return rc2(args); };
  const att2 = await r2.payments.checkout(a2.ctx, { plan: 'starter', operationId: opA2 });
  assert.ok(att1.url); assert.ok(B.url); assert.notEqual(B.providerCheckoutRef, att1.providerCheckoutRef);
  assert.deepEqual(att2, { ...att1, checkoutId: opA2, url: null, superseded: true }, 'the stalled attempt answers its superseded session closed');
  assert.deepEqual(r2.account.state.expired.map((x) => x.split('/').at(-2)), [att1.providerCheckoutRef], 'expired once, by B; never again by the stalled attempt');
  const iA2 = await r2.f.store.get(`checkouts/stripe:${opA2}`); assert.equal(iA2.status, 'superseded'); assert.equal(iA2.lateSessionRef, undefined); assert.equal((await family(r2.f, a2.familyId)).checkoutIntent.stripe, opB2);
  // (m) the record says past due; the provider says paid and current (its invoice.paid still on its way): nothing is ended, the click is refused and the family marked; once the payment has landed the retried click is refused as a fresh start would be
  const g = rig(), b = await pastDue(g, 'parentB'), opM = randomUUID(); g.account.state.sub.status = 'active'; g.account.state.sub.current_period_end = Math.floor((g.f.now() + 30 * DAY) / 1000);
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'family', operationId: opM }), rejected('PROVIDER_SUBSCRIPTION_PAID'));
  assert.equal(deletes(g.account), 0, 'the paid subscription was not ended'); assert.equal(sessions(g.account), 0); assert.equal((await family(g.f, b.familyId)).providerAttention.code, 'PROVIDER_SUBSCRIPTION_PAID');
  assert.equal((await g.f.store.get(`checkouts/stripe:${opM}`)).endPrevious.status, 'pending', 'the debt stays recorded');
  const paid = event(g.f, 'invoice.paid', { object: 'invoice', id: 'in_late', customer: g.account.state.customer.id, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ amount: 500, price: { id: PRICES.starter }, period: { end: g.account.state.sub.current_period_end } }] } });
  let sg = signed(g.f, paid); assert.equal((await g.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied');
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'family', operationId: opM }), rejected('USE_PLAN_CHANGE')); assert.equal((await g.f.store.get(`checkouts/stripe:${opM}`)).status, 'stale');
  const checkM = await g.support.reconcileProvider(b.familyId, OPERATOR); assert.equal(checkM.match, true); assert.equal(checkM.attentionCleared, true);
  // ...and a subscription winding down (cancel at the period end) is still ended for the returning checkout, as is one Stripe holds `unpaid` (dunning exhausted); one `trialing` is paid and current
  const h = rig(), c = await pastDue(h, 'parentC'); h.account.state.sub.status = 'active'; h.account.state.sub.cancel_at_period_end = true;
  assert.ok((await h.payments.checkout(c.ctx, { plan: 'family', ...op() })).url); assert.equal(h.account.state.sub.status, 'canceled');
  const h2 = rig(), c2 = await pastDue(h2, 'parentC2'); h2.account.state.sub.status = 'unpaid';
  assert.ok((await h2.payments.checkout(c2.ctx, { plan: 'family', ...op() })).url); assert.equal(h2.account.state.sub.status, 'canceled', 'unpaid is not paid: ended'); assert.equal(deletes(h2.account), 1);
  const h3 = rig(), c3 = await pastDue(h3, 'parentC3'); h3.account.state.sub.status = 'trialing';
  await assert.rejects(h3.payments.checkout(c3.ctx, { plan: 'family', ...op() }), rejected('PROVIDER_SUBSCRIPTION_PAID'), 'trialing is current: never ended'); assert.equal(deletes(h3.account), 0); assert.equal(sessions(h3.account), 0);
  // (n) the customer is found by the id this server recorded, not by a search that lags; one deleted in the dashboard (Stripe ended its subscriptions) settles the debt by that fact
  const m = rig(), e = await pastDue(m, 'parentE'); m.account.state.searchHidden = true;
  assert.ok((await m.payments.checkout(e.ctx, { plan: 'family', ...op() })).url); assert.equal(m.account.state.sub.status, 'canceled', 'found by the recorded id, ended'); assert.equal(deletes(m.account), 1);
  assert.equal(m.account.calls.filter((c) => c.method === 'POST' && c.path === '/v1/customers').length, 0, 'no second customer minted for the session'); assert.equal((await family(m.f, e.familyId)).providerCustomer.stripe, 'cus_live1');
  const k = rig(), d = await pastDue(k, 'parentD'), opN = randomUUID(); k.account.state.searchHidden = true; k.account.state.deletedCustomers = [k.account.state.customer.id]; k.account.state.sub.customer = 'cus_live1'; k.account.state.sub.status = 'canceled'; // Stripe ended it with the customer
  assert.ok((await k.payments.checkout(d.ctx, { plan: 'family', operationId: opN })).url);
  const iN = await k.f.store.get(`checkouts/stripe:${opN}`); assert.equal(iN.endPrevious.status, 'done'); assert.equal(iN.endPrevious.result.reason, 'CUSTOMER_DELETED'); assert.equal(iN.endPrevious.result.cancelled, true); assert.equal(iN.endPrevious.result.already, true); assert.equal(deletes(k.account), 0, 'nothing to end');
  assert.equal((await family(k.f, d.familyId)).providerCustomer.stripe, 'cus_live1_2', 'the session minted a fresh customer'); assert.equal((await k.payments.providerState('stripe', d.familyId && (await family(k.f, d.familyId)).billing.stripe, 'cus_live1')).customerDeleted, true);
  // the parent abandons that session and clicks again: the record still names sub_1, absent from the new customer's list — asked for by its id, it is ended already, and the family can start again
  const opN2 = randomUUID(); assert.ok((await k.payments.checkout(d.ctx, { plan: 'big', operationId: opN2 })).url); assert.equal((await k.f.store.get(`checkouts/stripe:${opN2}`)).endPrevious.result.already, true); assert.equal(deletes(k.account), 0);
  // a named subscription absent from the customer's list, and not held by the provider at all: never substituted by another of the customer's
  const ns = rig(), nsf = await pastDue(ns, 'parentNS'); ns.account.state.sub = sub(PRICES.big, ns.f.now() + 20 * DAY, { id: 'sub_dash', status: 'paused' }); // the record names sub_1; Stripe holds only a paused sub_dash for the customer
  await assert.rejects(ns.payments.checkout(nsf.ctx, { plan: 'family', ...op() }), rejected('PROVIDER_SUBSCRIPTION_NOT_FOUND')); assert.equal(deletes(ns.account), 0); assert.equal(sessions(ns.account), 0); assert.equal(ns.account.state.sub.status, 'paused');
  // (o) a full refund of the previous subscription's last charge — goodwill for the unused dunning month — is that subscription's: recorded, the new paid one untouched; a refund of the new one's charge ends access as before
  const n = rig(), p = await pastDue(n, 'parentF'), opO = randomUUID(), A = await n.payments.checkout(p.ctx, { plan: 'family', operationId: opO }); assert.ok(A.url);
  const oldSub = n.account.state.sub; n.account.activate(PRICES.family); n.account.state.sub.id = 'sub_A'; n.account.state.extraSubs = [oldSub];
  const doneO = event(n.f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: n.account.state.customer.id, subscription: 'sub_A', client_reference_id: opO, metadata: { familyId: p.familyId, checkoutId: opO } });
  sg = signed(n.f, doneO); assert.equal((await n.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied'); assert.equal((await family(n.f, p.familyId)).subscription.providerSubscriptionRef, 'sub_A');
  n.account.state.invoiceOf = { in_old: { id: 'in_old', object: 'invoice', parent: { subscription_details: { subscription: 'sub_1' } } }, in_old_flat: { id: 'in_old_flat', object: 'invoice', subscription: 'sub_1' }, in_new: { id: 'in_new', object: 'invoice', subscription: 'sub_A' } };
  n.account.state.charge = { id: 'ch_old', object: 'charge', customer: n.account.state.customer.id, amount: 500, amount_refunded: 500, refunded: true, invoice: 'in_old' };
  sg = signed(n.f, event(n.f, 'refund.created', { object: 'refund', id: 're_old', charge: 'ch_old', amount: 500, status: 'succeeded' })); assert.deepEqual(await n.payments.receive('stripe', sg.raw, sg.headers), { status: 'ignored', reason: 'OTHER_SUBSCRIPTION' });
  sg = signed(n.f, event(n.f, 'charge.dispute.created', { object: 'dispute', id: 'dp_old', charge: 'ch_old', amount: 500, status: 'needs_response' })); assert.deepEqual(await n.payments.receive('stripe', sg.raw, sg.headers), { status: 'ignored', reason: 'OTHER_SUBSCRIPTION' }, 'a dispute of the old charge is the old subscription\'s too');
  n.account.state.charge = { id: 'ch_old2', object: 'charge', customer: n.account.state.customer.id, amount: 500, amount_refunded: 500, refunded: true, invoice: 'in_old_flat' };
  sg = signed(n.f, event(n.f, 'refund.created', { object: 'refund', id: 're_old2', charge: 'ch_old2', amount: 500, status: 'succeeded' })); assert.deepEqual(await n.payments.receive('stripe', sg.raw, sg.headers), { status: 'ignored', reason: 'OTHER_SUBSCRIPTION' }, 'the invoice naming its subscription flat, as older API shapes do');
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
  const t = rig(), u = await t.f.family('parentH', 0); await subscribed(t, u, 'starter'); const opQ = randomUUID(), realParent = t.payments.billing.parent.bind(t.payments.billing), realChange2 = t.account.gw.changePlan.bind(t.account.gw); let armed = false;
  t.account.gw.changePlan = async (args) => { const answer = await realChange2(args); armed = true; return answer; };
  t.payments.billing.parent = async (...args) => { if (armed) { armed = false; throw Error('ECONNRESET'); } return realParent(...args); }; // the finalisation is the first thing after the answer to ask for the parent: it dies there
  await assert.rejects(t.payments.changePlan(u.ctx, { plan: 'family', operationId: opQ }), /ECONNRESET/); t.payments.billing.parent = realParent; t.account.gw.changePlan = realChange2;
  const iq = await t.f.store.get(`billingChangeIntents/stripe:${opQ}`); assert.equal(iq.status, 'creating'); assert.ok(iq.providerAnsweredAt, 'the provider\'s answer is on the intent'); assert.ok(iq.providerOperationRef); assert.equal(iq.proration.applied, true);
  assert.equal(t.account.state.sub.items.data[0].price.id, PRICES.family, 'the provider applied the change'); assert.equal((await family(t.f, u.familyId)).subscription.plan, 'starter', 'not yet finalised');
  t.f.advance(5000); assert.equal((await t.payments.changePlan(u.ctx, { plan: 'family', operationId: opQ })).entitlement.plan, 'family'); const applied = await t.f.store.get(`billingChangeIntents/stripe:${opQ}`); assert.equal(applied.status, 'applied'); assert.equal(applied.providerAnsweredAt, iq.providerAnsweredAt, 'recorded once, the first time');
  // a takeover during the provider call: X stalls past the in-flight window, Y takes over and applies; X's late answer lands on X's superseded record all the same — money the provider moved is never without a record
  const tk = rig(), tv = await tk.f.family('parentW', 0); await subscribed(tk, tv, 'starter'); const opX = randomUUID(), opY = randomUUID(), realChW = tk.account.gw.changePlan.bind(tk.account.gw); let yDone = null;
  tk.account.gw.changePlan = async (args) => { const answer = await realChW(args); tk.account.gw.changePlan = realChW; tk.f.advance(tk.payments.inflightMs + 1000); const tv2 = await tk.f.login('parentW'); yDone = await tk.payments.changePlan(tv2.ctx, { plan: 'big', operationId: opY }); return answer; };
  await assert.rejects(tk.payments.changePlan(tv.ctx, { plan: 'family', operationId: opX })); assert.equal(yDone.entitlement.plan, 'big');
  const xi = await tk.f.store.get(`billingChangeIntents/stripe:${opX}`); assert.equal(xi.status, 'superseded'); assert.equal(xi.supersededBy, opY); assert.ok(xi.providerAnsweredAt); assert.equal(xi.proration.applied, true); assert.ok(xi.providerOperationRef);
  assert.equal((await tk.f.store.get(`billingChangeIntents/stripe:${opY}`)).status, 'applied'); assert.equal(tk.account.state.sub.items.data[0].price.id, PRICES.big);
  // (r) the deletion expires the hosted session its freeze superseded; a payment that still lands on it is the operator's, never a rejection nobody reads
  const v = rig(), w = await v.f.family('parentI', 0), opR = randomUUID(), R = await v.payments.checkout(w.ctx, { plan: 'starter', operationId: opR }); assert.ok(R.url);
  await v.support.requestDeletion(w.ctx, op()); await v.support.executeDeletion(w.familyId, { operator: OPERATOR, force: true });
  assert.ok(v.account.state.expired.some((x) => x.includes(R.providerCheckoutRef)), 'expired at Stripe'); const frozen = await v.f.store.get(`checkouts/stripe:${opR}`); assert.equal(frozen.status, 'superseded_by_deletion'); assert.equal(frozen.expiredByDeletion?.expired, true, 'recorded on the checkout');
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
  for (const status of ['paused', 'incomplete']) {
    const z = rig(), zz = await pastDue(z, `parentK-${status}`); z.account.state.sub.status = status;
    assert.ok((await z.payments.checkout(zz.ctx, { plan: 'family', ...op() })).url, status); assert.equal(z.account.state.sub.status, 'canceled', `${status} is ended`); assert.equal(deletes(z.account), 1);
  }
  // (u) the refusal's audit row carries its code, and no childId
  const rows = (await x.f.store.list('audit')).filter((row) => row.action === 'billing.refused' && row.familyId === y.familyId); assert.ok(rows.length >= 2); assert.ok(rows.every((row) => row.code === 'PROVIDER_SUBSCRIPTION_LIVE' && row.childId === null));
  const { child: kid } = await x.f.child(y.ctx); const created = (await x.f.store.list('audit')).find((row) => row.action === 'child.created' && row.familyId === y.familyId); assert.equal(created.childId, kid.id, 'a child-scoped row keeps its childId'); const plain = (await x.f.store.list('audit')).find((row) => row.action === 'billing.checkout' && row.familyId === y.familyId); assert.equal(plain.childId, null); assert.equal(plain.code, undefined);
});
test('a first checkout paid at the provider and clicked again before its completion landed: the subscription names the checkout, which is reinstated — never left superseded with its payment refused — and a completion the inbox rejected meanwhile is processed again; a subscription naming no checkout of ours is the operator\'s', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0), opA = randomUUID(), A = await payments.checkout(a.ctx, { plan: 'starter', operationId: opA }); assert.ok(A.url);
  account.activate(PRICES.starter, undefined, { metadata: { checkoutId: opA } }); // paid: Stripe holds sub_1 naming checkout A; its webhook is late
  const opB = randomUUID(); await assert.rejects(payments.checkout(a.ctx, { plan: 'starter', operationId: opB }), rejected('CHECKOUT_COMPLETING'));
  assert.equal(sessions(account), 1, 'no second session'); assert.equal((await f.store.get(`checkouts/stripe:${opA}`)).status, 'pending', 'A reinstated'); assert.equal((await f.store.get(`checkouts/stripe:${opB}`)).closedReason, 'CHECKOUT_COMPLETING'); assert.equal((await family(f, a.familyId)).checkoutIntent.stripe, opA);
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: opA, metadata: { familyId: a.familyId, checkoutId: opA } });
  let sg = signed(f, done); assert.equal((await payments.receive('stripe', sg.raw, sg.headers)).status, 'applied'); assert.equal((await family(f, a.familyId)).subscription.plan, 'starter');
  // a subscription the dashboard made (naming no checkout of ours) is the operator's: refused, nothing reinstated
  const g = rig(), b = await g.f.family('parentB', 0), opC = randomUUID(); assert.ok((await g.payments.checkout(b.ctx, { plan: 'starter', operationId: opC })).url); g.account.activate(PRICES.starter);
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('PROVIDER_SUBSCRIPTION_LIVE')); assert.equal((await g.f.store.get(`checkouts/stripe:${opC}`)).status, 'superseded'); assert.equal(sessions(g.account), 1);
  // the completion that landed while the checkout was superseded — between the second click's first transaction and its reinstatement — is queued and applied
  const h = rig(), c = await h.f.family('parentC', 0), opD = randomUUID(), D = await h.payments.checkout(c.ctx, { plan: 'starter', operationId: opD }); assert.ok(D.url);
  h.account.activate(PRICES.starter, undefined, { metadata: { checkoutId: opD } });
  const late = event(h.f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: h.account.state.customer.id, subscription: 'sub_1', client_reference_id: opD, metadata: { familyId: c.familyId, checkoutId: opD } });
  const realInspect = h.account.gw.inspect.bind(h.account.gw);
  h.account.gw.inspect = async (...args) => { h.account.gw.inspect = realInspect; const sg2 = signed(h.f, late); assert.deepEqual(await h.payments.receive('stripe', sg2.raw, sg2.headers), { status: 'rejected', reason: 'CHECKOUT_SUPERSEDED' }); return realInspect(...args); };
  await assert.rejects(h.payments.checkout(c.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('CHECKOUT_COMPLETING'));
  assert.equal((await family(h.f, c.familyId)).subscription?.plan, 'starter', 'the rejected completion was processed again'); assert.equal((await h.f.store.get(`checkouts/stripe:${opD}`)).status, 'completed'); assert.equal((await h.f.store.get(`billingEvents/stripe:${late.id}`)).outcome.status, 'applied');
  // the same on the returning family's path: the live subscription names the older checkout, or it does not
  const k = rig(), d = await pastDue(k, 'parentD'), opE = randomUUID(), E = await k.payments.checkout(d.ctx, { plan: 'family', operationId: opE }); assert.ok(E.url);
  const oldSub = k.account.state.sub; k.account.activate(PRICES.family, undefined, { id: 'sub_E', metadata: { checkoutId: 'someone-else' } }); k.account.state.extraSubs = [oldSub];
  await assert.rejects(k.payments.checkout(d.ctx, { plan: 'family', operationId: randomUUID() }), rejected('PROVIDER_SUBSCRIPTION_LIVE'), 'a live subscription naming another checkout is not E completing'); assert.equal((await k.f.store.get(`checkouts/stripe:${opE}`)).status, 'superseded');
});
test('a session completed with its payment clearing (a bank debit) is remembered on the checkout: a later click never supersedes it, its async success completes it, and a deletion meanwhile ends the subscription it made', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0), opA = randomUUID(), A = await payments.checkout(a.ctx, { plan: 'starter', operationId: opA }); assert.ok(A.url);
  account.activate(PRICES.starter, undefined, { metadata: { checkoutId: opA } });
  const session = { object: 'checkout.session', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: opA, metadata: { familyId: a.familyId, checkoutId: opA } };
  let sg = signed(f, event(f, 'checkout.session.completed', { ...session, payment_status: 'unpaid' })); assert.deepEqual(await payments.receive('stripe', sg.raw, sg.headers), { status: 'ignored', reason: 'PAYMENT_PENDING' });
  await assert.rejects(payments.checkout(a.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('CHECKOUT_COMPLETING')); assert.equal((await f.store.get(`checkouts/stripe:${opA}`)).status, 'pending', 'never superseded'); assert.equal(sessions(account), 1); assert.equal((await family(f, a.familyId)).providerAttention.code, 'CHECKOUT_COMPLETING');
  sg = signed(f, event(f, 'checkout.session.async_payment_succeeded', { ...session, payment_status: 'paid' })); assert.equal((await payments.receive('stripe', sg.raw, sg.headers)).status, 'applied');
  assert.equal((await family(f, a.familyId)).subscription.plan, 'starter'); assert.equal((await f.store.get(`checkouts/stripe:${opA}`)).status, 'completed');
  // the family deleted while the debit was clearing: the subscription the session made is ended, recorded as the deletion's provider cancellation; a late success is the operator's; the sweep is quiet
  const g = rig(), b = await g.f.family('parentB', 0), opB = randomUUID(), B = await g.payments.checkout(b.ctx, { plan: 'starter', operationId: opB }); assert.ok(B.url);
  g.account.activate(PRICES.starter, undefined, { metadata: { checkoutId: opB } });
  const sessionB = { object: 'checkout.session', customer: g.account.state.customer.id, subscription: 'sub_1', client_reference_id: opB, metadata: { familyId: b.familyId, checkoutId: opB } };
  sg = signed(g.f, event(g.f, 'checkout.session.completed', { ...sessionB, payment_status: 'unpaid' })); assert.equal((await g.payments.receive('stripe', sg.raw, sg.headers)).reason, 'PAYMENT_PENDING');
  await g.support.requestDeletion(b.ctx, op()); const rec = await g.support.executeDeletion(b.familyId, { operator: OPERATOR, force: true });
  assert.equal(g.account.state.sub.status, 'canceled', 'ended at Stripe'); assert.equal(rec.providerCancellation.status, 'cancelled'); assert.equal(rec.providerCancellation.checkoutId, opB);
  const frozenB = await g.f.store.get(`checkouts/stripe:${opB}`); assert.equal(frozenB.status, 'superseded_by_deletion'); assert.equal(frozenB.endedByDeletion.cancelled, true); assert.equal(frozenB.expiredByDeletion.expired, true);
  sg = signed(g.f, event(g.f, 'checkout.session.async_payment_succeeded', { ...sessionB, payment_status: 'paid' })); assert.deepEqual(await g.payments.receive('stripe', sg.raw, sg.headers), { status: 'reconciliation_required', reason: 'FAMILY_DELETED' });
  assert.equal((await g.support.inspectAll({ operator: OPERATOR })).findings.filter((x) => x.code === 'DELETED_FAMILY_PROVIDER_LIVE' && x.family === b.familyId).length, 0, 'ended: nothing left live');
});
test('a refund delivered before the completion it belongs to: the new subscription\'s refund waits and applies right after the completion (never access on a refunded charge); the old subscription\'s refund never makes the completion stale; a record the server itself ended is ahead of the provider, and the returning checkout ends what still bills', async () => {
  const r = rig(), { f, account, payments } = r, a = await pastDue(r, 'parentA'), opA = randomUUID(), A = await payments.checkout(a.ctx, { plan: 'family', operationId: opA }); assert.ok(A.url);
  const oldSub = account.state.sub; account.activate(PRICES.family, undefined, { id: 'sub_A', metadata: { checkoutId: opA } }); account.state.extraSubs = [oldSub];
  account.state.invoiceOf = { in_new: { id: 'in_new', object: 'invoice', parent: { subscription_details: { subscription: 'sub_A' } } } };
  account.state.charge = { id: 'ch_new', object: 'charge', customer: account.state.customer.id, amount: 900, amount_refunded: 900, refunded: true, invoice: 'in_new' };
  let sg = signed(f, event(f, 'refund.created', { object: 'refund', id: 're_new', charge: 'ch_new', amount: 900, status: 'succeeded' })); assert.deepEqual(await payments.receive('stripe', sg.raw, sg.headers), { status: 'requires_action', reason: 'CHECKOUT_PENDING' });
  f.advance(60_000);
  sg = signed(f, event(f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: account.state.customer.id, subscription: 'sub_A', client_reference_id: opA, metadata: { familyId: a.familyId, checkoutId: opA } })); assert.equal((await payments.receive('stripe', sg.raw, sg.headers)).status, 'applied');
  const famA = await family(f, a.familyId); assert.equal(famA.subscription.providerSubscriptionRef, 'sub_A'); assert.deepEqual((famA.subscription.refunds || []).map((x) => x.amountCents), [900], 'the refund applied right after the completion'); assert.notEqual(deriveState(famA.subscription, f.now()), 'active', 'no access on a refunded charge');
  // the old subscription's goodwill refund arrives before the delayed completion: recorded on the old record, and the completion still applies
  const g = rig(), b = await pastDue(g, 'parentB'), opB = randomUUID(), B = await g.payments.checkout(b.ctx, { plan: 'family', operationId: opB }); assert.ok(B.url);
  const oldB = g.account.state.sub; g.account.activate(PRICES.family, undefined, { id: 'sub_A', metadata: { checkoutId: opB } }); g.account.state.extraSubs = [oldB];
  g.account.state.invoiceOf = { in_old: { id: 'in_old', object: 'invoice', parent: { subscription_details: { subscription: 'sub_1' } } } };
  g.account.state.charge = { id: 'ch_old', object: 'charge', customer: g.account.state.customer.id, amount: 500, amount_refunded: 500, refunded: true, invoice: 'in_old' };
  g.f.advance(600_000); sg = signed(g.f, event(g.f, 'refund.created', { object: 'refund', id: 're_old', charge: 'ch_old', amount: 500, status: 'succeeded' })); assert.equal((await g.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied', 'the old record\'s own refund');
  const doneB = event(g.f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: g.account.state.customer.id, subscription: 'sub_A', client_reference_id: opB, metadata: { familyId: b.familyId, checkoutId: opB } }, { created: Math.floor((g.f.now() - 300_000) / 1000) });
  sg = signed(g.f, doneB); assert.equal((await g.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied', 'a refund never makes a completion stale');
  const famB = await family(g.f, b.familyId); assert.equal(famB.subscription.plan, 'family'); assert.equal(famB.subscription.providerSubscriptionRef, 'sub_A'); assert.equal(deriveState(famB.subscription, g.f.now()), 'active');
  // a family whose record the server itself ended (a full refund) while the provider still bills: the returning checkout ends it — the record is ahead, not behind
  const k = rig(), d = await k.f.family('parentD', 0); await subscribed(k, d, 'starter');
  k.account.state.invoiceOf = { in_1: { id: 'in_1', object: 'invoice', subscription: 'sub_1' } }; k.account.state.charge = { id: 'ch_1', object: 'charge', customer: k.account.state.customer.id, amount: 500, amount_refunded: 500, refunded: true, invoice: 'in_1' };
  sg = signed(k.f, event(k.f, 'refund.created', { object: 'refund', id: 're_1', charge: 'ch_1', amount: 500, status: 'succeeded' })); assert.equal((await k.payments.receive('stripe', sg.raw, sg.headers)).status, 'applied'); assert.ok((await family(k.f, d.familyId)).subscription.endedAt);
  k.f.advance(DAY); const d2 = await k.f.login('parentD'); assert.ok((await k.payments.checkout(d2.ctx, { plan: 'family', ...op() })).url); assert.equal(k.account.state.sub.status, 'canceled', 'ended for the new checkout, although the provider held it active');
});
test('the customer by its recorded id, pinned from every side: a lagging search still finds it for a plan change, a cancellation, the checkout guard, the deletion and the reconciliation; a misleading search never wins over the id; an id the provider never held falls back to the search', async () => {
  const r = rig(), { f, account, payments } = r, a = await f.family('parentA', 0); await subscribed(r, a, 'starter'); account.state.searchHidden = true; account.calls.length = 0;
  assert.equal((await payments.changePlan(a.ctx, { plan: 'family', operationId: randomUUID() })).entitlement.plan, 'family'); await payments.cancel(a.ctx, op()); assert.equal((await family(f, a.familyId)).subscription.cancelAtPeriodEnd, true);
  assert.ok(account.calls.some((c) => c.method === 'GET' && c.path === '/v1/customers/cus_live1')); assert.ok(account.calls.some((c) => c.method === 'POST' && c.path === '/v1/subscriptions/sub_1')); assert.ok(!account.calls.some((c) => c.path.startsWith('/v1/customers/search')), 'the search is never consulted while the id is recorded');
  // the checkout guard: a never-paid family's customer holds a subscription the dashboard made; the search lags
  const g = rig(), b = await g.f.family('parentB', 0); assert.ok((await g.payments.checkout(b.ctx, { plan: 'starter', ...op() })).url); g.account.activate(PRICES.starter); g.account.state.searchHidden = true;
  await assert.rejects(g.payments.checkout(b.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('PROVIDER_SUBSCRIPTION_LIVE')); assert.equal(sessions(g.account), 1); assert.equal(g.account.calls.filter((c) => c.method === 'POST' && c.path === '/v1/customers').length, 1, 'no second customer minted');
  for (const status of ['paused', 'incomplete']) { g.account.state.sub.status = status; await assert.rejects(g.payments.checkout(b.ctx, { plan: 'starter', operationId: randomUUID() }), rejected('PROVIDER_SUBSCRIPTION_LIVE'), `${status} can bill again`); } assert.equal(sessions(g.account), 1);
  // the deletion: the record's subscription only, found by the id
  const h = rig(), c = await h.f.family('parentC', 0); await subscribed(h, c, 'starter'); h.account.state.sub.id = 'sub_other'; h.f.advance(1000); const c2 = await h.f.login('parentC'); await h.support.requestDeletion(c2.ctx, op());
  const recC = await h.support.executeDeletion(c.familyId, { operator: OPERATOR, force: true }); assert.equal(recC.providerCancellation.status, 'failed'); assert.equal(recC.providerCancellation.reason, 'ANOTHER_SUBSCRIPTION_LIVE'); assert.equal(deletes(h.account), 0); assert.equal(h.account.state.sub.status, 'active');
  const k = rig(), d = await k.f.family('parentD', 0); await subscribed(k, d, 'starter'); k.account.state.searchHidden = true; k.f.advance(1000); const d2 = await k.f.login('parentD'); await k.support.requestDeletion(d2.ctx, op());
  const recD = await k.support.executeDeletion(d.familyId, { operator: OPERATOR, force: true }); assert.equal(recD.providerCancellation.status, 'cancelled'); assert.ok(k.account.state.deleted.some((p) => p.endsWith('/sub_1')));
  const dc = rig(), dd = await dc.f.family('parentDC', 0); await subscribed(dc, dd, 'starter'); dc.account.state.searchHidden = true; dc.account.state.deletedCustomers = ['cus_live1']; dc.f.advance(1000); const dd2 = await dc.f.login('parentDC'); await dc.support.requestDeletion(dd2.ctx, op());
  const recDC = await dc.support.executeDeletion(dd.familyId, { operator: OPERATOR, force: true }); assert.equal(recDC.providerCancellation.status, 'cancelled'); assert.equal(recDC.providerCancellation.reason, 'CUSTOMER_DELETED'); assert.equal(deletes(dc.account), 0);
  // the reconciliation clears the mark by the id
  const m = rig(), e = await m.f.family('parentE', 0); await subscribed(m, e, 'starter'); await m.f.store.transaction(async (tx) => { const fam = await tx.get(`families/${e.familyId}`); tx.set(`families/${e.familyId}`, { ...fam, providerAttention: { code: 'PROVIDER_SUBSCRIPTION_LIVE', at: m.f.now() } }); });
  m.account.state.searchHidden = true; m.account.calls.length = 0; const chk = await m.support.reconcileProvider(e.familyId, OPERATOR); assert.equal(chk.match, true); assert.equal(chk.attentionCleared, true); assert.equal(chk.providers[0].customer.id, 'cus_live1'); assert.ok(!m.account.calls.some((c) => c.path.startsWith('/v1/customers/search')));
  // a misleading search (the reference copied onto another customer in the dashboard) never wins over the recorded id — even for a record older than the subscription reference
  const n = rig(), p = await n.f.family('parentF', 0); await subscribed(n, p, 'starter'); n.account.state.sub.customer = 'cus_live1';
  n.account.state.extraSubs = [sub(PRICES.starter, n.f.now() + 30 * DAY, { id: 'sub_other', customer: 'cus_other' })]; n.account.state.searchAnswers = { id: 'cus_other', metadata: { customerRef: (await family(n.f, p.familyId)).billing.stripe } };
  await n.f.store.transaction(async (tx) => { const fam = await tx.get(`families/${p.familyId}`); tx.set(`families/${p.familyId}`, { ...fam, subscription: { ...fam.subscription, providerSubscriptionRef: null } }); });
  assert.equal((await n.payments.changePlan(p.ctx, { plan: 'family', operationId: randomUUID() })).entitlement.plan, 'family'); assert.equal(n.account.state.sub.items.data[0].price.id, PRICES.family, 'posted to the family\'s own subscription'); assert.equal(n.account.state.extraSubs[0].items.data[0].price.id, PRICES.starter, 'the other customer\'s untouched');
  // an id the provider never held: the search still finds the customer (the id first, then the search)
  const q = rig(), s2 = await pastDue(q, 'parentG'); await q.f.store.transaction(async (tx) => { const fam = await tx.get(`families/${s2.familyId}`); tx.set(`families/${s2.familyId}`, { ...fam, providerCustomer: { stripe: 'cus_never_held' } }); });
  assert.ok((await q.payments.checkout(s2.ctx, { plan: 'family', ...op() })).url); assert.equal(q.account.state.sub.status, 'canceled'); const paths = q.account.calls.map((c) => c.path); assert.ok(paths.indexOf('/v1/customers/cus_never_held') >= 0 && paths.indexOf('/v1/customers/cus_never_held') < paths.findIndex((x) => x.startsWith('/v1/customers/search')), 'the id first, then the search');
});
test('the deletion\'s expiries: a provider fault is recorded on the checkout and never fatal, and the sweep names the session left payable; a rerun after a crash before the record asks again, and a session no longer open is the settled state; a crash after the ending, before its record, resumes on the provider\'s own notice', async () => {
  const x = rig(), y = await x.f.family('parentX', 0), opR2 = randomUUID(), R2 = await x.payments.checkout(y.ctx, { plan: 'starter', operationId: opR2 }); assert.ok(R2.url);
  const realFetch = x.account.gw.fetch; x.account.gw.fetch = async (url, init) => { if (String(url).includes('/expire')) throw Error('ECONNRESET'); return realFetch(url, init); };
  await x.support.requestDeletion(y.ctx, op()); await x.support.executeDeletion(y.familyId, { operator: OPERATOR, force: true }); x.account.gw.fetch = realFetch;
  assert.deepEqual((await x.f.store.get(`checkouts/stripe:${opR2}`)).expiredByDeletion, { expired: false, reason: 'PROVIDER_UNREACHABLE', at: x.f.now() }); assert.equal((await family(x.f, y.familyId)).deleted, true, 'never fatal');
  assert.ok((await x.support.inspectAll({ operator: OPERATOR })).findings.some((fnd) => fnd.code === 'DELETED_FAMILY_PROVIDER_LIVE' && fnd.family === y.familyId && /could not be expired/.test(fnd.detail)), 'the sweep names the session left payable');
  const z = rig(), zz = await z.f.family('parentZ', 0), opR3 = randomUUID(), R3 = await z.payments.checkout(zz.ctx, { plan: 'starter', operationId: opR3 }); assert.ok(R3.url); z.account.state.strictExpire = true;
  await z.support.requestDeletion(zz.ctx, op()); const realTx3 = z.f.store.transaction.bind(z.f.store); let n3 = 0;
  z.f.store.transaction = (fn, opts) => { if (++n3 === 2) return Promise.reject(Error('crash')); return realTx3(fn, opts); }; // the freeze is the first transaction; the expiry's record the second
  await assert.rejects(z.support.executeDeletion(zz.familyId, { operator: OPERATOR, force: true }), /crash/); z.f.store.transaction = realTx3;
  assert.equal((await z.f.store.get(`checkouts/stripe:${opR3}`)).status, 'superseded_by_deletion'); assert.equal((await z.f.store.get(`checkouts/stripe:${opR3}`)).expiredByDeletion, undefined); assert.equal(z.account.state.expired.length, 1, 'expired at Stripe before the crash');
  await z.support.executeDeletion(zz.familyId, { operator: OPERATOR, force: true });
  assert.deepEqual((await z.f.store.get(`checkouts/stripe:${opR3}`)).expiredByDeletion, { expired: true, already: true, status: 'expired', at: z.f.now() }, 'the rerun asked again; the provider refused a session no longer open, which is the settled state'); assert.equal((await family(z.f, zz.familyId)).deleted, true);
  assert.ok(!(await z.support.inspectAll({ operator: OPERATOR })).findings.some((fnd) => fnd.family === zz.familyId), 'nothing left payable');
  // a crash after the DELETE landed, before its record; the provider's own notice of that ending arrives; the same click resumes — the ending it owed is what it finds
  const cr = rig(), ca = await pastDue(cr, 'parentCR'), opCR = randomUUID(), realTxC = cr.f.store.transaction.bind(cr.f.store), realCancelC = cr.account.gw.cancelSubscription.bind(cr.account.gw); let armedC = false;
  cr.account.gw.cancelSubscription = async (args) => { const r2 = await realCancelC(args); armedC = true; return r2; };
  cr.f.store.transaction = (fn, opts) => { if (armedC) { armedC = false; return Promise.reject(Error('ECONNRESET')); } return realTxC(fn, opts); };
  await assert.rejects(cr.payments.checkout(ca.ctx, { plan: 'family', operationId: opCR }), /ECONNRESET/); cr.f.store.transaction = realTxC; cr.account.gw.cancelSubscription = realCancelC;
  assert.equal(cr.account.state.sub.status, 'canceled'); assert.equal((await cr.f.store.get(`checkouts/stripe:${opCR}`)).endPrevious.status, 'pending');
  const gone = event(cr.f, 'customer.subscription.deleted', { object: 'subscription', id: 'sub_1', customer: cr.account.state.customer.id, metadata: { familyId: ca.familyId } });
  const sgC = signed(cr.f, gone); assert.equal((await cr.payments.receive('stripe', sgC.raw, sgC.headers)).status, 'applied'); assert.equal(deriveState((await family(cr.f, ca.familyId)).subscription, cr.f.now()), 'cancelled');
  assert.ok((await cr.payments.checkout(ca.ctx, { plan: 'family', operationId: opCR })).url, 'the same click resumes'); assert.equal(deletes(cr.account), 1, 'ended once: the resume found it ended'); assert.equal((await cr.f.store.get(`checkouts/stripe:${opCR}`)).endPrevious.result.already, true);
  // the deletion freeze landing inside a plan change's provider call: the frozen intent still carries the provider's answer
  const fr = rig(), fa = await fr.f.family('parentFR', 0); await subscribed(fr, fa, 'starter'); fr.f.advance(1000); const fa2 = await fr.f.login('parentFR'); await fr.support.requestDeletion(fa2.ctx, op());
  const opFR = randomUUID(), realChF = fr.account.gw.changePlan.bind(fr.account.gw);
  fr.account.gw.changePlan = async (args) => { const answer = await realChF(args); await fr.support.executeDeletion(fa.familyId, { operator: OPERATOR, force: true }); return answer; };
  await assert.rejects(fr.payments.changePlan(fa2.ctx, { plan: 'family', operationId: opFR }));
  const fi = await fr.f.store.get(`billingChangeIntents/stripe:${opFR}`); assert.equal(fi.status, 'frozen_by_deletion'); assert.ok(fi.providerAnsweredAt, 'money the provider moved is on the record that asked for it'); assert.equal(fi.proration.applied, true); assert.ok(fi.providerOperationRef);
});
