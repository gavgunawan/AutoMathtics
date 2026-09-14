// A live project (13 Sep 2026): the deploy helper, the GitHub workflow and the Cloud Shell blocks deploy one with payments not open, and
// none of it loosens what staging checks. In the style of tests/release.test.mjs: the words pinned where they matter, and the shell run
// where its decisions can be (bash fragments with no cloud call in them, in an environment that holds nothing but PATH).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../server/config.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const HERE = fileURLToPath(new URL('..', import.meta.url));
let shell = true; try { execFileSync('bash', ['--version'], { stdio: 'ignore' }); } catch { shell = false; }
/** A bash fragment, run from commercial/ with only the environment given. */
function bash(script, env = {}) {
  try { return { code: 0, out: execFileSync('bash', ['-c', script], { cwd: HERE, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env }, stdio: 'pipe' }).toString(), err: '' }; }
  catch (e) { return { code: e.status, out: e.stdout?.toString() || '', err: e.stderr?.toString() || '' }; }
}
/** The lines from the first starting with `from` to the first after it starting with `to`, both included. */
function between(text, from, to) {
  const lines = text.split('\n'), i = lines.findIndex((l) => l.startsWith(from)), j = lines.findIndex((l, k) => k > i && l.startsWith(to));
  assert.ok(i >= 0 && j > i, `found ${from} … ${to}`); return lines.slice(i, j + 1).join('\n');
}
const line = (text, from) => { const l = text.split('\n').find((x) => x.startsWith(from)); assert.ok(l, `found ${from}`); return l; };
const PRICES = { STRIPE_PRICE_STARTER: 'price_1UDktFEAg0w7lrNU8ixmQg6g', STRIPE_PRICE_FAMILY: 'price_1UDktZEAg0w7lrNU0kJdqUxK', STRIPE_PRICE_BIG: 'price_1UDktlEAg0w7lrNUb4AwLnP3' };

test('the deploy helper: APP_MODE is staging by default or production; PAYMENT_PROVIDER=none checks and binds no provider secret; the fake provider is refused in production; stripe and fake as before; every other refusal intact', async (t) => {
  const helper = await read('../scripts/deploy-staging.sh'), block = between(helper, 'APP_MODE="${APP_MODE:-staging}"', 'esac');
  if (!shell) t.diagnostic('bash unavailable: the decisions are pinned by text only');
  else {
    const decide = (env) => bash(`set -euo pipefail\n${block}\necho "mode=$APP_MODE provider=$PAYMENT_PROVIDER secrets=[$PROVIDER_SECRETS] bindings=[$PROVIDER_BINDINGS]"`, env);
    assert.equal(decide({ APP_MODE: 'production', PAYMENT_PROVIDER: 'none' }).out.trim(), 'mode=production provider=none secrets=[] bindings=[]');
    assert.equal(decide({ PAYMENT_PROVIDER: 'none' }).out.trim(), 'mode=staging provider=none secrets=[] bindings=[]', 'none on staging too');
    assert.equal(decide({}).out.trim(), 'mode=staging provider=fake secrets=[am-v3-webhook-fake] bindings=[,WEBHOOK_SECRET_FAKE=am-v3-webhook-fake:1]', 'unsaid: staging with the fake provider, as before');
    assert.equal(decide({ PAYMENT_PROVIDER: 'stripe', ...PRICES }).out.trim(), 'mode=staging provider=stripe secrets=[am-v3-stripe-key am-v3-webhook-stripe] bindings=[,STRIPE_SECRET_KEY=am-v3-stripe-key:1,WEBHOOK_SECRET_STRIPE=am-v3-webhook-stripe:1]');
    assert.equal(decide({ APP_MODE: 'production', PAYMENT_PROVIDER: 'stripe', ...PRICES }).code, 0, 'Stripe in production is the service\'s to check (a live key)');
    const noPrice = decide({ PAYMENT_PROVIDER: 'stripe', ...PRICES, STRIPE_PRICE_BIG: '' }); assert.equal(noPrice.code, 1); assert.match(noPrice.err, /Set STRIPE_PRICE_BIG/);
    for (const env of [{ APP_MODE: 'production', PAYMENT_PROVIDER: 'fake' }, { APP_MODE: 'production' }]) {
      const r = decide(env); assert.equal(r.code, 1, JSON.stringify(env)); assert.match(r.err, /never in production/, 'production with the fake provider, named or by default');
    }
    for (const mode of ['emulator', 'prod', 'Production']) { const r = decide({ APP_MODE: mode, PAYMENT_PROVIDER: 'none' }); assert.equal(r.code, 1, mode); assert.match(r.err, /APP_MODE must be staging or production/); }
    for (const provider of ['xendit', 'NONE']) { const r = decide({ PAYMENT_PROVIDER: provider }); assert.equal(r.code, 1, provider); assert.match(r.err, /PAYMENT_PROVIDER must be stripe, fake or none/); }
  }
  // every provider secret the helper checks or binds comes from that decision, and none is named anywhere else
  for (const s of ['for name in am-v3-session am-v3-pin-pepper $PROVIDER_SECRETS; do', '--set-secrets "SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1${PROVIDER_BINDINGS}', 'export PROJECT_ID APP_MODE ']) assert.ok(helper.includes(s), s);
  assert.ok(!/am-v3-stripe-key|am-v3-webhook-stripe|am-v3-webhook-fake|STRIPE_SECRET_KEY|WEBHOOK_SECRET_/.test(helper.replace(block, '')), 'no provider secret is named outside the decision');
  assert.ok(helper.indexOf('APP_MODE="${APP_MODE:-staging}"') < helper.indexOf('gcloud '), 'decided before any cloud call');
  for (const s of ['Refusing unconfirmed, demo or legacy project.', 'Remove emulator environment variables before cloud deployment.', 'package-lock.json differs from the committed one', 'The checkout has uncommitted changes',
    'The checkout changed while the tests ran', '\nnpm test\nnpm run test:emulator\n', 'firebase deploy --config firebase.staging.json --project "$PROJECT_ID" --only firestore:rules', '[[ "$VERDICT" == *"is responding at"* ]]']) assert.ok(helper.includes(s), s);
  const pkg = JSON.parse(await read('../package.json'));
  assert.deepEqual([pkg.scripts['deploy:staging'], pkg.scripts['deploy:live']], ['bash scripts/deploy-staging.sh', 'APP_MODE=production bash scripts/deploy-staging.sh'], 'one helper, two doors');
});

test('the environment the helper writes for a live project is one the service starts from (production, payments not open, the auth domain, no empty origin list); staging\'s as before; the runtime account and the auth domain are checked first', async (t) => {
  const helper = await read('../scripts/deploy-staging.sh'), lines = helper.split('\n');
  const start = lines.findIndex((l) => l.startsWith("node --input-type=module - \"$ENV_FILE\" <<'NODE'")), end = lines.findIndex((l, i) => i > start && l === 'NODE');
  assert.ok(start >= 0 && end > start, 'the environment file is written by one heredoc');
  const dir = await mkdtemp(join(tmpdir(), 'am-live-env-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const program = join(dir, 'env.mjs'); await writeFile(program, lines.slice(start + 1, end).join('\n'));
  let n = 0;
  const written = (env) => { const out = join(dir, `env-${n++}.json`); execFileSync(process.execPath, [program, out], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env }, stdio: 'pipe' }); return JSON.parse(readFileSync(out, 'utf8')); };
  const sha = 'ab'.repeat(20), common = { FIREBASE_WEB_API_KEY: 'AIzaSyLive', FIREBASE_WEB_APP_ID: '1:2:web:3', TRUSTED_PROXY_HOPS: '2', RELEASE_SHA: sha, FEEDBACK_TO: 'control.tower@automathtics.net', EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'AutoMathtics <control.tower@automathtics.net>', WAITLIST_FROM: 'AutoMathtics <no-reply@automathtics.net>', WAITLIST_REPLY_TO: 'support@automathtics.net' };
  const live = written({ ...common, PROJECT_ID: 'automathtics-live', APP_MODE: 'production', PAYMENT_PROVIDER: 'none', APP_ORIGIN: 'https://automathtics.net', APP_ALSO_ORIGINS: '', FIREBASE_AUTH_DOMAIN: 'automathtics.net' });
  assert.deepEqual(live, { APP_MODE: 'production', APP_ORIGIN: 'https://automathtics.net', FIREBASE_PROJECT_ID: 'automathtics-live', FIREBASE_WEB_API_KEY: 'AIzaSyLive', FIREBASE_WEB_APP_ID: '1:2:web:3', FIREBASE_AUTH_DOMAIN: 'automathtics.net',
    TRUSTED_PROXY_HOPS: '2', RELEASE_SHA: sha, PAYMENT_PROVIDER: 'none', WAITLIST_FROM: 'AutoMathtics <no-reply@automathtics.net>', WAITLIST_REPLY_TO: 'support@automathtics.net',
    FEEDBACK_TO: 'control.tower@automathtics.net', EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'AutoMathtics <control.tower@automathtics.net>' }, 'no acknowledgement, no price, no empty origin list');
  const cfg = config({ ...live, SESSION_SECRET: 'a'.repeat(64), PIN_PEPPER: 'b'.repeat(64), EMAIL_API_KEY: `re_${'z'.repeat(30)}`, PORT: '8080' }); // and the secrets Cloud Run adds: no provider's
  assert.deepEqual([cfg.mode, cfg.payments, cfg.web.authDomain, cfg.origins], ['production', { provider: 'none', webhookSecrets: { fake: null }, stripe: null }, 'automathtics.net', ['https://automathtics.net']]);
  const before = written({ ...common, PROJECT_ID: 'automathtics-live', APP_MODE: 'production', PAYMENT_PROVIDER: 'none', APP_ORIGIN: 'https://automathtics.net', APP_ALSO_ORIGINS: '', FIREBASE_AUTH_DOMAIN: '' }); // LIVE_AUTH_DOMAIN not set yet
  assert.equal('FIREBASE_AUTH_DOMAIN' in before, false, 'an unset variable writes nothing');
  assert.equal(config({ ...before, SESSION_SECRET: 'a'.repeat(64), PIN_PEPPER: 'b'.repeat(64), EMAIL_API_KEY: `re_${'z'.repeat(30)}`, PORT: '8080' }).web.authDomain, 'automathtics-live.firebaseapp.com', 'so sign-in runs through the project\'s own host until the domain moves');
  const staging = written({ ...common, PROJECT_ID: 'automathtics-v3-staging', PAYMENT_PROVIDER: 'stripe', ...PRICES, APP_ORIGIN: 'https://automathtics.net', APP_ALSO_ORIGINS: 'https://automathtics-v3-staging.web.app' });
  assert.deepEqual([staging.APP_MODE, staging.PAYMENT_PROVIDER, staging.STRIPE_PRICE_BIG, 'FIREBASE_AUTH_DOMAIN' in staging, 'FAKE_PAYMENTS_ACK' in staging, staging.APP_ALSO_ORIGINS],
    ['staging', 'stripe', PRICES.STRIPE_PRICE_BIG, false, false, 'https://automathtics-v3-staging.web.app'], 'staging as the workflow deploys it');
  const fake = written({ ...common, PROJECT_ID: 'automathtics-v3-staging', APP_ORIGIN: 'https://automathtics-v3-staging.web.app' });
  assert.deepEqual([fake.APP_MODE, fake.PAYMENT_PROVIDER, fake.FAKE_PAYMENTS_ACK], ['staging', 'fake', 'no-real-money'], 'unsaid: the fake provider, acknowledged, as before');
  if (shell) {
    const domain = line(helper, '[[ -z "${FIREBASE_AUTH_DOMAIN:-}"'), check = (value) => bash(`set -euo pipefail\n${domain}\necho ok`, { FIREBASE_AUTH_DOMAIN: value }).code;
    for (const good of ['', 'automathtics.net', 'automathtics-live.firebaseapp.com']) assert.equal(check(good), 0, good);
    for (const bad of ['https://automathtics.net', 'automathtics.net/', 'automathtics.net:443', 'Automathtics.net', 'automathtics.net.', '-automathtics.net']) assert.equal(check(bad), 1, bad);
    const keyLine = line(helper, '[[ "$FIREBASE_WEB_API_KEY" =~'), key = (value) => bash(`set -euo pipefail\n${keyLine}\necho ok`, { FIREBASE_WEB_API_KEY: value }).code;
    assert.equal(key('AIzaSyCoVfsQwXV3AFoK789V99ncDJknMoPmWUI'), 0, 'a web apiKey (staging\'s, public in 01-prepare.sh)');
    for (const bad of ['AIzaSyAn' + String.fromCharCode(0x2022).repeat(31), 'AIzaSy CoVfsQwXV3AFoK789V99ncDJknMoPmWU', 'AIza', '"AIzaSyCoVfsQwXV3AFoK789V99ncDJknMoPmWUI"']) assert.equal(key(bad), 1, bad);
    const account = between(helper, 'RUNTIME_SA="${RUNTIME_SA:-', '[[ "$RUNTIME_SA" =~'), sa = (env) => bash(`set -euo pipefail\n${account}\necho "$RUNTIME_SA"`, { PROJECT_ID: 'automathtics-live', ...env });
    assert.equal(sa({}).out.trim(), 'automathtics-v3-runtime@automathtics-live.iam.gserviceaccount.com', 'unsaid: the project\'s runtime account, as before');
    assert.equal(sa({ RUNTIME_SA: 'live-runtime@automathtics-live.iam.gserviceaccount.com' }).out.trim(), 'live-runtime@automathtics-live.iam.gserviceaccount.com', 'a named account of the project');
    for (const bad of ['automathtics-v3-runtime@automathtics-v3-staging.iam.gserviceaccount.com', 'x@automathtics-live.iam.gserviceaccount.com', 'live-runtime@automathtics-livexiam.gserviceaccount.com']) assert.equal(sa({ RUNTIME_SA: bad }).code, 1, bad);
  }
});

test('the workflow: the staging job on its own host and without the sheet; deploy-live only once LIVE_PROJECT_ID is set, every project value from LIVE_* variables, production, payments not open, the domain, staging\'s email settings and the waiting-list sheet, the same pinned actions, and the commit checked on the live host', async () => {
  const workflow = await read('../../.github/workflows/deploy.yml'), lines = workflow.split('\n');
  const job = (name) => { const i = lines.indexOf(`  ${name}:`); assert.ok(i > 0, name); let j = i + 1; while (j < lines.length && !/^  [a-z][a-z0-9-]*:\s*$/.test(lines[j])) j++; return lines.slice(i, j); };
  const envOf = (block) => { const out = {}, i = block.indexOf('    env:'); for (let k = i + 1; k < block.length && /^      /.test(block[k]); k++) { const m = /^      ([A-Z0-9_]+): (.*)$/.exec(block[k]); if (m) out[m[1]] = m[2].replace(/^'(.*)'$/, '$1'); } return out; };
  const usesOf = (block) => block.map((l) => /uses: (\S+)/.exec(l)?.[1]).filter(Boolean);
  const staging = job('deploy'), live = job('deploy-live'), se = envOf(staging), le = envOf(live), text = live.join('\n');
  assert.deepEqual([se.PROJECT_ID, se.PAYMENT_PROVIDER, se.STRIPE_PRICE_BIG, 'APP_MODE' in se, 'FIREBASE_AUTH_DOMAIN' in se, se.APP_ORIGIN, se.APP_ALSO_ORIGINS, 'WAITLIST_SHEET_ID' in se], ['automathtics-v3-staging', 'stripe', PRICES.STRIPE_PRICE_BIG, false, false, 'https://automathtics-v3-staging.web.app', 'https://automathtics-v3-staging.firebaseapp.com', false], 'since the cutover staging serves its own host and writes no sheet');
  assert.ok(!staging.some((l) => /^\s+(if|needs):/.test(l)), 'staging runs on every push, as before');
  assert.ok(staging.join('\n').includes('workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}') && staging.join('\n').includes('- run: npm run deploy:staging'));
  assert.ok(live.includes("    if: ${{ vars.LIVE_PROJECT_ID != '' }}"), 'only once the variable names a project');
  assert.deepEqual([le.PROJECT_ID, le.CONFIRM_PROJECT, le.RUNTIME_SA, le.FIREBASE_WEB_API_KEY, le.FIREBASE_WEB_APP_ID], ['${{ vars.LIVE_PROJECT_ID }}', '${{ vars.LIVE_PROJECT_ID }}', '${{ vars.LIVE_RUNTIME_SA }}', '${{ vars.LIVE_FIREBASE_WEB_API_KEY }}', '${{ vars.LIVE_FIREBASE_WEB_APP_ID }}']);
  assert.ok(text.includes('workload_identity_provider: ${{ vars.LIVE_WORKLOAD_IDENTITY_PROVIDER }}') && text.includes('service_account: ${{ vars.LIVE_DEPLOY_SERVICE_ACCOUNT }}'), 'its own identity, from its own variables');
  assert.deepEqual([le.APP_MODE, le.PAYMENT_PROVIDER, le.APP_ORIGIN, le.FIREBASE_AUTH_DOMAIN, le.TRUSTED_PROXY_HOPS], ['production', 'none', 'https://automathtics.net', '${{ vars.LIVE_AUTH_DOMAIN }}', '2'], 'the sign-in domain is a variable, unset until automathtics.net is served by the live project');
  for (const key of ['EMAIL_PROVIDER', 'FEEDBACK_TO', 'OWNER_EMAIL', 'EMAIL_FROM', 'WAITLIST_FROM', 'WAITLIST_REPLY_TO']) assert.equal(le[key], se[key], `${key} is staging's`);
  assert.equal(le.WAITLIST_SHEET_ID, '1vceAjJRQQYa1u3Z0okf7Tt3AOsZVBWui5Xvav985dNQ', 'the owner\'s sheet, written by the live service alone since the cutover');
  assert.equal(le.APP_ALSO_ORIGINS, 'https://${{ vars.LIVE_PROJECT_ID }}.web.app,https://${{ vars.LIVE_PROJECT_ID }}.firebaseapp.com', 'the project\'s own hosts, so it can be tried before the domain moves');
  assert.ok(!Object.keys(le).some((k) => /^STRIPE_|^FAKE_|WEBHOOK/.test(k)), 'no provider setting of any kind'); assert.ok(!text.includes('automathtics-v3-staging'), 'nothing of staging\'s project');
  for (const s of ['- run: npm run deploy:live', 'curl -fsS "https://${PROJECT_ID}.web.app/api/health"', 'grep -q "$GITHUB_SHA"', 'The live service is not running this commit.']) assert.ok(text.includes(s), s);
  for (const uses of usesOf(lines)) assert.match(uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, uses);
  assert.deepEqual(usesOf(live), usesOf(staging), 'the same actions at the same commits');
  assert.ok(workflow.includes('  id-token: write') && workflow.includes('group: deploy-release') && !/\$\{\{\s*secrets\./.test(workflow), 'the permissions and the concurrency as they were, and no secret read');
});

test('Cloud Shell blocks: staging\'s identifiers are the defaults, and only for staging; another project exports its own and none may name staging; B never makes the two server secrets for it; C, E and G take the mode, provider and origin from the environment; H prints the live job\'s variables', async () => {
  const a = await read('../scripts/cloudshell/01-prepare.sh'), prep = between(a, 'set -uo pipefail', 'echo "project ');
  if (shell) {
    const run = (env) => bash(`${prep}\necho "P=$PROJECT_ID C=$CONFIRM_PROJECT K=$FIREBASE_WEB_API_KEY A=$FIREBASE_WEB_APP_ID N=$PROJECT_NUMBER R=$RUNTIME_SA"`, env);
    assert.match(run({}).out, /P=automathtics-v3-staging C=automathtics-v3-staging K=AIzaSyCoVfsQwXV3AFoK789V99ncDJknMoPmWUI A=1:1059646051128:web:df1a942e7a4136bd9d67cd N=1059646051128 R=automathtics-v3-runtime@automathtics-v3-staging\.iam\.gserviceaccount\.com/, 'nothing exported: staging, exactly as before');
    const liveEnv = { PROJECT_ID: 'automathtics-live', FIREBASE_WEB_API_KEY: 'AIzaSyLive', FIREBASE_WEB_APP_ID: '1:222:web:333', PROJECT_NUMBER: '222', APP_MODE: 'production', PAYMENT_PROVIDER: 'none', APP_ORIGIN: 'https://automathtics.net' };
    assert.match(run(liveEnv).out, /P=automathtics-live C=automathtics-live K=AIzaSyLive A=1:222:web:333 N=222 R=automathtics-v3-runtime@automathtics-live\.iam\.gserviceaccount\.com/);
    for (const name of ['FIREBASE_WEB_API_KEY', 'FIREBASE_WEB_APP_ID', 'PROJECT_NUMBER', 'APP_MODE', 'PAYMENT_PROVIDER', 'APP_ORIGIN']) {
      const r = run({ ...liveEnv, [name]: '' }); assert.equal(r.code, 1, name); assert.match(r.out, new RegExp(`BLOCK A FAILED: export ${name} for automathtics-live`), name);
    }
    for (const [name, value] of [['FIREBASE_WEB_API_KEY', 'AIzaSyCoVfsQwXV3AFoK789V99ncDJknMoPmWUI'], ['PROJECT_NUMBER', '1059646051128'], ['FIREBASE_WEB_APP_ID', '1:1059646051128:web:df1a942e7a4136bd9d67cd'],
      ['RUNTIME_SA', 'automathtics-v3-runtime@automathtics-v3-staging.iam.gserviceaccount.com'], ['APP_ORIGIN', 'https://automathtics-v3-staging.web.app'], ['FIREBASE_AUTH_DOMAIN', 'automathtics-v3-staging.firebaseapp.com']]) {
      const r = run({ ...liveEnv, [name]: value }); assert.equal(r.code, 1, name); assert.match(r.out, new RegExp(`BLOCK A FAILED: ${name} still names staging`), name);
    }
    const other = run({ ...liveEnv, RUNTIME_SA: 'automathtics-v3-runtime@some-other-project.iam.gserviceaccount.com' }); assert.equal(other.code, 1); assert.match(other.out, /is not an account of automathtics-live/);
    assert.equal(run({ RUNTIME_SA: 'automathtics-v3-runtime@automathtics-live.iam.gserviceaccount.com' }).code, 1, 'a staging tab with the live account left in it');
  }
  for (const s of ["STAGING_PROJECT='automathtics-v3-staging'", "STAGING_API_KEY='AIzaSyCoVfsQwXV3AFoK789V99ncDJknMoPmWUI'", "STAGING_APP_ID='1:1059646051128:web:df1a942e7a4136bd9d67cd'", "STAGING_NUMBER='1059646051128'", 'export PROJECT_ID="${PROJECT_ID:-$STAGING_PROJECT}"']) assert.ok(a.includes(s), s);
  const b = await read('../scripts/cloudshell/02-permissions.sh');
  assert.match(b, /elif \[\[ "\$PROJECT_ID" != automathtics-v3-staging && "\$\{FRESH_SECRETS:-\}" != yes \]\]; then echo "BLOCK B FAILED: \$NAME is missing on \$PROJECT_ID\. Copy it from staging first/);
  assert.ok(b.indexOf('BLOCK B FAILED: $NAME is missing') < b.indexOf("require('crypto').randomBytes(32)"), 'the refusal comes before any secret is made');
  assert.ok(b.includes('[[ "${PAYMENT_PROVIDER:-stripe}" == none ]]'), 'and it says there is no provider secret to make when payments are not open');
  const c = await read('../scripts/cloudshell/03-deploy.sh');
  for (const s of ['export APP_MODE="${APP_MODE:-staging}" PAYMENT_PROVIDER="${PAYMENT_PROVIDER:-stripe}"', 'STRIPE_PRICE_STARTER="${STRIPE_PRICE_STARTER:-price_1UDktFEAg0w7lrNU8ixmQg6g}"', '[[ "$APP_MODE" == production ]] && DEPLOY=deploy:live', 'npm run "$DEPLOY"']) assert.ok(c.includes(s), s);
  assert.equal(c.split('am-v3-stripe-key').length, between(c, '  stripe)', '  none)').split('am-v3-stripe-key').length, 'the Stripe secrets are granted in the Stripe branch alone');
  const e = await read('../scripts/cloudshell/05-sweep-job.sh'), g = await read('../scripts/cloudshell/07-report-job.sh');
  for (const [name, text] of [['E', e], ['G', g]]) for (const s of ['APP_MODE="${APP_MODE:-staging}"', 'APP_ORIGIN="${APP_ORIGIN:-https://$PROJECT_ID.web.app}"', `BLOCK ${name} FAILED: APP_MODE must be staging or production`]) assert.ok(text.includes(s), `${name}: ${s}`);
  if (shell) {
    const sweep = between(e, 'APP_MODE="${APP_MODE:-staging}"', 'esac');
    const decide = (env) => bash(`${sweep}\necho "APP_MODE=$APP_MODE,FIREBASE_PROJECT_ID=$PROJECT_ID,APP_ORIGIN=$APP_ORIGIN$PROVIDER_ENV|SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1$PROVIDER_SECRETS"`, { PROJECT_ID: 'automathtics-live', ...env });
    assert.equal(decide({ APP_MODE: 'production', PAYMENT_PROVIDER: 'none', APP_ORIGIN: 'https://automathtics.net' }).out.trim(), 'APP_MODE=production,FIREBASE_PROJECT_ID=automathtics-live,APP_ORIGIN=https://automathtics.net,PAYMENT_PROVIDER=none|SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1');
    assert.equal(decide({ PROJECT_ID: 'automathtics-v3-staging' }).out.trim(), `APP_MODE=staging,FIREBASE_PROJECT_ID=automathtics-v3-staging,APP_ORIGIN=https://automathtics-v3-staging.web.app,PAYMENT_PROVIDER=stripe,STRIPE_PRICE_STARTER=${PRICES.STRIPE_PRICE_STARTER},STRIPE_PRICE_FAMILY=${PRICES.STRIPE_PRICE_FAMILY},STRIPE_PRICE_BIG=${PRICES.STRIPE_PRICE_BIG}|SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1,STRIPE_SECRET_KEY=am-v3-stripe-key:1,WEBHOOK_SECRET_STRIPE=am-v3-webhook-stripe:1`, 'nothing exported: staging\'s job, as before');
    for (const [env, words] of [[{ APP_MODE: 'emulator' }, /APP_MODE must be staging or production/], [{ PAYMENT_PROVIDER: 'fake' }, /PAYMENT_PROVIDER must be stripe or none/], [{ APP_ORIGIN: 'https://automathtics.net/' }, /APP_ORIGIN must be https:\/\/host/]]) {
      const r = decide(env); assert.equal(r.code, 1, JSON.stringify(env)); assert.match(r.out, words);
    }
  }
  assert.ok(e.includes('--set-env-vars "APP_MODE=$APP_MODE,FIREBASE_PROJECT_ID=$PROJECT_ID,CONFIRM_PROJECT=$PROJECT_ID,OPERATOR_ID=scheduler@$PROJECT_ID,APP_ORIGIN=$APP_ORIGIN$PROVIDER_ENV"') && e.includes('--set-secrets "SESSION_SECRET=am-v3-session:1,PIN_PEPPER=am-v3-pin-pepper:1$PROVIDER_SECRETS"'));
  assert.ok(g.includes('ENV_VARS="^|^APP_MODE=$APP_MODE|') && g.includes('|APP_ORIGIN=$APP_ORIGIN|') && g.includes('ENV_VARS="$ENV_VARS|PAYMENT_PROVIDER=$PAYMENT_PROVIDER"'));
  assert.ok(!/STRIPE|am-v3-webhook/.test(g), 'the report job never needs a provider secret or a price');
  const h = await read('../scripts/cloudshell/08-deploy-identity.sh');
  for (const s of ['if [[ "${APP_MODE:-staging}" == production ]]; then', 'LIVE_PROJECT_ID', 'LIVE_RUNTIME_SA', 'LIVE_FIREBASE_WEB_API_KEY', 'LIVE_FIREBASE_WEB_APP_ID', 'LIVE_WORKLOAD_IDENTITY_PROVIDER', 'LIVE_DEPLOY_SERVICE_ACCOUNT', 'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_DEPLOY_SERVICE_ACCOUNT']) assert.ok(h.includes(s), s);
});

test('the documents: PAYMENTS.md says what payments not open refuses and keeps, in the page\'s own words; DEPLOY_V3.md says how to move to and deploy a live project, the secrets copied before block B, the LIVE_* variables and the auth domain', async () => {
  const payments = await read('../PAYMENTS.md'), deploy = await read('../DEPLOY_V3.md'), app = await read('../public/app.js');
  for (const s of ['## Payments not open (PAYMENT_PROVIDER=none', 'PAYMENTS_NOT_OPEN', '`POST /api/billing/checkout`', '`POST /api/billing/plan`', '`POST /api/billing/pause`', '`POST /api/billing/resume`', '`POST /api/billing/cancel`',
    '`POST /api/webhooks/{provider}`', '`scripts/support.mjs reprocess`', '`not_applicable`', 'payments: { open: false }', 'FAKE_PAYMENTS_ACK=no-real-money']) assert.ok(payments.includes(s), `PAYMENTS.md: ${s}`);
  for (const sentence of ['Subscriptions are not open yet and your free access continues.', 'Subscriptions are not open yet.']) { assert.ok(payments.includes(sentence), sentence); assert.ok(app.includes(`'${sentence}'`), `app.js says: ${sentence}`); }
  for (const s of ['## Moving to a live project', 'BEFORE block B', 'never generated fresh', 'FRESH_SECRETS=yes', 'PIN_PEPPER_PREVIOUS',
    'gcloud secrets versions access 1 --secret am-v3-session --project automathtics-v3-staging | gcloud secrets create am-v3-session --data-file=- --project automathtics-live',
    'gcloud secrets versions access 1 --secret am-v3-pin-pepper --project automathtics-v3-staging | gcloud secrets create am-v3-pin-pepper --data-file=- --project automathtics-live',
    '## A live project with payments not open (PAYMENT_PROVIDER=none)', 'npm run deploy:live', '`deploy-live`', '`LIVE_PROJECT_ID`', '`LIVE_RUNTIME_SA`', '`LIVE_FIREBASE_WEB_API_KEY`', '`LIVE_FIREBASE_WEB_APP_ID`',
    '`LIVE_WORKLOAD_IDENTITY_PROVIDER`', '`LIVE_DEPLOY_SERVICE_ACCOUNT`', '`LIVE_AUTH_DOMAIN`', 'FIREBASE_AUTH_DOMAIN=automathtics.net', 'Authorized domains', 'APP_ALSO_ORIGINS` may be empty']) assert.ok(deploy.includes(s), `DEPLOY_V3.md: ${s}`);
  assert.ok(deploy.indexOf('## Moving to a live project') < deploy.indexOf('## 6. Activate your test family'));
});
