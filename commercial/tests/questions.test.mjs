// Every generator, every sector, every tier: the question is well formed, the server's own answer
// grades as correct, a nearby wrong answer grades as incorrect, and malformed input is rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions, grade, answerText, tierOf, nextRun, freshProgress, settleJumps, bonusesFor, dayISO, LEVELS } from '../server/progress.mjs';
import { reduce } from '../server/questions/engine.mjs';
import { canonical, wrong } from './support.mjs';

test('engine and navigator questions are well formed and self-consistent under strict grading', () => {
  let n = 0;
  for (const track of ['engine', 'nav']) for (let level = 0; level < LEVELS.length; level++) for (let paper = 1; paper <= 100; paper += 7) {
    for (let i = 0; i < 4; i++) {
      const qs = buildQuestions(track, { mode: 'paper', level, startPaper: paper, tierEnd: null });
      assert.equal(qs.length, track === 'engine' ? 25 : 15);
      for (const q of qs) {
        n++;
        assert.ok(q.seconds > 0 && Number.isInteger(q.seconds));
        assert.equal(q.tier, tierOf(q.paper));
        const text = JSON.stringify(q.display);
        assert.ok(!/NaN|undefined|null,|\[object/.test(text.replace(/"choices":null|"pre":null/g, '')), text);
        if (q.answer.type === 'frac') { const [rn, rd] = reduce(q.answer.n, q.answer.d); assert.ok(rn === q.answer.n && rd === q.answer.d && rd > 1, 'frac answers are stored reduced'); }
        assert.equal(grade(q, canonical(q)), 'correct', `${text} ← ${JSON.stringify(canonical(q))}`);
        assert.equal(grade(q, wrong(q)), 'incorrect');
        for (const bad of ['abc', '12abc', '', ' 12', '1e3', 12, null, undefined, [], {}, { n: '1' }, { n: 1, d: 2 }, '99999999', '1.234']) {
          if (q.answer.type === 'dec' && bad === '1.234') continue; // dec allows 2 dp only — 1.234 is malformed too
          assert.equal(grade(q, bad), null, `${q.answer.type} accepted ${JSON.stringify(bad)}`);
        }
        assert.equal(typeof answerText(q), 'string');
      }
    }
  }
  assert.ok(n >= 14_400, `only ${n} questions generated`);
});
test('a check point draws its questions from the tier it guards', () => {
  for (const track of ['engine', 'nav']) for (const tierEnd of [20, 40, 60, 80, 100]) {
    const qs = buildQuestions(track, { mode: 'boss', level: 2, startPaper: null, tierEnd });
    assert.equal(qs.length, track === 'engine' ? 25 : 15);
    for (const q of qs) assert.ok(q.paper > tierEnd - 20 && q.paper <= tierEnd, `${q.paper} outside tier ending ${tierEnd}`);
  }
});
test('the next run is the due check point, the next papers, or practice once the sector is done', () => {
  const p = freshProgress();
  assert.deepEqual(nextRun(p, 'engine'), { mode: 'paper', level: 0, startPaper: 1, tierEnd: null });
  const due = { ...p, engine: { level: 0, paper: 21, bossCleared: 0 } };
  assert.deepEqual(nextRun(due, 'engine'), { mode: 'boss', level: 0, startPaper: null, tierEnd: 20 });
  const cleared = { ...due, engine: { level: 0, paper: 21, bossCleared: 1 } };
  assert.equal(nextRun(cleared, 'engine').mode, 'paper');
  const done = { ...p, nav: { level: 0, paper: 101, bossCleared: 5 } };
  const r = nextRun(done, 'nav'); assert.equal(r.mode, 'practice'); assert.ok(r.startPaper >= 1 && r.startPaper <= 96 && (r.startPaper - 1) % 5 === 0);
});
test('a finished track jumps only when the other track has finished the sector too', () => {
  const p = { ...freshProgress(), engine: { level: 0, paper: 101, bossCleared: 5 } };
  assert.deepEqual(settleJumps(p).jumped, []);
  const both = { ...p, nav: { level: 0, paper: 101, bossCleared: 5 } };
  const s = settleJumps(both);
  assert.deepEqual(s.jumped.sort(), ['engine', 'nav']);
  assert.deepEqual(s.p.engine, { level: 1, paper: 1, bossCleared: 0 }); assert.deepEqual(s.p.nav, { level: 1, paper: 1, bossCleared: 0 });
  const ahead = { ...p, nav: { level: 1, paper: 30, bossCleared: 1 } };
  assert.deepEqual(settleJumps(ahead).jumped, ['engine']);
});
test('streak bonuses count blocks of three consecutive pass-days in the family time zone', () => {
  assert.equal(bonusesFor(['2026-09-01', '2026-09-02', '2026-09-03']), 1);
  assert.equal(bonusesFor(['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']), 1);
  assert.equal(bonusesFor(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']), 2);
  assert.equal(dayISO(Date.parse('2026-09-06T17:30:00Z'), 'Asia/Singapore'), '2026-09-07'); // 01:30 the next day in Singapore
  assert.equal(dayISO(Date.parse('2026-09-06T17:30:00Z'), 'UTC'), '2026-09-06');
});
