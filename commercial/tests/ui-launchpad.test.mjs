// The launch pad in the v2 look (port plan section 2, rows 1-2): v2's player selection and v2's PIN keypad, over v3's six-digit
// PIN, which the server alone checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';

test('the launch pad is v2\'s player selection: a card per active child in its colour, and a way back to the parents\' sign-in', async (t) => {
  const h = await uiFixture(t); await h.f.child(h.a.ctx, 'Allison'); await h.f.child(h.a.ctx, 'Geralt'); await h.api.refresh();
  await h.click('Hand over to kids');
  assert.ok(h.root.textContent.includes('PLAYER SELECTION') && h.root.textContent.includes("who's on a mission today?"));
  const cards = h.nodes('BUTTON').filter((n) => n.className === 'player-card');
  assert.equal(cards.length, 2);
  const [allison, geralt] = cards;
  assert.ok(allison.textContent.includes('Allison') && allison.textContent.includes('MISSION READY') && allison.textContent.includes('ENTER GRID'));
  assert.ok(allison.children[0].className.includes('acc-0') && geralt.children[0].className.includes('acc-1'), 'each child in its place in the family\'s palette');
  assert.ok(h.nodes('BUTTON').some((n) => n.textContent === '🔐 Return to parent sign-in') && h.nodes('BUTTON').some((n) => n.textContent === 'Sign out'));
  assert.equal(h.html.attrs['data-bg'], undefined); assert.equal(h.decor.children.length, 0);
});

test('the kid\'s PIN: v2\'s keypad edits the real password field, the sixth digit sends it, a refusal shakes the box and is said in the message line', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx, 'Allison')).child; await h.api.refresh();
  await h.click('Hand over to kids'); await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick();
  assert.ok(h.root.textContent.includes('Allison · ENTER PIN') && h.root.textContent.includes('Enter my grid'));
  const pin = h.nodes('INPUT')[0]; assert.equal(pin.type, 'password'); assert.equal(pin.maxLength, 6);
  for (const k of ['7', '6', '3']) await h.click(k);
  await h.click('⌫'); assert.equal(pin.value, '76', 'the keypad types into the field, and ⌫ takes the last digit off');
  const sent = () => h.requests.filter((r) => r.path === `/api/children/${kid.id}/enter`).length;
  for (const k of ['0', '0', '0']) await h.click(k);
  assert.equal(sent(), 0, 'five digits send nothing');
  await h.click('0'); await h.idle();
  assert.equal(sent(), 1, 'the sixth digit sends the PIN');
  assert.ok(h.message.textContent.includes('did not match')); assert.ok(pin.className.includes('shake')); assert.equal(pin.value, '', 'a refused PIN is not kept');
  assert.equal(h.api.getModel().role, 'selector');
  for (const k of '763829') await h.click(k);
  await h.idle();
  assert.equal(sent(), 2); assert.equal(h.api.getModel().role, 'child'); assert.equal(h.html.attrs['data-mode'], 'kid');
});
