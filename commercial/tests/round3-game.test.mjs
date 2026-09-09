// Stage 4 review, third round — the grid: a pending reward request is never dropped and never piles up without limit;
// a placement test left unfinished may be retaken once and is then graded as it stands; a change of starting point
// keeps the parent's pace and refuses once the child has quit a session; the v2 import refuses play, not a document;
// the family export reads its own audit rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, rejected } from './support.mjs';
import { importLearning } from '../server/migrate.mjs';

const op = () => ({ operationId: randomUUID() }), HOUR = 3_600_000;
const V2 = { level: 0, paper: 6, bossCleared: 0, nav: { level: 0, paper: 1, bossCleared: 0 }, history: [{ date: '2026-09-01', ts: Date.parse('2026-09-01T10:00:00Z'), levelIdx: 0, levelId: 'A', papers: '1–5', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, mins: '5:00' }], wallet: { gcSpent: 20, rpSpent: 0 } };
async function childOf(f, p, body) {
  const { child } = await f.service.createChild(p.ctx, { nickname: 'Nova', icon: 'fox', pin: '763829', ...body }, randomUUID());
  const selCtx = await f.service.authenticate(await f.service.lock(p.ctx)), ctx = await f.service.authenticate(await f.service.selectChild(selCtx, child.id, '763829'));
  return { child, ctx };
}

test('a pending reward request is never dropped: twenty stay in view of the parent, the twenty-first waits for a decision, a rejection refunds the oldest, and only decided rows are trimmed', async () => {
  const f = fixture(), { p: fam, child, childCtx } = await f.childSession('parentA', 1), doc = () => f.store.get(`families/${fam.familyId}/learning/${child.id}`);
  f.advance(2000); const p = { ...(await f.login('parentA')), familyId: fam.familyId }; // the handover ended the parent's session: a fresh one, minted after it
  await f.game.setRewards(p.ctx, { rewards: [{ id: 'rw-1', emoji: '🎁', name: 'Sticker', cost: 1, hidden: false, cap: 0, childIds: [child.id] }] });
  await f.game.adjust(p.ctx, { childId: child.id, currency: 'rp', amount: 300, reason: 'test points', ...op() });
  const ids = []; for (let i = 0; i < 20; i++) ids.push((await f.game.redeem(childCtx, { rewardId: 'rw-1', ...op() })).redemption.id);
  await assert.rejects(f.game.redeem(childCtx, { rewardId: 'rw-1', ...op() }), rejected('REWARD_PENDING_LIMIT'));
  let row = (await f.game.parentState(p.ctx)).children.find((c) => c.child.id === child.id);
  assert.equal(row.wallet.redemptions.filter((r) => r.status === 'pending').length, 20, 'every pending request reaches the parent'); assert.equal(row.wallet.rp, 280);
  await f.game.decideRedemption(p.ctx, { childId: child.id, redemptionId: ids[0], decision: 'reject' });
  assert.equal((await f.game.state(childCtx)).wallet.rp, 281, 'the oldest request, refunded'); assert.equal((await f.game.redeem(childCtx, { rewardId: 'rw-1', ...op() })).redemption.status, 'pending', 'room again');
  row = (await f.game.parentState(p.ctx)).children.find((c) => c.child.id === child.id);
  for (const r of row.wallet.redemptions.filter((x) => x.status === 'pending')) await f.game.decideRedemption(p.ctx, { childId: child.id, redemptionId: r.id, decision: 'approve' });
  for (let i = 0; i < 60; i++) { const r = await f.game.redeem(childCtx, { rewardId: 'rw-1', ...op() }); await f.game.decideRedemption(p.ctx, { childId: child.id, redemptionId: r.redemption.id, decision: 'approve' }); }
  for (let i = 0; i < 20; i++) await f.game.redeem(childCtx, { rewardId: 'rw-1', ...op() });
  const final = (await doc()).wallet.redemptions;
  assert.equal(final.filter((r) => r.status === 'pending').length, 20, 'twenty pending, all kept'); assert.equal(final.filter((r) => r.status !== 'pending').length, 50, 'the newest fifty decided rows');
  row = (await f.game.parentState(p.ctx)).children.find((c) => c.child.id === child.id); assert.equal(row.wallet.redemptions.filter((r) => r.status === 'pending').length, 20);
  assert.equal(row.wallet.rp, 200, '300 given, 100 asked, one refunded, none lost');
});
test('a placement test left unfinished may be retaken once; left unfinished again it is graded as it stands, every unanswered question counted wrong', async () => {
  const f = fixture(), p = await f.family('parentA', 1), { child, ctx } = await childOf(f, p, { age: 8, yearLevel: 3, start: 'test' }), doc = () => f.store.get(`families/${p.familyId}/learning/${child.id}`);
  const s1 = await f.learning.start(ctx, { track: 'engine', mode: 'placement' }); assert.equal(s1.session.mode, 'placement');
  await f.learning.answer(ctx, { sessionId: s1.session.id, index: 0, attemptId: randomUUID(), answer: '999999' });
  const q1 = await f.learning.quit(ctx, { sessionId: s1.session.id }); assert.equal(q1.attempts, 1); assert.equal(q1.placement, null, 'the first time: a retake');
  let d = await doc(); assert.equal(d.placement.status, 'pending'); assert.equal(d.placement.attempts, 1); assert.equal(d.history[0].quit, true); assert.equal(d.stats.sessions, 0);
  // the retake, abandoned past its two hours: settled the moment the child comes back for a test
  const s2 = await f.learning.start(ctx, { track: 'engine', mode: 'placement' }); assert.notEqual(s2.session.id, s1.session.id);
  await f.store.transaction(async (tx) => { const fam = await tx.get(`families/${p.familyId}`); tx.set(`families/${p.familyId}`, { ...fam, entitlement: { ...fam.entitlement, accessUntil: f.now() + 24 * HOUR } }); }); // the pilot grant outlives the test's clock
  f.advance(3 * HOUR);
  const back = await f.learning.start(ctx, { track: 'engine', mode: 'placement' });
  assert.equal(back.settled, true); assert.equal(back.summary.correct, 0); assert.equal(back.summary.total, 25); assert.equal(back.summary.placement.engine.levelId, 'B', 'nothing shown: a sector back, from the start');
  d = await doc(); assert.equal(d.placement.status, 'done'); assert.equal(d.placement.attempts, 2); assert.equal(d.activeSession, null); assert.equal(d.history.filter((h) => h.quit).length, 2); assert.equal(d.stats.sessions, 1);
  assert.equal((await f.store.get(`families/${p.familyId}/learning/${child.id}/sessions/${s2.session.id}`)).status, 'expired');
  await assert.rejects(f.learning.start(ctx, { track: 'engine', mode: 'placement' }), rejected('PLACEMENT_NOT_PENDING'));
  const st = await f.learning.state(ctx); assert.equal(st.engine.levelId, 'B'); assert.equal(st.engine.paper, 1); assert.equal(st.placement.status, 'done');
  // a quit on the second attempt settles too
  const g = fixture(), q = await g.family('parentA', 1), k = await childOf(g, q, { age: 8, yearLevel: 2, start: 'test' });
  const t1 = await g.learning.start(k.ctx, { track: 'engine', mode: 'placement' }); await g.learning.quit(k.ctx, { sessionId: t1.session.id });
  const t2 = await g.learning.start(k.ctx, { track: 'engine', mode: 'placement' }); const q2 = await g.learning.quit(k.ctx, { sessionId: t2.session.id });
  assert.equal(q2.attempts, 2); assert.equal(q2.placement.engine.levelId, 'A'); assert.equal((await g.store.get(`families/${q.familyId}/learning/${k.child.id}`)).placement.status, 'done');
});
test('a change of starting point keeps the pace the parent set, and is refused once the child has quit a session', async () => {
  const f = fixture(), p = await f.family('parentA', 1), { child, ctx } = await childOf(f, p, { age: 8, yearLevel: 3, start: 'year' });
  f.advance(2000); const parent = await f.login('parentA');
  await f.game.settings(parent.ctx, { childId: child.id, pacePercent: 50 });
  await f.service.setChildStart(parent.ctx, child.id, { start: 'a1', yearLevel: 3 });
  const d = await f.store.get(`families/${p.familyId}/learning/${child.id}`); assert.equal(d.pacePercent, 50, 'the pace stays'); assert.equal(d.engine.level, 0); assert.equal(d.engine.paper, 1);
  const s = await f.learning.start(ctx, { track: 'engine' }); await f.learning.quit(ctx, { sessionId: s.session.id });
  f.advance(2000); const again = await f.login('parentA'); await assert.rejects(f.service.setChildStart(again.ctx, child.id, { start: 'year', yearLevel: 3 }), rejected('ALREADY_STARTED'), 'a quit session is play');
});
test('the v2 import refuses play, not a document: a child created with a year level (a pending test) and a pace imports; the import is progress; a child who played does not import', async () => {
  const f = fixture(), p = await f.family('parentA', 2);
  const { child } = await f.service.createChild(p.ctx, { nickname: 'Allison', icon: 'fox', pin: '763829', age: 8, yearLevel: 3, start: 'test' }, randomUUID());
  await f.game.settings(p.ctx, { childId: child.id, pacePercent: 70 });
  const before = await f.store.get(`families/${p.familyId}/learning/${child.id}`); assert.equal(before.placement.status, 'pending', 'the document exists before any play');
  await importLearning(f.store, { familyId: p.familyId, childId: child.id, record: V2, actor: 'test-operator', reason: 'pilot cutover' }, f.now());
  const d = await f.store.get(`families/${p.familyId}/learning/${child.id}`);
  assert.equal(d.pacePercent, 70, 'the pace the parent set stays'); assert.equal(d.placement.status, 'done', 'no test pending: the v2 record places the child'); assert.equal(d.engine.paper, 6); assert.equal(d.wallet.gc, 30);
  await assert.rejects(importLearning(f.store, { familyId: p.familyId, childId: child.id, record: V2, actor: 'test-operator', reason: 'again' }, f.now()), rejected('ALREADY_HAS_PROGRESS'), 'an import is progress');
  const k = await f.childSession('parentB', 1), s = await f.learning.start(k.childCtx, { track: 'engine' }); await f.learning.quit(k.childCtx, { sessionId: s.session.id });
  await assert.rejects(importLearning(f.store, { familyId: k.p.familyId, childId: k.child.id, record: V2, actor: 'test-operator', reason: 'played' }, f.now()), rejected('ALREADY_HAS_PROGRESS'));
});
test('the family export reads its own audit rows only', async () => {
  const src = await readFile(new URL('../server/support.mjs', import.meta.url), 'utf8');
  assert.ok(!/list\('audit'\)/.test(src), 'no scan of the whole audit collection'); assert.match(src, /query\('audit', 'familyId'/);
  const f = fixture(), a = await f.family('parentA', 1); await f.family('parentB', 1);
  const reads = []; const real = f.store.transaction.bind(f.store);
  f.store.transaction = (fn, opts) => real(async (tx) => { const q = tx.query.bind(tx); tx.query = (c, field, value, limit) => { reads.push([c, field, value]); return q(c, field, value, limit); }; return fn(tx); }, opts);
  const exp = await f.support.exportFamily(a.ctx);
  assert.ok(exp.audit.length > 0); assert.ok(reads.some(([c, field, value]) => c === 'audit' && field === 'familyId' && value === a.familyId), 'queried by family id');
});
