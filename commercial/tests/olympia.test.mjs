// 🪐 Olympia (server/olympia.mjs, 19 Sep 2026): who may enter, a visit with nothing said until the end, the reveal, medals and
// their pay in the ledger's third currency, the daily cap on rewarded visits, the moon wares, and a tutored visit counting for nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, canonical, wrong } from './support.mjs';
import { olympiaAccess, grantOlympia, yearOf, medalFor, MEDALS, REWARDED_VISITS_PER_DAY } from '../server/olympia.mjs';
import { OLYMPIA_ITEMS } from '../server/game.mjs';
import { derive, reconcile, entry, post } from '../server/ledger.mjs';
import { normalizeProgress } from '../server/progress.mjs';
import { grantEntitlement } from '../server/service.mjs';

const DAY = 86_400_000;
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
const withChild = async (f, age, yearLevel) => { const p = await f.family('parentA', 2); const { child } = await f.service.createChild(p.ctx, { nickname: 'Rina', icon: 'fox', pin: '763829', age, yearLevel, start: 'a1' }, randomUUID()); const selCtx = await f.service.authenticate(await f.service.lock(p.ctx)); return { p, child, childCtx: await f.service.authenticate(await f.service.selectChild(selCtx, child.id, '763829')) }; };

test('the medal thresholds and the year a child is asked at', () => {
  assert.deepEqual(MEDALS.map((m) => [m.id, m.min]), [['gold', 8], ['silver', 6], ['bronze', 4], ['merit', 2]]);
  assert.equal(medalFor(10).id, 'gold'); assert.equal(medalFor(8).id, 'gold'); assert.equal(medalFor(7).id, 'silver'); assert.equal(medalFor(4).id, 'bronze'); assert.equal(medalFor(2).id, 'merit'); assert.equal(medalFor(1), null);
  assert.equal(yearOf({ demographics: { yearLevel: 4, age: 7 } }), 4); assert.equal(yearOf({ demographics: { age: 9 } }), 3); assert.equal(yearOf({ demographics: { age: 5 } }), 1); assert.equal(yearOf({}), 1);
  assert.equal(REWARDED_VISITS_PER_DAY, 2);
});
test('access: a pilot grant and the free trial open Olympia; a paid plan without the pass does not; the pass opens it until its date, and a past date closes it', async () => {
  const f = fixture(), k = await f.childSession(), now = f.now();
  assert.deepEqual(olympiaAccess(await f.store.get(famPath(k)), now).why, 'pilot');
  const fam = await f.store.get(famPath(k));
  const sub = { plan: 'starter', seats: 2, state: 'active', periodEnd: now + 30 * DAY, cancelAtPeriodEnd: false, failedAt: null, failures: 0, startedAt: now, updatedAt: now, version: 1, provider: 'manual', providerRef: null };
  await f.store.put(famPath(k), { ...fam, subscription: sub });
  assert.deepEqual(olympiaAccess(await f.store.get(famPath(k)), now), { open: false, why: 'none', until: null });
  await assert.rejects(f.olympia.start(k.childCtx, { moon: 'sea' }), rejected('OLYMPIA_LOCKED'));
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
test('the hub: seven moons, four open, US-Moon locked for a Year 1 child and open for Year 2, the band named, the child\'s minerals and medals', async () => {
  const f = fixture(), k1 = await f.childSession();
  const st = await f.olympia.state(k1.childCtx);
  assert.equal(st.year, 1); assert.equal(st.moons.length, 7); assert.equal(st.heat, 10); assert.equal(st.minerals, 0); assert.equal(st.medalCount, 0); assert.equal(st.active, null);
  assert.deepEqual(st.moons.filter((m) => m.available).map((m) => m.id), ['sea', 'sg', 't']);
  assert.equal(st.moons.find((m) => m.id === 'us').why, 'opens at Year 2'); assert.equal(st.moons.find((m) => m.id === 'hk').why, 'soon');
  assert.equal(st.moons.find((m) => m.id === 'sea').band, 'Paper A');
  for (const m of st.moons) { assert.equal(m.heat, undefined, 'no generator leaves the server'); assert.ok(m.modelled && m.long); assert.deepEqual(m.medals, { gold: 0, silver: 0, bronze: 0, merit: 0 }); }
  await assert.rejects(f.olympia.start(k1.childCtx, { moon: 'us' }), rejected('MOON_NOT_FOR_YEAR'));
  await assert.rejects(f.olympia.start(k1.childCtx, { moon: 'hk' }), rejected('MOON_NOT_OPEN'));
  await assert.rejects(f.olympia.start(k1.childCtx, { moon: 'pluto' }), rejected('INVALID_REQUEST'));
  const k2 = await withChild(fixture(), 8, 2); // a second fixture: its own family
  const st2 = await k2.childCtx && (await (async () => { const g = fixture(); const kk = await withChild(g, 8, 2); return g.olympia.state(kk.childCtx); })());
  assert.equal(st2.year, 2); assert.ok(st2.moons.find((m) => m.id === 'us').available); assert.equal(st2.moons.find((m) => m.id === 'us').band, 'Grade 2');
});
test('a visit: ten questions in the moon\'s shape, an answer marked in silence, the reveal at the end with every question, a medal paid in coins, points and Olyminerals through one ledger row', async () => {
  const f = fixture(), k = await f.childSession();
  const s = await f.olympia.start(k.childCtx, { moon: 'sea' });
  assert.equal(s.resumed, false); assert.equal(s.visit.count, 10); assert.equal(s.visit.moon, 'sea'); assert.equal(s.visit.moonName, 'SEA-Moon'); assert.equal(s.visit.band, 'Paper A'); assert.equal(s.visit.tutored, false);
  assert.equal(s.question.index, 0); assert.equal(typeof s.question.seconds, 'number'); assert.ok(s.question.seconds >= 30); assert.equal(s.question.answer, undefined, 'the answer never leaves the server'); assert.ok(s.question.cat);
  const again = await f.olympia.start(k.childCtx, { moon: 'sg' }); assert.equal(again.resumed, true); assert.equal(again.visit.id, s.visit.id, 'one visit at a time: a second start resumes it');
  assert.equal((await f.olympia.state(k.childCtx)).active.visit.id, s.visit.id);
  const raw = await f.store.get(visitPath(k, s.visit.id)); assert.equal(raw.kind, 'olympia'); assert.equal(raw.questions.length, 10);
  const attempt = randomUUID(), r1 = await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: attempt, answer: canonical(raw.questions[0]) });
  assert.deepEqual(Object.keys(r1).sort(), ['done', 'index', 'question'], 'no mark, no expected answer: nothing is said until the end'); assert.equal(r1.done, false); assert.equal(r1.question.index, 1);
  assert.deepEqual(await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: attempt, answer: canonical(raw.questions[0]) }), r1, 'a retried attempt answers the same');
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: randomUUID(), answer: canonical(raw.questions[0]) }), rejected('STALE_QUESTION'));
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 1, attemptId: randomUUID(), answer: 'abc' }), rejected('INVALID_ANSWER'));
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: randomUUID(), index: 1, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_NOT_FOUND'));
  // the rest: 8 right of the remaining 9 (9/10 in all → gold)
  let q = r1.question, last, n = 0;
  while (q) { const a = n < 8 ? canonical(raw.questions[q.index]) : wrong(raw.questions[q.index]); last = await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: q.index, attemptId: randomUUID(), answer: a }); q = last.question || null; n++; }
  assert.equal(last.done, true); const r = last.result;
  assert.equal(r.score, 9); assert.equal(r.total, 10); assert.equal(r.medal, 'gold'); assert.equal(r.rewarded, true); assert.equal(r.tutored, false); assert.equal(r.trainingRun, false);
  assert.deepEqual([r.gcEarned, r.rpEarned, r.omEarned], [50, 100, 30]);
  assert.equal(r.questions.length, 10); assert.deepEqual(r.questions.map((x) => x.r), [...Array(9).fill('correct'), 'incorrect']);
  for (const x of r.questions) { assert.equal(typeof x.expected, 'string'); assert.ok(x.section); assert.ok(x.cat); assert.equal(typeof x.given, 'string'); }
  assert.deepEqual([r.wallet.gc, r.wallet.rp, r.wallet.om], [50, 100, 30]); assert.deepEqual(r.medals, { gold: 1, silver: 0, bronze: 0, merit: 0, best: 'gold' });
  const prog = normalizeProgress(await f.store.get(progPath(k)));
  assert.equal(prog.olympia.activeVisit, null); assert.equal(prog.olympia.history[0].medal, 'gold'); assert.equal(prog.olympia.history[0].rewarded, true); assert.deepEqual(prog.history, [], 'an Olympia visit is not a paper: the home log stays as it was');
  assert.deepEqual(prog.passDays, [], 'no streak day: Olympia has no streaks'); assert.equal(prog.stats.passes, 0);
  const rows = [...f.store.data.entries()].filter(([p]) => p.startsWith(`${progPath(k)}/ledger/`)).map(([, v]) => v);
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 'olympia.medal'); assert.deepEqual([rows[0].gc, rows[0].rp, rows[0].om], [50, 100, 30]); assert.deepEqual(rows[0].balance, { gc: 50, rp: 100, om: 30 }); assert.equal(rows[0].ref, 'sea');
  const rc = reconcile(rows, prog.wallet); assert.ok(rc.match, rc.problems.join('; ')); assert.equal(derive(rows).om, 30);
  assert.equal((await f.store.get(visitPath(k, s.visit.id))).status, 'done');
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 10, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_OVER'));
  const st = await f.olympia.state(k.childCtx); assert.equal(st.minerals, 30); assert.equal(st.medalCount, 1); assert.equal(st.moons.find((m) => m.id === 'sea').rewardedToday, 1); assert.equal(st.moons.find((m) => m.id === 'sea').best, 'gold');
});
test('two visits a moon a day are rewarded; the third is a training run whose medal counts but pays nothing; a new day pays again; a score under 2 has no medal', async () => {
  const f = fixture(), k = await f.childSession(); await longAccess(f, k);
  const first = await play(f, k, await f.olympia.start(k.childCtx, { moon: 'sg' }), 6); assert.equal(first.result.medal, 'silver'); assert.equal(first.result.rewarded, true); assert.deepEqual([first.result.gcEarned, first.result.rpEarned, first.result.omEarned], [30, 60, 20]);
  const second = await play(f, k, await f.olympia.start(k.childCtx, { moon: 'sg' }), 4); assert.equal(second.result.medal, 'bronze'); assert.equal(second.result.rewarded, true); assert.equal(second.result.omEarned, 10);
  const third = await play(f, k, await f.olympia.start(k.childCtx, { moon: 'sg' }), 10); assert.equal(third.result.medal, 'gold'); assert.equal(third.result.rewarded, false); assert.equal(third.result.trainingRun, true); assert.equal(third.result.omEarned, 0);
  assert.deepEqual(third.result.medals, { gold: 1, silver: 1, bronze: 1, merit: 0, best: 'gold' }); assert.equal(third.result.wallet.om, 30);
  const other = await play(f, k, await f.olympia.start(k.childCtx, { moon: 't' }), 8); assert.equal(other.result.rewarded, true, 'another moon has its own two');
  f.advance(DAY); await reenter(f, k);
  const tomorrow = await play(f, k, await f.olympia.start(k.childCtx, { moon: 'sg' }), 2); assert.equal(tomorrow.result.medal, 'merit'); assert.equal(tomorrow.result.rewarded, true); assert.deepEqual([tomorrow.result.gcEarned, tomorrow.result.omEarned], [0, 5]);
  const none = await play(f, k, await f.olympia.start(k.childCtx, { moon: 'sg' }), 1); assert.equal(none.result.medal, null); assert.equal(none.result.rewarded, false); assert.equal(none.result.trainingRun, false);
  const rows = [...f.store.data.entries()].filter(([p]) => p.startsWith(`${progPath(k)}/ledger/`)).map(([, v]) => v);
  assert.equal(rows.length, 4, 'a row per rewarded visit and none for the rest'); assert.ok(reconcile(rows, normalizeProgress(await f.store.get(progPath(k))).wallet).match);
});
test('quitting a visit: the log keeps it, nothing is paid, and the moon is free for a new visit; a visit left open past two hours expires on the next start', async () => {
  const f = fixture(), k = await f.childSession(); await longAccess(f, k);
  const s = await f.olympia.start(k.childCtx, { moon: 't' }); const raw = await f.store.get(visitPath(k, s.visit.id));
  await f.olympia.answer(k.childCtx, { visitId: s.visit.id, index: 0, attemptId: randomUUID(), answer: canonical(raw.questions[0]) });
  assert.deepEqual(await f.olympia.quit(k.childCtx, { visitId: s.visit.id }), { ok: true, status: 'quit' });
  const prog = normalizeProgress(await f.store.get(progPath(k))); assert.equal(prog.olympia.activeVisit, null); assert.equal(prog.olympia.history[0].quit, true); assert.equal(prog.olympia.history[0].answered, 1); assert.equal(prog.wallet.om, 0);
  assert.deepEqual(await f.olympia.quit(k.childCtx, { visitId: s.visit.id }), { ok: true, status: 'quit' }, 'quitting twice is harmless');
  const s2 = await f.olympia.start(k.childCtx, { moon: 't' }); assert.equal(s2.resumed, false); assert.notEqual(s2.visit.id, s.visit.id);
  f.advance(3 * 60 * 60_000);
  await assert.rejects(f.olympia.answer(k.childCtx, { visitId: s2.visit.id, index: 0, attemptId: randomUUID(), answer: '1' }), rejected('SESSION_EXPIRED'));
  assert.equal((await f.olympia.state(k.childCtx)).active, null);
  const s3 = await f.olympia.start(k.childCtx, { moon: 'sea' }); assert.equal(s3.resumed, false); assert.equal((await f.store.get(visitPath(k, s2.visit.id))).status, 'expired');
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
test('a visit the tutor helped on counts for nothing: no medal, no minerals, no tally — and the reveal says so', async () => {
  const f = fixture({ tutorModel: async () => 'Try a smaller example first.' }), k = await f.childSession();
  const s = await f.olympia.start(k.childCtx, { moon: 'sea' });
  const t = await f.tutor.explain(k.childCtx, { sessionId: s.visit.id, index: 0, message: null }); assert.equal(t.tutored, true);
  assert.equal((await f.olympia.state(k.childCtx)).active.visit.tutored, true);
  const last = await play(f, k, s, 10); const r = last.result;
  assert.equal(r.score, 10); assert.equal(r.medal, null); assert.equal(r.tutored, true); assert.equal(r.rewarded, false); assert.equal(r.omEarned, 0); assert.equal(r.wallet.om, 0);
  assert.deepEqual(r.medals, { gold: 0, silver: 0, bronze: 0, merit: 0, best: null });
  const prog = normalizeProgress(await f.store.get(progPath(k))); assert.equal(prog.olympia.history[0].tutored, true); assert.equal(prog.olympia.history[0].medal, null); assert.equal(prog.olympia.moons.sea.visits, 1); assert.equal(prog.olympia.moons.sea.gold, 0);
  assert.equal([...f.store.data.keys()].filter((p) => p.includes('/ledger/')).length, 0, 'no row: nothing was paid');
});
test('the parent view: each child\'s moons and medals, the family\'s Olympia access and the tutor switch', async () => {
  const f = fixture(), k = await f.childSession();
  await play(f, k, await f.olympia.start(k.childCtx, { moon: 't' }), 9);
  f.advance(2000); const p = await f.login('parentA'); const g = await f.game.parentState(p.ctx);
  assert.equal(g.olympia.open, true); assert.equal(g.tutorOff, false);
  assert.equal(g.children[0].olympia.medals, 1); assert.equal(g.children[0].olympia.moons.t.gold, 1); assert.equal(g.children[0].olympia.history[0].moon, 't');
  const set = await f.game.settings(p.ctx, { tutorOff: true }); assert.equal(set.tutorOff, true);
  assert.equal((await f.game.parentState(p.ctx)).tutorOff, true); assert.equal((await f.service.me(p.ctx)).family.tutorOff, true); assert.equal((await f.service.me(p.ctx)).family.olympia.open, true);
  await assert.rejects(f.game.settings(p.ctx, { tutorOff: 'yes' }), rejected('INVALID_REQUEST'));
});
