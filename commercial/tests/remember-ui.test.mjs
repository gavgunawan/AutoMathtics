// "Remember this device" on the page (owner, 11 Sep 2026: parents should not have to sign in every time they open the app
// from a bookmark or a shortcut). The box sits on the sign-in's own SMS step; its answer rides with the session request,
// the server keeps the device's session for 30 days (tests/remember-device.test.mjs), Mission Control says until when,
// and the box comes back as the parent left it. The check of a parent action and the verify-mobile step never ask.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';

const DAY = 86_400_000;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
function storage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
}
const box = (h) => h.nodes('INPUT').find((i) => i.type === 'checkbox');
async function signingIn(t, options = {}) {
  const h = await uiFixture(t, { signedIn: false, ...options });
  await h.f.family('parentA', 2);
  h.setAuth('parentA', { signIn: async () => ({ stage: 'challenge', phone: '+*******7890', email: 'synthetic@example.test' }), sendCode: async () => {}, nextSendAt: async () => 0,
    confirmCode: async () => ({ stage: 'ready', idToken: h.f.token('parentA') }) });
  return h;
}

test('ticked on the sign-in SMS step: the device stays signed in for 30 days, Mission Control says until when, and the box comes back as it was left', async (t) => {
  const store = storage(), h = await signingIn(t, { storage: store });
  await h.submitLogin(); await settle();
  assert.ok(h.root.textContent.includes('Your second security check'));
  assert.ok(h.root.textContent.includes('Remember this device for 30 days'));
  assert.ok(h.root.textContent.includes('Hand over to kids'), 'the hint says what still locks');
  assert.equal(box(h).checked, false, 'unticked the first time');
  box(h).checked = true;
  await h.click('Verify code'); await h.idle();
  assert.equal(h.api.getModel().role, 'parent');
  assert.equal(h.api.getModel().rememberedUntil, h.f.now() + 30 * DAY);
  assert.ok(h.root.textContent.includes('This device stays signed in until'), 'Mission Control says so');
  assert.equal(store.map.get('automathtics.remember'), '1');

  await h.click('Sign out'); await h.idle();
  h.f.advance(1000); // a sign-in after a sign-out needs a token newer than the sign-out
  await h.submitLogin(); await settle();
  assert.equal(box(h).checked, true, 'the box comes back ticked');
  box(h).checked = false;
  await h.click('Verify code'); await h.idle();
  assert.equal(h.api.getModel().rememberedUntil, null, 'unticked: the usual 30 minutes');
  assert.ok(!h.root.textContent.includes('This device stays signed in until'));
  assert.equal(store.map.has('automathtics.remember'), false);
});

test('the fresh check of a parent action does not ask again and keeps the device remembered; the verify-mobile step never asks', async (t) => {
  const h = await signingIn(t, { storage: storage() });
  await h.submitLogin(); await settle(); box(h).checked = true;
  await h.click('Verify code'); await h.idle();
  const first = h.api.getModel().rememberedUntil;
  assert.ok(first > h.f.now());
  await h.draft(); // a child profile after five idle minutes: PARENT VERIFICATION
  await h.submitLogin(); await settle();
  assert.ok(h.root.textContent.includes('Your second security check'));
  assert.ok(!h.root.textContent.includes('Remember this device'), 'not asked again on a parent action');
  await h.click('Verify code'); await h.idle();
  assert.equal(h.api.getModel().rememberedUntil, h.f.now() + 30 * DAY, 'still remembered, 30 days from this fresh sign-in');
  assert.ok(h.api.getModel().rememberedUntil > first);

  const g = await uiFixture(t, { signedIn: false, storage: storage() });
  g.setAuth('parentA', { signIn: async () => ({ stage: 'enroll' }), sendCode: async () => {}, nextSendAt: async () => 0 });
  await g.submitLogin(); await settle();
  assert.ok(g.root.textContent.includes('Protect the command deck.'));
  assert.ok(!g.root.textContent.includes('Remember this device'), 'enrolment ends in a fresh sign-in, which asks');
});

test('a browser that blocks site data still signs in: the box starts unticked and a tick still counts', async (t) => {
  const h = await signingIn(t); // no localStorage at all
  await h.submitLogin(); await settle();
  assert.ok(!box(h).checked);
  box(h).checked = true;
  await h.click('Verify code'); await h.idle();
  assert.equal(h.api.getModel().rememberedUntil, h.f.now() + 30 * DAY);
});
