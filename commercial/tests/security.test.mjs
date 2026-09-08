import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.mjs';
import { preauth, preauthCsrf, pinHasher } from '../server/security.mjs';
import { secret, pepper, rejected } from './support.mjs';

const env = { APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-foundation', APP_ORIGIN: 'http://127.0.0.1:8787',
  SESSION_SECRET: secret, PIN_PEPPER: pepper, FIREBASE_WEB_API_KEY: 'demo-key', FIREBASE_WEB_APP_ID: 'demo-app',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088' };
test('emulator configuration is explicit, demo-only and loopback-only', () => {
  assert.equal(config(env).emulator, true);
  for (const patch of [{ FIREBASE_PROJECT_ID: 'automathtics' }, { FIREBASE_PROJECT_ID: 'some-live-project' },
    { APP_ORIGIN: 'https://example.com' }, { FIRESTORE_EMULATOR_HOST: 'public.example:8088' }]) assert.throws(() => config({ ...env, ...patch }));
});
test('production fails closed for emulator variables, weak secrets and missing origin', () => {
  const prod = { ...env, APP_MODE: 'production', APP_ORIGIN: 'https://pilot.example.test', FIREBASE_PROJECT_ID: 'am-new-pilot' };
  assert.throws(() => config(prod));
  delete prod.FIREBASE_AUTH_EMULATOR_HOST; delete prod.FIRESTORE_EMULATOR_HOST;
  assert.equal(config(prod).emulator, false);
  for (const patch of [{ SESSION_SECRET: 'short' }, { PIN_PEPPER: secret }, { APP_ORIGIN: '' }, { APP_ORIGIN: 'https://pilot.example.test/path' }]) assert.throws(() => config({ ...prod, ...patch }));
});
test('preauthentication CSRF state rejects tampering and expiry', () => {
  const now = Date.parse('2026-09-06'), cookie = preauth(secret, now);
  assert.ok(preauthCsrf(secret, cookie, now));
  assert.equal(preauthCsrf(secret, cookie, now + 600000), null);
  assert.equal(preauthCsrf(pepper, cookie, now), null);
  assert.equal(preauthCsrf(secret, cookie + 'x', now), null);
});
test('real scrypt PIN hashes are salted, peppered and bound to family plus child', async () => {
  const h = pinHasher(pepper), stored = await h.hash('family-a', 'child-a', '763829');
  assert.ok(!stored.includes('763829'));
  assert.equal(await h.verify('family-a', 'child-a', '763829', stored), true);
  assert.equal(await h.verify('family-b', 'child-a', '763829', stored), false);
  assert.equal(await h.verify('family-a', 'child-a', '000000', stored), false);
  assert.equal(await h.verify('family-a', 'child-a', '763829', 'scrypt-v1:broken'), false);
  await assert.rejects(h.hash('f', 'c', '1234'), rejected('PIN_MUST_BE_SIX_DIGITS'));
});
