// Regression tests for the Stage 1b hardening round (independent review findings F1–F12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/http.mjs';
import { pinHasher, pepperId, mac } from '../server/security.mjs';
import { MemoryStore, fixture, secret, pepper, rejected } from './support.mjs';

async function serverTest(t, patch = {}) {
  const f = fixture();
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, proxyHops: 0, web: { authDomain: 'demo-am-foundation.firebaseapp.com' }, ...patch };
  const server = createApp(f.service, cfg);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // a fresh browser: its own pre-auth cookie and CSRF token, plus any fixed headers (e.g. a forwarded address)
  async function client(fixed = {}) {
    const bootstrap = await fetch(`${base}/api/bootstrap`, { headers: fixed });
    let cookie = bootstrap.headers.get('set-cookie').split(';')[0];
    let csrf = (await bootstrap.json()).csrf;
    const call = async (path, data, more = {}) => {
      const r = await fetch(`${base}${path}`, { method: data === undefined ? 'GET' : 'POST',
        headers: { Cookie: cookie, Origin: cfg.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...fixed, ...more },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      const set = r.headers.get('set-cookie');
      if (set && r.ok) { cookie = set.split(';')[0]; if (path !== '/api/bootstrap') csrf = (await (await fetch(`${base}/api/bootstrap`, { headers: { Cookie: cookie } })).json()).csrf; }
      return r;
    };
    return { call, cookie: () => cookie };
  }
  return { f, cfg, base, client };
}
const bucket = (name) => `rateLimits/${mac(secret, name)}`;
const garbage = { idToken: 'not-a-real-token-'.padEnd(40, 'x') };

// ---- F1: login throttling isolates clients and never spends honest sign-ins ----
test('F1: login failures are counted per forwarded client address, not per proxy', async (t) => {
  const s = await serverTest(t, { proxyHops: 1 });
  const attacker = await s.client({ 'X-Forwarded-For': '203.0.113.5' });
  let last;
  for (let i = 0; i < 30; i++) last = (await attacker.call('/api/auth/session', garbage)).status;
  assert.equal(last, 401);
  assert.equal((await attacker.call('/api/auth/session', garbage)).status, 429);
  assert.equal((await attacker.call('/api/auth/session', { idToken: s.f.token('victimBehindAttackerIp') })).status, 200); // a valid signed login is not collateral damage
  const honest = await s.client({ 'X-Forwarded-For': '198.51.100.7' });
  assert.equal((await honest.call('/api/auth/session', { idToken: s.f.token('honestParent') })).status, 200);
});
test('F1: a spoofed forwarded header is ignored when the deployment declares no trusted hops', async (t) => {
  const s = await serverTest(t, { proxyHops: 0 });
  for (let i = 0; i < 30; i++) await (await s.client({ 'X-Forwarded-For': `203.0.113.${i}` })).call('/api/auth/session', garbage);
  assert.equal((await (await s.client({ 'X-Forwarded-For': '198.51.100.7' })).call('/api/auth/session', garbage)).status, 429); // all one socket address
});
test('F1: successful sign-ins cost no address budget; accounts are limited separately', async (t) => {
  const s = await serverTest(t);
  const c = await s.client();
  for (let i = 0; i < 10; i++) assert.equal((await c.call('/api/auth/session', { idToken: s.f.token('parentA') })).status, 200);
  assert.equal(await s.f.store.get(bucket('login-fail:127.0.0.1')), null);
  const r = await c.call('/api/auth/session', { idToken: s.f.token('parentA') });
  assert.equal(r.status, 429); // eleventh sign-in of one account inside ten minutes
  assert.equal((await c.call('/api/auth/session', { idToken: s.f.token('parentB') })).status, 200);
  assert.equal(await s.f.store.get(bucket('login-fail:127.0.0.1')), null); // a 429 is not a failed credential
});

// ---- F2: authorize() itself enforces child revocation, status and entitlement ----
async function childSession(f, seats = 1) {
  const p = await f.family('parentA', seats);
  const { child } = await f.child(p.ctx);
  const selCtx = await f.service.authenticate(await f.service.lock(p.ctx));
  const childCtx = await f.service.authenticate(await f.service.selectChild(selCtx, child.id, '763829'));
  return { p, child, selCtx, childCtx };
}
const bare = (f, ctx, roles = ['child']) => f.store.transaction((tx) => f.service.authorize(tx, ctx, roles));
test('F2: a bare authorize() rejects a child whose PIN was reset', async () => {
  const f = fixture(); const { child, childCtx } = await childSession(f);
  assert.equal((await bare(f, childCtx)).s.role, 'child');
  f.advance(2000); const p2 = await f.login('parentA'); await f.service.resetPin(p2.ctx, child.id, '111111');
  await assert.rejects(bare(f, childCtx), rejected('CHILD_SESSION_REVOKED'));
  await assert.rejects(f.service.me(childCtx), rejected('CHILD_SESSION_REVOKED'));
  // the explicit downgrade path still lets the device return to the selector, and nothing more
  const selCtx = await f.service.authenticate(await f.service.selector(childCtx));
  assert.equal((await f.service.me(selCtx)).role, 'selector');
  await assert.rejects(f.service.selectChild(selCtx, child.id, '763829'), rejected('INCORRECT_PIN'));
});
test('F2: a bare authorize() rejects a child whose family entitlement lapsed or seat was withdrawn', async () => {
  const f = fixture(); const { childCtx } = await childSession(f);
  f.advance(16 * 60_000); // past the fixture's 15-minute entitlement, inside the 12-hour child session
  await assert.rejects(bare(f, childCtx), rejected('SUBSCRIPTION_INACTIVE'));
  const g = fixture(); const { p, childCtx: c2 } = await childSession(g);
  const { grantEntitlement } = await import('../server/service.mjs');
  await grantEntitlement(g.store, { familyId: p.familyId, seatLimit: 1, accessUntil: g.now() + 60_000, keepChildIds: [], reason: 'seat withdrawn', actor: 'test-operator' }, g.now());
  await assert.rejects(bare(g, c2), rejected('CHILD_INACTIVE'));
});

// ---- F3: identity rechecks are cached briefly and sessions are throttled ----
test('F3: the identity recheck reuses one lookup per minute and still honours revocation', async () => {
  const f = fixture(); const a = await f.family();
  const before = f.identity.lookups;
  for (let i = 0; i < 20; i++) await f.service.authenticate(a.cookie);
  assert.equal(f.identity.lookups, before);
  f.users.get('parentA').tokensValidAfterTime = new Date(f.now() + 1000).toUTCString(); // revoked upstream
  await f.service.authenticate(a.cookie); // still inside the cache window
  f.advance(61_000);
  await assert.rejects(f.service.authenticate(a.cookie), rejected('SESSION_REVOKED'));
  assert.equal(f.identity.lookups, before + 1);
});
test('F3: a login always looks the account up afresh', async () => {
  const f = fixture(); await f.login('parentA'); const n = f.identity.lookups;
  await f.login('parentA'); assert.equal(f.identity.lookups, n + 1);
});
test('S1B-A: account throttle runs after local token proof but before an 11th Auth user lookup', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) await f.service.login(f.token('parentA'));
  const lookups = f.auth.getUserCalls;
  await assert.rejects(f.service.login(f.token('parentA')), rejected('TOO_MANY_ATTEMPTS'));
  assert.equal(f.auth.getUserCalls, lookups, 'rate-limited login must not call accounts:lookup');
  assert.ok(f.auth.verifyCalls.every((v) => v === false), 'login token verification must not request a second revocation lookup');
});
test('F3: one session cannot make more than 120 authenticated requests a minute', async (t) => {
  const s = await serverTest(t); const c = await s.client();
  assert.equal((await c.call('/api/auth/session', { idToken: s.f.token('parentA') })).status, 200);
  let status;
  for (let i = 0; i < 121; i++) status = (await c.call('/api/me')).status;
  assert.equal(status, 429);
  s.f.advance(61_000);
  assert.equal((await c.call('/api/me')).status, 200);
});

// ---- F5: a session superseded by family creation elsewhere goes back to sign-in ----
test('F5: the second device is sent to sign-in, not stranded, after the first creates the family', async () => {
  const f = fixture(); const a = await f.login('parentA'), b = await f.login('parentA');
  await f.service.createFamily(a.ctx, { label: 'Fam', adultAttestation: true, consentVersion: 'terms-2026-09-13' });
  await assert.rejects(f.service.me(b.ctx), rejected('SIGN_IN_REQUIRED'));
  f.advance(1000);
  const again = await f.login('parentA'); // and a fresh sign-in on that device sees the family
  assert.ok((await f.service.me(again.ctx)).family);
});

// ---- F6: only a parent sign-out is a re-authentication boundary ----
test('F6: a child-mode sign-out does not move the parent re-auth marker', async () => {
  const f = fixture(); const { childCtx } = await childSession(f);
  const before = (await f.store.get('parents/parentA')).reauthAfter;
  f.advance(60_000); await f.service.logout(childCtx);
  assert.equal((await f.store.get('parents/parentA')).reauthAfter, before);
  await assert.rejects(f.service.me(childCtx), rejected('SIGN_IN_REQUIRED')); // its own session is still gone
});

// ---- F7 / F12: HTTP surface ----
test('F7: CSP script sources are path-scoped; no bare google.com script origin', async (t) => {
  const s = await serverTest(t);
  const csp = (await fetch(`${s.base}/api/bootstrap`)).headers.get('content-security-policy');
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
  assert.ok(!/https:\/\/www\.google\.com(\s|$)/.test(scriptSrc), scriptSrc);
  assert.ok(!/https:\/\/www\.gstatic\.com(\s|$)/.test(scriptSrc), scriptSrc);
  assert.ok(scriptSrc.includes('https://www.google.com/recaptcha/') && scriptSrc.includes('https://www.gstatic.com/firebasejs/'));
});
test('F12: cookie lifetimes match the session they carry', async (t) => {
  const s = await serverTest(t); const c = await s.client();
  const login = await c.call('/api/auth/session', { idToken: s.f.token('parentA') });
  assert.match(login.headers.get('set-cookie'), /Max-Age=1800(;|$)/);
  await c.call('/api/family', { label: 'Fam', adultAttestation: true, consentVersion: 'terms-2026-09-13' });
  const { grantEntitlement } = await import('../server/service.mjs');
  const familyId = (await (await c.call('/api/me')).json()).family.id;
  await grantEntitlement(s.f.store, { familyId, seatLimit: 1, accessUntil: s.f.now() + 600_000, reason: 'cookie test', actor: 'test-operator' }, s.f.now());
  await c.call('/api/children', { nickname: 'Fox', icon: 'fox', pin: '763829' }, { 'Idempotency-Key': crypto.randomUUID() });
  const lock = await c.call('/api/session/lock', {});
  assert.match(lock.headers.get('set-cookie'), /Max-Age=43200(;|$)/);
});

// ---- F8: named peppers, rotation and silent re-hash ----
test('F8: hashes name their pepper; retired peppers verify; legacy hashes verify and are flagged for re-hash', async () => {
  const h = pinHasher(pepper), stored = await h.hash('family-a', 'child-a', '763829');
  assert.match(stored, new RegExp(`^scrypt-v2:${pepperId(pepper)}:[a-f0-9]{32}:[a-f0-9]{64}$`));
  assert.equal(h.needsRehash(stored), false);
  const legacy = stored.replace(/^scrypt-v2:[a-f0-9]{8}:/, 'scrypt-v1:');
  assert.equal(await h.verify('family-a', 'child-a', '763829', legacy), true);
  assert.equal(h.needsRehash(legacy), true);
  const rotated = pinHasher('e5'.repeat(32), [pepper]);
  assert.equal(await rotated.verify('family-a', 'child-a', '763829', stored), true);
  assert.equal(await rotated.verify('family-a', 'child-a', '000000', stored), false);
  assert.equal(rotated.needsRehash(stored), true);
  const fresh = await rotated.hash('family-a', 'child-a', '763829');
  assert.equal(rotated.needsRehash(fresh), false);
  assert.equal(await pinHasher('e5'.repeat(32)).verify('family-a', 'child-a', '763829', stored), false); // pepper truly retired
});
test('F8: a correct PIN under a stale pepper is re-hashed on entry without touching the version', async () => {
  const f = fixture();
  const plain = (fam, c, p) => mac(pepper, `${fam}:${c}:${p}`);
  f.service.hasher = { hash: async (fam, c, p) => `new:${plain(fam, c, p)}`, verify: async (fam, c, p, h) => h.replace(/^new:/, '') === plain(fam, c, p), needsRehash: (h) => !h.startsWith('new:') };
  const p = await f.family('parentA', 1);
  const { child } = await f.child(p.ctx);
  await f.store.put(`families/${p.familyId}/credentials/${child.id}`, { hash: plain(p.familyId, child.id, '763829'), version: 1 }); // as if hashed before rotation
  const selCtx = await f.service.authenticate(await f.service.lock(p.ctx));
  const childCtx = await f.service.authenticate(await f.service.selectChild(selCtx, child.id, '763829'));
  const cred = await f.store.get(`families/${p.familyId}/credentials/${child.id}`);
  assert.ok(cred.hash.startsWith('new:')); assert.equal(cred.version, 1);
  assert.equal((await f.service.me(childCtx)).role, 'child');
});

// ---- F9 / F10: transactions and throttles ----
test('F9: read-only transactions refuse writes, and /me runs as one', async () => {
  const store = new MemoryStore();
  await assert.rejects(store.transaction(async (tx) => tx.set('x', { a: 1 }), { readOnly: true }), /readOnly/);
  const f = fixture(); const a = await f.family();
  const original = f.store.transaction.bind(f.store); let readOnlyCalls = 0;
  f.store.transaction = (fn, opts) => { if (opts?.readOnly) readOnlyCalls++; return original(fn, opts); };
  await f.service.me(a.ctx); assert.equal(readOnlyCalls, 1);
});
test('F10: an unauthorized caller cannot spend a family throttle', async () => {
  const f = fixture(); const { childCtx } = await childSession(f);
  const names = ['pin-family', 'child-create', 'pin-reset'];
  const before = await Promise.all(names.map((n) => f.store.get(bucket(`${n}:parentA`)))); // the parent's own legitimate spend
  await assert.rejects(f.service.selectChild(childCtx, crypto.randomUUID(), '000000'), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.service.createChild(childCtx, { nickname: 'X', icon: 'fox', pin: '111111' }, crypto.randomUUID()), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.service.resetPin(childCtx, crypto.randomUUID(), '111111'), rejected('PARENT_REQUIRED'));
  assert.deepEqual(await Promise.all(names.map((n) => f.store.get(bucket(`${n}:parentA`)))), before);
});
