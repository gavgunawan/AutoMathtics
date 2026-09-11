// The cosmetics layer (port plan section 3, test 4): what Allison and Geralt wear after the cutover, drawn the way v2 drew it.
// The wallets below are their migrated looks (convertV2 keeps an equipped slot when the item is owned and of its kind).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { uiFixture } from './ui-support.mjs';
import { LEGEND } from '../server/game.mjs';

const ALLISON = { gc: 1234, rp: 567, inventory: ['bg_space', 'bg_symbols', 'pet_legend', 'fit_crown', 'title_combo'],
  activeBg: 'bg_symbols', activePet: 'pet_legend', activeOutfit: 'fit_crown', activeTitle: 'title_combo' };
const GERALT = { gc: 890, rp: 120, inventory: ['bg_symbols', 'pet_legend', 'title_ninja', 'title_dragon'],
  activeBg: 'bg_symbols', activePet: 'pet_legend', activeTitle: 'title_dragon' };

// every element under a node (the harness DOM keeps text as strings among the children)
const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
async function family(t) {
  const h = await uiFixture(t);
  const allison = (await h.f.child(h.a.ctx, 'Allison')).child, geralt = (await h.f.child(h.a.ctx, 'Geralt')).child;
  await h.f.store.put(`families/${h.a.familyId}/learning/${allison.id}`, { wallet: ALLISON });
  await h.f.store.put(`families/${h.a.familyId}/learning/${geralt.id}`, { wallet: GERALT });
  await h.api.refresh(); await h.click('Hand over to kids');
  return h;
}
const card = (h, name) => h.nodes('BUTTON').find((n) => n.className === 'player-card' && n.textContent.includes(name));
async function enter(h, name) { await card(h, name).onclick(); h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid'); }

test('Allison and Geralt wear their looks: the launch pad\'s cards, then the falling symbols, the legendary dragon in its crown and the title on every screen of theirs', async (t) => {
  const h = await family(t);
  assert.ok(card(h, 'Allison').textContent.includes('COMBO MASTER · 🐲👑'), card(h, 'Allison').textContent);
  assert.ok(card(h, 'Geralt').textContent.includes('DRAGON TAMER · 🐲') && !card(h, 'Geralt').textContent.includes('👑'));
  assert.equal(h.html.attrs['data-bg'], undefined, 'the launch pad wears no one\'s background');

  await enter(h, 'Allison');
  assert.equal(h.html.attrs['data-mode'], 'kid'); assert.equal(h.html.attrs['data-bg'], 'bg_symbols');
  assert.equal(h.decor.children.length, 16); assert.ok(h.decor.children.every((c) => c.className === 'mrain'));
  const column = h.decor.children[0];
  assert.equal(column.textContent.split('\n').length, 16, 'a column of sixteen glyphs');
  for (const k of ['--l', '--fs', '--col', '--op', '--dur', '--delay']) assert.ok(k in column.style.props, `${k} is set through setVar`);
  const pet = all(h.root).find((n) => /\bpetwrap\b/.test(n.className || ''));
  assert.ok(pet && pet.className.includes('petlegend'), 'the Storm Dragon glows gold'); assert.ok(pet.textContent.includes('🐲👑'), 'wearing the tiny crown');
  assert.ok(h.root.textContent.includes('COMBO MASTER') && h.root.textContent.includes('👑'));
  assert.ok(all(h.root).some((n) => n.className === 'titlechip' && n.textContent === 'COMBO MASTER'), 'the title is its name alone, in the chip');

  // the decor is built once per background, not per screen
  await h.click('🛒 Shop & rewards'); assert.equal(h.html.attrs['data-bg'], 'bg_symbols', 'the shop wears it too');
  assert.equal(h.decor.children[0], column, 'the same columns, still falling');
  await h.back(); assert.equal(h.decor.children[0], column);

  await h.click('Switch child');
  assert.equal(h.html.attrs['data-mode'], 'select'); assert.equal(h.html.attrs['data-bg'], undefined); assert.equal(h.decor.children.length, 0);

  await enter(h, 'Geralt');
  assert.equal(h.html.attrs['data-bg'], 'bg_symbols'); assert.equal(h.decor.children.length, 16);
  assert.ok(h.root.textContent.includes('DRAGON TAMER')); assert.ok(!h.root.textContent.includes('👑'), 'no outfit, no crown');
  assert.ok(all(h.root).find((n) => /\bpetwrap\b/.test(n.className || '')).className.includes('petlegend'));
});

test('a background the cosmetics layer does not know is worn as none, and the legendary tags in the page match the server\'s', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx, 'Allison')).child;
  await h.f.store.put(`families/${h.a.familyId}/learning/${kid.id}`, { wallet: { activeBg: 'constructor', activePet: 'fit_crown', activeTitle: 'pet_legend' } });
  await h.api.refresh(); await h.click('Hand over to kids'); await enter(h, 'Allison');
  assert.equal(h.html.attrs['data-bg'], undefined); assert.equal(h.decor.children.length, 0);
  assert.ok(!all(h.root).some((n) => /\b(petwrap|titlechip)\b/.test(n.className || '')), 'a slot holding another kind of item is worn as nothing');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const client = vm.runInNewContext(`(${/const LEGEND = (\{[^}]*\});/.exec(app)[1]})`);
  assert.deepEqual({ ...client }, { ...LEGEND }); // spread: the object read out of app.js was made in another realm
});
