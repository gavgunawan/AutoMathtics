import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { VERSION } from '../server/version.mjs';
import { createApp } from '../server/http.mjs';
import { fixture, secret } from './support.mjs';
import { RETENTION } from '../server/support.mjs';
import { verifyRelease } from '../scripts/verify-release.mjs';
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
// The minor number is the pull request the release was merged from (the owner's rule of 12 Sep 2026), so a version names a
// change anyone can go and read. The footer carries it with no date beside it: a date ages on a page deployed several times a
// week, and which commit a release runs is already a fact /api/health states.
test('the version agrees across manifest, page and backend, the footer carries it without a date, and no pilot badge is left', async () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(await read('../package.json')).version, VERSION);
  const page = await read('../public/index.html'), short = `v${VERSION.split('.').slice(0, 2).join('.')}`;
  assert.ok(page.includes(`<footer>${short} <span>`), `the footer names this release (${short})`);
  assert.ok(!/&middot;\s*\d+ \w+ \d{4}/.test(page), 'and no date stands beside it');
  assert.ok(!page.includes('PRIVATE PILOT'), 'the pilot badge is gone: that corner holds the family’s own name now');
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
test('the commit a revision runs is a fact the service states: /api/health carries RELEASE_SHA; the deploy helper exports the commit it deploys, refuses a dirty, commitless or changed checkout, and verify-release decides on the live answer', async (t) => {
  const f = fixture(), sha = 'ab'.repeat(20), other = 'cd'.repeat(20);
  const server = createApp(f.service, { origin: 'https://pilot.example.test', secret, emulator: false, releaseSha: sha, web: { authDomain: 'demo-am-foundation.firebaseapp.com' } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`), health = await res.json();
  assert.deepEqual(health, { status: 'ok', version: VERSION, release: sha });
  const helper = await read('../scripts/deploy-staging.sh');
  for (const s of ['RELEASE_SHA="$(git rev-parse HEAD', '^[0-9a-f]{40}$', 'DIRTY="$(git status --porcelain --untracked-files=no)"', 'TOP="$(git rev-parse --show-toplevel)"', 'git -C "$TOP" -c core.autocrlf=false archive --format=tar "${RELEASE_SHA}${PREFIX:+:$PREFIX}"', '--source "$SRC"', '--labels "release-sha=$RELEASE_SHA"', 'RELEASE_SHA: p.RELEASE_SHA', 'The checkout changed while the tests ran', 'VERDICT="$(node scripts/verify-release.mjs "$ORIGIN" "$RELEASE_SHA" "$SERVICE_JSON")"', '*"is responding at"*']) assert.ok(helper.includes(s), s);
  assert.ok(!helper.includes('--source .'), 'never the working tree as it stands after the suites');
  assert.ok((await read('../scripts/verify-release.mjs')).includes('realpathSync(process.argv[1])'), 'the CLI guard sees through a linked path, so the last gate is never silently skipped');
  // the export, run as the helper runs it — from inside commercial/ of a checkout whose top level is the repo — must yield the subtree
  // (from inside commercial/, a plain `git archive <sha>:commercial` scopes to the current directory inside the tree-ish and yields nothing)
  let git = true; try { execFileSync('git', ['--version'], { stdio: 'ignore' }); execFileSync('bash', ['--version'], { stdio: 'ignore' }); } catch { git = false; }
  if (!git) t.diagnostic('git or bash unavailable: the export is pinned by the helper text only');
  else {
    const dir = await mkdtemp(join(tmpdir(), 'am-export-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const sub = join(dir, 'commercial'); await mkdir(join(sub, 'server'), { recursive: true });
    for (const [name, body] of [['Dockerfile', 'FROM scratch\n'], ['.dockerignore', '*\n'], ['.gcloudignore', '.git\n'], ['package.json', '{}\n'], ['package-lock.json', '{}\n'], ['server/main.mjs', '// main\n']]) await writeFile(join(sub, name), body);
    await writeFile(join(dir, 'README.md'), 'root\n');
    const g = (args) => execFileSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
    g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'one']);
    const lines = helper.split('\n'), exportLines = lines.filter((l) => l.startsWith('PREFIX="$(git rev-parse --show-prefix)"') || l.startsWith('git -C "$TOP"') || l.startsWith('for needed in'));
    assert.equal(exportLines.length, 3, 'the export lines and the needed-files check are found verbatim');
    const recheck = lines.filter((l) => l.startsWith('DIRTY="$(git status --porcelain --untracked-files=no)"') || l.startsWith('[[ "$(git rev-parse HEAD)" == "$RELEASE_SHA" && -z "$DIRTY" ]]'));
    assert.equal(recheck.length, 3, 'the cleanliness check before the suites and the two-line re-check after them');
    const run = (script, cwd) => { try { return { out: execFileSync('bash', ['-c', script], { cwd, stdio: 'pipe' }).toString(), err: '', code: 0 }; } catch (e) { return { out: e.stdout?.toString() || '', err: e.stderr?.toString() || '', code: e.status }; } };
    const exported = run(`set -euo pipefail\nRELEASE_SHA="$(git rev-parse HEAD)"\nSRC="$(mktemp -d)"\n${exportLines.join('\n')}\nls -A "$SRC" "$SRC/server"\nrm -rf "$SRC"`, sub);
    assert.equal(exported.code, 0, exported.err);
    for (const name of ['Dockerfile', '.dockerignore', '.gcloudignore', 'package.json', 'package-lock.json', 'main.mjs']) assert.ok(exported.out.includes(name), `${name} is exported`);
    assert.ok(!exported.out.includes('README.md'), 'the subtree only');
    const naive = execFileSync('bash', ['-c', 'git archive --format=tar "$(git rev-parse HEAD):commercial" | tar -t | wc -l'], { cwd: sub, stdio: 'pipe' }).toString().trim();
    assert.equal(naive, '0', 'the naive form from inside commercial/ exports nothing: the reason the helper archives from the top level');
    // a commit whose subtree lacks a needed file is refused although the file sits untracked on disk
    g(['rm', '-q', '--cached', 'commercial/.gcloudignore']); g(['commit', '-q', '-m', 'without']);
    const lacking = run(`set -euo pipefail\nRELEASE_SHA="$(git rev-parse HEAD)"\nSRC="$(mktemp -d)"\n${exportLines.join('\n')}\necho REACHED`, sub);
    assert.equal(lacking.code, 1); assert.match(lacking.err, /The exported commit lacks \.gcloudignore\./); assert.ok(!lacking.out.includes('REACHED'));
    g(['add', '-A']); g(['commit', '-q', '-m', 'with']);
    // the re-check after the suites: an edit, or a commit, made meanwhile stops the helper
    const recheckScript = (before) => `set -euo pipefail\nRELEASE_SHA="$(git rev-parse HEAD)"\n${recheck[0]}\n[[ -z "$DIRTY" ]]\n${before}\n${recheck[1]}\n${recheck[2]}\necho REACHED`;
    assert.equal(run(recheckScript(':'), sub).code, 0, 'a checkout unchanged passes');
    const edited = run(recheckScript('echo x >> Dockerfile'), sub); assert.equal(edited.code, 1); assert.match(edited.err, /The checkout changed while the tests ran/); g(['checkout', '--', 'commercial/Dockerfile']);
    const moved = run(recheckScript('git -c user.email=t@example.test -c user.name=t -c commit.gpgsign=false commit -q --allow-empty -m moved'), sub); assert.equal(moved.code, 1); assert.match(moved.err, /The checkout changed while the tests ran/);
    // the verdict gate: a verify-release that prints no verdict fails the deploy; one that prints it passes
    const gate = lines.filter((l) => l.startsWith('VERDICT="$(node scripts/verify-release.mjs') || l.startsWith('echo "$VERDICT"') || l.startsWith('[[ "$VERDICT" == *"is responding at"*'));
    assert.equal(gate.length, 3, 'the three gate lines are found verbatim');
    const gateDir = await mkdtemp(join(tmpdir(), 'am-gate-')); t.after(() => rm(gateDir, { recursive: true, force: true })); await mkdir(join(gateDir, 'scripts'), { recursive: true });
    await writeFile(join(gateDir, 'scripts', 'verify-release.mjs'), 'process.exit(0);\n');
    const silent = run(`set -euo pipefail\nORIGIN=o; RELEASE_SHA=s; SERVICE_JSON=j\n${gate.join('\n')}\necho REACHED`, gateDir); assert.equal(silent.code, 1); assert.match(silent.err, /printed no verdict/); assert.ok(!silent.out.includes('REACHED'));
    await writeFile(join(gateDir, 'scripts', 'verify-release.mjs'), "console.log('v3.0.0 at commit s is responding at o. Now complete the staging acceptance checklist.');\n");
    const spoken = run(`set -euo pipefail\nORIGIN=o; RELEASE_SHA=s; SERVICE_JSON=j\n${gate.join('\n')}\necho REACHED`, gateDir); assert.equal(spoken.code, 0); assert.ok(spoken.out.includes('REACHED'));
  }
  assert.ok(!/\[\[ -z "\$\(git status/.test(helper), 'a failing git status must not read as a clean tree');
  // the decision itself, on the live answer of a server: the commit, the revision, its label and its traffic
  const service = (latest, ready, traffic, label = sha) => ({ metadata: { name: 'automathtics-v3' }, spec: { template: { metadata: { labels: { 'release-sha': label } } } }, status: { latestCreatedRevisionName: latest, latestReadyRevisionName: ready, traffic } });
  assert.deepEqual(verifyRelease({ ok: res.ok, health, sha, service: service('r2', 'r2', [{ revisionName: 'r2', percent: 100, latestRevision: true }]) }), { version: VERSION, release: sha, revision: 'r2' });
  assert.deepEqual(verifyRelease({ ok: true, health, sha }), { version: VERSION, release: sha, revision: null });
  assert.throws(() => verifyRelease({ ok: true, health, sha: other }), /reports commit abab.*not cdcd/);
  assert.throws(() => verifyRelease({ ok: true, health: { status: 'ok', version: VERSION, release: null }, sha }), /reports commit none/);
  assert.throws(() => verifyRelease({ ok: false, health, sha }), /health check failed/);
  assert.throws(() => verifyRelease({ ok: true, health: { ...health, version: '2.9.0' }, sha }), /health check failed/);
  assert.throws(() => verifyRelease({ ok: true, health, sha, service: service('r2', 'r2', [{ revisionName: 'r1', percent: 100 }]) }), /Traffic is not on r2/, 'a rollback pinned traffic to the older revision of the same commit: the new one serves nothing');
  assert.throws(() => verifyRelease({ ok: true, health, sha, service: service('r2', 'r2', [{ revisionName: 'r1', percent: 50 }, { revisionName: 'r2', percent: 50 }]) }), /Traffic is not on r2/);
  assert.throws(() => verifyRelease({ ok: true, health, sha, service: service('r2', 'r2', [{ revisionName: 'r2', percent: 60, latestRevision: true }, { revisionName: 'r1', percent: 40 }]) }), /Traffic is not on r2/, 'a majority is not all of it');
  assert.throws(() => verifyRelease({ ok: true, health, sha, service: service('r2', 'r2', [{ revisionName: 'r2', percent: 99 }, { revisionName: 'r1', percent: 1 }]) }), /Traffic is not on r2/);
  assert.throws(() => verifyRelease({ ok: true, health, sha, service: service('r2', 'r1', [{ revisionName: 'r1', percent: 100 }]) }), /not the ready one/);
  assert.throws(() => verifyRelease({ ok: true, health, sha, service: service('r2', 'r2', [{ revisionName: 'r2', percent: 100 }], other) }), /labelled release-sha=cdcd/);
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
test('the kids grid keeps the v2 arcade presentation hooks without touching application authority', async () => {
  const css = await read('../public/styles.css');
  // PR #45 pinned the hooks of the first polish; the v2-look port rebuilt those screens, so the guard names its own:
  // the child's home header and wallet tiles, the two track cards, the question sheet, the answer form, the shop grid
  // and the rocket panel.
  for (const marker of ['v2 parity polish', '.home-header', '.wallet-tile', '.track-card', '.sheet', '.answer-form', '.shop-grid', '.rocket-panel', '@media(prefers-reduced-motion:reduce)']) {
    assert.ok(css.includes(marker), `missing presentation hook: ${marker}`);
  }
  assert.match(css, /font-family:var\(--display\)/, 'the game display face remains the question/mission emphasis');
  assert.ok(css.includes('body:before') && css.includes('@keyframes aurora'), 'the grid and its aurora are present');
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
test('the support desk ships as three documents a tired person can follow: the inbox and its DNS records, the labels in the order they are applied, the targets, the escalation ladder, the money procedures, the replies and the incident format', async () => {
  const desk = await read('../SUPPORT_DESK.md'), replies = await read('../SUPPORT_REPLIES.md'), incidents = await read('../INCIDENTS.md');
  for (const section of ['## The inbox', '### DNS records', '### Replies go out from the Gmail address', '### If there is no domain yet', '## Labels',
    '### The filters that do the sorting', '## Response-time targets', '## Escalation', '## Feedback notes from the app', '## Refunds', '## Cancellations',
    '## Running the commands from a phone', '## The weekly ops line', '## What only the owner can do']) assert.ok(desk.includes(section), `SUPPORT_DESK.md: ${section}`);
  // a free inbox with its records spelled out, and the honest limit of it
  for (const s of ['Cloudflare Email Routing', 'route1.mx.cloudflare.net', 'route2.mx.cloudflare.net', 'route3.mx.cloudflare.net',
    'v=spf1 include:_spf.mx.cloudflare.net ~all', '_dmarc', 'Email Routing **receives** only']) assert.ok(desk.includes(s), s);
  // the labels, in the order they are applied: child-safety and account-recovery first, then the rest; plus the two that travel with the thread
  let at = desk.indexOf('## Labels');
  for (const label of ['child-safety', 'account-recovery', 'billing', 'bug', 'refund', 'cancel', 'feature-idea', 'other']) {
    const next = desk.indexOf(`\`${label}\``, at); assert.ok(next > at, `${label} is out of order in the label table`); at = next;
  }
  for (const label of ['needs-reply', 'waiting-on-parent']) assert.ok(desk.includes(`\`${label}\``), label);
  // every target, and the plain statement that the app cannot say them to a parent yet
  for (const target of ['same day, before anything else', 'one business day', 'two business days', 'three business days']) assert.ok(desk.includes(target), target);
  assert.match(desk, /not stated inside the app today/);
  // the desk names where a copy of an in-app note goes, and how to tell whether the running release sends any
  assert.match(desk, /Check the running release before you answer/);
  // the escalation ladder, the 72 hours, and the rollback this deployment actually has (block C pulls the tip, so it is the way forward, not back)
  for (const s of ['### Severity 1 — stop everything', '### Severity 2 — within the week', '### Severity 3 — the backlog', 'within 72 hours',
    'Traffic back to the last good revision', 'scripts/cloudshell/03-deploy.sh', 'PAYMENT_PROVIDER=fake', 'FAKE_PAYMENTS_ACK=no-real-money',
    'no per-feature kill switch']) assert.ok(desk.includes(s), s);
  // the money procedures: the commands that exist, what the record holds afterwards, and what a refund never does
  for (const s of ['node scripts/support.mjs family FAMILY_UUID', 'node scripts/subscription.mjs FAMILY_UUID refund AMOUNT_CENTS full',
    'node scripts/subscription.mjs FAMILY_UUID cancel.request', 'node scripts/subscription.mjs FAMILY_UUID terminate',
    'node scripts/support.mjs reconcile-provider FAMILY_UUID', 'CONFIRM_DELETION=FAMILY_UUID node scripts/support.mjs delete FAMILY_UUID',
    '**Child wallets are never touched.**', '**A refund never removes access already paid for.**', "parent's own 14-day process"]) assert.ok(desk.includes(s), s);
  for (const section of ['## How to use these', '## Never ask for a secret', '## The replies']) assert.ok(replies.includes(section), `SUPPORT_REPLIES.md: ${section}`);
  assert.equal([...replies.matchAll(/^### \d+\. /gm)].length, 15, 'fifteen canned replies');
  for (const section of ['## The three commands', '## The record', '## Retention', '## Postmortem template', '## The log']) assert.ok(incidents.includes(section), `INCIDENTS.md: ${section}`);
  for (const s of ['`open SEVERITY "one line"`', '`note ID "what you did or found"`', '`close ID "how it ended"`', '`list [open|closed|all]`',
    'node scripts/support.mjs incident open 1', 'node scripts/support.mjs incident note inc-', 'node scripts/support.mjs incident close inc-',
    'inc-YYYYMMDD-xxxx', 'parentNoticeDueAt', 'INVALID_SEVERITY', 'INCIDENT_NOT_OPEN',
    '**What happened.**', '**Why it happened.**', '**What caught it.**', '**What changes.**']) assert.ok(incidents.includes(s), s);
  // the incident log is kept, not collected: RETENTION, SUPPORT.md and the deployment's TTL section agree
  assert.ok(Object.hasOwn(RETENTION, 'incidents/*'));
  assert.match(await read('../SUPPORT.md'), /\| `incidents\/\*` \|/);
  const deploy = await read('../DEPLOY_V3.md');
  assert.ok(!deploy.match(/for GROUP in ([^;]+); do/)[1].split(/\s+/).includes('incidents'), 'the incident log is not a TTL group');
  assert.match(deploy, /`supportOperations` and `incidents` carry\nnone either/);
});
