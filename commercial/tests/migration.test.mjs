import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateV2GameConfig, migrateV2Progress } from '../server/v2-migration.mjs';

const childA = '11111111-1111-4111-8111-111111111111';
const childB = '22222222-2222-4222-8222-222222222222';

function oldRow(date, extra = {}) {
  return { date, levelIdx: 1, levelId: 'B', papers: '21–25', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, mins: '2:05',
    qlog: [[2, 5, 1, 1, 0], [2, 7, 0, 1, 0]], ...extra };
}

test('Stage 2 migration: v2 progress becomes server-owned tracks, wallet, canonical qlog and reconstructed balances', () => {
  const v2 = {
    level: 2, paper: 41, bossCleared: 2,
    nav: { level: 1, paper: 26, bossCleared: 1 },
    history: [
      oldRow('2026-09-04', { scan: true, papers: '🧠 SCAN' }),
      oldRow('2026-09-03', { boss: true, papers: '👑 CHECK POINT T1' }),
      oldRow('2026-09-02'),
      oldRow('2026-09-01'),
    ],
    wallet: {
      gcSpent: 300, rpSpent: 100, inventory: ['ring_pulse', 'unknown_old_item'], activePet: 'pet_dragon', ring: 'ring_pulse',
      shields: 1, shieldDays: [], purchases: [{ id: 'ring_pulse', emoji: '⭕', name: 'Pulse ring', cost: 300, date: '2026-09-02' }],
      redemptions: [{ id: 'r1', rewardId: 'cash', emoji: '💴', name: 'Cash', cost: 100, date: '2026-09-02', status: 'approved' }], lastScanWeek: '2026-W36',
    },
  };
  const { progress, report } = migrateV2Progress(v2, { pacePercent: 130 });
  assert.deepEqual(progress.engine, { level: 2, paper: 41, bossCleared: 2 });
  assert.deepEqual(progress.nav, { level: 1, paper: 26, bossCleared: 1 });
  // 4 passes: 2 normal (100 GC), one boss (100), one scan (100), plus a 3-day continuity bonus (50).
  assert.equal(report.reconstructed.gcEarned, 350); assert.equal(report.reconstructed.rpEarned, 700);
  assert.equal(progress.wallet.gc, 50); assert.equal(progress.wallet.rp, 600); assert.equal(progress.wallet.bonuses, 1);
  assert.equal(progress.stats.sessions, 4); assert.equal(progress.stats.passes, 4); assert.deepEqual(progress.passDays, ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(progress.pacePercent, 130); assert.equal(progress.activeSession, null);
  assert.deepEqual(progress.wallet.inventory.sort(), ['pet_dragon', 'ring_pulse']); assert.equal(progress.wallet.activePet, 'pet_dragon');
  assert.equal(progress.history[0].qlog[0].track, 'engine'); assert.equal(progress.history[0].qlog[0].l, 1); assert.equal(progress.history[0].qlog[0].t, 2);
  assert.ok(report.warnings.some((x) => x.includes('unknown_old_item')));
});

test('Stage 2 migration: family rewards, pace and Family Rocket map old child names to v3 child IDs', () => {
  const settings = {
    allisonScale: 90, geraltScale: 80, paceMultipliers: { Allison: 1, Geralt: 1.3 },
    rewards: [
      { id: 'movie', emoji: '🎬', name: 'Movie night', cost: 200, hidden: false, cap: 1, kids: ['allison'] },
      { id: 'snack', emoji: '🍿', name: 'Snack', cost: 100, hidden: true, cap: 0 },
    ],
  };
  const rocket = { status: 'fueling', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 1000, minEach: 200,
    crew: ['allison', 'geralt'], fuel: { allison: 250, geralt: 100 }, createdAt: 12345 };
  const out = migrateV2GameConfig(settings, rocket, { Allison: childA, Geralt: childB }, { makeId: () => '33333333-3333-4333-8333-333333333333' });
  assert.deepEqual(out.config.rewards[0].childIds, [childA]);
  assert.deepEqual(out.config.rewards[1].childIds.sort(), [childA, childB].sort());
  assert.equal(out.paceByChildId[childA], 90); assert.equal(out.paceByChildId[childB], 104); // 80% × old 1.3 multiplier
  assert.equal(out.config.rocket.id, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(out.config.rocket.crewChildIds.sort(), [childA, childB].sort());
  assert.equal(out.config.rocket.fuel[childA], 250); assert.equal(out.config.rocket.fuel[childB], 100);
});

test('Stage 2 migration: invalid/negative legacy accounting cannot create free currency', () => {
  const { progress, report } = migrateV2Progress({ history: [], wallet: { gcSpent: -9999, rpSpent: -5, inventory: [] } });
  assert.equal(progress.wallet.gc, 0); assert.equal(progress.wallet.rp, 0); assert.equal(progress.wallet.gcSpent, 0); assert.equal(progress.wallet.rpSpent, 0);
  assert.ok(report.warnings.some((x) => x.includes('Negative v2 sandbox spend')));
});


test('v2 config migration never broadens an explicitly scoped reward whose child names do not map', () => {
  const { config } = migrateV2GameConfig({ rewards: [
    { id: 'private', emoji: '🎁', name: 'Private reward', cost: 200, kids: ['MissingKid'] },
    { id: 'family', emoji: '⭐', name: 'Family reward', cost: 100 },
  ] }, null, { Allison: '11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(config.rewards.map((r) => r.id), ['family']);
  assert.deepEqual(config.rewards[0].childIds, ['11111111-1111-4111-8111-111111111111']);
});

test('v2 config migration validates IANA time zones instead of importing arbitrary strings', () => {
  const childMap = { Allison: '11111111-1111-4111-8111-111111111111' };
  assert.equal(migrateV2GameConfig({ timeZone: 'Asia/Jakarta' }, null, childMap).timeZone, 'Asia/Jakarta');
  assert.equal(migrateV2GameConfig({ timeZone: 'Not/A_Real_Zone' }, null, childMap).timeZone, 'Asia/Singapore');
});
