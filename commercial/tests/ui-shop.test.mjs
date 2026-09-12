// The shop in the v2 look (port plan section 2, row 6; test 5): v2's fifteen sections of cards with their tags, EQUIP and
// ✓ EQUIPPED as one toggle for every owned item — the earned and hatched pets too, which v3 showed as text only — the Surprise
// Box's reveal, the Reward Store and the purchase log. The server sells, rolls, equips and holds the points; the page asks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture, nodes } from './ui-support.mjs';
import { bootstrap } from '../server/ledger.mjs';
import { normalizeProgress } from '../server/progress.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const learning = (h, kid) => `families/${h.a.familyId}/learning/${kid.id}`;
// what Allison and Geralt own and wear since the owner moved them from v2 (11 Sep 2026)
const ALLISON = { inventory: ['bg_space', 'bg_symbols', 'pet_legend', 'fit_crown', 'title_combo', 'pet_semilegend'],
  activePet: 'pet_semilegend', activeBg: 'bg_symbols', activeOutfit: 'fit_crown', activeTitle: 'title_combo' };
const GERALT = { inventory: ['bg_symbols', 'pet_legend', 'title_ninja', 'title_dragon', 'title_speed'],
  activePet: 'pet_legend', activeBg: 'bg_symbols', activeTitle: 'title_speed' };
const SECTIONS = ['🎁 SURPRISES', '🐉 CYBER PETS', '👒 PET OUTFITS', '⭕ AVATAR RINGS', '🌆 BACKGROUNDS', '🎆 SPLASH FX', '🎵 SOUND PACKS', '🔥 COMBO SHOUTS',
  '⏱️ TIMER BARS', '🏷️ TITLES', '✨ NAME FX', '🗺️ MAP THEMES', '🚀 GARAGE', '🛰️ BASE UPGRADE', '🛡️ UTILITY'];
// a wallet whose balances the ledger has opened on, so the shop can take from them (the primitive refuses unopened money)
async function seed(h, kid, wallet, extra = {}) {
  const path = learning(h, kid); await h.f.store.put(path, normalizeProgress({ ...extra, wallet: { ...wallet, ledgerSeq: 0, ledgerLast: null } }));
  await h.f.store.transaction(async (tx) => { const r = await bootstrap(tx, path, await tx.get(path), h.f.now()); if (r.opened) tx.set(path, r.prog); });
}
async function enter(h, name) {
  await h.nodes('BUTTON').find((n) => n.className === 'player-card' && n.textContent.includes(name)).onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
}
const cardOf = (h, name) => all(h.root).find((n) => /^shopitem\b/.test(n.className || '') && n.textContent.includes(name));
const act = (h, name) => { const c = cardOf(h, name); assert.ok(c, `card missing: ${name}`); return nodes(c, 'BUTTON')[0]; };
const part = (h, className) => all(h.root).find((n) => n.className === className);
const equips = (h) => h.requests.filter((r) => r.path === '/api/game/shop/equip');

test('test 5: Allison and Geralt in the shop — what each wears is ✓ EQUIPPED, what each owns has EQUIP, an egg\'s pets stay secret, and ✓ EQUIPPED takes an item off with itemId null', async (t) => {
  const h = await uiFixture(t, { recordBodies: ['/api/game/shop/equip'] });
  const allison = (await h.f.child(h.a.ctx, 'Allison')).child, geralt = (await h.f.child(h.a.ctx, 'Geralt')).child;
  await seed(h, allison, { ...ALLISON, gc: 1234, rp: 567 }); await seed(h, geralt, { ...GERALT, gc: 890, rp: 120 });
  await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison');
  await h.click('🛒 Shop');
  const text = () => h.root.textContent;
  for (const words of ['🛒 GRID SHOP · ALLISON', '⚡ 1234', '🏆 567']) assert.ok(text().includes(words), words);
  const at = SECTIONS.map((s) => text().indexOf(s)); assert.ok(at.every((n, i) => n > -1 && (i === 0 || n > at[i - 1])), `v2's fifteen sections in v2's order: ${at}`);
  const hawk = cardOf(h, 'Thunder Hawk'), dragon = cardOf(h, 'Storm Dragon');
  assert.equal(act(h, 'Thunder Hawk').textContent, '✓ EQUIPPED'); assert.ok(all(hawk).some((n) => n.className === 'tag semi' && n.textContent === 'SEMI-LEGENDARY'));
  assert.equal(act(h, 'Storm Dragon').textContent, 'EQUIP', 'an earned pet she is not wearing can be put on again');
  assert.ok(all(dragon).some((n) => n.className === 'tag' && n.textContent === 'LEGENDARY') && all(dragon).some((n) => n.className === 'item-emoji legend-glow'), 'the dragon in gold');
  for (const [name, label] of [['Falling symbols bg', '✓ EQUIPPED'], ['Deep space bg', 'EQUIP'], ['Tiny crown', '✓ EQUIPPED'], ['COMBO MASTER', '✓ EQUIPPED'],
    ['Neon city bg', '⚡350 BUY'], ['Volt dragon', '⚡1200 BUY'], ['Prestige frame', '⚡4000 BUY']]) assert.equal(act(h, name).textContent, label, name);
  assert.ok(cardOf(h, 'Prestige frame').textContent.includes('SUPER RARE') && cardOf(h, 'Prestige frame').className.includes('super'));
  for (const secret of ['Neon fox', 'Glitch octopus', 'Chrome unicorn', 'Turbo turtle']) assert.ok(!text().includes(secret), `${secret} stays a secret until an egg hatches it`);

  await act(h, 'Storm Dragon').onclick(); // on…
  assert.deepEqual(equips(h).at(-1).body, { kind: 'pet', itemId: 'pet_legend' });
  assert.equal(act(h, 'Storm Dragon').textContent, '✓ EQUIPPED'); assert.equal(act(h, 'Thunder Hawk').textContent, 'EQUIP');
  assert.ok(h.message.textContent.includes('✓ 🐲 Storm Dragon equipped'), h.message.textContent);
  await act(h, 'Storm Dragon').onclick(); // …and off again
  assert.deepEqual(equips(h).at(-1).body, { kind: 'pet', itemId: null });
  assert.equal((await h.f.store.get(learning(h, allison))).wallet.activePet, null, 'the server took the dragon off');
  assert.equal(act(h, 'Storm Dragon').textContent, 'EQUIP'); assert.ok(h.message.textContent.includes('🐲 Storm Dragon unequipped'));

  await h.click('Back'); await h.click('Switch user'); await enter(h, 'Geralt'); await h.click('🛒 Shop');
  assert.equal(act(h, 'Storm Dragon').textContent, '✓ EQUIPPED');
  const locked = cardOf(h, 'Thunder Hawk');
  assert.ok(locked.className.includes('locked') && locked.textContent.includes('🔒 practise 10 days in a row') && locked.textContent.includes('0/10'), locked.textContent);
  assert.equal(nodes(locked, 'BUTTON').length, 0, 'not his yet: nothing to press'); assert.ok(all(locked).some((n) => n.className === 'item-emoji item-locked'), 'greyed until earned');
  for (const [name, label] of [['SPEED DEMON', '✓ EQUIPPED'], ['MATH NINJA', 'EQUIP'], ['DRAGON TAMER', 'EQUIP'], ['Falling symbols bg', '✓ EQUIPPED']]) assert.equal(act(h, name).textContent, label, name);
  await act(h, 'SPEED DEMON').onclick();
  assert.deepEqual(equips(h).at(-1).body, { kind: 'title', itemId: null }); assert.equal((await h.f.store.get(learning(h, geralt))).wallet.activeTitle, null);
});

test('buying: a pet is bought and worn, the Surprise Box opens on what the server rolled, and a price out of reach dims the card as v2 dims it — all but the Box and the Egg', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx, 'Allison')).child;
  await seed(h, kid, { gc: 1500, rp: 0 });
  await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison'); await h.click('🛒 Shop');
  await act(h, 'Volt dragon').onclick();
  assert.ok(h.message.textContent.includes('✓ 🐉 Volt dragon — bought & equipped!'), h.message.textContent);
  assert.equal(act(h, 'Volt dragon').textContent, '✓ EQUIPPED'); assert.ok(h.root.textContent.includes('⚡ 300'));
  assert.ok(part(h, 'shop-log').textContent.includes('Volt dragon') && part(h, 'shop-log').textContent.includes('−⚡1200'));
  assert.ok(act(h, 'Surprise Box').textContent.startsWith('⚡300 OPEN · '), act(h, 'Surprise Box').textContent);
  await act(h, 'Surprise Box').onclick(); // the fixture's server rolls the first of its weighted pool: the Top hat
  const reveal = part(h, 'crate-reveal');
  assert.ok(reveal && reveal.textContent.includes('🎩') && reveal.textContent.includes('Top hat!') && reveal.attrs.role === 'status');
  assert.ok(h.message.textContent.includes('🎁 Surprise Box → 🎩 Top hat!'), h.message.textContent);
  assert.equal(act(h, 'Top hat').textContent, '✓ EQUIPPED', 'what the box gave is worn at once');
  assert.ok(part(h, 'shop-log').textContent.includes('Surprise Box → 🎩 Top hat'));
  assert.ok(h.root.textContent.includes('⚡ 0'));
  for (const name of ['Streak shield', 'Neon cat', 'Command Deck']) assert.ok(cardOf(h, name).className.includes('dim'), `${name} out of reach is dimmed`);
  for (const name of ['Surprise Box', 'Mystery Egg']) assert.ok(!cardOf(h, name).className.includes('dim'), `${name} is never dimmed (v2 3248)`);
  await act(h, 'Mystery Egg').onclick(); // the server refuses; the page says what is missing
  assert.ok(h.message.textContent.includes('Need ⚡900 more for Mystery Egg'), h.message.textContent);
});

test('an egg\'s pets: a warming egg counts its passes, and a hatched pet is in the shop to wear and take off', async (t) => {
  const h = await uiFixture(t, { recordBodies: ['/api/game/shop/equip'] }); const kid = (await h.f.child(h.a.ctx, 'Allison')).child;
  await seed(h, kid, { inventory: ['pet_fox'], egg: { passesAt: 1, hatched: false } }, { stats: { sessions: 3, passes: 3 } });
  await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison'); await h.click('🛒 Shop');
  assert.ok(cardOf(h, 'Mystery Egg').textContent.includes('🥚 keeping warm · 2/5 passes'), cardOf(h, 'Mystery Egg').textContent);
  for (const secret of ['Glitch octopus', 'Chrome unicorn', 'Turbo turtle']) assert.ok(!h.root.textContent.includes(secret), secret);
  assert.equal(act(h, 'Neon fox').textContent, 'EQUIP');
  await act(h, 'Neon fox').onclick(); assert.deepEqual(equips(h).at(-1).body, { kind: 'pet', itemId: 'pet_fox' });
  assert.equal(act(h, 'Neon fox').textContent, '✓ EQUIPPED');
  await act(h, 'Neon fox').onclick(); assert.deepEqual(equips(h).at(-1).body, { kind: 'pet', itemId: null });
});

test('the Reward Store: REDEEM when the points are there, how many more when not, a hidden prize kept back, done today at the cap, the request waiting for the parent, and the log', async (t) => {
  let h = null; h = await uiFixture(t, { clock: () => (h ? h.f.now() : Date.parse('2026-09-06T10:00:00Z')) }); // the page's date is the fixture's
  const kid = (await h.f.child(h.a.ctx, 'Allison')).child; await seed(h, kid, { gc: 0, rp: 300 });
  await h.f.game.setRewards(h.a.ctx, { rewards: [
    { id: 'rw-movie', emoji: '🎬', name: 'Movie night', cost: 200, hidden: false, cap: 1, childIds: [] },
    { id: 'rw-lego', emoji: '🧱', name: 'Lego set', cost: 5000, hidden: false, cap: 0, childIds: [] },
    { id: 'rw-park', emoji: '🎢', name: 'Theme park', cost: 9000, hidden: true, cap: 0, childIds: [] }] });
  await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison'); await h.click('🛒 Shop');
  const store = () => part(h, 'shop-rewards').textContent;
  assert.ok(store().includes('🎁 Reward Store · spend 🏆') && store().includes('Movie night') && store().includes('🏆5000 · 4700 more'), store());
  assert.ok(!h.root.textContent.includes('Theme park'), 'a hidden prize waits until it is affordable');
  assert.ok(part(h, 'shop-log').textContent.includes('nothing bought yet'));
  await h.click('🏆200 REDEEM');
  assert.ok(h.message.textContent.includes('✓ 🎬 Movie night — sent to your parent to approve.'), h.message.textContent);
  assert.ok(store().includes('done today'), 'the daily cap of one is reached'); assert.ok(store().includes('⏳ Pending approval: 🎬 Movie night'));
  const log = part(h, 'shop-log').textContent;
  for (const words of ['Movie night', '⏳ pending', '−🏆200', '2026-09-06']) assert.ok(log.includes(words), words);
  assert.ok(h.root.textContent.includes('🏆 100'));
});
