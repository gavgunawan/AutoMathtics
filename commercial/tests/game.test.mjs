import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, canonical } from './support.mjs';
import { freshProgress, normalizeProgress } from '../server/progress.mjs';
import { applyGameDerived, SHOP_ITEMS } from '../server/game.mjs';

const progPath = (k) => `families/${k.p.familyId}/learning/${k.child.id}`;
const sessionPath = (k, id) => `${progPath(k)}/sessions/${id}`;
async function parentAgain(f) { f.advance(2000); return f.login('parentA'); }
async function earn(f, k, gc = 1000, rp = 1000) {
  const p = normalizeProgress(await f.store.get(progPath(k))); p.wallet.gc = gc; p.wallet.rp = rp; await f.store.put(progPath(k), p); return p;
}
async function complete(f, k, started) {
  const raw = await f.store.get(sessionPath(k, started.session.id)); let q = started.question, last;
  while (q) { last = await f.learning.answer(k.childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: canonical(raw.questions[q.index]) }); q = last.question || null; }
  return last;
}

test('game shop is server-priced, idempotent, auto-equips normal buys and makes crate randomness server-owned', async () => {
  const f = fixture(), k = await f.childSession(); await earn(f, k, 5000, 0);
  const op = randomUUID(), bought = await f.game.buy(k.childCtx, { itemId: 'pet_drone', operationId: op });
  assert.equal(bought.wallet.gc, 4500); assert.ok(bought.wallet.inventory.includes('pet_drone')); assert.equal(bought.wallet.activePet, 'pet_drone');
  assert.deepEqual(await f.game.buy(k.childCtx, { itemId: 'pet_drone', operationId: op }), bought);
  await assert.rejects(f.game.buy(k.childCtx, { itemId: 'pet_drone', operationId: randomUUID() }), rejected('ITEM_ALREADY_OWNED'));
  await assert.rejects(f.game.buy(k.childCtx, { itemId: 'pet_fox', operationId: randomUUID() }), rejected('ITEM_NOT_FOR_SALE'));
  const crate = await f.game.buy(k.childCtx, { itemId: 'crate', operationId: randomUUID() });
  assert.ok(crate.awarded); assert.ok(['outfit', 'shout', 'timer', 'title', 'namefx', 'map'].includes(crate.awarded.kind));
  assert.ok(crate.wallet.inventory.includes(crate.awarded.id)); assert.equal(crate.wallet.gc, 4200);
  const log = [...f.store.data.entries()].find(([p]) => p.includes('/ledger/') && p.endsWith(op)); assert.ok(log); assert.equal(log[1].amount, -500);
});

test('equipping requires ownership and cannot use a mismatched slot', async () => {
  const f = fixture(), k = await f.childSession(); await earn(f, k, 1000, 0);
  await assert.rejects(f.game.equip(k.childCtx, { kind: 'pet', itemId: 'pet_cat' }), rejected('ITEM_NOT_OWNED'));
  await f.game.buy(k.childCtx, { itemId: 'fit_hat', operationId: randomUUID() });
  await assert.rejects(f.game.equip(k.childCtx, { kind: 'pet', itemId: 'fit_hat' }), rejected('ITEM_NOT_OWNED'));
  const r = await f.game.equip(k.childCtx, { kind: 'outfit', itemId: 'fit_hat' }); assert.equal(r.wallet.activeOutfit, 'fit_hat');
  assert.equal((await f.game.equip(k.childCtx, { kind: 'outfit', itemId: null })).wallet.activeOutfit, null);
});

test('streak shields, earned pets and mystery eggs are derived from trusted progress', () => {
  let p = freshProgress(); p.wallet.gc = 2000; p.wallet.shields = 1; p.passDays = ['2026-09-06'];
  const bridged = applyGameDerived(p, Date.parse('2026-09-08T10:00:00Z'), 'UTC', () => 0);
  assert.equal(bridged.progress.wallet.shields, 0); assert.deepEqual(bridged.progress.wallet.shieldDays, ['2026-09-07']); assert.equal(bridged.events[0].type, 'shield');
  p = freshProgress(); p.stats.passes = 5; p.history = Array.from({ length: 5 }, (_, i) => ({ ts: 5 - i, date: '2026-09-08', total: 25, passed: true }));
  let d = applyGameDerived(p, Date.parse('2026-09-08T10:00:00Z'), 'UTC', () => 0); assert.ok(d.progress.wallet.inventory.includes('pet_legend'));
  p = d.progress; p.wallet.egg = { passesAt: 0, hatched: false, bought: '2026-09-01' }; d = applyGameDerived(p, Date.parse('2026-09-08T10:00:00Z'), 'UTC', () => 0);
  assert.equal(d.progress.wallet.egg.hatched, true); assert.equal(d.progress.wallet.egg.into, 'pet_fox'); assert.equal(d.progress.wallet.activePet, 'pet_fox');
});

test('reward store is parent-configured; request spends RP once and parent approval/rejection is authoritative', async () => {
  const f = fixture(), k = await f.childSession(); await earn(f, k, 0, 1000); const parent = await parentAgain(f);
  const reward = { id: 'screen-time', emoji: '🎮', name: 'Game time', cost: 300, hidden: false, cap: 1, childIds: [k.child.id] };
  await f.game.setRewards(parent.ctx, { rewards: [reward] });
  const op = randomUUID(), r = await f.game.redeem(k.childCtx, { rewardId: reward.id, operationId: op }); assert.equal(r.wallet.rp, 700); assert.equal(r.redemption.status, 'pending');
  assert.equal((await f.game.redeem(k.childCtx, { rewardId: reward.id, operationId: op })).wallet.rp, 700);
  await assert.rejects(f.game.redeem(k.childCtx, { rewardId: reward.id, operationId: randomUUID() }), rejected('REWARD_DAILY_LIMIT'));
  const approved = await f.game.decideRedemption(parent.ctx, { childId: k.child.id, redemptionId: r.redemption.id, decision: 'approve' }); assert.equal(approved.redemption.status, 'approved');
  const reward2 = { ...reward, id: 'snack', name: 'Snack', cap: 0 }; await f.game.setRewards(parent.ctx, { rewards: [reward, reward2] });
  const r2 = await f.game.redeem(k.childCtx, { rewardId: reward2.id, operationId: randomUUID() });
  await f.game.decideRedemption(parent.ctx, { childId: k.child.id, redemptionId: r2.redemption.id, decision: 'reject' });
  assert.equal((await f.game.state(k.childCtx)).wallet.rp, 700, 'rejection refunds the held points');
});

test('Family Rocket uses child IDs, spends wallet atomically and launches only when goal/minimum are met', async () => {
  const f = fixture(), k = await f.childSession(); await earn(f, k, 1000, 0); const parent = await parentAgain(f);
  const built = await f.game.rocket(parent.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 100, minEach: 100, crewChildIds: [k.child.id] });
  assert.equal(built.rocket.status, 'fueling'); const op = randomUUID();
  const fueled = await f.game.fuel(k.childCtx, { rocketId: built.rocket.id, amount: 100, operationId: op }); assert.equal(fueled.rocket.status, 'launched'); assert.equal(fueled.wallet.gc, 900);
  assert.equal((await f.game.fuel(k.childCtx, { rocketId: built.rocket.id, amount: 100, operationId: op })).wallet.gc, 900);
  const claimed = await f.game.rocket(parent.ctx, { action: 'claim', rocketId: built.rocket.id }); assert.equal(claimed.rocket, null); assert.equal(claimed.rocketHistory.at(-1).status, 'claimed');
});

test('parent credits are idempotent and cannot drive a wallet below zero', async () => {
  const f = fixture(), k = await f.childSession(); await earn(f, k, 10, 20); const parent = await parentAgain(f), op = randomUUID();
  const a = await f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'gc', amount: 50, reason: 'manual challenge prize', operationId: op }); assert.equal(a.wallet.gc, 60);
  assert.equal((await f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'gc', amount: 50, reason: 'manual challenge prize', operationId: op })).wallet.gc, 60);
  await assert.rejects(f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'gc', amount: -100, reason: 'correction', operationId: randomUUID() }), rejected('INSUFFICIENT_BALANCE'));
});

test('parent workspace exposes learning progress and can set family timezone and per-child pace', async () => {
  const f = fixture(), k = await f.childSession(); const parent = await parentAgain(f);
  await f.game.settings(parent.ctx, { timeZone: 'Asia/Jakarta' }); await f.game.settings(parent.ctx, { childId: k.child.id, pacePercent: 130 });
  const p = await f.game.parentState(parent.ctx); assert.equal(p.timeZone, 'Asia/Jakarta'); assert.equal(p.children[0].pacePercent, 130); assert.equal(p.children[0].engine.levelId, 'A');
  await assert.rejects(f.game.settings(parent.ctx, { childId: k.child.id, pacePercent: 201 }), rejected('INVALID_PACE'));
});

test('weekly System Scan is server-generated, pays x2, keeps paper progress and is once per family week', async () => {
  const f = fixture(), k = await f.childSession(); const p = freshProgress(); p.engine = { level: 1, paper: 21, bossCleared: 1 }; await f.store.put(progPath(k), p);
  const started = await f.learning.start(k.childCtx, { track: 'engine', mode: 'scan' }); assert.equal(started.session.mode, 'scan'); assert.equal(started.session.count, 25);
  const raw = await f.store.get(sessionPath(k, started.session.id)); assert.equal(raw.questions.filter((q) => q.level === 1).length >= 10, true);
  const last = await complete(f, k, started); assert.equal(last.summary.passed, true); assert.equal(last.summary.gcEarned, 100); assert.equal(last.summary.rpEarned, 200);
  const state = await f.learning.state(k.childCtx); assert.equal(state.engine.paper, 21); assert.equal(state.scan.doneThisWeek, true);
  await assert.rejects(f.learning.start(k.childCtx, { track: 'engine', mode: 'scan' }), rejected('SCAN_ALREADY_DONE'));
});

test('catalog contains the migrated v2 game categories rather than browser-defined shop rows', () => {
  for (const id of ['pet_dragon', 'fit_hat', 'bg_space', 'ring_prestige', 'shout_robot', 'tbar_rainbow', 'map_gold', 'veh_mech', 'base_deck', 'shield', 'crate', 'egg']) assert.ok(SHOP_ITEMS.some((x) => x.id === id));
});

test('game routes preserve the Stage 1 role boundary: parent cannot spend child currency and child cannot administer rewards', async () => {
  const f = fixture(), k = await f.childSession();
  f.advance(2000); const parent = await f.login('parentA');
  await assert.rejects(f.game.buy(parent.ctx, { itemId: 'ring_pulse', operationId: randomUUID() }), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.game.parentState(k.childCtx), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.game.adjust(k.childCtx, { childId: k.child.id, currency: 'gc', amount: 50, reason: 'forged child admin credit', operationId: randomUUID() }), rejected('PARENT_REQUIRED'));
});

test('child game projections do not disclose sibling reward eligibility or Rocket crew identifiers', async () => {
  const f = fixture(), k = await f.childSession(); await earn(f, k, 1000, 1000); const parent = await parentAgain(f);
  await f.game.setRewards(parent.ctx, { rewards: [{ id: 'private-eligibility', emoji: '🎁', name: 'Prize', cost: 100, hidden: false, cap: 0, childIds: [k.child.id] }] });
  await f.game.rocket(parent.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 500, minEach: 50, crewChildIds: [k.child.id] });
  const state = await f.game.state(k.childCtx);
  assert.equal(state.rewards[0].childIds, undefined);
  assert.equal(state.rocket.crewChildIds, undefined); assert.equal(state.rocket.fuel, undefined);
  assert.equal(state.rocket.isCrew, true); assert.equal(state.rocket.myFuel, 0);
});
