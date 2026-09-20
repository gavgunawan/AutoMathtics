// Olympia's eight moons (server/questions/olympia): every phase has its paper's real shape, every question is well formed
// and marked as it should be, every figure is one the client draws, no wording always has the same answer, and every
// question carries its worked solution in the house style (STEPS.md). MOON=sea narrows the sweep to one moon while writing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOONS, moonById, moonPublic, buildVisit, bandOf, phasePublic, PHASE_NAMES } from '../server/questions/olympia/moons.mjs';
import { NONE } from '../server/questions/olympia/common.mjs';
import { grade, answerText } from '../server/progress.mjs';

// the server's own right answer, and a near miss — support.mjs has the same two, but this sweep stays free of the whole service so one moon can be run while it is written
const canonical = (q) => { const a = q.answer; if (a.type === 'frac') return { n: String(a.n), d: String(a.d) }; if (a.type === 'dec') return String(Math.round(a.v * 100) / 100); return String(a.v); };
const wrong = (q) => { const a = q.answer; if (a.type === 'frac') return { n: String(a.n + 1), d: String(a.d) }; if (a.type === 'choice') return String((a.v + 1) % q.display.choices.length); if (a.type === 'dec') return ((Math.round(a.v * 100) + 100) / 100).toFixed(2); return String(a.v + 1); };

const ONLY = process.env.MOON || null;
const OPEN = MOONS.filter((m) => m.open && (!ONLY || m.id === ONLY));
const papers = (n) => { const out = []; for (const m of OPEN) for (let y = m.years[0]; y <= m.years[1]; y++) for (const ph of m.phases) for (let i = 0; i < n; i++) out.push({ m, y, ph, qs: buildVisit(m, y, ph.id) }); return out; };
const kindsOf = (qs) => qs.map((q) => (q.answer.type === 'choice' ? 'mc' : 'sa'));

test('the eight moons, all open, in the owner\'s order (SEAMO, AMO, SMC and WMI first, then HK, BKK and PHI, then DC), ids unique, three phases each whose minutes add up to the real paper\'s, and the public shape carries no generator', { skip: ONLY ? 'one moon' : false }, () => {
  assert.deepEqual(OPEN.map((m) => m.id), ['sea', 'us', 'sg', 't', 'hk', 'bkk', 'phi', 'dc']);
  assert.equal(new Set(MOONS.map((m) => m.id)).size, 8);
  for (const m of MOONS) {
    const p = moonPublic(m, m.years[0]); assert.equal(p.build, undefined); assert.equal(p.mod, undefined); assert.ok(/^[A-Z]+-Moon$/.test(p.name)); assert.ok(p.modelled && p.long && p.blurb && p.shape); assert.ok(Array.isArray(p.years) && p.years.length === 2);
    assert.deepEqual(m.phases.map((ph) => ph.id), ['alpha', 'beta', 'gamma'], m.id); assert.equal(m.phases.reduce((a, ph) => a + ph.minutes, 0), m.minutes, `${m.id}: the phases share the paper's ${m.minutes} minutes`);
    assert.deepEqual(p.phases.map((ph) => [ph.name, ph.sym]), [['Alpha', 'α'], ['Beta', 'β'], ['Gamma', 'γ']]); for (const ph of p.phases) { assert.ok(ph.title && ph.count > 0 && ph.minutes > 0 && ph.marks > 0, JSON.stringify(ph)); assert.ok(['mc', 'sa', 'mixed'].includes(ph.kind)); }
  }
  assert.deepEqual(Object.keys(PHASE_NAMES), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(MOONS.map((m) => m.minutes), [90, 90, 90, 80, 90, 90, 90, 40], 'the real papers\' times: WMI two 40-minute sittings, the AMC 8 forty minutes');
  assert.throws(() => buildVisit({ ...moonById('hk'), open: false }, 3, 'alpha'), /not open/); assert.throws(() => buildVisit(moonById('hk'), 3, 'delta'), /no phase/);
  assert.equal(moonById('us').years[0], 2, 'AMO has no Year 1 paper'); assert.equal(moonById('dc').years[0], 4, 'the AMC 8 is a Grade 8 paper: DC-Moon opens at Year 4');
  assert.equal(bandOf(moonById('sea'), 1), 'Paper A'); assert.equal(bandOf(moonById('sea'), 4), 'Paper B'); assert.equal(bandOf(moonById('sea'), 6), 'Paper C'); assert.equal(bandOf(moonById('t'), 5), 'Grade 5');
});
test('every phase is its paper\'s real section: SEAMO A ten 3-mark MC, B ten 4-mark MC, C five 6-mark SA, five options with "None of the above"; AMO fifteen MC of five then five and five SA; SMC 40/45/32 questions climbing 2→4 marks, two MC at Grades 1–4 and none at 5–6; WMI ten A6, five A8, ten B, all MC of four; the OCEC twins five a category in the real order, whole numbers; PhIMO ten MC with "None" then ten and five SA; the AMC 8 ten, ten, five MC of five', () => {
  for (const { m, y, ph, qs } of papers(4)) {
    const pub = phasePublic(m, ph, y), kinds = kindsOf(qs), sections = qs.map((q) => q.section), where = `${m.id} year ${y} ${ph.id}`;
    assert.equal(qs.length, pub.count, where); assert.equal(qs.length, ph.shape(y).length, where);
    if (m.id === 'sea') { assert.deepEqual([kinds, sections], ph.id === 'alpha' ? [Array(10).fill('mc'), Array(10).fill('M3')] : ph.id === 'beta' ? [Array(10).fill('mc'), Array(10).fill('M4')] : [Array(5).fill('sa'), Array(5).fill('M6')], where); for (const q of qs.filter((x) => x.answer.type === 'choice')) { const c = q.display.choices; assert.equal(c.length, 5, where); assert.equal(c.at(-1), NONE); } }
    if (m.id === 'us') { assert.deepEqual([kinds, sections], ph.id === 'alpha' ? [Array(15).fill('mc'), Array(15).fill('M3')] : ph.id === 'beta' ? [Array(5).fill('sa'), Array(5).fill('M5')] : [Array(5).fill('sa'), Array(5).fill('M6')], where); for (const q of qs.filter((x) => x.answer.type === 'choice')) { assert.equal(q.display.choices.length, 5); assert.ok(!q.display.choices.includes(NONE)); } }
    if (m.id === 'sg') {
      const total = { 1: 40, 2: 40, 3: 45, 4: 45, 5: 32, 6: 32 }[y]; assert.equal(m.phases.reduce((a, p) => a + p.shape(y).length, 0), total, `${where}: the real paper's ${total} questions`);
      const mcs = kinds.filter((k) => k === 'mc').length; assert.equal(mcs, ph.id === 'alpha' && y <= 4 ? 2 : 0, where); assert.ok(sections.every((s) => s === { alpha: 'M2', beta: 'M3', gamma: 'M4' }[ph.id]), where);
      for (const q of qs) { if (q.answer.type === 'choice') assert.equal(q.display.choices.length, 4); else assert.notEqual(q.answer.type, 'frac', `the real paper types no fractions: ${q.display.text}`); }
    }
    if (m.id === 't') { assert.deepEqual([kinds, sections], ph.id === 'alpha' ? [Array(10).fill('mc'), Array(10).fill('A6')] : ph.id === 'beta' ? [Array(5).fill('mc'), Array(5).fill('A8')] : [Array(10).fill('mc'), Array(10).fill('B')], where); for (const q of qs) assert.equal(q.display.choices.length, 4); }
    if (m.id === 'hk' || m.id === 'bkk') { assert.deepEqual([kinds, sections], ph.id === 'alpha' ? [Array(10).fill('sa'), [...Array(5).fill('LT'), ...Array(5).fill('AR')]] : ph.id === 'beta' ? [Array(10).fill('sa'), [...Array(5).fill('NT'), ...Array(5).fill('GE')]] : [Array(5).fill('sa'), Array(5).fill('CO')], where); for (const q of qs) assert.equal(q.answer.type, 'int', JSON.stringify(q)); }
    if (m.id === 'phi') { assert.deepEqual([kinds, sections], ph.id === 'alpha' ? [Array(10).fill('mc'), Array(10).fill('P1')] : ph.id === 'beta' ? [Array(10).fill('sa'), Array(10).fill('P2')] : [Array(5).fill('sa'), Array(5).fill('P3')], where); for (const q of qs.filter((x) => x.answer.type === 'choice')) { assert.equal(q.display.choices.length, 5); assert.equal(q.display.choices.at(-1), NONE); } }
    if (m.id === 'dc') { assert.deepEqual([kinds, sections], ph.id === 'alpha' ? [Array(10).fill('mc'), Array(10).fill('E')] : ph.id === 'beta' ? [Array(10).fill('mc'), Array(10).fill('M')] : [Array(5).fill('mc'), Array(5).fill('H')], where); for (const q of qs) { assert.equal(q.display.choices.length, 5); assert.ok(!q.display.choices.includes(NONE)); } }
    for (const q of qs) assert.ok(typeof q.cat === 'string' && q.cat.length > 2, `a category on every question: ${JSON.stringify(q)}`);
  }
});
test('every question of every moon is well formed and self-consistent: distinct choices with the answer among them, whole answers where a keypad is offered, marked right for the right answer and wrong for a near miss', () => {
  let n = 0;
  for (const { m, qs } of papers(ONLY ? 40 : 12)) for (const q of qs) {
    n++; const text = JSON.stringify(q);
    assert.ok(!/NaN|undefined|null,|\[object/.test(text.replace(/"choices":null|"unit":null/g, '')), text);
    assert.equal(q.display.layout, 'word'); assert.ok(typeof q.display.text === 'string' && q.display.text.length > 8 && q.display.text.length < 420, text);
    assert.ok(typeof q.read === 'string' && q.read.length > 8);
    if (q.answer.type === 'choice') { const c = q.display.choices; assert.ok(Array.isArray(c) && c.length >= 4 && c.length <= 5, text); assert.equal(new Set(c).size, c.length, `the same choice twice: ${text}`); assert.ok(c.every((x) => typeof x === 'string' && x.length > 0 && x.length < 40), text); assert.ok(Number.isInteger(q.answer.v) && q.answer.v >= 0 && q.answer.v < c.length, text); }
    else if (q.answer.type === 'int') assert.ok(Number.isInteger(q.answer.v) && Math.abs(q.answer.v) < 10_000_000, text);
    else if (q.answer.type === 'dec') assert.ok(Number.isFinite(q.answer.v) && Math.round(q.answer.v * 100) / 100 === q.answer.v, text);
    else if (q.answer.type === 'frac') assert.ok(Number.isInteger(q.answer.n) && Number.isInteger(q.answer.d) && q.answer.n >= 1 && q.answer.d >= 2 && q.answer.n < q.answer.d, text);
    else assert.fail(`unknown answer type in ${text}`);
    if (q.answer.type === 'int' && m.id !== 't') assert.ok(q.answer.v >= 0, `a negative answer outside T-Moon's negative numbers: ${text}`);
    assert.equal(grade(q, canonical(q)), 'correct', `${text} ← ${JSON.stringify(canonical(q))}`);
    assert.equal(grade(q, wrong(q)), 'incorrect', text);
    assert.equal(typeof answerText(q), 'string');
  }
  assert.ok(n >= (ONLY ? 3000 : 12_000), `only ${n} questions swept`);
});
test('every figure a moon question carries is one the client can draw: bars, pie, table, line, or the moons\' grid of cells', () => {
  const seen = { bars: 0, pie: 0, table: 0, line: 0, grid: 0 };
  for (const { qs } of papers(6)) for (const { display: d } of qs) {
    if (!d.figure) continue; const f = d.figure, where = JSON.stringify(f);
    assert.ok(typeof f.title === 'string' && f.title.length > 0 && f.title.length < 32, where);
    assert.ok(Object.hasOwn(seen, f.kind), `unknown figure kind ${f.kind}`); seen[f.kind]++;
    if (f.kind === 'grid') { assert.ok(Array.isArray(f.rows) && f.rows.length >= 1 && f.rows.length <= 8, where); const w = f.rows[0].cells.length; assert.ok(w >= 1 && w <= 8); for (const r of f.rows) { assert.ok(Array.isArray(r.cells) && r.cells.length === w, where); for (const c of r.cells) assert.ok(typeof c === 'string' && c.length <= 4, where); } continue; }
    const rows = f.bars || f.points || f.slices || f.rows; assert.ok(Array.isArray(rows) && rows.length >= 2 && rows.length <= 6, where);
    for (const l of (f.head || []).concat(rows.map((r) => r.label).filter(Boolean))) assert.ok(typeof l === 'string' && l.length > 0 && l.length < 12, `${l} in ${where}`);
    if (f.kind === 'bars' || f.kind === 'line') { assert.ok(typeof f.unit === 'string' || f.unit === null, where); for (const p of rows) assert.ok(Number.isInteger(p.value) && p.value >= 0, where); }
    else if (f.kind === 'pie') assert.equal(rows.reduce((a, s) => a + s.pct, 0), 100, where);
    else if (f.kind === 'table') { assert.ok(Array.isArray(f.head) && f.head.length >= 2 && f.head.length <= 4, where); for (const r of rows) assert.ok(Array.isArray(r.cells) && r.cells.length === f.head.length && r.cells.every((c) => typeof c === 'string' && c), where); }
  }
  if (!ONLY) assert.ok(seen.bars && seen.table && seen.grid, JSON.stringify(seen));
});
// a fact question (edges of a cube, the next triangular number) has one answer by nature; every other wording must move
const FIXED = new Set(['spatial visualisation', 'shapes', 'odd and even numbers', 'systematic listing', 'number patterns', 'counting figures', 'shortest path', 'probability',
  'geometry · shapes and solids', 'geometry · counting figures', 'arithmetic · smart calculation', 'logical thinking · guessing a number', 'geometry · shapes', 'geometry · symmetry', 'pattern and algebra · shape patterns', 'pattern and algebra · number patterns', 'combinatorics · routing', 'combinatorics · forming numbers', 'geometry · angles', 'truth and lies', 'probability · fractions', 'counting · letters']);
test('no moon wording (a fact question aside) keeps the same right answer every time', () => {
  const seen = new Map();
  for (const { m, y, qs } of papers(10)) for (const q of qs) {
    if (FIXED.has(q.cat) || /^Which of these (?:is about|weighs about|holds about)/.test(q.display.text)) continue; // a size question is answered by the number the key erases
    // digits, names, and a wording's singular and plural fold into one key (the pizza question's "1 piece is" alone always answers 3/4)
    const key = `${m.id}:${y <= 2 ? 'low' : y <= 4 ? 'mid' : 'high'} · ${q.display.text.replace(/\d+(?:[.,]\d+)?/g, '#').replace(/\b[A-Z][a-z]+\b/g, 'N').replace(/\bpieces? (?:is|are)\b/g, 'piece(s)').replace(/\b(\w+?)s\b/g, '$1')}`;
    const e = seen.get(key) || seen.set(key, { n: 0, right: new Set() }).get(key); e.n++; e.right.add(answerText(q));
  }
  // twelve sightings before a wording is judged: a puzzle whose answer is one of a few values can show the same one eight times by chance
  const often = [...seen].filter(([, e]) => e.n >= 12);
  assert.deepEqual(often.filter(([, e]) => e.right.size < 2).map(([k, e]) => `${k} → always ${[...e.right]}`), []);
  assert.ok(often.length >= (ONLY ? 5 : 40), `only ${often.length} wordings came up often enough to judge`);
});
test('each open moon says what it asks, band by band, for the hub', () => {
  for (const m of OPEN) { assert.ok(Array.isArray(m.topics) && m.topics.length >= 2 && m.topics.length <= 3); for (const t of m.topics) { assert.ok(/^(Paper|Grade)/.test(t.band)); assert.ok(t.lines.length === 4 && t.lines.every((l) => typeof l === 'string' && l.length > 12)); } }
});
// 💡 the worked solution on every question (STEPS.md, 20 Sep 2026): what Explain to me and the reveal show without the AI tutor
test('every question carries its worked solution: two to seven clean lines computed from the same numbers, the answer among them, and a one-line tip when there is one', () => {
  const missing = new Map(), faults = [];
  for (const { m, y, ph, qs } of papers(ONLY ? 20 : 6)) for (const q of qs) {
    const where = `${m.id} y${y} ${ph.id} · ${q.cat}`;
    if (!Array.isArray(q.steps) || q.steps.length < 2) { if (!missing.has(q.cat)) missing.set(q.cat, `${where}: ${q.display.text.slice(0, 90)}`); continue; }
    const text = q.steps.join('\n');
    if (q.steps.length > 8) faults.push(`${where}: ${q.steps.length} lines`);
    for (const l of q.steps) { if (typeof l !== 'string' || l.trim().length < 3 || l.length > 180) faults.push(`${where}: a bad line «${String(l).slice(0, 60)}»`); if (/undefined|NaN|\[object|\*\*|^[-*•] /.test(l)) faults.push(`${where}: «${l.slice(0, 80)}»`); }
    const want = answerText(q);
    if (want !== NONE && !text.includes(want)) faults.push(`${where}: the answer ${want} is not in the steps «${text.slice(0, 120).replace(/\n/g, ' / ')}»`);
    if (q.tip !== undefined && (typeof q.tip !== 'string' || q.tip.length < 10 || q.tip.length > 180 || /\n/.test(q.tip))) faults.push(`${where}: a bad tip «${String(q.tip).slice(0, 60)}»`);
  }
  assert.deepEqual([...missing.values()].slice(0, 60), [], `${missing.size} kinds without steps`);
  assert.deepEqual([...new Set(faults)].slice(0, 60), []);
});
