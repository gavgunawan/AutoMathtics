import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(config(prod).payments, { provider: 'fake', webhookSecrets: { fake: 'c3'.repeat(32) }, stripe: null });
  // Stage 4.1: Stripe — test keys everywhere but production, live keys only there; all three prices named
  const stripe = { PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_' + 'a1b2c3d4'.repeat(3), WEBHOOK_SECRET_STRIPE: 'whsec_' + 'z9y8x7w6'.repeat(3), STRIPE_PRICE_STARTER: 'price_1Starter00', STRIPE_PRICE_FAMILY: 'price_1Family000', STRIPE_PRICE_BIG: 'price_1BigFam000' };
  assert.equal(config({ ...env, ...stripe }).payments.stripe.prices.family, 'price_1Family000');
  assert.equal(config({ ...prod, ...stripe, APP_MODE: 'staging' }).payments.provider, 'stripe');
  // the deployed commit rides along as RELEASE_SHA (deploy-staging.sh); anything but a full sha is ignored, never trusted
  assert.equal(config({ ...prod, ...stripe, APP_MODE: 'staging', RELEASE_SHA: 'ab'.repeat(20) }).releaseSha, 'ab'.repeat(20));
  assert.equal(config({ ...prod, ...stripe, APP_MODE: 'staging', RELEASE_SHA: 'main' }).releaseSha, null); assert.equal(config({ ...prod, ...stripe, APP_MODE: 'staging' }).releaseSha, null);
  assert.throws(() => config({ ...prod, ...stripe }), /live Stripe key/);
  assert.throws(() => config({ ...env, ...stripe, STRIPE_SECRET_KEY: 'sk_live_' + 'a1b2c3d4'.repeat(3) }), /only for production/);
  for (const patch of [{ STRIPE_SECRET_KEY: undefined }, { WEBHOOK_SECRET_STRIPE: 'nope' }, { STRIPE_PRICE_BIG: undefined }, { STRIPE_PRICE_STARTER: 'plan_x' }]) assert.throws(() => config({ ...env, ...stripe, ...patch }));
  assert.equal(config({ ...prod, ...stripe, STRIPE_SECRET_KEY: 'sk_live_' + 'a1b2c3d4'.repeat(3) }).payments.stripe.secretKey.startsWith('sk_live_'), true);
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

// The service reads its configuration before it listens, so a throw here is a container that never opens its port: on
// 13 Sep 2026 a copied address pattern lost its backslashes on the way into the file, became [^s@<>"] — which excludes the
// letter s — and refused support@automathtics.net, killing every deploy while the whole unit suite stayed green. So the
// environment the deploy script actually writes is built here, exactly, and asserted to start.
test('the environment the deploy writes is one the service can start from, addresses and all', () => {
  const deployed = {
    APP_MODE: 'staging', APP_ORIGIN: 'https://automathtics.net',
    APP_ALSO_ORIGINS: 'https://automathtics-v3-staging.web.app,https://automathtics-v3-staging.firebaseapp.com',
    FIREBASE_PROJECT_ID: 'automathtics-v3-staging', FIREBASE_WEB_API_KEY: 'AIzaSyTest', FIREBASE_WEB_APP_ID: '1:1:web:1',
    TRUSTED_PROXY_HOPS: '2', RELEASE_SHA: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', PAYMENT_PROVIDER: 'stripe',
    STRIPE_PRICE_STARTER: 'price_1UDktFEAg0w7lrNU8ixmQg6g', STRIPE_PRICE_FAMILY: 'price_1UDktZEAg0w7lrNU0kJdqUxK',
    STRIPE_PRICE_BIG: 'price_1UDktlEAg0w7lrNUb4AwLnP3',
    WAITLIST_FROM: 'AutoMathtics <no-reply@automathtics.net>', WAITLIST_REPLY_TO: 'support@automathtics.net',
    WAITLIST_SHEET_ID: '1vceAjJRQQYa1u3Z0okf7Tt3AOsZVBWui5Xvav985dNQ',
    FEEDBACK_TO: 'control.tower@automathtics.net', EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'AutoMathtics <control.tower@automathtics.net>',
    SESSION_SECRET: 'a'.repeat(64), PIN_PEPPER: 'b'.repeat(64),
    STRIPE_SECRET_KEY: `sk_test_${'x'.repeat(24)}`, WEBHOOK_SECRET_STRIPE: `whsec_${'y'.repeat(32)}`,
    EMAIL_API_KEY: `re_${'z'.repeat(30)}`, PORT: '8080',
  };
  const cfg = config(deployed);
  assert.equal(cfg.waitlist.mail.from, 'AutoMathtics <no-reply@automathtics.net>', 'the list writes as no-reply');
  assert.equal(cfg.waitlist.replyTo, 'support@automathtics.net', 'and a person answers it');
  assert.equal(cfg.feedback.to, 'control.tower@automathtics.net');
  // links carry the domain, and the project's own hosts still take forms from the devices that opened the app there (13 Sep 2026)
  assert.equal(cfg.origin, 'https://automathtics.net');
  assert.deepEqual(cfg.origins, ['https://automathtics.net', 'https://automathtics-v3-staging.web.app', 'https://automathtics-v3-staging.firebaseapp.com']);
  for (const bad of ['automathtics.net', 'https://automathtics.net/', 'http://automathtics-v3-staging.web.app', 'https://automathtics.net,/join'])
    assert.throws(() => config({ ...deployed, APP_ALSO_ORIGINS: bad }), bad);
  assert.deepEqual(config({ ...deployed, APP_ALSO_ORIGINS: undefined }).origins, ['https://automathtics.net'], 'no list: the one origin, as before');
  // the owner's Google Sheet copy of the waiting list (13 Sep 2026): its id, checked, since a malformed one fails every write in silence
  assert.equal(cfg.waitlist.sheetId, '1vceAjJRQQYa1u3Z0okf7Tt3AOsZVBWui5Xvav985dNQ');
  for (const bad of ['https://docs.google.com/spreadsheets/d/1vceAjJRQQYa1u3Z0okf7Tt3AOsZVBWui5Xvav985dNQ/edit', 'short-id', 'an id with spaces that is long enough to pass'])
    assert.throws(() => config({ ...deployed, WAITLIST_SHEET_ID: bad }), bad);
  assert.equal(config({ ...deployed, WAITLIST_SHEET_ID: undefined }).waitlist.sheetId, null, 'no sheet named: none written');
  // every ordinary address shape the owner might set, and the ones that should still be refused
  for (const good of ['a@b.co', 'support@automathtics.net', 'no.reply+list@sub.automathtics.net', 'SUPPORT@AUTOMATHTICS.NET'])
    assert.ok(config({ ...deployed, WAITLIST_REPLY_TO: good }), good);
  for (const bad of ['support@automathtics', 'two addresses@a.co b@c.co', '@automathtics.net', 'support@.net'])
    assert.throws(() => config({ ...deployed, WAITLIST_REPLY_TO: bad }), bad);
  // and without the list's own addresses the service still starts, writing as whatever EMAIL_FROM is
  const plain = { ...deployed }; delete plain.WAITLIST_FROM; delete plain.WAITLIST_REPLY_TO;
  assert.equal(config(plain).waitlist.mail.from, 'AutoMathtics <control.tower@automathtics.net>');
  // a service that copies nothing needs no Resend key at all, and must not demand one
  const quiet = { ...plain }; delete quiet.FEEDBACK_TO; delete quiet.EMAIL_PROVIDER; delete quiet.EMAIL_API_KEY;
  assert.equal(config(quiet).waitlist.mail, null, 'nothing to send with, and nothing pretending otherwise');
  // …and main.mjs builds the mailers from exactly that, before it listens: a null mail read as cfg.waitlist.mail.provider is a
  // TypeError at startup, a service that never opens its port (found 13 Sep 2026; every deploy sets FEEDBACK_TO, so it never fired)
  const main = readFileSync(new URL('../server/main.mjs', import.meta.url), 'utf8');
  assert.ok(!/cfg\.(?:waitlist|feedback)\.mail\./.test(main), 'every read of a mail setting in main.mjs tolerates a null mail');
});
