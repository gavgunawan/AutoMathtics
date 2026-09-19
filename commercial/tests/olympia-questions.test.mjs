// Olympia's four open moons (server/questions/olympia): every heat has the moon's real shape, every question is well formed
// and marked as it should be, every figure is one the client draws, and no wording always has the same answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOONS, moonById, moonPublic, buildVisit, bandOf, HEAT_QUESTIONS } from '../server/questions/olympia/moons.mjs';
import { NONE } from '../server/questions/olympia/common.mjs';
import { grade, answerText } from '../server/progress.mjs';
import { canonical, wrong } from './support.mjs';

const OPEN = MOONS.filter((m) => m.open);
const heats = (n) => { const out = []; for (const m of OPEN) for (let y = m.years[0]; y <= m.years[1]; y++) for (let i = 0; i < n; i++) out.push({ m, y, qs: buildVisit(m, y) }); return out; };

test('the seven moons: four open (SEAMO, AMO, SMC, WMI first — the owner\'s order), three drawn locked, ids unique, and the public shape carries no generator', () => {
  assert.deepEqual(OPEN.map((m) => m.id), ['sea', 'us', 'sg', 't']);
  assert.deepEqual(MOONS.filter((m) => !m.open).map((m) => m.id), ['hk', 'bkk', 'phi']);
  assert.equal(new Set(MOONS.map((m) => m.id)).size, 7);
  for (const m of MOONS) { const p = moonPublic(m); assert.equal(p.heat, undefined); assert.ok(/^[A-Z]+-Moon$/.test(p.name)); assert.ok(p.modelled && p.long && p.blurb && p.shape); assert.ok(Array.isArray(p.years) && p.years.length === 2); }
  assert.throws(() => buildVisit(moonById('hk'), 3), /not open/);
  assert.equal(moonById('us').years[0], 2, 'AMO has no Year 1 paper');
  assert.equal(bandOf(moonById('sea'), 1), 'Paper A'); assert.equal(bandOf(moonById('sea'), 4), 'Paper B'); assert.equal(bandOf(moonById('sea'), 6), 'Paper C'); assert.equal(bandOf(moonById('t'), 5), 'Grade 5');
});
test('every heat is ten questions in the moon\'s real shape: SEAMO 8 MC + 2 SA with five options and "None of the above" on Paper C; AMO 6 MC of five + 4 SA; SMC 5 + 5; WMI five logic then five applications, all MC', () => {
  for (const { m, y, qs } of heats(6)) {
    assert.equal(qs.length, HEAT_QUESTIONS, `${m.id} year ${y}`);
    const kinds = qs.map((q) => (q.answer.type === 'choice' ? 'mc' : 'sa')), sections = qs.map((q) => q.section);
    if (m.id === 'sea') { assert.deepEqual(kinds, [...Array(8).fill('mc'), 'sa', 'sa'], `${m.id} ${y}`); for (const q of qs.slice(0, 8)) { const c = q.display.choices; if (y >= 5) { assert.equal(c.length, 5); assert.equal(c.at(-1), NONE); } else { assert.equal(c.length, 4); assert.ok(!c.includes(NONE)); } } }
    if (m.id === 'us') { assert.deepEqual(kinds, [...Array(6).fill('mc'), ...Array(4).fill('sa')]); for (const q of qs.slice(0, 6)) { assert.equal(q.display.choices.length, 5); assert.ok(!q.display.choices.includes(NONE)); } }
    if (m.id === 'sg') { assert.deepEqual(kinds, [...Array(5).fill('mc'), ...Array(5).fill('sa')]); for (const q of qs.slice(0, 5)) assert.ok(q.display.choices.length >= 4); }
    if (m.id === 't') { assert.deepEqual(kinds, Array(10).fill('mc')); assert.deepEqual(sections, [...Array(5).fill('A'), ...Array(5).fill('B')]); }
    for (const q of qs) assert.ok(typeof q.cat === 'string' && q.cat.length > 2, `a category on every question: ${JSON.stringify(q)}`);
  }
});
test('every question of every moon is well formed and self-consistent: distinct choices with the answer among them, whole answers where a keypad is offered, marked right for the right answer and wrong for a near miss', () => {
  let n = 0;
  for (const { m, y, qs } of heats(60)) for (const q of qs) {
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
  assert.ok(n >= 12_000, `only ${n} questions swept`);
});
test('every figure a moon question carries is one the client can draw: bars, pie, table, line, or the moons\' grid of cells', () => {
  const seen = { bars: 0, pie: 0, table: 0, line: 0, grid: 0 };
  for (const { qs } of heats(25)) for (const { display: d } of qs) {
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
  assert.ok(seen.bars && seen.table && seen.grid, JSON.stringify(seen));
});
// a fact question (edges of a cube, the next triangular number) has one answer by nature; every other wording must move
const FIXED = new Set(['spatial visualisation', 'shapes', 'odd and even numbers', 'systematic listing', 'number patterns', 'counting figures', 'shortest path', 'probability']);
test('no moon wording (a fact question aside) keeps the same right answer every time', () => {
  const seen = new Map();
  for (const { m, y, qs } of heats(40)) for (const q of qs) {
    if (FIXED.has(q.cat) || /^Which of these (?:is about|weighs about|holds about)/.test(q.display.text)) continue; // a size question is answered by the number the key erases
    // digits, names, and a wording's singular and plural fold into one key (the pizza question's "1 piece is" alone always answers 3/4)
    const key = `${m.id}:${y <= 2 ? 'low' : y <= 4 ? 'mid' : 'high'} · ${q.display.text.replace(/\d+(?:[.,]\d+)?/g, '#').replace(/\b[A-Z][a-z]+\b/g, 'N').replace(/\bpieces? (?:is|are)\b/g, 'piece(s)').replace(/\b(\w+?)s\b/g, '$1')}`;
    const e = seen.get(key) || seen.set(key, { n: 0, right: new Set() }).get(key); e.n++; e.right.add(answerText(q));
  }
  const often = [...seen].filter(([, e]) => e.n >= 8);
  assert.deepEqual(often.filter(([, e]) => e.right.size < 2).map(([k, e]) => `${k} → always ${[...e.right]}`), []);
  assert.ok(often.length >= 40, `only ${often.length} wordings came up often enough to judge`);
});
test('each open moon says what it asks, band by band, for the hub', () => {
  for (const m of OPEN) { assert.ok(Array.isArray(m.topics) && m.topics.length >= 2 && m.topics.length <= 3); for (const t of m.topics) { assert.ok(/^(Paper|Grade)/.test(t.band)); assert.ok(t.lines.length === 4 && t.lines.every((l) => typeof l === 'string' && l.length > 12)); } }
});
