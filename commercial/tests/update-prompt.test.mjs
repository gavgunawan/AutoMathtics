// Update now (the owner's request of 12 Sep 2026): /api/bootstrap names the running release (RELEASE_SHA, else the version); the
// app remembers the first it saw and, when a later bootstrap or the five-minute check names another, shows a bar whose Update now
// reloads the page. Never a reload by itself; parents see it on any screen, kid mode only outside a running question session,
// and a release seen during play shows once play ends. The check is an interval the tests tick like any other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fixture, secret } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { createApp } from '../server/http.mjs';
import { VERSION } from '../server/version.mjs';

const BAR = 'A new version of AutoMathtics is ready.', NEXT = 'b'.repeat(40);
const reloader = () => { const page = { search: '', hash: '', pathname: '/', reloads: 0 }; page.reload = () => { page.reloads++; }; return page; };

test('/api/bootstrap names the running release: the deployed commit when there is one, else the version', async (t) => {
  for (const [releaseSha, expected] of [['ab'.repeat(20), 'ab'.repeat(20)], [undefined, VERSION]]) {
    const f = fixture(), server = createApp(f.service, { origin: 'https://pilot.example.test', secret, emulator: false, ...(releaseSha ? { releaseSha } : {}), web: { authDomain: 'demo-am-foundation.firebaseapp.com' } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/bootstrap`)).json();
    assert.equal(body.release, expected); assert.equal(typeof body.csrf, 'string');
  }
});

test('UI: once the release changes, a parent\'s page shows the bar after the next five-minute check or bootstrap, on any screen; Update now reloads; nothing reloads by itself', async (t) => {
  const page = reloader(), h = await uiFixture(t, { location: page });
  await h.tick(); assert.ok(!h.root.textContent.includes(BAR), 'the same release: no bar');
  h.setRelease(NEXT); assert.ok(!h.root.textContent.includes(BAR), 'nothing until the page asks');
  await h.tick(); assert.ok(h.root.textContent.includes(BAR), 'the five-minute check'); assert.equal(page.reloads, 0, 'never a reload by itself');
  h.api.addChildScreen(); assert.ok(h.root.textContent.includes('NEW CHILD PROFILE') && h.root.textContent.includes(BAR), 'and on every screen after it, a parent sub-screen too');
  await h.click('Update now'); assert.equal(page.reloads, 1, 'the button reloads');
  assert.equal(h.intervals(), 0, 'the check is not one of the clocks the tests count');
  // a bootstrap does it as well: a tab back in view refreshes, and every refresh bootstraps
  const v = await uiFixture(t, { location: reloader() }); v.setRelease(NEXT); v.visibility(); await v.idle();
  assert.ok(v.root.textContent.includes(BAR), 'after the refresh on visibilitychange');
  // signed out, on the sign-in screen
  const s = await uiFixture(t, { signedIn: false, location: reloader() }); s.setRelease(NEXT); await s.tick();
  assert.ok(s.root.textContent.includes('Sign in as parent') && s.root.textContent.includes(BAR), 'signed out too');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('const RELEASE_CHECK_MS = 5 * 60_000') && app.includes('setInterval(function releaseTick()'), 'every five minutes, as an interval the tests tick');
});

test('UI: in kid mode the bar waits for the end of a question session: never during play, then on the child\'s home and after', async (t) => {
  const h = await uiFixture(t, { location: reloader() }); await h.f.child(h.a.ctx); await h.api.refresh();
  await h.click('Hand over to kids'); await h.nodes('BUTTON').find((b) => b.className === 'player-card').onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  await h.click('⚙️ Start Engine ▶'); assert.ok(h.root.textContent.includes('Paper 1 · 1/25'));
  h.setRelease(NEXT); await h.tick(); assert.ok(!h.root.textContent.includes(BAR), 'not during play');
  assert.equal(h.intervals(), 1, 'the question clock is the one clock counted');
  h.visibility(); await h.idle(); assert.ok(h.root.textContent.includes('Paper 1 · 1/25') && !h.root.textContent.includes(BAR), 'back in view mid-game: still the question, still no bar');
  await h.click('✕ Quit'); assert.ok(h.root.textContent.includes('grid coins · spend in 🛒') && h.root.textContent.includes(BAR), 'once play ends');
  await h.click('🛒 Shop'); assert.ok(h.root.textContent.includes('GRID SHOP') && h.root.textContent.includes(BAR), 'and on the screens after it');
});
