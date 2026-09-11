// Back never leaves v3 (owner, 11 Sep 2026: Back on the kids' page opened the old v2 site, which the tab had shown before
// v3 was loaded in it). The page keeps its own history entry, stands a guard on top, and takes each Back itself. The
// harness's history stub counts a Back pressed on the first entry as leaving the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { uiFixture } from './ui-support.mjs';

const marks = (h) => h.history.entries.map((e) => e.state?.automathtics ?? null);

test('once loaded the page keeps its own history entry and stands a guard entry on top of it', async (t) => {
  const h = await uiFixture(t);
  assert.deepEqual(marks(h), ['app', 'guard']); assert.equal(h.history.index, 1);
});

test('Back from a parent sub-screen returns to the workspace, the workspace stays put however often Back is pressed, and the page is never left', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  const workspace = () => h.root.textContent.includes('Change my mobile number');
  for (const [open, shows] of [['Game & progress', 'PARENT · GAME & PROGRESS'], [`Reset ${kid.nickname}’s PIN`, 'PARENT ACTION'], [`Change ${kid.nickname}’s starting point`, 'LAUNCH POINT'], ['Delete this family', 'DELETE FAMILY']]) {
    await h.click(open); assert.ok(h.root.textContent.includes(shows), shows);
    await h.back(); assert.ok(workspace(), `Back from ${shows}: ${h.root.textContent.slice(0, 120)}`);
  }
  for (let i = 0; i < 5; i++) { await h.back(); assert.ok(workspace(), `press ${i + 1} on the workspace`); }
  assert.equal(h.history.left, 0, 'Back never reached whatever the tab showed before');
  assert.deepEqual(marks(h), ['app', 'guard']); assert.equal(h.history.index, 1, 'the guard is back up after every press');
});

test('Back from the parent verification of a sensitive action, or from the change-mobile screen after it, cancels the action as its Cancel button would', async (t) => {
  const h = await uiFixture(t); h.setAuth();
  await h.click('Change my mobile number'); assert.ok(h.root.textContent.includes('PARENT VERIFICATION'));
  await h.back(); assert.ok(h.root.textContent.includes('Change my mobile number') && !h.root.textContent.includes('PARENT VERIFICATION')); assert.ok(h.message.textContent.includes('Verification cancelled'), h.message.textContent);
  await h.click('Change my mobile number'); await h.submitLogin(); assert.ok(h.root.textContent.includes('CHANGE MOBILE'));
  await h.back(); assert.ok(h.root.textContent.includes('Change my mobile number') && !h.root.textContent.includes('CHANGE MOBILE'));
  assert.equal(h.history.left, 0);
});

test('Back on the kids\' side: from the PIN pad to the launch pad, from the shop, the map and a game to the child\'s home with the session kept, and the home screen stays put', async (t) => {
  const h = await uiFixture(t); await h.f.child(h.a.ctx); await h.api.refresh();
  await h.click('Hand over to kids'); const launchPad = () => h.root.textContent.includes('Who is on a mission');
  await h.back(); assert.ok(launchPad(), 'the launch pad is a top-level screen: Back stays put');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick(); assert.ok(h.root.textContent.includes('Enter my grid'));
  await h.back(); assert.ok(launchPad(), 'the PIN pad goes back to the launch pad');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  const home = () => h.root.textContent.includes('Welcome,'); assert.ok(home());
  await h.click('🛒 Shop & rewards'); assert.ok(h.root.textContent.includes('GRID SHOP')); await h.back(); assert.ok(home(), 'from the shop');
  await h.click('🗺 Map & fluency'); assert.ok(h.root.textContent.includes('MISSION MAP')); await h.back(); assert.ok(home(), 'from the map');
  await h.click('Start ENGINE'); assert.ok(h.root.textContent.includes('Question 1 of 25')); assert.equal(h.intervals(), 1, 'the question clock runs');
  await h.back(); assert.ok(home(), 'from a game'); assert.ok(h.root.textContent.includes('Continue'), 'the session is kept, not quit'); assert.equal(h.intervals(), 0, 'and its clock stopped');
  for (let i = 0; i < 5; i++) { await h.back(); assert.ok(home(), `press ${i + 1} on the home screen`); }
  assert.equal(h.history.left, 0); assert.deepEqual(marks(h), ['app', 'guard']); assert.equal(h.history.index, 1);
});

test('Forward onto the guard and entries the page did not make are left alone, and the app\'s own navigations are untouched', async (t) => {
  const h = await uiFixture(t); await h.f.child(h.a.ctx); await h.api.refresh(); await h.click('Game & progress');
  await h.popstate({ automathtics: 'guard' }); assert.ok(h.root.textContent.includes('PARENT · GAME & PROGRESS'), 'Forward is not Back');
  await h.popstate(null); assert.ok(h.root.textContent.includes('PARENT · GAME & PROGRESS'), 'an entry this page did not make');
  assert.equal(h.history.entries.length, 2, 'and no guard was stacked for either');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('if (r.url) { location.href = r.url; return; }'), 'the hosted checkout is still an ordinary navigation');
  assert.ok(app.indexOf("history.replaceState(null, '', location.pathname)") < app.indexOf('\nguardBack();'), 'the checkout query string goes first, so the marked entry keeps the clean address');
  assert.match(app, /history\.replaceState\(\{ automathtics: 'app' \}, ''\)/, 'marking the entry passes no URL: the address stays as it is');
});
