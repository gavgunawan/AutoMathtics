// 🪐 Olympia (server/olympia.mjs, 19–20 Sep 2026): who may enter, a moon's paper sat as three phases each on its own clock, a
// visit with nothing said until the end, the reveal with the working, medals by share and their pay in the ledger's third
// currency, the daily cap on rewarded visits a phase, the bell, handing in, skipping, each phase's log of ten, the moon wares,
// and a visit on which Explain to me was used counting for nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, canonical, wrong } from './support.mjs';
import { olympiaAccess, grantOlympia, yearOf, medalFor, medalAt, thresholds, MEDALS, REWARDED_VISITS_PER_DAY, phaseKey } from '../server/olympia.mjs';
import { OLYMPIA_ITEMS } from '../server/game.mjs';
import { derive, reconcile, entry, post } from '../server/ledger.mjs';
import { normalizeProgress } from '../server/progress.mjs';
import { grantEntitlement } from '../server/service.mjs';

const DAY = 86_400_000, MINUTE = 60_000;
const progPath = (k) => `families/${k.p.familyId}/learning/${k.child.id}`;
// the fixture's pilot grant lasts fifteen minutes and a child's session twelve hours: a test that moves the clock a day needs both renewed
const longAccess = (f, k) => grantEntitlement(f.store, { familyId: k.p.familyId, seatLimit: 2, accessUntil: f.now() + 60 * DAY, reason: 'a long pilot', actor: 'test-operator' }, f.now());
const reenter = async (f, k) => { const p = await f.login('parentA'); const sel = await f.service.authenticate(await f.service.lock(p.ctx)); k.childCtx = await f.service.authenticate(await f.service.selectChild(sel, k.child.id, '763829')); };
const visitPath = (k, id) => `${progPath(k)}/sessions/${id}`;
const famPath = (k) => `families/${k.p.familyId}`;
/** answer every question of a visit: right ones for the first `right`, wrong after; returns the last reply */
async function play(f, k, started, right = 10) {
  const raw = await f.store.get(visitPath(k, started.visit.id)); let q = started.question, last, n = 0;
  while (q) { const a = n < right ? canonical(raw.questions[q.index]) : wrong(raw.questions[q.index]); last = await f.olympia.answer(k.childCtx, { visitId: started.visit.id, index: q.index, attemptId: randomUUID(), answer: a }); q = last.question || null; n++; }
  return last;
}
const sit = (f, k, moon, phase = 'alpha') => f.olympia.start(k.childCtx, { moon, phase });
const withChild = async (f, age, yearLevel) => { const p = await f.family('parentA', 2); const { child } = await f.service.createChild(p.ctx, { nickname: 'Rina', icon: 'fox', pin: '763829', age, yearLevel, start: 'a1' }, randomUUID()); const selCtx = await f.service.authenticate(await f.service.lock(p.ctx)); return { p, child, childCtx: await f.service.authenticate(await f.service.selectChild(selCtx, child.id, '763829')) }; };

test('the medals are a share of the section right — the same bar whatever its length — and the year a child is asked at', () => {
  assert.deepEqual(MEDALS.map((m) => [m.id, m.share]), [['gold', 0.8], ['silver', 0.6], ['bronze', 0.4], ['merit', 0.2]]);
  assert.deepEqual(thresholds(10), { gold: 8, silver: 6, bronze: 4, merit: 2 }); assert.deepEqual(thresholds(5), { gold: 4, silver: 3, bronze: 2, merit: 1 });
  assert.deepEqual(thresholds(15), { gold: 12, silver: 9, bronze: 6, merit: 3 }); assert.deepEqual(thresholds(16), { gold: 13, silver: 10, bronze: 7, merit: 4 }); assert.deepEqual(thresholds(14), { gold: 12, silver: 9, bronze: 6, merit: 3 });
  assert.equal(medalAt(0.8, 10), 8); assert.equal(medalFor(10, 10).id, 'gold'); assert.equal(medalFor(8, 10).id, 'gold'); assert.equal(medalFor(7, 10).id, 'silver'); assert.equal(medalFor(4, 10).id, 'bronze'); assert.equal(medalFor(2, 10).id, 'merit'); assert.equal(medalFor(1, 10), null);
  assert.equal(medalFor(11, 14).id, 'silver', '11 of 14 is under the 80% bar'); assert.equal(medalFor(4, 5).id, 'gold'); assert.equal(medalFor(1, 5).id, 'merit'); assert.equal(medalFor(0, 5), null);
  assert.equal(yearOf({ demographics: { yearLevel: 4, age: 7 } }), 4); assert.equal(yearOf({ demographics: { age: 9 } }), 3); assert.equal(yearOf({ demographics: { age: 5 } }), 1); assert.equal(yearOf({}), 1);
  assert.equal(REWARDED_VISITS_PER_DAY, 2); assert.equal(phaseKey('sea', 'alpha'), 'sea:alpha');
});
test('access: a pilot grant and the free trial open Olympia; a paid plan without the pass does not; the pass opens it until its date, and a past date closes it', async () => {
  const f = fixture(), k = await f.childSession(), now = f.now();
  assert.deepEqual(olympiaAccess(await f.store.get(famPath(k)), now).why, 'pilot');
  const fam = await f.store.get(famPath(k));
  const sub = { plan: 'starter', seats: 2, state: 'active', periodEnd: now + 30 * DAY, cancelAtPeriodEnd: false, failedAt: null, failures: 0, startedAt: now, updatedAt: now, version: 1, provider: 'manual', providerRef: null };
  await f.store.put(famPath(k), { ...fam, subscription: sub });
  assert.deepEqual(olympiaAccess(await f.store.get(famPath(k)), now), { open: false, why: 'none', until: null });
  await assert.rejects(sit(f, k, 'sea'), rejected('OLYMPIA_LOCKED'));
  assert.equal((await f.olympia.state(k.childCtx)).access.open, false, 'the hub still opens and says so');
  await f.store.put(famPath(k), { ...fam, subscription: { ...sub, state: 'trial', plan: 'trial', trialEndsAt: now + 5 * DAY, periodEnd: null } });
  assert.equal(olympiaAccess(await f.store.get(famPath(k)), now).why, 'trial');
  await f.store.put(famPath(k), { ...fam, subscription: sub });
  const pass = await grantOlympia(f.store, { familyId: k.p.familyId, until: now + 10 * DAY, actor: 'test-operator', reason: 'a family that asked' }, now);
  assert.equal(pass.status, 'active'); assert.equal(olympiaAccess(await f.store.get(famPath(k)), now).why, 'pass');
  assert.ok([...f.store.data.entries()].some(([p, v]) => p.startsWith('audit/') && v.action === 'olympia.granted' && v.familyId === k.p.familyId));
  await grantOlympia(f.store, { familyId: k.p.familyId, until: now - 1, actor: 'test-operator', reason: 'closing it again' }, now);
  assert.equal(olympiaAccess(await f.store.get(famPath(k)), now).open, false);
  await assert.rejects(grantOlympia(f.store, { familyId: randomUUID(), until: now + DAY, actor: 'test-operator', reason: 'nobody' }, now), rejected('FAMILY_NOT_FOUND'));
});
test('the hub: eight moons, all open, each its real paper in three phases with counts, minutes, marks and thresholds; US-Moon locked for a Year 1 child and open for Year 2, DC-Moon until Year 4; the band named; the child\'s minerals and medals', async () => {
  const f = fixture(), k1 = await f.childSession();
  const st = await f.olympia.state(k1.childCtx);
  assert.equal(st.year, 1); assert.equal(st.yearLifted, false); assert.equal(st.sector, 'A'); assert.equal(st.moons.length, 8); assert.equal(st.heat, undefined); assert.equal(st.minerals, 0); assert.equal(st.medalCount, 0); assert.equal(st.active, null); assert.equal(st.rewardedPerDay, 2);
  assert.deepEqual(st.medals.map((m) => [m.id, m.share, m.om]), [['gold', 0.8, 30], ['silver', 0.6, 20], ['bronze', 0.4, 10], ['merit', 0.2, 5]]);
  assert.deepEqual(st.moons.filter((m) => m.available).map((m) => m.id), ['sea', 'sg', 't', 'hk', 'bkk', 'phi']);
  assert.equal(st.moons.find((m) => m.id === 'us').why, 'opens at Year 2'); assert.equal(st.moons.find((m) => m.id === 'dc').why, 'opens at Year 4'); assert.equal(st.moons.find((m) => m.id === 'hk').why, null);
  assert.equal(st.moons.find((m) => m.id === 'sea').band, 'Paper A');
  for (const m of st.moons) {
    assert.equal(m.build, undefined, 'no generator leaves the server'); assert.equal(m.mod, undefined); assert.ok(m.modelled && m.long); assert.deepEqual(m.medals, { gold: 0, silver: 0, bronze: 0, merit: 0 });
    assert.deepEqual(m.phases.map((p) => [p.id, p.name, p.sym]), [['alpha', 'Alpha', 'α'], ['beta', 'Beta', 'β'], ['gamma', 'Gamma', 'γ']]);
    assert.equal(m.phases.reduce((a, p) => a + p.minutes, 0), m.minutes, `${m.id}: the phases share the paper's minutes`);
    for (const p of m.phases) { assert.ok(p.title && p.count > 0 && p.marks > 0); assert.deepEqual(p.thresholds, thresholds(p.count)); assert.deepEqual([p.visits, p.best, p.bestScore, p.log, p.rewardedToday, p.rewardedPerDay], [0, null, 0, [], 0, 2]); }
  }
  const sea = st.moons.find((m) => m.id === 'sea'); assert.deepEqual(sea.phases.map((p) => [p.title, p.count, p.marks, p.minutes, p.kind]), [['Section A', 10, 3, 25, 'mc'], ['Section B', 10, 4, 35, 'mc'], ['Section C', 5, 6, 30, 'sa']]);
  const sg = st.moons.find((m) => m.id === 'sg'); assert.deepEqual(sg.phases.map((p) => [p.count, p.kind]), [[16, 'mixed'], [14, 'sa'], [10, 'sa']], 'SMC Grades 1–2: forty questions, two of them multiple choice');
  assert.deepEqual(st.moons.find((m) => m.id === 'dc').phases.map((p) => [p.count, p.minutes]), [[10, 12], [10, 14], [5, 14]]);
  await assert.rejects(sit(f, k1, 'us'), rejected('MOON_NOT_FOR_YEAR'));
  await assert.rejects(f.olympia.start(k1.childCtx, { moon: 'hk' }), rejected('INVALID_REQUEST'), 'a phase is named'); await assert.rejects(sit(f, k1, 'hk', 'delta'), rejected('INVALID_REQUEST'));
  const hk = await sit(f, k1, 'hk'); assert.equal(hk.visit.moonName, 'HK-Moon'); assert.equal(hk.visit.phase, 'alpha'); assert.equal(hk.visit.title, 'Logical thinking · Arithmetic'); assert.equal(hk.question.section, 'LT'); assert.equal(hk.visit.count, 10); await f.olympia.quit(k1.childCtx, { visitId: hk.visit.id });
  const hk3 = await sit(f, k1, 'hk', 'gamma'); assert.equal(hk3.visit.count, 5); assert.equal(hk3.question.section, 'CO'); assert.equal(hk3.visit.seconds, 18 * 60); await f.olympia.quit(k1.childCtx, { visitId: hk3.visit.id });
  await assert.rejects(sit(f, k1, 'pluto'), rejected('INVALID_REQUEST'));
  const g = fixture(); const kk = await withChild(g, 8, 2); const st2 = await g.olympia.state(kk.childCtx);
  assert.equal(st2.year, 2); assert.ok(st2.moons.find((m) => m.id === 'us').available); assert.equal(st2.moons.find((m) => m.id === 'us').band, 'Grade 2'); assert.equal(st2.moons.find((m) => m.id === 'us').phases[0].count, 15);
});
test('the year a child is asked at follows the sector reached: a Year 1 child who has unlocked Sector B is asked as a Year 2 (US-Moon opens), one at Sector D on the Navigator as a Year 4 (DC-Moon too); a sign-up year beyond the sector stands', async () => {
  const f = fixture(), k = await f.childSession();
  const at = async (engine, nav) => { await f.store.put(progPath(k), { ...normalizeProgress(await f.store.get(progPath(k))), engine: { level: engine, paper: 1, bossCleared: 0 }, nav: { level: nav, paper: 1, bossCleared: 0 } }); return f.olympia.state(k.childCtx); };
  let st = await at(1, 0); assert.equal(st.year, 2); assert.equal(st.yearLifted, true); assert.equal(st.sector, 'B'); assert.ok(st.moons.find((m) => m.id === 'us').available); assert.equal(st.moons.find((m) => m.id === 'us').band, 'Grade 2'); assert.ok(!st.moons.find((m) => m.id === 'dc').available);
  const v = await sit(f, k, 'us'); assert.equal(v.visit.year, 2); assert.equal(v.visit.band, 'Grade 2'); await f.olympia.quit(k.childCtx, { visitId: v.visit.id });
  st = await at(0, 3); assert.equal(st.year, 4); assert.equal(st.sector, 'D'); assert.ok(st.moons.find((m) => m.id === 'dc').available, 'the Navigator lifts the year too'); assert.equal(st.moons.find((m) => m.id === 'dc').band, 'Grade 4');
  st = await at(0, 0); assert.equal(st.year, 1); assert.equal(st.yearLifted, false); assert.equal(st.sector, 'A'); assert.ok(!st.moons.find((m) => m.id === 'us').available);
  const g = fixture(), k3 = await withChild(g, 9, 3), s3 = await g.olympia.state(k3.childCtx); assert.equal(s3.year, 3); assert.equal(s3.yearLifted, false); assert.equal(s3.sector, 'A');
  assert.equal(yearOf({ demographics: { yearLevel: 1 } }, { engine: { level: 5, paper: 1, bossCleared: 0 } }), 6); assert.equal(yearOf({ demographics: { yearLevel: 5 } }, { engine: { level: 1, paper: 1, bossCleared: 0 } }), 5, 'never lowered');
});
test('a visit is one phase: SEAMO Section A, ten questions on a 25-minute clock, an answer marked in silence, the reveal at the end with every question and its working, a medal paid in coins, points and Olyminerals through one ledger row, the phase\'s log kept', async () => {
  const f = fixture(), k = await f.childSession();
  const s = await sit(f, k, 'sea', 'alpha');
  assert.equal(s.resumed, false); assert.equal(s.visit.count, 10); assert.equal(s.visit.moon, 'sea'); assert.equal(s.visit.moonName, 'SEA-Moon'); assert.equal(s.visit.band, 'Paper A'); assert.equal(s.visit.tutored, false);
  assert.deepEqual([s.visit.phase, s.visit.name, s.visit.sym, s.visit.title, s.visit.marks], ['alpha', 'Alpha', 'α', 'Section A', 3]); assert.equal(s.visit.seconds, 25 * 60); assert.equal(s.visit.left, 25 * 60); assert.deepEqual(s.visit.thresholds, { gold: 8, silver: 6, bronze: 4, merit: 2 });
  assert.equal(s.question.index, 0); assert.equal(s.question.seconds, undefined, 'no clock a question: the section has one'); assert.equal(s.question.answer, undefined, 'the answer never leaves the server'); assert.equal(s.question.steps, undefined, 'nor the working'); assert.equal(typeof s.question.explains, 'boolean'); assert.ok(s.question.cat); assert.ok(s.question.display.choices.length === 5);
  const again = await sit(f, k, 'sg', 'beta'); assert.equal(again.resumed, true); assert.equal(again.visit.id, s.visit.id, 'one visit at a time: a second start resumes it');
  f.advance(3 * MINUTE); const st0 = await f.olympia.state(k.childCtx); assert.equal(st0.active.visit.id, s.visit.id); assert.equal(st0.active.visit.left, 22 * 60, 'the clock as the server reads it');
  const raw = await f.store.get(visitPath(k, s.visit.id)); assert.equal(raw.kind, 'olympia'); assert.equal(raw.questions.length, 10); assert.equal(raw.deadline, raw.createdAt + 25 * MINUTE);
  const attempt = randomUUID(), r1 = await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: attempt, answer: canonical(raw.questions[0]) });
  assert.deepEqual(Object.keys(r1).sort(), ['done', 'index', 'left', 'question'], 'no mark, no expected answer: nothing is said until the end'); assert.equal(r1.done, false); assert.equal(r1.question.index, 1); assert.equal(r1.left, 22 * 60);
  assert.deepEqual(await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: attempt, answer: canonical(raw.questions[0]) }), r1, 'a retried attempt answers the same');
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: randomUUID(), answer: canonical(raw.questions[0]) }), rejected('STALE_QUESTION'));
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 1, attemptId: randomUUID(), answer: 'abc' }), rejected('INVALID_ANSWER'));
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: randomUUID(), index: 1, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_NOT_FOUND'));
  // the rest: 8 right of the remaining 9 (9/10 in all → gold)
  let q = r1.question, last, n = 0;
  while (q) { const a = n < 8 ? canonical(raw.questions[q.index]) : wrong(raw.questions[q.index]); last = await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: q.index, attemptId: randomUUID(), answer: a }); q = last.question || null; n++; }
  assert.equal(last.done, true); const r = last.result;
  assert.equal(r.score, 9); assert.equal(r.total, 10); assert.equal(r.blank, 0); assert.equal(r.medal, 'gold'); assert.equal(r.rewarded, true); assert.equal(r.tutored, false); assert.equal(r.trainingRun, false); assert.equal(r.how, 'end');
  assert.deepEqual([r.phase, r.name, r.sym, r.title, r.seconds], ['alpha', 'Alpha', 'α', 'Section A', 1500]); assert.equal(r.secs, 180); assert.deepEqual(r.next, { id: 'beta', name: 'Beta', sym: 'β', title: 'Section B' });
  assert.deepEqual([r.gcEarned, r.rpEarned, r.omEarned], [50, 100, 30]);
  assert.equal(r.questions.length, 10); assert.deepEqual(r.questions.map((x) => x.r), [...Array(9).fill('correct'), 'incorrect']);
  for (const x of r.questions) { assert.equal(typeof x.expected, 'string'); assert.ok(x.section); assert.ok(x.cat); assert.ok(typeof x.text === 'string' && x.text.length > 8, 'the question, for the working'); assert.equal(typeof x.given, 'string'); assert.ok(Array.isArray(x.steps), 'the working under every question'); }
  assert.deepEqual([r.wallet.gc, r.wallet.rp, r.wallet.om], [50, 100, 30]); assert.deepEqual(r.medals, { gold: 1, silver: 0, bronze: 0, merit: 0, best: 'gold' });
  assert.equal(r.phaseLog.length, 1); assert.deepEqual([r.phaseLog[0].score, r.phaseLog[0].total, r.phaseLog[0].secs, r.phaseLog[0].medal, r.phaseLog[0].rewarded], [9, 10, 180, 'gold', true]);
  const prog = normalizeProgress(await f.store.get(progPath(k)));
  assert.equal(prog.olympia.activeVisit, null); assert.equal(prog.olympia.history[0].medal, 'gold'); assert.equal(prog.olympia.history[0].phase, 'alpha'); assert.equal(prog.olympia.history[0].rewarded, true); assert.deepEqual(prog.history, [], 'an Olympia visit is not a paper: the home log stays as it was');
  assert.deepEqual(prog.olympia.phases['sea:alpha'].log.map((x) => x.score), [9]); assert.equal(prog.olympia.phases['sea:alpha'].best, 'gold'); assert.equal(prog.olympia.phases['sea:alpha'].bestScore, 9); assert.equal(prog.olympia.phases['sea:alpha'].visits, 1);
  assert.deepEqual(prog.passDays, [], 'no streak day: Olympia has no streaks'); assert.equal(prog.stats.passes, 0);
  const rows = [...f.store.data.entries()].filter(([p]) => p.startsWith(`${progPath(k)}/ledger/`)).map(([, v]) => v);
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 'olympia.medal'); assert.deepEqual([rows[0].gc, rows[0].rp, rows[0].om], [50, 100, 30]); assert.deepEqual(rows[0].balance, { gc: 50, rp: 100, om: 30 }); assert.equal(rows[0].ref, 'sea:alpha');
  const rc = reconcile(rows, prog.wallet); assert.ok(rc.match, rc.problems.join('; ')); assert.equal(derive(rows).om, 30);
  assert.equal((await f.store.get(visitPath(k, s.visit.id))).status, 'done');
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 10, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_OVER'));
  const st = await f.olympia.state(k.childCtx); assert.equal(st.minerals, 30); assert.equal(st.medalCount, 1);
  const sea = st.moons.find((m) => m.id === 'sea'); assert.equal(sea.best, 'gold'); assert.equal(sea.visits, 1);
  assert.deepEqual([sea.phases[0].rewardedToday, sea.phases[0].visits, sea.phases[0].best, sea.phases[0].bestScore, sea.phases[0].log.length], [1, 1, 'gold', 9, 1]); assert.deepEqual([sea.phases[1].rewardedToday, sea.phases[1].visits], [0, 0], 'Beta has its own count');
  const beta = await sit(f, k, 'sea', 'beta'); assert.equal(beta.resumed, false); assert.equal(beta.visit.title, 'Section B'); assert.equal(beta.visit.seconds, 35 * 60);
});
test('two sittings of a phase a day are rewarded; the third is a training run whose medal counts but pays nothing; another phase has its own two; a new day pays again; a score under the merit bar has no medal; a phase\'s log keeps ten', async () => {
  const f = fixture(), k = await f.childSession(); await longAccess(f, k);
  // SMC Grades 1–2: sixteen 2-mark questions in Alpha (gold from 13, silver 10, bronze 7, merit 4), fourteen in Beta (gold from 12)
  const first = await play(f, k, await sit(f, k, 'sg'), 10); assert.equal(first.result.total, 16); assert.equal(first.result.medal, 'silver'); assert.equal(first.result.rewarded, true); assert.deepEqual([first.result.gcEarned, first.result.rpEarned, first.result.omEarned], [30, 60, 20]);
  const second = await play(f, k, await sit(f, k, 'sg'), 7); assert.equal(second.result.medal, 'bronze'); assert.equal(second.result.rewarded, true); assert.equal(second.result.omEarned, 10);
  const third = await play(f, k, await sit(f, k, 'sg'), 16); assert.equal(third.result.medal, 'gold'); assert.equal(third.result.rewarded, false); assert.equal(third.result.trainingRun, true); assert.equal(third.result.omEarned, 0);
  assert.deepEqual(third.result.medals, { gold: 1, silver: 1, bronze: 1, merit: 0, best: 'gold' }); assert.equal(third.result.wallet.om, 30);
  const other = await play(f, k, await sit(f, k, 'sg', 'beta'), 12); assert.equal(other.result.total, 14); assert.equal(other.result.medal, 'gold'); assert.equal(other.result.rewarded, true, 'Beta has its own two');
  f.advance(DAY); await reenter(f, k);
  const tomorrow = await play(f, k, await sit(f, k, 'sg'), 4); assert.equal(tomorrow.result.medal, 'merit'); assert.equal(tomorrow.result.rewarded, true); assert.deepEqual([tomorrow.result.gcEarned, tomorrow.result.omEarned], [0, 5]);
  const none = await play(f, k, await sit(f, k, 'sg'), 3); assert.equal(none.result.medal, null); assert.equal(none.result.rewarded, false); assert.equal(none.result.trainingRun, false);
  const rows = [...f.store.data.entries()].filter(([p]) => p.startsWith(`${progPath(k)}/ledger/`)).map(([, v]) => v);
  assert.equal(rows.length, 4, 'a row per rewarded visit (silver, bronze, Beta\'s gold, the merit) and none for the rest'); assert.ok(reconcile(rows, normalizeProgress(await f.store.get(progPath(k))).wallet).match);
  for (let i = 0; i < 7; i++) await play(f, k, await sit(f, k, 'sg'), 5);
  const st = await f.olympia.state(k.childCtx); const alpha = st.moons.find((m) => m.id === 'sg').phases[0];
  assert.equal(alpha.visits, 12); assert.equal(alpha.log.length, 10, 'the log keeps ten'); assert.equal(alpha.bestScore, 16); assert.equal(alpha.best, 'gold'); assert.deepEqual(alpha.log.slice(0, 7).map((r) => r.score), Array(7).fill(5));
  assert.equal(normalizeProgress(await f.store.get(progPath(k))).olympia.phases['sg:alpha'].log.length, 10);
});
test('the bell: an answer after the clock closes the paper as it stands, unanswered questions blank; a visit left open past its clock is collected when the child next comes; the phase is then free', async () => {
  const f = fixture(), k = await f.childSession(); await longAccess(f, k);
  const s = await sit(f, k, 't'); const raw = await f.store.get(visitPath(k, s.visit.id)); assert.equal(s.visit.seconds, 25 * 60);
  await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: randomUUID(), answer: canonical(raw.questions[0]) });
  f.advance(26 * MINUTE);
  const late = await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 1, attemptId: randomUUID(), answer: canonical(raw.questions[1]) });
  assert.equal(late.done, true); const r = late.result; assert.equal(r.how, 'bell'); assert.equal(r.score, 1); assert.equal(r.blank, 8); assert.equal(r.total, 10); assert.equal(r.secs, 25 * 60, 'the clock reads the bell, not the lateness');
  assert.deepEqual(r.questions.map((x) => x.r), ['correct', 'timeout', ...Array(8).fill('blank')]); assert.equal(r.questions[2].given, null); assert.equal(r.medal, null);
  assert.equal((await f.olympia.state(k.childCtx)).active, null); assert.equal((await f.store.get(visitPath(k, s.visit.id))).how, 'bell');
  // left open: two right, then the child walks away for an hour; the hub collects it and shows nothing open
  const s2 = await sit(f, k, 'sea', 'beta'); const raw2 = await f.store.get(visitPath(k, s2.visit.id));
  await f.olympia.answer(k.childCtx, { visitId: s2.visit.id, index: 0, attemptId: randomUUID(), answer: canonical(raw2.questions[0]) });
  await f.olympia.answer(k.childCtx, { visitId: s2.visit.id, index: 1, attemptId: randomUUID(), answer: canonical(raw2.questions[1]) });
  f.advance(60 * MINUTE); await reenter(f, k);
  const st = await f.olympia.state(k.childCtx); assert.equal(st.active, null);
  const prog = normalizeProgress(await f.store.get(progPath(k))); assert.equal(prog.olympia.activeVisit, null); assert.deepEqual([prog.olympia.history[0].moon, prog.olympia.history[0].phase, prog.olympia.history[0].score, prog.olympia.history[0].how], ['sea', 'beta', 2, 'bell']);
  assert.equal((await f.store.get(visitPath(k, s2.visit.id))).status, 'done'); assert.equal(prog.olympia.history[0].medal, 'merit', '2 of 10 at the bell is still a merit'); assert.equal(prog.wallet.om, 5);
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s2.visit.id, index: 2, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_OVER'));
  const s3 = await sit(f, k, 'sea', 'beta'); assert.equal(s3.resumed, false); assert.notEqual(s3.visit.id, s2.visit.id);
});
test('handing in and skipping: a skipped question is blank and the paper goes on; "time\'s up" is refused while the server\'s clock has time; handing in early is marked as it stands; quitting keeps the log row and pays nothing', async () => {
  const f = fixture(), k = await f.childSession(); await longAccess(f, k);
  const s = await sit(f, k, 'sea', 'gamma'); const raw = await f.store.get(visitPath(k, s.visit.id)); assert.equal(s.visit.count, 5); assert.equal(s.visit.seconds, 30 * 60); assert.equal(s.question.answerType !== 'choice', true, 'Section C is typed');
  const skip = await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: randomUUID(), answer: null }); assert.equal(skip.done, false); assert.equal(skip.question.index, 1);
  await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 1, attemptId: randomUUID(), answer: canonical(raw.questions[1]) });
  await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 2, attemptId: randomUUID(), answer: canonical(raw.questions[2]) });
  await assert.rejects(f.olympia.finish(k.childCtx, { visitId: s.visit.id, why: 'timeup' }), rejected('TIME_LEFT'));
  await assert.rejects(f.olympia.finish(k.childCtx, { visitId: s.visit.id, why: 'never' }), rejected('INVALID_REQUEST'));
  const done = await f.olympia.finish(k.childCtx, { visitId: s.visit.id, why: 'handin' }); assert.equal(done.done, true);
  assert.deepEqual([done.result.how, done.result.score, done.result.blank, done.result.total, done.result.medal], ['handin', 2, 3, 5, 'bronze']); assert.deepEqual(done.result.questions.map((x) => x.r), ['blank', 'correct', 'correct', 'blank', 'blank']);
  assert.deepEqual(done.result.next, null, 'Gamma is the last phase');
  assert.deepEqual(await f.olympia.finish(k.childCtx, { visitId: s.visit.id, why: 'handin' }), done, 'handing in twice answers the same');
  // at the bell, "time's up" is accepted, and the retry that follows a slow network answers the same
  const s2 = await sit(f, k, 'sea', 'gamma'); f.advance(30 * MINUTE - 1000);
  const bell = await f.olympia.finish(k.childCtx, { visitId: s2.visit.id, why: 'timeup' }); assert.equal(bell.result.how, 'bell'); assert.equal(bell.result.blank, 5);
  // quitting
  const s3 = await sit(f, k, 't'); const raw3 = await f.store.get(visitPath(k, s3.visit.id));
  await f.olympia.answer(k.childCtx, { visitId: s3.visit.id, index: 0, attemptId: randomUUID(), answer: canonical(raw3.questions[0]) });
  assert.deepEqual(await f.olympia.quit(k.childCtx, { visitId: s3.visit.id }), { ok: true, status: 'quit' });
  const prog = normalizeProgress(await f.store.get(progPath(k))); assert.equal(prog.olympia.activeVisit, null); assert.equal(prog.olympia.history[0].quit, true); assert.equal(prog.olympia.history[0].answered, 1); assert.equal(prog.olympia.history[0].phase, 'alpha');
  assert.deepEqual([prog.olympia.phases['t:alpha'].log[0].quit, prog.olympia.phases['t:alpha'].log[0].score, prog.olympia.phases['t:alpha'].visits], [true, 1, 0], 'a quit is in the log but is not a sitting');
  assert.equal(prog.wallet.om, 10, 'the bronze from handing in, and nothing from the quit');
  assert.deepEqual(await f.olympia.quit(k.childCtx, { visitId: s3.visit.id }), { ok: true, status: 'quit' }, 'quitting twice is harmless');
  const s4 = await sit(f, k, 't'); assert.equal(s4.resumed, false); assert.notEqual(s4.visit.id, s3.visit.id);
});
test('the moon wares: priced in Olyminerals only, bought through the shop route with an olympia.buy row, worn through the same slot, refused without the minerals or the pass, and kept out of the Grid Shop\'s box', async () => {
  const f = fixture(), k = await f.childSession();
  assert.ok(OLYMPIA_ITEMS.length >= 10); for (const it of OLYMPIA_ITEMS) { assert.ok(it.om > 0); assert.equal(it.cost, 0); }
  const g0 = await f.game.state(k.childCtx); const dolphin = g0.catalog.find((it) => it.id === 'pet_dolphin'); assert.equal(dolphin.om, 60); assert.equal(dolphin.moon, 'sea'); assert.equal(dolphin.owned, false);
  assert.deepEqual(g0.olympia, { open: true, why: 'pilot', until: g0.olympia.until, minerals: 0, medals: 0 });
  await assert.rejects(f.game.buy(k.childCtx, { itemId: 'pet_dolphin', operationId: randomUUID() }), rejected('INSUFFICIENT_OLYMINERALS'));
  // minerals come only from a medal: pay one in as the visit would, through the ledger
  await f.store.transaction(async (tx) => { const p = await tx.get(progPath(k)); tx.set(progPath(k), await post(tx, progPath(k), normalizeProgress(p), entry({ id: 'seed', type: 'olympia.medal', om: 200, ref: 'sea', at: f.now() }))); });
  const op = randomUUID(), bought = await f.game.buy(k.childCtx, { itemId: 'pet_dolphin', operationId: op });
  assert.equal(bought.wallet.om, 140); assert.equal(bought.wallet.gc, 0); assert.equal(bought.wallet.activePet, 'pet_dolphin'); assert.equal(bought.wallet.omSpent, 60); assert.equal(bought.wallet.purchases[0].currency, 'om'); assert.equal(bought.wallet.purchases[0].cost, 60);
  assert.deepEqual(await f.game.buy(k.childCtx, { itemId: 'pet_dolphin', operationId: op }), bought);
  const row = [...f.store.data.entries()].find(([p]) => p.endsWith(`/ledger/${op}`))[1]; assert.equal(row.type, 'olympia.buy'); assert.equal(row.om, -60); assert.equal(row.gc, 0); assert.deepEqual(row.balance, { gc: 0, rp: 0, om: 140 });
  await assert.rejects(f.game.buy(k.childCtx, { itemId: 'pet_dolphin', operationId: randomUUID() }), rejected('ITEM_ALREADY_OWNED'));
  await assert.rejects(f.game.buy(k.childCtx, { itemId: 'veh_rover', operationId: randomUUID() }), rejected('INSUFFICIENT_OLYMINERALS'));
  assert.equal((await f.game.equip(k.childCtx, { kind: 'pet', itemId: null })).wallet.activePet, null);
  assert.equal((await f.game.equip(k.childCtx, { kind: 'pet', itemId: 'pet_dolphin' })).wallet.activePet, 'pet_dolphin');
  // a box never holds a moon ware: buy boxes until every crate kind is owned, and no om item ever comes out
  await f.store.transaction(async (tx) => { const p = normalizeProgress(await tx.get(progPath(k))); tx.set(progPath(k), await post(tx, progPath(k), p, entry({ id: 'coins', type: 'parent.adjust', gc: 20000, at: f.now() }))); });
  for (let i = 0; i < 40; i++) { try { const c = await f.game.buy(k.childCtx, { itemId: 'crate', operationId: randomUUID() }); assert.ok(!c.awarded.om, c.awarded.id); } catch (e) { assert.equal(e.code, 'CRATE_EMPTY'); break; } }
  // no pass, no shop
  const fam = await f.store.get(famPath(k)); await f.store.put(famPath(k), { ...fam, subscription: { plan: 'starter', seats: 2, state: 'active', periodEnd: f.now() + 30 * DAY, cancelAtPeriodEnd: false, failedAt: null, failures: 0, startedAt: f.now(), updatedAt: f.now(), version: 1, provider: 'manual', providerRef: null } });
  await assert.rejects(f.game.buy(k.childCtx, { itemId: 'title_moonwalker', operationId: randomUUID() }), rejected('OLYMPIA_LOCKED'));
});
test('💡 Explain to me on a moon question: the worked solution comes from the server with no AI call, the visit counts for nothing from then on — no medal, no minerals, no tally — the reveal says so, and the AI tutor\'s follow-up carries the working in its prompt', async () => {
  const model = []; const f = fixture({ tutorModel: async (req) => { model.push(req); return 'The second step doubles it.'; } }), k = await f.childSession();
  const s = await sit(f, k, 'sea'); const raw = await f.store.get(visitPath(k, s.visit.id)), q0 = raw.questions[0];
  await assert.rejects(f.olympia.explain(k.childCtx, { visitId: s.visit.id, index: 3 }), rejected('STALE_QUESTION'));
  const e = await f.olympia.explain(k.childCtx, { visitId: s.visit.id, index: 0 });
  assert.equal(e.tutored, true); assert.ok(Array.isArray(e.steps)); assert.deepEqual(e.steps, q0.steps); assert.equal(e.expected, s.question.answerType === 'choice' ? q0.display.choices[q0.answer.v] : String(q0.answer.v ?? `${q0.answer.n}/${q0.answer.d}`)); assert.equal(e.tip ?? null, q0.tip ?? null);
  assert.equal(model.length, 0, 'no call to the AI');
  assert.equal((await f.olympia.state(k.childCtx)).active.visit.tutored, true);
  assert.ok([...f.store.data.entries()].some(([p, v]) => p.startsWith('audit/') && v.action === 'olympia.explained'));
  assert.deepEqual(await f.olympia.explain(k.childCtx, { visitId: s.visit.id, index: 0 }), e, 'asking again shows the same working');
  // a follow-up to the AI tutor about the working: the first message is the child's, and the prompt carries the steps
  const t = await f.tutor.explain(k.childCtx, { sessionId: s.visit.id, index: 0, message: 'why double?' }); assert.equal(t.reply, 'The second step doubles it.'); assert.equal(t.turnsLeft, 5);
  assert.equal(model.length, 1); assert.equal(model[0].messages.at(-1).content, 'why double?');
  if (q0.steps.length) { assert.ok(model[0].system.includes('The worked solution the child has been shown'), 'the working is in the prompt'); assert.ok(model[0].system.includes(q0.steps[0])); assert.ok(model[0].system.includes('Stay with the worked solution')); assert.ok(!model[0].system.includes('DIFFERENT example')); }
  const last = await play(f, k, s, 10); const r = last.result;
  assert.equal(r.score, 10); assert.equal(r.medal, null); assert.equal(r.tutored, true); assert.equal(r.rewarded, false); assert.equal(r.omEarned, 0); assert.equal(r.wallet.om, 0);
  assert.deepEqual(r.medals, { gold: 0, silver: 0, bronze: 0, merit: 0, best: null });
  const prog = normalizeProgress(await f.store.get(progPath(k))); assert.equal(prog.olympia.history[0].tutored, true); assert.equal(prog.olympia.history[0].medal, null); assert.equal(prog.olympia.moons.sea.visits, 1); assert.equal(prog.olympia.moons.sea.gold, 0);
  assert.deepEqual([prog.olympia.phases['sea:alpha'].visits, prog.olympia.phases['sea:alpha'].best, prog.olympia.phases['sea:alpha'].bestScore, prog.olympia.phases['sea:alpha'].log[0].tutored], [1, null, 0, true]);
  assert.equal([...f.store.data.keys()].filter((p) => p.includes('/ledger/')).length, 0, 'no row: nothing was paid');
  await assert.rejects(f.olympia.explain(k.childCtx, { visitId: s.visit.id, index: 0 }), rejected('SESSION_OVER'));
});
test('the parent view: each child\'s moons and medals, the family\'s Olympia access and the tutor switch', async () => {
  const f = fixture(), k = await f.childSession();
  await play(f, k, await sit(f, k, 't'), 9);
  f.advance(2000); const p = await f.login('parentA'); const g = await f.game.parentState(p.ctx);
  assert.equal(g.olympia.open, true); assert.equal(g.tutorOff, false);
  assert.equal(g.children[0].olympia.medals, 1); assert.equal(g.children[0].olympia.moons.t.gold, 1); assert.equal(g.children[0].olympia.history[0].moon, 't'); assert.equal(g.children[0].olympia.history[0].phase, 'alpha');
  const set = await f.game.settings(p.ctx, { tutorOff: true }); assert.equal(set.tutorOff, true);
  assert.equal((await f.game.parentState(p.ctx)).tutorOff, true); assert.equal((await f.service.me(p.ctx)).family.tutorOff, true); assert.equal((await f.service.me(p.ctx)).family.olympia.open, true);
  await assert.rejects(f.game.settings(p.ctx, { tutorOff: 'yes' }), rejected('INVALID_REQUEST'));
});
