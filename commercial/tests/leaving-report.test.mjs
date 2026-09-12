// Leaving, part five: the monthly report to the owner. Its arithmetic over a synthetic month — volume, each as a share of the
// families that were active when the month began, the reasons ranked, offers shown against offers taken, the plan, seat and cohort
// mixes, and the three months before for the trend — the claim that keeps it to one email a month, the month in which nothing
// happened that sends nothing, and the CLI's own guards and the monthly pass that runs it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fixture } from './support.mjs';
import { grantEntitlement } from '../server/service.mjs';
import { createMailer } from '../server/mailer.mjs';
import { LeavingReports, renderLeavingReport, monthName, REASON_WORDS, OFFER_WORDS, LEAVING_REPORT_KEY, TREND_MONTHS } from '../server/leaving-report.mjs';
import { REPORT_CLAIM_MS, REPORT_TTL_MS, isMonthlySendWeek, monthlyLeavingMonth } from '../server/report.mjs';
import { LEAVING_TTL_MS, monthKey } from '../server/leaving.mjs';

const DAY = 86_400_000, OWNER = 'owner@example.test';
const AUG = Date.UTC(2026, 7, 10), MONTH = '2026-08';
/** A family created in `cohort`, active from `activeFrom` for `days`, with the leaving records given. */
async function family(f, uid, { createdAt, activeFrom = createdAt, days = 400, records = [] } = {}) {
  const a = await f.family(uid, 0);
  await f.store.transaction(async (tx) => { const fam = await tx.get(`families/${a.familyId}`); tx.set(`families/${a.familyId}`, { ...fam, createdAt }); });
  if (days > 0) await grantEntitlement(f.store, { familyId: a.familyId, seatLimit: 4, accessUntil: activeFrom + days * DAY, reason: 'synthetic pilot', actor: 'test-operator' }, activeFrom);
  for (const rec of records) await f.store.put(`families/${a.familyId}/leaving/${rec.id || randomUUID()}`, { reason: 'something_else', action: 'cancel', offersShown: [], offerAccepted: null, freeText: null, cadence: null, months: null, toPlan: null, plan: 'family', seats: 4, state: 'active', cohort: monthKey(createdAt), source: 'app', outcome: 'done', expireAt: rec.at + LEAVING_TTL_MS, ...rec });
  return a;
}
const job = (f, more = {}) => { const mailer = more.mailer || createMailer({ provider: 'fake', now: f.now }); return { mailer, reports: new LeavingReports({ store: f.store, mailer, to: OWNER, operator: 'test-job', now: f.now, ...more }) }; };

test('a synthetic month, added up: volume and its shares, reasons ranked, offers shown against taken, the mixes, and the trend', async () => {
  const f = fixture();
  f.advance(Date.UTC(2026, 8, 12) - f.now()); // 12 September 2026: August is complete
  // four families active from July, and one created in the middle of August (so not active when the month began)
  await family(f, 'parentA', { createdAt: Date.UTC(2026, 6, 2), records: [{ at: AUG, reason: 'too_expensive', action: 'downgrade', offersShown: ['downgrade', 'seats'], offerAccepted: 'downgrade', plan: 'big', seats: 6, toPlan: 'family' }] });
  await family(f, 'parentB', { createdAt: Date.UTC(2026, 6, 9), records: [{ at: AUG + DAY, reason: 'too_expensive', action: 'cancel', offersShown: ['downgrade', 'seats'], plan: 'big', seats: 6 }] });
  await family(f, 'parentC', { createdAt: Date.UTC(2026, 6, 20), records: [{ at: AUG + 2 * DAY, reason: 'taking_a_break', action: 'pause', offersShown: ['pause'], offerAccepted: 'pause', months: 2 },
    { at: Date.UTC(2026, 6, 15), reason: 'lost_interest', action: 'cancel' }] }); // July: the trend's, not this month's
  await family(f, 'parentD', { createdAt: Date.UTC(2026, 5, 1), records: [{ at: AUG + 3 * DAY, reason: 'too_many_emails', action: 'reduce_email', cadence: 'monthly', offersShown: ['email_monthly', 'email_off'], offerAccepted: 'email_monthly', plan: 'starter', seats: 2 }] });
  await family(f, 'parentE', { createdAt: Date.UTC(2026, 7, 20), records: [{ at: AUG + 15 * DAY, reason: 'technical', action: 'keep', offersShown: ['feedback'], offerAccepted: 'feedback', plan: 'starter', seats: 2 }] });
  const { mailer, reports } = job(f);
  const r = await reports.run({ month: MONTH });
  assert.deepEqual([r.month, r.status], [MONTH, 'sent']);
  assert.equal(mailer.sent.length, 1);
  const m = mailer.sent[0];
  assert.equal(m.to, OWNER);
  assert.equal(m.subject, 'AutoMathtics leaving report · August 2026: 1 cancelled, 1 paused, 1 downgraded, 1 fewer emails');
  assert.deepEqual(m.tags, [{ name: 'kind', value: 'leaving_report' }, { name: 'month', value: MONTH }]);
  assert.equal(m.idempotencyKey, `leaving:${MONTH}`);
  // four families were active when August began; the fifth was created inside it
  assert.ok(m.text.includes('Active families at the start of the month: 4'), m.text);
  assert.ok(m.text.includes('Flows: 5 in all — 1 changed nothing.'));
  for (const line of ['  Cancellations      1   25.0%', '  Pauses             1   25.0%', '  Downgrades         1   25.0%', '  Email opt-outs     1   25.0%']) assert.ok(m.text.includes(line), line);
  assert.ok(m.text.includes(`  ${REASON_WORDS.too_expensive.padEnd(24)}   2`), 'reasons ranked, the commonest first');
  assert.ok(m.text.indexOf(REASON_WORDS.too_expensive) < m.text.indexOf(REASON_WORDS.taking_a_break));
  assert.ok(m.text.includes(`  ${OFFER_WORDS.downgrade.padEnd(34)}     2      1   50.0%`), 'offers shown against offers taken');
  assert.ok(m.text.includes(`  ${OFFER_WORDS.seats.padEnd(34)}     2      0    0.0%`));
  assert.ok(m.text.includes('PLANS   big 2 · starter 2 · family 1'), m.text.split('PLANS')[1]?.slice(0, 60));
  assert.ok(m.text.includes('SEATS   2 2 · 6 2 · 4 1'));
  assert.ok(m.text.includes('COHORT  2026-07 3 · 2026-06 1 · 2026-08 1'));
  // the trend: this month, then the three before, with July's one cancellation
  const trend = m.text.split('TREND')[1];
  assert.ok(trend.includes('  2026-08          4       1      1     1      1'), trend);
  assert.ok(trend.includes('  2026-07          1       1      0     0      0'), trend); // one family existed before July began: a family created inside a month was not active at its start
  assert.ok(trend.includes('2026-06') && trend.includes('2026-05'), 'three months of trend');
  assert.equal(TREND_MONTHS, 3);
  // the email itself: plain text and one small table, no image, no name, no address of a parent, no free text
  assert.ok(!/<img/i.test(m.html)); assert.ok(m.html.includes('<table'));
  assert.ok(!m.html.includes('Test family') && !m.html.includes('parentA@example.test'));
  assert.ok(!m.text.includes('@example.test'));
  // the record: status only, and a run row in the audit
  const rec = await f.store.get(LEAVING_REPORT_KEY(MONTH));
  assert.deepEqual([rec.month, rec.kind, rec.status, rec.attempts, rec.providerId], [MONTH, 'leaving', 'sent', 1, m.id]);
  assert.equal(rec.expireAt, f.now() + REPORT_TTL_MS);
  assert.ok(!JSON.stringify(rec).includes('too_expensive'), 'the claim holds no content');
  assert.ok((await f.store.list('audit')).some((x) => x.action === 'report.leaving' && x.month === MONTH && x.status === 'sent' && x.familyId === null));
  // a second run sends nothing
  const again = await reports.run({ month: MONTH });
  assert.deepEqual([again.status, again.reason], ['already', 'sent']); assert.equal(mailer.sent.length, 1);
});

test('a month in which nothing happened writes a log line and sends nothing; so does a month with nowhere to send it', async () => {
  const f = fixture();
  f.advance(Date.UTC(2026, 8, 12) - f.now());
  await family(f, 'parentA', { createdAt: Date.UTC(2026, 6, 2) });
  const lines = [], { mailer, reports } = job(f, { log: (l) => lines.push(l) });
  const r = await reports.run({ month: MONTH });
  assert.deepEqual([r.status, r.reason, r.activeAtStart], ['skipped', 'nothing_happened', 1]);
  assert.equal(mailer.sent.length, 0);
  assert.deepEqual(lines, [{ event: 'leaving_report', month: MONTH, status: 'skipped', reason: 'nothing_happened', dryRun: false }]);
  assert.equal((await f.store.get(LEAVING_REPORT_KEY(MONTH))).status, 'skipped');
  // somebody did leave, but no owner address is configured: skipped, said plainly, never guessed at
  const g = fixture(); g.advance(Date.UTC(2026, 8, 12) - g.now());
  await family(g, 'parentA', { createdAt: Date.UTC(2026, 6, 2), records: [{ at: AUG, action: 'cancel' }] });
  const mute = job(g, { to: null });
  assert.deepEqual(await mute.reports.run({ month: MONTH }), { month: MONTH, status: 'skipped', reason: 'no_owner_address' });
  assert.equal(mute.mailer.sent.length, 0);
});

test('one email a month under any overlap: a claim held by another run is busy, a failed one is retried, and the month must be complete', async () => {
  const f = fixture();
  f.advance(Date.UTC(2026, 8, 12) - f.now());
  await family(f, 'parentA', { createdAt: Date.UTC(2026, 6, 2), records: [{ at: AUG, action: 'cancel' }] });
  const mailer = createMailer({ provider: 'fake', now: f.now });
  const [x, y] = await Promise.all([job(f, { mailer }).reports.run({ month: MONTH }), job(f, { mailer }).reports.run({ month: MONTH })]);
  assert.equal(mailer.sent.length, 1);
  assert.equal([x, y].filter((r) => r.status === 'sent').length, 1);
  assert.ok([x, y].every((r) => ['sent', 'busy', 'already'].includes(r.status)), `${x.status}/${y.status}`);
  // a run that died mid-send: left alone for 15 minutes, then taken over under the same idempotency key
  const g = fixture(); g.advance(Date.UTC(2026, 8, 12) - g.now());
  await family(g, 'parentA', { createdAt: Date.UTC(2026, 6, 2), records: [{ at: AUG, action: 'pause' }] });
  await g.store.put(LEAVING_REPORT_KEY(MONTH), { month: MONTH, kind: 'leaving', status: 'sending', claimId: 'run-that-died', claimedAt: g.now() - 60_000, attempts: 1, providerId: null, reason: null, createdAt: g.now(), updatedAt: g.now(), expireAt: g.now() + REPORT_TTL_MS });
  const held = job(g);
  assert.deepEqual(await held.reports.run({ month: MONTH }), { month: MONTH, status: 'busy', reason: 'claimed_by_another_run' });
  g.advance(REPORT_CLAIM_MS);
  assert.equal((await held.reports.run({ month: MONTH })).status, 'sent');
  assert.equal((await g.store.get(LEAVING_REPORT_KEY(MONTH))).attempts, 2);
  // a provider that fails: recorded as failed, and the next run sends it
  const h = fixture(); h.advance(Date.UTC(2026, 8, 12) - h.now());
  await family(h, 'parentA', { createdAt: Date.UTC(2026, 6, 2), records: [{ at: AUG, action: 'cancel' }] });
  const fake = createMailer({ provider: 'fake', now: h.now }); let down = true;
  const flaky = { send: async (m) => { if (down) { const e = Error('PROVIDER_UNREACHABLE'); e.code = 'PROVIDER_UNREACHABLE'; throw e; } return fake.send(m); } };
  const shaky = job(h, { mailer: flaky });
  assert.deepEqual(await shaky.reports.run({ month: MONTH }), { month: MONTH, status: 'failed', reason: 'PROVIDER_UNREACHABLE' });
  assert.equal((await h.store.get(LEAVING_REPORT_KEY(MONTH))).status, 'failed');
  down = false; assert.equal((await shaky.reports.run({ month: MONTH })).status, 'sent'); assert.equal(fake.sent.length, 1);
  // never a month still running, and never nonsense
  await assert.rejects(job(f).reports.run({ month: '2026-09' }), (e) => e.code === 'MONTH_NOT_COMPLETE');
  for (const bad of ['2026-13', '2026-00', '26-08', 'soon']) await assert.rejects(job(f).reports.run({ month: bad }), (e) => e.code === 'MONTH_INVALID', String(bad));
  assert.equal(job(f).reports.lastMonth(), MONTH, 'no month given: the last complete one');
});

test('a dry run decides the month and sends, claims and audits nothing', async () => {
  const f = fixture();
  f.advance(Date.UTC(2026, 8, 12) - f.now());
  await family(f, 'parentA', { createdAt: Date.UTC(2026, 6, 2), records: [{ at: AUG, action: 'cancel', reason: 'lost_interest' }] });
  const { mailer, reports } = job(f);
  const r = await reports.run({ month: MONTH, dryRun: true });
  assert.deepEqual([r.status, r.month, r.summary.volume.cancellations], ['would_send', MONTH, 1]);
  assert.equal(mailer.sent.length, 0); assert.equal(await f.store.get(LEAVING_REPORT_KEY(MONTH)), null);
  assert.ok(!(await f.store.list('audit')).some((x) => x.action === 'report.leaving'));
});

test('the words: the month named, a share of nothing said as a dash, and every reason and offer with words of its own', () => {
  assert.equal(monthName('2026-08'), 'August 2026'); assert.equal(monthName('nonsense'), 'nonsense');
  const empty = renderLeavingReport({ month: '2026-08', activeAtStart: 0, volume: { cancellations: 2, pauses: 0, downgrades: 0, emailOptOuts: 0, kept: 0, total: 2 },
    rate: { cancellations: null, pauses: null, downgrades: null, emailOptOuts: null }, reasons: [], offers: [], plans: [], seats: [], cohorts: [], trend: [], anything: true });
  assert.ok(empty.text.includes('  Cancellations      2   —'), 'a share of nothing is a dash, never a division by zero');
  assert.ok(empty.text.includes('REASONS\n  none')); assert.ok(empty.text.includes('  none shown'));
  assert.ok(empty.text.includes('PLANS   none'));
  for (const key of Object.keys(REASON_WORDS)) assert.match(REASON_WORDS[key], /^[A-Z]/);
  for (const key of Object.keys(OFFER_WORDS)) assert.ok(OFFER_WORDS[key].length > 3, key);
});

test('the monthly pass: which Monday runs it, and for which month', () => {
  assert.equal(monthlyLeavingMonth('2026-W36'), '2026-08', 'the run of Monday 7 September reports August');
  assert.equal(monthlyLeavingMonth('2026-W40'), '2026-09'); assert.equal(monthlyLeavingMonth('2026-W53'), '2026-12', 'across the turn of the year');
  assert.throws(() => monthlyLeavingMonth('2026-W99'), /WEEK_INVALID/);
  for (const w of ['2026-W36', '2026-W40', '2026-W44', '2026-W49', '2026-W53']) assert.equal(isMonthlySendWeek(w), true, w);
  const monthsSeen = new Set(['2026-W36', '2026-W40', '2026-W44', '2026-W49', '2026-W53'].map(monthlyLeavingMonth));
  assert.equal(monthsSeen.size, 5, 'one month each, never the same month twice');
});

const execFileP = promisify(execFile), CLI = fileURLToPath(new URL('../scripts/report.mjs', import.meta.url));
const cli = (env, args) => execFileP(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '', ...env } }).then(() => ({ code: 0, err: '' }), (e) => ({ code: e.code, err: String(e.stderr) }));
test('the CLI: `leaving` reads its month strictly, needs no button secret and no app origin, and the monthly pass rides on `send`', async () => {
  const src = await readFile(CLI, 'utf8');
  for (const s of ['leaving: {', "'--month'", 'leaving_report_run', 'OWNER_EMAIL', 'isMonthlySendWeek(r.week)', 'monthlyLeavingMonth(r.week)', "args.familyId === null && isMonthlySendWeek"]) assert.ok(src.includes(s), s);
  assert.ok(src.indexOf('const args = parse(process.argv.slice(2))') < src.indexOf('const env = process.env'), 'the arguments still come first');
  for (const args of [['leaving', '--month'], ['leaving', '--month', '2026-13'], ['leaving', '--month', '2026-8'], ['leaving', '--month', '2026-08', '--month', '2026-07'],
    ['leaving', 'august'], ['leaving', '--week', '2026-W36'], ['leaving', '--dry-run', '--dry-run']]) {
    const r = await cli({}, args); assert.equal(r.code, 64, args.join(' ')); assert.match(r.err, /Usage: node scripts\/report\.mjs send/);
  }
  assert.match((await cli({}, ['leaving'])).err, /Set APP_MODE/, 'good arguments: then the environment');
  const base = { APP_MODE: 'emulator', FIREBASE_PROJECT_ID: 'demo-am-foundation', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088' };
  assert.match((await cli({ ...base, OWNER_EMAIL: 'not-an-address' }, ['leaving', '--month', MONTH])).err, /OWNER_EMAIL must be one email address/);
  assert.match((await cli({ ...base, EMAIL_PROVIDER: 'resend', OWNER_EMAIL: OWNER }, ['leaving', '--month', MONTH])).err, /EMAIL_API_KEY/, 'the mail settings are still checked');
  const src2 = await readFile(new URL('../scripts/cloudshell/07-report-job.sh', import.meta.url), 'utf8');
  assert.ok(src2.includes('OWNER_EMAIL=$OWNER_EMAIL') && src2.includes('--args scripts/report.mjs,send '), 'block G passes the owner address to the one weekly job');
  assert.ok(!/OWNER_EMAIL[^\n]*am-v3/.test(src2), 'an address is not a secret and is not stored as one');
});
