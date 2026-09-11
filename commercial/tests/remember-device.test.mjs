// Remember this device (owner's request, 11 Sep 2026): a parent who ticks it on the sign-in's SMS step keeps the session
// on that device for 30 days from that sign-in, in whichever mode the device is left, so a bookmark or a home-screen
// shortcut opens straight back into it. Nothing else relaxes: authorize() and the identity recheck run at every use,
// sensitive actions still need a sign-in within five minutes, handing over to the kids still locks parent access, and a
// password change signs the device out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/http.mjs';
import { grantEntitlement } from '../server/service.mjs';
import { fixture, secret, rejected } from './support.mjs';

const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const row = async (f, cookie) => f.store.get(`sessions/${(await f.service.authenticate(cookie)).key}`);

test('ticked: the parent session lasts 30 days from the sign-in; unticked or not asked: 30 minutes, as before', async () => {
  const f = fixture(), t0 = f.now();
  const kept = await f.service.login(f.token('parentA'), null, { remember: true });
  assert.equal((await row(f, kept)).expiresAt, t0 + 30 * DAY);
  assert.equal((await f.service.me(await f.service.authenticate(kept))).rememberedUntil, t0 + 30 * DAY, 'Mission Control can say until when');
  const plain = await f.service.login(f.token('parentB'), null, { remember: false });
  assert.equal((await row(f, plain)).expiresAt, t0 + 30 * MINUTE);
  assert.equal((await f.service.me(await f.service.authenticate(plain))).rememberedUntil, null);
  const before = await f.login('parentC');
  assert.equal((await f.store.get(`sessions/${before.ctx.key}`)).expiresAt, t0 + 30 * MINUTE, 'no answer at all: the 30 minutes of before');
  f.advance(29 * DAY + 23 * 60 * MINUTE);
  assert.equal((await f.service.me(await f.service.authenticate(kept))).role, 'parent', 'a bookmark opened on day 29 goes straight in');
  f.advance(60 * MINUTE);
  await assert.rejects(f.service.authenticate(kept), rejected('SIGN_IN_REQUIRED'), 'day 30: sign in again');
});

test('a remembered device handed to the kids stays on the launch pad for the rest of its 30 days, never less than 12 hours, and parent access still needs a full sign-in', async () => {
  const f = fixture(), p = await f.family('parentA', 1);
  await grantEntitlement(f.store, { familyId: p.familyId, seatLimit: 1, accessUntil: f.now() + 90 * DAY, reason: 'remember test', actor: 'test-operator' }, f.now());
  const { child: kid } = await f.child(p.ctx);
  const signedAt = f.now();
  const parent = await f.service.login(f.token('parentA'), p.cookie, { remember: true });
  const pad = await f.service.lock(await f.service.authenticate(parent));
  assert.equal((await row(f, pad)).expiresAt, signedAt + 30 * DAY, 'the launch pad keeps the 30 days');
  f.advance(20 * DAY);
  const kidCookie = await f.service.selectChild(await f.service.authenticate(pad), kid.id, '763829');
  assert.equal((await row(f, kidCookie)).expiresAt, signedAt + 30 * DAY, 'a child entering never extends it (S1-001)');
  const back = await f.service.selector(await f.service.authenticate(kidCookie));
  assert.equal((await f.service.me(await f.service.authenticate(back))).role, 'selector');
  await assert.rejects(f.service.lock(await f.service.authenticate(back)), rejected('PARENT_REQUIRED'), 'the launch pad is not the parent');
  await assert.rejects(f.service.login(f.token('parentA', { auth_time: Math.floor(signedAt / 1000) }), back), (e) => ['REAUTHENTICATE'].includes(e.code), 'a token from before the handover does not reopen Mission Control');
  f.advance(10 * DAY);
  await assert.rejects(f.service.authenticate(back), rejected('SIGN_IN_REQUIRED'), 'day 30 ends the launch pad too');

  const g = fixture(), q = await g.family('parentA', 1), late = g.now();
  const lastDay = await g.service.login(g.token('parentA'), q.cookie, { remember: true });
  g.advance(29 * DAY + 20 * 60 * MINUTE);
  const shortPad = await g.service.lock(await g.service.authenticate(lastDay));
  assert.equal((await row(g, shortPad)).expiresAt, g.now() + 12 * 60 * MINUTE, 'handed over near the end: the usual 12 hours, not four');
  assert.ok(g.now() + 12 * 60 * MINUTE > late + 30 * DAY);
});

test('the fresh check of a parent action keeps the device remembered; an explicit untick forgets it; another account never inherits it', async () => {
  const f = fixture();
  const first = await f.service.login(f.token('parentA'), null, { remember: true });
  f.advance(10 * MINUTE);
  const recheck = await f.service.login(f.token('parentA'), first); // the parent-action check sends no answer
  assert.equal((await row(f, recheck)).expiresAt, f.now() + 30 * DAY, 'still remembered, 30 days from this fresh sign-in');
  const untick = await f.service.login(f.token('parentA'), recheck, { remember: false });
  assert.equal((await row(f, untick)).expiresAt, f.now() + 30 * MINUTE, 'unticked at a sign-in: forgotten');
  const kept = await f.service.login(f.token('parentA'), untick, { remember: true });
  const other = await f.service.login(f.token('parentB'), kept);
  assert.equal((await row(f, other)).expiresAt, f.now() + 30 * MINUTE, 'another parent signing in on this device does not inherit it');
  await assert.rejects(f.service.authenticate(kept), rejected('SIGN_IN_REQUIRED'), 'and the old cookie is gone');
});

test('nothing else relaxes: a sensitive action still needs a sign-in within five minutes, and a password change signs the remembered device out', async () => {
  const f = fixture(), p = await f.family('parentA', 1);
  const cookie = await f.service.login(f.token('parentA'), p.cookie, { remember: true });
  const ctx = await f.service.authenticate(cookie);
  const { child: kid } = await f.child(ctx);
  f.advance(6 * MINUTE);
  await assert.rejects(f.service.resetPin(ctx, kid.id, '482915'), rejected('REAUTHENTICATE'));
  f.resetPassword('parentA');
  f.advance(2 * MINUTE);
  await assert.rejects(f.service.authenticate(cookie), rejected('SESSION_REVOKED'));
});

async function serverTest(t) {
  const f = fixture();
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, proxyHops: 0, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await fetch(`${base}/api/bootstrap`);
  let cookie = bootstrap.headers.get('set-cookie').split(';')[0], csrf = (await bootstrap.json()).csrf;
  const call = async (path, data, more = {}) => {
    const r = await fetch(`${base}${path}`, { method: data === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, Origin: cfg.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...more },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const set = r.headers.get('set-cookie');
    if (set && r.ok) { cookie = set.split(';')[0]; csrf = (await (await fetch(`${base}/api/bootstrap`, { headers: { Cookie: cookie } })).json()).csrf; }
    return r;
  };
  return { f, call };
}

test('the cookie lives exactly as long as its session: 30 days when remembered, at sign-in, family creation and the handover; the answer must be true or false', async (t) => {
  const { f, call } = await serverTest(t);
  assert.equal((await call('/api/auth/session', { idToken: f.token('parentA'), remember: 'yes' })).status, 400, 'not a boolean');
  assert.equal((await call('/api/auth/session', { idToken: f.token('parentA'), stay: true })).status, 400, 'no other key');
  const login = await call('/api/auth/session', { idToken: f.token('parentA'), remember: true });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Max-Age=2592000(;|$)/);
  const created = await call('/api/family', { label: 'Fam', adultAttestation: true, consentVersion: 'pilot-v1' });
  assert.match(created.headers.get('set-cookie'), /Max-Age=2592000(;|$)/);
  const me = await (await call('/api/me')).json();
  assert.equal(me.rememberedUntil, f.now() + 30 * DAY);
  await grantEntitlement(f.store, { familyId: me.family.id, seatLimit: 1, accessUntil: f.now() + 90 * DAY, reason: 'cookie test', actor: 'test-operator' }, f.now());
  await call('/api/children', { nickname: 'Fox', icon: 'fox', pin: '763829' }, { 'Idempotency-Key': crypto.randomUUID() });
  f.advance(DAY);
  const lock = await call('/api/session/lock', {});
  assert.match(lock.headers.get('set-cookie'), /Max-Age=2505600(;|$)/, 'what is left of the 30 days: 29');
});
