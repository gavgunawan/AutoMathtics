// The child's home in the v2 look (port plan section 2, row 3): the header, the card with the wallet, the day streak (S2),
// the track cards, the jump line and the Family Rocket with its crew line (the owner's choice, 11 Sep 2026), and the log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';
import { bootstrap } from '../server/ledger.mjs';
import { freshProgress, normalizeProgress } from '../server/progress.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const learning = (h, kid) => `families/${h.a.familyId}/learning/${kid.id}`;
async function enter(h, name) {
  await h.nodes('BUTTON').find((n) => n.className === 'player-card' && n.textContent.includes(name)).onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
}
// a balance the ledger has opened on, so that a pour can move it (the primitive refuses un-bootstrapped money)
async function earn(h, kid, gc, rp) {
  const path = learning(h, kid), p = normalizeProgress(await h.f.store.get(path));
  p.wallet.gc = gc; p.wallet.rp = rp; p.wallet.ledgerSeq = 0; p.wallet.ledgerLast = null; await h.f.store.put(path, p);
  await h.f.store.transaction(async (tx) => { const r = await bootstrap(tx, path, await tx.get(path), h.f.now()); if (r.opened) tx.set(path, r.prog); });
}

test('the home is v2\'s: the header with the name, sector and level, the wallet tiles, the day streak, both track cards, the jump line and the log', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx, 'Allison')).child;
  // the fixture's clock is 6 Sep 2026 in Singapore: passes yesterday and today make a run of two
  const p = freshProgress(); p.passDays = ['2026-09-05', '2026-09-06']; p.wallet.gc = 890; p.wallet.rp = 120; p.wallet.shields = 1;
  p.history = [
    { ts: Date.parse('2026-09-06T09:00:00Z'), date: '2026-09-06', track: 'engine', mode: 'paper', level: 0, levelId: 'A', papers: '1–5', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, secs: 754 },
    { ts: Date.parse('2026-09-05T09:00:00Z'), date: '2026-09-05', track: 'nav', mode: 'paper', level: 0, levelId: 'A', papers: '1–5', quit: true, atQ: 3, total: 15 },
  ];
  await h.f.store.put(learning(h, kid), p);
  await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison');
  const [header, card, log] = h.root.children;
  assert.ok(header.className.startsWith('home-header') && card.className === 'panel home' && log.className === 'logbox', 'the header above the card, the log below it');
  for (const words of ['Allison · SECTOR A', 'Addition (hundreds)']) assert.ok(header.textContent.includes(words), words);
  for (const words of ['⚡ 890', 'grid coins · spend in 🛒', '🏆 120', 'reward points', '🔗 Day 2 of 3 — 1 more day in a row for +⚡50 🏆100! · 🛡️×1',
    '⚙️ ENGINE · A', '25 q', '🧭 NAVIGATOR · A', '15 q', 'Next: papers 1–5 · 100% to unlock',
    '⬆ Jump to Sector B needs ⚙️ Engine to 100 + 5 crowns and 🧭 Navigator to 100 + 5 crowns']) assert.ok(card.textContent.includes(words), words);
  for (const words of ['Allison\'s log', 'Date & time', 'A · 1–5', '25/25', '12:34', 'PASS', 'A · 🧭 1–5', '✕ quit at Q4']) assert.ok(log.textContent.includes(words), words);
  for (const label of ['Switch user', '⚙️ Start Engine ▶', '🧭 Start Navigator ▶', '🛒 Shop', '🗺 Map', '📖 How to', '🎓 Guide', 'Parent sign-in']) assert.ok(h.nodes('BUTTON').some((b) => b.textContent === label), label);
  assert.equal(all(card).filter((n) => /\btier-node\b/.test(n.className || '')).length, 10, 'five check points on each track');
  assert.ok(!h.root.textContent.includes('Welcome,'), 'v3\'s old home is gone');
});

test('the Family Rocket on the home: each crew member\'s nickname and fuel, a crew member pours from the tank\'s buttons, and no id reaches the page', async (t) => {
  const h = await uiFixture(t); const allison = (await h.f.child(h.a.ctx, 'Allison')).child, geralt = (await h.f.child(h.a.ctx, 'Geralt')).child;
  await earn(h, allison, 300, 0);
  await h.f.game.rocket(h.a.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 500, minEach: 100, crewChildIds: [allison.id, geralt.id] });
  await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison');
  const text = () => h.root.textContent, pour = (label) => h.nodes('BUTTON').find((b) => b.textContent === label);
  for (const words of ['🚀 FAMILY ROCKET', '🍦 Ice cream', '⚡0 / 500', 'Allison ⚡0 / 100', 'Geralt ⚡0 / 100', '⛽ fuel it with grid coins:', 'everyone needs ⚡100 in for lift-off']) assert.ok(text().includes(words), words);
  assert.equal(pour('⚡250').disabled, false);
  await h.click('⚡100');
  assert.equal(h.requests.filter((r) => r.path === '/api/game/rocket/fuel' && r.method === 'POST').length, 1);
  for (const words of ['⚡100 / 500', 'Allison ⚡100 ✓', 'Geralt ⚡0 / 100', '⚡ 200']) assert.ok(text().includes(words), words);
  assert.ok(!text().includes('everyone needs'), 'her minimum is in');
  assert.equal(pour('⚡250').disabled, true, 'a pour the balance cannot cover is greyed out (the server would refuse it anyway)');
  assert.equal(all(h.root).find((n) => n.className === 'rocket-track').style.props['--w'], '20%', 'the tank\'s width is a custom property');
  for (const id of [allison.id, geralt.id]) assert.ok(!text().includes(id));
});
