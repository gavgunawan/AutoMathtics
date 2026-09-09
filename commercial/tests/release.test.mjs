import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { VERSION } from '../server/version.mjs';
import { createApp } from '../server/http.mjs';
import { fixture, secret } from './support.mjs';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
test('v3.0 version agrees across manifest, page and backend', async () => {
  assert.equal(VERSION, '3.0.0');
  assert.equal(JSON.parse(await read('../package.json')).version, VERSION);
  assert.match(await read('../public/index.html'), /v3\.0 &middot; 6 Sep 2026/);
});
test('Hosting routes shell and API to the server, not the old static game', async () => {
  const cfg = JSON.parse(await read('../firebase.staging.json'));
  assert.equal(cfg.hosting.public, '.hosting');
  assert.deepEqual(cfg.hosting.rewrites, [{ source: '**', run: { serviceId: 'automathtics-v3', region: 'asia-southeast1' } }]);
  assert.equal(cfg.firestore.rules, 'firestore.rules');
});
test('live health endpoint identifies v3.0 without exposing private configuration', async (t) => {
  const f = fixture();
  const server = createApp(f.service, { origin: 'https://pilot.example.test', secret, emulator: false,
    web: { authDomain: 'demo-am-foundation.firebaseapp.com' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.deepEqual(await res.json(), { status: 'ok', version: VERSION });
  assert.match(res.headers.get('cache-control'), /no-store/);
  // the proxy-depth measurement (DEPLOY_V3.md §5): a count, and the leading entry only when it is a documentation address
  const probe = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, { headers: { 'X-Forwarded-For': '203.0.113.250, 198.51.100.7, 192.0.2.9' } });
  assert.deepEqual(await probe.json(), { status: 'ok', version: VERSION, forwarded: 3, leading: '203.0.113.250' });
  const real = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, { headers: { 'X-Forwarded-For': '8.8.8.8, 192.0.2.9' } });
  assert.deepEqual(await real.json(), { status: 'ok', version: VERSION, forwarded: 2 }, 'a real address is never echoed');
});
test('the parent screens wear the game\'s own faces, served from this origin: /fonts with a year of cache, font-src self, no third-party font request', async (t) => {
  const f = fixture();
  const server = createApp(f.service, { origin: 'https://pilot.example.test', secret, emulator: false, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['Orbitron-700', 'Rajdhani-500', 'Rajdhani-600', 'Rajdhani-700', 'JetBrainsMono-600']) {
    const r = await fetch(`${base}/fonts/${name}.woff2`); assert.equal(r.status, 200, name); assert.equal(r.headers.get('content-type'), 'font/woff2'); assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const bytes = new Uint8Array(await r.arrayBuffer()); assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'wOF2', `${name} is a woff2 file`); assert.ok(bytes.length > 8000 && bytes.length < 60000, `${name} is a latin subset`);
  }
  assert.equal((await fetch(`${base}/fonts/Orbitron-900.woff2`)).status, 404, 'only the files in the map are served');
  const home = await fetch(`${base}/`); assert.match(home.headers.get('content-security-policy'), /font-src 'self'/);
  const html = await home.text(), css = await (await fetch(`${base}/styles.css`)).text();
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|@import/.test(html + css), 'no third-party font request at sign-in');
  for (const face of ['Orbitron', 'Rajdhani', 'JetBrains Mono']) assert.ok(css.includes(`font-family:"${face}"`), face);
  assert.match(css, /--cyan:#35E0FF/); assert.match(css, /--magenta:#FF2DA8/); assert.match(html, /MISSION CONTROL/); assert.match(html, /rel="preload" href="\/fonts\/Rajdhani-500\.woff2" as="font"/);
});
