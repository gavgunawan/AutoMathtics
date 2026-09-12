// Leaving, part three: how often the progress report comes — weekly (as it always was), monthly, or off. The record keeps one
// switch seen from two sides (`cadence` and `progress`), the unsubscribe panel may choose monthly instead of off, and a monthly
// family gets one email on the first Monday of the month covering its four complete weeks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, rejected, secret } from './support.mjs';
import { grantEntitlement } from '../server/service.mjs';
import { freshProgress } from '../server/progress.mjs';
import { prefsOf, cadenceOf, withChange, CADENCES, signEmailToken, linkExpiry, EMAIL_VERSION } from '../server/email.mjs';
import { Reports, MONTHLY_WEEKS, isMonthlySendWeek, monthlyWeeks, buildFamilyReport, weekLabel, rangeLabel } from '../server/report.mjs';
import { subjectFor } from '../server/report-email.mjs';
import { createMailer } from '../server/mailer.mjs';

const DAY = 86_400_000, ORIGIN = 'https://pilot.example.test', V = EMAIL_VERSION;
const ans = (l, t, s, ok) => ({ t, l, track: 'engine', s, a: 100, ok: ok ? 1 : 0 });
const times = (n, make) => Array.from({ length: n }, make);
const row = (date, qlog) => ({ ts: 0, date, track: 'engine', mode: 'paper', level: 3, levelId: 'D', papers: '41–45', correct: qlog.filter((x) => x.ok).length, incorrect: 0, timeout: 0, total: qlog.length, passed: qlog.every((x) => x.ok), secs: 700, qlog });
const played = (date) => row(date, times(25, () => ans(3, 3, 40, true)));
async function home(f, uid, history) {
  const a = await f.family(uid, 0);
  await grantEntitlement(f.store, { familyId: a.familyId, seatLimit: 4, accessUntil: f.now() + 90 * DAY, reason: 'synthetic pilot', actor: 'test-operator' }, f.now());
  const { child } = await f.child(a.ctx, 'Allison');
  await f.store.put(`families/${a.familyId}/learning/${child.id}`, { ...freshProgress(), engine: { level: 3, paper: 41, bossCleared: 2 }, history });
  return { ...a, childId: child.id };
}
const job = (f, more = {}) => { const mailer = more.mailer || createMailer({ provider: 'fake', store: f.store, now: f.now }); return { mailer, reports: new Reports({ store: f.store, identity: f.identity, secret, origin: ORIGIN, operator: 'test-job', now: f.now, ...more, mailer }) }; };
const byFamily = (r) => Object.fromEntries(r.results.map((x) => [x.familyId, [x.status, x.reason ?? null]]));
const unsubToken = (f, a, week = '2026-W35') => signEmailToken(secret, { a: 'unsub', v: 'progress', u: a.uid ?? 'parentA', f: a.familyId, w: week, e: linkExpiry('unsub', week) });

test('the record holds one switch seen from two sides: off is progress false, weekly is what every record written before this means, and on again after off is weekly again', () => {
  assert.deepEqual([...CADENCES], ['weekly', 'monthly', 'off']);
  assert.equal(cadenceOf(null), 'weekly'); assert.equal(cadenceOf({ progress: true }), 'weekly'); assert.equal(cadenceOf({ progress: false }), 'off');
  assert.equal(cadenceOf({ progress: true, cadence: 'monthly' }), 'monthly'); assert.equal(cadenceOf({ progress: false, cadence: 'monthly' }), 'off', 'off wins: there is no monthly report when there is none at all');
  assert.equal(cadenceOf({ cadence: 'fortnightly' }), 'weekly', 'nonsense on the record reads as the default');
  assert.deepEqual(prefsOf({ cadence: 'monthly' }), { progress: true, news: false, cadence: 'monthly' });
  let doc = withChange(null, { cadence: 'monthly' }, 'settings', 1);
  assert.deepEqual(doc, { progress: true, news: false, cadence: 'monthly', version: V, updatedAt: 1, changes: [{ at: 1, progress: true, news: false, cadence: 'monthly', source: 'settings', version: V }] });
  assert.equal(withChange(doc, { cadence: 'monthly' }, 'settings', 2), null, 'the same again: no row');
  doc = withChange(doc, { cadence: 'off' }, 'email', 3);
  assert.deepEqual([doc.progress, doc.cadence, doc.changes.length, doc.changes.at(-1).source], [false, 'off', 2, 'email']);
  doc = withChange(doc, { progress: true }, 'settings', 4);
  assert.deepEqual([doc.progress, doc.cadence], [true, 'weekly'], 'the switch back on is weekly, not the monthly it once was');
  const monthly = withChange(withChange(null, { cadence: 'monthly' }, 'settings', 1), { progress: false }, 'settings', 2);
  assert.deepEqual([monthly.progress, monthly.cadence], [false, 'off'], 'the old boolean still turns it off');
  assert.equal(withChange({ progress: true, news: false, cadence: 'weekly' }, { cadence: 'weekly', news: false }, 'settings', 5), null);
});

test('Mission Control may set the cadence, and only one of the three', async () => {
  const f = fixture(), a = await f.family('parentA', 1);
  assert.deepEqual(await f.email.setPrefs(a.ctx, { cadence: 'monthly' }), { progress: true, news: false, cadence: 'monthly' });
  assert.deepEqual((await f.service.me(a.ctx)).emailPrefs, { progress: true, news: false, cadence: 'monthly' });
  const doc = await f.store.get('emailPrefs/parentA'); assert.equal(doc.changes.at(-1).cadence, 'monthly'); assert.equal(doc.changes.at(-1).source, 'settings');
  assert.deepEqual(await f.email.setPrefs(a.ctx, { cadence: 'off' }), { progress: false, news: false, cadence: 'off' });
  assert.deepEqual(await f.email.setPrefs(a.ctx, { cadence: 'weekly', news: true }), { progress: true, news: true, cadence: 'weekly' });
  for (const bad of [{ cadence: 'daily' }, { cadence: true }, { cadence: null }, { cadence: 'weekly', other: 1 }]) await assert.rejects(f.email.setPrefs(a.ctx, bad), rejected('INVALID_REQUEST'), JSON.stringify(bad));
  const k = await f.childSession('parentB'); await assert.rejects(f.email.setPrefs(k.childCtx, { cadence: 'off' }), rejected('PARENT_REQUIRED'));
});

test('the unsubscribe link may choose monthly instead of off — less than the token already allows, never more', async () => {
  const f = fixture(), a = await home(f, 'parentA', [played('2026-08-26')]);
  const t = unsubToken(f, { ...a, uid: 'parentA' });
  const d = await f.email.describe({ t });
  assert.deepEqual([d.action, d.current, d.cadence], ['unsub', true, 'weekly'], 'the panel knows what the family has, so it can offer monthly first');
  const monthly = await f.email.apply({ t, cadence: 'monthly' });
  assert.match(monthly.message, /once a month, on the first Monday, covering four weeks/);
  let prefs = await f.store.get('emailPrefs/parentA');
  assert.deepEqual([prefs.cadence, prefs.progress, prefs.changes.at(-1).source], ['monthly', true, 'email']);
  assert.equal((await f.email.describe({ t })).cadence, 'monthly');
  const off = await f.email.apply({ t, cadence: 'off' });
  assert.match(off.message, /The weekly progress report is off/);
  prefs = await f.store.get('emailPrefs/parentA'); assert.deepEqual([prefs.cadence, prefs.progress], ['off', false]);
  assert.equal((await f.email.apply({ t, cadence: 'off' })).ok, true); assert.equal((await f.store.get('emailPrefs/parentA')).changes.length, 2, 'already off: no third row');
  assert.equal((await f.email.apply({ t })).ok, true, 'no cadence given: off, as the link always meant');
  // a cadence may not ride on a token for something else, and no token can switch a report on
  const pace = signEmailToken(secret, { a: 'pace', c: a.childId, v: 75, u: 'parentA', f: a.familyId, w: '2026-W35', e: linkExpiry('pace', '2026-W35') });
  await assert.rejects(f.email.apply({ t: pace, cadence: 'monthly' }), rejected('INVALID_REQUEST'));
  for (const cadence of ['weekly', 'daily', true, null]) await assert.rejects(f.email.apply({ t, cadence }), rejected('INVALID_REQUEST'), String(cadence));
  // RFC 8058 one-click stays what it was: off, and nothing else
  await f.email.setPrefs((await f.login('parentA')).ctx, { cadence: 'weekly' });
  assert.match((await f.email.unsubscribe(t)).message, /is off/);
  assert.equal((await f.store.get('emailPrefs/parentA')).cadence, 'off');
});

test('the month\'s four weeks: which week sends (the Monday after it is the month\'s first), which weeks it covers, and how it is labelled', () => {
  assert.equal(MONTHLY_WEEKS, 4);
  // W36 is 31 Aug – 6 Sep 2026; the job for it runs on Monday 7 September, the first Monday of the month
  assert.equal(isMonthlySendWeek('2026-W36'), true);
  assert.equal(isMonthlySendWeek('2026-W35'), false); assert.equal(isMonthlySendWeek('2026-W37'), false);
  assert.equal(isMonthlySendWeek('2026-W40'), true, 'W40 ends 4 October: the Monday out is 5 October, the first of that month');
  assert.equal(isMonthlySendWeek('nonsense'), false);
  // one send week per month, and exactly one: the week whose following Monday falls on the 1st to the 7th
  for (const w of ['2026-W36', '2026-W40', '2026-W44', '2026-W49', '2027-W04']) assert.equal(isMonthlySendWeek(w), true, w);
  const half = Array.from({ length: 26 }, (_, i) => `2026-W${String(36 + i).padStart(2, '0')}`).filter(isMonthlySendWeek);
  assert.deepEqual(half, ['2026-W36', '2026-W40', '2026-W44', '2026-W49', '2026-W53'], 'half a year of weeks, five send weeks: one a month, never two');
  assert.deepEqual(monthlyWeeks('2026-W36'), ['2026-W33', '2026-W34', '2026-W35', '2026-W36']);
  assert.deepEqual(monthlyWeeks('2026-W02'), ['2025-W51', '2025-W52', '2026-W01', '2026-W02'], 'across the turn of the year');
  assert.throws(() => monthlyWeeks('2026-W99'), /WEEK_INVALID/);
  assert.equal(weekLabel('2026-W36'), '31 Aug – 6 Sep 2026');
  assert.equal(rangeLabel('2026-08-10', '2026-09-06'), '10 Aug – 6 Sep 2026');
});

test('a monthly family\'s report covers its four weeks, says so, and adds them up; a weekly one is unchanged', () => {
  const history = [played('2026-08-12'), played('2026-08-26'), played('2026-09-02')]; // W33, W35, W36
  const progress = { ...freshProgress(), engine: { level: 3, paper: 41, bossCleared: 2 }, history };
  const kids = [{ id: 'c-1', nickname: 'Allison', progress }];
  const week = buildFamilyReport({ children: kids, week: '2026-W36' });
  assert.deepEqual([week.cadence, week.period, week.weeks, week.weekLabel], ['weekly', 'week', ['2026-W36'], '31 Aug – 6 Sep 2026']);
  assert.deepEqual(week.totals, { sessions: 1, questions: 25, correct: 25, accuracy: 1 });
  const month = buildFamilyReport({ children: kids, week: '2026-W36', cadence: 'monthly' });
  assert.deepEqual([month.cadence, month.period, month.weeks], ['monthly', 'month', ['2026-W33', '2026-W34', '2026-W35', '2026-W36']]);
  assert.equal(month.weekLabel, '10 Aug – 6 Sep 2026');
  assert.deepEqual(month.totals, { sessions: 3, questions: 75, correct: 75, accuracy: 1 }, 'all three weeks of play');
  assert.equal(month.week, '2026-W36', 'the report\'s own week is still the one it was made for: the buttons expire from it');
  assert.equal(subjectFor(month), 'Allison this month: 3 missions, 100% right');
  assert.equal(subjectFor(week), 'Allison this week: 1 mission, 100% right');
  // a month in which nothing was answered is no email either
  assert.equal(buildFamilyReport({ children: [{ id: 'c-2', nickname: 'Mia', progress: freshProgress() }], week: '2026-W36', cadence: 'monthly' }).answered, false);
});

test('the job: a monthly family waits for the first Monday of the month, then gets one email over four weeks with the monthly wording; a weekly family gets its week as always', async () => {
  const f = fixture();
  const weekly = await home(f, 'parentWeekly', [played('2026-08-26'), played('2026-09-02')]);
  const monthly = await home(f, 'parentMonthly', [played('2026-08-12'), played('2026-08-26')]);
  const off = await home(f, 'parentOff', [played('2026-08-26')]);
  await f.email.setPrefs(monthly.ctx, { cadence: 'monthly' }); await f.email.setPrefs(off.ctx, { cadence: 'off' });
  // the run for week 35: its Monday out is 31 August, so the monthly family is not due
  let { mailer, reports } = job(f), r = await reports.run(), by = byFamily(r);
  assert.equal(r.week, '2026-W35');
  assert.deepEqual(by[weekly.familyId], ['sent', null]);
  assert.deepEqual(by[monthly.familyId], ['skipped', 'monthly_not_due']);
  assert.deepEqual(by[off.familyId], ['skipped', 'progress_off']);
  assert.deepEqual(mailer.sent.map((m) => m.to), ['parentWeekly@example.test']);
  assert.equal((await f.store.get(`reports/${monthly.familyId}:2026-W35`)).reason, 'monthly_not_due', 'the log and the record both say why');
  // a week on: the run for week 36 goes out on Monday 7 September, the first Monday of the month
  f.advance(13 * 60 * 60_000); // Monday 7 September, 07:00 in Singapore: the first Monday of the month, with week 36 just complete
  ({ mailer, reports } = job(f)); r = await reports.run(); by = byFamily(r);
  assert.equal(r.week, '2026-W36');
  assert.deepEqual(by[monthly.familyId], ['sent', null]);
  const m = mailer.sent.find((x) => x.to === 'parentMonthly@example.test');
  assert.equal(m.subject, 'Allison this month: 2 missions, 100% right');
  assert.deepEqual(m.tags, [{ name: 'kind', value: 'monthly_report' }, { name: 'week', value: '2026-W36' }]);
  assert.equal(m.idempotencyKey, `report:${monthly.familyId}:2026-W36`);
  assert.ok(m.text.startsWith('AUTOMATHTICS · MONTHLY REPORT'), m.text.slice(0, 40));
  assert.ok(m.text.includes('Your family’s four weeks')); assert.ok(m.text.includes('10 Aug – 6 Sep 2026'));
  assert.ok(m.text.includes('the progress report is set to monthly for your AutoMathtics parent account. It comes on the first Monday of each month until you change it.'));
  assert.ok(m.text.includes(`Stop monthly reports: ${ORIGIN}/#email=`)); assert.ok(!m.text.includes('Stop weekly reports'));
  assert.ok(!/this week/.test(m.text), 'nothing in a monthly email says "this week"');
  assert.ok(m.html.includes('AUTOMATHTICS · MONTHLY REPORT'));
  // the weekly family's email is exactly what it always was
  const w = mailer.sent.find((x) => x.to === 'parentWeekly@example.test');
  assert.ok(w.text.startsWith('AUTOMATHTICS · WEEKLY REPORT')); assert.ok(w.text.includes('Your family’s week')); assert.ok(w.text.includes('Stop weekly reports: '));
  assert.deepEqual(w.tags[0], { name: 'kind', value: 'weekly_report' });
  // and a second run that month sends nothing again
  const again = await job(f, { mailer }).reports.run();
  assert.deepEqual(byFamily(again)[monthly.familyId], ['already', 'sent']);
  assert.equal(mailer.sent.filter((x) => x.to === 'parentMonthly@example.test').length, 1);
});

test('a monthly family that played in none of its four weeks gets nothing, and the switch off still stops everything', async () => {
  const f = fixture(), quiet = await home(f, 'parentQuiet', [played('2026-07-08')]); // nine weeks before the span
  await f.email.setPrefs(quiet.ctx, { cadence: 'monthly' });
  f.advance(13 * 60 * 60_000);
  const { mailer, reports } = job(f), r = await reports.run();
  assert.deepEqual(byFamily(r)[quiet.familyId], ['skipped', 'no_play']); assert.equal(mailer.sent.length, 0);
  await f.email.setPrefs((await f.login('parentQuiet')).ctx, { cadence: 'off' });
  await f.store.transaction(async (tx) => tx.delete(`reports/${quiet.familyId}:2026-W36`)); // a fresh decision for the same week
  assert.deepEqual(byFamily(await job(f).reports.run())[quiet.familyId], ['skipped', 'progress_off']);
});
