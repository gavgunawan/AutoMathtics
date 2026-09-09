import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.mjs';
import { preauth, preauthCsrf, pinHasher } from '../server/security.mjs';
import { secret, pepper, rejected } from './support.mjs';

const env = { APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-foundation', APP_ORIGIN: 'http://127.0.0.1:8787',
  SESSION_SECRET: secret, PIN_PEPPER: pepper, FIREBASE_WEB_API_KEY: 'demo-key', FIREBASE_WEB_APP_ID: 'demo-app',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088', WEBHOOK_SECRET_FAKE: 'c3'.repeat(32) };
test('emulator configuration is explicit, demo-only and loopback-only', () => {
  assert.equal(config(env).emulator, true);
  for (const patch of [{ FIREBASE_PROJECT_ID: 'automathtics' }, { FIREBASE_PROJECT_ID: 'some-live-project' },
    { APP_ORIGIN: 'https://example.com' }, { FIRESTORE_EMULATOR_HOST: 'public.example:8088' }]) assert.throws(() => config({ ...env, ...patch }));
});
test('production fails closed for emulator variables, weak secrets and missing origin', () => {
  const prod = { ...env, APP_MODE: 'production', APP_ORIGIN: 'https://pilot.example.test', FIREBASE_PROJECT_ID: 'am-new-pilot', TRUSTED_PROXY_HOPS: '1', PAYMENT_PROVIDER: 'fake', FAKE_PAYMENTS_ACK: 'no-real-money' };
  assert.throws(() => config(prod));
  delete prod.FIREBASE_AUTH_EMULATOR_HOST; delete prod.FIRESTORE_EMULATOR_HOST;
  assert.equal(config(prod).emulator, false);
  assert.equal(config(prod).proxyHops, 1);
  for (const patch of [{ SESSION_SECRET: 'short' }, { PIN_PEPPER: secret }, { APP_ORIGIN: '' }, { APP_ORIGIN: 'https://pilot.example.test/path' },
    { TRUSTED_PROXY_HOPS: undefined }, { TRUSTED_PROXY_HOPS: '7' }, { PIN_PEPPER_PREVIOUS: pepper }, { PIN_PEPPER_PREVIOUS: 'short' },
    { PIN_PEPPER_PREVIOUS: `${'c3'.repeat(32)},${'c3'.repeat(32)}` },
    // Stage 3.3: the fake provider must be acknowledged outside the emulator; the webhook secret is real and distinct
    { FAKE_PAYMENTS_ACK: undefined }, { PAYMENT_PROVIDER: 'stripe' }, { PAYMENT_PROVIDER: undefined }, { WEBHOOK_SECRET_FAKE: undefined }, { WEBHOOK_SECRET_FAKE: secret }, { WEBHOOK_SECRET_FAKE: 'short' },
    { PIN_PEPPER_PREVIOUS: 'c3'.repeat(32) }]) assert.throws(() => config({ ...prod, ...patch }));
  assert.deepEqual(config(prod).payments, { provider: 'fake', webhookSecrets: { fake: 'c3'.repeat(32) } });
  assert.deepEqual(config({ ...prod, PIN_PEPPER_PREVIOUS: `${'e5'.repeat(32)}, ${'d4'.repeat(32)}` }).previousPeppers, ['e5'.repeat(32), 'd4'.repeat(32)]);
  assert.equal(config(env).proxyHops, 0); // emulator defaults to the socket address
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
