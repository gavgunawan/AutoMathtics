// Stage 4.8 — the operator dashboard's arithmetic (server/analytics.mjs). These tests exercise the
// maths and the privacy rule, not the formatting: the suppression floor, the daily-active count in each
// family's own time zone across a daylight-saving change, and the household histograms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from './support.mjs';
import { cellFactory, median, mean, monthShift, monthRange, answeredIn, activityOf, households,
  subscriptionCalendar, dailyActive, bandOf, timedRow, speedMatrix, EASY, HARD,
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
