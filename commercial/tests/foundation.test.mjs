import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected } from './support.mjs';
import { grantEntitlement } from '../server/service.mjs';

// Follow the replacement cookie explicitly; predecessor contexts must stay invalid.
async function move(f, session, result) {
  session.cookie = await result;
  assert.equal(typeof session.cookie, 'string');
  session.ctx = await f.service.authenticate(session.cookie);
}

// These exercise the real service and real Firebase claim-validation adapter,
// with an in-memory transaction store and synthetic SDK responses (not cloud tests).
test('anonymous and invented session cookies are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.service.authenticate(null), rejected('SIGN_IN_REQUIRED'));
  await assert.rejects(f.service.authenticate('A'.repeat(43)), rejected('SIGN_IN_REQUIRED'));
});
test('email must be verified in both token and current identity record', async () => {
  const f = fixture(); const t = f.token('parentA', { email_verified: false });
  await assert.rejects(f.service.login(t), rejected('VERIFY_EMAIL'));
  const t2 = f.token('parentB'); f.users.get('parentB').emailVerified = false;
  await assert.rejects(f.service.login(t2), rejected('VERIFY_EMAIL'));
});
test('phone enrolment alone does not replace completed SMS MFA', async () => {
  const f = fixture(); const t = f.token('parentA', { firebase: { sign_in_provider: 'password' } });
  await assert.rejects(f.service.login(t), rejected('VERIFY_MOBILE_WITH_MFA'));
});
test('phone-only, custom and anonymous sign-in cannot open a parent session', async () => {
  const f = fixture();
  for (const provider of ['phone', 'custom', 'anonymous']) {
    await assert.rejects(f.service.login(f.token('parentA', { firebase: { sign_in_provider: provider } })), rejected('PASSWORD_SIGN_IN_REQUIRED'));
  }
});
test('removed MFA factor and changed email invalidate sessions', async () => {
  const f = fixture(), a = await f.login('parentA'), b = await f.login('parentB');
  f.users.get('parentA').multiFactor.enrolledFactors = [];
  f.users.get('parentB').email = 'changed@example.test';
  f.advance(61_000); // identity rechecks are cached for a minute (Stage 1b, F3)
  await assert.rejects(f.service.authenticate(a.cookie), rejected('SESSION_REVOKED'));
  await assert.rejects(f.service.authenticate(b.cookie), rejected('SESSION_REVOKED'));
});
test('stale and future identity tokens cannot create a parent session', async () => {
  const f = fixture();
  for (const offset of [-301, 31]) await assert.rejects(f.service.login(f.token('parentA', { auth_time: Math.floor(f.now() / 1000) + offset })), rejected('REAUTHENTICATE'));
});
test('disabled and administratively revoked parent identities are rejected', async () => {
  const f = fixture(), a = await f.login('parentA'), b = await f.login('parentB');
  f.users.get('parentA').disabled = true;
  f.users.get('parentB').tokensValidAfterTime = new Date(f.now() + 1000).toUTCString();
  f.advance(61_000); // identity rechecks are cached for a minute (Stage 1b, F3)
  await assert.rejects(f.service.authenticate(a.cookie), rejected('SESSION_REVOKED'));
  await assert.rejects(f.service.authenticate(b.cookie), rejected('SESSION_REVOKED'));
});
test('family setup is idempotent and starts with zero paid access', async () => {
  const f = fixture(), a = await f.family('parentA', 0);
  const again = await f.service.createFamily(a.ctx, { label: 'Test family', adultAttestation: true, consentVersion: 'pilot-v1' });
  assert.equal(again.id, a.familyId);
  await assert.rejects(f.child(a.ctx), rejected('SUBSCRIPTION_INACTIVE'));
  assert.equal((await f.service.me(a.ctx)).family.entitlement.seatLimit, 0);
});
test('forged role, ownership, verification and allowance fields are rejected', async () => {
  const f = fixture(), a = await f.family();
  for (const key of ['role', 'familyId', 'emailVerified', 'phoneVerified', 'seatLimit', 'status']) {
    await assert.rejects(f.service.createChild(a.ctx, { nickname: 'Fox', icon: 'fox', pin: '763829', [key]: true }, randomUUID()), rejected('INVALID_REQUEST'));
  }
});
test('one seat: exactly one of two simultaneous creates succeeds', async () => {
  const f = fixture(), a = await f.family();
  const results = await Promise.allSettled([f.child(a.ctx, 'One'), f.child(a.ctx, 'Two')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'CHILD_LIMIT_REACHED');
  assert.equal((await f.service.me(a.ctx)).family.activeCount, 1);
});
test('two seats allow two children, not three', async () => {
  const f = fixture(), a = await f.family('parentA', 2);
  await f.child(a.ctx, 'One'); await f.child(a.ctx, 'Two');
  await assert.rejects(f.child(a.ctx, 'Three'), rejected('CHILD_LIMIT_REACHED'));
});
test('a duplicate retry returns the original child and consumes one seat', async () => {
  const f = fixture(), a = await f.family(), id = randomUUID();
  const [x, y] = await Promise.all([f.child(a.ctx, 'One', id), f.child(a.ctx, 'One', id)]);
  assert.equal(x.child.id, y.child.id);
  assert.equal((await f.service.me(a.ctx)).family.activeCount, 1);
});
test('reusing an operation ID for a different request is rejected', async () => {
  const f = fixture(), a = await f.family('parentA', 2), id = randomUUID();
  await f.child(a.ctx, 'One', id);
  await assert.rejects(f.child(a.ctx, 'Two', id), rejected('IDEMPOTENCY_CONFLICT'));
});
test('child names are display fields, not storage or reserved system keys', async () => {
  const f = fixture(), a = await f.family('parentA', 2);
  const r = await f.child(a.ctx, 'Rocket'), s = await f.child(a.ctx, 'Security');
  assert.match(r.child.id, /^[a-f0-9-]{36}$/); assert.notEqual(r.child.id, s.child.id);
  assert.equal(await f.store.get(`families/${a.familyId}/rocket`), null);
});
test('cross-family PIN reset and child selection are denied', async () => {
  const f = fixture(), a = await f.family(), b = await f.family('parentB');
  const { child } = await f.child(b.ctx);
  await assert.rejects(f.service.resetPin(a.ctx, child.id, '999999'), rejected('CHILD_NOT_FOUND'));
  await move(f, a, f.service.lock(a.ctx));
  await assert.rejects(f.service.selectChild(a.ctx, child.id, '763829'), rejected('CHILD_NOT_FOUND'));
  assert.equal((await f.service.me(a.ctx)).family.children.length, 0);
});
test('parent and selector responses never disclose PIN or hash', async () => {
  const f = fixture(), a = await f.family(); await f.child(a.ctx);
  const p = JSON.stringify(await f.service.me(a.ctx)); await move(f, a, f.service.lock(a.ctx));
  const s = JSON.stringify(await f.service.me(a.ctx));
  for (const value of [p, s]) { assert.ok(!value.includes('763829')); assert.ok(!value.includes('hash')); assert.ok(!value.includes('pinVersion')); }
  assert.ok(!s.includes('entitlement'));
});
test('handover rotates the token and the resulting selector has no parent privileges', async () => {
  const f = fixture(), a = await f.family('parentA', 2), c = await f.child(a.ctx);
  await move(f, a, f.service.lock(a.ctx));
  await assert.rejects(f.child(a.ctx), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.service.resetPin(a.ctx, c.child.id, '999999'), rejected('PARENT_REQUIRED'));
  assert.equal((await f.service.me(await f.service.authenticate(a.cookie))).role, 'selector');
});
test('a copied pre-handover Firebase token cannot elevate a new browser session', async () => {
  const f = fixture(), a = await f.family(); await move(f, a, f.service.lock(a.ctx));
  await assert.rejects(f.service.login(a.idToken), rejected('REAUTHENTICATE'));
  f.advance(2000); const fresh = await f.login('parentA');
  assert.equal((await f.service.me(fresh.ctx)).role, 'parent');
});
test('child PIN produces a child-scoped session, not parent access', async () => {
  const f = fixture(), a = await f.family('parentA', 2), c = await f.child(a.ctx);
  await move(f, a, f.service.lock(a.ctx)); await move(f, a, f.service.selectChild(a.ctx, c.child.id, '763829'));
  const me = await f.service.me(a.ctx);
  assert.equal(me.role, 'child'); assert.equal(me.child.id, c.child.id); assert.equal(me.family, undefined);
  await assert.rejects(f.child(a.ctx), rejected('PARENT_REQUIRED'));
});
// v2's player cards show what each child wears. S1 (port plan section 4): the look and a colour, never a balance or the inventory.
test('S1: the launch pad and the parent see what each child wears and its colour, never the wallet; a child sees its own colour and still no family', async () => {
  const f = fixture(), a = await f.family('parentA', 2), fox = await f.child(a.ctx, 'Fox'), wolf = await f.child(a.ctx, 'Wolf');
  // Allison's migrated look (the Storm Dragon in the tiny crown, COMBO MASTER) plus a ring, a name effect and a vehicle
  await f.store.put(`families/${a.familyId}/learning/${fox.child.id}`, { wallet: { gc: 98765, rp: 45678, activeBg: 'bg_symbols',
    inventory: ['pet_legend', 'fit_crown', 'title_combo', 'ring_prestige', 'nfx_gold', 'veh_rocket', 'bg_symbols'],
    activePet: 'pet_legend', activeOutfit: 'fit_crown', activeTitle: 'title_combo', ring: 'ring_prestige', activeNameFx: 'nfx_gold', activeVehicle: 'veh_rocket' } });
  // a slot holding anything but an item of its own kind is worn as nothing
  await f.store.put(`families/${a.familyId}/learning/${wolf.child.id}`, { wallet: { activePet: 'fit_crown', activeTitle: 'constructor', ring: 'ring_nowhere', activeOutfit: 'pet_cat' } });
  const worn = { ring: 'ring_prestige', nameFx: 'nfx_gold', title: { name: 'COMBO MASTER' }, pet: { emoji: '🐲', legend: 'legendary' }, outfit: { emoji: '👑' }, vehicle: { emoji: '🚀' } };
  const nothing = { ring: null, nameFx: null, title: null, pet: null, outfit: null, vehicle: null };
  const check = (me) => {
    const [x, y] = me.family.children;
    assert.equal(x.id, fox.child.id); assert.equal(x.accent, 0); assert.deepEqual(x.appearance, worn);
    assert.equal(y.id, wolf.child.id); assert.equal(y.accent, 1); assert.deepEqual(y.appearance, nothing);
    const sent = JSON.stringify(me.family.children);
    for (const kept of ['"gc"', '"rp"', 'inventory', '98765', '45678', 'bg_symbols', 'purchases', 'redemptions']) assert.ok(!sent.includes(kept), `${kept} stays on the server`);
  };
  check(await f.service.me(a.ctx)); // the parent's workspace
  await move(f, a, f.service.lock(a.ctx)); check(await f.service.me(a.ctx)); // the launch pad
  await move(f, a, f.service.selectChild(a.ctx, wolf.child.id, '763829'));
  const me = await f.service.me(a.ctx);
  assert.equal(me.child.accent, 1); assert.equal(me.child.appearance, undefined); assert.equal(me.family, undefined);
});
test('five wrong PINs cause server-side lockout, including across sessions', async () => {
  const f = fixture(), a = await f.family(), other = await f.login('parentA'), c = await f.child(a.ctx);
  await move(f, a, f.service.lock(a.ctx)); await move(f, other, f.service.lock(other.ctx));
  for (let i = 0; i < 5; i++) await assert.rejects(f.service.selectChild(i % 2 ? a.ctx : other.ctx, c.child.id, '000000'), rejected('INCORRECT_PIN'));
  await assert.rejects(f.service.selectChild(a.ctx, c.child.id, '763829'), rejected('PIN_LOCKED'));
});
test('concurrent PIN requests cannot exceed the five-attempt budget', async () => {
  const f = fixture(), a = await f.family(), c = await f.child(a.ctx); await move(f, a, f.service.lock(a.ctx));
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.service.selectChild(a.ctx, c.child.id, '000000')));
  assert.equal(results.filter((r) => r.reason?.code === 'INCORRECT_PIN').length, 5);
  assert.equal(results.filter((r) => ['PIN_LOCKED', 'PIN_SERVICE_BUSY'].includes(r.reason?.code)).length, 3);
});
test('PIN reset revokes existing child sessions immediately on next use', async () => {
  const f = fixture(), a = await f.family(), manager = await f.login('parentA'), c = await f.child(a.ctx);
  await move(f, a, f.service.lock(a.ctx)); await move(f, a, f.service.selectChild(a.ctx, c.child.id, '763829'));
  await f.service.resetPin(manager.ctx, c.child.id, '992233');
  await assert.rejects(f.service.me(a.ctx), rejected('CHILD_SESSION_REVOKED'));
  await move(f, a, f.service.selector(a.ctx)); await move(f, a, f.service.selectChild(a.ctx, c.child.id, '992233'));
  assert.equal((await f.service.me(a.ctx)).role, 'child');
});
test('expiry is enforced without logout or a scheduled cleanup task', async () => {
  const f = fixture(), a = await f.family(), manager = await f.login('parentA'), c = await f.child(a.ctx);
  await move(f, a, f.service.lock(a.ctx)); await move(f, a, f.service.selectChild(a.ctx, c.child.id, '763829'));
  f.advance(15 * 60_000);
  await assert.rejects(f.service.me(a.ctx), rejected('SUBSCRIPTION_INACTIVE'));
  assert.equal((await f.service.me(manager.ctx)).role, 'parent');
});
test('downgrade requires an explicit surviving child selection and revokes excess access', async () => {
  const f = fixture(), a = await f.family('parentA', 2), c1 = await f.child(a.ctx, 'One'), c2 = await f.child(a.ctx, 'Two');
  const grant = { familyId: a.familyId, seatLimit: 1, accessUntil: f.now() + 999999, reason: 'pilot downgrade', actor: 'test-operator' };
  await assert.rejects(grantEntitlement(f.store, grant, f.now()), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
  await move(f, a, f.service.lock(a.ctx)); await move(f, a, f.service.selectChild(a.ctx, c2.child.id, '763829'));
  await grantEntitlement(f.store, { ...grant, keepChildIds: [c1.child.id] }, f.now());
  await assert.rejects(f.service.me(a.ctx), rejected('CHILD_INACTIVE'));
});
test('unrelated child IDs and invalid numbers cannot become paid seat assignments', async () => {
  const f = fixture(), a = await f.family();
  const base = { familyId: a.familyId, seatLimit: 1, accessUntil: f.now() + 10000, reason: 'invalid grant test', actor: 'test-operator' };
  for (const seatLimit of [-1, 1.5, 21, NaN]) await assert.rejects(grantEntitlement(f.store, { ...base, seatLimit }), rejected('INVALID_ENTITLEMENT'));
  await assert.rejects(grantEntitlement(f.store, { ...base, keepChildIds: [randomUUID()] }), rejected('SELECT_CHILDREN_FOR_DOWNGRADE'));
});
test('expired parent sessions cannot act even with correct cookies', async () => {
  const f = fixture(), a = await f.family(); f.advance(30 * 60_000);
  await assert.rejects(f.service.authenticate(a.cookie), rejected('SIGN_IN_REQUIRED'));
  await assert.rejects(f.service.me(a.ctx), rejected('SIGN_IN_REQUIRED'));
});
test('membership revocation denies both reads and writes', async () => {
  const f = fixture(), a = await f.family();
  await f.store.put(`families/${a.familyId}/members/parentA`, { role: 'owner', status: 'revoked' });
  await assert.rejects(f.service.me(a.ctx), rejected('ACCESS_DENIED'));
  await assert.rejects(f.child(a.ctx), rejected('ACCESS_DENIED'));
});
test('logout revokes the cookie and stale identity token', async () => {
  const f = fixture(), a = await f.family(); await f.service.logout(a.ctx);
  await assert.rejects(f.service.authenticate(a.cookie), rejected('SIGN_IN_REQUIRED'));
  await assert.rejects(f.service.login(a.idToken), rejected('REAUTHENTICATE'));
});
test('hashing failure cannot leave a partially-created profile or consumed seat', async () => {
  const f = fixture(), a = await f.family(); f.service.hasher = { hash: async () => { throw Error('simulated failure'); } };
  await assert.rejects(f.child(a.ctx));
  assert.equal((await f.service.me(a.ctx)).family.activeCount, 0);
  assert.equal([...f.store.data.keys()].filter((p) => p.includes('/credentials/')).length, 0);
});
test('database failure does not fall back to local or unverified access', async () => {
  const f = fixture(), a = await f.family(); f.store.get = async () => { throw Error('store unavailable'); };
  await assert.rejects(f.service.authenticate(a.cookie), /store unavailable/);
});
test('old parent authorization contexts cannot survive session rotation', async () => {
  const f = fixture(), a = await f.family();
  await f.service.login(f.token('parentA'), a.cookie);
  await assert.rejects(f.service.me(a.ctx), rejected('SIGN_IN_REQUIRED'));
});
test('handover barrier also covers an identity-provider clock ahead of the server', async () => {
  const f = fixture(), a = await f.login('parentA', { auth_time: Math.floor(f.now() / 1000) + 20 });
  const created = await f.service.createFamily(a.ctx, { label: 'Test', adultAttestation: true, consentVersion: 'pilot-v1' });
  await move(f, a, Promise.resolve(created.token));
  await move(f, a, f.service.lock(a.ctx));
  await assert.rejects(f.service.login(a.idToken), rejected('REAUTHENTICATE'));
});
test('PIN reset racing a verification prevents the old PIN from granting access', async () => {
  const f = fixture(), a = await f.family(), manager = await f.login('parentA'), c = await f.child(a.ctx);
  await move(f, a, f.service.lock(a.ctx));
  const original = f.service.hasher;
  f.service.hasher = { ...original, verify: async (...args) => {
    await f.service.resetPin(manager.ctx, c.child.id, '992233');
    return original.verify(...args);
  } };
  await assert.rejects(f.service.selectChild(a.ctx, c.child.id, '763829'), rejected('PIN_CHANGED_RETRY'));
  assert.equal((await f.service.me(a.ctx)).role, 'selector');
});
