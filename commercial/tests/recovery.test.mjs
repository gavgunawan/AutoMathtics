// Stage 4.4 — the lost-phone recovery ceremony (RECOVERY.md): the uniform answer, the proof gate,
// the waiting gate, what completion changes and what it never touches, cancel-on-sign-in and its
// notice, the operator's single verb, the provider fault, the lapse, and the routes before any session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, secret } from './support.mjs';
import { createApp } from '../server/http.mjs';
import { Support } from '../server/support.mjs';
import { RECOVERY_WAIT_MS, RECOVERY_WINDOW_MS } from '../server/recovery.mjs';

const DAY = 86_400_000, op = () => ({ operationId: randomUUID() }), OPERATOR = 'ops@example.test';
const email = (uid) => `${uid}@example.test`;
const audits = async (f, action) => (await f.store.list('audit')).filter((x) => x.action === action);

test('asking: the same answer for any email; one live request per account whose date never moves earlier; a budget per email', async () => {
  const f = fixture(), a = await f.family('parentA', 0);
  const r = await f.recovery.start({ email: email('parentA') });
  assert.deepEqual(r, { accepted: true, readyAt: f.now() + RECOVERY_WAIT_MS });
  const rec = await f.store.get('recoveries/parentA');
  assert.equal(rec.status, 'pending'); assert.equal(rec.mfaUid, 'mfa-parentA'); assert.equal(rec.snapshot.validAfter, 0); assert.equal(rec.proof, null); assert.ok(rec.expireAt > rec.readyAt + RECOVERY_WINDOW_MS);
  assert.ok((await audits(f, 'parent.recovery_requested')).some((x) => x.uid === 'parentA' && x.familyId === a.familyId));
  f.advance(DAY); assert.deepEqual(await f.recovery.start({ email: 'ParentA@Example.test' }), r, 'asking again returns the same date, whatever the case of the address');
  assert.deepEqual(await f.recovery.start({ email: 'nobody@example.test' }), { accepted: true, readyAt: f.now() + RECOVERY_WAIT_MS }); assert.equal(await f.store.get('recoveries/nobody'), null);
  for (const bad of [{}, { email: 'not-an-email' }, { email: email('parentA'), extra: 1 }, { email: 42 }]) await assert.rejects(f.recovery.start(bad), rejected('INVALID_REQUEST'));
  f.token('parentZ'); f.users.get('parentZ').multiFactor = { enrolledFactors: [] }; // nothing to recover: same answer, no record
  assert.equal((await f.recovery.start({ email: email('parentZ') })).accepted, true); assert.equal(await f.store.get('recoveries/parentZ'), null);
  for (let i = 0; i < 3; i++) await f.recovery.start({ email: 'budget@example.test' });
  await assert.rejects(f.recovery.start({ email: 'budget@example.test' }), (e) => e.status === 429);
  assert.deepEqual(await f.recovery.complete({ email: 'nobody@example.test' }), { completed: false, reason: 'NOT_PENDING' });
  assert.deepEqual(await f.recovery.complete({ email: email('parentZ') }), { completed: false, reason: 'NOT_PENDING' });
});
test('completing: nothing before the password reset, nothing before the wait; then the factor goes, sessions end, old factors are refused, and the parent re-enrols a new mobile into the same family with no second trial', async () => {
  const f = fixture(), a = await f.family('parentA', 0); await f.billing.startTrial(a.ctx, op());
  const before = await f.store.get('parents/parentA'), l = await f.login('parentA');
  const { readyAt } = await f.recovery.start({ email: email('parentA') });
  assert.deepEqual(await f.recovery.complete({ email: email('parentA') }), { completed: false, reason: 'PROOF_REQUIRED', readyAt });
  f.resetPassword('parentA'); // the parent used the provider's emailed reset link
  assert.deepEqual(await f.recovery.complete({ email: email('parentA') }), { completed: false, reason: 'WAITING', readyAt });
  await f.family('parentB', 0); const b = await f.recovery.start({ email: email('parentB') });
  f.advance(RECOVERY_WAIT_MS + DAY);
  assert.deepEqual(await f.recovery.complete({ email: email('parentB') }), { completed: false, reason: 'PROOF_REQUIRED', readyAt: b.readyAt }, 'time alone proves nothing');
  assert.equal(f.auth.updates.length, 0, 'the provider has not been touched');
  assert.deepEqual(await f.recovery.complete({ email: email('parentA') }), { completed: true });
  assert.deepEqual(f.auth.updates, [['parentA', { multiFactor: { enrolledFactors: null } }]]); assert.equal(f.users.get('parentA').multiFactor.enrolledFactors.length, 0);
  const rec = await f.store.get('recoveries/parentA'); assert.equal(rec.status, 'completed'); assert.equal(rec.proof, 'tokens_revoked'); assert.equal(rec.completedAt, f.now());
  await assert.rejects(f.service.authenticate(l.cookie), 'every session of the account is gone'); await assert.rejects(f.service.me(a.ctx));
  assert.equal((await f.store.get('parents/parentA')).reauthAfter, Math.floor(f.now() / 1000), 'older tokens are dead');
  assert.ok((await audits(f, 'parent.recovery_completed')).some((x) => x.uid === 'parentA' && x.familyId === a.familyId));
  await assert.rejects(f.service.login(f.token('parentA')), rejected('VERIFY_MOBILE_WITH_MFA'), 'a token naming the removed factor is refused: a mobile must be verified again');
  assert.deepEqual(await f.recovery.complete({ email: email('parentA') }), { completed: false, reason: 'NOT_PENDING' }); assert.equal(f.auth.updates.length, 1);
  // the new mobile, the same family
  const mfa = f.enrollPhone('parentA', '+6581234567'); f.advance(2000);
  const cookie = await f.service.login(f.token('parentA', { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'phone', second_factor_identifier: mfa } }));
  const ctx = await f.service.authenticate(cookie), me = await f.service.me(ctx);
  assert.equal(me.family.id, a.familyId); assert.equal(me.recovery.status, 'completed'); assert.equal(me.recovery.acknowledgedAt, null);
  const after = await f.store.get('parents/parentA'); assert.equal(after.familyId, before.familyId); assert.notEqual(after.phoneKey, before.phoneKey, 'the phone key follows the number');
  assert.equal((await f.store.get(`families/${a.familyId}`)).phoneKey, before.phoneKey, 'the family keeps the key it was created with');
  await assert.rejects(f.billing.startTrial(ctx, op()), rejected('SUBSCRIPTION_EXISTS'), 'a new number is not a new trial for this family');
  await f.recovery.acknowledge(ctx); assert.ok((await f.service.me(ctx)).recovery.acknowledgedAt);
  const src = await readFile(new URL('../server/recovery.mjs', import.meta.url), 'utf8');
  assert.ok(!/families\/|children|members|subscription|ledger/.test(src.replace(/\/\/.*$/gm, '')), 'recovery changes how a parent signs in, never what they own');
});
test('a full sign-in during the wait cancels the request and leaves a notice; the operator can only cancel; a provider fault leaves the request pending; a request never completed lapses', async () => {
  const f = fixture(), a = await f.family('parentA', 0);
  await f.recovery.start({ email: email('parentA') }); f.resetPassword('parentA'); f.advance(2000);
  const l = await f.login('parentA'); // the owner still has the phone
  let rec = await f.store.get('recoveries/parentA'); assert.equal(rec.status, 'cancelled_by_sign_in'); assert.equal(rec.cancelledBy, 'parentA');
  assert.ok((await audits(f, 'parent.recovery_cancelled')).some((x) => x.uid === 'parentA'));
  let me = await f.service.me(l.ctx); assert.equal(me.recovery.status, 'cancelled_by_sign_in'); assert.equal(me.recovery.acknowledgedAt, null);
  f.advance(RECOVERY_WAIT_MS + DAY); assert.deepEqual(await f.recovery.complete({ email: email('parentA') }), { completed: false, reason: 'NOT_PENDING' }); assert.equal(f.auth.updates.length, 0);
  const l2 = await f.login('parentA'); await f.recovery.acknowledge(l2.ctx); assert.ok((await f.service.me(l2.ctx)).recovery.acknowledgedAt);
  f.advance(31 * DAY); assert.equal((await f.service.me((await f.login('parentA')).ctx)).recovery, null, 'an old notice is gone');
  // the operator: cancel, and nothing else
  await f.recovery.start({ email: email('parentA') });
  await assert.rejects(f.support.cancelRecovery('parentA', 'x', 'note'), rejected('OPERATOR_REQUIRED'));
  await assert.rejects(f.support.cancelRecovery('nobody', OPERATOR, 'note'), rejected('RECOVERY_NOT_FOUND'));
  await assert.rejects(f.support.cancelRecovery('parentA', OPERATOR, ''), rejected('INVALID_REQUEST'));
  let report = await f.support.familyReport(a.familyId); assert.deepEqual(report.attention.pendingRecoveries, ['parentA']);
  const c = await f.support.cancelRecovery('parentA', OPERATOR, 'Parent phoned: not them.'); assert.equal(c.status, 'cancelled_by_operator'); assert.equal(c.cancelledBy, OPERATOR);
  await assert.rejects(f.support.cancelRecovery('parentA', OPERATOR, 'again'), rejected('RECOVERY_NOT_PENDING'));
  assert.ok((await audits(f, 'support.recovery_cancelled')).some((x) => x.uid === OPERATOR && x.familyId === a.familyId));
  report = await f.support.familyReport(a.familyId); assert.equal(report.recoveries[0].status, 'cancelled_by_operator'); assert.deepEqual(report.attention.pendingRecoveries, []);
  assert.equal((await f.service.me((await f.login('parentA')).ctx)).recovery.status, 'cancelled_by_operator');
  for (const name of Object.getOwnPropertyNames(Support.prototype)) assert.doesNotMatch(name, /unenrol|factor|mfa|completeRecovery/i, name);
  const src = await readFile(new URL('../server/support.mjs', import.meta.url), 'utf8'); assert.ok(!/unenrollFactors|updateUser|multiFactor|lookupByEmail/.test(src), 'support never touches a second factor');
  // the provider failing at the one privileged step leaves the request pending for a retry
  await f.recovery.start({ email: email('parentA') }); f.resetPassword('parentA'); f.advance(RECOVERY_WAIT_MS + DAY);
  f.auth.failUpdate = Error('identity down');
  await assert.rejects(f.recovery.complete({ email: email('parentA') }), rejected('IDENTITY_UNAVAILABLE'));
  assert.equal((await f.store.get('recoveries/parentA')).status, 'pending');
  assert.deepEqual(await f.recovery.complete({ email: email('parentA') }), { completed: true });
  // a request never completed lapses; a new one starts a new clock
  const g = fixture(); await g.family('parentA', 0); const first = await g.recovery.start({ email: email('parentA') }); g.resetPassword('parentA');
  g.advance(RECOVERY_WAIT_MS + RECOVERY_WINDOW_MS + DAY);
  assert.deepEqual(await g.recovery.complete({ email: email('parentA') }), { completed: false, reason: 'NOT_PENDING' }); assert.equal((await g.store.get('recoveries/parentA')).status, 'expired');
  const second = await g.recovery.start({ email: email('parentA') }); assert.equal(second.readyAt, g.now() + RECOVERY_WAIT_MS); assert.notEqual(second.readyAt, first.readyAt);
});
test('the routes: recovery before any session with the pre-authentication CSRF token; the acknowledgement needs one; origin and CSRF still enforced; the answer never names an account', async (t) => {
  const f = fixture(); await f.family('parentA', 0);
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg, { recovery: f.recovery }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, bootstrap = await fetch(`${base}/api/bootstrap`);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0], { csrf } = await bootstrap.json();
  const headers = { Cookie: cookie, Origin: cfg.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
  const call = (path, data, more = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, ...more }, body: JSON.stringify(data) });
  let r = await call('/api/auth/recovery/start', { email: email('parentA') }); assert.equal(r.status, 200); assert.equal((await r.json()).accepted, true);
  r = await call('/api/auth/recovery/start', { email: 'stranger@example.test' }); assert.equal(r.status, 200); assert.equal((await r.json()).accepted, true);
  assert.equal((await call('/api/auth/recovery/start', { email: email('parentA') }, { 'X-CSRF-Token': 'nope' })).status, 403);
  assert.equal((await call('/api/auth/recovery/start', { email: email('parentA') }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/auth/recovery/start', { email: 'x' })).status, 400);
  r = await call('/api/auth/recovery/complete', { email: email('parentA') }); assert.equal(r.status, 200); assert.equal((await r.json()).reason, 'PROOF_REQUIRED');
  assert.equal((await call('/api/auth/recovery/ack', {})).status, 401, 'the acknowledgement needs a session');
  const login = await call('/api/auth/session', { idToken: f.token('parentA') }); assert.equal(login.status, 200);
  const session = login.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: session } })).json(); assert.equal(me.recovery.status, 'cancelled_by_sign_in');
  r = await fetch(`${base}/api/auth/recovery/ack`, { method: 'POST', headers: { Cookie: session, Origin: cfg.origin, 'X-CSRF-Token': me.csrf, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(r.status, 200);
  assert.ok((await f.store.get('recoveries/parentA')).acknowledgedAt);
});
