// The full-system review's Stage 3 exit blockers: deletion is quiesced before anything is destroyed,
// runs in bounded batches, resumes after a crash, and a late provider event can never revive a
// deleted family. Plus: operator reprocessing is attributable even across a crash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, webhookSecret, canonical } from './support.mjs';
import { signWebhook } from '../server/payments.mjs';
import { DELETION_BATCH } from '../server/support.mjs';

const DAY = 86_400_000;
const op = () => ({ operationId: randomUUID() });
const deliver = (f, event) => { const raw = Buffer.from(JSON.stringify(event)); return f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, f.now()) }); };
const evt = (f, customer, type, data = {}, more = {}) => ({ id: `evt_${randomUUID()}`, type, at: f.now(), customer, data, ...more });
async function paidFamily(f, plan = 'starter', kids = ['A']) {
  const a = await f.family('parentA', 0);
  const co = await f.payments.checkout(a.ctx, { plan, ...op() });
  assert.equal((await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId }))).status, 'applied');
  const children = []; for (const n of kids) children.push((await f.child(a.ctx, n)).child);
  return { a, co, ids: children.map((c) => c.id) };
}
async function play(f, a, childId) {
  const selCtx = await f.service.authenticate(await f.service.lock(a.ctx));
  const childCtx = await f.service.authenticate(await f.service.selectChild(selCtx, childId, '763829'));
  const started = await f.learning.start(childCtx, { track: 'nav' });
  const stored = await f.store.get(`families/${a.familyId}/learning/${childId}/sessions/${started.session.id}`);
  let q = started.question; while (q) { f.advance(2000); const r = await f.learning.answer(childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: canonical(stored.questions[q.index]) }); q = r.question || null; }
  return { childCtx, selCtx };
}
const parentAgain = async (f) => { f.advance(2000); return f.login('parentA'); };
// crash the store's n-th transaction from now, once
function crashAt(f, n) { const orig = f.store.transaction.bind(f.store); let k = 0; f.store.transaction = (fn, o) => { k++; if (k === n) { f.store.transaction = orig; return Promise.reject(Error('crash')); } return orig(fn, o); }; return () => { f.store.transaction = orig; }; }

test('Blocker 1: deletion begins by freezing the family — nobody gets in, live checkouts and open intents are frozen — and resumes cleanly after a crash', async () => {
  const f = fixture(); const { a, co, ids: [A, B] } = await paidFamily(f, 'family', ['A', 'B']);
  const { childCtx } = await play(f, a, A);
  let p = await parentAgain(f);
  const real = f.gateway.changePlan.bind(f.gateway); f.gateway.changePlan = async () => { throw Error('provider down'); };
  const idUp = randomUUID(); await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', operationId: idUp }), /provider down/); f.gateway.changePlan = real; // an open intent
  await f.support.requestDeletion(p.ctx, op());
  // crash right after the terminate (the freeze is transaction 1, terminate is 2, the first session sweep is 3)
  crashAt(f, 3);
  await assert.rejects(f.support.executeDeletion(a.familyId, { operator: 'ops@example.test', force: true }), /crash/);
  const mid = await f.store.get(`families/${a.familyId}`);
  assert.equal(mid.deleted, undefined); assert.equal(mid.deletion.status, 'executing'); assert.equal(mid.deletion.executedBy, 'ops@example.test'); assert.ok(mid.deletion.executionId);
  assert.equal(mid.subscription.state, 'cancelled', 'the subscription ended as a recorded event first');
  assert.equal((await f.store.get(`billingChangeIntents/fake:${idUp}`)).status, 'frozen_by_deletion'); assert.equal(mid.billingIntent, null);
  // the family is frozen: no Stage 1 or Stage 2 write can land between the sweeps
  await assert.rejects(f.service.me(p.ctx), rejected('FAMILY_DELETED'));
  await assert.rejects(f.learning.start(childCtx, { track: 'engine' }), rejected('FAMILY_DELETED'));
  await assert.rejects(f.game.equip(childCtx, { kind: 'pet', itemId: null }), rejected('FAMILY_DELETED'));
  await assert.rejects(f.child(p.ctx, 'C'), rejected('FAMILY_DELETED'));
  await assert.rejects(f.payments.changePlan(p.ctx, { plan: 'big', operationId: idUp }), rejected('FAMILY_DELETED'));
  f.advance(2000); const before = (await f.store.query('sessions', 'uid', 'parentA', 50)).length;
  await assert.rejects(f.login('parentA'), rejected('FAMILY_DELETED'), 'a fresh sign-in is refused before a session exists');
  assert.equal((await f.store.query('sessions', 'uid', 'parentA', 50)).length, before, 'no new session document was written');
  assert.equal((await f.store.get(`families/${a.familyId}/learning/${A}`)) !== null, true, 'nothing destroyed yet');
  // rerun: the job resumes from the recorded phase and finishes
  const record = await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  assert.equal(record.executionId, mid.deletion.executionId, 'the same execution, resumed'); assert.equal(record.counts.children, 2); assert.ok(record.counts.ledgerRows >= 1); assert.ok(record.counts.sessions >= 1); assert.ok(record.counts.loginSessions >= 1);
  const tomb = await f.store.get(`families/${a.familyId}`); assert.equal(tomb.deleted, true); assert.equal(tomb.deletion.status, 'done');
  assert.equal(await f.store.get(`families/${a.familyId}/learning/${A}`), null); assert.equal(await f.store.get(`families/${a.familyId}/children/${B}`), null);
  assert.equal((await f.store.query('sessions', 'familyId', a.familyId, 10)).length, 0, 'no login session survives');
  assert.deepEqual(await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' }), record, 'idempotent afterwards');
  const audits = (await f.store.list('audit')).filter((x) => x.familyId === a.familyId).map((x) => x.action);
  assert.ok(audits.includes('family.deletion_started') && audits.includes('family.deleted'));
  void co;
});
test('Blocker 1: a crash in the middle of a child sweep is resumed with the accumulated counts, and a live checkout is superseded by the deletion', async () => {
  const f = fixture(); const a = await f.family('parentA', 0); await f.billing.startTrial(a.ctx, op());
  const [A, B] = [(await f.child(a.ctx, 'A')).child.id, (await f.child(a.ctx, 'B')).child.id];
  await play(f, a, A); let p = await parentAgain(f); await play(f, { ctx: p.ctx, familyId: a.familyId }, B); p = await parentAgain(f);
  const co = await f.payments.checkout(p.ctx, { plan: 'starter', ...op() }); // a live, unpaid checkout
  await f.support.requestDeletion(p.ctx, op());
  // let the first child's sweeps run, then crash on the second child's first sweep
  const orig = f.store.transaction.bind(f.store); let k = 0; const seen = [];
  f.store.transaction = async (fn, o) => { k++; seen.push(k); return orig(fn, o); };
  await assert.rejects((async () => { crashAt(f, 9); return f.support.executeDeletion(a.familyId, { operator: 'ops@example.test', force: true }); })(), /crash/);
  f.store.transaction = orig;
  const mid = await f.store.get(`families/${a.familyId}`); assert.equal(mid.deletion.status, 'executing'); assert.ok(mid.deletion.phase.startsWith('child:') || mid.deletion.phase === 'sessions', mid.deletion.phase);
  assert.equal((await f.store.get(`checkouts/fake:${co.checkoutId}`)).status, 'superseded_by_deletion'); assert.equal(mid.checkoutIntent, null);
  const record = await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  assert.equal(record.counts.sessions, 2, 'both children\'s sessions are counted although two runs did the work'); assert.equal(record.counts.ledgerRows, 2); assert.equal(record.counts.children, 2);
  // the frozen checkout can never complete the family
  assert.deepEqual(await deliver(f, evt(f, co.customerRef, 'checkout.completed', { price: 'price_fake_starter', periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId })), { status: 'rejected', reason: 'CHECKOUT_SUPERSEDED' });
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.state, 'cancelled');
});
test('Blocker 2: a child with more than 500 records is deleted in bounded batches — the store refuses a transaction that tries more', async () => {
  const f = fixture(); const { a, ids: [A] } = await paidFamily(f, 'starter', ['A']);
  const base = `families/${a.familyId}/learning/${A}`;
  await f.store.transaction(async (tx) => { for (let i = 0; i < 400; i++) tx.set(`${base}/ledger/row-${i}`, { id: `row-${i}`, seq: i + 1, gc: 1, rp: 0, type: 'parent.adjust', at: f.now(), balance: { gc: i + 1, rp: 0 } }); });
  await f.store.transaction(async (tx) => { for (let i = 400; i < 620; i++) tx.set(`${base}/ledger/row-${i}`, { id: `row-${i}`, seq: i + 1, gc: 1, rp: 0, type: 'parent.adjust', at: f.now(), balance: { gc: i + 1, rp: 0 } }); });
  await f.store.transaction(async (tx) => { for (let i = 0; i < 340; i++) tx.set(`${base}/sessions/s-${i}`, { id: `s-${i}`, status: 'expired', createdAt: f.now() }); });
  await assert.rejects(f.store.transaction(async (tx) => { for (let i = 0; i < 501; i++) tx.set(`${base}/operations/o-${i}`, { at: f.now() }); }), /500 writes/, 'the in-memory store enforces the Firestore limit');
  const p = await parentAgain(f); await f.support.requestDeletion(p.ctx, op());
  const orig = f.store.transaction.bind(f.store); let deletesPerTx = []; f.store.transaction = (fn, o) => orig(async (tx) => { let n = 0; const r = await fn({ ...tx, delete: (path) => { n++; tx.delete(path); } }); deletesPerTx.push(n); return r; }, o);
  const record = await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test', force: true });
  f.store.transaction = orig;
  assert.equal(record.counts.ledgerRows, 620); assert.equal(record.counts.sessions, 340);
  assert.ok(Math.max(...deletesPerTx) <= DELETION_BATCH, `largest sweep ${Math.max(...deletesPerTx)} ≤ ${DELETION_BATCH}`); assert.ok(deletesPerTx.filter((n) => n > 0).length >= 5, 'several bounded sweeps');
  assert.equal((await f.store.list(`${base}/ledger`)).length, 0); assert.equal((await f.store.list(`${base}/sessions`)).length, 0);
});
test('Blocker 3: after deletion a valid signed provider event is recorded but never revives the family; waiting events resolve to reconciliation', async () => {
  const f = fixture(); const { a, co, ids: [A] } = await paidFamily(f, 'family', ['A']);
  const waiting = evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY }); assert.equal((await deliver(f, waiting)).status, 'requires_action');
  const p = await parentAgain(f); await f.support.requestDeletion(p.ctx, op());
  await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test', force: true });
  const tomb = await f.store.get(`families/${a.familyId}`); assert.equal(tomb.deleted, true); assert.equal(tomb.subscription.state, 'cancelled'); const version = tomb.subscription.version;
  // a renewal on the plan on record, which would ordinarily re-activate a cancelled family
  const late = evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_family', periodEnd: f.now() + 60 * DAY });
  assert.deepEqual(await deliver(f, late), { status: 'reconciliation_required', reason: 'FAMILY_DELETED' });
  const after = await f.store.get(`families/${a.familyId}`); assert.equal(after.subscription.state, 'cancelled'); assert.equal(after.subscription.version, version, 'nothing moved'); assert.equal(after.deleted, true);
  assert.equal((await f.store.get(`billingEvents/fake:${late.id}`)).outcome.reason, 'FAMILY_DELETED', 'the event is kept as evidence');
  assert.deepEqual(await deliver(f, late), { status: 'reconciliation_required', reason: 'FAMILY_DELETED', replayed: true });
  // the event that was waiting on the family's choice is now a reconciliation matter too, and stops waiting
  assert.deepEqual((await f.support.reprocess(a.familyId, 'ops@example.test')).map((r) => r.status), ['reconciliation_required']);
  assert.deepEqual((await f.store.get(`billingCustomers/fake:${co.customerRef}`)).pending, []);
  const report = await f.support.familyReport(a.familyId); assert.equal(report.attention.reconciliationRequired, 2); assert.equal(report.attention.requiresAction, 0);
  assert.equal((await f.support.inbox('reconciliation_required')).length, 2);
  // a new checkout cannot be opened for a deleted family either, and a fresh family's checkout is its own
  f.advance(2000); const back = await f.login('parentA'); assert.equal((await f.service.me(back.ctx)).family, null);
  void A;
});
test('operator reprocessing is attributable even if it crashes half-way: the operation row names the operator before anything moves', async () => {
  const f = fixture(); const { a, co } = await paidFamily(f, 'family', ['A']);
  assert.equal((await deliver(f, evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_starter', periodEnd: f.now() + 60 * DAY }))).status, 'requires_action');
  const real = f.payments.reprocess.bind(f.payments); f.payments.reprocess = async () => { throw Error('crash'); };
  await assert.rejects(f.support.reprocess(a.familyId, 'ops@example.test'), /crash/);
  f.payments.reprocess = real;
  const rows = await f.store.list('supportOperations'); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'running'); assert.equal(rows[0].operator, 'ops@example.test'); assert.equal(rows[0].familyId, a.familyId);
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'support.reprocess_started' && x.uid === 'ops@example.test'));
  await f.support.reprocess(a.familyId, 'ops@example.test');
  const done = (await f.store.list('supportOperations')).find((r) => r.status === 'done'); assert.ok(done); assert.equal(done.results.length, 1); assert.equal(done.results[0].status, 'requires_action');
});
test('Exit follow-up: the freeze is the first thing that moves — a crash before it changes nothing, a crash after it leaves a frozen family that no payment, sign-in or child can touch', async () => {
  const f = fixture(); const { a, co, ids: [A] } = await paidFamily(f, 'family', ['A']);
  const { childCtx } = await play(f, a, A);
  let p = await parentAgain(f); await f.support.requestDeletion(p.ctx, op());
  const version = (await f.store.get(`families/${a.familyId}`)).subscription.version;
  // 1. a crash before the freeze commits: the subscription is untouched and the request is still just a request
  crashAt(f, 1);
  await assert.rejects(f.support.executeDeletion(a.familyId, { operator: 'ops@example.test', force: true }), /crash/);
  let fam = await f.store.get(`families/${a.familyId}`);
  assert.equal(fam.subscription.state, 'active'); assert.equal(fam.subscription.version, version, 'no terminate ran ahead of the freeze'); assert.equal(fam.deletion.status, undefined); assert.equal(fam.deleted, undefined);
  assert.equal((await f.service.me(p.ctx)).role, 'parent', 'the family is still usable: nothing happened');
  assert.equal((await f.support.cancelDeletion(p.ctx, op())).pending, false, 'and the parent can still change their mind, with their subscription intact');
  await f.support.requestDeletion(p.ctx, op());
  // 2. a crash right after the freeze, before the terminate: frozen, subscription still on record, nothing can move it
  crashAt(f, 2);
  await assert.rejects(f.support.executeDeletion(a.familyId, { operator: 'ops@example.test', force: true }), /crash/);
  fam = await f.store.get(`families/${a.familyId}`);
  assert.equal(fam.deletion.status, 'executing'); assert.equal(fam.subscription.state, 'active', 'the terminate has not run yet');
  // a signed renewal in this gap is recorded and never applied: no reactivation, no new period
  const renewal = evt(f, co.customerRef, 'invoice.paid', { price: 'price_fake_family', periodEnd: f.now() + 60 * DAY });
  assert.deepEqual(await deliver(f, renewal), { status: 'reconciliation_required', reason: 'FAMILY_DELETED' });
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.version, version);
  // a fresh sign-in in this gap is refused before any session is written
  f.advance(2000); const sessionsBefore = (await f.store.query('sessions', 'uid', 'parentA', 50)).length;
  await assert.rejects(f.login('parentA'), rejected('FAMILY_DELETED'));
  assert.equal((await f.store.query('sessions', 'uid', 'parentA', 50)).length, sessionsBefore);
  // the live sessions are walls too, and a fresh checkout cannot be opened
  await assert.rejects(f.service.me(p.ctx), rejected('FAMILY_DELETED')); await assert.rejects(f.learning.start(childCtx, { track: 'engine' }), rejected('FAMILY_DELETED'));
  await assert.rejects(f.payments.checkout(p.ctx, { plan: 'starter', ...op() }), rejected('FAMILY_DELETED'));
  // 3. the operator retries: the subscription ends as a recorded event and the tombstone is clean
  const record = await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  const tomb = await f.store.get(`families/${a.familyId}`);
  assert.equal(tomb.deleted, true); assert.equal(tomb.subscription.state, 'cancelled'); assert.ok(tomb.subscription.version > version);
  assert.ok((await f.store.list(`families/${a.familyId}/billing`)).some((e) => e.type === 'terminate'), 'the terminate is on the financial record');
  assert.equal(record.executionId, fam.deletion.executionId);
  // 4. zero sessions of the family or its parent survive
  assert.equal((await f.store.query('sessions', 'familyId', a.familyId, 50)).length, 0);
  assert.equal((await f.store.query('sessions', 'uid', 'parentA', 50)).length, 0);
  // and the returning parent signs in to no family, as designed
  f.advance(2000); const back = await f.login('parentA'); assert.equal((await f.service.me(back.ctx)).family, null);
});
