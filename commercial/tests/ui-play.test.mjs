// A session in the v2 look (port plan section 2, row 4; test 6): the status row, the timer bar, the flash and the combo shout,
// the question sheet, and v2's keypad editing the one answer field that the form sends. The server marks every answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';
import { freshProgress } from '../server/progress.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const learning = (h, kid) => `families/${h.a.familyId}/learning/${kid.id}`;
async function kidWith(t, progress = null) {
  const h = await uiFixture(t, { recordBodies: ['/api/learn/answer'] }); const kid = (await h.f.child(h.a.ctx, 'Allison')).child;
  if (progress) await h.f.store.put(learning(h, kid), progress);
  await h.api.refresh(); await h.click('Hand over to kids');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick(); h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  return { h, kid };
}
const answers = (h) => h.requests.filter((r) => r.path === '/api/learn/answer');
const submit = async (h) => { h.nodes('FORM')[0].onsubmit({ preventDefault() {} }); await h.idle(); };
async function stored(h, kid, index) {
  const prog = await h.f.store.get(learning(h, kid));
  return (await h.f.store.get(`${learning(h, kid)}/sessions/${prog.activeSession}`)).questions[index];
}

test('test 6: v2\'s keypad edits the one answer field — a column sum fills from the ones digit and ⌫ takes the newest digit — and Go sends what is typed', async (t) => {
  const { h, kid } = await kidWith(t);
  await h.click('⚙️ Start Engine ▶');
  assert.ok(h.root.textContent.includes('Paper 1 · 1/25') && h.root.textContent.includes('⏱ 25s'), h.root.textContent.slice(0, 200));
  assert.equal(h.nodes('FORM').length, 1); assert.equal(h.nodes('INPUT').length, 1, 'the answer box is the only field on the play screen');
  const box = h.nodes('INPUT')[0];
  await h.click('7'); await h.click('3'); assert.equal(box.value, '37', 'each new digit goes in front: the ones digit first');
  await h.click('⌫'); assert.equal(box.value, '7', '⌫ takes the newest digit off');
  assert.ok(!h.nodes('BUTTON').some((b) => ['∕', '.'].includes(b.textContent)), 'no fraction bar or point for a whole-number answer');
  await submit(h);
  assert.equal(answers(h).length, 1); assert.equal(answers(h)[0].body.answer, '7');
  assert.ok(h.root.textContent.includes('Paper 1 · 2/25'));
  assert.ok(/✗ Not quite — it was \d+|⭐ Correct!/.test(h.root.textContent), 'the flash says what the server marked');
  // ↺ Restart: the run is quit (the log keeps the quit) and the same track starts again
  const first = (await h.f.store.get(learning(h, kid))).activeSession;
  await h.click('↺ Restart');
  const second = (await h.f.store.get(learning(h, kid))).activeSession;
  assert.notEqual(second, first); assert.equal((await h.f.store.get(`${learning(h, kid)}/sessions/${first}`)).status, 'quit');
  assert.ok(h.root.textContent.includes('Paper 1 · 1/25'));
});

test('test 6: a fraction is typed with the fraction bar, one bar only, and sent as {n, d}', async (t) => {
  const p = freshProgress(); p.engine = { level: 4, paper: 1, bossCleared: 0 }; p.nav = { level: 4, paper: 1, bossCleared: 0 }; // Sector E, tier 1: "Simplify:", a fraction answer
  const { h } = await kidWith(t, p);
  await h.click('⚙️ Start Engine ▶');
  assert.ok(h.root.textContent.includes('Simplify:'));
  assert.ok(all(h.root).some((n) => n.className === 'frac'), 'the fraction is drawn as a stack with its bar');
  for (const k of ['3', '∕', '4']) await h.click(k);
  const box = h.nodes('INPUT')[0]; assert.equal(box.value, '3/4', 'a fraction is typed left to right');
  await h.click('∕'); assert.equal(box.value, '3/4', 'one fraction bar');
  await submit(h);
  assert.deepEqual(answers(h)[0].body.answer, { n: '3', d: '4' });
  assert.ok(h.root.textContent.includes('Paper 1 · 2/25'), 'the server took it and asked the next question');
});

test('four right in a row: the combo shout in the equipped pack\'s words and the tier\'s colour, the sheet warms and the pet charges; the fifth closes paper 1 with a coin burst', async (t) => {
  const p = freshProgress(); Object.assign(p.wallet, { inventory: ['pet_dragon', 'shout_kapow', 'tbar_bolt'], activePet: 'pet_dragon', activeShout: 'shout_kapow', activeTimer: 'tbar_bolt' });
  const { h, kid } = await kidWith(t, p);
  await h.click('⚙️ Start Engine ▶');
  const fill = all(h.root).find((n) => /\btimer-fill\b/.test(n.className || ''));
  assert.ok(fill.className.includes('tbar-tbar_bolt'), 'the equipped timer skin'); assert.equal(fill.style.props['--w'], '100%');
  assert.ok(all(h.root).find((n) => /\bpetwrap\b/.test(n.className || '')).className.includes('petsway'), 'cold: the pet sways');
  for (let i = 0; i < 5; i++) {
    h.nodes('INPUT')[0].value = String((await stored(h, kid, i)).answer.v); await submit(h);
    if (i === 2) assert.ok(h.root.textContent.includes('⭐ Correct!'), 'three right: the plain flash');
  }
  const shout = all(h.root).find((n) => /\bcombo\b/.test(n.className || ''));
  assert.equal(shout.textContent, '🔥 5 POW!'); assert.ok(shout.className.includes('streak-1') && shout.className.includes('shout-kapow'));
  assert.ok(all(h.root).some((n) => n.className === 'sheet sheet-hot-1'), 'the sheet warms');
  assert.ok(all(h.root).find((n) => /\bpetwrap\b/.test(n.className || '')).className.includes('petcharge-1'), 'the pet charges');
  const burst = all(h.root).find((n) => n.className === 'splash'); assert.ok(burst, 'paper 1 closed with a coin burst'); assert.equal(burst.children.length, 9);
  assert.ok(burst.children.every((c) => ['--dx', '--dy', '--rot'].every((k) => k in c.style.props)), 'each coin flies on custom properties');
  assert.ok(h.root.textContent.includes('Paper 2 · 6/25'));
});
