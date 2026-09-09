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
  assert.deepEqual(await res.json(), { status: 'ok', version: VERSION, release: null });
  assert.match(res.headers.get('cache-control'), /no-store/);
  // the proxy-depth measurement (DEPLOY_V3.md §5): a count, and the leading entry only when it is a documentation address
  const probe = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, { headers: { 'X-Forwarded-For': '203.0.113.250, 198.51.100.7, 192.0.2.9' } });
  assert.deepEqual(await probe.json(), { status: 'ok', version: VERSION, release: null, forwarded: 3, leading: '203.0.113.250' });
  const real = await fetch(`http://127.0.0.1:${server.address().port}/api/health`, { headers: { 'X-Forwarded-For': '8.8.8.8, 192.0.2.9' } });
  assert.deepEqual(await real.json(), { status: 'ok', version: VERSION, release: null, forwarded: 2 }, 'a real address is never echoed');
});
test('the commit a revision runs is a fact the service states: /api/health carries RELEASE_SHA, the deploy helper records it and refuses a dirty or commitless checkout', async (t) => {
  const f = fixture(), sha = 'ab'.repeat(20);
  const server = createApp(f.service, { origin: 'https://pilot.example.test', secret, emulator: false, releaseSha: sha, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).json(), { status: 'ok', version: VERSION, release: sha });
  const helper = await read('../scripts/deploy-staging.sh');
  for (const s of ['RELEASE_SHA="$(git rev-parse HEAD', '^[0-9a-f]{40}$', 'git status --porcelain --untracked-files=no', '--labels "release-sha=$RELEASE_SHA"', 'RELEASE_SHA: p.RELEASE_SHA', 'result.release !== sha']) assert.ok(helper.includes(s), s);
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
test('the image and the pipeline: the base image is pinned by digest, the shell scripts stay out of the image, the lockfile is installed with npm ci, audited in CI, and refused by the deploy helper when it differs from the commit', async () => {
  const docker = await read('../Dockerfile');
  assert.match(docker, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}$/m, 'a tag moves under you; a digest is the image that was built in CI');
  assert.match(docker, /hub\.docker\.com\/v2\/repositories\/library\/node\/tags\/22-bookworm-slim/, 'the comment says how to bump it');
  // .dockerignore: the last matching pattern wins and a pattern matches every parent path, so `!scripts` re-includes the whole directory; the two lines after it exclude the shell scripts again
  const ignore = (await read('../.dockerignore')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(ignore.includes('!scripts') && ignore.includes('!scripts/*.mjs'), 'the operator CLI still rides for the sweep job');
  for (const again of ['scripts/cloudshell', 'scripts/*.sh']) assert.ok(ignore.indexOf(again) > ignore.indexOf('!scripts'), `${again} is excluded again after !scripts`);
  const workflow = await read('../../.github/workflows/secure-foundation.yml');
  assert.ok(workflow.includes('npm audit --omit=dev --audit-level=high'), 'production dependencies are audited on every push');
  assert.ok(workflow.indexOf('run: npm test') < workflow.indexOf('npm audit --omit=dev --audit-level=high'), 'after the unit suite');
  assert.ok(!/^\s*npm install\b/m.test(workflow), 'CI never resolves a dependency tree of its own');
  assert.match(workflow, /package-lock\.json is missing[\s\S]*?exit 1[\s\S]*?npm ci --ignore-scripts/, 'a missing lockfile fails the emulator job instead of warning');
  const helper = await read('../scripts/deploy-staging.sh');
  assert.match(helper, /git rev-parse --is-inside-work-tree[^\n]*! git diff --quiet HEAD -- package-lock\.json/, 'the helper refuses a lockfile that differs from the committed one');
  const deploy = await read('../DEPLOY_V3.md');
  assert.match(deploy, /^npm ci --ignore-scripts --no-fund --no-audit$/m); assert.ok(!/^npm install/m.test(deploy), 'section 3 says npm ci, never npm install');
  for (const s of ['GHSA-w5hq-g745-h8pq', 'roles/cloudbuild.builds.builder', 'roles/run.builder', 'automathtics-v3-sms-ladder@', 'allowed-on-error', 'SMS_LADDER_MISCONFIGURED', "value(ttlConfig.state)", 'BLOCK B DONE WITH WARNINGS']) assert.ok(deploy.includes(s), s);
});
