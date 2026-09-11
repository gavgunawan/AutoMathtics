// The weekly report's engine (email-v1): styles from the kept answers, the three classes on their thresholds, the week in the
// family's own time zone, a child's totals and System Scan status, and the goldilocks pace with each of its guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLE_RULES, styleStats, classify, classes, quantile, median, usable, timedOut, answersOf, weakStyles } from '../server/styles.mjs';
import { PACE_RULES, HISTORY_KEPT, NAV_TOPIC, goldilocks, paceSentence, buildChildReport, buildFamilyReport, weekStart, weekDays, lastWeek, weekLabel, styleLabel, inputsOf } from '../server/report.mjs';
import { NAV_TOPICS } from '../server/questions/navigator.mjs';
import { LEVELS, freshProgress, normalizeProgress } from '../server/progress.mjs';

// one answer: a style, the seconds used of those allowed (100 by default, so seconds read as percentages), right or not
const ans = (track, l, t, s, ok, a = 100) => ({ t, l, track, s, a, ok: ok ? 1 : 0 });
const eng = (l, t, s, ok, a) => ans('engine', l, t, s, ok, a);
const times = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const right = (n, s, l = 3, t = 2) => times(n, () => eng(l, t, s, true));
const wrongIn = (n, l = 3, t = 2) => times(n, () => eng(l, t, 50, false));     // wrong inside the allowance
const timeout = (n, l = 3, t = 2) => times(n, () => eng(l, t, 100, false));    // not right at the allowance: a timeout
const row = (date, qlog, more = {}) => ({ ts: 0, date, track: 'engine', mode: 'paper', level: 3, levelId: 'D', papers: '41–45', correct: qlog.filter((x) => x.ok).length, incorrect: 0, timeout: 0, total: qlog.length, passed: qlog.every((x) => x.ok), secs: 600, qlog, ...more });
const pace = (items, p = 100) => { const g = goldilocks(items, p); return [g.direction, g.suggested]; };

test('a style: answers, right, wrong with timeouts inferred at the allowance, accuracy and the median share of time a right answer used; rows from v2 say nothing', () => {
  const items = [eng(3, 2, 20, true), eng(3, 2, 40, true), eng(3, 2, 60, true), eng(3, 2, 100, false), eng(3, 2, 99, false), eng(3, 2, 130, true)];
  assert.deepEqual(items.map(timedOut), [false, false, false, true, false, false], 'not right at or past the allowance; right in the grace is still right');
  assert.deepEqual(styleStats(items), [{ key: 'engine:3:2', track: 'engine', level: 3, tier: 2, n: 6, correct: 4, wrong: 2, timeouts: 1, accuracy: 4 / 6, speed: 0.5, slowRight: 1 }]);
  for (const v2 of [{ t: 2, s: 30, ok: 1 }, { t: 2, l: 3, track: 'engine', s: 30, ok: 1 }, { t: 2, l: 3, track: 'engine', s: 30, a: 0, ok: 1 }, { t: 6, l: 3, track: 'engine', s: 1, a: 9, ok: 1 }, { t: 2, l: 3, track: 'boss', s: 1, a: 9, ok: 1 }, null]) assert.equal(usable(v2), false, JSON.stringify(v2));
  const v2row = { date: '2026-09-08', qlog: [{ t: 1, s: 20, ok: 1 }, { t: 2, s: 30, ok: 0 }] }, quit = { date: '2026-09-08', quit: true, atQ: 3 };
  assert.deepEqual(answersOf([v2row, quit, null, { date: 'x', qlog: 'no' }]), []); assert.equal(answersOf([row('2026-09-08', right(3, 40))]).length, 3);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null);
  assert.equal(quantile([...times(16, () => 0.45), ...times(4, () => 0.9)], 0.8), 0.45, 'nearest rank: the 16th of 20'); assert.equal(quantile([0.2], 0.8), 0.2); assert.equal(quantile([], 0.8), null);
});

test('the three classes sit exactly on their thresholds, need five answers, and never overlap', () => {
  const cls = (items) => classify(styleStats(items)[0]);
  // right and fast: 90 % right, the median right answer at half its time
  assert.equal(cls([...times(9, (i) => eng(3, 2, 10 + 10 * i, true)), ...wrongIn(1)]), 'strong', '9 of 10 right, median 0.5');
  assert.equal(cls([...times(9, (i) => eng(3, 2, 11 + 10 * i, true)), ...wrongIn(1)]), null, 'median 0.51 is not fast');
  assert.equal(cls([...right(8, 40), ...wrongIn(2)]), null, '80 % is not strong, and 0.4 is not slow');
  // right but slow: 80 % right, the median right answer at three quarters of its time
  assert.equal(cls([eng(3, 2, 70, true), eng(3, 2, 75, true), eng(3, 2, 75, true), eng(3, 2, 80, true), ...wrongIn(1)]), 'slow', '4 of 5, median 0.75');
  assert.equal(cls([eng(3, 2, 70, true), eng(3, 2, 70, true), eng(3, 2, 75, true), eng(3, 2, 80, true), ...wrongIn(1)]), null, 'median 0.725 is not slow');
  assert.equal(cls([...right(7, 80), ...wrongIn(2)]), null, '7 of 9 (78 %) is not slow, and two wrong is not trouble');
  // wrong again and again: three wrong (timeouts count) and under 80 % right
  assert.equal(cls([...right(11, 40), ...wrongIn(3)]), 'trouble', '3 wrong of 14 (79 %)');
  assert.equal(cls([...right(12, 40), ...wrongIn(3)]), null, '3 wrong of 15 is exactly 80 %: not trouble');
  assert.equal(cls([...right(11, 40), ...timeout(3)]), 'trouble', 'timeouts are wrong answers');
  assert.equal(cls([...right(2, 40), ...wrongIn(2)]), null, 'four answers: no class at all');
  assert.equal(cls(wrongIn(4).concat(wrongIn(1))), 'trouble', 'no right answer: no speed, still trouble');
  assert.deepEqual(STYLE_RULES, { minAnswers: 5, strong: { accuracy: 0.9, speed: 0.5 }, slow: { accuracy: 0.8, speed: 0.75 }, trouble: { wrong: 3, accuracy: 0.8 }, top: 3, focusStyles: 4 });
});

test('the report lists the top three of each class: trouble by wrong answers, slow by speed, strong by answers, ties by style', () => {
  const items = [
    ...right(2, 40, 0, 1), ...wrongIn(5, 0, 1), ...right(2, 40, 0, 2), ...wrongIn(3, 0, 2), ...right(2, 40, 0, 3), ...wrongIn(4, 0, 3), ...right(2, 40, 0, 4), ...wrongIn(4, 0, 4),
    ...right(5, 76, 1, 1), ...right(5, 95, 1, 2), ...right(5, 88, 1, 3), ...right(5, 80, 1, 4),
    ...right(5, 30, 2, 1), ...right(9, 30, 2, 2), ...right(7, 30, 2, 3), ...right(6, 30, 2, 4),
  ];
  const lists = classes(styleStats(items));
  assert.deepEqual(lists.trouble.map((s) => s.key), ['engine:0:1', 'engine:0:3', 'engine:0:4'], '5 wrong, then 4 and 4 by style');
  assert.deepEqual(lists.slow.map((s) => s.key), ['engine:1:2', 'engine:1:3', 'engine:1:4'], 'the slowest first');
  assert.deepEqual(lists.strong.map((s) => s.key), ['engine:2:2', 'engine:2:3', 'engine:2:4'], 'the most answers first');
});

test('the System Scan\'s weak styles: Engine only, trouble first then slow, at most four, never above the sector now, weighted by misses, the same every time', () => {
  const history = [row('2026-09-01', [...right(4, 40, 3, 2), ...wrongIn(3, 3, 2), ...right(8, 95, 3, 1), ...right(2, 30, 3, 1)]),
    row('2026-08-20', [...right(3, 40, 2, 5), ...wrongIn(5, 2, 5), ...right(5, 80, 2, 3), ...times(6, () => ans('nav', 3, 2, 50, false)), ...right(1, 40, 1, 1), ...wrongIn(4, 1, 1)]),
    row('2026-08-10', [...right(1, 40, 4, 1), ...wrongIn(6, 4, 1), ...right(5, 90, 0, 5)])];
  const weak = weakStyles(history, 3);
  assert.deepEqual(weak.map((w) => [w.key, w.cls, w.misses]), [['engine:2:5', 'trouble', 5], ['engine:1:1', 'trouble', 4], ['engine:3:2', 'trouble', 3], ['engine:3:1', 'slow', 8]],
    'trouble by wrong answers, then slow; the Navigator style and the Sector E style above the sector now are left out; four at most');
  assert.deepEqual(weakStyles(history, 3), weak, 'deterministic'); assert.deepEqual(weakStyles(history, 3, 2).map((w) => w.key), ['engine:2:5', 'engine:1:1']);
  assert.deepEqual(weakStyles([row('2026-09-01', right(10, 20))], 3), [], 'nothing weak');
  assert.equal(weakStyles(history, 4)[0].key, 'engine:4:1', 'in Sector E the Sector E style counts');
});

test('goldilocks: 8 in 10 right answers inside 80 % of the time; not enough play; the zone; half rounds up; the clamps and the 25-point step', () => {
  assert.deepEqual(PACE_RULES, { minAnswers: 20, quantile: 0.8, target: 0.8, accuracy: 0.8, timeouts: 0.1, slower: 1.15, round: 5, min: 30, max: 200, step: 25, zone: 10 });
  const few = goldilocks(right(19, 40), 100); assert.equal(few.enough, false); assert.equal(few.direction, 'keep'); assert.equal(few.suggested, 100); assert.equal(few.evidence.n, 19);
  const fast = goldilocks([...right(16, 45), ...right(4, 90)], 100);
  assert.deepEqual(fast, { current: 100, suggested: 75, direction: 'faster', enough: true, held: false, evidence: { q: 0.45, accuracy: 1, timeoutRate: 0, n: 20 } }, '56.25 → 55, then 25 points in one week');
  assert.deepEqual(pace(right(20, 64)), ['faster', 80], 'exactly on target: 80');
  assert.deepEqual(pace(right(20, 76)), ['keep', 100], '95 is within 10 points: in the zone');
  assert.deepEqual(pace(right(20, 72)), ['faster', 90], '90 is 10 points away: a change');
  assert.deepEqual(pace(right(20, 62)), ['faster', 80], '77.5 rounds up to 80'); assert.deepEqual(pace(right(20, 61)), ['faster', 75], '76.25 rounds to 75');
  assert.deepEqual(pace(right(20, 110)), ['slower', 125], '137.5 → 140, then 25 points in one week');
  assert.deepEqual(pace(right(20, 30), 40), ['faster', 30], 'never under 30'); assert.deepEqual(pace(right(20, 100), 190), ['slower', 200], 'never over 200');
  assert.deepEqual(pace(right(20, 50), 97), ['faster', 72], 'the step is from the pace now, whatever it is');
  assert.equal(goldilocks(right(20, 64), undefined).current, 100, 'no pace on record: the default');
});

test('goldilocks guards: never faster under 80 % right or above 10 % timeouts; with that many timeouts at least 15 % slower, and never "in the zone"', () => {
  let g = goldilocks([...right(15, 40), ...wrongIn(5)], 100);
  assert.deepEqual([g.direction, g.suggested, g.held, g.evidence.accuracy], ['keep', 100, true, 0.75], 'fast but 75 % right: not faster');
  assert.deepEqual(pace([...right(16, 40), ...wrongIn(4)]), ['faster', 75], 'exactly 80 % right may go faster');
  g = goldilocks([...right(17, 50), ...timeout(3)], 100);
  assert.deepEqual([g.direction, g.suggested], ['slower', 115], 'quick right answers, but 15 % timeouts: at least 15 % slower'); assert.equal(g.evidence.timeoutRate, 0.15);
  assert.deepEqual(pace([...right(18, 50), ...timeout(2)]), ['faster', 75], 'exactly 10 % timeouts is allowed faster (62.5 → 65, then the step)');
  assert.deepEqual(pace([...right(17, 50), ...timeout(3)], 40), ['slower', 50], '40 × 1.15 = 46, rounded up so it stays at least that');
  assert.deepEqual(pace([...right(17, 50), ...timeout(3)], 195), ['slower', 200], '5 points, but timing out is never the zone');
  g = goldilocks([...right(17, 50), ...timeout(3)], 200); assert.deepEqual([g.direction, g.suggested], ['keep', 200], 'the most time there is');
  g = goldilocks(wrongIn(20), 100); assert.deepEqual([g.direction, g.suggested, g.held, g.evidence.q], ['keep', 100, true, null], 'nothing right: nothing to measure speed by');
  assert.deepEqual(pace(timeout(20)), ['slower', 115]);
});

test('the pace in one sentence, with the child named and no pronoun guessed', () => {
  const say = (items, p = 100) => paceSentence('Allison', goldilocks(items, p));
  assert.equal(say([...right(16, 45), ...right(4, 90)]), 'Allison uses under half the time allowed on 8 in 10 correct answers, at 100% accuracy: the goldilocks pace is 75% (now 100%) — more push, still room to think.');
  assert.equal(say([...right(17, 50), ...timeout(3)]), 'Allison ran out of time on 15% of questions, at 85% accuracy: the goldilocks pace is 115% (now 100%) — more time to think it through.');
  assert.equal(say(right(20, 110)), 'Allison needs up to 110% of the time allowed on 8 in 10 correct answers, at 100% accuracy: the goldilocks pace is 125% (now 100%) — more room to think.');
  assert.equal(say(right(20, 76)), 'Allison uses up to 76% of the time allowed on 8 in 10 correct answers, at 100% accuracy: the pace of 100% is already in the goldilocks zone.');
  assert.equal(say([...right(15, 40), ...wrongIn(5)]), 'Allison got 75% right this week: the pace stays at 100%, and gets faster only once accuracy is back to 80%.');
  assert.equal(say([...right(17, 50), ...timeout(3)], 200), 'Allison ran out of time on 15% of questions; the pace is already 200%, at the most time a question can have.');
  assert.equal(say(right(12, 40)), 'Not enough play this week to suggest a pace (12 answers; 20 needed).'); assert.equal(say(right(1, 40)), 'Not enough play this week to suggest a pace (1 answer; 20 needed).');
  for (const items of [right(20, 40), right(20, 90), wrongIn(20), timeout(20)]) assert.doesNotMatch(say(items), /\b(he|she|his|her|him)\b/i);
});

test('the week: ISO Mondays across years, weeks that do not exist, the label, and the last complete week in the family\'s own time zone', () => {
  assert.equal(weekStart('2026-W37'), Date.UTC(2026, 8, 7)); assert.equal(weekStart('2026-W01'), Date.UTC(2025, 11, 29)); assert.equal(weekStart('2026-W53'), Date.UTC(2026, 11, 28), '2026 has 53 weeks');
  for (const bad of ['2025-W53', '2026-W00', '2026-W54', '2026-37', 'x', null]) assert.equal(weekStart(bad), null, String(bad));
  assert.throws(() => weekDays('2025-W53'), /WEEK_INVALID/);
  assert.deepEqual(weekDays('2026-W36'), ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
  assert.equal(weekLabel('2026-W37'), '7–13 Sep 2026'); assert.equal(weekLabel('2026-W36'), '31 Aug – 6 Sep 2026'); assert.equal(weekLabel('2026-W01'), '29 Dec 2025 – 4 Jan 2026');
  // Monday 07:00 in Singapore is still Sunday in UTC and Los Angeles: each family's last complete week is its own
  const monday7 = Date.parse('2026-09-06T23:00:00Z');
  assert.equal(lastWeek(monday7, 'Asia/Singapore'), '2026-W36'); assert.equal(lastWeek(monday7, 'Asia/Jakarta'), '2026-W36'); assert.equal(lastWeek(monday7, 'Europe/London'), '2026-W36', 'midnight in London: Monday');
  assert.equal(lastWeek(monday7, 'UTC'), '2026-W35'); assert.equal(lastWeek(monday7, 'America/Los_Angeles'), '2026-W35');
  assert.equal(lastWeek(Date.parse('2027-01-04T01:00:00Z'), 'Asia/Singapore'), '2026-W53');
});

test('a child\'s week: rows dated in the week only, quits apart, the totals, papers passed, and the System Scan passed, available or locked', () => {
  const week = '2026-W36';
  const history = [
    row('2026-09-07', right(25, 40)),                                                          // Monday after: next week
    row('2026-09-06', [...right(20, 40), ...wrongIn(5)], { passed: false, secs: 900 }),         // Sunday: in
    { ts: 0, date: '2026-09-05', track: 'nav', mode: 'paper', level: 3, levelId: 'D', papers: '21–25', quit: true, atQ: 4, total: 15 }, // left early: counted apart
    row('2026-09-03', right(25, 30), { secs: 720 }),                                            // a pass: five papers
    row('2026-09-02', right(25, 60), { mode: 'boss', papers: 'CP T2', secs: 780 }),              // a check point cleared
    row('2026-08-31', [{ t: 1, s: 20, ok: 1 }, { t: 1, s: 20, ok: 1 }], { secs: 60, passed: false }), // Monday: in, but v2-shaped answers say nothing
    row('2026-08-30', wrongIn(25)),                                                            // Sunday before: out
  ];
  const r = buildChildReport({ history, pacePercent: 100, scanFocus: false, lastScanWeek: null, levels: { engine: { level: 3, paper: 41 }, nav: { level: 3, paper: 21 } }, week, nickname: 'Allison' });
  assert.deepEqual(r.totals, { questions: 75, correct: 70, accuracy: 70 / 75, minutes: Math.round((900 + 720 + 780 + 60) / 60), sessions: 4, left: 1, passes: 2, papersPassed: 5, checkpoints: 1 });
  assert.equal(r.answered, true); assert.equal(r.scan.status, 'available'); assert.equal(r.scan.focus, false); assert.equal(r.partial, false);
  assert.equal(r.trouble.length, 0); assert.ok(r.pace.enough); assert.match(r.pace.sentence, /^Allison /);
  const scanRow = row('2026-09-04', right(25, 40), { mode: 'scan', papers: 'SYSTEM SCAN' });
  assert.equal(buildChildReport({ history: [scanRow], levels: { engine: { level: 3, paper: 41 } }, week }).scan.status, 'passed', 'a passed scan row in the week');
  assert.equal(buildChildReport({ history: [], lastScanWeek: week, levels: { engine: { level: 3, paper: 41 } }, week }).scan.status, 'passed', 'or the wallet\'s week');
  assert.equal(buildChildReport({ history: [], levels: { engine: { level: 1, paper: 20 } }, week }).scan.status, 'locked', 'Sector B before paper 21');
  assert.equal(buildChildReport({ history: [], levels: { engine: { level: 0, paper: 90 } }, week }).scan.status, 'locked', 'Sector A');
  const quiet = buildChildReport({ history: [history[2]], levels: { engine: { level: 0, paper: 1 } }, week, nickname: 'Geralt' });
  assert.equal(quiet.answered, false); assert.equal(quiet.totals.left, 1); assert.equal(quiet.pace.enough, false);
  // sixty rows kept, the oldest inside the week: the counts cover only what the progress document still holds
  const busy = times(HISTORY_KEPT, () => row('2026-09-02', right(5, 40)));
  assert.equal(buildChildReport({ history: busy, levels: { engine: { level: 3, paper: 41 } }, week }).partial, true);
  assert.equal(normalizeProgress({ history: times(70, () => row('2026-09-02', [])) }).history.length, HISTORY_KEPT, 'the progress document keeps this many');
  // the lists carry words for the parent, never an id
  const mixed = buildChildReport({ history: [row('2026-09-01', [...right(11, 40, 3, 2), ...wrongIn(3, 3, 2), ...times(5, () => ans('nav', 3, 3, 90, true))])], levels: { engine: { level: 3, paper: 41 } }, week });
  assert.deepEqual(mixed.trouble.map((s) => s.label), ['Division · difficulty 2 of 5']); assert.deepEqual(mixed.slow.map((s) => s.label), ['Word problems · Sector D (percentages, ratio, rate and averages) · difficulty 3 of 5']);
  assert.equal(mixed.engineWeak, true);
});

test('style words: the operation (by tier in the fraction sectors) or the word-problem sector and its topics, with the difficulty', () => {
  assert.equal(styleLabel({ track: 'engine', level: 0, tier: 1 }), 'Addition · difficulty 1 of 5'); assert.equal(styleLabel({ track: 'engine', level: 3, tier: 5 }), 'Division · difficulty 5 of 5');
  assert.equal(styleLabel({ track: 'engine', level: 4, tier: 1 }), 'Simplifying fractions · difficulty 1 of 5'); assert.equal(styleLabel({ track: 'engine', level: 4, tier: 3 }), 'Subtracting fractions · difficulty 3 of 5');
  assert.equal(styleLabel({ track: 'engine', level: 5, tier: 4 }), 'Dividing fractions · difficulty 4 of 5'); assert.equal(styleLabel({ track: 'engine', level: 5, tier: 5 }), 'Mixed fraction questions · difficulty 5 of 5');
  assert.equal(styleLabel({ track: 'nav', level: 0, tier: 2 }), 'Word problems · Sector A (numbers, early multiplication, time and measures) · difficulty 2 of 5');
  assert.equal(NAV_TOPIC.length, NAV_TOPICS.length); assert.equal(NAV_TOPIC.length, LEVELS.length);
  for (let level = 0; level < LEVELS.length; level++) for (let tier = 1; tier <= 5; tier++) for (const track of ['engine', 'nav']) assert.doesNotMatch(styleLabel({ track, level, tier }), /undefined|null|\?/);
});

test('the family\'s week: every child given, totals across them, answered only when someone answered; the inputs come from a normalised progress document', () => {
  const allison = normalizeProgress({ ...freshProgress(), engine: { level: 3, paper: 41, bossCleared: 2 }, pacePercent: 90, scanFocus: true, history: [row('2026-09-02', [...right(20, 40), ...wrongIn(5)])] });
  const geralt = normalizeProgress(freshProgress());
  assert.deepEqual(inputsOf(allison).levels.engine, { level: 3, paper: 41, bossCleared: 2 }); assert.equal(inputsOf(allison).scanFocus, true); assert.equal(inputsOf(geralt).scanFocus, false);
  const r = buildFamilyReport({ familyLabel: 'Adventurers', week: '2026-W36', children: [{ id: 'c-1', nickname: 'Allison', progress: allison }, { id: 'c-2', nickname: 'Geralt', progress: geralt }] });
  assert.equal(r.weekLabel, '31 Aug – 6 Sep 2026'); assert.equal(r.answered, true); assert.deepEqual(r.totals, { sessions: 1, questions: 25, correct: 20, accuracy: 0.8 });
  assert.deepEqual(r.children.map((c) => [c.childId, c.nickname, c.answered, c.pace.current]), [['c-1', 'Allison', true, 90], ['c-2', 'Geralt', false, 100]]);
  assert.equal(r.children[0].scan.focus, true);
  assert.equal(buildFamilyReport({ week: '2026-W36', children: [{ id: 'c-2', nickname: 'Geralt', progress: geralt }] }).answered, false, 'nobody answered: no email that week');
});
