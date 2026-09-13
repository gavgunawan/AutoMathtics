// Stage 3.5 — recovery, export, deletion and the support tooling: a parent can keep their data and
// leave; an operator can see every problem and correct it under their own name; nothing moves
// between accounts; the financial records outlive the family.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, rejected, webhookSecret, canonical } from './support.mjs';
import { signWebhook, INTENT_INFLIGHT_MS } from '../server/payments.mjs';
import { Support, DELETION_GRACE_MS, RETENTION } from '../server/support.mjs';

const DAY = 86_400_000;
const op = () => ({ operationId: randomUUID() });
const deliver = (f, event) => { const raw = Buffer.from(JSON.stringify(event)); return f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, f.now()) }); };
const evt = (f, customer, type, data = {}, more = {}) => ({ id: `evt_${randomUUID()}`, type, at: f.now(), customer, data, ...more });
async function paidFamily(f, plan = 'family', kids = ['A', 'B']) {
  const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan, ...op() });
  assert.equal((await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }))).status, 'applied');
  const children = []; for (const n of kids) children.push((await f.child(a.ctx, n)).child);
  return { a, co, children, ids: children.map((c) => c.id) };
}
async function play(f, a, childId) { // a child earns real progress: a session, a ledger row
  const selCtx = await f.service.authenticate(await f.service.lock(a.ctx));
  const childCtx = await f.service.authenticate(await f.service.selectChild(selCtx, childId, '763829'));
  const started = await f.learning.start(childCtx, { track: 'nav' });
  const stored = await f.store.get(`families/${a.familyId}/learning/${childId}/sessions/${started.session.id}`);
  let q = started.question; while (q) { f.advance(2000); const r = await f.learning.answer(childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: canonical(stored.questions[q.index]) }); q = r.question || null; }
  return childCtx;
}
const parentAgain = async (f) => { f.advance(2000); return f.login('parentA'); };

test('the family report puts the problems first: waiting events, open intents and checkouts, ledger status, deletion', async () => {
  const f = fixture(); const { a, co, ids: [A, B] } = await paidFamily(f);
  await play(f, a, A);
  const p = await parentAgain(f);
  // a waiting renewal, an in-flight upgrade abandoned at the provider, a superseded checkout, a drifted ledger
  const waiting = await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY })); assert.equal(waiting.status, 'requires_action');
  const real = f.gateway.changePlan.bind(f.gateway); f.gateway.changePlan = async () => { throw Error('provider down'); };
  const idUp = randomUUID(); await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', operationId: idUp }), /provider down/); f.gateway.changePlan = real;
  const prog = await f.store.get(`families/${a.familyId}/learning/${A}`); await f.store.put(`families/${a.familyId}/learning/${A}`, { ...prog, wallet: { ...prog.wallet, gc: prog.wallet.gc + 5 } });
  const r = await f.support.familyReport(a.familyId);
  assert.equal(r.label, 'Test family'); assert.equal(r.subscription.state, 'active'); assert.equal(r.entitlement.seatLimit, 4);
  assert.equal(r.attention.requiresAction, 1); assert.deepEqual(r.attention.openIntents, [idUp]); assert.equal(r.attention.inFlight.operationId, idUp);
  assert.deepEqual(r.attention.ledgerDrift, [A]); assert.deepEqual(r.attention.ledgerDamaged, []); assert.equal(r.attention.deletion, null);
  assert.equal(r.children.length, 2); assert.equal(r.children.find((c) => c.id === B).ledger.match, true); assert.equal(r.children.find((c) => c.id === A).ledger.match, false);
  assert.equal(r.customers[0].ref, co.customerRef); assert.deepEqual(r.customers[0].mapping.pending, [r.inbox.find((e) => e.outcome.status === 'requires_action').id]);
  assert.equal(r.checkouts.length, 1); assert.equal(r.checkouts[0].status, 'completed'); assert.ok(r.audit.some((x) => x.action === 'billing.checkout.completed' || x.action === 'billing.payment.succeeded'));
  assert.ok(r.billing.length >= 1); assert.equal(typeof r.phoneKey, 'string');
  assert.deepEqual(await f.support.customerLookup('fake', co.customerRef), { provider: 'fake', ref: co.customerRef, familyId: a.familyId, lastEventAt: r.customers[0].mapping.lastEventAt, lastEventId: r.customers[0].mapping.lastEventId, pending: r.customers[0].mapping.pending });
  await assert.rejects(f.support.customerLookup('fake', 'cus_nobody'), rejected('UNKNOWN_CUSTOMER'));
  assert.equal((await f.support.inbox('requires_action')).length, 1); assert.equal((await f.support.inbox('all')).length, 2); assert.equal((await f.support.inbox('rejected')).length, 0);
  await assert.rejects(f.support.familyReport(randomUUID()), rejected('FAMILY_NOT_FOUND'));
});
test('operator corrections are audited under an explicit identity: reprocessing, and reconciling an intent the server could not finalise', async () => {
  const f = fixture(); const { a, co, ids: [A] } = await paidFamily(f);
  const waiting = evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY }); assert.equal((await deliver(f, waiting)).status, 'requires_action');
  await assert.rejects(f.support.reprocess(a.familyId, ''), rejected('OPERATOR_REQUIRED'));
  assert.deepEqual((await f.support.reprocess(a.familyId, 'ops@example.test')).map((x) => x.status), ['requires_action'], 'nothing to resolve it yet: still waiting');
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'plan.schedule', plan: 'starter', seatChildIds: [A] }, 'ops@example.test'); // the operator records the family's choice
  const after = await f.support.reprocess(a.familyId, 'ops@example.test'); assert.deepEqual(after.map((x) => x.status), ['applied']);
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.seats, 2);
  const audits = (await f.store.list('audit')).filter((x) => x.action === 'support.reprocess'); assert.equal(audits.length, 2); assert.equal(audits[0].uid, 'ops@example.test'); assert.equal(audits[0].familyId, a.familyId);
  // an upgrade abandoned at the provider: reconcile it with what was established there
  const p = await parentAgain(f); const real = f.gateway.changePlan.bind(f.gateway); f.gateway.changePlan = async () => { throw Error('provider down'); };
  const id = randomUUID(); await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', operationId: id }), /provider down/); f.gateway.changePlan = real;
  await assert.rejects(f.support.reconcileIntent('fake', id, { operator: 'ops@example.test', outcome: 'made_up', note: 'x' }), rejected('INVALID_REQUEST'));
  await assert.rejects(f.support.reconcileIntent('fake', randomUUID(), { operator: 'ops@example.test', outcome: 'no_provider_change', note: 'x' }), rejected('INTENT_NOT_FOUND'));
  const rec = await f.support.reconcileIntent('fake', id, { operator: 'ops@example.test', outcome: 'no_provider_change', note: 'provider dashboard shows no change for fake_op; nothing to undo' });
  assert.equal(rec.previousStatus, 'creating'); assert.equal(rec.operator, 'ops@example.test'); assert.equal((await f.store.get(`billingReconciliations/${rec.id}`)).familyId, a.familyId);
  assert.equal((await f.store.get(`billingChangeIntents/fake:${id}`)).status, 'reconciled');
  await assert.rejects(f.support.reconcileIntent('fake', id, { operator: 'ops@example.test', outcome: 'refunded', note: 'again' }), rejected('INTENT_NOT_OPEN'), 'reconciled once');
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', operationId: id }), rejected('SUBSCRIPTION_CHANGED'), 'a reconciled intent can never finalise');
  const report = await f.support.familyReport(a.familyId); assert.equal(report.reconciliations.length, 1); assert.deepEqual(report.attention.openIntents, []);
  // an applied intent is not open to reconciliation
  f.advance(INTENT_INFLIGHT_MS + 1000); const p2 = await parentAgain(f); const ok = randomUUID(); await f.payments.changePlan(p2.ctx, { plan: 'big', operationId: ok });
  await assert.rejects(f.support.reconcileIntent('fake', ok, { operator: 'ops@example.test', outcome: 'refunded', note: 'x' }), rejected('INTENT_NOT_OPEN'));
});
test('a parent can export the family: everything the family is, none of the secrets, and only their own family', async () => {
  const f = fixture(); const { a, co, ids: [A, B] } = await paidFamily(f);
  const childCtx = await play(f, a, A);
  await assert.rejects(f.support.exportFamily(childCtx), rejected('PARENT_REQUIRED'));
  const p = await parentAgain(f); const x = await f.support.exportFamily(p.ctx);
  assert.equal(x.family.id, a.familyId); assert.equal(x.family.label, 'Test family'); assert.equal(x.entitlement.plan, 'family'); assert.equal(x.subscription.state, 'active');
  assert.equal(x.children.length, 2); const ca = x.children.find((c) => c.id === A);
  assert.equal(ca.nickname, 'A'); assert.ok(ca.progress.nav.paper > 1); assert.ok(ca.ledger.length >= 1); assert.equal(ca.ledger[0].seq, 1); assert.equal(ca.progress.wallet.rp, 100);
  assert.equal(x.children.find((c) => c.id === B).ledger.length, 0);
  assert.ok(x.billing.some((e) => e.type === 'payment.succeeded')); assert.ok(x.audit.some((e) => e.action === 'child.created')); assert.equal(x.exportedBy, 'parentA');
  const text = JSON.stringify(x);
  for (const secret of ['scrypt', 'hash', 'csrf', 'phoneKey', 'sessions/', 'fingerprint', 'expireAt', 'reauthAfter', 'pinAttempts']) assert.ok(!text.includes(secret), `export leaks ${secret}`);
  assert.ok(!text.includes(co.customerRef.slice(4)) || true, 'the family\'s own provider reference may appear');
  // another family's export contains none of this family
  const g = await f.family('parentB', 0); const y = await f.support.exportFamily(g.ctx); assert.equal(y.children.length, 0); assert.ok(!JSON.stringify(y).includes(a.familyId));
  f.advance(6 * 60_000); await assert.rejects(f.support.exportFamily(p.ctx), rejected('REAUTHENTICATE'), 'a recent sign-in is required to download everything');
});
test('deletion: 14 days to change your mind; then the people and the game go, the money records stay, and a returning parent starts fresh with no second trial', async () => {
  const f = fixture(); const a = await f.family('parentA', 0); await f.billing.startTrial(a.ctx, op()); // the trial is used, then the family pays
  const co = await f.payments.checkout(a.ctx, { plan: 'family', ...op() });
  assert.equal((await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_family', periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }))).status, 'applied');
  const [A, B] = [(await f.child(a.ctx, 'A')).child.id, (await f.child(a.ctx, 'B')).child.id];
  const childCtx = await play(f, a, A); const key = (await f.store.get(`families/${a.familyId}`)).phoneKey;
  const p = await parentAgain(f);
  await assert.rejects(f.support.requestDeletion(p.ctx, {}), rejected('OPERATION_ID_REQUIRED'));
  const id = randomUUID(); const req = await f.support.requestDeletion(p.ctx, { operationId: id });
  assert.equal(req.effectiveAt, f.now() + DELETION_GRACE_MS); assert.equal(req.pending, true);
  assert.deepEqual(await f.support.requestDeletion(p.ctx, { operationId: randomUUID() }), req, 'asking twice is the same request');
  assert.equal((await f.service.me(p.ctx)).family.deletion.effectiveAt, req.effectiveAt);
  assert.equal((await f.service.me(childCtx)).role, 'child', 'nothing changes during the 14 days');
  await assert.rejects(f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' }), rejected('DELETION_NOT_DUE'));
  assert.equal((await f.support.cancelDeletion(p.ctx, op())).pending, false); assert.equal((await f.service.me(p.ctx)).family.deletion, null);
  await assert.rejects(f.support.cancelDeletion(p.ctx, op()), rejected('NO_DELETION_PENDING'));
  await assert.rejects(f.support.executeDeletion(a.familyId, { operator: 'ops@example.test', force: true }), rejected('NO_DELETION_PENDING'));
  await f.support.requestDeletion(p.ctx, op());
  f.advance(DELETION_GRACE_MS + 1);
  const before = { billing: (await f.store.list(`families/${a.familyId}/billing`)).length, inbox: (await f.store.list('billingEvents')).length, ledger: (await f.store.list(`families/${a.familyId}/learning/${A}/ledger`)).length };
  assert.ok(before.ledger >= 1);
  await assert.rejects(f.support.executeDeletion(a.familyId, { operator: '' }), rejected('OPERATOR_REQUIRED'));
  const record = await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  assert.equal(record.counts.children, 2); assert.ok(record.counts.ledgerRows >= 1); assert.ok(record.counts.sessions >= 1); assert.ok(record.counts.loginSessions >= 1); assert.equal(record.forced, false);
  assert.deepEqual(record.retained, RETENTION);
  // gone: children, credentials, progress, sessions, ledger rows, game config, members, login sessions, the label
  for (const path of [`families/${a.familyId}/children/${A}`, `families/${a.familyId}/children/${B}`, `families/${a.familyId}/credentials/${A}`, `families/${a.familyId}/learning/${A}`, `families/${a.familyId}/members/parentA`]) assert.equal(await f.store.get(path), null, path);
  assert.equal((await f.store.list(`families/${a.familyId}/learning/${A}/ledger`)).length, 0); assert.equal((await f.store.list(`families/${a.familyId}/learning/${A}/sessions`)).length, 0);
  const tomb = await f.store.get(`families/${a.familyId}`); assert.equal(tomb.deleted, true); assert.equal(tomb.label, undefined); assert.deepEqual(tomb.childIds, []); assert.equal(tomb.billing.fake, co.customerRef); assert.equal(tomb.subscription.state, 'cancelled', 'the subscription was ended as a recorded event');
  // kept: the financial records, the phone ledger, the customer mapping
  assert.equal((await f.store.list(`families/${a.familyId}/billing`)).length, before.billing + 1, 'the terminate event was added, nothing removed');
  assert.equal((await f.store.list('billingEvents')).length, before.inbox); assert.equal((await f.store.get(`billingCustomers/fake:${co.customerRef}`)).familyId, a.familyId);
  assert.equal((await f.store.get(`phones/${key}`)).families[0], a.familyId);
  assert.equal((await f.store.get(`deletions/${a.familyId}`)).executedBy, 'ops@example.test');
  // nobody gets in: the old cookies are gone, and the tombstone admits no session
  await assert.rejects(f.service.me(childCtx), rejected('SIGN_IN_REQUIRED')); await assert.rejects(f.service.me(p.ctx), rejected('SIGN_IN_REQUIRED'));
  assert.deepEqual(await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' }), record, 'running it again changes nothing');
  const report = await f.support.familyReport(a.familyId); assert.equal(report.deleted, true); assert.equal(report.label, null);
  // the parent comes back: a fresh family, no children, and the trial is still used up
  f.advance(2000); const again = await f.login('parentA'); assert.equal((await f.service.me(again.ctx)).family, null); // an ID token minted before the deletion is refused: reauthAfter moved
  const fresh = await f.service.createFamily(again.ctx, { label: 'Second life', adultAttestation: true, consentVersion: 'terms-2026-09-13' });
  const ctx2 = await f.service.authenticate(fresh.token); assert.notEqual(fresh.id, a.familyId);
  await assert.rejects(f.billing.startTrial(ctx2, op()), rejected('TRIAL_ALREADY_USED'));
  assert.equal((await f.service.me(ctx2)).family.children.length, 0);
});
test('no browser route writes arbitrary state, deletion needs the parent\'s own recent session, and nothing in support rebinds a family', async () => {
  const f = fixture(); const { a } = await paidFamily(f, 'family', ['A']);
  const k = await f.childSession('parentB'); await assert.rejects(f.support.requestDeletion(k.childCtx, op()), rejected('PARENT_REQUIRED'));
  const p = await f.login('parentA'); f.advance(6 * 60_000); // a session older than the recent-auth window
  await assert.rejects(f.support.requestDeletion(p.ctx, op()), rejected('REAUTHENTICATE'));
  await assert.rejects(f.support.exportFamily(p.ctx), rejected('REAUTHENTICATE'));
  const src = await readFile(new URL('../server/support.mjs', import.meta.url), 'utf8');
  assert.ok(!/members\/\$\{[^}]+\}`, \{/.test(src), 'support never writes a membership');
  assert.ok(!/familyId: (?!null)/.test(src.replace(/familyId: (intent|s|current|a|e|i|c|r|mapping)\./g, '')), 'support never points a parent at another family');
  for (const name of Object.getOwnPropertyNames(Support.prototype)) assert.doesNotMatch(name, /transfer|move|merge|rebind|import|assign/i, name);
  const http = await readFile(new URL('../server/http.mjs', import.meta.url), 'utf8');
  assert.ok(!/api\/(admin|support|operator)/.test(http), 'operator tooling is the CLI, not a route');
  void a;
});
test('a superseded checkout never redisplays its hosted session', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  const first = await f.payments.checkout(a.ctx, { plan: 'starter', ...op() });
  await f.payments.checkout(a.ctx, { plan: 'family', ...op() });
  const replay = await f.payments.checkout(a.ctx, { plan: 'starter', operationId: first.checkoutId });
  assert.equal(replay.superseded, true); assert.equal(replay.url, null); assert.equal(replay.checkoutId, first.checkoutId);
});
