import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/http.mjs';
import { fixture, secret } from './support.mjs';

async function serverTest(t, { secure = false } = {}) {
  const f = fixture();
  const cfg = { origin: 'https://pilot.example.test', secret, emulator: !secure, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } };
  const server = createApp(f.service, cfg);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await fetch(`${base}/api/bootstrap`);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const { csrf } = await bootstrap.json();
  const headers = { Cookie: cookie, Origin: cfg.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
  const call = (path, data, more = {}) => fetch(`${base}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...headers, ...more }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { f, cfg, base, headers, call, bootstrap };
}
test('cookie and HTTP security headers are set; no cross-origin read permission', async (t) => {
  const s = await serverTest(t, { secure: true });
  const c = s.bootstrap.headers.get('set-cookie');
  for (const required of ['__session=', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(c.includes(required));
  assert.ok(s.bootstrap.headers.get('cache-control').includes('no-store'));
  assert.equal(s.bootstrap.headers.get('access-control-allow-origin'), null);
  assert.equal(s.bootstrap.headers.get('x-frame-options'), 'DENY');
  assert.ok(s.bootstrap.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
});
test('login rejects missing Origin, cross-site Origin and missing/incorrect CSRF', async (t) => {
  const s = await serverTest(t), body = { idToken: s.f.token('parentA') };
  for (const more of [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'wrong' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const r = await s.call('/api/auth/session', body, more); assert.equal(r.status, 403);
  }
});
test('login rotates the session and accepts only the opaque server cookie afterward', async (t) => {
  const s = await serverTest(t);
  const login = await s.call('/api/auth/session', { idToken: s.f.token('parentA') });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie, s.headers.Cookie);
  const me = await s.call('/api/me', undefined, { Cookie: cookie });
  assert.equal((await me.json()).role, 'parent');
  assert.equal((await fetch(`${s.base}/api/me`, { headers: { Authorization: `Bearer ${s.f.token('parentA')}` } })).status, 401);
});
test('forged verified flags and invalid token cannot create a session', async (t) => {
  const s = await serverTest(t);
  assert.equal((await s.call('/api/auth/session', { idToken: s.f.token('parentA'), emailVerified: true })).status, 400);
  assert.equal((await s.call('/api/auth/session', { idToken: 'not-a-real-token-000000000000' })).status, 401);
});
test('reject non-JSON, malformed JSON, compressed input and oversized bodies', async (t) => {
  const s = await serverTest(t);
  assert.equal((await s.call('/api/auth/session', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await s.call('/api/auth/session', {}, { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal((await fetch(`${s.base}/api/auth/session`, { method: 'POST', headers: s.headers, body: '{' })).status, 400);
  assert.equal((await s.call('/api/auth/session', { idToken: 'x'.repeat(17000) })).status, 413);
});
test('static server never exposes source, environment or legacy application', async (t) => {
  const s = await serverTest(t);
  for (const path of ['/server/main.mjs', '/.env', '/package.json', '/index.html', '/src/automathtics-src.jsx']) assert.equal((await fetch(s.base + path)).status, 404);
  const home = await fetch(s.base + '/'); assert.equal(home.status, 200);
  assert.ok((await home.text()).includes('Family access'));
});
test('parent cannot call child endpoint, and there is no entitlement/admin write endpoint', async (t) => {
  const s = await serverTest(t), a = await s.f.family();
  const cookie = `__session=${a.cookie}`, csrf = (await s.f.service.me(a.ctx)).csrf;
  assert.equal((await s.call('/api/child/profile', undefined, { Cookie: cookie })).status, 403);
  for (const path of ['/api/admin', '/api/entitlement', '/api/children/delete']) {
    assert.equal((await s.call(path, {}, { Cookie: cookie, 'X-CSRF-Token': csrf })).status, 404);
  }
});
test('HTTP handover actually prevents writes from an old parent tab', async (t) => {
  const s = await serverTest(t), a = await s.f.family('parentA', 2);
  const headers = { Cookie: `__session=${a.cookie}`, 'X-CSRF-Token': (await s.f.service.me(a.ctx)).csrf };
  assert.equal((await s.call('/api/session/lock', {}, headers)).status, 200);
  const r = await s.call('/api/children', { nickname: 'Other', icon: 'fox', pin: '763829' }, { ...headers, 'Idempotency-Key': '6389f688-87d9-44bc-8a54-ddbc3c328be7' });
  assert.equal(r.status, 403); assert.equal((await r.json()).error, 'CSRF_DENIED');
});
