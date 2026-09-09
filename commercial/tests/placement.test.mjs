// Onboarding (v3.1): age and year level are recorded on the profile; a child starts with the timed
// placement test (recommended), at the year's sector, or from A1; the test places each track from
// accuracy and time, pays nothing, and comes before anything else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, canonical, wrong } from './support.mjs';
import { grantEntitlement } from '../server/service.mjs';
import { placeTrack, placementFromResults, initialProgress, buildPlacementQuestions, yearToLevel, PLACEMENT, LEVELS } from '../server/progress.mjs';

const progPath = (k) => `families/${k.p.familyId}/learning/${k.child.id}`;
// a 25-question test at a slow pace runs past the fixture's 15-minute pilot grant: give these families room to finish
const roomToWork = (f, familyId) => grantEntitlement(f.store, { familyId, seatLimit: 2, accessUntil: f.now() + 3 * 3_600_000, reason: 'placement bench', actor: 'test-operator' }, f.now());
const parentAgain = async (f) => { f.advance(2000); return f.login('parentA'); };
const create = (f, ctx, extra) => f.service.createChild(ctx, { nickname: 'Kid', icon: 'fox', pin: '763829', ...extra }, randomUUID());
async function enter(f, p, childId) { const sel = await f.service.authenticate(await f.service.lock(p.ctx)); return f.service.authenticate(await f.service.selectChild(sel, childId, '763829')); }
// run a placement test: `right` = fraction of questions answered correctly (per track), `speed` = share of the allowance used
async function takeTest(f, k, { right = 1, speed = 0.3 } = {}) {
  const started = await f.learning.start(k.childCtx, { track: 'engine', mode: 'placement' });
  const stored = await f.store.get(`${progPath(k)}/sessions/${started.session.id}`);
  const perTrack = { engine: 0, nav: 0 }; let q = started.question, last;
  while (q) {
    const real = stored.questions[q.index]; const t = real.track; const n = perTrack[t]++;
    const totalOf = t === 'engine' ? PLACEMENT.engineQuestions : PLACEMENT.navQuestions;
    f.advance(Math.round(real.seconds * speed * 1000));
    last = await f.learning.answer(k.childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: n < Math.round(totalOf * right) ? canonical(real) : wrong(real) });
    q = last.question || null;
  }
  return { started, last, stored };
}

test('the matrix: where a track starts from accuracy and time, tested at the middle of the year\'s sector', () => {
  const at = (correct, total, timeRatio, level = 1) => placeTrack({ correct, total, timeRatio }, level);
  assert.deepEqual(at(10, 10, 0.5), { band: 'ahead', level: 2, paper: 1, bossCleared: 0, accuracy: 100, timeRatio: 0.5 });
  assert.deepEqual(at(9, 10, 0.6), { band: 'ahead', level: 2, paper: 1, bossCleared: 0, accuracy: 90, timeRatio: 0.6 });
  assert.deepEqual(at(10, 10, 0.61), { band: 'on-level', level: 1, paper: 41, bossCleared: 2, accuracy: 100, timeRatio: 0.61 });
  assert.deepEqual(at(9, 10, 0.95), { band: 'on-level', level: 1, paper: 41, bossCleared: 2, accuracy: 90, timeRatio: 0.95 });
  assert.deepEqual(at(8, 10, 0.3), { band: 'building', level: 1, paper: 21, bossCleared: 1, accuracy: 80, timeRatio: 0.3 });
  assert.deepEqual(at(7, 10, 0.3), { band: 'building', level: 1, paper: 21, bossCleared: 1, accuracy: 70, timeRatio: 0.3 });
  assert.deepEqual(at(6, 10, 0.3), { band: 'foundations', level: 1, paper: 1, bossCleared: 0, accuracy: 60, timeRatio: 0.3 });
  assert.deepEqual(at(5, 10, 0.3), { band: 'foundations', level: 1, paper: 1, bossCleared: 0, accuracy: 50, timeRatio: 0.3 });
  assert.deepEqual(at(4, 10, 0.3), { band: 'previous', level: 0, paper: 41, bossCleared: 2, accuracy: 40, timeRatio: 0.3 });
  assert.deepEqual(at(3, 10, 0.3), { band: 'previous', level: 0, paper: 41, bossCleared: 2, accuracy: 30, timeRatio: 0.3 });
  assert.deepEqual(at(2, 10, 0.3), { band: 'previous-start', level: 0, paper: 1, bossCleared: 0, accuracy: 20, timeRatio: 0.3 });
  assert.deepEqual(at(2, 10, 0.3, 0), { band: 'previous-start', level: 0, paper: 1, bossCleared: 0, accuracy: 20, timeRatio: 0.3 }, 'Year 1 cannot go below A1');
  assert.deepEqual(at(4, 10, 0.3, 0), { band: 'previous', level: 0, paper: 1, bossCleared: 0, accuracy: 40, timeRatio: 0.3 });
  assert.deepEqual(at(10, 10, 0.4, 5), { band: 'ahead', level: 5, paper: 61, bossCleared: 3, accuracy: 100, timeRatio: 0.4 }, 'Year 6 ahead: later in F, there is no G');
  assert.deepEqual(at(0, 0, 1, 1), { band: 'previous-start', level: 0, paper: 1, bossCleared: 0, accuracy: 0, timeRatio: 1 });
  for (let y = 1; y <= 6; y++) assert.equal(yearToLevel(y), y - 1); assert.equal(yearToLevel(9), 5); assert.equal(yearToLevel(0), 0);
  const results = [...Array(10)].map((_, i) => ({ track: 'engine', r: i < 9 ? 'correct' : 'incorrect', secs: 10, allowed: 40 })).concat([...Array(6)].map((_, i) => ({ track: 'nav', r: i < 3 ? 'correct' : 'timeout', secs: 65, allowed: 65 })));
  const placed = placementFromResults(results, 1);
  assert.equal(placed.engine.band, 'ahead'); assert.equal(placed.engine.timeRatio, 0.25); assert.equal(placed.nav.band, 'foundations'); assert.equal(placed.nav.correct, 3); assert.equal(placed.nav.secs, 390);
  const qs = buildPlacementQuestions(1); assert.equal(qs.length, 25); assert.equal(qs.filter((q) => q.track === 'engine').length, 15); assert.equal(qs.filter((q) => q.track === 'nav').length, 10); assert.ok(qs.every((q) => q.tier === 3 && q.paper >= 41 && q.paper <= 60 && q.level === 1 && q.seconds > 0));
  assert.equal(initialProgress({ start: 'year', yearLevel: 3 }, 0).engine.level, 2); assert.equal(initialProgress({ start: 'test', yearLevel: 2 }, 5).placement.level, 1); assert.equal(initialProgress({ start: 'a1', yearLevel: 4 }, 0).placement, null);
});
test('creating a child records age and year level for the business backend, and the start option decides the first papers', async () => {
  const f = fixture(); const a = await f.family('parentA', 4);
  const testKid = (await create(f, a.ctx, { age: 7, yearLevel: 2 })).child; // the default with a year level is the test
  assert.equal(testKid.yearLevel, 2); assert.equal(testKid.start, 'test');
  const doc = await f.store.get(`families/${a.familyId}/children/${testKid.id}`); assert.deepEqual(doc.demographics, { age: 7, yearLevel: 2, recordedAt: f.now() }); assert.equal(doc.start.option, 'test');
  const prog = await f.store.get(`families/${a.familyId}/learning/${testKid.id}`); assert.equal(prog.placement.status, 'pending'); assert.equal(prog.placement.level, 1); assert.equal(prog.placement.tier, 3);
  const yearKid = (await create(f, a.ctx, { age: 9, yearLevel: 4, start: 'year' })).child;
  const py = await f.store.get(`families/${a.familyId}/learning/${yearKid.id}`); assert.equal(py.engine.level, 3); assert.equal(py.nav.level, 3); assert.equal(py.engine.paper, 1); assert.equal(py.placement, null);
  const a1Kid = (await create(f, a.ctx, { age: 6, yearLevel: 1, start: 'a1' })).child;
  assert.equal(await f.store.get(`families/${a.familyId}/learning/${a1Kid.id}`), null, 'A1 is the default: no document until the child plays'); assert.equal(a1Kid.start, 'a1');
  const plain = (await create(f, a.ctx, {})).child; assert.equal(plain.yearLevel, null); assert.equal(plain.start, 'a1'); // older clients: nothing recorded, A1
  for (const bad of [{ age: 2, yearLevel: 1 }, { age: 18, yearLevel: 1 }, { age: 7, yearLevel: 7 }, { age: 7, yearLevel: 0 }, { age: '7', yearLevel: 1 }]) await assert.rejects(create(f, a.ctx, bad), rejected('INVALID_PROFILE'));
  for (const bad of [{ age: 7, start: 'test' }, { age: 7, start: 'year' }, { age: 7, yearLevel: 1, start: 'magic' }]) await assert.rejects(create(f, a.ctx, bad), rejected('INVALID_START'));
  assert.ok((await f.service.me(a.ctx)).family.children.every((c) => 'yearLevel' in c && 'start' in c));
  const x = await f.support.exportFamily(a.ctx); assert.deepEqual(x.children.find((c) => c.id === testKid.id).demographics, { age: 7, yearLevel: 2, recordedAt: f.now() });
});
test('the placement test comes first, is timed and mixed, pays nothing, and places each track; then normal play resumes there', async () => {
  const f = fixture(); const p = await f.family('parentA', 2); await roomToWork(f, p.familyId);
  const kid = (await create(f, p.ctx, { age: 7, yearLevel: 2 })).child; const childCtx = await enter(f, p, kid.id); const k = { p, child: kid, childCtx };
  await assert.rejects(f.learning.start(childCtx, { track: 'engine' }), rejected('PLACEMENT_PENDING'));
  await assert.rejects(f.learning.start(childCtx, { track: 'nav' }), rejected('PLACEMENT_PENDING'));
  await assert.rejects(f.learning.start(childCtx, { track: 'engine', mode: 'scan' }), rejected('PLACEMENT_PENDING'));
  const st0 = await f.learning.state(childCtx); assert.equal(st0.placement.status, 'pending'); assert.equal(st0.placement.level, 1);
  const { started, last, stored } = await takeTest(f, k, { right: 1, speed: 0.3 }); // everything right, quickly: ahead on both tracks
  assert.equal(started.session.mode, 'placement'); assert.equal(started.session.count, 25); assert.equal(started.question.track, 'engine');
  assert.ok(stored.questions.slice(0, 15).every((q) => q.track === 'engine' && q.level === 1 && q.tier === 3) && stored.questions.slice(15).every((q) => q.track === 'nav'));
  assert.equal(last.summary.mode, 'placement'); assert.equal(last.summary.rewarded, false); assert.equal(last.summary.gcEarned, 0); assert.equal(last.summary.rpEarned, 0);
  assert.equal(last.summary.placement.engine.band, 'ahead'); assert.equal(last.summary.placement.engine.levelId, 'C'); assert.equal(last.summary.placement.nav.levelId, 'C'); assert.equal(last.summary.placement.engine.paper, 1);
  const st = await f.learning.state(childCtx);
  assert.equal(st.placement.status, 'done'); assert.equal(st.engine.level, 2); assert.equal(st.nav.level, 2); assert.equal(st.engine.paper, 1); assert.equal(st.wallet.gc, 0); assert.equal(st.stats.passes, 0);
  assert.equal(st.history[0].mode, 'placement'); assert.deepEqual(st.history[0].placement, { engine: 'C1', nav: 'C1' }); assert.equal((await f.store.get(progPath(k))).passDays.length, 0);
  assert.equal((await f.store.list(`${progPath(k)}/ledger`)).length, 0, 'no ledger row: the test pays nothing');
  await assert.rejects(f.learning.start(childCtx, { track: 'engine', mode: 'placement' }), rejected('PLACEMENT_NOT_PENDING'), 'once');
  const real = await f.learning.start(childCtx, { track: 'engine' }); assert.equal(real.session.mode, 'paper'); assert.equal(real.session.level, 2); assert.equal(real.session.startPaper, 1);
});
test('slower or weaker results place lower: on-level, building, foundations, a sector back; a check point is never immediately due for skipped papers', async () => {
  const cases = [
    [{ right: 1, speed: 0.9 }, { engine: 'B41', nav: 'B41' }],
    [{ right: 0.8, speed: 0.3 }, { engine: 'B21', nav: 'B21' }],
    [{ right: 0.5, speed: 0.3 }, { engine: 'B1', nav: 'B1' }],
    [{ right: 0.4, speed: 0.3 }, { engine: 'A41', nav: 'A41' }],
    [{ right: 0.1, speed: 0.3 }, { engine: 'A1', nav: 'A1' }],
  ];
  for (const [how, want] of cases) {
    const f = fixture(); const p = await f.family('parentA', 2); await roomToWork(f, p.familyId);
    const kid = (await create(f, p.ctx, { age: 7, yearLevel: 2 })).child; const childCtx = await enter(f, p, kid.id); const k = { p, child: kid, childCtx };
    const { last } = await takeTest(f, k, how);
    const got = { engine: `${last.summary.placement.engine.levelId}${last.summary.placement.engine.paper}`, nav: `${last.summary.placement.nav.levelId}${last.summary.placement.nav.paper}` };
    assert.deepEqual(got, want, JSON.stringify(how));
    const st = await f.learning.state(childCtx); assert.equal(st.engine.bossDue, false, 'no check point is owed for skipped papers'); assert.equal(st.engine.next.mode, 'paper');
    assert.equal(st.engine.next.startPaper, last.summary.placement.engine.paper);
  }
});
test('the parent can change the starting point before the child has played, not after; a Year 1 child who tests weakly still starts at A1', async () => {
  const f = fixture(); const p = await f.family('parentA', 2); await roomToWork(f, p.familyId);
  const kid = (await create(f, p.ctx, { age: 6, yearLevel: 1 })).child;
  const r = await f.service.setChildStart(p.ctx, kid.id, { start: 'year', yearLevel: 3 }); assert.equal(r.child.start, 'year'); assert.equal(r.child.yearLevel, 3); assert.equal(r.placement, null);
  let prog = await f.store.get(`families/${p.familyId}/learning/${kid.id}`); assert.equal(prog.engine.level, 2); assert.equal(prog.placement, null);
  assert.equal((await f.store.get(`families/${p.familyId}/children/${kid.id}`)).demographics.yearLevel, 3);
  await f.service.setChildStart(p.ctx, kid.id, { start: 'test' }); prog = await f.store.get(`families/${p.familyId}/learning/${kid.id}`); assert.equal(prog.placement.status, 'pending'); assert.equal(prog.placement.level, 2);
  await assert.rejects(f.service.setChildStart(p.ctx, kid.id, { start: 'year', yearLevel: 9 }), rejected('INVALID_PROFILE'));
  await assert.rejects(f.service.setChildStart(p.ctx, randomUUID(), { start: 'a1' }), rejected('CHILD_NOT_FOUND'));
  const k = await f.childSession('parentB'); await assert.rejects(f.service.setChildStart(k.childCtx, kid.id, { start: 'a1' }), rejected('PARENT_REQUIRED'));
  await f.service.setChildStart(p.ctx, kid.id, { start: 'test', yearLevel: 1 });
  const childCtx = await enter(f, p, kid.id); const { last } = await takeTest(f, { p, child: kid, childCtx }, { right: 0.2, speed: 0.5 });
  assert.equal(last.summary.placement.engine.levelId, 'A'); assert.equal(last.summary.placement.engine.paper, 1);
  const p2 = await parentAgain(f); await assert.rejects(f.service.setChildStart(p2.ctx, kid.id, { start: 'a1' }), rejected('ALREADY_STARTED'));
  f.advance(6 * 60_000); const p3 = await f.login('parentA'); f.advance(6 * 60_000); await assert.rejects(f.service.setChildStart(p3.ctx, kid.id, { start: 'a1' }), rejected('REAUTHENTICATE'));
});
test('the same request id replays the same child; a different age or start under the same id is a conflict', async () => {
  const f = fixture(); const a = await f.family('parentA', 2); const id = randomUUID();
  const body = { nickname: 'Same', icon: 'fox', pin: '763829', age: 8, yearLevel: 3, start: 'year' };
  const first = await f.service.createChild(a.ctx, body, id); assert.deepEqual(await f.service.createChild(a.ctx, body, id), first);
  await assert.rejects(f.service.createChild(a.ctx, { ...body, age: 9 }, id), rejected('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(f.service.createChild(a.ctx, { ...body, start: 'test' }, id), rejected('IDEMPOTENCY_CONFLICT'));
  assert.equal(LEVELS.length, 6);
});
