// Stage 3.1 — the ledger is the source of truth: every way money moves is one immutable row,
// and the wallet's cached balance always re-derives from the rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore, fixture, rejected, canonical } from './support.mjs';
import { entry, post, derive, reconcile } from '../server/ledger.mjs';
import { importLearning } from '../server/migrate.mjs';
import { freshProgress } from '../server/progress.mjs';

const base = (k) => `families/${k.p.familyId}/learning/${k.child.id}`;
async function check(f, k) {
  const rows = await f.store.list(`${base(k)}/ledger`), prog = await f.store.get(base(k));
  const r = reconcile(rows, prog.wallet);
  assert.ok(r.match, r.problems.join('; '));
  return { rows, prog, r };
}
async function play(f, k, track) {
  const started = await f.learning.start(k.childCtx, { track });
  const stored = await f.store.get(`${base(k)}/sessions/${started.session.id}`);
  let q = started.question, last;
  while (q) { f.advance(2000); last = await f.learning.answer(k.childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: canonical(stored.questions[q.index]) }); q = last.question || null; }
  return { started, last };
}
async function parentAgain(f) { f.advance(2000); return f.login('parentA'); }

test('entry() validates, post() chains rows and advances the cached balance, and refuses an overdraft', async () => {
  const store = new MemoryStore(); const at = 1_700_000_000_000;
  assert.throws(() => entry({ id: 'a', type: 'made.up', gc: 1, at }), rejected('LEDGER_ENTRY_INVALID'));
  assert.throws(() => entry({ id: 'a', type: 'shop.buy', at }), rejected('LEDGER_ENTRY_EMPTY'));
  assert.throws(() => entry({ id: 'bad id!', type: 'shop.buy', gc: -1, at }), rejected('LEDGER_ENTRY_INVALID'));
  assert.throws(() => entry({ id: 'a', type: 'shop.buy', gc: 1.5, at }), rejected('LEDGER_ENTRY_INVALID'));
  assert.deepEqual(entry({ id: 'open', type: 'migrate.opening', at }), { id: 'open', type: 'migrate.opening', gc: 0, rp: 0, ref: null, note: null, at });
  let prog = freshProgress();
  prog = await store.transaction(async (tx) => { const p1 = post(tx, 'x', prog, entry({ id: 'r1', type: 'parent.adjust', gc: 100, rp: 50, at })); const p2 = post(tx, 'x', p1, entry({ id: 'r2', type: 'shop.buy', gc: -30, at })); tx.set('x', p2); return p2; });
  assert.equal(prog.wallet.gc, 70); assert.equal(prog.wallet.rp, 50); assert.equal(prog.wallet.ledgerSeq, 2); assert.equal(prog.wallet.ledgerLast, 'r2');
  const rows = await store.list('x/ledger');
  assert.deepEqual(rows.map((r) => [r.seq, r.prev, r.balance.gc]).sort((a, b) => a[0] - b[0]), [[1, null, 100], [2, 'r1', 70]]);
  await assert.rejects(store.transaction(async (tx) => post(tx, 'x', prog, entry({ id: 'r3', type: 'shop.buy', gc: -71, at }))), rejected('INSUFFICIENT_GRID_COINS'));
  await assert.rejects(store.transaction(async (tx) => post(tx, 'x', prog, entry({ id: 'r3', type: 'reward.request', rp: -51, at }))), rejected('INSUFFICIENT_REWARD_POINTS'));
  assert.equal((await store.list('x/ledger')).length, 2); // the refused rows rolled back
});
test('derive() and reconcile() catch gaps, chain breaks, dishonest running balances and a drifted cache', () => {
  const row = (seq, id, prev, gc, bal) => ({ id, seq, prev, gc, rp: 0, balance: { gc: bal, rp: 0 } });
  const good = [row(1, 'a', null, 100, 100), row(2, 'b', 'a', -30, 70), row(3, 'c', 'b', 5, 75)];
  assert.deepEqual(derive(good).problems, []); assert.equal(derive(good).gc, 75);
  assert.ok(reconcile(good, { gc: 75, rp: 0, ledgerSeq: 3, ledgerLast: 'c' }).match);
  assert.match(reconcile(good, { gc: 80, rp: 0, ledgerSeq: 3, ledgerLast: 'c' }).problems[0], /gc: ledger 75, wallet 80/);
  assert.match(derive([good[0], good[2]]).problems[0], /seq gap/);
  assert.match(derive([good[0], { ...good[1], prev: 'zzz' }]).problems[0], /chain break/);
  assert.match(derive([good[0], { ...good[1], balance: { gc: 99, rp: 0 } }]).problems[0], /running balance/);
  assert.match(reconcile(good, { gc: 75, rp: 0, ledgerSeq: 2, ledgerLast: 'c' }).problems[0], /rows: ledger 3/);
});
test('every way money moves is one ledger row, and the ledger derives to the wallet after each', async () => {
  const f = fixture(); const k = await f.childSession('parentA', 1);
  let parent = await parentAgain(f);
  await f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'gc', amount: 2000, reason: 'ledger test funding', operationId: randomUUID() });
  await f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'rp', amount: 1500, reason: 'ledger test funding', operationId: randomUUID() });
  let { r } = await check(f, k); assert.equal(r.derived.count, 2);
  const played = await play(f, k, 'engine'); assert.equal(played.last.summary.passed, true);
  ({ r } = await check(f, k)); assert.equal(r.derived.count, 3); assert.equal(r.derived.gc, 2050); assert.equal(r.derived.rp, 1600);
  const earn = (await f.store.list(`${base(k)}/ledger`)).find((x) => x.type === 'learn.session'); assert.equal(earn.ref, played.started.session.id); assert.equal(earn.gc, 50); assert.equal(earn.rp, 100);
  const buy = await f.game.buy(k.childCtx, { itemId: 'pet_drone', operationId: randomUUID() }); assert.equal(buy.wallet.gc, 1550); await check(f, k);
  const crate = await f.game.buy(k.childCtx, { itemId: 'crate', operationId: randomUUID() }); assert.equal(crate.wallet.gc, 1250); await check(f, k);
  await f.game.setRewards(parent.ctx, { rewards: [{ id: 'movie', emoji: '🎬', name: 'Movie night', cost: 400, hidden: false, cap: 0, childIds: [k.child.id] }] });
  const red1 = await f.game.redeem(k.childCtx, { rewardId: 'movie', operationId: randomUUID() }); assert.equal(red1.wallet.rp, 1200); await check(f, k);
  const red2 = await f.game.redeem(k.childCtx, { rewardId: 'movie', operationId: randomUUID() }); assert.equal(red2.wallet.rp, 800); await check(f, k);
  await f.game.decideRedemption(parent.ctx, { childId: k.child.id, redemptionId: red1.redemption.id, decision: 'reject' });
  ({ r } = await check(f, k)); assert.equal(r.derived.rp, 1200); // refunded through a row, not by mutation
  await f.game.decideRedemption(parent.ctx, { childId: k.child.id, redemptionId: red2.redemption.id, decision: 'approve' });
  ({ r } = await check(f, k)); assert.equal(r.derived.rp, 1200); // approval moves nothing: the points left at request time
  const rocket = await f.game.rocket(parent.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 1000, minEach: 0, crewChildIds: [k.child.id] });
  await f.game.fuel(k.childCtx, { rocketId: rocket.rocket.id, amount: 250, operationId: randomUUID() });
  ({ r } = await check(f, k)); assert.equal(r.derived.gc, 1000);
  await f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'gc', amount: -100, reason: 'correction', operationId: randomUUID() });
  ({ r, prog: final } = await check(f, k)); assert.equal(r.derived.gc, 900); assert.equal(r.derived.count, final.wallet.ledgerSeq);
  const types = (await f.store.list(`${base(k)}/ledger`)).map((x) => x.type).sort();
  assert.deepEqual(types, ['learn.session', 'parent.adjust', 'parent.adjust', 'parent.adjust', 'reward.refund', 'reward.request', 'reward.request', 'rocket.fuel', 'shop.buy', 'shop.buy']);
});
var final;
test('a replayed operation writes no second row', async () => {
  const f = fixture(); const k = await f.childSession('parentA', 1); const parent = await parentAgain(f);
  const op = randomUUID();
  await f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'gc', amount: 500, reason: 'once', operationId: op });
  await f.game.adjust(parent.ctx, { childId: k.child.id, currency: 'gc', amount: 500, reason: 'once', operationId: op });
  const buyOp = randomUUID();
  await f.game.buy(k.childCtx, { itemId: 'fit_hat', operationId: buyOp }); await f.game.buy(k.childCtx, { itemId: 'fit_hat', operationId: buyOp });
  const { r } = await check(f, k); assert.equal(r.derived.count, 2); assert.equal(r.derived.gc, 350);
});
test('a streak shield bonus paid at session start goes through the ledger', async () => {
  const f = fixture(); const k = await f.childSession('parentA', 1);
  const prog = freshProgress(); prog.wallet.shields = 1; prog.passDays = ['2026-09-03', '2026-09-04']; // fixture clock: 2026-09-06 in Singapore; yesterday missed
  await f.store.put(base(k), prog);
  await f.learning.start(k.childCtx, { track: 'engine' });
  const { rows, r } = await check(f, k);
  const shield = rows.find((x) => x.type === 'streak.shield'); assert.ok(shield, 'a shield bonus row'); assert.equal(shield.gc, 50); assert.equal(shield.rp, 100); assert.equal(r.derived.gc, 50);
});
test('a migrated child opens with a ledger row, reconciles, and keeps reconciling as they play', async () => {
  const f = fixture(); const k = await f.childSession('parentA', 1);
  const record = { level: 0, paper: 6, bossCleared: 0, nav: { level: 0, paper: 1, bossCleared: 0 }, history: [
    { date: '2026-09-01', ts: Date.parse('2026-09-01T10:00:00Z'), levelIdx: 0, levelId: 'A', papers: '1–5', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, mins: '5:00' }], wallet: { gcSpent: 20, rpSpent: 0 } };
  await importLearning(f.store, { familyId: k.p.familyId, childId: k.child.id, record, actor: 'test-operator', reason: 'ledger opening test' }, f.now());
  let { rows, r } = await check(f, k);
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 'migrate.opening'); assert.equal(rows[0].gc, 30); assert.equal(rows[0].rp, 100); assert.equal(r.derived.gc, 30);
  await play(f, k, 'nav');
  ({ r } = await check(f, k)); assert.equal(r.derived.count, 2); assert.equal(r.derived.gc, 80);
});
