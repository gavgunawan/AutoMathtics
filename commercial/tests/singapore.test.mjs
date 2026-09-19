// The Singapore-standard word problems that were Navigator until 19 Sep 2026 (server/questions/singapore.mjs), kept whole as
// the core of Olympia's SG-Moon: the same sweep the live tracks get, so the module is ready the day the moon opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { genSingapore, singaporeSecondsFor, SINGAPORE_TOPICS } from '../server/questions/singapore.mjs';
import { LEVELS } from '../server/questions/engine.mjs';
import { grade, answerText } from '../server/progress.mjs';
import { canonical, wrong } from './support.mjs';

test('every Singapore question is well formed and self-consistent: four choices at least, the answer inside them, no NaN, marked right and wrong as it should be', () => {
  let n = 0;
  for (let level = 0; level < LEVELS.length; level++) for (let tier = 1; tier <= 5; tier++) for (let i = 0; i < 300; i++) {
    const q = { ...genSingapore(level, tier), track: 'nav', level, tier, paper: tier * 20 }; n++;
    const text = JSON.stringify(q.display);
    assert.ok(!/NaN|undefined|null,|\[object/.test(text.replace(/"choices":null|"pre":null/g, '')), text);
    if (q.answer.type === 'choice') {
      const c = q.display.choices;
      assert.ok(Array.isArray(c) && c.length >= 4, `only ${c && c.length} choices: ${text}`);
      assert.ok(Number.isInteger(q.answer.v) && q.answer.v >= 0 && q.answer.v < c.length, text);
      assert.equal(new Set(c).size, c.length, `the same choice twice: ${text}`);
    }
    assert.equal(grade(q, canonical(q)), 'correct', `${text} ← ${JSON.stringify(canonical(q))}`);
    assert.equal(grade(q, wrong(q)), 'incorrect');
    assert.equal(typeof answerText(q), 'string'); assert.ok(singaporeSecondsFor(level, tier, 1) > 0);
  }
  assert.ok(n >= 9000);
});
test('no Singapore wording keeps the same right answer every time', () => {
  const seen = new Map();
  for (let level = 0; level < LEVELS.length; level++) for (let tier = 1; tier <= 5; tier++) for (let i = 0; i < 600; i++) {
    const q = genSingapore(level, tier); if (q.answer.type !== 'choice') continue;
    const key = `${level} · ${q.display.text.replace(/\d+(?:\.\d+)?/g, '#')}`;
    const e = seen.get(key) || seen.set(key, { n: 0, right: new Set() }).get(key);
    e.n++; e.right.add(q.display.choices[q.answer.v]);
  }
  const often = [...seen].filter(([, e]) => e.n >= 8);
  assert.deepEqual(often.filter(([, e]) => e.right.size < 2).map(([k, e]) => `${k} → always ${[...e.right]}`), []);
  assert.ok(often.length >= 60, `only ${often.length} wordings came up often enough to judge`);
});
// The browser draws the figure from this object and nothing else, so the shape is the contract (public/app.js figureView).
test('every figure a Singapore question carries is one the client can draw', () => {
  let bars = 0, pie = 0, table = 0, line = 0;
  for (let level = 0; level < LEVELS.length; level++) for (let tier = 1; tier <= 5; tier++) for (let i = 0; i < 40; i++) {
    const { display: d } = genSingapore(level, tier);
    if (!d.figure) continue;
    const f = d.figure, where = JSON.stringify(f);
    assert.ok(typeof f.title === 'string' && f.title.length > 0 && f.title.length < 32, where);
    const rows = f.bars || f.points || f.slices || f.rows;
    assert.ok(Array.isArray(rows) && rows.length >= 2 && rows.length <= 6, where);
    for (const l of (f.head || []).concat(rows.map((r) => r.label).filter(Boolean))) assert.ok(typeof l === 'string' && l.length > 0 && l.length < 12, `${l} in ${where}`);
    if (f.kind === 'bars' || f.kind === 'line') { f.kind === 'bars' ? bars++ : line++;
      assert.ok(rows.length >= 3 && (typeof f.unit === 'string' || f.unit === null), where);
      for (const p of rows) assert.ok(Number.isInteger(p.value) && p.value >= 0, where);
    } else if (f.kind === 'pie') { pie++;
      assert.ok(rows.length <= 5 && rows.every((s) => Number.isInteger(s.pct) && s.pct > 0), where);
      assert.equal(rows.reduce((a, s) => a + s.pct, 0), 100, where);
    } else if (f.kind === 'table') { table++;
      assert.ok(Array.isArray(f.head) && f.head.length >= 2 && f.head.length <= 4, where);
      for (const r of rows) assert.ok(Array.isArray(r.cells) && r.cells.length === f.head.length && r.cells.every((c) => typeof c === 'string' && c), where);
    } else assert.fail(`unknown figure kind ${f.kind}`);
  }
  assert.ok(bars && pie && table && line, `bars ${bars}, pie ${pie}, table ${table}, line ${line}`);
});
test('the Singapore syllabus lines are six sectors of words, one per Engine level', () => {
  assert.equal(SINGAPORE_TOPICS.length, LEVELS.length);
  for (const t of SINGAPORE_TOPICS) { assert.match(t.title, /^Sector [A-F] · /); assert.ok(t.lines.length >= 4 && t.lines.every((l) => typeof l === 'string' && l.length > 10)); }
});
