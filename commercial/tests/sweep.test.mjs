// The routine invariant sweep (RECONCILIATION.md → Routine sweep): a healthy database has no findings; every
// kind of damage the code guards against at access time is named when it is planted directly in the store;
// the walk is paged; the record and the audit row exist; the CLI exposes it; disputes and refund failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { Payments } from '../server/payments.mjs';
import { Support } from '../server/support.mjs';
import { PRICES, DAY, op, event, signed, stripeAccount } from './stripe-support.mjs';

const OPERATOR = 'ops@example.test';
const codes = (r) => r.findings.map((x) => x.code).sort();
const put = (f, path, patch) => f.store.transaction(async (tx) => { const d = await tx.get(path); tx.set(path, { ...(d || {}), ...patch }); });

test('a healthy database has no findings; the counts describe it; the record and the audit row exist', async () => {
  const f = fixture(); const a = await f.family('parentA', 2); await f.child(a.ctx); await f.child(a.ctx);
  const b = await f.family('parentB', 0); await f.payments.checkout(b.ctx, { plan: 'starter', ...op() });
  const r = await f.support.inspectAll({ operator: OPERATOR });
  assert.equal(r.kind, 'sweep'); assert.deepEqual(r.findings, []); assert.equal(r.truncated, false);
  assert.equal(r.counts.families, 2); assert.equal(r.counts.tombstones, 0); assert.equal(r.counts.children, 2); assert.equal(r.counts.activeChildren, 2); assert.equal(r.counts.parents, 2);
  assert.equal(r.counts.customerLinks, 1); assert.equal(r.counts.customerMappings, 1); assert.equal(r.counts.liveCheckouts, 1); assert.equal(r.counts.findings, 0);
  assert.ok(r.expireAt > r.finishedAt); assert.equal((await f.store.get(`sweeps/${r.id}`)).operator, OPERATOR);
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'support.sweep' && x.uid === OPERATOR && x.families === 2));
  await assert.rejects(f.support.inspectAll({ operator: '' }), rejected('OPERATOR_REQUIRED'));
  // the walk is paged: the same answer with pages of one
  const paged = await f.support.inspectAll({ operator: OPERATOR, batch: 1 }); assert.equal(paged.counts.families, 2); assert.deepEqual(paged.findings, []);
  assert.deepEqual((await f.store.entriesAfter('families', null, 1)).length, 1); assert.deepEqual(await f.store.entriesAfter('families', 'zzzz', 5), []);
});
test('every kind of damage is named: seats, children, members and parents, provider links, subscription facts, open work, deletions, recoveries, tombstones', async () => {
  const f = fixture(); const a = await f.family('parentA', 2); const c1 = await f.child(a.ctx); const c2 = await f.child(a.ctx);
  const fam = await f.store.get(`families/${a.familyId}`);
  // seats and children
  await put(f, `families/${a.familyId}`, { activeChildIds: [...fam.activeChildIds, 'ghost-child', c1.child.id] });
  await put(f, `families/${a.familyId}/children/${c2.child.id}`, { status: 'inactive' });
  let r = await f.support.inspectAll({ operator: OPERATOR });
  assert.deepEqual(codes(r), ['ACTIVE_NOT_A_CHILD', 'DUPLICATE_SEAT', 'SEATED_CHILD_INACTIVE', 'SEAT_OVERFLOW']);
  assert.equal((await f.support.familyReport(a.familyId)).attention.seatOverflow, true);
  await put(f, `families/${a.familyId}`, { activeChildIds: fam.activeChildIds }); await put(f, `families/${a.familyId}/children/${c2.child.id}`, { status: 'active' });
  assert.deepEqual(codes(await f.support.inspectAll({ operator: OPERATOR })), [], 'repaired');
  // members and parents
  await put(f, 'parents/parentA', { familyId: 'elsewhere' });
  assert.deepEqual(codes(await f.support.inspectAll({ operator: OPERATOR })), ['PARENT_LINK_MISMATCH']);
  await put(f, 'parents/parentA', { familyId: a.familyId, identityDeletion: { requestedAt: f.now(), requestedBy: 'x', deletedAt: null } });
  assert.deepEqual(codes(await f.support.inspectAll({ operator: OPERATOR })), ['DELETED_ACCOUNT_STILL_MEMBER']);
  await f.store.transaction(async (tx) => { const p = await tx.get('parents/parentA'); delete p.identityDeletion; tx.set('parents/parentA', p); });
  // provider links both ways
  const b = await f.family('parentB', 0); const chk = await f.payments.checkout(b.ctx, { plan: 'starter', ...op() });
  await put(f, `billingCustomers/fake:${chk.customerRef}`, { familyId: a.familyId });
  r = await f.support.inspectAll({ operator: OPERATOR }); assert.deepEqual(codes(r), ['CUSTOMER_MAPPING_MISMATCH', 'CUSTOMER_NOT_ON_FAMILY']);
  await put(f, `billingCustomers/fake:${chk.customerRef}`, { familyId: b.familyId });
  await f.store.transaction(async (tx) => tx.set('billingCustomers/fake:orphan', { provider: 'fake', customerRef: 'orphan', familyId: randomUUID(), pending: [] }));
  assert.deepEqual(codes(await f.support.inspectAll({ operator: OPERATOR })), ['ORPHAN_CUSTOMER']);
  await f.store.transaction(async (tx) => tx.delete('billingCustomers/fake:orphan'));
  // subscription facts and open work
  const paid = { plan: 'starter', seats: 2, state: 'active', periodEnd: f.now() + 30 * DAY, cancelAtPeriodEnd: false, provider: 'fake', providerRef: 'x', version: 1, startedAt: f.now(), updatedAt: f.now() };
  await put(f, `families/${b.familyId}`, { subscription: { ...paid, periodEnd: f.now() + 500 * DAY } });
  await put(f, `families/${a.familyId}`, { subscription: paid }); // a paid subscription on a family that never checked out: no customer reference
  r = await f.support.inspectAll({ operator: OPERATOR }); assert.deepEqual(codes(r), ['PAID_WITHOUT_CUSTOMER', 'SUBSCRIPTION_PERIOD_ABSURD']);
  await put(f, `families/${b.familyId}`, { subscription: null }); await put(f, `families/${a.familyId}`, { subscription: null });
  f.advance(2 * DAY); assert.deepEqual(codes(await f.support.inspectAll({ operator: OPERATOR })), ['STALE_CHECKOUT'], 'a hosted session nobody paid for a day');
  await put(f, `families/${b.familyId}`, { checkoutIntent: {}, billingIntent: { operationId: 'op-old', at: f.now() - 2 * DAY } });
  await f.store.transaction(async (tx) => { tx.set('billingChangeIntents/fake:i1', { provider: 'fake', operationId: 'i1', familyId: b.familyId, status: 'creating', createdAt: f.now() - DAY }); tx.set('billingChangeIntents/fake:i2', { provider: 'fake', operationId: 'i2', familyId: b.familyId, status: 'awaiting_payment', awaitingSince: f.now() - 2 * DAY, createdAt: f.now() - 2 * DAY }); });
  r = await f.support.inspectAll({ operator: OPERATOR }); assert.deepEqual(codes(r), ['LAPSED_AWAITING_PAYMENT', 'STALE_INFLIGHT_MARKER', 'STALE_INTENT']); assert.equal(r.counts.openIntents, 2);
  await f.store.transaction(async (tx) => { tx.delete('billingChangeIntents/fake:i1'); tx.delete('billingChangeIntents/fake:i2'); }); await put(f, `families/${b.familyId}`, { billingIntent: null });
  // deletions due or stuck; recoveries stuck
  const b2 = await f.login('parentB'); await f.support.requestDeletion(b2.ctx, op()); f.advance(15 * DAY);
  assert.deepEqual(codes(await f.support.inspectAll({ operator: OPERATOR })), ['DELETION_DUE']);
  await f.store.transaction(async (tx) => tx.set('recoveries/parentA', { uid: 'parentA', status: 'completing', claimedAt: f.now() - 2 * 3_600_000, readyAt: f.now(), requestedAt: f.now() }));
  r = await f.support.inspectAll({ operator: OPERATOR }); assert.deepEqual(codes(r), ['DELETION_DUE', 'RECOVERY_STUCK']); assert.equal(r.counts.openRecoveries, 1);
  await f.store.transaction(async (tx) => tx.delete('recoveries/parentA'));
  // a finished deletion leaves a clean tombstone; residue is named
  await f.support.executeDeletion(b.familyId, { operator: OPERATOR });
  r = await f.support.inspectAll({ operator: OPERATOR }); assert.deepEqual(codes(r), []); assert.equal(r.counts.tombstones, 1); assert.equal(r.counts.families, 1);
  await f.store.transaction(async (tx) => tx.set(`families/${b.familyId}/children/left-behind`, { nickname: 'x', status: 'inactive' }));
  assert.deepEqual(codes(await f.support.inspectAll({ operator: OPERATOR })), ['TOMBSTONE_RESIDUE']);
  // the record keeps at most maxFindings; the counts are complete
  const small = await f.support.inspectAll({ operator: OPERATOR, maxFindings: 0 }); assert.equal(small.findings.length, 0); assert.equal(small.counts.findings, 1); assert.equal(small.truncated, true);
  const src = await readFile(new URL('../scripts/support.mjs', import.meta.url), 'utf8'); assert.match(src, /case 'sweep'/); assert.match(src, /exitCode = 2/);
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8'); assert.match(docker, /COPY scripts\//, 'the container carries the CLI for the scheduled job');
});
test('disputes end access the moment they open; a pending refund already counts; a failed refund and a won dispute are recorded for the operator', async () => {
  const f = fixture(), account = stripeAccount(f);
  const payments = new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'stripe', gateways: { stripe: account.gw }, now: f.now });
  const support = new Support({ foundation: f.service, store: f.store, billing: f.billing, payments, now: f.now });
  const a = await f.family('parentA', 0);
  const chk = await payments.checkout(a.ctx, { plan: 'family', ...op() }); account.activate(PRICES.family);
  const done = event(f, 'checkout.session.completed', { object: 'checkout.session', payment_status: 'paid', customer: account.state.customer.id, subscription: 'sub_1', client_reference_id: chk.checkoutId, metadata: { familyId: a.familyId } });
  let s = signed(f, done); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  account.state.charge = { id: 'ch_1', customer: account.state.customer.id, amount: 900, amount_refunded: 0, refunded: false };
  // a pending partial refund counts at once; its later success is the same refund
  const pending = event(f, 'refund.created', { object: 'refund', id: 're_1', charge: 'ch_1', amount: 200, status: 'pending' });
  s = signed(f, pending); assert.equal((await payments.receive('stripe', s.raw, s.headers)).status, 'applied');
  let fam = await f.store.get(`families/${a.familyId}`); assert.deepEqual(fam.subscription.refunds.map((x) => x.amountCents), [200]); assert.equal(fam.subscription.state, 'active');
  const succeeded = event(f, 'refund.updated', { object: 'refund', id: 're_1', charge: 'ch_1', amount: 200, status: 'succeeded' });
  s = signed(f, succeeded); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'ignored', reason: 'DUPLICATE_REFUND' });
  // a refund the provider could not complete: recorded, counted, nothing applied
  const failed = event(f, 'refund.updated', { object: 'refund', id: 're_2', charge: 'ch_1', amount: 100, status: 'failed' });
  s = signed(f, failed); assert.equal((await payments.receive('stripe', s.raw, s.headers)).reason, 'UNSUPPORTED_EVENT');
  let report = await support.familyReport(a.familyId); assert.equal(report.attention.refundFailures, 1); assert.ok(report.inbox.some((e) => e.type === 'refund.failed'));
  // a dispute: access ends the moment it opens; funds_withdrawn is the same dispute
  const opened = event(f, 'charge.dispute.created', { object: 'dispute', id: 'dp_1', charge: 'ch_1', amount: 900, status: 'needs_response' });
  s = signed(f, opened); assert.equal((await payments.receive('stripe', s.raw, s.headers)).state, 'cancelled');
  fam = await f.store.get(`families/${a.familyId}`); assert.equal(fam.subscription.state, 'cancelled'); assert.deepEqual(fam.subscription.refunds.map((x) => x.amountCents), [200, 900]);
  assert.equal((await f.service.me(a.ctx)).family.entitlement.status, 'inactive', 'no child can play');
  const withdrawn = event(f, 'charge.dispute.funds_withdrawn', { object: 'dispute', id: 'dp_1', charge: 'ch_1', amount: 900, status: 'needs_response' });
  s = signed(f, withdrawn); assert.deepEqual(await payments.receive('stripe', s.raw, s.headers), { status: 'ignored', reason: 'DUPLICATE_REFUND' });
  // won: recorded for the operator, nothing restored by itself
  const won = event(f, 'charge.dispute.closed', { object: 'dispute', id: 'dp_1', charge: 'ch_1', amount: 900, status: 'won' });
  s = signed(f, won); assert.equal((await payments.receive('stripe', s.raw, s.headers)).reason, 'UNSUPPORTED_EVENT');
  report = await support.familyReport(a.familyId); assert.equal(report.attention.disputesWon, 1); assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.state, 'cancelled');
  const lost = event(f, 'charge.dispute.closed', { object: 'dispute', id: 'dp_2', charge: 'ch_1', amount: 900, status: 'lost' });
  s = signed(f, lost); assert.equal((await payments.receive('stripe', s.raw, s.headers)).reason, 'UNSUPPORTED_EVENT'); assert.ok((await support.familyReport(a.familyId)).inbox.some((e) => e.type === 'dispute.lost'));
  const sweep = await support.inspectAll({ operator: OPERATOR }); assert.deepEqual(sweep.findings, []);
});
