// Stage 3.1 — the ledger is the source of truth: every way money moves is one immutable row,
// and the wallet's cached balance always re-derives from the rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore, fixture, rejected, canonical } from './support.mjs';
import { entry, post, derive, reconcile, bootstrap, repair, OPENING_ROW_ID } from '../server/ledger.mjs';
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
  // one row per transaction: post() reads the row's slot before it writes, and the store contract forbids reads after writes
  prog = await store.transaction(async (tx) => { const p1 = await post(tx, 'x', prog, entry({ id: 'r1', type: 'parent.adjust', gc: 100, rp: 50, at })); tx.set('x', p1); return p1; });
  prog = await store.transaction(async (tx) => { const p2 = await post(tx, 'x', prog, entry({ id: 'r2', type: 'shop.buy', gc: -30, at })); tx.set('x', p2); return p2; });
  assert.equal(prog.wallet.gc, 70); assert.equal(prog.wallet.rp, 50); assert.equal(prog.wallet.ledgerSeq, 2); assert.equal(prog.wallet.ledgerLast, 'r2');
  const rows = await store.list('x/ledger');
  assert.deepEqual(rows.map((r) => [r.seq, r.prev, r.balance.gc]).sort((a, b) => a[0] - b[0]), [[1, null, 100], [2, 'r1', 70]]);
  await assert.rejects(store.transaction(async (tx) => post(tx, 'x', prog, entry({ id: 'r3', type: 'shop.buy', gc: -71, at }))), rejected('INSUFFICIENT_GRID_COINS'));
  await assert.rejects(store.transaction(async (tx) => post(tx, 'x', prog, entry({ id: 'r3', type: 'reward.request', rp: -51, at }))), rejected('INSUFFICIENT_REWARD_POINTS'));
  assert.equal((await store.list('x/ledger')).length, 2); // the refused rows rolled back
});
test('3.1-C: a ledger row is never overwritten — same id and content is a replay, same id and different content is a conflict', async () => {
  const store = new MemoryStore(); const at = 1_700_000_000_000;
  let prog = freshProgress();
  prog = await store.transaction(async (tx) => { const p = await post(tx, 'x', prog, entry({ id: 'op1', type: 'parent.adjust', gc: 100, at })); tx.set('x', p); return p; });
  const replay = await store.transaction(async (tx) => post(tx, 'x', await tx.get('x'), entry({ id: 'op1', type: 'parent.adjust', gc: 100, at })));
  assert.equal(replay.wallet.gc, 100); assert.equal(replay.wallet.ledgerSeq, 1); // nothing moved twice
  await assert.rejects(store.transaction(async (tx) => post(tx, 'x', await tx.get('x'), entry({ id: 'op1', type: 'parent.adjust', gc: 999, at }))), rejected('LEDGER_CONFLICT'));
  await assert.rejects(store.transaction(async (tx) => post(tx, 'x', await tx.get('x'), entry({ id: 'op1', type: 'shop.buy', gc: -100, at }))), rejected('LEDGER_CONFLICT'));
  const rows = await store.list('x/ledger'); assert.equal(rows.length, 1); assert.equal(rows[0].gc, 100); // the original row survived untouched
});
test('3.1-A: a non-zero wallet with no rows cannot move money until it gets exactly one opening row; bootstrap is idempotent', async () => {
  const store = new MemoryStore(); const at = 1_700_000_000_000;
  const preLedger = { ...freshProgress(), wallet: { ...freshProgress().wallet, gc: 500, rp: 300 } }; // written before Stage 3.1 existed
  await store.put('x', preLedger);
  await assert.rejects(store.transaction(async (tx) => post(tx, 'x', await tx.get('x'), entry({ id: 'buy', type: 'shop.buy', gc: -100, at }))), rejected('LEDGER_NOT_BOOTSTRAPPED'));
  assert.equal((await store.list('x/ledger')).length, 0);
  const first = await store.transaction(async (tx) => { const r = await bootstrap(tx, 'x', await tx.get('x'), at); if (r.opened) tx.set('x', r.prog); return r; });
  assert.equal(first.opened, true); assert.equal(first.prog.wallet.gc, 500); assert.equal(first.prog.wallet.ledgerSeq, 1); assert.equal(first.prog.wallet.ledgerLast, OPENING_ROW_ID);
  const second = await store.transaction(async (tx) => bootstrap(tx, 'x', await tx.get('x'), at + 1)); assert.equal(second.opened, false);
  const rows = await store.list('x/ledger'); assert.equal(rows.length, 1); assert.equal(rows[0].type, 'ledger.opening'); assert.equal(rows[0].gc, 500); assert.equal(rows[0].rp, 300);
  assert.ok(reconcile(rows, (await store.get('x')).wallet).match);
  const after = await store.transaction(async (tx) => { const p = await post(tx, 'x', await tx.get('x'), entry({ id: 'buy', type: 'shop.buy', gc: -100, at })); tx.set('x', p); return p; });
  assert.equal(after.wallet.gc, 400); assert.ok(reconcile(await store.list('x/ledger'), after.wallet).match);
  const fresh = await store.transaction(async (tx) => bootstrap(tx, 'y', freshProgress(), at)); assert.equal(fresh.opened, false); // nothing to carry, nothing written
});
test('3.1-B: repair fixes a drifted cache from a valid ledger inside one transaction, and refuses a damaged ledger', async () => {
  const store = new MemoryStore(); const at = 1_700_000_000_000;
  let prog = freshProgress();
  prog = await store.transaction(async (tx) => { const p = await post(tx, 'x', prog, entry({ id: 'a', type: 'parent.adjust', gc: 100, at })); tx.set('x', p); return p; });
  prog = await store.transaction(async (tx) => { const p = await post(tx, 'x', prog, entry({ id: 'b', type: 'shop.buy', gc: -30, at })); tx.set('x', p); return p; });
  assert.deepEqual((await store.transaction(async (tx) => repair(tx, 'x'))).repaired, false);
  await store.put('x', { ...prog, wallet: { ...prog.wallet, gc: 999 } }); // the cache drifts
  const fixed = await store.transaction(async (tx) => repair(tx, 'x'));
  assert.equal(fixed.repaired, true); assert.equal((await store.get('x')).wallet.gc, 70);
  // a stale external derivation must not win: a legitimate post lands, then repair runs from live state
  await store.transaction(async (tx) => { const p = await post(tx, 'x', await tx.get('x'), entry({ id: 'c', type: 'parent.adjust', gc: 5, at })); tx.set('x', p); });
  await store.put('x', { ...(await store.get('x')), wallet: { ...(await store.get('x')).wallet, gc: 1 } });
  assert.equal((await store.transaction(async (tx) => repair(tx, 'x'))).derived.gc, 75); assert.equal((await store.get('x')).wallet.gc, 75);
  // damage the chain: repair stops, nothing is written
  const rowB = await store.get('x/ledger/b'); await store.put('x/ledger/b', { ...rowB, prev: 'zzz' });
  await store.put('x', { ...(await store.get('x')), wallet: { ...(await store.get('x')).wallet, gc: 1 } });
  await assert.rejects(store.transaction(async (tx) => repair(tx, 'x')), rejected('LEDGER_DAMAGED'));
  assert.equal((await store.get('x')).wallet.gc, 1);
  await assert.rejects(store.transaction(async (tx) => repair(tx, 'nope')), rejected('CHILD_NOT_FOUND'));
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
