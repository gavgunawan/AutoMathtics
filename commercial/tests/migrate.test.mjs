// The one-off v2 → v3 import: v2's own economy applied to v2's rows, nothing merged, nothing
// overwritten, nothing reachable from a route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { convertV2, importLearning } from '../server/migrate.mjs';
import { assertFirestoreShape } from './support.mjs';

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
  assert.deepEqual(doc.wallet, { gc: 500 - 600 < 0 ? 0 : 500 - 600, rp: 1000 - 6500 < 0 ? 0 : 1000 - 6500, bonuses: 1 });
  assert.deepEqual(doc.wallet, { gc: 0, rp: 0, bonuses: 1 }); // spent more than earned under v2's manual credits → clamps at zero, never negative
  assert.equal(doc.history.length, 9); assert.equal(doc.history[0].quit, true); assert.equal(doc.history[0].track, 'nav'); assert.equal(doc.history[0].papers, '86–90'); assert.equal(doc.history[0].total, 15);
  const cp = doc.history.find((h) => h.mode === 'boss'); assert.equal(cp.papers, 'CP T1'); assert.deepEqual(cp.qlog, [{ t: 1, s: 4, ok: 1 }, { t: 1, s: 6, ok: 1 }]);
  assert.equal(doc.history.find((h) => h.mode === 'scan').papers, 'SCAN'); assert.equal(doc.history.find((h) => h.mode === 'practice').papers, 'practice 6–10');
  assert.equal(doc.history.find((h) => h.papers === '1–5').secs, 312); assert.equal(doc.history.find((h) => h.papers === '6–10').secs, null);
  assert.equal(doc.activeSession, null); assert.equal(doc.legacy.gcSpent, 600); assert.deepEqual(doc.legacy.inventory, ['pet_fox', 'title_dragon']); assert.deepEqual(doc.legacy.active, { activePet: 'pet_fox', activeTitle: 'title_dragon' });
  assert.ok(!JSON.stringify(doc).includes('8520'), 'the v2 PIN never enters the v3 document');
});
test('a record with more earned than spent carries the balance, and bad records are refused', () => {
  const r = v2(); r.wallet.gcSpent = 100; r.wallet.rpSpent = 0;
  const { doc } = convertV2(r, { now: 0 });
  assert.deepEqual(doc.wallet, { gc: 400, rp: 1000, bonuses: 1 });
  for (const bad of [null, [], { level: 9 }, { paper: 0 }, { nav: { bossCleared: 6 } }, { paper: 1.5 }]) assert.throws(() => convertV2(bad, { now: 0 }), /V2_RECORD_INVALID/);
  const { doc: empty } = convertV2({}, { now: 0 }); assert.deepEqual(empty.engine, { level: 0, paper: 1, bossCleared: 0 }); assert.deepEqual(empty.wallet, { gc: 0, rp: 0, bonuses: 0 });
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
