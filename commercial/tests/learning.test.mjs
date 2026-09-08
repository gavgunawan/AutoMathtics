// The learning engine behind the child session: server-generated questions, strict grading,
// idempotent answers, progress and coins written in the same transaction, and every call
// re-authorized through Foundation.authorize.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, canonical, wrong } from './support.mjs';
import { grantEntitlement } from '../server/service.mjs';
import { freshProgress } from '../server/progress.mjs';

const sessPath = (k, id) => `families/${k.p.familyId}/learning/${k.child.id}/sessions/${id}`;
const progPath = (k) => `families/${k.p.familyId}/learning/${k.child.id}`;
async function play(f, k, track, { wrongAt = -1, timeoutAt = -1 } = {}) {
  const started = await f.learning.start(k.childCtx, { track });
  const stored = await f.store.get(sessPath(k, started.session.id));
  let q = started.question, last;
  while (q) {
    const real = stored.questions[q.index];
    if (q.index === timeoutAt) f.advance(real.seconds * 1000 + 6_000);
    else f.advance(3_000);
    last = await f.learning.answer(k.childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: q.index === wrongAt ? wrong(real) : canonical(real) });
    q = last.question || null;
  }
  return { started, last, stored };
}

test('a session hands the browser questions without answers, and keeps the answers server-side', async () => {
  const f = fixture(); const k = await f.childSession();
  const r = await f.learning.start(k.childCtx, { track: 'engine' });
  assert.equal(r.session.count, 25); assert.equal(r.session.mode, 'paper'); assert.equal(r.session.levelId, 'A'); assert.equal(r.question.index, 0);
  assert.ok(!('answer' in r.question) && !JSON.stringify(r).includes('"answer"'));
  const stored = await f.store.get(sessPath(k, r.session.id));
  assert.equal(stored.questions.length, 25); assert.ok(stored.questions.every((q) => q.answer));
  const state = await f.learning.state(k.childCtx);
  assert.equal(state.active.session.id, r.session.id); assert.equal(state.engine.paper, 1); assert.deepEqual(state.wallet, { gc: 0, rp: 0, bonuses: 0 });
});
test('a clean sheet passes: five papers on, ⚡50 🏆100, a history row, no active session', async () => {
  const f = fixture(); const k = await f.childSession();
  const { last } = await play(f, k, 'engine');
  assert.equal(last.done, true); assert.equal(last.summary.passed, true); assert.equal(last.summary.gcEarned, 50); assert.equal(last.summary.rpEarned, 100);
  const st = await f.learning.state(k.childCtx);
  assert.equal(st.engine.paper, 6); assert.deepEqual(st.wallet, { gc: 50, rp: 100, bonuses: 0 }); assert.equal(st.active, null);
  assert.equal(st.history[0].passed, true); assert.equal(st.history[0].papers, '1–5'); assert.equal(st.stats.passes, 1);
  const nav = await play(f, k, 'nav'); // the other track has its own sector and papers
  assert.equal(nav.started.session.count, 15); assert.equal(nav.last.summary.passed, true);
  const st2 = await f.learning.state(k.childCtx); assert.equal(st2.nav.paper, 6); assert.equal(st2.engine.paper, 6); assert.equal(st2.wallet.gc, 100);
});
test('one wrong answer fails the session: no paper, no coins, but the row is kept', async () => {
  const f = fixture(); const k = await f.childSession();
  const { last } = await play(f, k, 'engine', { wrongAt: 7 });
  assert.equal(last.summary.passed, false); assert.equal(last.summary.correct, 24); assert.equal(last.summary.incorrect, 1); assert.equal(last.summary.gcEarned, 0);
  const st = await f.learning.state(k.childCtx);
  assert.equal(st.engine.paper, 1); assert.equal(st.wallet.gc, 0); assert.equal(st.history[0].passed, false); assert.equal(st.stats.sessions, 1);
});
test('an answer past the per-question clock is a timeout, and fails the session', async () => {
  const f = fixture(); const k = await f.childSession();
  const { last } = await play(f, k, 'nav', { timeoutAt: 2 });
  assert.equal(last.summary.timeout, 1); assert.equal(last.summary.passed, false);
});
test('answers are idempotent per attempt, ordered per question, and malformed input costs nothing', async () => {
  const f = fixture(); const k = await f.childSession();
  const r = await f.learning.start(k.childCtx, { track: 'engine' });
  const stored = await f.store.get(sessPath(k, r.session.id));
  const id = r.session.id, attempt = randomUUID();
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: id, index: 0, attemptId: randomUUID(), answer: '12abc' }), rejected('INVALID_ANSWER'));
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: id, index: 0, attemptId: randomUUID(), answer: 12 }), rejected('INVALID_ANSWER'));
  assert.equal((await f.store.get(sessPath(k, id))).index, 0);
  const first = await f.learning.answer(k.childCtx, { sessionId: id, index: 0, attemptId: attempt, answer: canonical(stored.questions[0]) });
  assert.equal(first.correct, true); assert.equal(first.question.index, 1);
  const replay = await f.learning.answer(k.childCtx, { sessionId: id, index: 0, attemptId: attempt, answer: wrong(stored.questions[0]) });
  assert.deepEqual(replay, first); // same attempt → same response, the wrong answer in the retry is ignored
  assert.equal((await f.store.get(sessPath(k, id))).results.length, 1);
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: id, index: 0, attemptId: randomUUID(), answer: canonical(stored.questions[0]) }), rejected('STALE_QUESTION'));
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: id, index: 5, attemptId: randomUUID(), answer: canonical(stored.questions[5]) }), rejected('STALE_QUESTION'));
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: randomUUID(), index: 1, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_NOT_FOUND'));
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: id, index: 1, attemptId: randomUUID(), answer: '1', extra: true }), rejected('INVALID_REQUEST'));
});
test('starting again resumes the open session; after two hours it is retired and a new one opens', async () => {
  const f = fixture(); const k = await f.childSession();
  const a = await f.learning.start(k.childCtx, { track: 'engine' });
  const b = await f.learning.start(k.childCtx, { track: 'nav' }); // the track asked for does not matter while one is open
  assert.equal(b.session.id, a.session.id); assert.equal(b.resumed, true);
  f.advance(2 * 60 * 60_000 + 1);
  await grantEntitlement(f.store, { familyId: k.p.familyId, seatLimit: 1, accessUntil: f.now() + 60 * 60_000, reason: 'extend for test', actor: 'test-operator' }, f.now());
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: a.session.id, index: 0, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_EXPIRED'));
  const c = await f.learning.start(k.childCtx, { track: 'engine' });
  assert.notEqual(c.session.id, a.session.id); assert.equal(c.resumed, false);
  assert.equal((await f.store.get(sessPath(k, a.session.id))).status, 'expired');
});
test('quitting closes the session, records a quit row, and frees the child to start again', async () => {
  const f = fixture(); const k = await f.childSession();
  const a = await f.learning.start(k.childCtx, { track: 'engine' });
  assert.deepEqual(await f.learning.quit(k.childCtx, { sessionId: a.session.id }), { ok: true, status: 'quit' });
  const st = await f.learning.state(k.childCtx);
  assert.equal(st.active, null); assert.equal(st.history[0].quit, true); assert.equal(st.history[0].atQ, 0);
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: a.session.id, index: 0, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_OVER'));
  assert.notEqual((await f.learning.start(k.childCtx, { track: 'engine' })).session.id, a.session.id);
});
test('at paper 21 the check point is due: 25 tier-1 questions, ×2 loot, and a crown', async () => {
  const f = fixture(); const k = await f.childSession();
  await f.store.put(progPath(k), { ...freshProgress(), engine: { level: 0, paper: 21, bossCleared: 0 } });
  const { started, last, stored } = await play(f, k, 'engine');
  assert.equal(started.session.mode, 'boss'); assert.equal(started.session.tierEnd, 20); assert.equal(started.session.count, 25);
  assert.ok(stored.questions.every((q) => q.paper >= 1 && q.paper <= 20));
  assert.equal(last.summary.passed, true); assert.equal(last.summary.gcEarned, 100); assert.equal(last.summary.rpEarned, 200);
  const st = await f.learning.state(k.childCtx);
  assert.equal(st.engine.bossCleared, 1); assert.equal(st.engine.paper, 21); assert.equal(st.engine.next.mode, 'paper'); assert.equal(st.history[0].papers, 'CP T1');
});
test('a finished sector is practice until the other track catches up, then both jump', async () => {
  const f = fixture(); const k = await f.childSession();
  await f.store.put(progPath(k), { ...freshProgress(), engine: { level: 0, paper: 101, bossCleared: 5 }, nav: { level: 0, paper: 96, bossCleared: 5 } });
  const practice = await play(f, k, 'engine');
  assert.equal(practice.started.session.mode, 'practice'); assert.equal(practice.last.summary.gcEarned, 50); // practice still pays
  let st = await f.learning.state(k.childCtx); assert.equal(st.engine.paper, 101); assert.equal(st.engine.level, 0);
  const finish = await play(f, k, 'nav');
  assert.equal(finish.last.summary.passed, true); assert.deepEqual(finish.last.summary.jumped.sort(), ['engine', 'nav']); assert.equal(finish.last.summary.newLevelId, 'B');
  st = await f.learning.state(k.childCtx);
  assert.deepEqual(st.engine, { ...st.engine, level: 1, paper: 1, bossCleared: 0 }); assert.equal(st.nav.levelId, 'B');
});
test('streak bonuses arrive with the third consecutive pass-day, once', () => {
  const f = fixture();
  const sess = (day) => ({ id: randomUUID(), track: 'engine', mode: 'paper', level: 0, startPaper: 1, tierEnd: null, createdAt: Date.parse(day) - 60_000,
    questions: Array.from({ length: 25 }, () => ({ paper: 1, tier: 1, seconds: 25, display: {}, answer: { type: 'int', v: 1 } })), results: Array.from({ length: 25 }, () => ({ r: 'correct', secs: 3, tier: 1 })) });
  let prog = freshProgress();
  for (const day of ['2026-09-01T10:00:00Z', '2026-09-02T10:00:00Z']) prog = f.learning.finish(prog, sess(day), Date.parse(day), 'Asia/Singapore').progress;
  assert.deepEqual(prog.wallet, { gc: 100, rp: 200, bonuses: 0 });
  const third = f.learning.finish(prog, sess('2026-09-03T10:00:00Z'), Date.parse('2026-09-03T10:00:00Z'), 'Asia/Singapore');
  assert.equal(third.summary.gcEarned, 100); assert.deepEqual(third.progress.wallet, { gc: 200, rp: 400, bonuses: 1 });
  const again = f.learning.finish(third.progress, sess('2026-09-03T12:00:00Z'), Date.parse('2026-09-03T12:00:00Z'), 'Asia/Singapore');
  assert.equal(again.summary.gcEarned, 50); assert.equal(again.progress.wallet.bonuses, 1); // same day, no second bonus
});
test('only a live child may learn: parents, selectors, revoked children and lapsed families are refused', async () => {
  const f = fixture(); const k = await f.childSession();
  f.advance(2000); const parent = await f.login('parentA'); // k.p.ctx was rotated away by the handover
  await assert.rejects(f.learning.start(parent.ctx, { track: 'engine' }), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.learning.start(k.selCtx, { track: 'engine' }), rejected('SIGN_IN_REQUIRED')); // the selector cookie was replaced by the child's
  const open = await f.learning.start(k.childCtx, { track: 'engine' });
  f.advance(2000); const p2 = await f.login('parentA'); await f.service.resetPin(p2.ctx, k.child.id, '111111');
  await assert.rejects(f.learning.answer(k.childCtx, { sessionId: open.session.id, index: 0, attemptId: randomUUID(), answer: '1' }), rejected('CHILD_SESSION_REVOKED'));
  await assert.rejects(f.learning.state(k.childCtx), rejected('CHILD_SESSION_REVOKED'));
  const g = fixture(); const k2 = await g.childSession();
  g.advance(16 * 60_000); // the fixture's entitlement lasts 15 minutes
  await assert.rejects(g.learning.start(k2.childCtx, { track: 'nav' }), rejected('SUBSCRIPTION_INACTIVE'));
});
test('a child cannot reach another family\'s session, even with its id', async () => {
  const f = fixture(); const a = await f.childSession('parentA'); const b = await f.childSession('parentB');
  const open = await f.learning.start(a.childCtx, { track: 'engine' });
  await assert.rejects(f.learning.answer(b.childCtx, { sessionId: open.session.id, index: 0, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_NOT_FOUND'));
  await assert.rejects(f.learning.quit(b.childCtx, { sessionId: open.session.id }), rejected('SESSION_NOT_FOUND'));
  assert.equal((await f.learning.state(a.childCtx)).active.session.id, open.session.id);
});
