// The move to automathtics-live (the owner's plan of 13 Sep 2026, DEPLOY_V3.md → Moving to a live project). Block I copies staging's
// sign-in rules; block J pauses staging's schedules, copies Firestore and runs scripts/move-auth.mjs, which copies every sign-in account as
// it is — the id, the email, the flags, the password hash with staging's own parameters and the whole mobile of its second factor — and
// compares live with staging. A dry run writes nothing, a rerun imports only what live lacks, an account live holds that staging does not
// stops it, and nothing that identifies a parent (an address, a number, a hash) or the token is ever printed. The script runs here
// against a stand-in Identity Toolkit, loaded before it with --import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importRecords, compare, summary, redact, FROM, TO } from '../scripts/move-auth.mjs';

const execFileP = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('../scripts/move-auth.mjs', import.meta.url));
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
let shell = true; try { execFileSync('bash', ['--version'], { stdio: 'ignore' }); } catch { shell = false; }
const HASH = Object.freeze({ algorithm: 'SCRYPT', signerKey: 'c2lnbmVyLWtleS1zdGFnaW5n', saltSeparator: 'Bw==', rounds: 8, memoryCost: 14 });
const account = (n, more = {}) => ({
  localId: `uid${n}`.padEnd(28, 'x'), email: `parent${n}@example.test`, emailVerified: true, passwordHash: `aGFzaC${n}`, salt: `c2FsdC${n}`,
  createdAt: '1757000000000', lastLoginAt: '1757600000000', providerUserInfo: [{ providerId: 'password', email: `parent${n}@example.test` }],
  mfaInfo: [{ mfaEnrollmentId: `enrol${n}`, displayName: 'Mobile', enrolledAt: '2026-09-01T00:00:00Z', phoneInfo: `+62812345678${n}` }], ...more,
});

test('each staging account as the import takes it: id, email, flags, hash and salt, times and the whole mobile of each second factor, and nothing else; a number that is not whole stops them all', () => {
  const [record] = importRecords([account(1)]);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), {
    localId: account(1).localId, email: 'parent1@example.test', emailVerified: true, passwordHash: 'aGFzaC1', salt: 'c2FsdC1', disabled: false, createdAt: '1757000000000', lastLoginAt: '1757600000000',
    mfaInfo: [{ mfaEnrollmentId: 'enrol1', displayName: 'Mobile', enrolledAt: '2026-09-01T00:00:00Z', phoneInfo: '+628123456781' }],
  });
  assert.ok(!('providerUserInfo' in record), 'the password provider comes with the hash, it is not copied');
  const plain = importRecords([account(2, { mfaInfo: undefined, emailVerified: false, disabled: true, customAttributes: '{"role":"x"}' })])[0];
  assert.deepEqual([plain.emailVerified, plain.disabled, 'mfaInfo' in plain, plain.customAttributes], [false, true, false, '{"role":"x"}']);
  const both = importRecords([account(3, { mfaInfo: [{ mfaEnrollmentId: 'e', phoneInfo: '+62*******6783', unobfuscatedPhoneInfo: '+628123456783' }] })])[0];
  assert.equal(both.mfaInfo[0].phoneInfo, '+628123456783', 'the whole number when the answer carries both');
  for (const phoneInfo of ['+62*******6783', '', undefined, '628123456783', '+0812345678']) {
    assert.throws(() => importRecords([account(1), account(4, { mfaInfo: [{ mfaEnrollmentId: 'e', phoneInfo }] })]), /without a whole mobile number/, String(phoneInfo));
  }
});

test('live against staging, in counts: an account live lacks, one it holds that staging does not, and one that differs in its address, its flags, its password or its mobile; a provider\'s reason loses any address or number', () => {
  const staging = [account(1), account(2), account(3)];
  assert.deepEqual(compare(staging, staging.map((u) => ({ ...u }))), { missing: 0, extra: 0, differing: 0 });
  assert.deepEqual(compare(staging, [account(1), account(2)]), { missing: 1, extra: 0, differing: 0 });
  assert.deepEqual(compare(staging, [...staging, account(9)]), { missing: 0, extra: 1, differing: 0 });
  for (const change of [{ email: 'other@example.test' }, { emailVerified: false }, { disabled: true }, { passwordHash: undefined }, { mfaInfo: [] }, { mfaInfo: [{ phoneInfo: '+628123456789' }] }]) {
    assert.deepEqual(compare(staging, [account(1, change), account(2), account(3)]), { missing: 0, extra: 0, differing: 1 }, JSON.stringify(change));
  }
  assert.deepEqual(summary([account(1), account(2, { emailVerified: false, mfaInfo: undefined }), account(3, { disabled: true, passwordHash: undefined })]),
    { accounts: 3, withPassword: 2, verified: 2, disabled: 1, withPhoneFactor: 2 });
  const said = redact('DUPLICATE_EMAIL : parent1@example.test (+628123456781) at index 12345678');
  assert.ok(!said.includes('@') && !/\d{6}/.test(said), said);
});

// The stand-in: the three Identity Toolkit calls the script makes, over a state file the test writes, logging every request it receives.
const STAND_IN = `import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const load = () => JSON.parse(readFileSync(process.env.FAKE_IDT_STATE, 'utf8'));
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null, state = load();
  appendFileSync(process.env.FAKE_IDT_LOG, JSON.stringify({ origin: u.origin, method, path: u.pathname, max: u.searchParams.get('maxResults'), project: init.headers['x-goog-user-project'], auth: init.headers.Authorization, body }) + '\\n');
  let m;
  if (method === 'GET' && (m = /^\\/admin\\/v2\\/projects\\/([^/]+)\\/config$/.exec(u.pathname))) return state.hash[m[1]] ? answer(200, { hashConfig: state.hash[m[1]] }) : answer(403, { error: { message: 'PERMISSION_DENIED' } });
  if (method === 'GET' && (m = /^\\/v1\\/projects\\/([^/]+)\\/accounts:batchGet$/.exec(u.pathname))) {
    const all = state.users[m[1]] || [], from = Number(u.searchParams.get('nextPageToken') || 0); // pages of two, so the paging is walked
    return answer(200, { ...(all.length ? { users: all.slice(from, from + 2) } : {}), ...(from + 2 < all.length ? { nextPageToken: String(from + 2) } : {}) });
  }
  if (method === 'POST' && (m = /^\\/v1\\/projects\\/([^/]+)\\/accounts:batchCreate$/.exec(u.pathname))) {
    const error = [];
    body.users.forEach((user, index) => { if ((state.refuse || []).includes(user.localId)) error.push({ index, message: 'DUPLICATE_EMAIL : ' + user.email }); else (state.users[m[1]] ||= []).push(user); });
    writeFileSync(process.env.FAKE_IDT_STATE, JSON.stringify(state));
    return answer(200, error.length ? { error } : {});
  }
  return answer(404, { error: { message: 'NOT_FOUND' } });
};
`;
async function standIn(t) {
  const dir = await mkdtemp(join(tmpdir(), 'am-move-auth-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const hook = join(dir, 'identity-toolkit-stand-in.mjs'), state = join(dir, 'state.json'), log = join(dir, 'requests.jsonl');
  await writeFile(hook, STAND_IN); await writeFile(log, '');
  const run = (args = [], env = {}) => execFileP(process.execPath, ['--import', pathToFileURL(hook).href, SCRIPT, ...args], {
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', TOKEN: 'ya29.stand-in-token', FAKE_IDT_STATE: state, FAKE_IDT_LOG: log, ...env },
  }).then((r) => ({ code: 0, out: String(r.stdout), err: String(r.stderr) }), (e) => ({ code: e.code, out: String(e.stdout), err: String(e.stderr) }));
  return {
    run, setState: (s) => writeFile(state, JSON.stringify(s)), getState: async () => JSON.parse(await readFile(state, 'utf8')),
    requests: async () => (await readFile(log, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}
const lines = (r) => r.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const IDENTIFYING = ['parent1@example.test', 'parent2@example.test', '+628123456781', 'aGFzaC1', 'c2FsdC1', HASH.signerKey, 'ya29.stand-in-token'];
const quiet = (r, why) => { for (const s of IDENTIFYING) assert.ok(!(r.out + r.err).includes(s), `${why}: nothing identifying is printed (${s.slice(0, 4)}…)`); };

test('the account copy: a dry run reads both projects and writes nothing; --write imports every account in one batch with staging\'s hash parameters and finds live matching; a rerun imports nothing; nothing identifying is printed', async (t) => {
  const { run, setState, requests } = await standIn(t);
  const staging = [account(1), account(2), account(3, { emailVerified: false, mfaInfo: undefined })];
  await setState({ hash: { [FROM]: HASH }, users: { [FROM]: staging, [TO]: [] } });

  const dry = await run();
  assert.equal(dry.code, 0, dry.err); quiet(dry, 'the dry run');
  assert.deepEqual(lines(dry).map((l) => l.step), ['staging', 'live before', 'dry run']);
  assert.deepEqual(lines(dry)[0], { step: 'staging', accounts: 3, withPassword: 3, verified: 2, disabled: 0, withPhoneFactor: 2 });
  assert.deepEqual(lines(dry)[2], { step: 'dry run', wouldImport: 3, written: 0 });
  let seen = await requests();
  assert.ok(seen.length >= 4 && seen.every((q) => q.method === 'GET'), 'a dry run only reads');
  assert.ok(seen.every((q) => q.origin === 'https://identitytoolkit.googleapis.com' && q.auth === 'Bearer ya29.stand-in-token' && q.path.includes(`/projects/${q.project}/`)), 'the token, and each project as its own quota project');
  assert.ok(seen.filter((q) => q.path.endsWith('accounts:batchGet')).every((q) => q.max === '1000'));

  const wrote = await run(['--write']);
  assert.equal(wrote.code, 0, wrote.err); quiet(wrote, 'the write');
  seen = await requests();
  const posts = seen.filter((q) => q.method === 'POST');
  assert.deepEqual(posts.map((q) => [q.path, q.project]), [[`/v1/projects/${TO}/accounts:batchCreate`, TO]], 'one batch, to live');
  const { users, ...params } = posts[0].body;
  assert.deepEqual(params, { hashAlgorithm: 'SCRYPT', signerKey: HASH.signerKey, saltSeparator: HASH.saltSeparator, rounds: 8, memoryCost: 14, sanityCheck: true });
  assert.deepEqual(users, JSON.parse(JSON.stringify(importRecords(staging))), 'every account, as importRecords makes it');
  assert.deepEqual(lines(wrote).at(-1), { step: 'live after', accounts: 3, withPassword: 3, verified: 2, disabled: 0, withPhoneFactor: 2, missing: 0, extra: 0, differing: 0, matchesStaging: true });

  const again = await run(['--write']);
  assert.equal(again.code, 0, again.err);
  assert.equal((await requests()).filter((q) => q.method === 'POST').length, 1, 'a rerun finds nothing to import');
  assert.equal(lines(again).at(-1).matchesStaging, true);
});

test('the account copy stops before writing when live holds an account staging does not, when a mobile is not whole, when staging\'s hash parameters cannot be read, without a token or with a stray argument; an account the provider refuses is counted with its reason redacted, exit 2, and the rerun imports only it', async (t) => {
  const { run, setState, getState, requests } = await standIn(t);
  const staging = [account(1), account(2), account(3)];
  await setState({ hash: { [FROM]: HASH }, users: { [FROM]: staging, [TO]: [account(9)] } });
  let r = await run(['--write']);
  assert.equal(r.code, 1); assert.match(r.err, /holds sign-in accounts staging does not/); quiet(r, 'an extra account');
  await setState({ hash: { [FROM]: HASH }, users: { [FROM]: [account(1), account(2, { mfaInfo: [{ mfaEnrollmentId: 'e', phoneInfo: '+62*******6782' }] })], [TO]: [] } });
  r = await run(['--write']);
  assert.equal(r.code, 1); assert.match(r.err, /without a whole mobile number/);
  await setState({ hash: { [FROM]: { algorithm: 'HMAC_SHA256', signerKey: 'x' } }, users: { [FROM]: staging, [TO]: [] } });
  r = await run(['--write']);
  assert.equal(r.code, 1); assert.match(r.err, /hash parameters could not be read/);
  await setState({ hash: {}, users: { [FROM]: staging, [TO]: [] } });
  r = await run(['--write']);
  assert.equal(r.code, 1); assert.match(r.err, /GET \/admin\/v2\/projects\/automathtics-v3-staging\/config answered 403/);
  assert.equal((await requests()).filter((q) => q.method === 'POST').length, 0, 'none of those wrote anything');
  assert.match((await run(['--write'], { TOKEN: '' })).err, /Set TOKEN=/);
  for (const args of [['--Write'], ['--write', '--write'], ['write']]) assert.equal((await run(args)).code, 64, args.join(' '));

  await setState({ hash: { [FROM]: HASH }, users: { [FROM]: staging, [TO]: [] }, refuse: [staging[1].localId] });
  r = await run(['--write']);
  assert.equal(r.code, 2, r.err); quiet(r, 'a refused account');
  const imported = lines(r).find((l) => l.step === 'imported');
  assert.deepEqual([imported.count, imported.failed, imported.reasons.length], [2, 1, 1]); assert.ok(!imported.reasons[0].includes('@'), imported.reasons[0]);
  assert.deepEqual([lines(r).at(-1).missing, lines(r).at(-1).matchesStaging], [1, false]);
  const { refuse, ...rest } = await getState(); assert.ok(refuse); await setState(rest);
  r = await run(['--write']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual((await requests()).filter((q) => q.method === 'POST').at(-1).body.users.map((u) => u.localId), [staging[1].localId], 'the rerun imports only the account live still lacks');
  assert.equal(lines(r).at(-1).matchesStaging, true);
});

test('block I copies staging\'s password policy, enumeration protection and SMS allow-list and nothing else, names the four hosts sign-in may run on, changes nothing on live when staging is not set up, and prints no hash parameter; block J needs CONFIRM_MOVE, pauses staging\'s schedules before the export, removes the bucket whatever happened, then copies the accounts', async () => {
  const i = await read('../scripts/cloudshell/09-live-sign-in.sh'), j = await read('../scripts/cloudshell/10-move-to-live.sh');
  const programs = [...i.matchAll(/node -e '([\s\S]*?)'/g)].map((m) => m[1]);
  assert.equal(programs.length, 2, 'block I\'s two node programs');
  const node = (program, input) => {
    try { return { code: 0, out: execFileSync(process.execPath, ['-e', program], { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString() }; } catch (e) { return { code: e.status, out: String(e.stdout) }; }
  };
  const staging = {
    hashConfig: { algorithm: 'SCRYPT', signerKey: 'SIGNERKEY', saltSeparator: 'SALTSEPARATOR' }, mfa: { state: 'ENABLED' }, authorizedDomains: ['automathtics.net', 'automathtics-v3-staging.web.app'],
    passwordPolicyConfig: { passwordPolicyEnforcementState: 'ENFORCE', passwordPolicyVersions: [{ customStrengthOptions: { minPasswordLength: 12 }, schemaVersion: 1 }], lastUpdateTime: '2026-09-01T00:00:00Z' },
    emailPrivacyConfig: { enableImprovedEmailPrivacy: true }, smsRegionConfig: { allowlistOnly: { allowedRegions: ['SG', 'ID', 'MY'] } },
  };
  const body = node(programs[0], JSON.stringify(staging));
  assert.equal(body.code, 0);
  assert.deepEqual(JSON.parse(body.out), {
    passwordPolicyConfig: { passwordPolicyEnforcementState: 'ENFORCE', passwordPolicyVersions: [{ customStrengthOptions: { minPasswordLength: 12 } }], forceUpgradeOnSignin: false },
    emailPrivacyConfig: { enableImprovedEmailPrivacy: true }, smsRegionConfig: { allowlistOnly: { allowedRegions: ['SG', 'ID', 'MY'] } },
    authorizedDomains: ['localhost', 'automathtics-live.firebaseapp.com', 'automathtics-live.web.app', 'automathtics.net'],
  });
  for (const broken of [{ passwordPolicyConfig: { passwordPolicyEnforcementState: 'OFF' } }, { emailPrivacyConfig: {} }, { smsRegionConfig: { allowlistOnly: { allowedRegions: [] } } }, { smsRegionConfig: undefined }]) {
    assert.deepEqual(Object.values(node(programs[0], JSON.stringify({ ...staging, ...broken }))), [3, ''], JSON.stringify(broken));
  }
  const shown = node(programs[1], JSON.stringify({ ...staging, authorizedDomains: ['localhost', 'automathtics.net'] }));
  assert.equal(shown.code, 0); assert.ok(!/SIGNERKEY|SALTSEPARATOR|hashConfig/.test(shown.out), 'the answer carries the hash parameters, and they are not printed');
  assert.match(shown.out, /"policy":"ENFORCE","minLength":12,"enumerationProtection":true,"smsRegions":\["SG","ID","MY"\],"secondFactor":"ENABLED","domains":\["localhost","automathtics.net"\]/);
  for (const s of ['FROM=automathtics-v3-staging TO=automathtics-live', 'updateMask=passwordPolicyConfig,emailPrivacyConfig,smsRegionConfig,authorizedDomains', 'x-goog-user-project: $FROM', 'x-goog-user-project: $TO', 'unset TOKEN BODY', '"$PROJECT_ID" == "$TO"']) {
    assert.ok(i.includes(s), `block I: ${s}`);
  }

  const at = (s) => { const k = j.indexOf(s); assert.ok(k >= 0, `block J: ${s}`); return k; };
  const order = ['gcloud scheduler jobs pause "$SCHED" --project "$FROM"', 'gcloud firestore export "$BUCKET/staging" --project "$FROM"', 'gcloud firestore import "$BUCKET/staging" --project "$TO"',
    'gcloud storage rm --recursive "$BUCKET"', '[[ $COPIED == 1 ]] ||', 'node scripts/move-auth.mjs --write'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'paused, exported, imported, the bucket removed, the copy checked, then the accounts');
  for (const s of ['FROM=automathtics-v3-staging TO=automathtics-live REGION=asia-southeast1', 'for SCHED in automathtics-v3-sweep-nightly automathtics-v3-report-weekly; do', '--role roles/storage.admin',
    'gcp-sa-firestore.iam.gserviceaccount.com', '--location "$REGION" --uniform-bucket-level-access', 'git pull -q --ff-only']) at(s);
  assert.ok(!/firestore (export|import)[^\n]*--async/.test(j), 'the copy waits for each operation');
  if (shell) {
    const find = (start) => { const l = j.split('\n').find((x) => x.startsWith(start)); assert.ok(l, start); return l; };
    const guard = ['set -uo pipefail', find('FROM='), find('stop()'), find('[[ "${CONFIRM_MOVE:-}"'), 'echo past the guard'].join('\n');
    const bash = (env) => { try { return { code: 0, out: execFileSync('bash', ['-c', guard], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env }, stdio: 'pipe' }).toString() }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
    for (const value of [undefined, '', 'automathtics-v3-staging', 'automathtics-live ', 'yes']) {
      const r = bash(value === undefined ? {} : { CONFIRM_MOVE: value });
      assert.equal(r.code, 1, String(value)); assert.match(r.out, /BLOCK J FAILED: set CONFIRM_MOVE=automathtics-live/); assert.ok(!r.out.includes('past the guard'));
    }
    assert.deepEqual(bash({ CONFIRM_MOVE: 'automathtics-live' }), { code: 0, out: 'past the guard\n' });
  }
});

test('DEPLOY_V3.md says how the move runs: the Secret Manager API before the copy, block I, block J with CONFIRM_MOVE, and the cutover in order', async () => {
  const deploy = await read('../DEPLOY_V3.md');
  for (const s of ['gcloud services enable secretmanager.googleapis.com --project automathtics-live', '09-live-sign-in.sh', 'CONFIRM_MOVE=automathtics-live source <(curl', 'scripts/move-auth.mjs', '### The cutover']) {
    assert.ok(deploy.includes(s), s);
  }
  assert.ok(!deploy.includes('It is not in these blocks.'), 'the data is in block J now');
});
