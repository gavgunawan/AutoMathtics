// Stage 4 review, third round — the door: every address budget also spent on a key the caller cannot forge; a token
// without a valid signature refused before any work; the recovery forms doing the same work for every email; an
// identity outage answered as an outage, never as "no account".
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fixture, rejected, secret } from './support.mjs';
import { createApp } from '../server/http.mjs';
import { RECOVERY_WAIT_MS } from '../server/recovery.mjs';

async function serve(t, f) {
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: true, proxyHops: 2, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg, { recovery: f.recovery, peerFactor: 2 }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, bootstrap = await fetch(`${base}/api/bootstrap`);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0], { csrf } = await bootstrap.json();
  const post = (path, data, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: cfg.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  return { base, post };
}

test('an address budget is spent on the peer too: a caller who forges the client entry runs into the peer\'s wall, without any work; a signed token still signs in', async (t) => {
  const f = fixture(); await f.family('parentA', 0); const { post } = await serve(t, f);
  // straight at the service, one Google hop: the chain is [forged, peer]; with hops measured through Hosting (2) the forged entry would be the client key
  const attempt = (n) => post('/api/auth/session', { idToken: `not-a-token-at-all-${n}-${'x'.repeat(24)}` }, { 'X-Forwarded-For': `203.0.113.${n % 250}, 10.0.0.9` });
  const statuses = []; for (let n = 1; n <= 61; n++) statuses.push((await attempt(n)).status);
  assert.ok(statuses.slice(0, 60).every((s) => s === 401), 'sixty forged clients, sixty refusals: 30 per client, times the peer factor of 2, on the peer');
  assert.equal(statuses[60], 429, 'the sixty-first is refused on the peer\'s budget whatever client it claims to be');
  const lookups = f.auth.getUserCalls, buckets = (await f.store.list('rateLimits')).length;
  assert.equal((await attempt(62)).status, 429); assert.equal(f.auth.getUserCalls, lookups, 'a refused attempt asks the provider nothing'); assert.equal((await f.store.list('rateLimits')).length, buckets, 'and writes no bucket');
  const ok = await post('/api/auth/session', { idToken: f.token('parentA') }, { 'X-Forwarded-For': '203.0.113.7, 10.0.0.9' }); assert.equal(ok.status, 200, 'a validly signed token is never refused for its address');
  // the recovery forms have the same second wall, and a cap for the whole instance
  const start = (n) => post('/api/auth/recovery/start', { email: `p${n}@example.test` }, { 'X-Forwarded-For': `203.0.113.${n % 250}, 10.0.0.10` });
  const rs = []; for (let n = 1; n <= 41; n++) rs.push((await start(n)).status);
  assert.ok(rs.slice(0, 40).every((s) => s === 200)); assert.equal(rs[40], 429, '20 per client, times 2, on the peer');
});
test('the recovery forms do the same work for any email: the same transactions, reads and provider lookups whether or not an account exists', async () => {
  const f = fixture(); await f.family('parentA', 0);
  const counters = { tx: 0, get: 0 }, realTx = f.store.transaction.bind(f.store), realGet = f.store.get.bind(f.store);
  f.store.transaction = (fn, opts) => { counters.tx++; return realTx(async (tx) => { const g = tx.get.bind(tx); tx.get = (p) => { counters.get++; return g(p); }; return fn(tx); }, opts); };
  f.store.get = (p) => { counters.get++; return realGet(p); };
  const measure = async (fn) => { counters.tx = 0; counters.get = 0; const calls = f.auth.getUserCalls; const answer = await fn(); return { answer, tx: counters.tx, get: counters.get, provider: f.auth.getUserCalls - calls }; };
  const known = await measure(() => f.recovery.start({ email: 'parentA@example.test' })), unknown = await measure(() => f.recovery.start({ email: 'stranger@example.test' }));
  assert.deepEqual(unknown, known, 'asking'); assert.ok(known.tx >= 1 && known.get >= 3);
  assert.equal((await f.store.get('recoveries/parentA')).status, 'pending'); assert.equal((await f.store.list('recoveries')).length, 1, 'nothing is written for the stranger');
  // completing: a real request not yet ready, versus no account at all
  f.resetPassword('parentA'); f.advance(1000);
  const knownC = await measure(() => f.recovery.complete({ email: 'parentA@example.test' })), unknownC = await measure(() => f.recovery.complete({ email: 'stranger@example.test' }));
  assert.deepEqual(unknownC, knownC, 'completing'); assert.equal(knownC.provider, 1, 'one fresh provider lookup each');
  // and a completed request — nothing open — against no account
  f.advance(RECOVERY_WAIT_MS + 1000); assert.deepEqual((await f.recovery.complete({ email: 'parentA@example.test' })).completed, true);
  const done = await measure(() => f.recovery.complete({ email: 'parentA@example.test' })), none = await measure(() => f.recovery.complete({ email: 'stranger@example.test' }));
  assert.deepEqual(none, done, 'nothing open looks like no account');
});
test('an identity outage is answered as an outage, the same for every email — never as "no account"', async () => {
  const f = fixture(); await f.family('parentA', 0);
  const outage = () => Object.assign(Error('deadline exceeded'), { code: 'auth/internal-error' });
  for (const email of ['parentA@example.test', 'stranger@example.test']) { f.auth.failLookup = outage(); await assert.rejects(f.recovery.start({ email }), rejected('IDENTITY_UNAVAILABLE')); }
  f.auth.failLookup = outage(); await assert.rejects(f.recovery.complete({ email: 'parentA@example.test' }), rejected('IDENTITY_UNAVAILABLE'));
  assert.equal(await f.store.get('recoveries/parentA'), null, 'nothing was recorded during the outage');
  assert.deepEqual(await f.recovery.start({ email: 'parentA@example.test' }), { accepted: true, readyAt: f.now() + RECOVERY_WAIT_MS }, 'the ceremony starts normally once the provider answers');
  assert.equal((await f.store.get('recoveries/parentA')).status, 'pending');
});
