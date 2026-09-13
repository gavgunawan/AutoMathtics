// Payments not open (PAYMENT_PROVIDER=none, 13 Sep 2026): the live launch, where families play free and no payment provider is
// connected. No gateway exists; every parent action that would reach a provider or make a plan paid is refused with
// PAYMENTS_NOT_OPEN before anything is written; the webhook route does not exist; the billing view and the leaving flow say so; a
// trial, its cancellation, seats, the export and both deletions work as ever, and a deletion asks no provider anything. The
// operator tools build the same services. Plus the auth domain the live site signs in through (FIREBASE_AUTH_DOMAIN).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../server/config.mjs';
import { createApp } from '../server/http.mjs';
import { Payments, FakeGateway, signWebhook } from '../server/payments.mjs';
import { Subscriptions, OPENING } from '../server/subscription.mjs';
import { offersFor } from '../server/leaving.mjs';
import { fixture, secret, pepper, webhookSecret, rejected } from './support.mjs';

const DAY = 86_400_000, op = () => ({ operationId: randomUUID() });
/** Every document the store holds, in path order: equal before and after means nothing was written. */
const snapshot = (f) => JSON.stringify([...f.store.data].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
/** A family whose record says it pays: an operator's event, the only way a paid plan can reach a project that takes no payments. */
async function paidFamily(f, uid, plan = 'family') {
  const a = await f.family(uid, 0);
  await f.billing.apply(a.familyId, { id: randomUUID(), type: 'payment.succeeded', plan, periodEnd: f.now() + 30 * DAY, provider: 'manual' }, 'ops@example.test');
  return a;
}
/** The real HTTP handler over a fixture, and a parent's browser: the session cookie, its CSRF token and the service's own Origin. */
async function server(t, { provider = 'none', at = null } = {}) {
  const f = fixture({ provider });
  if (at !== null) f.advance(at - f.now());
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, proxyHops: 0, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const app = createApp(f.service, cfg, { billing: f.billing, payments: f.payments, support: f.support, leaving: f.leaving, email: f.email });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const as = async (session) => {
    const cookie = `__session=${session.cookie}`, { csrf } = await (await fetch(`${base}/api/bootstrap`, { headers: { Cookie: cookie } })).json();
    return async (path, body) => {
      const r = await fetch(`${base}${path}`, body === undefined ? { headers: { Cookie: cookie } }
        : { method: 'POST', headers: { Cookie: cookie, Origin: cfg.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
  };
  return { f, base, as };
}

const emulatorEnv = { APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-foundation', APP_ORIGIN: 'http://127.0.0.1:8787', SESSION_SECRET: secret, PIN_PEPPER: pepper,
  FIREBASE_WEB_API_KEY: 'demo-key', FIREBASE_WEB_APP_ID: 'demo-app', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088' };
const cloudEnv = (mode) => ({ APP_MODE: mode, FIREBASE_PROJECT_ID: 'automathtics-live', APP_ORIGIN: 'https://automathtics.net', SESSION_SECRET: secret, PIN_PEPPER: pepper,
  FIREBASE_WEB_API_KEY: 'AIzaSyLive', FIREBASE_WEB_APP_ID: '1:2:web:3', TRUSTED_PROXY_HOPS: '2' });
const CLOSED = { provider: 'none', webhookSecrets: { fake: null }, stripe: null };

test('config: PAYMENT_PROVIDER=none is accepted in every mode and asks for no provider secret, price id or acknowledgement; fake and stripe refuse as before', () => {
  assert.deepEqual(config({ ...emulatorEnv, PAYMENT_PROVIDER: 'none' }).payments, CLOSED, 'the emulator');
  for (const mode of ['staging', 'production']) assert.deepEqual(config({ ...cloudEnv(mode), PAYMENT_PROVIDER: 'none' }).payments, CLOSED, mode);
  // provider variables left in the environment are ignored: nothing a gateway could be built from comes out of config
  const leftovers = { WEBHOOK_SECRET_FAKE: 'c3'.repeat(32), FAKE_PAYMENTS_ACK: 'no-real-money', STRIPE_SECRET_KEY: `sk_live_${'a1b2c3d4'.repeat(3)}`, WEBHOOK_SECRET_STRIPE: `whsec_${'z9y8x7w6'.repeat(3)}`,
    STRIPE_PRICE_STARTER: 'price_1Starter00', STRIPE_PRICE_FAMILY: 'price_1Family000', STRIPE_PRICE_BIG: 'price_1BigFam000' };
  assert.deepEqual(config({ ...cloudEnv('production'), PAYMENT_PROVIDER: 'none', ...leftovers }).payments, CLOSED);
  // the refusals of fake and stripe are unchanged
  const prod = cloudEnv('production'), stripe = { PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: `sk_test_${'a1b2c3d4'.repeat(3)}`, WEBHOOK_SECRET_STRIPE: `whsec_${'z9y8x7w6'.repeat(3)}`,
    STRIPE_PRICE_STARTER: 'price_1Starter00', STRIPE_PRICE_FAMILY: 'price_1Family000', STRIPE_PRICE_BIG: 'price_1BigFam000' };
  assert.throws(() => config({ ...prod, PAYMENT_PROVIDER: 'fake', WEBHOOK_SECRET_FAKE: 'c3'.repeat(32) }), /FAKE_PAYMENTS_ACK=no-real-money/);
  assert.equal(config({ ...prod, PAYMENT_PROVIDER: 'fake', WEBHOOK_SECRET_FAKE: 'c3'.repeat(32), FAKE_PAYMENTS_ACK: 'no-real-money' }).payments.provider, 'fake', 'acknowledged, as before');
  assert.throws(() => config({ ...prod, PAYMENT_PROVIDER: 'fake', FAKE_PAYMENTS_ACK: 'no-real-money' }), /WEBHOOK_SECRET_FAKE/);
  assert.throws(() => config({ ...prod, ...stripe }), /live Stripe key/);
  assert.throws(() => config({ ...cloudEnv('staging'), ...stripe, STRIPE_SECRET_KEY: `sk_live_${'a1b2c3d4'.repeat(3)}` }), /only for production/);
  assert.throws(() => config({ ...cloudEnv('staging'), ...stripe, STRIPE_PRICE_BIG: undefined }), /STRIPE_PRICE_BIG/);
  assert.equal(config({ ...cloudEnv('staging'), ...stripe }).payments.stripe.prices.big, 'price_1BigFam000', 'stripe in staging, as before');
  for (const bad of [undefined, '', 'xendit', 'NONE', 'None', 'off']) assert.throws(() => config({ ...prod, PAYMENT_PROVIDER: bad }), /PAYMENT_PROVIDER must be "fake", "stripe" or "none"/, String(bad));
  assert.equal(config({ ...emulatorEnv, WEBHOOK_SECRET_FAKE: 'c3'.repeat(32) }).payments.provider, 'fake', 'the emulator still defaults to the fake provider');
});

test('config: FIREBASE_AUTH_DOMAIN names the domain sign-in runs through; unset, the project\'s own firebaseapp.com host as before; anything but a bare host name is refused; the page reads it from /api/config', async (t) => {
  const live = { ...cloudEnv('production'), PAYMENT_PROVIDER: 'none' };
  assert.equal(config(live).web.authDomain, 'automathtics-live.firebaseapp.com', 'unset: as before');
  assert.equal(config({ ...live, FIREBASE_AUTH_DOMAIN: '' }).web.authDomain, 'automathtics-live.firebaseapp.com', 'empty is unset');
  assert.equal(config({ ...emulatorEnv, PAYMENT_PROVIDER: 'none' }).web.authDomain, 'demo-am-foundation.firebaseapp.com');
  for (const good of ['automathtics.net', 'auth.automathtics.net', 'automathtics-live.firebaseapp.com', 'a1-b2.example.co.id', 'localhost']) assert.equal(config({ ...live, FIREBASE_AUTH_DOMAIN: good }).web.authDomain, good, good);
  for (const bad of ['https://automathtics.net', 'automathtics.net/', 'automathtics.net:443', 'automathtics.net/__/auth', 'Automathtics.net', 'automathtics.net.', '.automathtics.net',
    'automathtics..net', '-automathtics.net', 'automathtics-.net', 'auto mathtics.net', 'automathtics.net,evil.example', 'user@automathtics.net', '*.automathtics.net', `${'a'.repeat(64)}.net`, ' automathtics.net'])
    assert.throws(() => config({ ...live, FIREBASE_AUTH_DOMAIN: bad }), /FIREBASE_AUTH_DOMAIN must be a bare host name/, bad);
  // the page takes it where it takes the api key and app id (/api/config, which public/auth.js reads), and the CSP frames that domain's handler
  const cfg = config({ ...live, FIREBASE_AUTH_DOMAIN: 'automathtics.net' }), f = fixture({ provider: 'none' });
  const app = createApp(f.service, cfg, { billing: f.billing, payments: f.payments }); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const res = await fetch(`http://127.0.0.1:${app.address().port}/api/config`);
  assert.deepEqual((await res.json()).firebase, { apiKey: 'AIzaSyLive', appId: '1:2:web:3', projectId: 'automathtics-live', authDomain: 'automathtics.net' });
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /frame-src [^;]*https:\/\/automathtics\.net\/__\/auth\//); assert.ok(!csp.includes('firebaseapp.com'), 'no project host is framed when another domain is named');
  const client = await readFile(new URL('../public/auth.js', import.meta.url), 'utf8'), page = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(client.includes("fetch('/api/config'"), 'the client asks the server'); assert.ok(!/firebaseapp\.com/.test(client + page), 'and hard-codes no auth domain');
});

test('a closed payment service has no gateway: one handed to it, or a billing view that disagrees, is refused at startup', () => {
  const f = fixture(), closedBilling = new Subscriptions({ foundation: f.service, store: f.store, paymentsOpen: false });
  assert.throws(() => new Payments({ foundation: f.service, store: f.store, billing: closedBilling, provider: 'none', gateways: { fake: new FakeGateway({ secret: webhookSecret }) } }), /no gateway may be configured/);
  assert.throws(() => new Payments({ foundation: f.service, store: f.store, billing: f.billing, provider: 'none', gateways: {} }), /disagree/, 'the billing view would list plans this refuses');
  assert.throws(() => new Payments({ foundation: f.service, store: f.store, billing: closedBilling, provider: 'fake', gateways: { fake: f.gateway } }), /disagree/);
  const p = new Payments({ foundation: f.service, store: f.store, billing: closedBilling, provider: 'none' });
  assert.equal(p.open, false); assert.deepEqual(Object.keys(p.gateways), []); assert.ok(Object.isFrozen(p.gateways), 'and none can be added later');
  assert.equal(new Subscriptions({ store: f.store, paymentsOpen: 'no' }).paymentsOpen, false, 'only an explicit true is open');
  assert.equal(new Subscriptions({ store: f.store }).paymentsOpen, true, 'unsaid: open, as every existing construction');
  const g = fixture({ provider: 'none' });
  assert.deepEqual([g.gateway, g.payments.open, g.billing.paymentsOpen, g.leaving.paymentsOpen], [null, false, false, false]);
  assert.deepEqual([f.payments.open, f.billing.paymentsOpen, f.leaving.paymentsOpen], [true, true, true]);
});

test('HTTP: every parent action that would reach a provider or make a plan paid answers 409 PAYMENTS_NOT_OPEN and writes nothing', async (t) => {
  const s = await server(t), f = s.f;
  const trial = await f.family('parentT', 0); await f.billing.startTrial(trial.ctx, op()); // a free trial: a checkout would start from here
  const paid = await paidFamily(f, 'parentP', 'family'), kid = (await f.child(paid.ctx, 'Fox')).child;
  const T = await s.as(trial), P = await s.as(paid);
  const refusals = [
    [T, '/api/billing/checkout', { plan: 'starter', ...op() }], [P, '/api/billing/checkout', { plan: 'big', ...op() }],
    [P, '/api/billing/checkout', { plan: 'nonsense' }], // refused before the body is even read
    [P, '/api/billing/plan', { plan: 'big', ...op() }], [P, '/api/billing/plan', { plan: 'starter', seatChildIds: [kid.id], ...op() }],
    [P, '/api/billing/plan', { plan: 'family', ...op() }], [T, '/api/billing/plan', { plan: 'starter', ...op() }],
    [P, '/api/billing/pause', { months: 2, ...op() }], [P, '/api/billing/resume', op()],
    [P, '/api/billing/cancel', op()], [P, '/api/billing/cancel', { undo: true, ...op() }],
    [P, '/api/leaving', { reason: 'taking_a_break', action: 'pause', months: 1, ...op() }],
    [P, '/api/leaving', { reason: 'taking_a_break', action: 'pause', months: 1, offerAccepted: 'pause', ...op() }],
    [P, '/api/leaving', { reason: 'too_expensive', action: 'downgrade', plan: 'starter', ...op() }],
    [T, '/api/leaving', { reason: 'too_expensive', action: 'downgrade', plan: 'starter', offerAccepted: 'downgrade', ...op() }],
    [P, '/api/leaving', { reason: 'lost_interest', action: 'cancel', ...op() }],
  ];
  for (const [call, path, body] of refusals) {
    const before = snapshot(f), r = await call(path, body);
    assert.deepEqual([r.status, r.body], [409, { error: 'PAYMENTS_NOT_OPEN' }], `${path} ${JSON.stringify(body)}`);
    assert.equal(snapshot(f), before, `${path} ${JSON.stringify(body)}: nothing written`);
  }
  for (const collection of ['checkouts', 'billingChangeIntents', 'billingCustomers', 'billingEvents']) assert.deepEqual(await f.store.list(collection), [], `no ${collection}`);
  const sub = (await f.store.get(`families/${paid.familyId}`)).subscription;
  assert.deepEqual([sub.plan, sub.pause, sub.scheduled, sub.cancelAtPeriodEnd], ['family', null, null, false], 'the paid plan on the record is as the operator left it');
  assert.deepEqual(await f.store.entries(`families/${paid.familyId}/leaving`), [], 'no leaving record claims what was refused');
});

test('HTTP: the webhook route does not exist while payments are not open, whatever is sent, and nothing is recorded', async (t) => {
  const s = await server(t), f = s.f;
  const raw = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.completed', at: f.now(), customer: 'cus_x', data: { price: 'price_fake_big', periodEnd: f.now() + 30 * DAY, checkoutId: 'co_1' } }));
  const signed = { 'Content-Type': 'application/json', 'X-Webhook-Signature': signWebhook(webhookSecret, raw, f.now()) }, before = snapshot(f);
  for (const provider of ['fake', 'stripe', 'none', 'xendit']) {
    for (const [method, headers, body] of [['POST', signed, raw], ['POST', { 'Content-Type': 'text/plain' }, 'x'], ['POST', {}, undefined], ['GET', {}, undefined], ['PUT', signed, raw]]) {
      const r = await fetch(`${s.base}/api/webhooks/${provider}`, { method, headers, ...(body === undefined ? {} : { body }) });
      assert.deepEqual([r.status, await r.json()], [404, { error: 'NOT_FOUND' }], `${method} /api/webhooks/${provider}`);
    }
  }
  assert.equal(snapshot(f), before); assert.deepEqual(await f.store.list('billingEvents'), []);
  await assert.rejects(f.payments.receive('fake', raw, { 'x-webhook-signature': signed['X-Webhook-Signature'] }), rejected('NOT_FOUND'), 'and the service has no gateway to verify one with');
  const open = await server(t, { provider: 'fake' });
  assert.equal((await fetch(`${open.base}/api/webhooks/fake`, { method: 'GET' })).status, 405, 'open: the route is there, as before');
});

test('the billing view says whether payments are open, and lists no plan while they are not', async (t) => {
  const open = fixture(), a = await open.family('parentA', 0), v = await open.billing.view(a.ctx);
  assert.deepEqual([v.payments, v.plans.map((p) => p.id)], [{ open: true }, ['starter', 'family', 'big']]);
  const s = await server(t), b = await s.f.family('parentB', 0), r = await (await s.as(b))('/api/billing');
  assert.equal(r.status, 200); assert.deepEqual([r.body.payments, r.body.plans, r.body.customer], [{ open: false }, [], null]);
  assert.equal(r.body.trial.eligible, true, 'the free trial is still there to start');
  assert.deepEqual(await s.f.billing.view(b.ctx), r.body, 'the route is the view');
});

test('HTTP: the free trial (the opening one included), its cancellation, seats, the export and both deletions work as ever while payments are not open', async (t) => {
  const s = await server(t, { at: Date.parse('2026-09-19T03:00:00Z') }), f = s.f; // 10:00 WIB on the day the doors open
  const a = await f.family('parentA', 0), A = await s.as(a);
  const started = await A('/api/billing/trial', op());
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.deepEqual([started.body.state, started.body.entitlement.seatLimit, started.body.entitlement.accessUntil, started.body.entitlement.planName], ['trial', 4, OPENING.endsAt, 'Opening free trial']);
  await f.child(a.ctx, 'Fox'); await f.child(a.ctx, 'Owl');
  const seats = await A('/api/billing/seats', { childIds: (await f.store.get(`families/${a.familyId}`)).activeChildIds, ...op() });
  assert.equal(seats.status, 200, JSON.stringify(seats.body)); assert.equal(seats.body.activeChildIds.length, 2);
  const cancelled = await A('/api/billing/cancel', op());
  assert.deepEqual([cancelled.status, cancelled.body.entitlement?.cancelAtPeriodEnd], [200, true], JSON.stringify(cancelled.body));
  const kept = await A('/api/billing/cancel', { undo: true, ...op() });
  assert.deepEqual([kept.status, kept.body.entitlement?.cancelAtPeriodEnd], [200, false]);
  const viaFlow = await A('/api/leaving', { reason: 'lost_interest', action: 'cancel', ...op() }); // the leaving flow cancels a trial through the same route
  assert.deepEqual([viaFlow.status, viaFlow.body.action, viaFlow.body.outcome], [200, 'cancel', 'done'], JSON.stringify(viaFlow.body));
  assert.equal((await f.store.get(`families/${a.familyId}`)).subscription.cancelAtPeriodEnd, true);
  const exported = await A('/api/family/export');
  assert.deepEqual([exported.status, exported.body.family.id, exported.body.subscription.plan], [200, a.familyId, 'trial']);
  const asked = await A('/api/family/deletion', op()); assert.deepEqual([asked.status, asked.body.pending], [200, true]);
  const takenBack = await A('/api/family/deletion/cancel', op()); assert.deepEqual([takenBack.status, takenBack.body.pending], [200, false]);
  const lone = await f.login('parentNoFamily'), gone = await (await s.as(lone))('/api/account/deletion', op());
  assert.deepEqual([gone.status, gone.body.deleted], [200, true]); assert.ok(f.auth.deleted.includes('parentNoFamily'));
});

test('the leaving flow offers nothing a provider would carry out while payments are not open: no pause, no smaller plan, no fewer seats', async () => {
  const rules = { state: 'active', plan: 'big', cadence: 'weekly', seatedChildren: 2, now: Date.parse('2026-09-20T00:00:00Z') };
  for (const reason of ['taking_a_break', 'not_using', 'too_expensive']) {
    assert.ok(offersFor({ ...rules, reason }).offers.length > 0, `open: ${reason} has offers`);
    assert.deepEqual(offersFor({ ...rules, reason, paymentsOpen: false }).offers, [], `closed: ${reason}`);
  }
  assert.deepEqual(offersFor({ ...rules, reason: 'too_many_emails', paymentsOpen: false }).offers.map((o) => o.kind), ['email_monthly', 'email_off'], 'the email offers need no provider');
  assert.deepEqual(offersFor({ ...rules, reason: 'technical', paymentsOpen: false }).offers.map((o) => o.kind), ['feedback']);
  // through the service, for a family whose record says it pays and for one on a free trial
  const f = fixture({ provider: 'none' }), paid = await paidFamily(f, 'parentP', 'big'), trial = await f.family('parentT', 0); await f.billing.startTrial(trial.ctx, op());
  for (const [who, reason] of [[paid, 'taking_a_break'], [paid, 'not_using'], [paid, 'too_expensive'], [trial, 'taking_a_break'], [trial, 'too_expensive']]) {
    const r = await f.leaving.offers(who.ctx, { reason });
    assert.deepEqual([r.offers, r.payments], [[], { open: false }], reason);
  }
  assert.deepEqual((await f.leaving.offers(paid.ctx, { reason: 'too_many_emails' })).offers.map((o) => o.kind), ['email_monthly', 'email_off']);
  const g = fixture(), gp = await paidFamily(g, 'parentG', 'big'), pause = await g.leaving.offers(gp.ctx, { reason: 'taking_a_break' });
  assert.deepEqual([pause.offers.map((o) => o.kind), pause.payments], [['pause'], { open: true }], 'open, the pause is offered as before');
  // asking for one anyway is refused before anything is written, whatever the browser says was offered
  for (const body of [{ reason: 'taking_a_break', action: 'pause', months: 2, offerAccepted: 'pause' }, { reason: 'too_expensive', action: 'downgrade', plan: 'family', offerAccepted: 'downgrade' },
    { reason: 'too_expensive', action: 'downgrade', plan: 'starter', offerAccepted: 'seats' }, { reason: 'something_else', action: 'pause', months: 3 }]) {
    const before = snapshot(f);
    await assert.rejects(f.leaving.submit(paid.ctx, { ...body, ...op() }), rejected('PAYMENTS_NOT_OPEN'), JSON.stringify(body));
    assert.equal(snapshot(f), before);
  }
  await assert.rejects(f.leaving.submit(paid.ctx, { reason: 'lost_interest', action: 'cancel', ...op() }), rejected('PAYMENTS_NOT_OPEN'), 'a paid plan is not cancelled here either');
  assert.deepEqual(await f.store.entries(`families/${paid.familyId}/leaving`), []);
  const kept = await f.leaving.submit(paid.ctx, { reason: 'too_many_emails', action: 'reduce_email', cadence: 'monthly', offerAccepted: 'email_monthly', ...op() });
  assert.deepEqual([kept.action, kept.outcome], ['reduce_email', 'done'], 'what needs no provider still happens');
});

test('a deletion while payments are not open asks no provider anything and records not_applicable: a trial, a paid plan on the record, and one a provider left behind', async () => {
  const f = fixture({ provider: 'none' });
  const trial = await f.family('parentT', 0); await f.billing.startTrial(trial.ctx, op());
  const paid = await paidFamily(f, 'parentP', 'family');
  // a Stripe subscription and a superseded hosted session from before this project stopped taking payments: still nothing is asked
  const left = await paidFamily(f, 'parentS', 'big'), doc = await f.store.get(`families/${left.familyId}`);
  await f.store.put(`families/${left.familyId}`, { ...doc, billing: { stripe: 'cus_left' }, providerCustomer: { stripe: 'cus_Stripe1' }, subscription: { ...doc.subscription, provider: 'stripe', providerSubscriptionRef: 'sub_left' } });
  await f.store.put('checkouts/stripe:co-left', { provider: 'stripe', checkoutId: 'co-left', familyId: left.familyId, customerRef: 'cus_left', plan: 'big', status: 'superseded', providerCheckoutRef: 'cs_left', createdAt: f.now() });
  for (const [who, provider] of [[trial, 'trial'], [paid, 'manual'], [left, 'stripe']]) {
    await f.support.requestDeletion(who.ctx, op());
    const record = await f.support.executeDeletion(who.familyId, { operator: 'ops@example.test', force: true });
    assert.deepEqual([record.providerCancellation.provider, record.providerCancellation.status], [provider, 'not_applicable'], provider);
    const tomb = await f.store.get(`families/${who.familyId}`);
    assert.deepEqual([tomb.deleted, tomb.subscription.state], [true, 'cancelled'], `${provider}: deleted, and the subscription ended as a recorded event`);
  }
  assert.deepEqual([(await f.store.get('checkouts/stripe:co-left')).expiredByDeletion.expired, (await f.store.get('checkouts/stripe:co-left')).expiredByDeletion.reason], [false, 'PROVIDER_NOT_CONFIGURED'], 'the session is named for the operator, never asked about');
  assert.deepEqual(Object.keys(f.payments.gateways), [], 'there was never a gateway to call');
  // the nightly sweep runs the same way and names what the operator must still settle at the provider by hand
  const sweep = await f.support.inspectAll({ operator: 'scheduler@automathtics-live' });
  assert.ok(sweep.findings.some((x) => x.code === 'DELETED_FAMILY_PROVIDER_LIVE' && x.family === left.familyId), JSON.stringify(sweep.findings));
});

test('operator reprocessing has no gateway to go through while payments are not open: refused before any operation is recorded; the reads still work', async () => {
  const f = fixture({ provider: 'none' }), a = await paidFamily(f, 'parentP', 'family'), before = snapshot(f);
  await assert.rejects(f.support.reprocess(a.familyId, 'ops@example.test'), rejected('PAYMENTS_NOT_OPEN'));
  assert.equal(snapshot(f), before); assert.deepEqual(await f.store.list('supportOperations'), []);
  assert.equal((await f.support.familyReport(a.familyId)).subscription.state, 'active');
  const check = await f.support.reconcileProvider(a.familyId, 'ops@example.test');
  assert.deepEqual([check.providers, check.match], [[], null], 'no provider to ask, and no verdict pretended');
});

const execFileP = promisify(execFile);
const SUPPORT = fileURLToPath(new URL('../scripts/support.mjs', import.meta.url)), DASHBOARD = fileURLToPath(new URL('../scripts/dashboard.mjs', import.meta.url));
// The unit job installs nothing before npm test (secure-foundation.yml), so firebase-admin resolves to a stand-in that builds nothing. What
// is under test is the tools' own construction of the server's services, which calls nothing in the SDK before the usage; the module hook
// sees every import, so the tools behave the same with or without an install.
const SDK_STAND_IN = `import { registerHooks } from 'node:module';
const stub = 'data:text/javascript,' + encodeURIComponent('export const initializeApp = () => ({}), applicationDefault = () => ({}), getAuth = () => ({}), getFirestore = () => ({}), Timestamp = { fromMillis: (ms) => ({ ms }) };');
registerHooks({ resolve(specifier, context, next) { return specifier === 'firebase-admin' || specifier.startsWith('firebase-admin/') ? { url: stub, shortCircuit: true } : next(specifier, context); } });
`;
const cliWith = (hook) => (script, env, args = []) => execFileP(process.execPath, ['--import', hook, script, ...args], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env }, timeout: 90_000 })
  .then((r) => ({ code: 0, err: String(r.stderr) }), (e) => ({ code: e.code, err: String(e.stderr) }));
test('the operator tools and the nightly sweep build their services with PAYMENT_PROVIDER=none: no provider secret asked for, no gateway built', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'am-closed-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const hookFile = join(dir, 'firebase-admin-stand-in.mjs'); await writeFile(hookFile, SDK_STAND_IN);
  const cli = cliWith(pathToFileURL(hookFile).href);
  const base = { APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-foundation', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088', SESSION_SECRET: secret, PIN_PEPPER: pepper };
  // support.mjs (the sweep job's command) builds every service before it reads its command: no command is a construction, then the usage
  const built = await cli(SUPPORT, { ...base, PAYMENT_PROVIDER: 'none' });
  assert.equal(built.code, 1); assert.match(built.err, /^Usage: node scripts\/support\.mjs family\|/m, built.err);
  // a closed Payments refuses any gateway it is handed, so a key left in the environment reaching one would be an error here, not the usage
  const leftover = await cli(SUPPORT, { ...base, PAYMENT_PROVIDER: 'none', WEBHOOK_SECRET_FAKE: 'c3'.repeat(32), STRIPE_SECRET_KEY: `sk_live_${'a1b2c3d4'.repeat(3)}` });
  assert.match(leftover.err, /^Usage: /m, leftover.err);
  assert.match((await cli(SUPPORT, base)).err, /Set WEBHOOK_SECRET_FAKE[^\n]*or PAYMENT_PROVIDER=none/, 'unsaid, a provider secret is still required, as before');
  assert.match((await cli(SUPPORT, { ...base, PAYMENT_PROVIDER: 'xendit' })).err, /PAYMENT_PROVIDER must be fake, stripe or none/);
  assert.match((await cli(SUPPORT, { ...base, WEBHOOK_SECRET_FAKE: 'c3'.repeat(32) })).err, /^Usage: /m, 'the fake provider builds as before');
  // the dashboard reads no payment state: with none it needs no provider secret (its options are read next, before any SDK loads)
  const dash = await cli(DASHBOARD, { ...base, PAYMENT_PROVIDER: 'none' }, ['--bogus', 'x']);
  assert.equal(dash.code, 1); assert.match(dash.err, /Usage: node scripts\/dashboard\.mjs/, dash.err);
  assert.match((await cli(DASHBOARD, base, ['--bogus', 'x'])).err, /Set WEBHOOK_SECRET_FAKE/);
  const src = await readFile(SUPPORT, 'utf8');
  for (const s of ["if (provider !== 'none' && /^[a-f0-9]{64,}$/.test(webhookSecret || '')) gateways.fake", "if (provider !== 'none' && stripeKey) gateways.stripe", "paymentsOpen: provider !== 'none'", 'new Payments({ foundation: service, store, billing, provider, gateways })']) assert.ok(src.includes(s), s);
  const report = await readFile(new URL('../scripts/report.mjs', import.meta.url), 'utf8');
  assert.ok(!/PAYMENT_PROVIDER|payments\.mjs|Gateway/.test(report), 'the weekly and leaving reports build no payment service, so none changes nothing there');
  const main = await readFile(new URL('../server/main.mjs', import.meta.url), 'utf8');
  for (const s of ["paymentsOpen: cfg.payments.provider !== 'none'", 'if (cfg.payments.webhookSecrets.fake) gateways.fake', 'if (cfg.payments.stripe) gateways.stripe']) assert.ok(main.includes(s), `main.mjs: ${s}`);
});
