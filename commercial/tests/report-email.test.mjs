// The weekly email itself (email-v1): the subject, each child's section with its three lists, the pace line and the scan line,
// buttons only when due, one line for a child who did not play, the footer's way out, the plain-text twin, and no id, no
// unescaped name and nothing fetched from anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFamilyReport } from '../server/report.mjs';
import { renderReport, buttonsFor, subjectFor } from '../server/report-email.mjs';
import { freshProgress, normalizeProgress } from '../server/progress.mjs';

const ans = (track, l, t, s, ok) => ({ t, l, track, s, a: 100, ok: ok ? 1 : 0 });
const times = (n, make) => Array.from({ length: n }, make);
const row = (date, qlog, more = {}) => ({ ts: 0, date, track: 'engine', mode: 'paper', level: 3, levelId: 'D', papers: '41–45', correct: qlog.filter((x) => x.ok).length, incorrect: 0, timeout: 0, total: qlog.length, passed: qlog.every((x) => x.ok), secs: 720, qlog, ...more });
const ID = { allison: '6f1c2a7e-8b1d-4c3e-9a2b-1d2e3f4a5b6c', geralt: '7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', mia: '8b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e' };
const WEEK = '2026-W36', ORIGIN = 'https://pilot.example.test';
// Allison: right and fast everywhere, a scan passed; Geralt: division wrong again and again, fractions right but slow, timeouts; Mia: no play
function family({ geraltFocus = false, allisonName = 'Allison' } = {}) {
  const allison = normalizeProgress({ ...freshProgress(), engine: { level: 3, paper: 41, bossCleared: 2 }, wallet: { lastScanWeek: WEEK }, history: [
    row('2026-09-01', times(25, () => ans('engine', 3, 3, 30, true))), row('2026-09-03', times(25, () => ans('engine', 3, 3, 30, true))), row('2026-09-05', times(15, () => ans('nav', 3, 3, 40, true)), { track: 'nav' })] });
  const geralt = normalizeProgress({ ...freshProgress(), engine: { level: 4, paper: 30, bossCleared: 1 }, scanFocus: geraltFocus, history: [
    row('2026-09-02', [...times(12, () => ans('engine', 3, 4, 60, true)), ...times(5, () => ans('engine', 3, 4, 70, false)), ...times(3, () => ans('engine', 3, 4, 100, false))]),
    row('2026-09-04', [...times(10, () => ans('engine', 4, 3, 90, true)), ...times(8, () => ans('engine', 4, 2, 85, true)), ...times(2, () => ans('engine', 4, 3, 100, false))])] });
  return buildFamilyReport({ familyLabel: 'Adventurers', week: WEEK, children: [{ id: ID.allison, nickname: allisonName, progress: allison }, { id: ID.geralt, nickname: 'Geralt', progress: geralt }, { id: ID.mia, nickname: 'Mia', progress: normalizeProgress(freshProgress()) }] });
}
const one = (progress, nickname = 'Allison') => buildFamilyReport({ week: WEEK, children: [{ id: ID.allison, nickname, progress: normalizeProgress({ ...freshProgress(), ...progress }) }] });
// the job signs real tokens (report.mjs links); here any link will do, as long as it is only ever in an href
function links(d) {
  return { app: `${ORIGIN}/`, settings: `${ORIGIN}/`, unsubscribe: `${ORIGIN}/#email=v1.unsub.sig`,
    children: Object.fromEntries(d.children.map((c, i) => { const b = buttonsFor(c); return [c.childId, { ...(b.pace !== null ? { pace: `${ORIGIN}/#email=v1.pace${i}.sig` } : {}), ...(b.focus !== null ? { focus: `${ORIGIN}/#email=v1.focus${i}.sig` } : {}) }]; })) };
}

test('the subject names who played and how many sessions were started and finished; each child\'s section says what went right and fast, right but slow, and wrong again and again', () => {
  const d = family(), r = renderReport(d, links(d));
  assert.equal(r.subject, 'Allison and Geralt this week: 5 sessions started, 5 finished'); assert.equal(subjectFor(d), r.subject);
  for (const s of ['✅ Right and fast', 'Division · difficulty 3 of 5 — 50 of 50 right, using about 30% of the time allowed', 'Word problems · Sector D (sharing and grouping in stories) · difficulty 3 of 5 — 15 of 15 right, using about 40% of the time allowed',
    '⚠️ Wrong again and again', 'Division · difficulty 4 of 5 — wrong 8 times out of 20 (3 ran out of time)',
    '🐢 Right but slow', 'Subtracting fractions · difficulty 3 of 5 — 10 of 12 right, but using about 90% of the time allowed', 'Adding fractions · difficulty 2 of 5 — 8 of 8 right, but using about 85% of the time allowed',
    '3 sessions started · 3 finished · 3 passed (15 papers) · 65 questions answered · 100% right · 36 minutes', '2 sessions started · 2 finished · 40 questions answered · 75% right · 24 minutes',
    '31 Aug – 6 Sep 2026 · 5 sessions started · 5 finished · 90% right across 105 answers',
    'A session is one run of papers: 15 word problems on Navigator, or 25 questions on Engine. Left early means quit or restarted before the last question.',
    '⏱ Pace: Allison uses under half the time allowed on 8 in 10 correct answers, at 100% accuracy: the goldilocks pace is 75% (now 100%) — more push, still room to think.',
    '⏱ Pace: Geralt ran out of time on 13% of questions, at 75% accuracy: the goldilocks pace is 115% (now 100%) — more time to think it through.',
    '🧠 System Scan: passed this week.', '🧠 System Scan: not done this week. It resets every Monday.', 'Mia didn’t play this week.']) assert.ok(r.text.includes(s), s);
  assert.ok(r.text.indexOf('Subtracting fractions') < r.text.indexOf('Adding fractions'), 'the slowest first');
});

test('buttons only when due: the pace when a change is suggested, the scan focus to offer when the focused scan has styles to use, or to switch off; none for a child who did not play', () => {
  const d = family(), r = renderReport(d, links(d));
  assert.deepEqual(d.children.map(buttonsFor), [{ pace: 75, focus: null }, { pace: 115, focus: true }, { pace: null, focus: null }]);
  for (const [label, href] of [['Set Allison’s pace to 75%', `${ORIGIN}/#email=v1.pace0.sig`], ['Set Geralt’s pace to 115%', `${ORIGIN}/#email=v1.pace1.sig`], ['Focus Geralt’s System Scan on these', `${ORIGIN}/#email=v1.focus1.sig`]]) {
    assert.ok(r.html.includes(`href="${href}"`) && r.html.includes(`>${label}</a>`), label); assert.ok(r.text.includes(`${label}: ${href}`), label);
  }
  assert.ok(r.text.includes(['Next week’s scan can focus on what Geralt finds hardest in all recent play, not only this week: about 75% of its questions on these styles, 25% recap.', '🎯 Scan focus',
    '  - Division · difficulty 4 of 5 — wrong again and again', '  - Subtracting fractions · difficulty 3 of 5 — right but slow', '  - Adding fractions · difficulty 2 of 5 — right but slow',
    `  Focus Geralt’s System Scan on these: ${ORIGIN}/#email=v1.focus1.sig`].join('\n')), 'the styles the focused scan would use, named, then the button');
  assert.ok(!/Focus Allison|scan focus off|Set Mia/.test(r.html + r.text), 'nothing weak, nothing to switch, nobody who did not play');
  const on = family({ geraltFocus: true }), s = renderReport(on, links(on));
  assert.ok(s.html.includes('Switch Geralt’s scan focus off') && s.text.includes('Geralt’s System Scan is focused on these styles: about 75% of its questions, 25% recap.\n🎯 Scan focus\n  - Division · difficulty 4 of 5 — wrong again and again')); assert.ok(!s.html.includes('Focus Geralt’s System Scan'));
  const without = renderReport(d, { ...links(d), children: {} }); assert.ok(!/Set Allison|Focus Geralt/.test(without.html), 'no link given, no button');
  // a locked scan says when it opens and offers nothing; a pace in the zone or a short week has no button
  const locked = one({ engine: { level: 0, paper: 50, bossCleared: 2 }, history: [row('2026-09-01', [...times(11, () => ans('engine', 0, 3, 40, true)), ...times(4, () => ans('engine', 0, 3, 50, false))])] });
  const l = renderReport(locked, links(locked));
  assert.ok(l.text.includes('🧠 System Scan unlocks at Engine Sector B, paper 21.')); assert.ok(!/System Scan on these|scan focus off/.test(l.html));
  assert.ok(l.text.includes('Not enough play this week to suggest a pace (15 answers; 20 needed).')); assert.ok(!l.html.includes('pace to'));
  const tried = one({ engine: { level: 3, paper: 41, bossCleared: 2 }, history: [row('2026-09-04', [...times(24, () => ans('engine', 3, 3, 40, true)), ans('engine', 3, 3, 50, false)], { mode: 'scan', papers: 'SYSTEM SCAN' })] });
  assert.ok(renderReport(tried, links(tried)).text.includes('🧠 System Scan: tried this week, not passed yet (a pass needs all 25 right). It resets every Monday.'));
  const zone = one({ engine: { level: 3, paper: 41, bossCleared: 2 }, history: [row('2026-09-01', times(20, () => ans('engine', 3, 3, 76, true)))] }), z = renderReport(zone, links(zone));
  assert.ok(z.text.includes('already in the goldilocks zone')); assert.ok(!z.html.includes('pace to')); assert.equal(z.subject, 'Allison this week: 1 session started, 1 finished');
});

test('the scan focus is offered on the focused scan\'s own list, and only when it has one: all recent play, Engine only, none above the sector now', () => {
  const E = { level: 3, paper: 41, bossCleared: 2 }, fast = row('2026-09-01', times(20, () => ans('engine', 3, 3, 30, true)));
  // nothing weak this week, but Multiplication went wrong again and again three weeks ago: the focused scan would practise it, so it is offered and named
  const earlier = one({ engine: E, history: [fast, row('2026-08-12', [...times(2, () => ans('engine', 2, 3, 40, true)), ...times(4, () => ans('engine', 2, 3, 50, false))])] }), e = renderReport(earlier, links(earlier));
  assert.deepEqual([earlier.children[0].trouble.length, earlier.children[0].slow.length], [0, 0]); assert.equal(buttonsFor(earlier.children[0]).focus, true);
  assert.ok(e.text.includes('🎯 Scan focus\n  - Multiplication · difficulty 3 of 5 — wrong again and again\n  Focus Allison’s System Scan on these:'), e.text);
  // wrong again and again this week, but in Sector E while a placement has the child in Sector D: the scan would not use it, so no offer
  const above = one({ engine: E, history: [row('2026-09-01', [...times(11, () => ans('engine', 4, 2, 40, true)), ...times(3, () => ans('engine', 4, 2, 50, false))])] });
  assert.equal(above.children[0].trouble.length, 1); assert.equal(buttonsFor(above.children[0]).focus, null); assert.ok(!/Scan focus|System Scan on these/.test(renderReport(above, links(above)).text));
  // Navigator trouble only: the scan is all Engine, no offer
  const nav = one({ engine: E, history: [row('2026-09-01', [...times(11, () => ans('nav', 3, 3, 40, true)), ...times(3, () => ans('nav', 3, 3, 50, false))], { track: 'nav' })] });
  assert.equal(nav.children[0].trouble.length, 1); assert.equal(buttonsFor(nav.children[0]).focus, null);
  // the focus on with nothing weak: said so, with the way to switch it off
  const idle = one({ engine: E, scanFocus: true, history: [fast] }), i = renderReport(idle, links(idle));
  assert.equal(buttonsFor(idle.children[0]).focus, false); assert.ok(i.text.includes('Allison’s System Scan focus is on, but no Engine style is weak right now, so the scan asks its usual questions.\n  Switch Allison’s scan focus off:'), i.text);
});

test('a pace held by a bound gets no button, and its sentence says which bound: 25% with fast right answers is not raised to 30%', () => {
  const E = { level: 3, paper: 41, bossCleared: 2 };
  const low = one({ engine: E, pacePercent: 25, history: [row('2026-09-01', times(20, () => ans('engine', 3, 3, 30, true)))] }), l = renderReport(low, links(low));
  assert.equal(buttonsFor(low.children[0]).pace, null); assert.ok(!l.html.includes('pace to'));
  assert.ok(l.text.includes('⏱ Pace: Allison uses under half the time allowed on 8 in 10 correct answers, at 100% accuracy: the pace stays at 25%, as the goldilocks pace never goes under 30%.'), l.text);
  const high = one({ engine: E, pacePercent: 195, history: [row('2026-09-01', times(20, () => ans('engine', 3, 3, 100, true)))] }), h = renderReport(high, links(high));
  assert.equal(buttonsFor(high.children[0]).pace, null); assert.ok(h.text.includes('the pace stays at 195%, as the goldilocks pace never goes over 200%.'), h.text);
});

test('the footer says why, how to stop, where the settings are and who sent it; a busy week and a left-early week say so; many children shorten the subject', () => {
  const d = family(), r = renderReport(d, links(d));
  const why = 'You get this email because weekly reports are switched on for your AutoMathtics parent account. They come every Monday until you switch them off.';
  assert.ok(r.text.includes(why) && r.html.includes(why)); assert.ok(!/agreed|you created/i.test(r.text), 'true of every account, the owner\'s too, which predates the sign-up boxes');
  assert.ok(r.text.includes(`Stop weekly reports: ${ORIGIN}/#email=v1.unsub.sig`) && r.text.includes(`Email settings: ${ORIGIN}/`)); assert.ok(r.html.includes('>Stop weekly reports</a>') && r.html.includes('>Email settings</a>'));
  assert.ok(r.text.includes('AutoMathtics · Mission Control for parents · pilot.example.test'));
  const busy = one({ engine: { level: 3, paper: 41, bossCleared: 2 }, history: times(60, () => row('2026-09-02', times(5, () => ans('engine', 3, 3, 40, true)))) });
  assert.ok(renderReport(busy, links(busy)).text.includes('Some sessions from before the game kept every answer are missing: it kept only the newest 60 then.'));
  const quit = buildFamilyReport({ week: WEEK, children: [{ id: ID.allison, nickname: 'Allison', progress: normalizeProgress({ ...freshProgress(), history: [row('2026-09-02', times(25, () => ans('engine', 3, 3, 40, true)))] }) },
    { id: ID.geralt, nickname: 'Geralt', progress: normalizeProgress({ ...freshProgress(), history: [{ ts: 0, date: '2026-09-02', track: 'engine', mode: 'paper', level: 0, levelId: 'A', papers: '1–5', quit: true, atQ: 3, total: 25 }] }) }] });
  const q = renderReport(quit, links(quit));
  for (const words of ['1 session started · 0 finished · 1 left early · 3 questions answered · 0 minutes', '↩ Left early: 1 of 1 session.',
    'Sessions left early before the game kept every answer have no answers or time, so accuracy and minutes cover the rest.']) assert.ok(q.text.includes(words), words);
  assert.equal(q.subject, 'Allison and Geralt this week: 2 sessions started, 1 finished', 'a child who only left early has played, and is named');
  const many = buildFamilyReport({ week: WEEK, children: ['Ana', 'Ben', 'Cy', 'Di'].map((n, i) => ({ id: `id-${i}`, nickname: n, progress: normalizeProgress({ ...freshProgress(), history: [row('2026-09-02', times(5, () => ans('engine', 0, 1, 40, true)))] }) })) });
  assert.equal(subjectFor(many), 'Ana, Ben and 2 more this week: 4 sessions started, 4 finished');
});

test('a child who leaves sessions early: how many of how many, how they ended, straight after a wrong answer, the papers left most often, and no faster pace', () => {
  const T = Date.UTC(2026, 8, 2, 3), q = (n, ok) => times(n, () => ans('nav', 1, 2, 20, ok));
  const rec = (i, how, qlog, more = {}) => ({ id: `s${i}`, ts: T + i * 60_000, date: '2026-09-02', track: 'nav', mode: 'paper', level: 1, levelId: 'B', papers: '11–15', how, total: 15,
    answered: qlog.length, correct: qlog.filter((x) => x.ok).length, incorrect: qlog.filter((x) => !x.ok).length, timeout: 0, lastResult: qlog.length ? (qlog.at(-1).ok ? 'correct' : 'incorrect') : null, passed: false, secs: 20 * qlog.length, qlog, ...more });
  const plays = [rec(1, 'finished', q(15, true), { passed: true }), rec(2, 'finished', q(15, true), { passed: true }), ...times(5, (_, i) => rec(10 + i, 'restart', [...q(3, true), ...q(1, false)])), rec(20, 'quit', q(2, true)), rec(21, 'left_open', [])];
  const d = buildFamilyReport({ week: WEEK, children: [{ id: ID.geralt, nickname: 'Geralt', progress: normalizeProgress({ ...freshProgress(), pacePercent: 90 }), plays }] }), r = renderReport(d, links(d));
  for (const words of ['9 sessions started · 2 finished · 2 passed (10 papers) · 7 left early · 52 questions answered · 90% right · 17 minutes',
    '↩ Left early: 7 of 9 sessions (5 restarted, 1 quit, 1 left open); 5 of them straight after a wrong answer or a time-out. Left most often: Navigator Sector B, papers 11–15 (7 times).',
    '⏱ Pace: Geralt left 7 of 9 sessions before the end (5 straight after a wrong answer or a time-out): the pace stays at 90% until more sessions are finished.']) assert.ok(r.text.includes(words), `${words}\n---\n${r.text}`);
  assert.equal(buttonsFor(d.children[0]).pace, null); assert.ok(!r.html.includes('pace to'), 'no faster button while sessions end early');
  assert.equal(r.subject, 'Geralt this week: 9 sessions started, 2 finished');
  assert.ok(!r.text.includes('before the game kept every answer'), 'all recorded: no note about missing answers');
});

test('no id in sight, every typed name escaped, the game\'s colours, one column for a phone, and nothing fetched from anywhere', () => {
  const d = family({ allisonName: 'Ana-Maria O\'Neil' }), r = renderReport(d, links(d));
  for (const id of Object.values(ID)) { assert.ok(!r.html.includes(id), id); assert.ok(!r.text.includes(id), id); }
  assert.ok(r.html.includes('Ana-Maria O&#39;Neil')); assert.ok(!r.html.includes('O\'Neil'), 'never raw in the HTML'); assert.ok(r.text.includes('Ana-Maria O\'Neil'));
  assert.equal(r.subject, 'Ana-Maria O\'Neil and Geralt this week: 5 sessions started, 5 finished');
  for (const colour of ['#35E0FF', '#FF2DA8', '#07091A']) assert.ok(r.html.includes(colour), colour);
  assert.doesNotMatch(r.html, /<img|<link|<script|@import|url\(/i, 'no image, stylesheet, script or font from anywhere');
  const urls = [...r.html.matchAll(/https?:\/\/[^"'\s<)]+/g)].map((m) => m[0]); assert.ok(urls.length >= 5 && urls.every((u) => u.startsWith(`${ORIGIN}/`)), urls.join(' '));
  assert.ok(r.html.includes('max-width:600px') && r.html.includes('name="viewport"') && r.html.startsWith('<!doctype html>'));
  const visible = r.html.replace(/<[^>]+>/g, ' '); assert.ok(!visible.includes('v1.'), 'a token is only ever inside an href');
});
