// Stage 4.8 — the operator dashboard's arithmetic (server/analytics.mjs). These tests exercise the
// maths and the privacy rule, not the formatting: the suppression floor, the daily-active count in each
// family's own time zone across a daylight-saving change, and the household histograms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from './support.mjs';
import { cellFactory, median, mean, monthShift, monthRange, answeredIn, activityOf, households,
  subscriptionCalendar, dailyActive, bandOf, timedRow, speedMatrix, EASY, HARD,
  rewardCategory, normalizeName, costBand, rewardInsights, shopInsights, renderHtml,
  buildReport, collectSnapshot, auditRow, MIN_CELL } from '../server/analytics.mjs';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-12T04:00:00Z');
const cell = cellFactory(MIN_CELL);
const round2 = (v) => Math.round(v * 100) / 100;

// ---- a synthetic store: `n` families, each with children who answered questions on given local days
let seq = 0;
const id = (tag) => { seq++; return `${tag}${String(seq).padStart(8, '0')}-0000-4000-8000-000000000000`.slice(0, 36); };
function fam({ createdAt = NOW - 40 * DAY, timeZone = 'Asia/Singapore', kids = [{ age: 8, yearLevel: 2, start: 'test' }], subscription = null, grant = null, rewards = [], configUpdatedAt = null } = {}) {
  const familyId = id('f'), children = kids.map((k) => ({ ...k, id: id('c') }));
  return { id: familyId, deleted: false, createdAt, timeZone, subscription, grant, billingCountry: null,
    children: children.map((c) => ({ id: c.id, status: 'active', createdAt, age: c.age ?? null, yearLevel: c.yearLevel ?? null, start: c.start ?? null })),
    progress: children.map((c) => ({ childId: c.id, history: c.history || [], wallet: c.wallet || { gc: 0, rp: 0, inventory: [], purchases: [], redemptions: [] }, stats: { sessions: 0, passes: 0 } })),
    ledgers: children.map((c) => ({ childId: c.id, rows: c.ledger || [] })), rewards, configUpdatedAt };
}
// one finished session row: `s` seconds spent per question out of an `a`-second allowance
const row = ({ ts, track = 'engine', level = 1, papers = '21–25', total = 25, correct = total, passed = true, qlog = null, mode = 'paper', s = 12, a = 30 }) => ({
  ts, date: new Date(ts).toISOString().slice(0, 10), track, mode, level, levelId: 'ABCDEF'[level], papers,
  correct, incorrect: total - correct, timeout: 0, total, passed, secs: s * total,
  qlog: qlog === null ? Array.from({ length: total }, (_, i) => ({ t: 2, l: level, track, s, a, ok: i < correct ? 1 : 0 })) : qlog });
// `families` families of one child each, whose history is the rows `make` returns
const cohort = (n, make, extra = {}) => Array.from({ length: n }, (_, i) => fam({ ...extra, kids: [{ age: 9, yearLevel: 3, start: 'year', history: make(i) }] }));

test('the suppression rule is the only gate a number passes: fewer than min-cell families and it is not in the report at all', () => {
  const c = cellFactory(5);
  assert.deepEqual(c(17, 5), { value: 17, n: 5, suppressed: false });
  assert.deepEqual(c(17, 4), { value: null, n: null, suppressed: true });
  assert.deepEqual(c(0, 9), { value: 0, n: 9, suppressed: false });          // a real zero from nine families is a number
  assert.deepEqual(c(null, 900), { value: null, n: null, suppressed: true }); // nothing to say is not a number either
  // a suppressed cell keeps no trace of the value or of how many families it came from
  assert.equal(Object.hasOwn(c(17, 4), 'value') && c(17, 4).value === null, true);
  assert.deepEqual(Object.keys(c(17, 4)).sort(), ['n', 'suppressed', 'value']);
  // --min-cell is honoured, and a nonsense floor falls back to the default
  assert.equal(cellFactory(2)(3, 2).value, 3);
  assert.equal(cellFactory(0)(3, 4).value, null);
  assert.equal(cellFactory(0)(3, 5).value, 3);
});

test('median and mean over the shapes the history gives us', () => {
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, null, 2, undefined, NaN, 3]), 2);
  assert.equal(mean([1, 2, 4]), 7 / 3);
  assert.equal(mean([]), null);
});

test('month arithmetic crosses a year boundary in UTC', () => {
  assert.equal(monthShift('2026-01', -1), '2025-12');
  assert.equal(monthShift('2026-12', 1), '2027-01');
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(monthRange('2027-02', '2026-11'), []);
});

test('an answered question is what the row records: the per-question log, the graded counts, or how far a left session got', () => {
  assert.equal(answeredIn(row({ ts: NOW })), 25);
  assert.equal(answeredIn({ ts: NOW, correct: 3, incorrect: 1, timeout: 1 }), 5);
  assert.equal(answeredIn({ ts: NOW, quit: true, atQ: 4, total: 25 }), 4);
  assert.equal(answeredIn({ ts: NOW, quit: true, atQ: 0, total: 25 }), 0);
  assert.equal(answeredIn({ date: '2026-09-01', correct: 5, total: 5 }), 0); // a v2 row with no timestamp says nothing about when
  assert.equal(answeredIn(null), 0);
});

test('daily active users are counted in each family own time zone, and a daylight-saving change moves the boundary with it', () => {
  // 23:30 in Auckland on 27 September 2026 is 11:30 UTC before the change and 10:30 UTC after it: the same
  // UTC instant therefore falls on different local days either side, which is exactly what a UTC-only count
  // would get wrong. New Zealand moves to daylight time at 02:00 on Sunday 27 September 2026.
  const nz = 'Pacific/Auckland';
  const before = Date.parse('2026-09-26T11:30:00Z'); // Saturday 26 Sep 23:30 NZST
  const after = Date.parse('2026-09-27T11:30:00Z');  // Monday 28 Sep 00:30 NZDT — a different local day from the UTC one
  const kid = { age: 9, yearLevel: 3, start: 'year', history: [row({ ts: before }), row({ ts: after })] };
  const f = fam({ timeZone: nz, kids: [kid] });
  const days = activityOf(f).map((e) => e.day);
  assert.deepEqual(days, ['2026-09-26', '2026-09-28']);
  // in UTC the second session would have been dated the 27th; the family's own calendar says the 28th
  assert.equal(new Date(after).toISOString().slice(0, 10), '2026-09-27');
  const utc = activityOf({ ...f, timeZone: 'UTC' }).map((e) => e.day);
  assert.deepEqual(utc, ['2026-09-26', '2026-09-27']);
});

test('the daily series counts distinct children and families per local day, with 7- and 28-day rolling averages, and suppresses a thin day', () => {
  const day = (n) => NOW - n * DAY; // NOW is 12:00 Singapore on 12 September 2026
  // six families active yesterday (two children each), one family active the day before
  const many = Array.from({ length: 6 }, () => fam({ kids: [
    { age: 8, yearLevel: 2, start: 'test', history: [row({ ts: day(1) })] },
    { age: 10, yearLevel: 4, start: 'year', history: [row({ ts: day(1) })] }] }));
  const lonely = fam({ kids: [{ age: 7, yearLevel: 1, start: 'a1', history: [row({ ts: day(2) })] }] });
  const snapshot = { now: NOW, days: 30, families: [...many, lonely] };
  const d = dailyActive(snapshot, cell, 30);
  const on = (offset) => d.series.find((s) => s.day === new Date(day(offset)).toISOString().slice(0, 10));
  assert.equal(on(1).children.value, 12);            // six families, two children each
  assert.equal(on(1).families.value, 6);
  assert.equal(on(2).children.value, null);          // one family: not a number the report may carry
  assert.equal(on(2).children.suppressed, true);
  assert.equal(on(0).children.value, null);          // nobody today
  // the 7-day average spreads the window's children over seven days — 12 yesterday and the lonely one the
  // day before — and its basis is every family active in the window, so it may be printed although one of
  // its days on its own may not
  assert.equal(on(1).avg7.value, round2(13 / 7));
  assert.equal(on(1).avg7.n, 7);
  // an untouched day inside the same window still averages over the window's families
  assert.equal(on(0).avg7.value, round2(13 / 7));
  assert.equal(d.series.length, 31);
  assert.equal(d.totalFamilies.value, 7);
});
const round7 = (v) => Math.round(v * 100) / 100;

test('households: totals, creation by month, active and quiet windows, region from the time zone alone', () => {
  const fresh = Array.from({ length: 5 }, () => fam({ createdAt: Date.parse('2026-08-03T00:00:00Z'),
    kids: [{ age: 8, yearLevel: 2, start: 'test', history: [row({ ts: NOW - 2 * DAY })] }] }));
  const older = Array.from({ length: 5 }, () => fam({ createdAt: Date.parse('2026-07-03T00:00:00Z'), timeZone: 'Asia/Jakarta',
    kids: [{ age: 12, yearLevel: 6, start: 'a1', history: [row({ ts: NOW - 45 * DAY })] }] }));
  const h = households({ now: NOW, days: 90, families: [...fresh, ...older] }, cell);
  assert.equal(h.total.value, 10);
  assert.equal(h.children.value, 10);
  assert.equal(h.active.d7.value, 5);      // the five with a session two days ago
  assert.equal(h.active.d30.value, 5);
  assert.equal(h.quiet.d30.value, 5);      // the five whose last session was 45 days ago
  assert.equal(h.quiet.d60.value, null);   // none: suppressed, because zero families qualify
  assert.deepEqual(h.createdPerMonth.map((m) => m.month), ['2026-07', '2026-08', '2026-09']);
  assert.equal(h.createdPerMonth.find((m) => m.month === '2026-07').families.value, 5);
  assert.equal(h.createdPerMonth.find((m) => m.month === '2026-09').families.value, null);
  assert.deepEqual(h.areas.map((a) => [a.key, a.families.value]), [['Asia', 10]]);
  assert.deepEqual(h.zones.map((z) => [z.key, z.families.value]), [['Asia/Jakarta', 5], ['Asia/Singapore', 5]]);
  assert.deepEqual(h.billingCountries.map((c) => [c.key, c.families.value]), [['unknown', 10]]);
});

test('households: the child histograms count children but are suppressed by families, and unknown values sort last', () => {
  const kids = (n, extra) => Array.from({ length: n }, () => ({ age: extra.age, yearLevel: extra.yearLevel, start: extra.start }));
  const five = Array.from({ length: 5 }, () => fam({ kids: kids(2, { age: 8, yearLevel: 2, start: 'test' }) }));
  const two = Array.from({ length: 2 }, () => fam({ kids: kids(1, { age: null, yearLevel: null, start: 'a1' }) }));
  const h = households({ now: NOW, days: 90, families: [...five, ...two] }, cell);
  assert.deepEqual(h.childAges.map((b) => [b.key, b.children.value]), [['8', 10], ['not given', null]]);
  assert.deepEqual(h.yearLevels.map((b) => [b.key, b.children.value]), [['2', 10], ['not given', null]]);
  assert.deepEqual(h.startOptions.map((b) => [b.key, b.children.value]), [['a1', null], ['test', 10]]);
  assert.deepEqual(h.childrenPerHousehold.map((b) => [b.key, b.families.value]), [['1', null], ['2', 5]]);
});

test('the subscription calendar is derived from the stored facts: trial ends, renewals, cancel-at-period-end, grace, grant expiries', () => {
  const nextMonth = Date.parse('2026-10-15T00:00:00Z');
  const trials = Array.from({ length: 5 }, () => fam({ subscription: { state: 'trial', plan: 'trial', trialEndsAt: nextMonth, periodEnd: null, cancelAtPeriodEnd: false } }));
  const renewals = Array.from({ length: 5 }, () => fam({ subscription: { state: 'active', plan: 'family', periodEnd: nextMonth, cancelAtPeriodEnd: false } }));
  const leaving = Array.from({ length: 5 }, () => fam({ subscription: { state: 'active', plan: 'starter', periodEnd: nextMonth, cancelAtPeriodEnd: true } }));
  const granted = Array.from({ length: 5 }, () => fam({ grant: { status: 'active', seatLimit: 2, accessUntil: nextMonth, source: 'manual' } }));
  const cal = subscriptionCalendar({ now: NOW, families: [...trials, ...renewals, ...leaving, ...granted] }, cell);
  assert.deepEqual(cal.map((m) => m.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  const october = cal.find((m) => m.month === '2026-10');
  assert.equal(october.trialEnds.value, 5);
  assert.equal(october.renewals.value, 5);
  assert.equal(october.cancellations.value, 5);
  assert.equal(october.grantExpiries.value, 5);
  assert.equal(october.graceEnds.value, 5);                                       // period end + the seven grace days, still October
  assert.equal(cal.find((m) => m.month === '2026-11').graceEnds.value, null);
  assert.equal(cal.find((m) => m.month === '2026-09').renewals.value, null);
  // a subscription the parent cancelled gets no grace window: deriveState calls it cancelled at the period end
  const onlyLeaving = subscriptionCalendar({ now: NOW, families: leaving }, cell);
  assert.equal(onlyLeaving.find((m) => m.month === '2026-10').graceEnds.value, null);
  assert.equal(onlyLeaving.find((m) => m.month === '2026-10').renewals.value, null);
});

test('the report scope states the cohort size plainly and every other number obeys the floor; a tombstone is counted, never described', () => {
  const three = Array.from({ length: 3 }, () => fam({ kids: [{ age: 8, yearLevel: 2, start: 'test', history: [row({ ts: NOW - DAY })] }] }));
  const tomb = { ...fam(), deleted: true, children: [], progress: [], ledgers: [] };
  const report = buildReport({ now: NOW, days: 90, families: [...three, tomb] }, { minCell: 5 });
  assert.deepEqual(report.scope, { families: 3, tombstones: 1, children: 3, suppressedBelow: 5, dayWindow: 90 });
  assert.equal(report.households.total.value, null);       // three families is below the floor
  assert.equal(report.households.active.d7.value, null);
  assert.equal(report.by, 'year');
  assert.equal(buildReport({ now: NOW, days: 90, families: three }, { by: 'age' }).by, 'age');
  assert.equal(buildReport({ now: NOW, days: 90, families: three }, { by: 'nonsense' }).by, 'year');
});

test('collectSnapshot reads a real store shape and never collects a nickname', async () => {
  const store = new MemoryStore();
  const familyId = '11111111-1111-4111-8111-111111111111', childId = '22222222-2222-4222-8222-222222222222';
  await store.put(`families/${familyId}`, { id: familyId, label: 'The Secret Family', createdAt: NOW - 10 * DAY, timeZone: 'Asia/Jakarta',
    childIds: [childId], activeChildIds: [childId], entitlement: { status: 'active', seatLimit: 2, accessUntil: NOW + 20 * DAY, version: 1, source: 'manual' } });
  await store.put(`families/${familyId}/children/${childId}`, { id: childId, nickname: 'Bunny', icon: 'fox', status: 'active', createdAt: NOW - 10 * DAY,
    demographics: { age: 9, yearLevel: 3, recordedAt: NOW }, start: { option: 'test', yearLevel: 3, chosenAt: NOW } });
  await store.put(`families/${familyId}/learning/${childId}`, { engine: { level: 1, paper: 21, bossCleared: 1 }, nav: { level: 1, paper: 6, bossCleared: 0 },
    wallet: { gc: 120, rp: 300, inventory: ['ring_pulse'], purchases: [], redemptions: [], ledgerSeq: 1, ledgerLast: 'a' }, history: [row({ ts: NOW - DAY })], stats: { sessions: 1, passes: 1 } });
  await store.put(`families/${familyId}/learning/${childId}/ledger/a`, { id: 'a', type: 'learn.session', gc: 50, rp: 100, seq: 1, prev: null, balance: { gc: 50, rp: 100 }, at: NOW - DAY });
  await store.put(`families/${familyId}/game/config`, { rewards: [{ id: 'r1', emoji: '🍦', name: 'Ice cream', cost: 200, hidden: false, cap: 1, childIds: [] }], rocket: null, rocketHistory: [], updatedAt: NOW - 5 * DAY });
  await store.put(`families/${familyId}/credentials/${childId}`, { hash: 'never-read', version: 1 });
  const snapshot = await collectSnapshot(store, { now: NOW, days: 90 });
  assert.equal(snapshot.families.length, 1);
  const f = snapshot.families[0];
  assert.equal(f.timeZone, 'Asia/Jakarta');
  assert.deepEqual(f.children, [{ id: childId, status: 'active', createdAt: NOW - 10 * DAY, age: 9, yearLevel: 3, start: 'test' }]);
  assert.equal(f.progress[0].history.length, 1);
  assert.equal(f.ledgers[0].rows.length, 1);
  assert.equal(f.rewards[0].name, 'Ice cream');
  assert.equal(f.grant.accessUntil, NOW + 20 * DAY);
  // no label, no nickname, no PIN hash anywhere in what was collected
  const text = JSON.stringify(snapshot);
  for (const secret of ['The Secret Family', 'Bunny', 'never-read', 'label', 'nickname']) assert.equal(text.includes(secret), false, secret);
});

test('a tombstone is collected as a tombstone: counted, with no children and no time zone', async () => {
  const store = new MemoryStore();
  const familyId = '33333333-3333-4333-8333-333333333333';
  await store.put(`families/${familyId}`, { id: familyId, deleted: true, deletedAt: NOW, createdAt: NOW - 100 * DAY, childIds: [], activeChildIds: [], subscription: { state: 'cancelled', plan: 'starter' } });
  const snapshot = await collectSnapshot(store, { now: NOW });
  assert.equal(snapshot.families[0].deleted, true);
  assert.deepEqual(snapshot.families[0].children, []);
  assert.equal(snapshot.families[0].timeZone, null);
  assert.equal(buildReport(snapshot, {}).scope.tombstones, 1);
});

test('one run writes one audit row, naming the operator and no family', () => {
  const r = auditRow({ operator: 'ops@example.test', at: NOW, families: 12, minCell: 5, days: 90, by: 'year' });
  assert.equal(r.action, 'operator.dashboard');
  assert.equal(r.uid, 'ops@example.test');
  assert.equal(r.familyId, null);
  assert.equal(r.childId, null);
  assert.equal(r.expireAt, NOW + 400 * DAY);
  assert.deepEqual(Object.keys(r).sort(), ['action', 'at', 'by', 'childId', 'days', 'expireAt', 'families', 'familyId', 'minCell', 'uid']);
});

// ---------------------------------------------------------------- section 2 — the speed matrices
test('a band is the sector and the papers the row records, in v3 and v2 spelling alike', () => {
  const at = (papers, extra = {}) => bandOf({ level: 1, papers, ...extra });
  assert.deepEqual(at('21–25', { mode: 'paper' }), { label: 'B 21–25', level: 1, levelId: 'B', kind: 'paper', from: 21, to: 25 });
  assert.deepEqual(at('21-25', { mode: 'paper' }), { label: 'B 21-25', level: 1, levelId: 'B', kind: 'paper', from: 21, to: 25 }); // the v2 import writes a hyphen
  assert.equal(at('practice 21–25', { mode: 'practice' }).kind, 'practice');
  assert.deepEqual([at('CP T2', { mode: 'boss' }).kind, at('CP T2', { mode: 'boss' }).from], ['checkpoint', 21]);
  assert.equal(at('SYSTEM SCAN', { mode: 'scan' }).kind, 'scan');
  assert.equal(at('SCAN', {}).kind, 'scan');                       // a v2 scan row with no usable mode
  assert.equal(at('PLACEMENT TEST', { mode: 'placement' }).kind, 'placement');
  assert.equal(bandOf({ papers: '1–5' }).level, null);             // a row with no sector cannot be banded
  assert.equal(bandOf(null).label, '?');
});

test('a session counts only when its per-question log carries the allowance, so v2-imported rows are skipped', () => {
  assert.equal(timedRow(row({ ts: NOW })), true);
  assert.equal(timedRow({ ...row({ ts: NOW }), qlog: [{ t: 2, s: 12, ok: 1 }] }), false);        // the v2 import's shape: seconds, no allowance
  assert.equal(timedRow({ ...row({ ts: NOW }), qlog: [{ t: 2, s: 12, a: 0, ok: 1 }] }), false);
  assert.equal(timedRow({ ...row({ ts: NOW }), qlog: [] }), false);
  assert.equal(timedRow({ ...row({ ts: NOW }), quit: true }), false);                            // a session left is not a finished attempt
  const mixed = row({ ts: NOW, total: 2 });
  mixed.qlog[1] = { t: 2, s: 12, ok: 1 };
  assert.equal(timedRow(mixed), false);                                                          // one question without an allowance and the session is out
});

test('a cell is the median seconds per question and the median share of the allowance over the sessions that passed with everything correct', () => {
  // five families, each with one fast pass, one slow pass, one failure: the medians come from the passes
  const families = cohort(5, () => [
    row({ ts: NOW - DAY, level: 2, papers: '1–5', total: 5, s: 10, a: 40 }),
    row({ ts: NOW - 2 * DAY, level: 2, papers: '1–5', total: 5, s: 20, a: 40 }),
    row({ ts: NOW - 3 * DAY, level: 2, papers: '1–5', total: 5, s: 30, a: 40, correct: 3, passed: false }),
  ]);
  const m = speedMatrix({ now: NOW, days: 90, families }, 'engine', cell, { minCell: 5, by: 'year' });
  const c = m.rows[0].cells.find((x) => x.column === '3');
  assert.equal(m.rows[0].label, 'C 1–5');
  assert.equal(c.sessions, 10);                        // ten passes: two from each of the five families
  assert.equal(c.attempts, 15);                        // every finished, timed attempt
  assert.equal(c.families, 5);
  assert.equal(c.medianSeconds, 15);                   // the median over the sessions' 10 and 20 seconds per question
  assert.equal(c.medianShare, 0.375);                  // (10/40 + 20/40) / 2
  assert.equal(c.passRate, 0.667);                      // ten passes in fifteen finished attempts
  assert.equal(c.flag, null);
  // the columns are the year levels; with --by age they are the ages present
  assert.deepEqual(m.columns, ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(speedMatrix({ now: NOW, days: 90, families }, 'engine', cell, { minCell: 5, by: 'age' }).columns, ['9']);
  assert.equal(m.rows[0].cells.find((x) => x.column === '1').empty, true);
  // the Navigator matrix is the same definitions over Navigator rows only
  assert.deepEqual(speedMatrix({ now: NOW, days: 90, families }, 'nav', cell, { minCell: 5, by: 'year' }).rows, []);
});

test('passed unusually easily: a band well inside its allowance and much faster than the neighbouring bands of the same sector', () => {
  const band = (papers, s) => row({ ts: NOW - DAY, level: 2, papers, total: 5, s, a: 30 });
  const families = cohort(5, () => [band('16–20', 20), band('16–20', 20), band('21–25', 9), band('21–25', 9), band('26–30', 20), band('26–30', 20)]);
  const m = speedMatrix({ now: NOW, days: 90, families }, 'engine', cell, { minCell: 5, by: 'year' });
  const cellAt = (label) => m.rows.find((r) => r.label === label).cells.find((x) => x.column === '3');
  assert.equal(cellAt('C 21–25').flag, 'easy');
  assert.equal(cellAt('C 16–20').flag, null);
  assert.equal(cellAt('C 26–30').flag, null);
  assert.equal(m.flags.easy.length, 1);
  const flag = m.flags.easy[0];
  assert.equal(flag.band, 'C 21–25');
  assert.equal(flag.sector, 'C');
  assert.equal(flag.column, '3');
  assert.equal(flag.sessions, 10);
  assert.equal(flag.medianShare, 0.3);
  assert.equal(flag.neighbourMedianSeconds, 20);
  assert.equal(flag.fasterBy, 0.55);
  // nothing about a child, a family or a nickname is on the line
  assert.deepEqual(Object.keys(flag).sort(), ['attempts', 'band', 'column', 'fasterBy', 'kind', 'medianSeconds', 'medianShare', 'neighbourMedianSeconds', 'passRate', 'reason', 'sector', 'sessions', 'track']);
  // just short of 35 % faster than the neighbours is not a flag
  const nearly = cohort(5, () => [band('16–20', 20), band('16–20', 20), band('21–25', 13.1), band('21–25', 13.1), band('26–30', 20), band('26–30', 20)]);
  assert.deepEqual(speedMatrix({ now: NOW, days: 90, families: nearly }, 'engine', cell, { minCell: 5, by: 'year' }).flags.easy, []);
  // fast, but not inside half the allowance: the share rule holds it back
  const roomy = cohort(5, () => [band('16–20', 40), band('16–20', 40), band('21–25', 16), band('21–25', 16), band('26–30', 40), band('26–30', 40)]);
  assert.deepEqual(speedMatrix({ now: NOW, days: 90, families: roomy }, 'engine', cell, { minCell: 5, by: 'year' }).flags.easy, []);
});

test('unusually hard: a band that eats its allowance, or that most attempts fail', () => {
  const slow = cohort(5, () => [row({ ts: NOW - DAY, level: 3, papers: '1–5', total: 5, s: 28, a: 30 })]);
  const hardShare = speedMatrix({ now: NOW, days: 90, families: slow }, 'engine', cell, { minCell: 5, by: 'year' });
  assert.equal(hardShare.flags.hard.length, 1);
  assert.equal(hardShare.flags.hard[0].band, 'D 1–5');
  assert.match(hardShare.flags.hard[0].reason, /median share 0\.933 at or above 0\.9/);
  assert.equal(hardShare.rows[0].cells.find((x) => x.column === '3').flag, 'hard');
  // a band most attempts fail is hard even when the passes were quick
  const failing = cohort(5, () => [
    row({ ts: NOW - DAY, level: 4, papers: '1–5', total: 5, s: 10, a: 40 }),
    row({ ts: NOW - 2 * DAY, level: 4, papers: '1–5', total: 5, s: 10, a: 40, correct: 2, passed: false }),
    row({ ts: NOW - 3 * DAY, level: 4, papers: '1–5', total: 5, s: 10, a: 40, correct: 1, passed: false }),
  ]);
  const hardRate = speedMatrix({ now: NOW, days: 90, families: failing }, 'engine', cell, { minCell: 5, by: 'year' });
  assert.equal(hardRate.flags.hard.length, 1);
  assert.equal(hardRate.flags.hard[0].passRate, 0.333);   // five passes in fifteen attempts
  assert.match(hardRate.flags.hard[0].reason, /pass rate 0\.333 below 0\.4/);
  assert.deepEqual(hardRate.flags.easy, []);            // a hard band is never also an easy one
});

test('no flag and no number can come from fewer than the floor: four families, or four sessions, and the cell is a dash', () => {
  const band = (papers, s) => row({ ts: NOW - DAY, level: 2, papers, total: 5, s, a: 30 });
  const thin = cohort(4, () => [band('16–20', 20), band('21–25', 9), band('26–30', 20)]);
  const m = speedMatrix({ now: NOW, days: 90, families: thin }, 'engine', cell, { minCell: 5, by: 'year' });
  assert.deepEqual(m.flags, { easy: [], hard: [] });
  const c = m.rows.find((r) => r.label === 'C 21–25').cells.find((x) => x.column === '3');
  assert.deepEqual(c, { column: '3', suppressed: true });
  // five families in the cell, but only four of them passed it: the cell may be printed, and the flag
  // still may not — "n at least --min-cell" counts the passing sessions the medians came from
  const failed = row({ ts: NOW - DAY, level: 2, papers: '21–25', total: 5, s: 9, a: 30, correct: 2, passed: false });
  const few = cohort(5, (i) => [band('16–20', 20), i < 4 ? band('21–25', 9) : failed, band('26–30', 20)]);
  const m2 = speedMatrix({ now: NOW, days: 90, families: few }, 'engine', cell, { minCell: 5, by: 'year' });
  assert.deepEqual(m2.flags.easy, []);
  const middle = m2.rows.find((r) => r.label === 'C 21–25').cells.find((x) => x.column === '3');
  assert.equal(middle.suppressed, false);
  assert.equal(middle.families, 5);
  assert.equal(middle.sessions, 4);
  assert.equal(middle.flag, null);
  // a lower floor lets the same shape through, which is what --min-cell is for
  const loose = cellFactory(4);
  assert.equal(speedMatrix({ now: NOW, days: 90, families: thin }, 'engine', loose, { minCell: 4, by: 'year' }).flags.easy.length, 1);
});

test('the report carries both matrices, and the thresholds it used', () => {
  const families = cohort(5, () => [row({ ts: NOW - DAY, level: 2, papers: '1–5', total: 5, s: 12, a: 30 }),
    row({ ts: NOW - DAY, track: 'nav', level: 2, papers: '1–5', total: 3, s: 12, a: 30 })]);
  const report = buildReport({ now: NOW, days: 90, families }, { minCell: 5, by: 'age' });
  assert.equal(report.speed.engine.rows[0].cells.find((c) => c.column === '9').sessions, 5);
  assert.equal(report.speed.nav.rows[0].cells.find((c) => c.column === '9').sessions, 5);
  assert.deepEqual(report.speed.engine.columns, ['9']);
  assert.deepEqual(report.speed.engine.thresholds, { easy: EASY, hard: HARD, minSessions: 5, minFamilies: 5 });
});

// ---------------------------------------------------------------- section 3 — rewards and the shop
test('a parent-entered reward name folds to a category, in English and in Indonesian', () => {
  const c = rewardCategory;
  assert.equal(c('Screen time'), 'screen_time');
  assert.equal(c('30 min TV'), 'screen_time');
  assert.equal(c('Nonton YouTube'), 'screen_time');
  assert.equal(c('Waktu layar 1 jam'), 'screen_time');
  assert.equal(c('Pocket money'), 'money');
  assert.equal(c('Uang jajan'), 'money');                 // pocket money, although it contains jajan
  assert.equal(c('uang jajan 10rb'), 'money');
  assert.equal(c('Duit tambahan'), 'money');
  assert.equal(c('Jajan di kantin'), 'food');             // jajan on its own is a snack
  assert.equal(c('Ice cream'), 'food');
  assert.equal(c('Es krim'), 'food');
  assert.equal(c('Martabak'), 'food');
  assert.equal(c('Trip to the zoo'), 'outing');
  assert.equal(c('Jalan-jalan ke mall'), 'outing');
  assert.equal(c('Ke bioskop'), 'outing');
  assert.equal(c('New Lego set'), 'toy');
  assert.equal(c('Mainan baru'), 'toy');
  assert.equal(c('Main game 1 jam'), 'game');             // the console, although it contains game
  assert.equal(c('Roblox time'), 'game');
  assert.equal(c('Mabar sama kakak'), 'game');
  assert.equal(c('A new book'), 'book');
  assert.equal(c('Beli komik'), 'book');
  assert.equal(c('Swimming lesson'), 'activity');
  assert.equal(c('Berenang'), 'activity');
  assert.equal(c('Les gitar'), 'activity');
  assert.equal(c('Hadiah kejutan'), 'other');             // nothing matched: never guessed at
  assert.equal(c(''), 'other');
  assert.equal(c(null), 'other');
  // a keyword only counts as a whole word, so a longer word that contains one is not a match
  assert.equal(c('Jajanan pasar'), 'food');
  assert.equal(c('Gameboy'), 'other');
  // emoji, accents and punctuation are folded away before matching
  assert.equal(normalizeName('🍦 Ice-cream!!'), 'ice cream');
  assert.equal(rewardCategory('🍦 Ice-cream!!'), 'food');
  assert.equal(rewardCategory('café trip'), 'outing');
});

test('cost bands put a reward beside its like', () => {
  assert.equal(costBand(1), '1–99');
  assert.equal(costBand(99), '1–99');
  assert.equal(costBand(100), '100–199');
  assert.equal(costBand(500), '500–999');
  assert.equal(costBand(5000), '5000+');
  assert.equal(costBand(99999), '5000+');
  assert.equal(costBand(0), 'not given');
  assert.equal(costBand(null), 'not given');
});

const reward = (id, name, cost) => ({ id, emoji: '🎁', name, cost, hidden: false, cap: 1, childIds: [] });
const redemption = (rewardId, name, cost, status, requestedAt) => ({ id: id('r'), rewardId, emoji: '🎁', name, cost, date: '2026-09-05', status, requestedAt, ...(status === 'pending' ? {} : { decidedAt: requestedAt + 3600_000 }) });

test('rewards by category: families, costs, redemptions, approvals, refusals, and the wait for the first redemption', () => {
  const configuredAt = NOW - 10 * DAY, asked = NOW - 7 * DAY;
  const families = Array.from({ length: 5 }, () => {
    const f = fam({ rewards: [reward('r1', 'Ice cream', 200), reward('r2', 'Uang jajan', 500)], configUpdatedAt: configuredAt });
    f.progress[0].wallet.redemptions = [
      redemption('r1', 'Ice cream', 200, 'approved', asked),
      redemption('r1', 'Ice cream', 200, 'rejected', asked + DAY),
      redemption('r2', 'Uang jajan', 500, 'pending', asked + 2 * DAY),
      { id: id('r'), rewardId: 'rocket', emoji: '🚀', name: 'Rocket fuel - Trip to Bali', cost: 100, date: '2026-09-06', status: 'approved', requestedAt: asked },
    ];
    return f;
  });
  const r = rewardInsights({ now: NOW, days: 90, families }, cell);
  const food = r.categories.find((c) => c.key === 'food'), moneyCat = r.categories.find((c) => c.key === 'money');
  assert.equal(food.families.value, 5);
  assert.equal(food.rewards.value, 5);
  assert.equal(food.medianCost.value, 200);
  assert.equal(food.averageCost.value, 200);
  assert.equal(food.redemptions.value, 10);
  assert.equal(food.approvals.value, 5);
  assert.equal(food.refusals.value, 5);
  assert.equal(food.pending.value, 0);
  assert.equal(food.daysToFirstRedemption.value, 3);         // the list was saved ten days ago, first asked seven days ago
  assert.deepEqual(food.bands.map((b) => [b.band, b.rewards.value, b.redemptions.value]), [['200–499', 5, 10]]);
  assert.equal(moneyCat.pending.value, 5);
  assert.equal(moneyCat.medianCost.value, 500);
  assert.deepEqual(moneyCat.bands.map((b) => b.band), ['500–999']);
  assert.equal(r.categories.find((c) => c.key === 'toy').families.value, null); // nobody: suppressed
  assert.equal(r.configuredFamilies.value, 5);
  // rocket fuel paid in reward points is counted on its own line, and its prize name is nowhere in the report
  assert.equal(r.rocketFuel.redemptions.value, 5);
  assert.deepEqual(r.names, ['Ice cream', 'Uang jajan']);
  assert.equal(JSON.stringify(r).includes('Bali'), false);
  // the appendix is de-duplicated raw names and nothing else on the line
  assert.equal(r.names.every((n) => typeof n === 'string'), true);
});

test('the wait for a first redemption is counted only where the reward list has not been saved again since', () => {
  const asked = NOW - 7 * DAY;
  const families = Array.from({ length: 5 }, () => {
    const f = fam({ rewards: [reward('r1', 'Ice cream', 200)], configUpdatedAt: NOW - 2 * DAY }); // the list was saved again, after the redemption
    f.progress[0].wallet.redemptions = [redemption('r1', 'Ice cream', 200, 'approved', asked)];
    return f;
  });
  const r = rewardInsights({ now: NOW, days: 90, families }, cell);
  const food = r.categories.find((c) => c.key === 'food');
  assert.equal(food.redemptions.value, 5);
  assert.equal(food.daysToFirstRedemption.value, null);   // no usable pair: the app stores one updatedAt for the whole list
  assert.equal(food.daysToFirstRedemption.suppressed, true);
});

test('a reward the parent has since removed is still categorised, from the name the redemption kept', () => {
  const families = Array.from({ length: 5 }, () => {
    const f = fam({ rewards: [], configUpdatedAt: NOW - DAY });
    f.progress[0].wallet.redemptions = [redemption('gone', 'Main game 1 jam', 300, 'approved', NOW - 3 * DAY)];
    return f;
  });
  const r = rewardInsights({ now: NOW, days: 90, families }, cell);
  assert.equal(r.categories.find((c) => c.key === 'game').redemptions.value, 5);
  assert.equal(r.configuredFamilies.value, null);          // none of them has a reward list now
  assert.deepEqual(r.names, ['Main game 1 jam']);
});

// a ledger chain with honest running balances, as server/ledger.mjs writes it
function ledger(entries) {
  let gc = 0, rp = 0, seq = 0, prev = null;
  return entries.map((e) => {
    gc += e.gc || 0; rp += e.rp || 0; seq++;
    const r = { id: `row-${seq}`, type: e.type, gc: e.gc || 0, rp: e.rp || 0, ref: e.ref || null, note: null, at: e.at || NOW - DAY, seq, prev, balance: { gc, rp } };
    prev = r.id; return r;
  });
}
const shopper = (extra = []) => ledger([
  { type: 'learn.session', gc: 500, rp: 1000 },
  { type: 'shop.buy', gc: -300, ref: 'ring_pulse' },
  { type: 'reward.request', rp: -200, ref: 'red-1' },
  ...extra,
]);

test('the shop arithmetic comes from the ledger: earned, spent, saved, the share spent, and the balance held at the moment of purchase', () => {
  const families = Array.from({ length: 5 }, () => {
    const f = fam();
    f.progress[0].wallet = { gc: 200, rp: 800, inventory: ['ring_pulse'], purchases: [], redemptions: [] };
    f.ledgers[0].rows = shopper();
    return f;
  });
  const s = shopInsights({ now: NOW, days: 90, families }, cell);
  assert.equal(s.children.value, 5);
  assert.equal(s.currencies.gc.earned.value, 2500);
  assert.equal(s.currencies.gc.spent.value, 1500);
  assert.equal(s.currencies.gc.saved.value, 1000);
  assert.equal(s.currencies.gc.spendingPercent.value, 60);
  assert.equal(s.currencies.gc.medianSpentPerChild.value, 300);
  assert.equal(s.currencies.gc.medianSavedPerChild.value, 200);
  assert.equal(s.currencies.gc.medianBalanceAtPurchase.value, 500);   // 200 after the charge, 300 charged
  assert.equal(s.currencies.rp.earned.value, 5000);
  assert.equal(s.currencies.rp.spent.value, 1000);
  assert.equal(s.currencies.rp.saved.value, 4000);
  assert.equal(s.currencies.rp.spendingPercent.value, 20);
  assert.equal(s.currencies.rp.medianBalanceAtPurchase.value, 1000);
  // the item, by catalogue name, and the share of children who own it
  const ring = s.items.find((i) => i.id === 'ring_pulse');
  assert.equal(ring.name, 'Pulse ring');
  assert.equal(ring.kind, 'ring');
  assert.equal(ring.cost, 300);
  assert.equal(ring.purchases.value, 5);
  assert.equal(ring.spent.value, 1500);
  assert.equal(ring.owners.value, 5);
  assert.equal(ring.ownedPercent.value, 100);
  assert.equal(ring.medianBalanceBefore.value, 500);
  assert.deepEqual(s.most.map((i) => i.id), ['ring_pulse']);
  assert.deepEqual(s.least.map((i) => i.id), ['ring_pulse']);
  assert.equal(s.neverBought.some((i) => i.id === 'ring_halo'), true);
  assert.equal(s.neverBought.some((i) => i.id === 'ring_pulse'), false);
  assert.equal(s.neverBought.some((i) => i.id === 'pet_fox'), false);   // hatched pets are not for sale
  // split by item kind, and reward points spent through the Reward Store on their own line
  const kinds = Object.fromEntries(s.kinds.map((k) => [k.kind, k]));
  assert.equal(kinds.ring.purchases.value, 5);
  assert.equal(kinds.ring.spentGc.value, 1500);
  assert.equal(kinds.ring.medianCost.value, 300);
  assert.equal(kinds.reward.purchases.value, 5);
  assert.equal(kinds.reward.spentRp.value, 1000);
  assert.equal(kinds.reward.spentGc.value, 0);
});

test('an item four families bought is not a number the shop section may print', () => {
  const families = Array.from({ length: 5 }, (_, i) => {
    const f = fam();
    f.progress[0].wallet = { gc: 200, rp: 800, inventory: i < 4 ? ['ring_pulse'] : [], purchases: [], redemptions: [] };
    f.ledgers[0].rows = i < 4 ? shopper() : ledger([{ type: 'learn.session', gc: 500, rp: 1000 }, { type: 'reward.request', rp: -200, ref: 'red-1' }]);
    return f;
  });
  const s = shopInsights({ now: NOW, days: 90, families }, cell);
  const ring = s.items.find((i) => i.id === 'ring_pulse');
  assert.equal(ring.purchases.value, null);
  assert.equal(ring.purchases.suppressed, true);
  assert.equal(ring.medianBalanceBefore.value, null);
  assert.deepEqual(s.most, []);                    // nothing publishable
  assert.equal(s.currencies.rp.spent.value, 1000); // the currency totals still stand: five families
});

test('rocket fuel and a parent credit are spending too, each on its own line, and neither is a shop item', () => {
  const families = Array.from({ length: 5 }, () => {
    const f = fam();
    f.progress[0].wallet = { gc: 100, rp: 800, inventory: [], purchases: [], redemptions: [] };
    f.ledgers[0].rows = ledger([
      { type: 'learn.session', gc: 500, rp: 1000 },
      { type: 'parent.adjust', gc: -100 },
      { type: 'rocket.fuel', gc: -300, ref: 'rocket-1' },
      { type: 'reward.request', rp: -200, ref: 'red-1' },
    ]);
    return f;
  });
  const s = shopInsights({ now: NOW, days: 90, families }, cell);
  const kinds = Object.fromEntries(s.kinds.map((k) => [k.kind, k]));
  assert.equal(kinds['rocket fuel'].spentGc.value, 1500);
  assert.equal(kinds['parent adjustment'].spentGc.value, 500);
  assert.equal(kinds.ring, undefined);
  assert.deepEqual(s.items, []);
  assert.equal(s.currencies.gc.spent.value, 2000);
  assert.equal(s.currencies.gc.spendingPercent.value, 80);
});

test('the report carries both section 3 halves', () => {
  const families = Array.from({ length: 5 }, () => {
    const f = fam({ rewards: [reward('r1', 'Nonton film', 300)], configUpdatedAt: NOW - 5 * DAY });
    f.progress[0].wallet = { gc: 200, rp: 800, inventory: ['ring_pulse'], purchases: [], redemptions: [] };
    f.ledgers[0].rows = shopper();
    return f;
  });
  const report = buildReport({ now: NOW, days: 90, families }, { minCell: 5 });
  assert.equal(report.rewards.categories.find((c) => c.key === 'screen_time').rewards.value, 5);
  assert.equal(report.shop.currencies.gc.spendingPercent.value, 60);
});

// ---------------------------------------------------------------- the page itself
// A synthetic store with several families, collected and rendered exactly as scripts/dashboard.mjs does it.
async function syntheticStore({ count = 6 } = {}) {
  const store = new MemoryStore(), ids = [];
  for (let i = 0; i < count; i++) {
    const familyId = `${String(i + 1).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.slice(0, 36);
    const childId = `${String(i + 1).repeat(8)}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`.slice(0, 36);
    ids.push(familyId, childId);
    await store.put(`families/${familyId}`, { id: familyId, label: `Keluarga Rahasia ${i}`, createdAt: NOW - (30 + i) * DAY,
      timeZone: i % 2 ? 'Asia/Jakarta' : 'Asia/Singapore', childIds: [childId], activeChildIds: [childId],
      entitlement: { status: 'active', seatLimit: 2, accessUntil: NOW + 30 * DAY, version: 1, source: 'manual' } });
    await store.put(`families/${familyId}/children/${childId}`, { id: childId, nickname: `Kelinci${i}`, icon: 'fox', status: 'active',
      createdAt: NOW - 30 * DAY, demographics: { age: 8 + (i % 3), yearLevel: 3, recordedAt: NOW }, start: { option: 'test', yearLevel: 3, chosenAt: NOW } });
    await store.put(`families/${familyId}/learning/${childId}`, { engine: { level: 2, paper: 26, bossCleared: 1 }, nav: { level: 1, paper: 6, bossCleared: 0 },
      wallet: { gc: 200, rp: 800, inventory: ['ring_pulse'], purchases: [], ledgerSeq: 3, ledgerLast: 'row-3',
        redemptions: [redemption('r1', 'Uang jajan', 300, 'approved', NOW - 6 * DAY)] },
      stats: { sessions: 3, passes: 3 },
      history: [row({ ts: NOW - DAY, level: 2, papers: '21–25', total: 5, s: 9, a: 30 }),
        row({ ts: NOW - 2 * DAY, level: 2, papers: '16–20', total: 5, s: 20, a: 30 }),
        row({ ts: NOW - 3 * DAY, level: 2, papers: '26–30', total: 5, s: 20, a: 30 }),
        row({ ts: NOW - 4 * DAY, track: 'nav', level: 1, papers: '1–5', total: 3, s: 28, a: 30 })] });
    for (const r of shopper()) await store.put(`families/${familyId}/learning/${childId}/ledger/${r.id}`, r);
    await store.put(`families/${familyId}/game/config`, { rewards: [reward('r1', 'Uang jajan', 300), reward('r2', 'Nonton film', 500)],
      rocket: null, rocketHistory: [], updatedAt: NOW - 9 * DAY });
  }
  return { store, ids };
}

test('smoke: the page renders from a synthetic multi-family store, and carries no id, no nickname and no label', async () => {
  const { store, ids } = await syntheticStore({ count: 6 });
  const snapshot = await collectSnapshot(store, { now: NOW, days: 90 });
  const report = buildReport(snapshot, { minCell: 5, by: 'year' });
  const html = renderHtml(report);
  // it is a whole, self-contained document
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.match(html, /<svg viewBox=/);
  assert.equal(html.includes('</html>'), true);
  // no script, no external request of any kind: it opens offline
  assert.equal(/<script/i.test(html), false);
  assert.equal(/<link\b/i.test(html), false);
  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(/src\s*=|@import|url\(/i.test(html), false);
  // nothing identifying, in the page or in the JSON beside it
  const json = JSON.stringify(report);
  for (const text of [html, json]) {
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(text), false);
    assert.equal(/Kelinci/.test(text), false);
    assert.equal(/Keluarga/.test(text), false);
    for (const id of ids) assert.equal(text.includes(id), false);
  }
  // the page says what it is, top and bottom, and explains the dashes
  assert.equal(html.split('operator only — aggregated family data').length - 1, 2);
  assert.match(html, /computed from fewer than 5 families/);
  assert.match(html, /6 live families/);
  // the numbers a six-family cohort may carry are there
  assert.match(html, /Asia\/Jakarta/);
  assert.match(html, /Pulse ring/);
  assert.equal(report.households.total.value, 6);
  assert.equal(report.shop.items.find((i) => i.id === 'ring_pulse').purchases.value, 6);
  // the Engine band that was much faster than its neighbours is flagged, on the page and in the report
  assert.equal(report.speed.engine.flags.easy.length, 1);
  assert.equal(report.speed.engine.flags.easy[0].band, 'C 21–25');
  assert.match(html, /passed unusually easily/);
  assert.equal(report.speed.nav.flags.hard.length, 1);      // the Navigator band that ate its allowance
  // a parent-entered reward name reaches the appendix and nowhere else on a line with anything
  assert.match(html, /<li>Uang jajan<\/li>/);
  assert.deepEqual(report.rewards.names, ['Nonton film', 'Uang jajan']);
});

test('smoke: a parent-entered name that is HTML cannot become HTML in the page', async () => {
  const { store } = await syntheticStore({ count: 5 });
  const familyId = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await store.put(`families/${familyId}/game/config`, { rewards: [reward('r9', '<img src=x onerror=alert(1)> & "quoted"', 400)], rocket: null, rocketHistory: [], updatedAt: NOW - 9 * DAY });
  const html = renderHtml(buildReport(await collectSnapshot(store, { now: NOW, days: 90 }), { minCell: 5 }));
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quoted&quot;/);
  assert.equal(/<script|<img/i.test(html), false); // it is text on the page, not markup
});

test('smoke: an empty project still renders a page that explains itself', () => {
  const html = renderHtml(buildReport({ now: NOW, days: 90, families: [] }, { minCell: 5 }));
  assert.match(html, /0 live families/);
  assert.match(html, /Not enough days clear the 5-family floor to draw a line/);
  assert.match(html, /No timed session has been recorded for this track yet/);
  assert.match(html, /operator only/);
});

test('smoke: the report a --min-cell of 1 produces still carries no id, only more numbers', async () => {
  const { store, ids } = await syntheticStore({ count: 2 });
  const report = buildReport(await collectSnapshot(store, { now: NOW, days: 90 }), { minCell: 1 });
  const html = renderHtml(report);
  assert.equal(report.households.total.value, 2);
  assert.match(html, /computed from fewer than 1 families/);
  for (const id of ids) assert.equal(html.includes(id), false);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(JSON.stringify(report)), false);
});
