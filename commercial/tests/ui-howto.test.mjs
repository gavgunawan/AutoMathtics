// How to and the Guide (port plan section 2, rows 8-9; step 11): v2's static pages, opened from the child's home, and the How to
// that opens by itself before a new sector's first paper — once per child and sector, on a device that can remember it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { uiFixture } from './ui-support.mjs';
import { NAV_TOPICS } from '../server/questions/navigator.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const has = (h, label) => h.nodes('BUTTON').some((b) => b.textContent === label);
const lines = (h) => all(h.root).filter((n) => /\bhow-line\b/.test(n.className || '')).map((n) => n.textContent);
const home = (h) => h.root.textContent.includes('grid coins · spend in 🛒');
// the page's localStorage, as a browser that keeps site data has it
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
async function kid(t, options = {}) {
  const h = await uiFixture(t, options); await h.f.child(h.a.ctx, 'Allison');
  await h.api.refresh(); await h.click('Hand over to kids');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick(); h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  return h;
}

test('How to from the home: the Engine sector a line at a time, the next slide, then the tips with Back and ↺ Replay; a tab opens Navigator\'s', async (t) => {
  const h = await kid(t);
  for (const label of ['📖 How to', '🎓 Guide']) assert.ok(has(h, label), `${label} on the home`);
  await h.click('📖 How to');
  assert.ok(h.root.textContent.includes('⚙️ ENGINE · SECTOR A · HOW TO') && h.root.textContent.includes('Addition with carrying') && h.root.textContent.includes('The idea'));
  assert.deepEqual(lines(h), ['• Add column by column, starting from the RIGHT (the ones).']);
  const card = h.root.children[0];
  await h.click('Next step →'); await h.click('Next step →'); assert.equal(lines(h).length, 3);
  assert.equal(h.root.children[0], card, 'the card stays put while the lines come in');
  assert.equal(all(h.root).filter((n) => n.className === 'how-line fade').length, 1, 'only the newest line slides in');
  await h.click('Next step →');
  assert.ok(h.root.textContent.includes('Example: 478 + 256')); assert.deepEqual(lines(h), ['• Ones: 8 + 6 = 14 → write 4, carry 1']);
  for (let i = 0; i < 3; i++) await h.click('Next step →');
  assert.ok(!has(h, 'Next step →'), 'the end of the last slide');
  assert.ok(h.root.textContent.includes('💡 Tips & hacks') && lines(h).includes('★ HACK — Make tens: 9 + 7? Take 1 from the 7 → 10 + 6 = 16. Instant.'));
  assert.ok(has(h, 'Back') && has(h, '↺ Replay') && !has(h, 'Got it — start practicing ▶'), 'opened from the home it starts nothing');
  await h.click('↺ Replay'); assert.deepEqual(lines(h), ['• Add column by column, starting from the RIGHT (the ones).']);
  await h.click('🧭 NAVIGATOR');
  for (const words of ['🧭 NAVIGATOR · SECTOR A · HOW TO', 'Sector A · Navigator', 'How Navigator works', '• Read the question. Tap 🔊 any time to hear it read out.']) assert.ok(h.root.textContent.includes(words), words);
  assert.equal(h.nodes('BUTTON').find((b) => b.textContent === '🧭 NAVIGATOR').attrs['aria-selected'], 'true');
  assert.equal(h.requests.filter((r) => r.path === '/api/learn/session').length, 0, 'reading starts nothing');
  await h.back(); assert.ok(home(h), 'Back goes home');
});

test('the Guide: seven slides under step dots, Next and ← Back, skip, and Let\'s go home — in v3\'s words, not v2\'s Dad', async (t) => {
  const h = await kid(t);
  await h.click('🎓 Guide');
  const dots = () => all(h.root).find((n) => /^guide-dots\b/.test(n.className || ''));
  assert.ok(h.root.textContent.includes('🎓 QUICK GUIDE · ALLISON') && h.root.textContent.includes('Two kinds of loot'));
  assert.equal(dots().attrs['aria-label'], 'step 1 of 7'); assert.deepEqual(dots().children.map((d) => d.className), ['dot on', 'dot', 'dot', 'dot', 'dot', 'dot', 'dot']);
  assert.ok(dots().className.includes('acc-0'), 'in the child\'s colour'); assert.ok(!has(h, '← Back'), 'nothing before the first slide');
  assert.deepEqual(all(h.root).filter((n) => n.className === 'how-line fade').map((n) => n.style.props['--delay']), ['0.00s', '0.12s', '0.24s'], 'the lines come in one after another');
  const seen = [h.root.textContent];
  await h.click('Next →'); seen.push(h.root.textContent);
  assert.ok(h.root.textContent.includes('How you earn')); assert.deepEqual(dots().children.map((d) => d.className).slice(0, 3), ['dot seen', 'dot on', 'dot']);
  await h.click('← Back'); assert.ok(h.root.textContent.includes('Two kinds of loot'));
  for (let i = 0; i < 6; i++) { await h.click('Next →'); seen.push(h.root.textContent); }
  assert.ok(h.root.textContent.includes('Ready?') && !has(h, 'skip') && !has(h, 'Next →'));
  assert.ok(seen.every((s) => !/\bDad\b/.test(s)), 'a parent, not Dad');
  assert.ok(seen.some((s) => s.includes('The points are held while you wait, and come back if the answer is no.')), 'as the server holds a reward\'s points');
  await h.click("Let's go ▶"); assert.ok(home(h));
  await h.click('🎓 Guide'); await h.click('skip'); assert.ok(home(h));
});

test('a new sector\'s first paper opens its How to first, once per child and sector on a device that remembers, and Got it starts the paper; a device that keeps nothing goes straight in', async (t) => {
  const storage = memoryStorage(), h = await kid(t, { storage }), sessions = () => h.requests.filter((r) => r.path === '/api/learn/session').length;
  await h.click('⚙️ Start Engine ▶');
  assert.ok(h.root.textContent.includes('⚙️ ENGINE · SECTOR A · HOW TO'), 'the How to comes first'); assert.equal(sessions(), 0, 'nothing started yet');
  assert.ok(!h.nodes('BUTTON').some((b) => b.attrs.role === 'tab'), 'it is the How to of the track being started');
  while (has(h, 'Next step →')) await h.click('Next step →');
  await h.click('Got it — start practicing ▶'); assert.ok(h.root.textContent.includes('Paper 1 · 1/25'), 'then the paper');
  await h.click('✕ Quit');
  await h.click('🧭 Start Navigator ▶'); assert.ok(h.root.textContent.includes('🧭 NAVIGATOR · SECTOR A · HOW TO'), 'Navigator\'s first paper has its own');
  await h.back(); assert.ok(home(h));
  await h.click('🧭 Start Navigator ▶'); assert.ok(h.root.textContent.includes('Paper 1 · 1/15'), 'seen on this device: straight to the paper');
  assert.equal(storage.getItem(`automathtics.howto.${h.api.getModel().child.id}`), 'engine:A nav:A');

  const plain = await kid(t); // no storage: nothing to remember it by, so it is not shown on every start
  await plain.click('⚙️ Start Engine ▶'); assert.ok(plain.root.textContent.includes('Paper 1 · 1/25'));
});

test('the Navigator topics in the page are the server\'s own', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const client = vm.runInNewContext(`(${/const NAV_TOPICS = (\[[\s\S]*?\n\]);/.exec(app)[1]})`);
  assert.deepEqual(JSON.parse(JSON.stringify(client)), JSON.parse(JSON.stringify(NAV_TOPICS)));
});
