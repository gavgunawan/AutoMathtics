// The weekly report job (email-v1): one email per family for its last complete week, to the owner's verified address, with
// signed buttons and the one-click unsubscribe headers; the claim that keeps it to one under any overlap; the skip rules; a
// failure that fails the run and is retried; the dry run and the preview that send nothing; the CLI's guards; block G; and the
// fake provider's copies going with a deleted family.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fixture, secret } from './support.mjs';
import { grantEntitlement } from '../server/service.mjs';
import { freshProgress } from '../server/progress.mjs';
import { Reports, REPORT_CLAIM_MS, REPORT_TTL_MS } from '../server/report.mjs';
import { createMailer, OUTBOX_TTL_MS } from '../server/mailer.mjs';
import { Fault } from '../server/security.mjs';
import { DELETION_GRACE_MS } from '../server/support.mjs';

const DAY = 86_400_000, ORIGIN = 'https://pilot.example.test', WEEK = '2026-W35'; // the fixture's clock is Sunday 6 Sep 2026: the last complete week is 24–30 Aug
const ans = (l, t, s, ok) => ({ t, l, track: 'engine', s, a: 100, ok: ok ? 1 : 0 });
const times = (n, make) => Array.from({ length: n }, make);
const row = (date, qlog) => ({ ts: 0, date, track: 'engine', mode: 'paper', level: 3, levelId: 'D', papers: '41–45', correct: qlog.filter((x) => x.ok).length, incorrect: 0, timeout: 0, total: qlog.length, passed: qlog.every((x) => x.ok), secs: 700, qlog });
const played = (date = '2026-08-26') => [row(date, times(25, () => ans(3, 3, 40, true)))];
const setFamily = (f, id, patch) => f.store.transaction(async (tx) => { const fam = await tx.get(`families/${id}`); tx.set(`families/${id}`, { ...fam, ...patch }); });
async function home(f, uid, kids = [['Allison', played()]], { timeZone = null } = {}) {
  const a = await f.family(uid, 0);
  await grantEntitlement(f.store, { familyId: a.familyId, seatLimit: 4, accessUntil: f.now() + 30 * DAY, reason: 'synthetic pilot', actor: 'test-operator' }, f.now());
  if (timeZone) await setFamily(f, a.familyId, { timeZone });
  const ids = [];
  for (const [nickname, history] of kids) { const { child } = await f.child(a.ctx, nickname); ids.push(child.id); if (history) await f.store.put(`families/${a.familyId}/learning/${child.id}`, { ...freshProgress(), engine: { level: 3, paper: 41, bossCleared: 2 }, history }); }
  return { ...a, ids };
}
const job = (f, more = {}) => { const mailer = more.mailer || createMailer({ provider: 'fake', store: f.store, now: f.now }); return { mailer, reports: new Reports({ store: f.store, identity: f.identity, secret, origin: ORIGIN, operator: 'test-job', now: f.now, ...more, mailer }) }; };
function decode(token) {
  const [v, body, sig] = token.split('.'), key = createHmac('sha256', secret).update('email-links-v1').digest();
  assert.equal(v, 'v1'); assert.equal(sig, createHmac('sha256', key).update(`v1.${body}`).digest('base64url'), 'signed with the email-link key');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

test('one email for the family\'s last complete week, to the owner\'s verified address: signed buttons, the one-click headers, the idempotency key, a record without content; a second run sends nothing', async () => {
  const f = fixture(), a = await home(f, 'parentA'), { mailer, reports } = job(f);
  const r = await reports.run();
  assert.deepEqual(r.results.map((x) => [x.familyId, x.week, x.status]), [[a.familyId, WEEK, 'sent']]); assert.equal(r.sent, 1); assert.equal(r.failed, 0);
  assert.equal(mailer.sent.length, 1); const m = mailer.sent[0];
  assert.equal(m.to, 'parentA@example.test'); assert.equal(m.subject, 'Allison this week: 1 mission, 100% right'); assert.equal(m.idempotencyKey, `report:${a.familyId}:${WEEK}`);
  assert.deepEqual(m.tags, [{ name: 'kind', value: 'weekly_report' }, { name: 'week', value: WEEK }]); assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const unsub = m.headers['List-Unsubscribe'].match(/^<https:\/\/pilot\.example\.test\/api\/email\/unsubscribe\?t=(v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)>$/)[1];
  assert.deepEqual(decode(unsub), { a: 'unsub', v: 'progress', e: f.now() + 365 * DAY, u: 'parentA', f: a.familyId, w: WEEK });
  const pace = m.html.match(/\?email=(v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"[^>]*>Set Allison’s pace to 75%/)[1];
  assert.deepEqual(decode(pace), { a: 'pace', c: a.ids[0], v: 75, e: f.now() + 14 * DAY, u: 'parentA', f: a.familyId, w: WEEK });
  assert.ok(m.text.includes(`Stop weekly reports: ${ORIGIN}/?email=${unsub}`), 'the footer opens the app with the same token');
  const rec = await f.store.get(`reports/${a.familyId}:${WEEK}`);
  assert.deepEqual(Object.keys(rec).sort(), ['attempts', 'claimId', 'claimedAt', 'createdAt', 'expireAt', 'familyId', 'providerId', 'reason', 'status', 'updatedAt', 'week'], 'status only, no content');
  assert.equal(rec.status, 'sent'); assert.equal(rec.providerId, m.id); assert.equal(rec.attempts, 1); assert.equal(rec.expireAt, f.now() + REPORT_TTL_MS); assert.equal(REPORT_TTL_MS, 400 * DAY);
  const out = await f.store.get(`outbox/${m.id}`); assert.equal(out.familyId, a.familyId); assert.equal(out.expireAt, f.now() + OUTBOX_TTL_MS);
  const again = await reports.run(); assert.deepEqual(again.results.map((x) => [x.status, x.reason]), [['already', 'sent']]); assert.equal(mailer.sent.length, 1);
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'report.run' && x.uid === 'test-job' && x.sent === 1 && x.familyId === null));
});

test('two runs at once send one email: the other finds the week claimed', async () => {
  const f = fixture(), a = await home(f, 'parentA'), mailer = createMailer({ provider: 'fake', store: f.store, now: f.now });
  const [x, y] = await Promise.all([job(f, { mailer }).reports.run(), job(f, { mailer }).reports.run()]);
  const statuses = [x.results[0].status, y.results[0].status];
  assert.equal(mailer.sent.length, 1); assert.equal(statuses.filter((s) => s === 'sent').length, 1); assert.ok(statuses.every((s) => ['sent', 'busy', 'already'].includes(s)), statuses.join());
  assert.equal((await f.store.get(`reports/${a.familyId}:${WEEK}`)).attempts, 1);
});

test('who gets no email: a deleted family, one being deleted, no active entitlement, no seated child, the switch off, no play that week, an address unverified or disabled', async () => {
  const f = fixture();
  const ok = await home(f, 'parentOk'), gone = await home(f, 'parentGone'), going = await home(f, 'parentGoing');
  await setFamily(f, gone.familyId, { deleted: true }); await setFamily(f, going.familyId, { deletion: { status: 'executing', requestedAt: f.now() } });
  const lapsed = await f.family('parentLapsed', 0), empty = await home(f, 'parentEmpty', []), off = await home(f, 'parentOff'), quiet = await home(f, 'parentQuiet', [['Mia', null]]);
  await f.email.setPrefs(off.ctx, { progress: false });
  const unverified = await home(f, 'parentUnverified'), disabled = await home(f, 'parentDisabled');
  f.users.get('parentUnverified').emailVerified = false; f.users.get('parentDisabled').disabled = true;
  const { mailer, reports } = job(f), r = await reports.run(), by = Object.fromEntries(r.results.map((x) => [x.familyId, [x.status, x.reason || null]]));
  const expected = [[ok, 'sent', null], [gone, 'skipped', 'family_deleted'], [going, 'skipped', 'family_deleted'], [lapsed, 'skipped', 'no_entitlement'], [empty, 'skipped', 'no_children'],
    [off, 'skipped', 'progress_off'], [quiet, 'skipped', 'no_play'], [unverified, 'skipped', 'no_verified_address'], [disabled, 'skipped', 'no_verified_address']];
  for (const [fam, status, reason] of expected) assert.deepEqual(by[fam.familyId], [status, reason], reason || status);
  assert.deepEqual(mailer.sent.map((m) => m.to), ['parentOk@example.test']); assert.equal(r.skipped, 8);
  for (const [fam, , reason] of expected.slice(3)) { const rec = await f.store.get(`reports/${fam.familyId}:${WEEK}`); assert.deepEqual([rec.status, rec.reason], ['skipped', reason], reason); }
  for (const fam of [gone, going]) assert.equal(await f.store.get(`reports/${fam.familyId}:${WEEK}`), null, 'a tombstone gets no record');
});

test('a failed send is recorded and fails the run, and the next run retries it; a claim left sending for 15 minutes is taken over, a fresher one left alone; an outcome lands only on its own claim', async () => {
  const f = fixture(), a = await home(f, 'parentA'), fake = createMailer({ provider: 'fake', now: f.now });
  let down = true; const flaky = { send: async (m) => { if (down) throw new Fault(502, 'PROVIDER_UNREACHABLE'); return fake.send(m); } }, { reports } = job(f, { mailer: flaky });
  const first = await reports.run(); assert.equal(first.failed, 1); assert.deepEqual(first.results.map((x) => [x.status, x.reason]), [['failed', 'PROVIDER_UNREACHABLE']]);
  let rec = await f.store.get(`reports/${a.familyId}:${WEEK}`); assert.deepEqual([rec.status, rec.attempts, rec.reason], ['failed', 1, 'PROVIDER_UNREACHABLE']);
  down = false; const second = await reports.run(); assert.equal(second.sent, 1); assert.equal(second.failed, 0);
  rec = await f.store.get(`reports/${a.familyId}:${WEEK}`); assert.deepEqual([rec.status, rec.attempts], ['sent', 2]); assert.equal(fake.sent.length, 1);
  // a run that died mid-send left its claim 'sending': left alone for 15 minutes, then taken over under the same idempotency key
  const b = await home(f, 'parentB'), key = `reports/${b.familyId}:${WEEK}`;
  await f.store.put(key, { familyId: b.familyId, week: WEEK, status: 'sending', claimId: 'run-that-died', claimedAt: f.now() - 5 * 60_000, attempts: 1, providerId: null, reason: null, createdAt: f.now(), updatedAt: f.now(), expireAt: f.now() + REPORT_TTL_MS });
  assert.deepEqual((await reports.run({ familyId: b.familyId })).results.map((x) => [x.status, x.reason]), [['busy', 'claimed_by_another_run']]); assert.equal(fake.sent.length, 1);
  f.advance(REPORT_CLAIM_MS); assert.deepEqual((await reports.run({ familyId: b.familyId })).results.map((x) => x.status), ['sent']);
  assert.equal((await f.store.get(key)).attempts, 2); assert.equal(fake.sent[1].idempotencyKey, `report:${b.familyId}:${WEEK}`, 'the provider sees the dead run\'s key: one email');
  // a newer run took this claim over while the older was still sending: the older's outcome does not overwrite it
  const c = await home(f, 'parentC'), ck = `reports/${c.familyId}:${WEEK}`;
  const racing = { send: async (m) => { await f.store.transaction(async (tx) => { const cur = await tx.get(ck); tx.set(ck, { ...cur, claimId: 'newer-run', status: 'sent', providerId: 'from-the-newer-run' }); }); return fake.send(m); } };
  await job(f, { mailer: racing }).reports.run({ familyId: c.familyId });
  const kept = await f.store.get(ck); assert.deepEqual([kept.claimId, kept.providerId], ['newer-run', 'from-the-newer-run']);
});

test('a dry run decides every family and claims, sends and audits nothing; each family\'s week is its own time zone\'s; one family or one week can be named; nonsense is refused', async () => {
  const f = fixture(); f.advance(13 * 60 * 60_000); // Sunday 23:00 UTC: Monday 07:00 in Singapore, when the job runs; still Sunday in Los Angeles
  const sg = await home(f, 'parentSg', [['Allison', played('2026-09-02')]]), la = await home(f, 'parentLa', [['Geralt', played('2026-08-26')]], { timeZone: 'America/Los_Angeles' });
  const { mailer, reports } = job(f), dry = await reports.run({ dryRun: true }), by = Object.fromEntries(dry.results.map((x) => [x.familyId, [x.week, x.status]]));
  assert.deepEqual(by[sg.familyId], ['2026-W36', 'would_send']); assert.deepEqual(by[la.familyId], ['2026-W35', 'would_send']); assert.equal(dry.wouldSend, 2);
  assert.equal(mailer.sent.length, 0); assert.equal((await f.store.list('reports')).length, 0); assert.ok(!(await f.store.list('audit')).some((x) => x.action === 'report.run'));
  const one = await reports.run({ familyId: la.familyId }); assert.deepEqual(one.results.map((x) => [x.familyId, x.status]), [[la.familyId, 'sent']]); assert.equal(mailer.sent.length, 1);
  const named = await reports.run({ familyId: sg.familyId, week: '2026-W35' }); assert.deepEqual(named.results.map((x) => [x.week, x.status, x.reason]), [['2026-W35', 'skipped', 'no_play']]);
  await assert.rejects(reports.run({ week: '2026-W60' }), (e) => e.code === 'WEEK_INVALID');
  await assert.rejects(reports.run({ familyId: 'not-a-uuid' }), (e) => e.code === 'INVALID_ID');
  await assert.rejects(reports.run({ familyId: randomUUID() }), (e) => e.code === 'FAMILY_NOT_FOUND');
});

test('the operator\'s preview renders with inert links whatever the switches say, and never claims or sends', async () => {
  const f = fixture(), a = await home(f, 'parentA'); await f.email.setPrefs(a.ctx, { progress: false });
  const { mailer, reports } = job(f), p = await reports.preview(a.familyId);
  assert.equal(p.week, WEEK); assert.equal(p.answered, true); assert.ok(p.html.includes('Set Allison’s pace to 75%')); assert.ok(p.html.includes(`${ORIGIN}/?email=preview`)); assert.ok(!/v1\.[A-Za-z0-9_-]+\./.test(p.html), 'no live token');
  assert.equal(mailer.sent.length, 0); assert.equal((await f.store.list('reports')).length, 0);
  await assert.rejects(reports.preview(a.familyId, 'soon'), (e) => e.code === 'WEEK_INVALID'); await assert.rejects(reports.preview(randomUUID()), (e) => e.code === 'FAMILY_NOT_FOUND');
});

test('a family\'s deletion takes the fake provider\'s copies of its reports with it; another family\'s stay', async () => {
  const f = fixture(), a = await home(f, 'parentA'), b = await home(f, 'parentB');
  await job(f).reports.run(); assert.equal((await f.store.list('outbox')).length, 2);
  await f.support.requestDeletion(a.ctx, { operationId: randomUUID() }); f.advance(DELETION_GRACE_MS + 1);
  const record = await f.support.executeDeletion(a.familyId, { operator: 'ops@example.test' });
  assert.deepEqual((await f.store.list('outbox')).map((x) => x.familyId), [b.familyId]); assert.equal(record.counts.outbox, 1);
});

const execFileP = promisify(execFile), CLI = fileURLToPath(new URL('../scripts/report.mjs', import.meta.url));
test('the CLI: its guards run before any SDK loads, it knows send and preview, and exits 2 when a send failed', async () => {
  const src = await readFile(CLI, 'utf8');
  assert.ok(src.indexOf("await import('firebase-admin/app')") > src.indexOf('mailerConfig(env)'), 'the settings are checked before the SDK loads');
  for (const s of ["'send'", "'preview'", "'--dry-run'", "'--week'", "'--family'", 'process.exitCode = 2', 'CONFIRM_PROJECT', 'OPERATOR_ID', 'SESSION_SECRET', 'APP_ORIGIN']) assert.ok(src.includes(s), s);
  const run = (env, args = ['send']) => execFileP(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env } }).then(() => ({ code: 0, err: '' }), (e) => ({ code: e.code, err: String(e.stderr) }));
  assert.match((await run({})).err, /Set APP_MODE/);
  const base = { APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-foundation', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088', SESSION_SECRET: 'a1'.repeat(32), APP_ORIGIN: 'http://127.0.0.1:8787' };
  assert.match((await run({ ...base, SESSION_SECRET: 'short' })).err, /SESSION_SECRET is required/);
  assert.match((await run({ ...base, APP_ORIGIN: 'http://127.0.0.1:8787/' })).err, /APP_ORIGIN/);
  assert.match((await run({ ...base, EMAIL_PROVIDER: 'resend' })).err, /EMAIL_API_KEY/);
  const usage = await run(base, ['bogus']); assert.equal(usage.code, 1); assert.match(usage.err, /Usage: node scripts\/report\.mjs send/);
  const staging = { ...base, APP_MODE: 'staging', FIREBASE_PROJECT_ID: 'automathtics-v3-staging', FIRESTORE_EMULATOR_HOST: '', APP_ORIGIN: 'https://automathtics-v3-staging.web.app' };
  assert.match((await run(staging)).err, /Confirm the exact new project/); assert.match((await run({ ...staging, CONFIRM_PROJECT: 'automathtics-v3-staging' })).err, /Set OPERATOR_ID/);
});

test('block G is block E for the report job: Mondays 07:00 Singapore, the email key only with Resend, TTL on reports and the outbox, a dry run to finish', async () => {
  const g = await readFile(new URL('../scripts/cloudshell/07-report-job.sh', import.meta.url), 'utf8'), e = await readFile(new URL('../scripts/cloudshell/05-sweep-job.sh', import.meta.url), 'utf8');
  for (const s of ['set -uo pipefail', 'JOB=automathtics-v3-report', '--args scripts/report.mjs,send ', 'SCHED=automathtics-v3-report-weekly', "--schedule '0 7 * * 1'", "--time-zone 'Asia/Singapore'", 'SESSION_SECRET=am-v3-session:1',
    'OPERATOR_ID=scheduler@$PROJECT_ID', 'APP_ORIGIN=https://$PROJECT_ID.web.app', 'for GROUP in reports outbox; do', "value(ttlConfig.state)", 'BLOCK G DONE WITH WARNINGS', '--args scripts/report.mjs,send,--dry-run', 'roles/run.invoker']) assert.ok(g.includes(s), s);
  assert.ok(e.includes('--max-retries 0 --task-timeout 20m --memory 512Mi') && g.includes('--max-retries 0 --task-timeout 20m --memory 512Mi'), 'the job shape of block E');
  const code = g.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), start = code.indexOf('if [[ "$EMAIL_PROVIDER" == resend ]]; then'), branch = code.slice(start, code.indexOf('\nfi\n', start));
  assert.ok(branch.includes('EMAIL_API_KEY=am-v3-email-key:1')); assert.equal(code.split('am-v3-email-key').length, branch.split('am-v3-email-key').length, 'the key is named nowhere but the Resend branch');
  assert.ok(!/echo[^\n]*\$\{?EMAIL_API_KEY/.test(g), 'the key is never printed'); assert.ok(!g.includes('PIN_PEPPER'), 'the job has no use for the PIN pepper');
});
