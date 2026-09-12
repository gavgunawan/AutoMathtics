// The System Scan's focus (email-v1): with a parent's yes, 19 of the 25 questions come from the child's weak Engine styles,
// weighted by misses, at least two each, on papers inside each style's tier band, and six are the normal mix; no weak style
// gives the normal scan. The unlock, the 25/25 rule, the double pay and the retries are the scan's own and do not move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, canonical, wrong } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { SCAN_FOCUS, focusPlan, buildScanQuestions, freshProgress, tierOf } from '../server/progress.mjs';
import { weakStyles } from '../server/styles.mjs';

const progPath = (k) => `families/${k.p.familyId}/learning/${k.child.id}`;
const sessPath = (k, id) => `${progPath(k)}/sessions/${id}`;
const eng = (l, t, s, ok) => ({ t, l, track: 'engine', s, a: 100, ok: ok ? 1 : 0 });
const times = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const row = (date, qlog) => ({ ts: 0, date, track: 'engine', mode: 'paper', level: 3, levelId: 'D', papers: '41–45', correct: 0, incorrect: 0, timeout: 0, total: qlog.length, passed: false, secs: 600, qlog });
// Sector B difficulty 2 is wrong again and again (5 misses); Sector C difficulty 3 is right but slow (6 misses); both below Sector D
const weakHistory = () => [row('2026-09-01', [...times(3, () => eng(1, 2, 40, true)), ...times(5, () => eng(1, 2, 50, false)), ...times(6, () => eng(2, 3, 90, true))])];
// with Math.random pinned (the builder's own random source) a scan's composition can be counted exactly
function pinned(value, fn) { const real = Math.random; Math.random = () => value; try { return fn(); } finally { Math.random = real; } }
const tally = (qs) => { const m = {}; for (const q of qs) { const k = `${q.level}:${q.paper}`; m[k] = (m[k] || 0) + 1; } return m; };
async function playScan(f, k, wrongAt = -1) {
  const started = await f.learning.start(k.childCtx, { track: 'engine', mode: 'scan' }), stored = await f.store.get(sessPath(k, started.session.id));
  let q = started.question, last;
  while (q) { f.advance(3_000); last = await f.learning.answer(k.childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: q.index === wrongAt ? wrong(stored.questions[q.index]) : canonical(stored.questions[q.index]) }); q = last.question || null; }
  return { stored, last };
}

test('the plan: 19 questions shared by misses with at least two each, four styles at most, the same every time', () => {
  assert.deepEqual(SCAN_FOCUS, { weak: 19, minEach: 2, recapCurrent: 2, recapEarlier: 4 });
  const plan = (misses) => focusPlan(misses.map((m, i) => ({ level: i, tier: 1, misses: m }))).map((p) => p.count);
  assert.deepEqual(plan([5, 4, 3, 8]), [5, 4, 4, 6]); assert.deepEqual(plan([3]), [19]); assert.deepEqual(plan([1, 1]), [10, 9], 'a tie goes to the weaker, listed first');
  assert.deepEqual(plan([100, 1, 1, 1]), [13, 2, 2, 2], 'never under two'); assert.deepEqual(plan([0, 0, 0]), [7, 6, 6]);
  assert.deepEqual(plan([]), []); assert.deepEqual(focusPlan(null), []);
  for (const m of [[5, 4, 3, 8], [9], [2, 30], [1, 1, 1, 1], [7, 0, 3]]) { const c = plan(m); assert.equal(c.reduce((a, b) => a + b, 0), 19, String(m)); assert.ok(c.every((x) => x >= 2), String(m)); assert.deepEqual(plan(m), c); }
  assert.equal(focusPlan(times(6, (i) => ({ level: 0, tier: (i % 5) + 1, misses: 1 }))).length, 4);
});

test('a focused scan: the 19 at each weak style\'s own sector inside its tier\'s band, then two from the sector now and four from earlier ones', () => {
  const focus = weakStyles(weakHistory(), 3);
  assert.deepEqual(focus.map((s) => [s.key, s.cls, s.misses]), [['engine:1:2', 'trouble', 5], ['engine:2:3', 'slow', 6]]);
  assert.deepEqual(focusPlan(focus).map((p) => p.count), [9, 10]);
  // the random source at its bottom, then at its top: the papers sit at each end of their bands (21–40 and 41–60)
  assert.deepEqual(pinned(0, () => tally(buildScanQuestions(3, 1, focus))), { '1:21': 9, '2:41': 10, '3:1': 2, '0:1': 4 });
  assert.deepEqual(pinned(0.9999, () => tally(buildScanQuestions(3, 1, focus))), { '1:40': 9, '2:60': 10, '3:100': 2, '2:100': 4 });
  for (let run = 0; run < 40; run++) { // and with real randomness, whatever it draws
    const qs = buildScanQuestions(3, 1, focus);
    assert.equal(qs.length, 25); assert.ok(qs.every((q) => q.track === 'engine' && q.level <= 3 && q.seconds >= 5 && q.answer));
    assert.equal(qs.filter((q) => q.level === 3).length, 2, 'two from the sector now: no weak style is in it');
    assert.ok(qs.filter((q) => q.level === 1 && tierOf(q.paper) === 2).length >= 9); assert.ok(qs.filter((q) => q.level === 2 && tierOf(q.paper) === 3).length >= 10);
  }
  const paced = pinned(0, () => buildScanQuestions(3, 1.5, focus)), plain = pinned(0, () => buildScanQuestions(3, 1, focus));
  assert.ok(paced.every((q, i) => q.seconds > plain[i].seconds), 'the child\'s pace still sets every allowance');
});

test('focus off, or nothing weak: the normal scan, ten from the sector now and fifteen from earlier ones', () => {
  const fast = weakStyles([row('2026-09-01', times(10, () => eng(1, 2, 20, true)))], 3);
  assert.deepEqual(fast, []);
  for (const focus of [null, [], fast]) assert.deepEqual(pinned(0, () => tally(buildScanQuestions(3, 1, focus))), { '3:1': 10, '0:1': 15 });
  const qs = buildScanQuestions(3); assert.equal(qs.length, 25); assert.equal(qs.filter((q) => q.level === 3).length, 10);
});

test('through the child\'s start: a parent\'s yes shapes the next scan; the unlock, the 25/25 rule, the double pay and the retries are the scan\'s own', async () => {
  const f = fixture(), k = await f.childSession();
  await f.store.put(progPath(k), { ...freshProgress(), engine: { level: 3, paper: 41, bossCleared: 2 }, scanFocus: true, history: weakHistory() });
  const first = await playScan(f, k, 3);
  assert.equal(first.stored.questions.length, 25); assert.equal(first.stored.questions.filter((q) => q.level === 3).length, 2);
  assert.ok(first.stored.questions.filter((q) => q.level === 1 && tierOf(q.paper) === 2).length >= 9); assert.ok(first.stored.questions.filter((q) => q.level === 2 && tierOf(q.paper) === 3).length >= 10);
  assert.equal(first.last.summary.passed, false); assert.equal(first.last.summary.gcEarned, 0);
  assert.equal((await f.learning.state(k.childCtx)).scan.available, true, 'a failed scan can be taken again this week');
  const second = await playScan(f, k);
  assert.equal(second.last.summary.passed, true); assert.equal(second.last.summary.gcEarned, 100); assert.equal(second.last.summary.rpEarned, 200, 'double pay, as ever');
  const st = await f.learning.state(k.childCtx); assert.equal(st.scan.doneThisWeek, true); assert.equal(st.engine.paper, 41, 'papers do not move');
  await assert.rejects(f.learning.start(k.childCtx, { track: 'engine', mode: 'scan' }), rejected('SCAN_ALREADY_DONE'));
  assert.equal((await f.store.get(progPath(k))).scanFocus, true, 'the focus stays until the parent switches it off');
  const g = fixture(), k2 = await g.childSession();
  await g.store.put(progPath(k2), { ...freshProgress(), engine: { level: 1, paper: 20, bossCleared: 0 }, scanFocus: true, history: weakHistory() });
  await assert.rejects(g.learning.start(k2.childCtx, { track: 'engine', mode: 'scan' }), rejected('SCAN_LOCKED'), 'focus does not unlock anything');
});

test('the parent\'s setting: scanFocus for a child of the family, a boolean, a recent sign-in; a pace change leaves it, and the parent view says which', async () => {
  const f = fixture(), k = await f.childSession(); f.advance(2000); const parent = await f.login('parentA');
  assert.equal((await f.game.parentState(parent.ctx)).children[0].scanFocus, false);
  assert.deepEqual(await f.game.settings(parent.ctx, { childId: k.child.id, scanFocus: true }), { timeZone: 'Asia/Singapore', childId: k.child.id, pacePercent: 100, scanFocus: true });
  assert.equal((await f.store.get(progPath(k))).scanFocus, true); assert.equal((await f.game.parentState(parent.ctx)).children[0].scanFocus, true);
  assert.deepEqual(await f.game.settings(parent.ctx, { childId: k.child.id, pacePercent: 120 }), { timeZone: 'Asia/Singapore', childId: k.child.id, pacePercent: 120, scanFocus: true });
  assert.equal((await f.store.get(progPath(k))).scanFocus, true, 'a pace change leaves the focus');
  assert.deepEqual(await f.game.settings(parent.ctx, { timeZone: 'Asia/Jakarta' }), { timeZone: 'Asia/Jakarta', childId: null, pacePercent: null, scanFocus: null });
  await assert.rejects(f.game.settings(parent.ctx, { childId: k.child.id, scanFocus: 'yes' }), rejected('INVALID_REQUEST'));
  await assert.rejects(f.game.settings(parent.ctx, { childId: k.child.id }), rejected('INVALID_PACE'), 'a child and nothing to set');
  await assert.rejects(f.game.settings(parent.ctx, { childId: randomUUID(), scanFocus: true }), rejected('INVALID_PACE'), 'not a child of this family');
  await assert.rejects(f.game.settings(parent.ctx, { childId: k.child.id, scanFocus: false, pacePercent: 5 }), rejected('INVALID_PACE'));
  assert.equal((await f.store.get(progPath(k))).scanFocus, true);
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'game.settings' && x.childId === k.child.id));
  await assert.rejects(f.game.settings(k.childCtx, { childId: k.child.id, scanFocus: false }), rejected('PARENT_REQUIRED'));
  f.advance(5 * 60_000 + 1000); await assert.rejects(f.game.settings(parent.ctx, { childId: k.child.id, scanFocus: false }), rejected('REAUTHENTICATE'));
  assert.equal((await f.store.get(progPath(k))).scanFocus, true);
});

test('UI: Game & progress shows each child\'s scan focus and switches it, with a recent sign-in', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  const focus = async () => (await h.f.store.get(`families/${h.a.familyId}/learning/${kid.id}`))?.scanFocus;
  await h.click('Game & progress'); assert.ok(h.root.textContent.includes('System Scan: the normal mix'));
  await h.click('Focus System Scan on weak spots');
  assert.equal(await focus(), true); assert.ok(h.root.textContent.includes('System Scan focus is on: about 75%'), 'the screen shows what the server now holds');
  h.f.advance(301_000); await h.click('Switch scan focus off');
  assert.ok(h.root.textContent.includes('PARENT VERIFICATION')); assert.equal(await focus(), true, 'not without a fresh sign-in');
});
