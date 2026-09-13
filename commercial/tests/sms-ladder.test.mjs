// The SMS resend ladder (functions/ladder.mjs, enforced by the Identity Platform blocking function in
// functions/index.js): the owner's rungs, the run and the day of quiet that ends it, what a record holds, the key
// that never holds the number, and the wiring — the function refuses with SMS_WAIT, the browser turns that into a
// wait, the deploy block and the Hosting config carry it, and the Cloud Run image does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SMS_LADDER_MS, SMS_QUIET_MS, SMS_RECORD_TTL_MS, ladderKey, currentRun, decide, recordSend } from '../functions/ladder.mjs';
import * as browser from '../public/sms-schedule.js';

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR, T0 = 1_700_000_000_000, PEPPER = 'p'.repeat(32);
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

test('the rungs are the owner\'s: three codes 5 seconds apart, then 2 min, 15 min, 1 h, 6 h, 12 h, and a day before the ninth — and that day of quiet starts the ladder over', () => {
  assert.deepEqual([...SMS_LADDER_MS], [5 * SEC, 5 * SEC, 2 * MIN, 15 * MIN, HOUR, 6 * HOUR, 12 * HOUR, DAY]); assert.equal(SMS_QUIET_MS, DAY); assert.equal(SMS_RECORD_TTL_MS, 2 * DAY);
  let now = T0, rec = null;
  const at = () => `+${(now - T0) / SEC} s`;
  const send = (n) => { const v = decide(rec, now); assert.equal(v.allowed, true, `send ${n} at ${at()}`); assert.equal(v.rung, n - 1); rec = recordSend(rec, now); };
  const refused = (wait) => { const v = decide(rec, now); assert.equal(v.allowed, false, `refused at ${at()}`); assert.equal(v.waitMs, wait); assert.equal(v.retryAt, now + wait); };
  send(1);                                                  // at once
  refused(5 * SEC); now += 2 * SEC; refused(3 * SEC);       // two seconds later: three more to wait
  now += 3 * SEC; send(2);                                  // +5 s
  now += 4 * SEC; refused(SEC); now += SEC; send(3);        // +10 s: a burst of three inside a quarter of a minute
  refused(2 * MIN); now += MIN; refused(MIN);               // the fourth waits its two minutes
  now += MIN; send(4);                                      // +2 min 10 s
  now += 14 * MIN; refused(MIN); now += MIN; send(5);       // +17 min 10 s
  now += 59 * MIN; refused(MIN); now += MIN; send(6);       // +1 h 17
  now += 5 * HOUR; refused(HOUR); now += HOUR; send(7);     // +7 h 17
  now += 11 * HOUR; refused(HOUR); now += HOUR; send(8);    // +19 h 17
  const ninth = decide(rec, now); assert.equal(ninth.allowed, false); assert.equal(ninth.waitMs, DAY); assert.equal(ninth.rung, 8);
  now += 23 * HOUR; refused(HOUR);                          // the run is alive: the ninth waits the whole day after the eighth, whatever aged
  now += HOUR; const again = decide(rec, now); assert.equal(again.allowed, true); assert.equal(again.rung, 0, 'a day of quiet ended the run: the first rung again');
  rec = recordSend(rec, now); assert.deepEqual(rec, { sends: [now], count: 1, lastAt: now, expireAt: now + 2 * DAY });
  now += 5 * SEC; send(2); now += 5 * SEC; send(3);        // and the fresh run opens with the same burst of three
});
test('the record outlives every run it can hold: each send renews a two-day expiry, longer than the day of quiet that ends a run and than any rung', () => {
  assert.ok(SMS_RECORD_TTL_MS > SMS_QUIET_MS); assert.ok(SMS_RECORD_TTL_MS > Math.max(...SMS_LADDER_MS));
  let rec = null, now = T0;
  for (const wait of SMS_LADDER_MS.slice(0, -1)) { rec = recordSend(rec, now); assert.equal(rec.expireAt, now + SMS_RECORD_TTL_MS); now += wait; }
  rec = recordSend(rec, now); assert.equal(rec.count, 8, 'eight codes, the most a run holds');
  assert.ok(rec.expireAt > now + SMS_QUIET_MS, 'the record is still there for as long as it can refuse anything');
  assert.equal(decide(rec, now + SMS_QUIET_MS - 1).allowed, false); assert.equal(decide(rec, now + SMS_QUIET_MS).rung, 0);
});
test('inside a run every send counts however old; a day of quiet ends the run; the run ignores future and malformed timestamps; past the eighth rung the wait stays a day', () => {
  // the first three codes yesterday, the fourth just now: the fifth still waits its fifteen minutes
  const slow = recordSend({ sends: [T0, T0 + 30 * SEC, T0 + MIN] }, T0 + 23 * HOUR + 59 * MIN);
  const fifth = decide(slow, T0 + DAY + 5 * MIN); assert.equal(fifth.allowed, false); assert.equal(fifth.rung, 4); assert.equal(fifth.retryAt, T0 + 23 * HOUR + 59 * MIN + 15 * MIN);
  assert.deepEqual(currentRun({ sends: [T0 - 3 * DAY, T0 - DAY - 1, T0 - 10, T0 + 5, 'x', null, 1.5] }, T0), [T0 - DAY - 1, T0 - 10], 'a gap of a day or more ends the run before it');
  assert.equal(decide({ sends: [T0 - DAY] }, T0).rung, 0, 'exactly a day of quiet is quiet enough'); assert.equal(decide({ sends: [T0 - DAY + 1] }, T0).rung, 1);
  for (const empty of [null, undefined, {}, { sends: 'no' }, { sends: [] }, { sends: [T0 + 1] }]) assert.deepEqual(decide(empty, T0), { allowed: true, waitMs: 0, retryAt: T0, rung: 0 });
  const after = recordSend({ sends: [T0 - 2 * DAY, T0 - 10] }, T0); assert.deepEqual(after.sends, [T0 - 10, T0]); assert.equal(after.count, 2); assert.equal(after.lastAt, T0);
  const beyond = decide({ sends: Array.from({ length: 9 }, (_, i) => T0 - 9 * HOUR + i * HOUR) }, T0); assert.equal(beyond.allowed, false); assert.equal(beyond.waitMs, DAY - HOUR); assert.equal(beyond.rung, 9);
});
test('the browser counts down from the same ladder: its table and quiet day are the function\'s, and over any sends its next time, run and kept list are the function\'s own', () => {
  assert.deepEqual([...browser.SMS_LADDER_MS], [...SMS_LADDER_MS], 'public/sms-schedule.js and functions/ladder.mjs must carry the same rungs');
  assert.equal(browser.SMS_QUIET_MS, SMS_QUIET_MS); assert.ok(Object.isFrozen(browser.SMS_LADDER_MS));
  let seed = 11; const pick = (list) => list[(seed = (seed * 1103515245 + 12345) % 2 ** 31) % list.length];
  const gaps = [0, 10 * SEC, 29 * SEC, 30 * SEC, 31 * SEC, 2 * MIN, 15 * MIN, HOUR, 6 * HOUR, 12 * HOUR, DAY - 1, DAY, 2 * DAY];
  for (let i = 0; i < 2000; i++) {
    const sends = []; let t = T0;
    for (let n = pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); n > 0; n--) { t += pick(gaps); sends.push(t); }
    const now = t + pick(gaps), v = decide({ sends }, now);
    assert.equal(browser.nextSendAt(sends, now), v.retryAt, `sends ${sends.map((s) => s - T0)} at ${now - T0}`);
    assert.deepEqual(browser.currentRun(sends, now), currentRun({ sends }, now)); assert.deepEqual(browser.withSend(sends, now), recordSend({ sends }, now).sends);
  }
  // a burst of three within 5 s each is allowed, the fourth waits two minutes: as the device counts it
  const burst = [T0, T0 + 5 * SEC, T0 + 10 * SEC];
  assert.equal(browser.nextSendAt(burst.slice(0, 1), T0 + 2 * SEC), T0 + 5 * SEC); assert.equal(browser.nextSendAt(burst.slice(0, 2), T0 + 5 * SEC), T0 + 10 * SEC);
  assert.equal(browser.nextSendAt(burst, T0 + 10 * SEC), T0 + 10 * SEC + 2 * MIN); assert.equal(browser.nextSendAt([], T0), T0, 'nothing sent: now');
});
test('a refusal\'s seconds are read from the provider\'s code or message in either spelling, and nothing else passes for them', () => {
  assert.equal(browser.refusalSeconds({ code: 'auth/internal-error', message: 'Firebase: HTTP Cloud Function returned an error. Code: 429, Message: SMS_WAIT:768 (auth/internal-error).' }), 768);
  assert.equal(browser.refusalSeconds({ code: 'auth/sms-wait:729', message: 'Firebase: Error (auth/sms-wait:729).' }), 729);
  for (const other of [null, undefined, {}, { code: 'auth/internal-error', message: '' }, { code: 'auth/too-many-requests' }, { message: 'SMS_WAIT:0' }, { message: 'SMS_WAIT:soon' }]) assert.equal(browser.refusalSeconds(other), null, JSON.stringify(other));
});
test('the device keeps its count under an HMAC of the destination with a key made on the device, never the number, records a send only after the provider accepted it, and survives storage that throws', async () => {
  const client = await read('../public/auth.js');
  assert.match(client, /^import \* as ladder from '\/sms-schedule\.js';$/m, 'one schedule, imported from the module the test above holds to the function\'s');
  assert.ok(client.includes("crypto.subtle.sign('HMAC'") && !client.includes("crypto.subtle.digest('SHA-256'"), 'keyed, not a precomputable hash (behaviour: sms-mirror.test.mjs)'); assert.ok(client.includes('`sms:${number}`') && client.includes('`factor:${id}`'), 'the typed number, or the enrolled factor on a challenge');
  for (const line of client.split('\n').filter((l) => l.includes('localStorage.'))) assert.match(line, /try \{[^\n]*localStorage\.[^\n]*\} catch/, `unguarded storage: ${line.trim()}`);
  assert.ok(!client.includes('Wait a minute before requesting another code') && !client.includes('60_000'), 'the flat minute is gone: the ladder\'s own first rungs apply');
  for (const fn of ['sendCode', 'changeMobileSend']) {
    const body = client.slice(client.indexOf(`export async function ${fn}(`)); const end = body.indexOf('\n}\n');
    const own = body.slice(0, end); assert.ok(own.indexOf('spaced(destination(phoneNumber))') < own.indexOf('verifyPhoneNumber'), `${fn}: the device's count is checked before the provider is asked`);
    assert.ok(own.indexOf('verifyPhoneNumber') < own.indexOf('recorded(key)'), `${fn}: recorded only after the provider accepted`);
  }
  assert.match(client, /export async function nextSendAt\(phoneNumber\)/);
});
test('the key is an HMAC of the E.164 number under the pepper: the number is never stored, formatting does not matter, anything else has no key', () => {
  const k = ladderKey(PEPPER, '+6581234567');
  assert.match(k, /^[0-9a-f]{64}$/); assert.equal(ladderKey(PEPPER, '+65 8123-4567'), k); assert.equal(ladderKey(PEPPER, '+65 (8123) 4567'), k);
  assert.notEqual(ladderKey(PEPPER, '+6581234568'), k); assert.notEqual(ladderKey('q'.repeat(32), '+6581234567'), k);
  for (const bad of ['6581234567', '+0123456', '+65', '', null, 42, '+65 8123 4567 x9']) assert.equal(ladderKey(PEPPER, bad), null, String(bad));
  assert.equal(ladderKey('short', '+6581234567'), null, 'no pepper, no key');
});
test('the wiring: the function counts on the number, refuses with SMS_WAIT, writes a TTL timestamp, answers before the provider\'s ceiling and lets the SMS through when the infrastructure fails but not without its pepper, and runs as its own account; the browser turns the refusal into a wait; the deploy block and the config carry it; the image does not', async () => {
  const fn = await read('../functions/index.js');
  for (const s of ['beforeSmsSent(', "defineSecret('AM_V3_SMS_PEPPER')", "defineString('SMS_LADDER_SERVICE_ACCOUNT')", 'collection(COLLECTION)', "const COLLECTION = 'smsLadder'", 'runTransaction', "'resource-exhausted'", 'new Date(next.expireAt)', "smsLadder: 'allowed'", 'timeoutSeconds: 7']) assert.ok(fn.includes(s), s); // 7 s: Identity Platform's ceiling for a blocking function
  const refusal = fn.match(/`SMS_WAIT:[^`]*`/)[0]; assert.ok(!/\s:\s/.test(refusal), 'no " : " inside the refusal: the browser SDK splits the provider message on it');
  // the deadline: no write after 4 s, an answer by 6 s, the SMS allowed on any infrastructure failure (abuse protection must not lock a parent out) — and a deploy without the pepper fails closed
  for (const s of ['DEADLINE_MS = 4000', 'ANSWER_BY_MS = 6000', 'class DeadlineError', 'Promise.race(', 'if (elapsed > DEADLINE_MS) throw new DeadlineError', "smsLadder: 'allowed-on-error'", 'reason: reasonOf(err), ms:', "smsLadder: 'misconfigured'", "reason: 'no pepper'", "new HttpsError('internal', 'SMS_LADDER_MISCONFIGURED')"]) assert.ok(fn.includes(s), s);
  assert.ok(fn.indexOf('if (elapsed > DEADLINE_MS)') < fn.indexOf('tx.set(ref'), 'the deadline is checked before the write is queued');
  assert.match(fn, /catch \(err\) \{[\s\S]*?allowed-on-error[\s\S]*?\n\s*return;\s*\n\s*\}/, 'an infrastructure error ends in an allowance, not a refusal');
  assert.ok(fn.indexOf('SMS_LADDER_MISCONFIGURED') < fn.indexOf('ladderKey(secret, phone)'), 'the pepper is checked before it is used, so a missing one cannot pass as "no usable number"');
  assert.ok(!fn.includes('automathtics-v3-runtime'), 'the function never names the runtime account');
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../functions/index.js', import.meta.url))]);
  const pkg = JSON.parse(await read('../functions/package.json')); assert.equal(pkg.type, 'module'); assert.equal(pkg.main, 'index.js'); assert.equal(pkg.engines.node, '22');
  assert.deepEqual(pkg.dependencies, { 'firebase-admin': '14.3.0', 'firebase-functions': '7.3.2' });
  const lock = JSON.parse(await read('../functions/package-lock.json')); assert.equal(lock.packages['node_modules/firebase-functions'].version, '7.3.2'); assert.equal(lock.packages['node_modules/firebase-admin'].version, '14.3.0');
  const schedule = await read('../public/sms-schedule.js'); assert.match(schedule, /sms\[_-\]wait:\(\\d\+\)/i); // the wait is read from the error code as well as its message
  assert.match(schedule, /error\?\.code[^\n]*error\?\.message/, "the wait is read from the error code as well as its message: a provider string with no \" : \" is folded whole into the code");
  const client = await read('../public/auth.js'); assert.ok(client.includes('ladder.refusalSeconds(error)')); assert.match(client, /Try again when the countdown on the Send button reaches zero/);
  assert.ok((await read('../server/http.mjs')).includes("'/sms-schedule.js': ['sms-schedule.js', 'text/javascript']"), 'the server serves the browser\'s copy of the ladder');
  const cfg = JSON.parse(await read('../firebase.staging.json')); assert.deepEqual(cfg.functions.map((c) => [c.source, c.runtime]), [['functions', 'nodejs22']]); assert.ok(cfg.functions[0].ignore.includes('node_modules'));
  const block = await read('../scripts/cloudshell/06-sms-ladder.sh');
  for (const s of ['AM_V3_SMS_PEPPER', '--only functions', '--collection-group=smsLadder', 'SMS_LADDER_SERVICE_ACCOUNT', 'beforeSendSms', 'roles/secretmanager.secretAccessor', 'x-goog-user-project', 'roles/run.invoker', 'updateMask=blockingFunctions.triggers.beforeSendSms']) assert.ok(block.includes(s), s);
  // its own account: Firestore and the pepper, nothing else; the runtime account (firebaseauth.admin, every server secret) is no longer granted the pepper, and an earlier grant is taken back after the deploy
  for (const s of ['automathtics-v3-sms-ladder@${PROJECT_ID}', 'gcloud iam service-accounts create automathtics-v3-sms-ladder', '--member="serviceAccount:$LADDER_SA" --role=roles/datastore.user', 'add-iam-policy-binding "$SECRET" --project "$PROJECT_ID" --member="serviceAccount:$LADDER_SA"', 'remove-iam-policy-binding "$SECRET" --project "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA"']) assert.ok(block.includes(s), s);
  assert.ok(!/add-iam-policy-binding "\$SECRET"[^\n]*RUNTIME_SA/.test(block), 'the pepper is not granted to the runtime account');
  assert.match(block, /^printf 'SMS_LADDER_SERVICE_ACCOUNT=%s\\n' "\$LADDER_SA"/m, 'the parameter file names the ladder account');
  assert.ok(block.indexOf('firebase deploy') < block.indexOf('remove-iam-policy-binding'), 'the old grant goes only after the function runs as the new account');
  assert.ok((await read('../functions/.env.example')).includes('SMS_LADDER_SERVICE_ACCOUNT=automathtics-v3-sms-ladder@'), 'the example names the ladder account');
  // the TTL policy is verified, not just requested: its state is printed, a missing one is a WARNING and the block says so at the end; a refused pull aborts the block
  const permissions = await read('../scripts/cloudshell/02-permissions.sh');
  assert.match(permissions, /\bsmsLadder\b/, 'a fresh project gets the TTL policy with the others');
  for (const [name, text] of [['02', permissions], ['06', block]]) {
    for (const s of ["--format 'value(ttlConfig.state)'", 'WARNING: no TTL policy', 'DONE WITH WARNINGS']) assert.ok(text.includes(s), `${name}: ${s}`);
    assert.ok(!/--async >\/dev\/null 2>&1/.test(text), `${name}: a refused TTL request is no longer silent`);
  }
  assert.match(block, /^git pull --ff-only -q \|\| \{ echo 'BLOCK F FAILED/m, 'a refused pull aborts block F');
  assert.match(await read('../scripts/cloudshell/03-deploy.sh'), /^git pull --quiet --ff-only \|\| \{ echo 'BLOCK C FAILED/m, 'and block C');
  assert.match(await read('../scripts/cloudshell/01-prepare.sh'), /^npm test 2>&1 \| tail -4 \|\| \{ echo 'BLOCK A FAILED/m, 'a red suite aborts block A (pipefail makes the pipeline status the suite\'s)');
  assert.match(await read('../.gcloudignore'), /^functions$/m, 'the function is not part of the Cloud Run build context');
  assert.match(await read('../.dockerignore'), /^\*$/m, 'and not part of the image');
  assert.match(await read('../.gitignore'), /^\.env\.\*$/m, 'functions/.env.<project> is never committed');
});
