import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, fakeHasher, secret, pepper, rejected } from './support.mjs';
import { createApp } from '../server/http.mjs';
import { pinHasher, Fault } from '../server/security.mjs';
import { grantEntitlement } from '../server/service.mjs';

async function handover(f, a) {
  const cookie = await f.service.lock(a.ctx);
  // The fallback permits these regressions to run against the old implementation:
  // it is TEST-ONLY, not production compatibility or an authorization fallback.
  return { ...a, cookie: cookie || a.cookie, ctx: await f.service.authenticate(cookie || a.cookie) };
}
async function enter(f, a, id, pin = '763829') {
  const cookie = await f.service.selectChild(a.ctx, id, pin);
  return { ...a, cookie: cookie || a.cookie, ctx: await f.service.authenticate(cookie || a.cookie) };
}
function gate() {
  let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve };
}
async function listen(t, f, secure = false) {
  const cfg = { origin: 'http://127.0.0.1', secret, emulator: !secure, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const app = createApp(f.service, cfg); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  cfg.origin = `http://127.0.0.1:${app.address().port}`;
  t.after(() => { app.closeAllConnections(); app.close(); });
  const call = (path, cookie, csrf, data) => fetch(cfg.origin + '/api' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Cookie: `__session=${cookie}`, Origin: cfg.origin, 'X-CSRF-Token': csrf || '', 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { call };
}

test('S1-001: handover replaces cookie/CSRF and permanently invalidates the parent predecessor', async () => {
  const f = fixture(), parent = await f.family(), previousCsrf = (await f.service.me(parent.ctx)).csrf;
  const selector = await handover(f, parent);
  assert.notEqual(selector.cookie, parent.cookie);
  assert.notEqual((await f.service.me(selector.ctx)).csrf, previousCsrf);
  await assert.rejects(f.service.authenticate(parent.cookie), rejected('SIGN_IN_REQUIRED'));
  await assert.rejects(f.service.me(parent.ctx), rejected('SIGN_IN_REQUIRED'));
  assert.equal((await f.service.me(selector.ctx)).role, 'selector');
});
test('S1-001: retained selector cookie cannot follow successful child authentication', async (t) => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child;
  const selector = await handover(f, parent), s = await listen(t, f, true);
  const csrf = (await f.service.me(selector.ctx)).csrf;
  assert.equal((await s.call('/child/profile', selector.cookie)).status, 403);
  const r = await s.call(`/children/${kid.id}/enter`, selector.cookie, csrf, { pin: '763829' });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get('set-cookie'); assert.ok(setCookie);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(flag));
  const fresh = setCookie.split(';')[0].split('=')[1]; assert.notEqual(fresh, selector.cookie);
  assert.deepEqual(await r.json(), { ok: true }); // no raw token in JSON
  assert.equal((await s.call('/child/profile', selector.cookie)).status, 401);
  const profile = await s.call('/child/profile', fresh); assert.equal(profile.status, 200);
  assert.equal((await profile.json()).child.id, kid.id);
  const me = await (await s.call('/me', fresh)).json(); assert.notEqual(me.csrf, csrf);
  const staleCsrf = await s.call('/session/select', fresh, csrf, {});
  assert.equal(staleCsrf.status, 403); assert.equal((await staleCsrf.json()).error, 'CSRF_DENIED');
});
test('S1-001: switching children revokes the old child cookie and rotates again after the next PIN', async (t) => {
  const f = fixture(), parent = await f.family('parentA', 2);
  const one = (await f.child(parent.ctx, 'One')).child, two = (await f.child(parent.ctx, 'Two')).child;
  const selector = await handover(f, parent), first = await enter(f, selector, one.id), s = await listen(t, f);
  const csrf = (await f.service.me(first.ctx)).csrf;
  const switchResponse = await s.call('/session/select', first.cookie, csrf, {});
  assert.equal(switchResponse.status, 200);
  const fresh = switchResponse.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.notEqual(fresh, first.cookie);
  const nextSelector = { cookie: fresh, ctx: await f.service.authenticate(fresh) };
  await assert.rejects(f.service.authenticate(first.cookie), rejected('SIGN_IN_REQUIRED'));
  const second = await enter(f, nextSelector, two.id);
  assert.notEqual(second.cookie, fresh);
  await assert.rejects(f.service.authenticate(fresh), rejected('SIGN_IN_REQUIRED'));
  assert.equal((await f.service.me(second.ctx)).child.id, two.id);
});
test('S1-001: concurrent successful PIN requests produce at most one new session for one predecessor', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  const results = await Promise.allSettled([f.service.selectChild(a.ctx, kid.id, '763829'), f.service.selectChild(a.ctx, kid.id, '763829')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SIGN_IN_REQUIRED');
  await assert.rejects(f.service.authenticate(a.cookie), rejected('SIGN_IN_REQUIRED'));
  const token = results.find(r => r.status === 'fulfilled').value;
  assert.equal((await f.service.me(await f.service.authenticate(token))).role, 'child');
});
test('S1-001: child rotations do not extend the original child-mode absolute expiry', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  const expiresAt = (await f.store.get(`sessions/${a.ctx.key}`)).expiresAt;
  f.advance(1000); const child = await enter(f, a, kid.id);
  assert.equal((await f.store.get(`sessions/${child.ctx.key}`)).expiresAt, expiresAt);
  const token = await f.service.selector(child.ctx), selector = await f.service.authenticate(token);
  assert.equal((await f.store.get(`sessions/${selector.key}`)).expiresAt, expiresAt);
});
test('S1-001: rotating one browser session leaves a separate legitimate parent session unchanged', async () => {
  const f = fixture(), parent = await f.family(), manager = await f.login('parentA'), kid = (await f.child(parent.ctx)).child;
  await enter(f, await handover(f, parent), kid.id);
  assert.equal((await f.service.me(manager.ctx)).role, 'parent');
  await assert.rejects(f.service.authenticate(parent.cookie), rejected('SIGN_IN_REQUIRED'));
});
test('S1-002: real busy scrypt never spends the wrong-PIN budget; correct PIN works after recovery', async () => {
  const f = fixture(); f.service.hasher = pinHasher(pepper);
  const parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  const occupy = f.service.hasher.hash(a.familyId, randomUUID(), '483971');
  try {
    for (let i = 0; i < 5; i++) await assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), rejected('PIN_SERVICE_BUSY'));
  } finally { await occupy; }
  assert.equal(await f.store.get(`families/${a.familyId}/pinAttempts/${kid.id}`), null);
  const child = await enter(f, a, kid.id);
  assert.equal((await f.service.me(child.ctx)).role, 'child');
});
test('S1-002: unexpected hasher failure refunds its reservation but preserves earlier wrong attempts', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  await assert.rejects(f.service.selectChild(a.ctx, kid.id, '000000'), rejected('INCORRECT_PIN'));
  f.service.hasher = { ...fakeHasher, verify: async () => { throw Error('synthetic hasher outage'); } };
  for (let i = 0; i < 5; i++) await assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), /synthetic hasher outage/);
  const attempts = await f.store.get(`families/${a.familyId}/pinAttempts/${kid.id}`);
  assert.equal(attempts.count, 1); assert.deepEqual(attempts.pending, {});
  f.service.hasher = fakeHasher;
  for (let i = 0; i < 4; i++) await assert.rejects(f.service.selectChild(a.ctx, kid.id, '000000'), rejected('INCORRECT_PIN'));
  await assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), rejected('PIN_LOCKED'));
});
test('S1-002: failed cleanup cannot erase a concurrent completed wrong PIN', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  const started = gate(), release = gate();
  f.service.hasher = { ...fakeHasher, verify: async (...args) => {
    if (args[2] === '763829') { started.resolve(); await release.promise; throw new Fault(503, 'PIN_SERVICE_BUSY'); }
    return fakeHasher.verify(...args);
  } };
  const unavailable = assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), rejected('PIN_SERVICE_BUSY'));
  await started.promise;
  await assert.rejects(f.service.selectChild(a.ctx, kid.id, '000000'), rejected('INCORRECT_PIN'));
  release.resolve(); await unavailable;
  const attempts = await f.store.get(`families/${a.familyId}/pinAttempts/${kid.id}`);
  assert.equal(attempts.count, 1); assert.deepEqual(attempts.pending, {});
});
test('S1-002: successful proof preserves outstanding reservations from another browser', async () => {
  const f = fixture(), parent = await f.family(), otherParent = await f.login('parentA'), kid = (await f.child(parent.ctx)).child;
  const a = await handover(f, parent), b = await handover(f, otherParent);
  const started = gate(), release = gate();
  f.service.hasher = { ...fakeHasher, verify: async (...args) => {
    if (args[2] === '000000') { started.resolve(); await release.promise; }
    return fakeHasher.verify(...args);
  } };
  const wrong = assert.rejects(f.service.selectChild(b.ctx, kid.id, '000000'), rejected('INCORRECT_PIN'));
  await started.promise; const child = await enter(f, a, kid.id);
  const during = await f.store.get(`families/${a.familyId}/pinAttempts/${kid.id}`);
  assert.equal(during.count, 1); assert.equal(Object.keys(during.pending).length, 1);
  release.resolve(); await wrong;
  const after = await f.store.get(`families/${a.familyId}/pinAttempts/${kid.id}`);
  assert.equal(after.count, 1); assert.deepEqual(after.pending, {});
  assert.equal((await f.service.me(child.ctx)).role, 'child');
});
test('S1-002: late infrastructure failure after PIN reset cannot refund a new-credential failure', async () => {
  const f = fixture(), parent = await f.family(), manager = await f.login('parentA'), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  const started = gate(), release = gate();
  f.service.hasher = { ...fakeHasher, verify: async () => { started.resolve(); await release.promise; throw new Fault(503, 'PIN_SERVICE_BUSY'); } };
  const old = assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), rejected('PIN_SERVICE_BUSY'));
  await started.promise;
  await f.service.resetPin(manager.ctx, kid.id, '992233'); f.service.hasher = fakeHasher;
  await assert.rejects(f.service.selectChild(a.ctx, kid.id, '000000'), rejected('INCORRECT_PIN'));
  release.resolve(); await old;
  const attempts = await f.store.get(`families/${a.familyId}/pinAttempts/${kid.id}`);
  assert.equal(attempts.count, 1); assert.deepEqual(attempts.pending, {});
});
test('S1-002: an expired verification cannot authorize or erase a replacement-window failure', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  await grantEntitlement(f.store, { familyId: parent.familyId, seatLimit: 1, accessUntil: f.now() + 3600000, reason: 'extended synthetic test', actor: 'test-operator' }, f.now());
  const started = gate(), release = gate();
  f.service.hasher = { ...fakeHasher, verify: async (...args) => {
    if (args[2] === '763829') { started.resolve(); await release.promise; }
    return fakeHasher.verify(...args);
  } };
  const stale = assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), rejected('PIN_CHECK_EXPIRED'));
  await started.promise; f.advance(15 * 60000 + 1);
  await assert.rejects(f.service.selectChild(a.ctx, kid.id, '000000'), rejected('INCORRECT_PIN'));
  release.resolve(); await stale;
  assert.equal((await f.store.get(`families/${a.familyId}/pinAttempts/${kid.id}`)).count, 1);
  assert.equal((await f.service.me(a.ctx)).role, 'selector');
});
test('S1-002: eight simultaneous requests run at most five hash verifications', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  let calls = 0; f.service.hasher = { ...fakeHasher, verify: async (...args) => { calls++; return fakeHasher.verify(...args); } };
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.service.selectChild(a.ctx, kid.id, '000000')));
  assert.equal(calls, 5);
  assert.equal(results.filter(r => r.reason?.code === 'INCORRECT_PIN').length, 5);
  assert.equal(results.filter(r => ['PIN_SERVICE_BUSY', 'PIN_LOCKED'].includes(r.reason?.code)).length, 3);
  await assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), rejected('PIN_LOCKED'));
});
test('S1-002: database failure during refund fails closed without authenticating', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child, a = await handover(f, parent);
  const original = f.store.transaction.bind(f.store);
  f.service.hasher = { ...fakeHasher, verify: async () => {
    f.store.transaction = async () => { throw Error('synthetic refund database failure'); };
    throw new Fault(503, 'PIN_SERVICE_BUSY');
  } };
  await assert.rejects(f.service.selectChild(a.ctx, kid.id, '763829'), /synthetic refund database failure/);
  f.store.transaction = original;
  assert.equal((await f.service.me(a.ctx)).role, 'selector');
});
test('S1-003: only parent /me responses contain the server-confirmed continuation identity', async () => {
  const f = fixture(), parent = await f.family(), kid = (await f.child(parent.ctx)).child;
  assert.deepEqual((await f.service.me(parent.ctx)).parent, { uid: 'parentA' });
  const selector = await handover(f, parent); assert.equal((await f.service.me(selector.ctx)).parent, undefined);
  const child = await enter(f, selector, kid.id); assert.equal((await f.service.me(child.ctx)).parent, undefined);
});
test('S1-004: full-seat child requests are rejected without hashing', async () => {
  const f = fixture(), parent = await f.family(); await f.child(parent.ctx);
  let calls = 0; f.service.hasher = { ...fakeHasher, hash: async (...args) => { calls++; return fakeHasher.hash(...args); } };
  await assert.rejects(f.child(parent.ctx, 'Extra'), rejected('CHILD_LIMIT_REACHED')); assert.equal(calls, 0);
});
test('S1-004: idempotent retry still succeeds when its existing child fills the final seat', async () => {
  const f = fixture(), parent = await f.family(), requestId = randomUUID();
  const child = await f.child(parent.ctx, 'Original', requestId);
  let calls = 0; f.service.hasher = { ...fakeHasher, hash: async (...args) => { calls++; return fakeHasher.hash(...args); } };
  assert.deepEqual(await f.child(parent.ctx, 'Original', requestId), child); assert.equal(calls, 0);
});
test('S1-004: unknown/cross-family PIN resets do not hash', async () => {
  const f = fixture(), a = await f.family(), b = await f.family('parentB'), kid = (await f.child(b.ctx)).child;
  let calls = 0; f.service.hasher = { ...fakeHasher, hash: async (...args) => { calls++; return fakeHasher.hash(...args); } };
  for (const id of [randomUUID(), kid.id]) await assert.rejects(f.service.resetPin(a.ctx, id, '987654'), rejected('CHILD_NOT_FOUND'));
  assert.equal(calls, 0);
});
test('S1-004: final transactional capacity check still rejects a race after the early check', async () => {
  const f = fixture(), a = await f.family(); const started = gate(), release = gate();
  f.service.hasher = { ...fakeHasher, hash: async (...args) => { started.resolve(); await release.promise; return fakeHasher.hash(...args); } };
  const delayed = f.child(a.ctx, 'Delayed'); await started.promise;
  f.service.hasher = fakeHasher; await f.child(a.ctx, 'Winner'); release.resolve();
  await assert.rejects(delayed, rejected('CHILD_LIMIT_REACHED'));
  assert.equal((await f.service.me(a.ctx)).family.activeCount, 1);
});
test('S1-005: Docker build context explicitly includes the required lockfile', async () => {
  const ignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(ignore, /^!package-lock\.json$/m); assert.match(docker, /COPY package\.json package-lock\.json/);
  assert.match(docker, /npm ci --omit=dev/);
});
