// The one-off v2 → v3 import: v2's own economy applied to v2's rows, nothing merged, nothing
// overwritten, nothing reachable from a route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixture, rejected } from './support.mjs';
import { convertV2, importLearning, convertRocketV2, importRocket, rocketRefusalLines } from '../server/migrate.mjs';
import { rocketPrize } from '../server/game.mjs';
import { assertFirestoreShape } from './support.mjs';

const pick = (w) => ({ gc: w.gc, rp: w.rp, bonuses: w.bonuses });
// A synthetic record in the live game's shape (not a real child's data).
const row = (o) => ({ date: '2026-09-01', ts: Date.parse('2026-09-01T10:00:00Z'), when: '9/1/2026 06:00 PM', levelIdx: 0, levelId: 'A', papers: '1–5', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, mins: '5:12', ...o });
const v2 = () => ({
  level: 1, paper: 21, bossCleared: 1, nav: { level: 0, paper: 86, bossCleared: 4 }, pin: '8520', savedAt: 1788870699017, savedBy: 'abc123',
  history: [
    { date: '2026-09-07', levelId: 'A', levelIdx: 0, papers: '—', shield: true, ts: Date.parse('2026-09-07T09:00:00Z'), when: '2026-09-07 🛡️' }, // a shield marker, not a session
    { atPaper: 86, atQ: 2, date: '2026-09-07', levelId: 'A', levelIdx: 0, papers: '🧭 86–90', quit: true, track: 'nav', ts: Date.parse('2026-09-07T08:44:00Z') },
    row({ date: '2026-09-07', ts: Date.parse('2026-09-07T04:00:00Z'), levelIdx: 1, levelId: 'B', papers: '16–20' }),
    row({ date: '2026-09-06', ts: Date.parse('2026-09-06T04:00:00Z'), levelIdx: 1, levelId: 'B', papers: '👑 CHECK POINT T1', boss: true, qlog: [[1, 4, 1, 1, 0], [1, 6, 1, 1, 0]] }),
    row({ date: '2026-09-06', ts: Date.parse('2026-09-06T03:00:00Z'), papers: '🧠 SCAN', scan: true }),
    row({ date: '2026-09-05', ts: Date.parse('2026-09-05T04:00:00Z'), papers: '🧭 81–85', track: 'nav', total: 15, correct: 15 }),
    row({ date: '2026-09-04', ts: Date.parse('2026-09-04T04:00:00Z'), papers: '🔁 6–10', practice: true }),
    row({ date: '2026-09-03', ts: Date.parse('2026-09-03T04:00:00Z'), papers: '11–15', passed: false, correct: 24, incorrect: 1 }),
    row({ date: '2026-09-02', ts: Date.parse('2026-09-02T04:00:00Z'), papers: '6–10', mins: '—' }),
    row({ date: '2026-09-01', ts: Date.parse('2026-09-01T04:00:00Z'), papers: '1–5' }),
  ],
  wallet: { gcSpent: 600, rpSpent: 6500, shields: 0, shieldDays: ['2026-08-30'], lastScanWeek: '2026-W36', inventory: ['pet_fox', 'title_dragon'], activePet: 'pet_fox', activeTitle: 'title_dragon',
    purchases: [{ cost: 200, date: '2026-09-06', emoji: '🐉', id: 'title_dragon', name: 'DRAGON TAMER', when: '9/6/2026 08:12 PM' }],
    redemptions: [{ cost: 500, date: '2026-09-06', emoji: '🚀', id: '1788668747377', name: 'Rocket fuel', rewardId: 'rocket', status: 'approved' }] },
});

test('convertV2 applies v2\'s economy to v2\'s rows and produces a valid v3 document', () => {
  const { doc, summary } = convertV2(v2(), { now: Date.parse('2026-09-09T00:00:00Z') });
  assertFirestoreShape(doc, 'learning');
  assert.deepEqual(doc.engine, { level: 1, paper: 21, bossCleared: 1 }); assert.deepEqual(doc.nav, { level: 0, paper: 86, bossCleared: 4 });
  // passes: 16–20, CP T1 (×2), SCAN (×2), nav 81–85, practice 6–10, 6–10, 1–5 = 7 rows → 5 + 2×2 = 9 units; 11–15 failed
  assert.equal(summary.passes, 7); assert.equal(summary.sessions, 8);
  // pass-days: 09-01, 09-02, 09-04, 09-05, 09-06, 09-07 (scan day excluded on its own but 09-06 has the CP) + shield 08-30 → runs: 01-02, 04-05-06-07 → 1 bonus
  assert.equal(summary.bonuses, 1);
  assert.equal(summary.earnedGc, 9 * 50 + 50); assert.equal(summary.earnedRp, 9 * 100 + 100);
  assert.deepEqual(pick(doc.wallet), { gc: 0, rp: 0, bonuses: 1 }); // spent more than earned under v2's manual credits → clamps at zero, never negative
  // the v2 wallet becomes the v3 game wallet
  assert.deepEqual(doc.wallet.inventory, ['pet_fox', 'title_dragon']); assert.equal(doc.wallet.activePet, 'pet_fox'); assert.equal(doc.wallet.activeTitle, 'title_dragon'); assert.equal(doc.wallet.activeBg, null);
  assert.equal(doc.wallet.gcSpent, 600); assert.equal(doc.wallet.rpSpent, 6500); assert.equal(doc.wallet.lastScanWeek, '2026-W36');
  assert.equal(doc.wallet.purchases.length, 1); assert.equal(doc.wallet.purchases[0].id, 'title_dragon'); assert.equal(doc.wallet.purchases[0].cost, 200);
  assert.equal(doc.wallet.redemptions.length, 1); assert.equal(doc.wallet.redemptions[0].status, 'approved'); assert.equal(doc.wallet.redemptions[0].rewardId, 'rocket');
  assert.equal(doc.wallet.egg, null); assert.deepEqual(doc.legacy.droppedItems, []);
  assert.equal(doc.history.length, 9); assert.equal(doc.history[0].quit, true); assert.equal(doc.history[0].track, 'nav'); assert.equal(doc.history[0].papers, '86–90'); assert.equal(doc.history[0].total, 15);
  const cp = doc.history.find((h) => h.mode === 'boss'); assert.equal(cp.papers, 'CP T1'); assert.deepEqual(cp.qlog, [{ t: 1, s: 4, ok: 1 }, { t: 1, s: 6, ok: 1 }]);
  assert.equal(doc.history.find((h) => h.mode === 'scan').papers, 'SCAN'); assert.equal(doc.history.find((h) => h.mode === 'practice').papers, 'practice 6–10');
  assert.equal(doc.history.find((h) => h.papers === '1–5').secs, 312); assert.equal(doc.history.find((h) => h.papers === '6–10').secs, null);
  assert.equal(doc.activeSession, null); assert.equal(doc.legacy.gcSpent, 600);
  assert.ok(!JSON.stringify(doc).includes('8520'), 'the v2 PIN never enters the v3 document');
});
test('a record with more earned than spent carries the balance; unknown items are dropped and reported; bad records are refused', () => {
  const r = v2(); r.wallet.gcSpent = 100; r.wallet.rpSpent = 0; r.wallet.inventory.push('pet_unknown_thing'); r.wallet.activePet = 'pet_unknown_thing';
  const { doc, summary } = convertV2(r, { now: 0 });
  assert.deepEqual(pick(doc.wallet), { gc: 400, rp: 1000, bonuses: 1 });
  assert.deepEqual(doc.wallet.inventory, ['pet_fox', 'title_dragon']); assert.equal(doc.wallet.activePet, null); assert.deepEqual(summary.droppedItems, ['pet_unknown_thing']);
  for (const bad of [null, [], { level: 9 }, { paper: 0 }, { nav: { bossCleared: 6 } }, { paper: 1.5 }]) assert.throws(() => convertV2(bad, { now: 0 }), /V2_RECORD_INVALID/);
  const { doc: empty } = convertV2({}, { now: 0 }); assert.deepEqual(empty.engine, { level: 0, paper: 1, bossCleared: 0 }); assert.deepEqual(pick(empty.wallet), { gc: 0, rp: 0, bonuses: 0 });
});
test('importLearning writes once, audits, and the child can carry on from where v2 left them', async () => {
  const f = fixture(); const k = await f.childSession();
  const summary = await importLearning(f.store, { familyId: k.p.familyId, childId: k.child.id, record: v2(), actor: 'test-operator', reason: 'migrate synthetic child' }, f.now());
  assert.equal(summary.passes, 7);
  const st = await f.learning.state(k.childCtx);
  assert.equal(st.engine.levelId, 'B'); assert.equal(st.engine.paper, 21); assert.equal(st.engine.next.mode, 'paper'); // crown 1 already cleared
  assert.equal(st.nav.paper, 86); assert.equal(st.nav.bossCleared, 4); assert.equal(st.history.length, 9);
  const open = await f.learning.start(k.childCtx, { track: 'engine' });
  assert.equal(open.session.levelId, 'B'); assert.equal(open.session.startPaper, 21);
  await assert.rejects(importLearning(f.store, { familyId: k.p.familyId, childId: k.child.id, record: v2(), actor: 'test-operator', reason: 'second attempt' }, f.now()), rejected('ALREADY_HAS_PROGRESS'));
  const audits = [...f.store.data.entries()].filter(([p, v]) => p.startsWith('audit/') && v.action === 'learning.migrated');
  assert.equal(audits.length, 1); assert.equal(audits[0][1].summary.engine, 'B21');
});
test('importLearning refuses a child outside the family, an unknown child, and an inactive child', async () => {
  const f = fixture(); const a = await f.childSession('parentA'), b = await f.childSession('parentB');
  await assert.rejects(importLearning(f.store, { familyId: b.p.familyId, childId: a.child.id, record: v2(), actor: 'test-operator', reason: 'cross-family' }, f.now()), rejected('CHILD_NOT_FOUND'));
  await assert.rejects(importLearning(f.store, { familyId: a.p.familyId, childId: randomUUID(), record: v2(), actor: 'test-operator', reason: 'unknown child' }, f.now()), rejected('CHILD_NOT_FOUND'));
  await f.store.put(`families/${a.p.familyId}/children/${a.child.id}`, { ...(await f.store.get(`families/${a.p.familyId}/children/${a.child.id}`)), status: 'inactive' });
  await assert.rejects(importLearning(f.store, { familyId: a.p.familyId, childId: a.child.id, record: v2(), actor: 'test-operator', reason: 'inactive' }, f.now()), rejected('CHILD_INACTIVE'));
  assert.equal(await f.store.get(`families/${a.p.familyId}/learning/${a.child.id}`), null);
});

// ---- the Family Rocket -------------------------------------------------------------------------
// A synthetic rocket in the live game's export shape (names, ids and prize are invented; the numbers
// are the realistic kind: RP, two crew, a goal of 20,000 with a 10,000 minimum each).
const v2Rocket = () => ({ createdAt: 1788000000000, createdOn: '2026-08-29', crew: ['nova', 'orion'], currency: 'rp', fuel: { nova: 6700, orion: 7100 }, goal: 20000, id: '1788000000000',
  lastFuel: { amt: 100, at: 1788100000000, by: 'Orion' }, minEach: 10000, prize: { emoji: '🎡🎡', name: 'Theme park day for reaching the goal' }, status: 'fueling' });
const T = Date.parse('2026-09-11T02:00:00Z');
// Two children created with the default A1 start, as the cutover order adds them; the parent signs in again
// afterwards so the workspace session is a fresh one. The nicknames lower-cased are the v2 crew names.
async function crewFamily(f) {
  const p = await f.family('parentA', 2);
  const { child: nova } = await f.child(p.ctx, 'Nova'); const { child: orion } = await f.child(p.ctx, 'Orion');
  f.advance(2000); const parent = await f.login('parentA');
  return { familyId: p.familyId, nova, orion, parent, crewMap: { nova: nova.id, orion: orion.id } };
}
// A synthetic v2 child whose `passes` passed papers all fall on one day (no streak bonus), so v2 earned
// passes × the pass reward, and whose v2 RP spending is `rpSpent` — the realistic shape for this family,
// where every RP a child spent went into the rocket.
const richV2 = (passes, rpSpent) => ({ level: 0, paper: 1, bossCleared: 0, nav: { level: 0, paper: 1, bossCleared: 0 }, savedAt: 1788870699017,
  history: Array.from({ length: passes }, (_, i) => row({ date: '2026-09-01', ts: Date.parse('2026-09-01T04:00:00Z') + i * 60_000 })),
  wallet: { gcSpent: 0, rpSpent, shields: 0, shieldDays: [], inventory: [], purchases: [], redemptions: [] } });
// Cutover steps 5–6 for both children: [passes, rpSpent] each. By default each child's rpSpent is exactly their fuel.
async function importCrew(f, fam, { nova = [70, 6700], orion = [75, 7100] } = {}) {
  const out = {};
  for (const [name, [passes, rpSpent]] of Object.entries({ nova, orion })) {
    out[name] = await importLearning(f.store, { familyId: fam.familyId, childId: fam[name].id, record: richV2(passes, rpSpent), actor: 'test-operator', reason: 'migrate synthetic child' }, f.now());
  }
  return out;
}
const rocketRun = (f, fam, patch = {}, store = f.store) => importRocket(store, { familyId: fam.familyId, crewMap: fam.crewMap, v2Rocket: v2Rocket(), actor: 'test-operator', reason: 'migrate synthetic rocket', ...patch }, f.now());
// A child signed in on a device: a fresh parent sign-in, the handover lock, then the child's PIN.
async function childCtx(f, childId) {
  f.advance(2000); const p = await f.login('parentA');
  const sel = await f.service.authenticate(await f.service.lock(p.ctx));
  return f.service.authenticate(await f.service.selectChild(sel, childId, '763829'));
}
// Pours `total` in the largest amounts the fuel route accepts; returns the last response.
async function pour(f, ctx, rocketId, total) {
  let left = total, last = null;
  while (left > 0) { const amount = [500, 200, 100].find((a) => a <= left); last = await f.game.fuel(ctx, { rocketId, amount, operationId: randomUUID() }); left -= amount; }
  return last;
}
const learningRows = (f) => JSON.stringify([...f.store.data.entries()].filter(([p]) => p.includes('/learning/')).sort(([a], [b]) => (a < b ? -1 : 1)));
const auditsOf = (f, action) => [...f.store.data.entries()].filter(([p, v]) => p.startsWith('audit/') && v.action === action).map(([, v]) => v);
const configOf = (f, familyId) => f.store.get(`families/${familyId}/game/config`);
const ledgerOf = async (f, fam, name) => (await f.store.list(`families/${fam.familyId}/learning/${fam[name].id}/ledger`)).map((r) => [r.type, r.rp]).sort();

test('convertRocketV2 maps the v2 crew to child ids and keeps the exact fuel, in the shape the build route writes', () => {
  const a = randomUUID(), b = randomUUID();
  const { rocket, summary } = convertRocketV2(v2Rocket(), { nova: a, orion: b }, { now: T });
  assertFirestoreShape(rocket, 'rocket');
  assert.deepEqual(Object.keys(rocket), ['id', 'status', 'prize', 'currency', 'goal', 'minEach', 'crewChildIds', 'fuel', 'createdAt']);
  assert.match(rocket.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.notEqual(rocket.id, '1788000000000');
  assert.equal(rocket.status, 'fueling'); assert.equal(rocket.currency, 'rp'); assert.equal(rocket.goal, 20000); assert.equal(rocket.minEach, 10000); assert.equal(rocket.createdAt, T);
  assert.deepEqual(rocket.prize, { emoji: '🎡🎡', name: 'Theme park day for reaching the goal' });
  assert.deepEqual(rocket.crewChildIds, [a, b]); assert.deepEqual(rocket.fuel, { [a]: 6700, [b]: 7100 });
  assert.equal(summary.totalFuel, 13800); assert.equal(summary.remaining, 6200); assert.equal(summary.ready, false);
  assert.deepEqual(summary.crew, [{ name: 'nova', childId: a, fuel: 6700, otherSpent: 0 }, { name: 'orion', childId: b, fuel: 7100, otherSpent: 0 }]);
  assert.equal(summary.v2Id, '1788000000000'); assert.equal(summary.v2CreatedOn, '2026-08-29'); assert.deepEqual(summary.lastFuelNotCarried, { amount: 100, at: 1788100000000 });
  assert.equal(summary.v2CreatedAt, 1788000000000); assert.equal(summary.v2HistoryCount, 0, 'no history key, as in the real export');
  assert.ok(!JSON.stringify(rocket).includes('Orion') && !JSON.stringify(rocket).includes('nova'), 'no v2 crew name enters the v3 rocket');
  // a crew map with no prototype (the operator tool builds it that way) converts exactly the same
  const bare = Object.assign(Object.create(null), { nova: a, orion: b });
  assert.deepEqual(convertRocketV2(v2Rocket(), bare, { now: T }).rocket.fuel, { [a]: 6700, [b]: 7100 });
});

test('convertRocketV2 refuses a crew name with no mapping, a mapping with no crew name, and one child mapped twice', () => {
  const a = randomUUID(), b = randomUUID();
  assert.throws(() => convertRocketV2(v2Rocket(), { nova: a }, { now: T }), rejected('V2_ROCKET_UNMAPPED_CREW:orion'));
  assert.throws(() => convertRocketV2(v2Rocket(), { nova: a, orion: b, vega: randomUUID() }, { now: T }), rejected('V2_ROCKET_MAPPING_WITHOUT_CREW:vega'));
  assert.throws(() => convertRocketV2(v2Rocket(), { nova: a, orion: a }, { now: T }), rejected('V2_ROCKET_CREW_MAP_DUPLICATE'));
  assert.throws(() => convertRocketV2(v2Rocket(), { nova: a, orion: 'not-a-uuid' }, { now: T }), rejected('INVALID_ID'));
  for (const bad of [null, [], 'nova=x']) assert.throws(() => convertRocketV2(v2Rocket(), bad, { now: T }), rejected('V2_ROCKET_CREW_MAP_INVALID'));
});

test('convertRocketV2 refuses a rocket outside the bounds the build route enforces and any fuel that is not a whole non-negative number', () => {
  const map = { nova: randomUUID(), orion: randomUUID() };
  const bad = (patch, code) => assert.throws(() => convertRocketV2({ ...v2Rocket(), ...patch }, map, { now: T }), rejected(code), code);
  for (const v of [null, [], 'rocket']) assert.throws(() => convertRocketV2(v, map, { now: T }), rejected('V2_ROCKET_INVALID:shape'));
  bad({ status: 'launched' }, 'V2_ROCKET_INVALID:status');
  bad({ currency: 'usd' }, 'V2_ROCKET_INVALID:currency'); bad({ currency: ['rp'] }, 'V2_ROCKET_INVALID:currency');
  bad({ goal: 49 }, 'V2_ROCKET_INVALID:goal'); bad({ goal: 1_000_001 }, 'V2_ROCKET_INVALID:goal'); bad({ goal: 20000.5 }, 'V2_ROCKET_INVALID:goal'); bad({ goal: '20000' }, 'V2_ROCKET_INVALID:goal');
  bad({ minEach: -1 }, 'V2_ROCKET_INVALID:minEach'); bad({ minEach: 20001 }, 'V2_ROCKET_INVALID:minEach'); bad({ minEach: 1.5 }, 'V2_ROCKET_INVALID:minEach');
  bad({ prize: { emoji: '🎡', name: 'x'.repeat(51) } }, 'V2_ROCKET_INVALID:prize'); bad({ prize: { emoji: '🎡'.repeat(7), name: 'Ride' } }, 'V2_ROCKET_INVALID:prize');
  bad({ prize: { emoji: '🎡', name: '   ' } }, 'V2_ROCKET_INVALID:prize'); bad({ prize: { emoji: '🎡', name: 'Ride', cost: 5 } }, 'V2_ROCKET_INVALID:prize'); bad({ prize: null }, 'V2_ROCKET_INVALID:prize');
  bad({ crew: 'nova,orion' }, 'V2_ROCKET_INVALID:crew'); bad({ crew: [] }, 'V2_ROCKET_INVALID:crew'); bad({ crew: ['nova', 'nova', 'orion'] }, 'V2_ROCKET_INVALID:crew'); bad({ crew: ['nova', 7] }, 'V2_ROCKET_INVALID:crew');
  bad({ fuel: { nova: 6700.5, orion: 7100 } }, 'V2_ROCKET_INVALID:fuel.nova'); bad({ fuel: { nova: -1, orion: 7100 } }, 'V2_ROCKET_INVALID:fuel.nova');
  bad({ fuel: { nova: '6700', orion: 7100 } }, 'V2_ROCKET_INVALID:fuel.nova'); bad({ fuel: { nova: 6700, orion: 2 ** 53 } }, 'V2_ROCKET_INVALID:fuel.orion');
  bad({ fuel: { nova: 6700, orion: 7100, vega: 1 } }, 'V2_ROCKET_INVALID:fuel.vega'); bad({ fuel: [6700, 7100] }, 'V2_ROCKET_INVALID:fuel');
  bad({ fuel: { nova: 10000, orion: 10000 } }, 'V2_ROCKET_ALREADY_READY'); // should have launched in v2; the owner decides, not the importer
  // a crew member v2 never recorded fuel for starts at nothing, exactly as a built rocket does
  const { rocket } = convertRocketV2({ ...v2Rocket(), fuel: { nova: 6700 } }, map, { now: T }); assert.deepEqual(rocket.fuel, { [map.nova]: 6700 });
});

test('importRocket refuses a 41-character crew name before it reads the store', async () => {
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const long = 'n'.repeat(41);
  await assert.rejects(rocketRun(f, fam, { v2Rocket: { ...v2Rocket(), crew: [long, 'orion'], fuel: { [long]: 6700, orion: 7100 } }, crewMap: { [long]: fam.nova.id, orion: fam.orion.id } }), rejected('V2_ROCKET_INVALID:crew'));
  assert.equal(await configOf(f, fam.familyId), null);
});

test('in the realistic case each child\'s v2 spending equals their fuel: the rocket lands with that exact fuel, carried RP plus fuel is what v2 earned, and the ledgers hold only their opening rows', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  const children = await importCrew(f, fam); // steps 5–6: rpSpent 6,700 and 7,100, the fuel exactly
  const walletsBefore = learningRows(f);
  const result = await rocketRun(f, fam);
  assert.equal(result.alreadyWritten, false); assert.equal(result.totalFuel, 13800); assert.equal(result.ready, false);
  assert.deepEqual(result.crew.map((c) => [c.name, c.nickname, c.fuel, c.spent]), [['nova', 'Nova', 6700, 6700], ['orion', 'Orion', 7100, 7100]]);
  assert.equal(learningRows(f), walletsBefore, 'no learning document, wallet or ledger row was touched');
  for (const name of ['nova', 'orion']) {
    const doc = await f.store.get(`families/${fam.familyId}/learning/${fam[name].id}`), fuel = v2Rocket().fuel[name];
    assert.equal(doc.wallet.rp + fuel, doc.legacy.earnedRp, `${name}: the carried RP and the rocket fuel together are exactly what v2 earned`);
    assert.equal(doc.wallet.rp, children[name].rp); assert.equal(doc.legacy.rpSpent, fuel);
    assert.deepEqual(await ledgerOf(f, fam, name), [['migrate.opening', doc.wallet.rp]], `${name}: the opening row and nothing else`);
  }
  const cfg = await configOf(f, fam.familyId);
  assert.deepEqual(cfg.rocket, { id: result.rocketId, status: 'fueling', prize: { emoji: '🎡🎡', name: 'Theme park day for reaching the goal' }, currency: 'rp', goal: 20000, minEach: 10000,
    crewChildIds: [fam.nova.id, fam.orion.id], fuel: { [fam.nova.id]: 6700, [fam.orion.id]: 7100 }, createdAt: f.now() });
  assert.deepEqual(cfg.rocketMigration, { v2Id: '1788000000000', rocketId: result.rocketId, at: f.now() }, 'the marker sits beside the rocket, without the operator');
  assert.deepEqual(cfg.rocketHistory, []); assert.deepEqual(cfg.rewards, []);
  // the same keys, in the same order, as a rocket the parent route builds
  const g = fixture(), k = await g.childSession(); g.advance(2000); const other = await g.login('parentA');
  await g.game.rocket(other.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 100, minEach: 0, crewChildIds: [k.child.id] });
  assert.deepEqual(Object.keys(cfg.rocket), Object.keys((await configOf(g, k.p.familyId)).rocket));
  // the parent workspace reads it as any other rocket, and neither it nor the family export shows the marker
  const view = await f.game.parentState(fam.parent.ctx);
  assert.equal(view.rocket.totalFuel, 13800); assert.equal(view.rocket.status, 'fueling'); assert.equal(view.rocket.id, result.rocketId);
  assert.deepEqual(view.rocket.fuel, { [fam.nova.id]: 6700, [fam.orion.id]: 7100 }); assert.deepEqual(view.rocketHistory, []);
  for (const c of view.children) assert.equal(c.wallet.ledgerSeq, 1, `${c.child.nickname} still has only the migration opening row`);
  const exported = await f.support.exportFamily(fam.parent.ctx);
  assert.equal(exported.gameConfig.rocket.id, result.rocketId);
  for (const [what, body] of [['parent workspace', view], ['family export', exported]]) assert.ok(!JSON.stringify(body).includes('rocketMigration'), `the ${what} never carries the marker`);
  const audits = auditsOf(f, 'rocket.migrated'); assert.equal(audits.length, 1);
  assert.equal(audits[0].actor, 'test-operator'); assert.equal(audits[0].reason, 'migrate synthetic rocket'); assert.equal(audits[0].familyId, fam.familyId);
  assert.deepEqual(audits[0].summary, { rocketId: result.rocketId, v2Id: '1788000000000', v2CreatedOn: '2026-08-29', v2CreatedAt: 1788000000000, v2HistoryCount: 0,
    currency: 'rp', goal: 20000, minEach: 10000, totalFuel: 13800,
    crew: [{ childId: fam.nova.id, fuel: 6700, spent: 6700, otherSpent: 0 }, { childId: fam.orion.id, fuel: 7100, spent: 7100, otherSpent: 0 }] });
  // ids and numbers only: audit rows outlive a family's deletion (PRIVACY.md)
  for (const secret of ['nova', 'Nova', 'orion', 'Orion', 'Theme park', '🎡']) assert.ok(!JSON.stringify(audits[0]).includes(secret), `the audit row never holds ${secret}`);
  assert.equal(audits[0].childId, null); assert.equal(audits[0].at, f.now()); assert.equal(audits[0].expireAt, f.now() + 400 * 24 * 60 * 60_000, 'the audit TTL is 400 days');
  // a second run of the same file, with the rocket still in the tank, meets the marker before ROCKET_EXISTS
  await assert.rejects(rocketRun(f, fam, { reason: 'second attempt' }), rejected('V2_ROCKET_ALREADY_IMPORTED'));
  assert.equal((await configOf(f, fam.familyId)).rocket.id, result.rocketId); assert.equal(auditsOf(f, 'rocket.migrated').length, 1);
});

test('the importer refuses swapped ids, a nickname that is not the v2 name, a child not imported from v2, and v2 spending below the fuel, and writes nothing', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  const untouched = async () => { assert.equal(await configOf(f, fam.familyId), null, 'the config is untouched'); assert.equal(auditsOf(f, 'rocket.migrated').length, 0); };
  // swapped: each id is a real active child of the family, but each would get the other's fuel
  await assert.rejects(rocketRun(f, fam, { crewMap: { nova: fam.orion.id, orion: fam.nova.id } }), rejected('V2_ROCKET_CREW_NAME_MISMATCH:nova')); await untouched();
  const orionPath = `families/${fam.familyId}/children/${fam.orion.id}`, orion = await f.store.get(orionPath);
  await f.store.put(orionPath, { ...orion, nickname: 'Vega' });
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_CREW_NAME_MISMATCH:orion')); await untouched();
  await f.store.put(orionPath, orion);
  // the rocket before the children: no legacy block, so no carried balance the fuel was taken from
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_CHILD_NOT_IMPORTED:nova')); await untouched();
  await importLearning(f.store, { familyId: fam.familyId, childId: fam.nova.id, record: richV2(70, 6700), actor: 'test-operator', reason: 'migrate synthetic child' }, f.now());
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_CHILD_NOT_IMPORTED:orion')); await untouched();
  // a child whose v2 RP spending is one short of their fuel: one point of it never left the carried balance
  await importLearning(f.store, { familyId: fam.familyId, childId: fam.orion.id, record: richV2(75, 7099), actor: 'test-operator', reason: 'migrate synthetic child' }, f.now());
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_FUEL_SPENT_MISMATCH:orion')); await untouched();
  // a GC rocket is checked against GC spending (these children spent none)
  await assert.rejects(rocketRun(f, fam, { v2Rocket: { ...v2Rocket(), currency: 'gc', goal: 20000 } }), rejected('V2_ROCKET_FUEL_SPENT_MISMATCH:nova')); await untouched();
});

test('importRocket refuses a missing or deleted family, an id that is not this family\'s child, a child who is not active, and a rocket the parent built', async () => {
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const run = (patch) => rocketRun(f, fam, patch);
  await assert.rejects(run({ familyId: randomUUID() }), rejected('FAMILY_NOT_FOUND'));
  const famPath = `families/${fam.familyId}`, family = await f.store.get(famPath);
  await f.store.put(famPath, { ...family, deletion: { status: 'executing' } });
  await assert.rejects(run(), rejected('FAMILY_DELETED'), 'a deletion under way admits no import');
  await f.store.put(famPath, { ...family, deleted: true });
  await assert.rejects(run(), rejected('FAMILY_DELETED'));
  await f.store.put(famPath, family);
  const stranger = await f.childSession('parentB');
  await assert.rejects(run({ crewMap: { nova: fam.nova.id, orion: stranger.child.id } }), rejected('CHILD_NOT_FOUND'));
  await assert.rejects(run({ crewMap: { nova: fam.nova.id, orion: randomUUID() } }), rejected('CHILD_NOT_FOUND'));
  // the child document is there, but the family does not list the child
  await f.store.put(famPath, { ...family, childIds: [fam.nova.id] });
  await assert.rejects(run(), rejected('CHILD_NOT_FOUND'));
  // refused before any store read: the conversion's own checks
  await f.store.put(famPath, family);
  await assert.rejects(run({ crewMap: { nova: fam.nova.id } }), rejected('V2_ROCKET_UNMAPPED_CREW:orion'));
  await assert.rejects(run({ crewMap: { ...fam.crewMap, vega: randomUUID() } }), rejected('V2_ROCKET_MAPPING_WITHOUT_CREW:vega'));
  await assert.rejects(run({ v2Rocket: { ...v2Rocket(), currency: 'usd' } }), rejected('V2_ROCKET_INVALID:currency'));
  await assert.rejects(run({ v2Rocket: { ...v2Rocket(), fuel: { nova: 6700.5, orion: 7100 } } }), rejected('V2_ROCKET_INVALID:fuel.nova'));
  await assert.rejects(run({ reason: 'no' }), rejected('INVALID_REQUEST'));
  // a seat taken away: the child is still in the family but no longer active
  await f.store.put(famPath, { ...family, activeChildIds: [fam.nova.id] });
  await assert.rejects(run(), rejected('CHILD_INACTIVE'));
  await f.store.put(famPath, family);
  // the seat is still there, but the child document itself is not active
  const orionPath = `families/${fam.familyId}/children/${fam.orion.id}`, orion = await f.store.get(orionPath);
  await f.store.put(orionPath, { ...orion, status: 'inactive' });
  await assert.rejects(run(), rejected('CHILD_INACTIVE'));
  await f.store.put(orionPath, orion);
  assert.equal(await configOf(f, fam.familyId), null, 'no refusal wrote a config'); assert.equal(auditsOf(f, 'rocket.migrated').length, 0);
  // a rocket the parent already built is never replaced, fuelling or launched
  await f.game.rocket(fam.parent.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 100, minEach: 0, crewChildIds: [fam.nova.id] });
  await assert.rejects(run(), rejected('ROCKET_EXISTS'));
  const built = (await configOf(f, fam.familyId)).rocket;
  await f.game.rocket(fam.parent.ctx, { action: 'launch', rocketId: built.id });
  await assert.rejects(run(), rejected('ROCKET_EXISTS'));
  assert.equal((await configOf(f, fam.familyId)).rocket.id, built.id); assert.equal(auditsOf(f, 'rocket.migrated').length, 0);
  // once the parent clears it, the import may run — and the history the parent made is left exactly as it was
  await f.game.rocket(fam.parent.ctx, { action: 'claim', rocketId: built.id });
  const history = (await configOf(f, fam.familyId)).rocketHistory;
  await run(); const cfg = await configOf(f, fam.familyId);
  assert.deepEqual(cfg.rocketHistory, history); assert.equal(cfg.rocket.goal, 20000);
});

test('rewards the parent saved through the rewards route before the import are exactly the same after it', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  const rewards = [{ id: 'pocket-money', emoji: '💴', name: 'Pocket money', cost: 100, hidden: false, cap: 0, childIds: [fam.nova.id, fam.orion.id] }];
  await f.game.setRewards(fam.parent.ctx, { rewards });
  const before = await configOf(f, fam.familyId);
  await importCrew(f, fam); await rocketRun(f, fam);
  const after = await configOf(f, fam.familyId);
  assert.deepEqual(after.rewards, before.rewards); assert.deepEqual(after.rewards, rewards);
  assert.deepEqual((await f.game.parentState(fam.parent.ctx)).rewards, rewards);
});

test('a transaction retried after its own commit finds its own marker and reports alreadyWritten instead of refusing itself', async () => {
  // Firestore can run a transaction function again when a commit landed but the reply was lost. This store
  // does exactly that: it runs the function and commits, then runs the same function again on the committed
  // data and returns the second answer. The rocket id is drawn before the transaction, so both runs share it.
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const replaying = { transaction: async (fn, options) => { await f.store.transaction(fn, options); return f.store.transaction(fn, options); } };
  const result = await rocketRun(f, fam, {}, replaying);
  assert.equal(result.alreadyWritten, true, 'the second run saw the first run\'s commit');
  assert.deepEqual(result.crew.map((c) => [c.name, c.fuel, c.spent]), [['nova', 6700, 6700], ['orion', 7100, 7100]]);
  const cfg = await configOf(f, fam.familyId);
  assert.equal(cfg.rocket.id, result.rocketId); assert.equal(cfg.rocketMigration.rocketId, result.rocketId);
  assert.equal(auditsOf(f, 'rocket.migrated').length, 1, 'one import, one audit row');
  // a genuinely new run is a second import, and is refused
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_ALREADY_IMPORTED'));
});

test('a child can fuel the imported rocket through the normal game route, and the total moves from the carried fuel', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  await importCrew(f, fam, { nova: [70, 6700] }); // a carried balance of 300 RP
  const { rocketId } = await rocketRun(f, fam);
  const novaCtx = await childCtx(f, fam.nova.id);
  const seen = (await f.game.state(novaCtx));
  assert.equal(seen.rocket.totalFuel, 13800); assert.equal(seen.rocket.myFuel, 6700); assert.equal(seen.rocket.isCrew, true); assert.equal(seen.rocket.currency, 'rp');
  assert.ok(!JSON.stringify(seen).includes('rocketMigration'), 'the child view never carries the marker');
  const fueled = await f.game.fuel(novaCtx, { rocketId, amount: 100, operationId: randomUUID() });
  assert.equal(fueled.rocket.totalFuel, 13900); assert.equal(fueled.rocket.myFuel, 6800); assert.equal(fueled.rocket.status, 'fueling'); assert.equal(fueled.wallet.rp, 200);
  assert.deepEqual(await ledgerOf(f, fam, 'nova'), [['migrate.opening', 300], ['rocket.fuel', -100]], 'the only fuel that ever touched the ledger is the fuel poured in v3');
  const cfg = await configOf(f, fam.familyId);
  assert.equal(cfg.rocket.fuel[fam.orion.id], 7100); assert.equal(cfg.rocketMigration.rocketId, rocketId, 'the fuel route keeps the marker');
});

test('pouring into the imported rocket until both children reach the minimum launches it, the parent\'s claim files the carried plus poured fuel, and the same file cannot be imported again', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  // v2 earned 10,000 RP each: 6,700 and 7,100 went into the v2 rocket, so 3,300 and 2,900 are carried
  await importCrew(f, fam, { nova: [100, 6700], orion: [100, 7100] });
  const { rocketId } = await rocketRun(f, fam);
  const novaPoured = await pour(f, await childCtx(f, fam.nova.id), rocketId, 3300);
  assert.equal(novaPoured.rocket.myFuel, 10000); assert.equal(novaPoured.rocket.totalFuel, 17100); assert.equal(novaPoured.rocket.status, 'fueling', 'the goal is not reached yet');
  assert.equal(novaPoured.wallet.rp, 0);
  const orionPoured = await pour(f, await childCtx(f, fam.orion.id), rocketId, 2900);
  assert.equal(orionPoured.rocket.totalFuel, 20000); assert.equal(orionPoured.rocket.status, 'launched', 'both at the minimum and the goal reached: it launches on the pour');
  assert.equal(orionPoured.wallet.rp, 0);
  f.advance(2000); const parent = await f.login('parentA');
  const claimed = await f.game.rocket(parent.ctx, { action: 'claim', rocketId });
  assert.equal(claimed.rocket, null);
  const filed = claimed.rocketHistory.at(-1);
  assert.equal(filed.id, rocketId); assert.equal(filed.status, 'claimed');
  assert.deepEqual(filed.fuel, { [fam.nova.id]: 6700 + 3300, [fam.orion.id]: 7100 + 2900 }, 'the carried v2 fuel plus the v3 pours');
  for (const [name, poured] of [['nova', 3300], ['orion', 2900]]) {
    const rows = await ledgerOf(f, fam, name);
    assert.equal(rows.filter(([type]) => type === 'rocket.fuel').reduce((a, [, rp]) => a + rp, 0), -poured, `${name}: only the v3 pours are in the ledger`);
  }
  await assert.rejects(rocketRun(f, fam, { reason: 'import the same file again' }), rejected('V2_ROCKET_ALREADY_IMPORTED'));
  const cfg = await configOf(f, fam.familyId); assert.equal(cfg.rocket, null); assert.equal(cfg.rocketHistory.length, 1); assert.equal(auditsOf(f, 'rocket.migrated').length, 1);
});

test('the parent can scrap an imported rocket like any other, and the scrapped rocket keeps its carried fuel in the history', async () => {
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const { rocketId } = await rocketRun(f, fam);
  const scrapped = await f.game.rocket(fam.parent.ctx, { action: 'scrap', rocketId });
  assert.equal(scrapped.rocket, null); assert.equal(scrapped.rocketHistory.at(-1).status, 'scrapped');
  assert.deepEqual(scrapped.rocketHistory.at(-1).fuel, { [fam.nova.id]: 6700, [fam.orion.id]: 7100 });
  assert.ok(!JSON.stringify(scrapped).includes('rocketMigration'), 'the rocket route never returns the marker');
  // the marker outlives the rocket, so the v2 fuel cannot be poured into a second rocket
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_ALREADY_IMPORTED'));
  // and the family carries on: the parent builds a rocket of their own
  const built = await f.game.rocket(fam.parent.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 100, minEach: 0, crewChildIds: [fam.nova.id] });
  assert.equal(built.rocket.status, 'fueling'); assert.equal((await configOf(f, fam.familyId)).rocketMigration.rocketId, rocketId);
});

test('the operator tool previews a rocket and a child without writing, checks names and the family id on the dry run, and its child form is unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-migrate-'));
  try {
    const script = fileURLToPath(new URL('../scripts/migrate-v2.mjs', import.meta.url));
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-migrate', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088' };
    const run = (...args) => execFileSync(process.execPath, [script, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const family = randomUUID(), a = randomUUID(), b = randomUUID();
    const rocketFile = join(dir, 'rocket.json'); await writeFile(rocketFile, `﻿${JSON.stringify(v2Rocket())}`); // with a BOM, as Windows tools write
    const out = run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, 'pilot cutover');
    assert.match(out, /"event": "rocket_migration_preview"/); assert.match(out, /"totalFuel": 13800/); assert.match(out, /Nothing was written/);
    assert.match(out, /^Checked only on the write: family membership and deletion, active seats, nicknames, v2 spending equal to fuel plus other spending, and the one-shot marker\.$/m);
    assert.match(out, /^Dry run\. Put CONFIRM_MIGRATION=rocket in front of this same command to import the rocket\. Nothing was written\.$/m);
    assert.match(out, /"otherSpent": 0/);
    assert.throws(() => run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`), /Usage/, 'a missing reason is caught, not read from the last mapping');
    assert.throws(() => run('rocket', family, rocketFile, `nova=${a}`, 'pilot cutover'), /V2_ROCKET_UNMAPPED_CREW:orion/);
    assert.throws(() => run('rocket', 'not-a-family', rocketFile, `nova=${a}`, `orion=${b}`, 'pilot cutover'), /INVALID_ID/, 'the family id is checked on the dry run');
    for (const name of ['n'.repeat(41), 'Nova', 'no va', 'nova!']) assert.throws(() => run('rocket', family, rocketFile, `${name}=${a}`, `orion=${b}`, 'pilot cutover'), /Usage/, `crew name ${name}`);
    assert.throws(() => run('rocket', family, rocketFile, `nova=${a}`, `nova=${b}`, 'pilot cutover'), /Usage/, 'a name given twice');
    // a name that is a property of Object.prototype is an ordinary key of the null-prototype map, refused by the importer as unmapped crew, never inherited
    assert.throws(() => run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, `constructor=${randomUUID()}`, 'pilot cutover'), /V2_ROCKET_MAPPING_WITHOUT_CREW:constructor/);
    const childFile = join(dir, 'child.json'); await writeFile(childFile, `﻿${JSON.stringify(v2())}`);
    const childOut = run(family, a, childFile, 'pilot cutover');
    assert.match(childOut, /"event": "migration_preview"/); assert.match(childOut, /"passes": 7/); assert.match(childOut, /Nothing was written/);
    assert.doesNotMatch(childOut, /Checked only on the write/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the operator tool\'s dry run never loads firebase-admin, for either form, and the write path would', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-migrate-'));
  try {
    // A module hook that refuses to resolve firebase-admin at all. Loaded with --import before the script,
    // it sees every static and dynamic import; if the dry run so much as reached for the SDK, it would fail.
    const hook = join(dir, 'no-firebase-admin.mjs');
    await writeFile(hook, `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { if (specifier === 'firebase-admin' || specifier.startsWith('firebase-admin/')) throw Error('FIREBASE_ADMIN_LOADED:' + specifier); return next(specifier, context); } });\n`);
    const script = fileURLToPath(new URL('../scripts/migrate-v2.mjs', import.meta.url));
    const base = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-migrate', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088' };
    const run = (env, ...args) => execFileSync(process.execPath, ['--import', pathToFileURL(hook).href, script, ...args], { env: { ...base, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const family = randomUUID(), a = randomUUID(), b = randomUUID();
    const rocketFile = join(dir, 'rocket.json'); await writeFile(rocketFile, JSON.stringify(v2Rocket()));
    const childFile = join(dir, 'child.json'); await writeFile(childFile, JSON.stringify(v2()));
    const rocketArgs = ['rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, 'pilot cutover'], childArgs = [family, a, childFile, 'pilot cutover'];
    assert.match(run({}, ...rocketArgs), /Nothing was written/);
    assert.match(run({}, ...childArgs), /Nothing was written/);
    // each form has its own token: a `write` left over from the child step is a rocket DRY RUN, and `rocket` never writes a child
    const leftover = run({ CONFIRM_MIGRATION: 'write' }, ...rocketArgs);
    assert.match(leftover, /Nothing was written/); assert.match(leftover, /CONFIRM_MIGRATION=write confirms the child form only; the rocket form writes only with CONFIRM_MIGRATION=rocket\./);
    assert.match(run({ CONFIRM_MIGRATION: 'rocket' }, ...childArgs), /Nothing was written/);
    for (const token of ['Rocket', 'rocket ', 'yes', '1']) assert.match(run({ CONFIRM_MIGRATION: token }, ...rocketArgs), /Nothing was written/, `token ${JSON.stringify(token)}`);
    // the control: the same hook stops the write path at its first reach for the SDK, before anything is contacted
    for (const [token, args] of [['rocket', rocketArgs], ['write', childArgs]]) {
      assert.throws(() => run({ CONFIRM_MIGRATION: token }, ...args), (e) => /FIREBASE_ADMIN_LOADED:firebase-admin\/app/.test(e.stderr), 'the hook is live');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- review round 3 ------------------------------------------------------------------------------

test('convertRocketV2 names a wrong file instead of calling it a damaged rocket', () => {
  const map = { nova: randomUUID(), orion: randomUUID() };
  const wrong = (v, why) => assert.throws(() => convertRocketV2(v, map, { now: T }), rejected('V2_ROCKET_WRONG_FILE'), why);
  wrong({ rocket: v2Rocket() }, 'the node still inside its wrapper');
  wrong({ rocket: v2Rocket(), players: {}, settings: {} }, 'the whole family export');
  wrong(v2(), 'a child record');
  for (const key of ['level', 'wallet', 'nav', 'paper', 'bossCleared', 'pin']) wrong({ ...v2Rocket(), [key]: 1 }, `a child key: ${key}`);
  wrong({ history: [row({})] }, 'a child history with nothing of a rocket');
  wrong({}, 'nothing a rocket has'); wrong({ nova: v2(), orion: v2() }, 'the players map');
  // a JSON file whose only key is "__proto__" is read as an own key, and is not a rocket either
  wrong(JSON.parse('{"__proto__": {"status": "fueling"}}'), 'a __proto__ key is not a rocket');
  // not an object at all is still the damaged-shape refusal
  for (const v of [null, [], 'rocket', 7]) assert.throws(() => convertRocketV2(v, map, { now: T }), rejected('V2_ROCKET_INVALID:shape'));
});

test('convertRocketV2 reads crew fuel as own keys only, and refuses crew names that are empty, padded or upper case', () => {
  const a = randomUUID(), b = randomUUID();
  // "constructor" is on every object's prototype; with no fuel of its own it has 0, never Object's constructor
  const { summary, rocket } = convertRocketV2({ ...v2Rocket(), crew: ['constructor', 'orion'], fuel: { orion: 7100 } }, { constructor: a, orion: b }, { now: T });
  assert.equal(summary.crew[0].fuel, 0); assert.deepEqual(rocket.fuel, { [b]: 7100 }); assert.equal(summary.totalFuel, 7100);
  const fromJson = JSON.parse('{"status":"fueling","currency":"rp","goal":20000,"minEach":10000,"prize":{"emoji":"🎡","name":"Ride"},"crew":["__proto__","orion"],"fuel":{"orion":7100}}');
  assert.equal(convertRocketV2(fromJson, Object.assign(Object.create(null), { ['__proto__']: a, orion: b }), { now: T }).summary.crew[0].fuel, 0);
  for (const bad of [['Nova', 'orion'], [' nova', 'orion'], ['nova ', 'orion'], ['', 'orion'], ['NOVA', 'orion'], ['nov\uD800', 'orion']]) {
    assert.throws(() => convertRocketV2({ ...v2Rocket(), crew: bad, fuel: { orion: 7100 } }, { [bad[0]]: a, orion: b }, { now: T }), rejected('V2_ROCKET_INVALID:crew'), JSON.stringify(bad[0]));
  }
});

test('convertRocketV2 counts the v2 history, keeps v2 createdAt, and keeps only id- and date-shaped v2 values', () => {
  const map = { nova: randomUUID(), orion: randomUUID() };
  const conv = (patch) => convertRocketV2({ ...v2Rocket(), ...patch }, map, { now: T }).summary;
  assert.equal(conv({ history: [{ id: 1 }, { id: 2 }] }).v2HistoryCount, 2); assert.equal(conv({ history: [] }).v2HistoryCount, 0); assert.equal(conv({ history: null }).v2HistoryCount, 0);
  for (const history of ['two', 2, { a: 1 }]) assert.throws(() => convertRocketV2({ ...v2Rocket(), history }, map, { now: T }), rejected('V2_ROCKET_INVALID:history'));
  const { id, ...noId } = v2Rocket(); assert.ok(id);
  assert.equal(convertRocketV2(noId, map, { now: T }).summary.v2Id, null);
  assert.equal(conv({ id: 1788000000000 }).v2Id, '1788000000000'); assert.equal(conv({ id: '-Nx_ab-9' }).v2Id, '-Nx_ab-9');
  for (const v of [{ n: 1 }, 'Allison rocket', '', -1, 1.5]) assert.equal(conv({ id: v }).v2Id, null, JSON.stringify(v));
  for (const v of ['Allison', '29/08/2026', 20260829]) assert.equal(conv({ createdOn: v }).v2CreatedOn, null, JSON.stringify(v));
  assert.equal(conv({ createdAt: '1788000000000' }).v2CreatedAt, null); assert.equal(conv({ createdAt: 0 }).v2CreatedAt, null);
  const { createdAt, ...noCreated } = v2Rocket(); assert.ok(createdAt); assert.equal(convertRocketV2(noCreated, map, { now: T }).summary.v2CreatedAt, null);
});

test('convertRocketV2 takes other spending per crew name only, as whole non-negative points, 0 when not declared', () => {
  const map = { nova: randomUUID(), orion: randomUUID() };
  assert.deepEqual(convertRocketV2(v2Rocket(), map, { now: T, otherSpent: { orion: 300 } }).summary.crew.map((c) => c.otherSpent), [0, 300]);
  assert.deepEqual(convertRocketV2(v2Rocket(), map, { now: T, otherSpent: Object.assign(Object.create(null), { nova: 0 }) }).summary.crew.map((c) => c.otherSpent), [0, 0]);
  assert.throws(() => convertRocketV2(v2Rocket(), map, { now: T, otherSpent: { vega: 1 } }), rejected('V2_ROCKET_OTHER_SPENT_WITHOUT_CREW:vega'));
  for (const v of [-1, 1.5, '100', null, 2 ** 53]) assert.throws(() => convertRocketV2(v2Rocket(), map, { now: T, otherSpent: { nova: v } }), rejected('V2_ROCKET_OTHER_SPENT_INVALID:nova'), String(v));
  for (const v of [null, [], 'nova=1']) assert.throws(() => convertRocketV2(v2Rocket(), map, { now: T, otherSpent: v }), rejected('V2_ROCKET_OTHER_SPENT_INVALID'));
});

test('rocketPrize refuses a lone surrogate in the emoji or the name, and allows 12 UTF-16 units of emoji but not 13, for the import and the build route alike', async () => {
  assert.deepEqual(rocketPrize({ emoji: '🎡'.repeat(6), name: 'Ride' }), { emoji: '🎡'.repeat(6), name: 'Ride' }); // 12 units
  assert.equal('🎡'.repeat(6).length, 12);
  for (const prize of [{ emoji: `${'🎡'.repeat(6)}x`, name: 'Ride' }, { emoji: '\uD83C', name: 'Ride' }, { emoji: '🎡', name: 'Ride \uDFA1' }, { emoji: '🎡', name: '\uD83C\uD83C' }, { emoji: 7, name: 'Ride' }]) {
    assert.throws(() => rocketPrize(prize), (e) => e.status === 400 && e.code === 'INVALID_REQUEST', JSON.stringify(prize));
  }
  const map = { nova: randomUUID(), orion: randomUUID() };
  assert.equal(convertRocketV2({ ...v2Rocket(), prize: { emoji: '🎡'.repeat(6), name: 'Ride' } }, map, { now: T }).rocket.prize.emoji, '🎡'.repeat(6));
  for (const prize of [{ emoji: `${'🎡'.repeat(6)}x`, name: 'Ride' }, { emoji: '\uD83C', name: 'Ride' }, { emoji: '🎡', name: 'Ride \uDFA1' }]) {
    assert.throws(() => convertRocketV2({ ...v2Rocket(), prize }, map, { now: T }), rejected('V2_ROCKET_INVALID:prize'));
  }
  const f = fixture(), k = await f.childSession(); f.advance(2000); const parent = await f.login('parentA');
  const build = (prize) => f.game.rocket(parent.ctx, { action: 'build', prize, currency: 'gc', goal: 100, minEach: 0, crewChildIds: [k.child.id] });
  for (const prize of [{ emoji: '\uD83C', name: 'Ice cream' }, { emoji: '🍦', name: 'Ice \uDC00cream' }, { emoji: '🍦'.repeat(6) + 'x', name: 'Ice cream' }]) {
    await assert.rejects(build(prize), (e) => e.status === 400 && e.code === 'INVALID_REQUEST');
  }
  assert.equal(await f.store.get(`families/${k.p.familyId}/game/config`), null);
  assert.equal((await build({ emoji: '🍦'.repeat(6), name: 'Ice cream' })).rocket.prize.emoji, '🍦'.repeat(6));
});

test('the write enforces spent = fuel + declared other spending, both ways, reads the legacy block and never the wallet, and tells the operator both numbers', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  await importCrew(f, fam, { nova: [70, 6700], orion: [80, 7400] }); // orion spent 300 in v2 on something that is not this rocket
  const untouched = async () => { assert.equal(await configOf(f, fam.familyId), null); assert.equal(auditsOf(f, 'rocket.migrated').length, 0); };
  // more spending than fuel, undeclared: refused, with the numbers
  const err = await rocketRun(f, fam).then(() => null, (e) => e);
  assert.equal(err.code, 'V2_ROCKET_FUEL_SPENT_MISMATCH:orion'); assert.equal(err.status, 409);
  assert.deepEqual(err.detail, { name: 'orion', childId: fam.orion.id, spentKey: 'rpSpent', spent: 7400, fuel: 7100, otherSpent: 0, expected: 7100 });
  const lines = rocketRefusalLines(err).join('\n');
  assert.match(lines, /rpSpent 7400/); assert.match(lines, /fuel 7100 \+ declared other spending 0 = 7100/); assert.match(lines, /300 of the v2 spending is not accounted for/);
  await untouched();
  // declared, but wrong: too much, then too little
  await assert.rejects(rocketRun(f, fam, { otherSpent: { orion: 301 } }), rejected('V2_ROCKET_FUEL_SPENT_MISMATCH:orion')); await untouched();
  const short = await rocketRun(f, fam, { otherSpent: { orion: 299 } }).then(() => null, (e) => e);
  assert.equal(short.code, 'V2_ROCKET_FUEL_SPENT_MISMATCH:orion'); assert.match(rocketRefusalLines(short).join('\n'), /1 of the v2 spending is not accounted for/);
  // declared for the wrong child: nova's equality now fails
  await assert.rejects(rocketRun(f, fam, { otherSpent: { nova: 300 } }), rejected('V2_ROCKET_FUEL_SPENT_MISMATCH:nova')); await untouched();
  const lessErr = await rocketRun(f, fam, { otherSpent: { nova: 300 } }).then(() => null, (e) => e);
  assert.match(rocketRefusalLines(lessErr).join('\n'), /The v2 spending is 300 short/);
  // the legacy block decides, not the wallet: a wallet figure that disagrees changes nothing
  const orionDoc = `families/${fam.familyId}/learning/${fam.orion.id}`, stored = await f.store.get(orionDoc);
  await f.store.put(orionDoc, { ...stored, wallet: { ...stored.wallet, rpSpent: 7100 } });
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_FUEL_SPENT_MISMATCH:orion'), 'wallet.rpSpent equal to the fuel does not make legacy.rpSpent equal'); await untouched();
  await f.store.put(orionDoc, { ...stored, wallet: { ...stored.wallet, rpSpent: 0 } });
  // declared exactly: written, and the audit row carries the declaration
  const result = await rocketRun(f, fam, { otherSpent: { orion: 300 } });
  assert.deepEqual(result.crew.map((c) => [c.name, c.fuel, c.otherSpent, c.spent]), [['nova', 6700, 0, 6700], ['orion', 7100, 300, 7400]]);
  assert.deepEqual(auditsOf(f, 'rocket.migrated')[0].summary.crew, [{ childId: fam.nova.id, fuel: 6700, spent: 6700, otherSpent: 0 }, { childId: fam.orion.id, fuel: 7100, spent: 7400, otherSpent: 300 }]);
  assert.equal((await f.store.get(orionDoc)).wallet.rpSpent, 0, 'the wallet was not touched');
});

test('the legacy figure decides the other way too: a legacy block that differs from an equal wallet is refused, and one missing its figure is refused', async () => {
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const novaDoc = `families/${fam.familyId}/learning/${fam.nova.id}`, stored = await f.store.get(novaDoc);
  assert.equal(stored.wallet.rpSpent, 6700);
  await f.store.put(novaDoc, { ...stored, legacy: { ...stored.legacy, rpSpent: 6600 } });
  await assert.rejects(rocketRun(f, fam), rejected('V2_ROCKET_FUEL_SPENT_MISMATCH:nova'));
  const { rpSpent, ...noFigure } = stored.legacy; assert.equal(rpSpent, 6700);
  await f.store.put(novaDoc, { ...stored, legacy: noFigure });
  const err = await rocketRun(f, fam).then(() => null, (e) => e);
  assert.equal(err.code, 'V2_ROCKET_FUEL_SPENT_MISMATCH:nova'); assert.equal(err.detail.spent, null); assert.match(rocketRefusalLines(err).join('\n'), /rpSpent missing/);
  assert.equal(await configOf(f, fam.familyId), null);
});

test('a v2 rocket with earlier rockets in its history is carried only when their spending is declared, and the summary and audit row count them', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  await importCrew(f, fam, { nova: [70, 7700], orion: [75, 7600] }); // an earlier rocket took 1,000 and 500
  const file = { ...v2Rocket(), history: [{ id: '1780000000000', status: 'claimed', fuel: { nova: 1000, orion: 500 } }] };
  await assert.rejects(rocketRun(f, fam, { v2Rocket: file }), rejected('V2_ROCKET_FUEL_SPENT_MISMATCH:nova'));
  const result = await rocketRun(f, fam, { v2Rocket: file, otherSpent: { nova: 1000, orion: 500 } });
  assert.equal(result.v2HistoryCount, 1); assert.equal(result.v2CreatedAt, 1788000000000);
  const audit = auditsOf(f, 'rocket.migrated')[0].summary;
  assert.equal(audit.v2HistoryCount, 1); assert.equal(audit.v2CreatedAt, 1788000000000);
  assert.deepEqual((await configOf(f, fam.familyId)).rocket.fuel, { [fam.nova.id]: 6700, [fam.orion.id]: 7100 }, 'only this rocket\'s fuel is carried');
});

test('V2_ROCKET_ALREADY_IMPORTED carries the existing marker\'s rocketId and time for the operator', async () => {
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const first = await rocketRun(f, fam); const at = f.now();
  f.advance(60_000);
  const err = await rocketRun(f, fam, { reason: 'second attempt' }).then(() => null, (e) => e);
  assert.equal(err.code, 'V2_ROCKET_ALREADY_IMPORTED'); assert.deepEqual(err.detail, { rocketId: first.rocketId, at });
  const line = rocketRefusalLines(err).join('\n');
  assert.ok(line.includes(first.rocketId)); assert.ok(line.includes(String(at)) && line.includes(new Date(at).toISOString())); assert.match(line, /Do not retry/);
  assert.deepEqual(rocketRefusalLines(Object.assign(new Error('x'), { code: 'ROCKET_EXISTS' })), [], 'a refusal without numbers prints nothing extra');
});

test('importRocket checks its own arguments when called directly: a bad family id and a too-short actor are refused before any read', async () => {
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const reads = []; const spy = { transaction: (fn, o) => { reads.push('tx'); return f.store.transaction(fn, o); } };
  await assert.rejects(rocketRun(f, fam, { familyId: 'not-a-uuid' }, spy), rejected('INVALID_ID'));
  await assert.rejects(rocketRun(f, fam, { familyId: fam.familyId.toUpperCase() }, spy), rejected('INVALID_ID'));
  await assert.rejects(rocketRun(f, fam, { actor: 'ab' }, spy), rejected('INVALID_REQUEST'));
  await assert.rejects(rocketRun(f, fam, { actor: undefined }, spy), rejected('INVALID_REQUEST'));
  assert.deepEqual(reads, [], 'no transaction was opened'); assert.equal(await configOf(f, fam.familyId), null);
  await rocketRun(f, fam, { actor: 'abc' }, spy); assert.deepEqual(reads, ['tx'], 'three characters is enough');
});

test('a v2 rocket without an id is still carried, with v2Id null in the marker and the audit row', async () => {
  const f = fixture(); const fam = await crewFamily(f); await importCrew(f, fam);
  const { id, ...file } = v2Rocket(); assert.ok(id);
  const result = await rocketRun(f, fam, { v2Rocket: file });
  assert.equal(result.v2Id, null);
  assert.deepEqual((await configOf(f, fam.familyId)).rocketMigration, { v2Id: null, rocketId: result.rocketId, at: f.now() });
  assert.equal(auditsOf(f, 'rocket.migrated')[0].summary.v2Id, null);
});

test('neither import runs into a family with a deletion request, being deleted or deleted; a cancelled request lets both run', async () => {
  const f = fixture(); const fam = await crewFamily(f);
  const famPath = `families/${fam.familyId}`;
  const childRun = (name) => importLearning(f.store, { familyId: fam.familyId, childId: fam[name].id, record: richV2(70, v2Rocket().fuel[name]), actor: 'test-operator', reason: 'migrate synthetic child' }, f.now());
  // the parent asks for the deletion through the real route
  await f.support.requestDeletion(fam.parent.ctx, { operationId: randomUUID() });
  assert.ok((await f.store.get(famPath)).deletion, 'a deletion request is on the family');
  await assert.rejects(childRun('nova'), rejected('FAMILY_DELETION_PENDING'));
  assert.equal(await f.store.get(`families/${fam.familyId}/learning/${fam.nova.id}`), null);
  const requested = await f.store.get(famPath);
  for (const [what, doc] of [['executing', { ...requested, deletion: { ...requested.deletion, status: 'executing' } }], ['tombstone', { id: fam.familyId, deleted: true, childIds: [], activeChildIds: [], deletion: { ...requested.deletion, status: 'done' } }]]) {
    await f.store.put(famPath, doc);
    await assert.rejects(childRun('nova'), rejected('FAMILY_DELETED'), what);
  }
  await f.store.put(famPath, requested);
  // the parent takes it back: the children import
  await f.support.cancelDeletion(fam.parent.ctx, { operationId: randomUUID() });
  assert.equal((await f.store.get(famPath)).deletion, undefined);
  await childRun('nova'); await childRun('orion');
  // and the rocket is refused while a new request stands, and runs once it is cancelled
  await f.support.requestDeletion(fam.parent.ctx, { operationId: randomUUID() });
  await assert.rejects(rocketRun(f, fam), rejected('FAMILY_DELETION_PENDING'));
  const pending = await f.store.get(famPath);
  await f.store.put(famPath, { ...pending, deletion: { ...pending.deletion, status: 'cancelled' } });
  const result = await rocketRun(f, fam); assert.equal(result.alreadyWritten, false);
});

test('the operator tool: other.NAME=POINTS syntax, __proto__ and empty names, a wrong file, and the history warning on stderr', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'am-migrate-'));
  try {
    const script = fileURLToPath(new URL('../scripts/migrate-v2.mjs', import.meta.url));
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-migrate', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088' };
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
    const family = randomUUID(), a = randomUUID(), b = randomUUID();
    const rocketFile = join(dir, 'rocket.json'); await writeFile(rocketFile, JSON.stringify(v2Rocket()));
    const ok = (r) => { assert.equal(r.status, 0, r.stderr); return r; };
    const refused = (r, pattern, why) => { assert.notEqual(r.status, 0, why); assert.match(r.stderr, pattern, why); };
    // other spending: declared per child, shown in the preview
    const declared = ok(run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, 'other.orion=300', 'pilot cutover'));
    const preview = JSON.parse(declared.stdout.slice(0, declared.stdout.indexOf('\n}') + 2));
    assert.deepEqual(preview.crew.map((c) => [c.name, c.otherSpent]), [['nova', 0], ['orion', 300]]);
    ok(run('rocket', family, rocketFile, 'other.nova=0', `nova=${a}`, `orion=${b}`, 'pilot cutover')); // any order
    for (const bad of ['other.orion=-1', 'other.orion=1.5', 'other.orion=', 'other.orion=01', 'other.Orion=1', 'other.=1', 'other.orion=1e3', 'other.orion=99999999999999999']) {
      refused(run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, bad, 'pilot cutover'), /Usage/, bad);
    }
    refused(run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, 'other.orion=1', 'other.orion=2', 'pilot cutover'), /Usage/, 'declared twice');
    refused(run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, 'other.orion=1'), /Usage/, 'a declaration is not a reason');
    refused(run('rocket', family, rocketFile, 'other.orion=1', 'pilot cutover'), /Usage/, 'no mapping at all');
    refused(run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, 'other.vega=1', 'pilot cutover'), /V2_ROCKET_OTHER_SPENT_WITHOUT_CREW:vega/);
    // crew names the tool never takes, and one it takes as an own key only
    refused(run('rocket', family, rocketFile, `=${a}`, `orion=${b}`, 'pilot cutover'), /Usage/, 'an empty crew name');
    refused(run('rocket', family, rocketFile, ` nova=${a}`, `orion=${b}`, 'pilot cutover'), /Usage/, 'a padded crew name');
    refused(run('rocket', family, rocketFile, `nova=${a}`, `orion=${b}`, `__proto__=${randomUUID()}`, 'pilot cutover'), /V2_ROCKET_MAPPING_WITHOUT_CREW:__proto__/);
    // the wrong file of the export
    const wrapped = join(dir, 'wrapped.json'); await writeFile(wrapped, JSON.stringify({ rocket: v2Rocket() }));
    refused(run('rocket', family, wrapped, `nova=${a}`, `orion=${b}`, 'pilot cutover'), /V2_ROCKET_WRONG_FILE/);
    const childFile = join(dir, 'child.json'); await writeFile(childFile, JSON.stringify(v2()));
    refused(run('rocket', family, childFile, `nova=${a}`, `orion=${b}`, 'pilot cutover'), /V2_ROCKET_WRONG_FILE/);
    // earlier rockets in the history: a clear warning on stderr, on the dry run already; none without them
    const withHistory = join(dir, 'history.json'); await writeFile(withHistory, JSON.stringify({ ...v2Rocket(), history: [{ id: 'x' }, { id: 'y' }] }));
    const warned = ok(run('rocket', family, withHistory, `nova=${a}`, `orion=${b}`, 'pilot cutover'));
    assert.match(warned.stderr, /WARNING: this v2 rocket lists 2 earlier rocket\(s\) in its history/); assert.match(warned.stderr, /other\.NAME=POINTS/);
    assert.match(warned.stdout, /"v2HistoryCount": 2/);
    assert.doesNotMatch(declared.stderr, /WARNING/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a v2 family with no rocket in progress is told there is nothing to carry, never that it gave the wrong file', () => {
  const map = { nova: randomUUID(), orion: randomUUID() };
  const nodes = [{ id: 'none', status: 'claimed', history: [] }, { id: 'none', status: 'claimed', history: [{ id: '1', goal: 100 }] }, { id: 'none', status: 'claimed' }];
  for (const node of nodes) assert.throws(() => convertRocketV2(node, map, { now: T }), rejected('V2_ROCKET_NONE'), JSON.stringify(node));
});
