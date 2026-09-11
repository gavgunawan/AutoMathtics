// The weekly report job (email-v1): one email per family for the run's week, to the owner's verified address, with signed buttons
// and the one-click unsubscribe headers; the claim that keeps it to one under any overlap; the skip rules; failures that fail the
// run and are retried (an identity outage among them) while one family's error never ends the run; retries that Resend's
// Idempotency-Key recognises; the dry run and the preview that send nothing; the CLI's strict arguments and its guards; block G;
// and the fake provider's copies going with a deleted family.
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
import { Reports, REPORT_CLAIM_MS, REPORT_TTL_MS, REPORT_TIME_ZONE } from '../server/report.mjs';
import { createMailer, OUTBOX_TTL_MS } from '../server/mailer.mjs';
import { linkExpiry } from '../server/email.mjs';
import { Fault } from '../server/security.mjs';
import { DELETION_GRACE_MS } from '../server/support.mjs';

// the fixture's clock is Sunday 6 Sep 2026, 18:00 in Singapore: the last complete ISO week there is 24–30 Aug
const DAY = 86_400_000, ORIGIN = 'https://pilot.example.test', WEEK = '2026-W35', KEY = `re_${'Ab12Cd34'.repeat(3)}`;
const ans = (l, t, s, ok) => ({ t, l, track: 'engine', s, a: 100, ok: ok ? 1 : 0 });
const times = (n, make) => Array.from({ length: n }, make);
const row = (date, qlog) => ({ ts: 0, date, track: 'engine', mode: 'paper', level: 3, levelId: 'D', papers: '41–45', correct: qlog.filter((x) => x.ok).length, incorrect: 0, timeout: 0, total: qlog.length, passed: qlog.every((x) => x.ok), secs: 700, qlog });
const played = (date = '2026-08-26') => [row(date, times(25, () => ans(3, 3, 40, true)))];
const setFamily = (f, id, patch) => f.store.transaction(async (tx) => { const fam = await tx.get(`families/${id}`); tx.set(`families/${id}`, { ...fam, ...patch }); });
const byFamily = (r) => Object.fromEntries(r.results.map((x) => [x.familyId, [x.status, x.reason ?? null]]));
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
// Resend, as its documentation describes the Idempotency-Key: the same key and the same body get the first answer back; another
// body under the key is refused (409 invalid_idempotent_request), and so is a key whose first request is still being handled
// (409 concurrent_idempotent_requests). drop() loses the next answer on its way back, after Resend has taken the email.
function resendLike() {
  const keys = new Map(), delivered = [], reply = (status, json) => ({ ok: status < 400, status, json: async () => json }); let drop = false;
  const fetch = async (url, init) => {
    const key = init.headers['Idempotency-Key'], seen = keys.get(key);
    if (seen?.pending) return reply(409, { statusCode: 409, name: 'concurrent_idempotent_requests', message: 'Same idempotency key used while original request is still in progress.' });
    if (seen) return seen.body === init.body ? reply(200, seen.answer) : reply(409, { statusCode: 409, name: 'invalid_idempotent_request', message: 'Same idempotency key used with a different request payload.' });
    const answer = { id: `em_${delivered.length + 1}` }; keys.set(key, { body: init.body, answer }); delivered.push(JSON.parse(init.body));
    if (drop) { drop = false; throw Error('socket hang up'); }
    return reply(200, answer);
  };
  return { fetch, delivered, keys, drop: () => { drop = true; } };
}

test('one email for the week, to the owner\'s verified address: buttons that expire with the week, the one-click headers, the idempotency key, a record without content; a second run sends nothing', async () => {
  const f = fixture(), a = await home(f, 'parentA'), { mailer, reports } = job(f);
  const r = await reports.run();
  assert.equal(r.week, WEEK); assert.equal(REPORT_TIME_ZONE, 'Asia/Singapore');
  assert.deepEqual(r.results.map((x) => [x.familyId, x.week, x.status]), [[a.familyId, WEEK, 'sent']]); assert.equal(r.sent, 1); assert.equal(r.failed, 0);
  assert.equal(mailer.sent.length, 1); const m = mailer.sent[0];
  assert.equal(m.to, 'parentA@example.test'); assert.equal(m.subject, 'Allison this week: 1 mission, 100% right'); assert.equal(m.idempotencyKey, `report:${a.familyId}:${WEEK}`);
  assert.deepEqual(m.tags, [{ name: 'kind', value: 'weekly_report' }, { name: 'week', value: WEEK }]); assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const unsub = m.headers['List-Unsubscribe'].match(/^<https:\/\/pilot\.example\.test\/api\/email\/unsubscribe\?t=(v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)>$/)[1];
  assert.deepEqual(decode(unsub), { a: 'unsub', v: 'progress', u: 'parentA', f: a.familyId, w: WEEK, e: linkExpiry('unsub', WEEK) });
  assert.equal(linkExpiry('unsub', WEEK), Date.UTC(2026, 7, 31) + 365 * DAY, 'the Monday after the week, plus a year: from the week, not the clock');
  const pace = m.html.match(/"https:\/\/pilot\.example\.test\/#email=(v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"[^>]*>Set Allison’s pace to 75%/)[1];
  assert.deepEqual(decode(pace), { a: 'pace', c: a.ids[0], v: 75, u: 'parentA', f: a.familyId, w: WEEK, e: linkExpiry('pace', WEEK) });
  assert.ok(m.text.includes(`Stop weekly reports: ${ORIGIN}/#email=${unsub}`), 'the footer opens the app with the same token, in the fragment');
  assert.ok(!/\?email=/.test(m.html + m.text), 'no button puts its token where a request log would keep it');
  const rec = await f.store.get(`reports/${a.familyId}:${WEEK}`);
  assert.deepEqual(Object.keys(rec).sort(), ['attempts', 'claimId', 'claimedAt', 'createdAt', 'expireAt', 'familyId', 'providerId', 'reason', 'status', 'updatedAt', 'week'], 'status only, no content');
  assert.equal(rec.status, 'sent'); assert.equal(rec.providerId, m.id); assert.equal(rec.attempts, 1); assert.equal(rec.expireAt, f.now() + REPORT_TTL_MS); assert.equal(REPORT_TTL_MS, 400 * DAY);
  const out = await f.store.get(`outbox/${m.id}`); assert.equal(out.familyId, a.familyId); assert.equal(out.expireAt, f.now() + OUTBOX_TTL_MS);
  const again = await reports.run(); assert.deepEqual(again.results.map((x) => [x.status, x.reason]), [['already', 'sent']]); assert.equal(mailer.sent.length, 1);
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'report.run' && x.uid === 'test-job' && x.sent === 1 && x.familyId === null && x.week === WEEK));
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
  const { mailer, reports } = job(f), r = await reports.run(), by = byFamily(r);
  const expected = [[ok, 'sent', null], [gone, 'skipped', 'family_deleted'], [going, 'skipped', 'family_deleted'], [lapsed, 'skipped', 'no_entitlement'], [empty, 'skipped', 'no_children'],
    [off, 'skipped', 'progress_off'], [quiet, 'skipped', 'no_play'], [unverified, 'skipped', 'no_verified_address'], [disabled, 'skipped', 'no_verified_address']];
  for (const [fam, status, reason] of expected) assert.deepEqual(by[fam.familyId], [status, reason], reason || status);
  assert.deepEqual(mailer.sent.map((m) => m.to), ['parentOk@example.test']); assert.equal(r.skipped, 8);
  for (const [fam, , reason] of expected.slice(3)) { const rec = await f.store.get(`reports/${fam.familyId}:${WEEK}`); assert.deepEqual([rec.status, rec.reason], ['skipped', reason], reason); }
  for (const fam of [gone, going]) assert.equal(await f.store.get(`reports/${fam.familyId}:${WEEK}`), null, 'a tombstone gets no record');
});

test('an identity lookup that fails is an outage, not an answer: that family fails and the next run sends; only an account the provider no longer has is skipped for good', async () => {
  const f = fixture(), a = await home(f, 'parentA'), b = await home(f, 'parentB'), { mailer, reports } = job(f);
  f.auth.beforeGetUser = async (uid) => { if (uid === 'parentA') throw Object.assign(Error('Internal error encountered.'), { code: 'auth/internal-error' }); };
  f.users.delete('parentB'); // the sign-in account is gone at the provider
  let r = await reports.run(), by = byFamily(r);
  assert.deepEqual(by[a.familyId], ['failed', 'IDENTITY_UNAVAILABLE']); assert.deepEqual(by[b.familyId], ['skipped', 'no_verified_address']);
  assert.equal(r.failed, 1, 'the run fails: exit 2'); assert.equal(mailer.sent.length, 0);
  assert.equal((await f.store.get(`reports/${a.familyId}:${WEEK}`)).status, 'failed');
  f.auth.beforeGetUser = null; r = await reports.run(); by = byFamily(r);
  assert.deepEqual(by[a.familyId], ['sent', null]); assert.deepEqual(by[b.familyId], ['already', 'skipped']);
  assert.deepEqual(mailer.sent.map((m) => m.to), ['parentA@example.test']);
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

test('one family\'s error never ends the run: the family is recorded as failed where the store allows, the others are sent, and the run reports the failure', async () => {
  const f = fixture(), a = await home(f, 'parentA'), b = await home(f, 'parentB'), c = await home(f, 'parentC'), { mailer, reports } = job(f);
  const claim = reports.claim.bind(reports), links = reports.links.bind(reports);
  reports.claim = async (key, ...rest) => { if (key.includes(b.familyId)) throw Error('the store is unavailable'); return claim(key, ...rest); };
  reports.links = (uid, familyId, report) => { if (familyId === c.familyId) throw new TypeError('a rendering bug'); return links(uid, familyId, report); };
  const r = await reports.run(), by = byFamily(r);
  assert.deepEqual(by[a.familyId], ['sent', null]); assert.deepEqual(by[b.familyId], ['failed', 'ERROR']); assert.deepEqual(by[c.familyId], ['failed', 'ERROR'], 'a code, never the message');
  assert.equal(r.failed, 2); assert.deepEqual(mailer.sent.map((m) => m.to), ['parentA@example.test']);
  assert.equal(await f.store.get(`reports/${b.familyId}:${WEEK}`), null, 'no claim could be written for B');
  const rc = await f.store.get(`reports/${c.familyId}:${WEEK}`); assert.deepEqual([rc.status, rc.reason], ['failed', 'ERROR'], 'C is recorded, so the next run retries it');
  reports.claim = claim; reports.links = links;
  const again = await reports.run(); assert.equal(again.sent, 2); assert.equal(again.failed, 0); assert.equal(again.already, 1);
});

test('a retry renders the same bytes, so Resend\'s Idempotency-Key answers it as the same email; an email that changed under its key, or one still in flight, is sent but unconfirmed and never sent again', async () => {
  const f = fixture(), resend = resendLike(), mailer = createMailer({ provider: 'resend', apiKey: KEY, fetch: resend.fetch }), { reports } = job(f, { mailer });
  const a = await home(f, 'parentA');
  resend.drop(); let r = await reports.run();
  assert.deepEqual(r.results.map((x) => [x.status, x.reason]), [['failed', 'PROVIDER_UNREACHABLE']]); assert.equal(resend.delivered.length, 1, 'Resend has it; the answer was lost');
  f.advance(3 * 60 * 60_000); // three hours on: every expiry in the email follows from the week, so nothing in it moved
  r = await reports.run(); assert.deepEqual(r.results.map((x) => [x.status, x.providerId]), [['sent', 'em_1']]); assert.equal(resend.delivered.length, 1, 'one email, not two');
  assert.equal((await f.store.get(`reports/${a.familyId}:${WEEK}`)).providerId, 'em_1');
  // between two attempts the parent set another pace, so the email is not the same: Resend refuses the key, the email is there
  const b = await home(f, 'parentB'); resend.drop(); await reports.run({ familyId: b.familyId }); assert.equal(resend.delivered.length, 2);
  f.advance(1000); const parent = await f.login('parentB'); await f.game.settings(parent.ctx, { childId: b.ids[0], pacePercent: 120 });
  r = await reports.run({ familyId: b.familyId });
  assert.deepEqual(r.results.map((x) => [x.status, x.reason]), [['sent_unconfirmed', 'invalid_idempotent_request']]); assert.equal(r.failed, 0); assert.equal(r.unconfirmed, 1); assert.equal(resend.delivered.length, 2);
  assert.deepEqual((await reports.run({ familyId: b.familyId })).results.map((x) => [x.status, x.reason]), [['already', 'sent_unconfirmed']], 'final: never sent again');
  const c = await home(f, 'parentC'); resend.keys.set(`report:${c.familyId}:${WEEK}`, { pending: true }); // another run's request under this key is still in flight
  assert.deepEqual((await reports.run({ familyId: c.familyId })).results.map((x) => [x.status, x.reason]), [['sent_unconfirmed', 'concurrent_idempotent_requests']]);
});

test('a dry run decides every family and claims, sends and audits nothing; the week is Singapore\'s last complete one for every family, each family\'s answers counted by its own dates; one family or one week can be named; nonsense is refused', async () => {
  const f = fixture(); f.advance(13 * 60 * 60_000); // Sunday 23:00 UTC: Monday 07:00 in Singapore when the job runs, still Sunday afternoon in Los Angeles
  const sg = await home(f, 'parentSg', [['Allison', played('2026-09-02')]]);
  const la = await home(f, 'parentLa', [['Geralt', played('2026-09-06')]], { timeZone: 'America/Los_Angeles' }); // its Sunday: inside the week
  const early = await home(f, 'parentEarly', [['Mia', played('2026-08-30')]], { timeZone: 'America/Los_Angeles' }); // the Sunday before: outside it
  const { mailer, reports } = job(f), dry = await reports.run({ dryRun: true }), by = Object.fromEntries(dry.results.map((x) => [x.familyId, [x.week, x.status, x.reason ?? null]]));
  assert.equal(dry.week, '2026-W36', 'one week for the whole run, whatever the family\'s zone');
  assert.deepEqual(by[sg.familyId], ['2026-W36', 'would_send', null]); assert.deepEqual(by[la.familyId], ['2026-W36', 'would_send', null]); assert.deepEqual(by[early.familyId], ['2026-W36', 'skipped', 'no_play']);
  assert.equal(dry.wouldSend, 2); assert.equal(mailer.sent.length, 0); assert.equal((await f.store.list('reports')).length, 0); assert.ok(!(await f.store.list('audit')).some((x) => x.action === 'report.run'));
  const one = await reports.run({ familyId: la.familyId }); assert.deepEqual(one.results.map((x) => [x.familyId, x.status]), [[la.familyId, 'sent']]); assert.equal(mailer.sent.length, 1);
  const named = await reports.run({ familyId: sg.familyId, week: '2026-W35' }); assert.deepEqual(named.results.map((x) => [x.week, x.status, x.reason]), [['2026-W35', 'skipped', 'no_play']]);
  await assert.rejects(reports.run({ week: '2026-W60' }), (e) => e.code === 'WEEK_INVALID');
  await assert.rejects(reports.run({ familyId: 'not-a-uuid' }), (e) => e.code === 'INVALID_ID');
  await assert.rejects(reports.run({ familyId: randomUUID() }), (e) => e.code === 'FAMILY_NOT_FOUND');
});

test('the operator\'s preview renders with inert links whatever the switches say, and never claims or sends', async () => {
  const f = fixture(), a = await home(f, 'parentA'); await f.email.setPrefs(a.ctx, { progress: false });
  const { mailer, reports } = job(f), p = await reports.preview(a.familyId);
  assert.equal(p.week, WEEK); assert.equal(p.answered, true); assert.ok(p.html.includes('Set Allison’s pace to 75%')); assert.ok(p.html.includes(`${ORIGIN}/#email=preview`)); assert.ok(!/v1\.[A-Za-z0-9_-]+\./.test(p.html), 'no live token');
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
const cli = (env, args = ['send']) => execFileP(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env } }).then(() => ({ code: 0, err: '' }), (e) => ({ code: e.code, err: String(e.stderr) }));
test('the CLI reads its arguments strictly and first (exit 64, never a wider run), then its guards before any SDK loads; a failed send exits 2', async () => {
  const src = await readFile(CLI, 'utf8');
  assert.ok(src.indexOf('const args = parse(process.argv.slice(2))') < src.indexOf('const env = process.env'), 'the arguments come first');
  assert.ok(src.indexOf("await import('firebase-admin/app')") > src.indexOf('mailerConfig(env)'), 'the settings are checked before the SDK loads');
  for (const s of ['send: {', 'preview: {', "'--dry-run'", "'--week'", "'--family'", 'process.exit(64)', 'process.exitCode = 2', 'CONFIRM_PROJECT', 'OPERATOR_ID', 'SESSION_SECRET', 'APP_ORIGIN']) assert.ok(src.includes(s), s);
  for (const args of [['send', '--family'], ['send', '--week'], ['send', '--weekly', '2026-W36'], ['send', 'everyone'], ['send', '--dry-run', '--dry-run'], ['send', '--family', '--dry-run'],
    ['send', '--week', '2026-W36', '--week', '2026-W35'], ['preview'], ['preview', 'one', 'two'], ['preview', 'one', '--family', 'two'], ['bogus'], []]) {
    const r = await cli({}, args); assert.equal(r.code, 64, args.join(' ') || '(nothing)'); assert.match(r.err, /Usage: node scripts\/report\.mjs send/);
  }
  assert.match((await cli({})).err, /Set APP_MODE/, 'good arguments: then the environment');
  const base = { APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-foundation', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088', SESSION_SECRET: 'a1'.repeat(32), APP_ORIGIN: 'http://127.0.0.1:8787' };
  assert.match((await cli({ ...base, SESSION_SECRET: 'short' })).err, /SESSION_SECRET is required/);
  assert.match((await cli({ ...base, APP_ORIGIN: 'http://127.0.0.1:8787/' })).err, /APP_ORIGIN/);
  assert.match((await cli({ ...base, EMAIL_PROVIDER: 'resend' })).err, /EMAIL_API_KEY/);
  const staging = { ...base, APP_MODE: 'staging', FIREBASE_PROJECT_ID: 'automathtics-v3-staging', FIRESTORE_EMULATOR_HOST: '', APP_ORIGIN: 'https://automathtics-v3-staging.web.app' };
  assert.match((await cli(staging)).err, /Confirm the exact new project/); assert.match((await cli({ ...staging, CONFIRM_PROJECT: 'automathtics-v3-staging' })).err, /Set OPERATOR_ID/);
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
