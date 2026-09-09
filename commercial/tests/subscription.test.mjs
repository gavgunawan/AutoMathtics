// Stage 3.2 — the subscription state machine: facts set by events, state derived from the clock,
// entitlement read by every route, one trial per verified phone, events idempotent by id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { transition, deriveState, entitlementFor, accessUntil, assignSeats, PLANS, TRIAL_DAYS, GRACE_DAYS, DUNNING_DAYS } from '../server/subscription.mjs';
import { grantEntitlement } from '../server/service.mjs';

const DAY = 86_400_000, T0 = Date.parse('2026-09-10T00:00:00Z');
const samePhone = (f, ...uids) => { for (const u of uids) { f.token(u); f.users.get(u).multiFactor.enrolledFactors[0].phoneNumber = '+6591230000'; } };
async function parentAgain(f, uid = 'parentA') { f.advance(2000); return f.login(uid); }

test('the pure machine: trial → paid → grace → past due → expired, and the branches off that path', () => {
  const trial = transition(null, { type: 'trial.start' }, T0);
  assert.equal(deriveState(trial, T0), 'trial'); assert.equal(trial.seats, 2); assert.equal(accessUntil(trial, T0), T0 + TRIAL_DAYS * DAY);
  assert.equal(deriveState(trial, T0 + TRIAL_DAYS * DAY), 'expired'); assert.equal(entitlementFor(trial, T0 + TRIAL_DAYS * DAY).status, 'inactive');
  assert.throws(() => transition(trial, { type: 'trial.start' }, T0), rejected('SUBSCRIPTION_EXISTS'));
  const paid = transition(trial, { type: 'payment.succeeded', plan: 'family', periodEnd: T0 + 30 * DAY }, T0 + 3 * DAY);
  assert.equal(deriveState(paid, T0 + 10 * DAY), 'active'); assert.equal(paid.seats, 4); assert.equal(paid.version, 2); assert.equal(paid.trialEndsAt, null);
  assert.equal(entitlementFor(paid, T0 + 10 * DAY).accessUntil, T0 + 30 * DAY);
  assert.equal(deriveState(paid, T0 + 31 * DAY), 'grace'); assert.equal(entitlementFor(paid, T0 + 31 * DAY).status, 'active'); assert.equal(accessUntil(paid, T0 + 31 * DAY), T0 + (30 + GRACE_DAYS) * DAY);
  assert.equal(deriveState(paid, T0 + (30 + GRACE_DAYS) * DAY), 'past_due'); assert.equal(entitlementFor(paid, T0 + (30 + GRACE_DAYS) * DAY).status, 'inactive');
  assert.equal(deriveState(paid, T0 + (30 + GRACE_DAYS + DUNNING_DAYS) * DAY), 'expired');
  const failed = transition(paid, { type: 'payment.failed' }, T0 + 29 * DAY);
  assert.equal(deriveState(failed, T0 + 29 * DAY), 'active', 'a failed attempt before the period ends does not cut access'); assert.equal(failed.failures, 1);
  const recovered = transition(failed, { type: 'payment.succeeded', plan: 'family', periodEnd: T0 + 60 * DAY }, T0 + 33 * DAY);
  assert.equal(deriveState(recovered, T0 + 33 * DAY), 'active'); assert.equal(recovered.failedAt, null);
  const cancelling = transition(paid, { type: 'cancel.request' }, T0 + 10 * DAY);
  assert.equal(deriveState(cancelling, T0 + 20 * DAY), 'active'); assert.equal(deriveState(cancelling, T0 + 30 * DAY), 'cancelled'); assert.equal(entitlementFor(cancelling, T0 + 30 * DAY).status, 'inactive');
  assert.equal(deriveState(transition(cancelling, { type: 'cancel.undo' }, T0 + 20 * DAY), T0 + 31 * DAY), 'grace');
  assert.throws(() => transition(paid, { type: 'cancel.undo' }, T0 + 10 * DAY), rejected('INVALID_TRANSITION'));
  const changed = transition(paid, { type: 'plan.change', plan: 'big' }, T0 + 10 * DAY); assert.equal(changed.seats, 6); assert.equal(deriveState(changed, T0 + 10 * DAY), 'active');
  assert.throws(() => transition(paid, { type: 'plan.change', plan: 'trial' }, T0), rejected('INVALID_PLAN'));
  assert.throws(() => transition(paid, { type: 'payment.succeeded', plan: 'family', periodEnd: T0 }, T0 + 10 * DAY), rejected('INVALID_PERIOD'));
  assert.throws(() => transition(trial, { type: 'payment.failed' }, T0), rejected('INVALID_TRANSITION'));
  const ended = transition(paid, { type: 'terminate' }, T0 + 10 * DAY); assert.equal(deriveState(ended, T0 + 10 * DAY), 'cancelled');
  assert.equal(deriveState(transition(ended, { type: 'payment.succeeded', plan: 'starter', periodEnd: T0 + 40 * DAY }, T0 + 11 * DAY), T0 + 11 * DAY), 'active', 'a subscription can come back');
  assert.throws(() => transition(paid, { type: 'made.up' }, T0), rejected('INVALID_EVENT'));
});
test('seat occupancy: an explicit list can deactivate and reactivate; without one the occupants must fit', () => {
  const A = randomUUID(), B = randomUUID(), C = randomUUID();
  const family = { childIds: [A, B, C], activeChildIds: [A, B, C] };
  assert.deepEqual(assignSeats(family, 4), { activeChildIds: [A, B, C], activated: [], deactivated: [] });
  assert.throws(() => assignSeats(family, 2), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  assert.throws(() => assignSeats(family, 2, [A, B, C]), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  assert.throws(() => assignSeats(family, 2, [A, randomUUID()]), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  assert.throws(() => assignSeats(family, 2, 'A,B'), rejected('INVALID_SEAT_SELECTION'));
  assert.deepEqual(assignSeats(family, 2, [A, C]), { activeChildIds: [A, C], activated: [], deactivated: [B] });
  const after = { childIds: [A, B, C], activeChildIds: [A, C] };
  assert.deepEqual(assignSeats(after, 4, [A, B, C]), { activeChildIds: [A, B, C], activated: [B], deactivated: [] }); // 3.2-A: an upgrade brings B back
});
test('a parent starts the trial; the server decides from the verified phone; one trial per phone across accounts', async () => {
  const f = fixture(); samePhone(f, 'parentA', 'parentA2');
  const a = await f.family('parentA', 0);
  const view = await f.billing.view(a.ctx);
  assert.equal(view.subscription, null); assert.equal(view.trial.eligible, true); assert.deepEqual(view.plans.map((p) => p.id), ['starter', 'family', 'big']);
  const r = await f.billing.startTrial(a.ctx);
  assert.equal(r.state, 'trial'); assert.equal(r.entitlement.seatLimit, 2); assert.equal(r.entitlement.accessUntil, f.now() + TRIAL_DAYS * DAY);
  const { child } = await f.child(a.ctx); assert.ok(child.id, 'the trial opens child slots');
  assert.equal((await f.service.me(a.ctx)).family.entitlement.state, 'trial');
  await assert.rejects(f.billing.startTrial(a.ctx), rejected('SUBSCRIPTION_EXISTS'));
  const key = (await f.store.get(`families/${a.familyId}`)).phoneKey; assert.equal((await f.store.get(`phones/${key}`)).trialFamilyId, a.familyId);
  const again = await f.family('parentA2', 0); // same phone, new email, new family
  assert.deepEqual((await f.billing.view(again.ctx)).trial, { eligible: false, reason: 'TRIAL_ALREADY_USED' });
  await assert.rejects(f.billing.startTrial(again.ctx), rejected('TRIAL_ALREADY_USED'));
  const g = fixture(); g.token('parentC'); delete g.users.get('parentC').multiFactor.enrolledFactors[0].phoneNumber;
  const c = await g.family('parentC', 0);
  await assert.rejects(g.billing.startTrial(c.ctx), rejected('TRIAL_REQUIRES_VERIFIED_PHONE'));
});
test('when the trial ends the child is locked out; a payment event reopens the grid', async () => {
  const f = fixture(); const a = await f.family('parentA', 0); await f.billing.startTrial(a.ctx);
  const { child } = await f.child(a.ctx);
  const selCtx = await f.service.authenticate(await f.service.lock(a.ctx));
  const childCtx = await f.service.authenticate(await f.service.selectChild(selCtx, child.id, '763829'));
  assert.equal((await f.service.me(childCtx)).role, 'child');
  f.advance(TRIAL_DAYS * DAY - 60_000); // one minute before the trial ends: a fresh handover still works
  const p1 = await parentAgain(f); const sel1 = await f.service.authenticate(await f.service.lock(p1.ctx));
  const late = await f.service.authenticate(await f.service.selectChild(sel1, child.id, '763829'));
  assert.equal((await f.service.me(late)).role, 'child');
  f.advance(120_000); // and now out, on that same cookie: entitlement is checked at use time
  await assert.rejects(f.service.me(late), rejected('SUBSCRIPTION_INACTIVE'));
  await assert.rejects(f.learning.start(late, { track: 'engine' }), rejected('SUBSCRIPTION_INACTIVE'));
  const p = await parentAgain(f); const sel2 = await f.service.authenticate(await f.service.lock(p.ctx));
  await assert.rejects(f.service.selectChild(sel2, child.id, '763829'), rejected('SUBSCRIPTION_INACTIVE')); // a fresh handover is refused too
  const paid = await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'starter', periodEnd: f.now() + 30 * DAY }, 'test-operator');
  assert.equal(paid.state, 'active');
  const childCtx2 = await f.service.authenticate(await f.service.selectChild(sel2, child.id, '763829'));
  assert.equal((await f.service.me(childCtx2)).role, 'child'); // the grid reopens
  await assert.rejects(f.billing.apply(a.familyId, { id: randomUUID(), type: 'trial.start' }, 'test-operator'), rejected('TRIAL_IS_PARENT_ACTION'));
});
test('a downgrade with too many active children needs a keep list, and deactivates the rest', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'family', periodEnd: f.now() + 30 * DAY }, 'test-operator');
  const kids = []; for (const n of ['One', 'Two', 'Three']) kids.push((await f.child(a.ctx, n)).child);
  await assert.rejects(f.billing.apply(a.familyId, { id: randomUUID(), type: 'plan.change', plan: 'starter' }, 'test-operator'), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  const r = await f.billing.apply(a.familyId, { id: randomUUID(), type: 'plan.change', plan: 'starter', seatChildIds: [kids[0].id, kids[2].id] }, 'test-operator');
  assert.deepEqual(r.deactivated, [kids[1].id]); assert.equal(r.entitlement.seatLimit, 2);
  const fam = await f.store.get(`families/${a.familyId}`); assert.deepEqual(fam.activeChildIds, [kids[0].id, kids[2].id]);
  assert.equal((await f.store.get(`families/${a.familyId}/children/${kids[1].id}`)).status, 'inactive');
  await assert.rejects(f.child(a.ctx, 'Four'), rejected('CHILD_LIMIT_REACHED'));
});
test('3.2-A: a child dropped by a downgrade comes back on an upgrade with all their progress, and the seat list agrees with child status', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'family', periodEnd: f.now() + 30 * DAY }, 'test-operator');
  const kids = []; for (const n of ['A', 'B', 'C']) kids.push((await f.child(a.ctx, n)).child);
  // C earns progress before the downgrade
  const selCtx = await f.service.authenticate(await f.service.lock(a.ctx));
  const cCtx = await f.service.authenticate(await f.service.selectChild(selCtx, kids[2].id, '763829'));
  await f.game.equip(cCtx, { kind: 'pet', itemId: null }); const before = await f.store.get(`families/${a.familyId}/learning/${kids[2].id}`);
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'plan.change', plan: 'starter', seatChildIds: [kids[0].id, kids[1].id] }, 'test-operator');
  await assert.rejects(f.service.me(cCtx), rejected('CHILD_INACTIVE'));
  const up = await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'family', periodEnd: f.now() + 60 * DAY }, 'test-operator');
  assert.deepEqual(up.activeChildIds, [kids[0].id, kids[1].id], 'capacity grew but nobody was seated automatically');
  f.advance(2000); const p = await f.login('parentA');
  await assert.rejects(f.billing.seats(p.ctx, { childIds: [kids[0].id, kids[2].id] }), rejected('SEATS_CANNOT_REMOVE')); // a parent may add, never swap
  const seated = await f.billing.seats(p.ctx, { childIds: [kids[0].id, kids[1].id, kids[2].id], operationId: randomUUID() });
  assert.deepEqual(seated.activated, [kids[2].id]); assert.deepEqual(seated.activeChildIds, [kids[0].id, kids[1].id, kids[2].id]);
  const fam = await f.store.get(`families/${a.familyId}`);
  for (const k of kids) assert.equal((await f.store.get(`families/${a.familyId}/children/${k.id}`)).status, fam.activeChildIds.includes(k.id) ? 'active' : 'inactive');
  assert.deepEqual(await f.store.get(`families/${a.familyId}/learning/${kids[2].id}`), before, 'C\'s progress is exactly what it was');
  await assert.rejects(f.billing.seats(p.ctx, { childIds: [kids[0].id, kids[1].id, kids[2].id, randomUUID()] }), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  const sel2 = await f.service.authenticate(await f.service.lock(p.ctx));
  assert.ok(await f.service.selectChild(sel2, kids[2].id, '763829'), 'C can enter again with the old PIN');
});
test('events are idempotent by id, recorded before they act, and a manual grant is refused once a subscription exists', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  const id = randomUUID(); const ev = { id, type: 'payment.succeeded', plan: 'starter', periodEnd: f.now() + 30 * DAY };
  const first = await f.billing.apply(a.familyId, ev, 'test-operator'); const again = await f.billing.apply(a.familyId, ev, 'test-operator');
  assert.deepEqual(again, first); assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.version, 1);
  const rec = await f.store.get(`families/${a.familyId}/billing/${id}`); assert.equal(rec.type, 'payment.succeeded'); assert.equal(rec.result.state, 'active'); assert.equal(typeof rec.fingerprint, 'string');
  // 3.2-B: the same id with different content is a conflict, not a silent replay
  await assert.rejects(f.billing.apply(a.familyId, { id, type: 'payment.failed' }, 'test-operator'), rejected('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(f.billing.apply(a.familyId, { ...ev, plan: 'family' }, 'test-operator'), rejected('IDEMPOTENCY_CONFLICT'));
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.plan, 'starter');
  await assert.rejects(f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'starter', periodEnd: f.now() + 30 * DAY, extra: 1 }, 'test-operator'), rejected('INVALID_REQUEST'));
  await assert.rejects(grantEntitlement(f.store, { familyId: a.familyId, seatLimit: 5, accessUntil: f.now() + DAY, reason: 'manual on subscribed', actor: 'test-operator' }, f.now()), rejected('SUBSCRIPTION_MANAGED'));
  await assert.rejects(f.billing.apply(randomUUID(), ev, 'test-operator'), rejected('FAMILY_NOT_FOUND'));
});
test('a parent can cancel at the end of the period and undo it; access is never cut short', async () => {
  const f = fixture(); const a = await f.family('parentA', 0);
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan: 'starter', periodEnd: f.now() + 30 * DAY }, 'test-operator');
  await assert.rejects(f.billing.cancel(a.ctx, { undo: true }), rejected('INVALID_TRANSITION'));
  const op = randomUUID();
  const r = await f.billing.cancel(a.ctx, { operationId: op }); assert.equal(r.entitlement.cancelAtPeriodEnd, true); assert.equal(r.state, 'active');
  assert.deepEqual(await f.billing.cancel(a.ctx, { operationId: op }), r); // a retried click after a lost response is the same event
  await assert.rejects(f.billing.cancel(a.ctx, { undo: true, operationId: op }), rejected('IDEMPOTENCY_CONFLICT'));
  f.advance(29 * DAY); const p = await parentAgain(f);
  assert.equal((await f.billing.view(p.ctx)).subscription.status, 'active');
  const undone = await f.billing.cancel(p.ctx, { undo: true }); assert.equal(undone.entitlement.cancelAtPeriodEnd, false);
  f.advance(2 * DAY); const p2 = await parentAgain(f);
  assert.equal((await f.billing.view(p2.ctx)).subscription.state, 'grace');
  await f.billing.cancel(p2.ctx, {}); // cancel during grace: ends now that the period is over
  f.advance(1); const p3 = await parentAgain(f);
  assert.equal((await f.billing.view(p3.ctx)).subscription.state, 'cancelled');
  await assert.rejects(f.billing.cancel(p3.ctx, {}), rejected('INVALID_TRANSITION'));
  const g = fixture(); const b = await g.family('parentB', 0); await assert.rejects(g.billing.cancel(b.ctx, {}), rejected('NO_SUBSCRIPTION'));
});
test('billing is parent-only and never accepts a state or seat count from the browser', async () => {
  const f = fixture(); const k = await f.childSession();
  await assert.rejects(f.billing.view(k.childCtx), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.billing.startTrial(k.childCtx), rejected('PARENT_REQUIRED'));
  f.advance(2000); const p = await f.login('parentA');
  await assert.rejects(f.billing.cancel(p.ctx, { undo: true, state: 'active' }), rejected('INVALID_REQUEST'));
  assert.deepEqual(Object.keys((await f.billing.view(p.ctx)).plans[0]).sort(), ['id', 'name', 'priceCents', 'purchasable', 'seats']);
});
