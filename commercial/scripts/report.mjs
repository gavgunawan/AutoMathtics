// The weekly progress email (email-v1): the job and the operator's look at it, and the operator's read of the feedback. Cloud
// Shell block G runs `send` from the service's own image every Monday at 07:00 Singapore time, for the last complete ISO week in
// Singapore. The same project guards as support.mjs, checked before any SDK loads. The buttons are signed with SESSION_SECRET,
// which the service checks them with. EMAIL_PROVIDER picks the mailer: fake (the default) keeps each email in Firestore's outbox
// for 14 days instead of sending it; resend needs EMAIL_API_KEY, and EMAIL_FROM names the sender. The job's output is one JSON line
// per family and a summary: never an address, never a token, never the key. `feedback` prints what was written with Send feedback
// (server/feedback.mjs), with the address to answer when one was given, since answering is the point; it signs nothing and sends
// nothing, so it needs neither SESSION_SECRET nor the mail settings.
//
//   node scripts/report.mjs send [--week YYYY-Www] [--family FAMILY_UUID] [--dry-run]   exit 2 when a family failed or was busy
//   node scripts/report.mjs preview FAMILY_UUID [--week YYYY-Www]                         the HTML on stdout, links inert; never sends
//   node scripts/report.mjs feedback [--days N]                                           the notes of the last N days (7), newest first
//   node scripts/report.mjs leaving [--month YYYY-MM] [--dry-run]                         the month's leaving report to the owner
//
// The leaving report (the owner's request of 12 Sep 2026) goes to FEEDBACK_TO, or to OWNER_EMAIL when that is not set; without
// either it is skipped with a log line, never guessed at. `send` also runs it for the month just ended whenever its own run is the
// first Monday of a month — the same pass that sends the monthly family reports — so there is one schedule, not two.
//
// Arguments are read strictly, before anything else: an unknown word, a repeated option or an option without its value exits 64
// (EX_USAGE) with the usage. A slip must never widen a run: `--family` without its id used to mean every family.
import { mailerConfig, createMailer } from '../server/mailer.mjs';

const USAGE = 'Usage: node scripts/report.mjs send [--week YYYY-Www] [--family FAMILY_UUID] [--dry-run]\n       node scripts/report.mjs preview FAMILY_UUID [--week YYYY-Www]\n       node scripts/report.mjs feedback [--days N]\n       node scripts/report.mjs leaving [--month YYYY-MM] [--dry-run]';
const COMMANDS = { send: { options: ['--week', '--family'], flags: ['--dry-run'], positional: 0 }, preview: { options: ['--week'], flags: [], positional: 1 }, feedback: { options: ['--days'], flags: [], positional: 0 },
  leaving: { options: ['--month'], flags: ['--dry-run'], positional: 0 } };
function usage() { console.error(USAGE); process.exit(64); }
function parse(argv) {
  const [command, ...rest] = argv, spec = typeof command === 'string' && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
  if (!spec) usage();
  const options = {}, flags = new Set(), positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (spec.flags.includes(arg)) { if (flags.has(arg)) usage(); flags.add(arg); }
    else if (spec.options.includes(arg)) { const value = rest[++i]; if (value === undefined || value === '' || value.startsWith('-') || Object.hasOwn(options, arg)) usage(); options[arg] = value; }
    else if (arg.startsWith('-')) usage();
    else positional.push(arg);
  }
  if (positional.length !== spec.positional) usage();
  const days = options['--days'] ?? '7'; if (!/^\d{1,3}$/.test(days) || Number(days) < 1 || Number(days) > 400) usage(); // whole days, up to the notes' own 400
  const month = options['--month'] ?? null; if (month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) usage(); // YYYY-MM, a real month
  return { command, week: options['--week'] ?? null, familyId: options['--family'] ?? null, month, dryRun: flags.has('--dry-run'), days: Number(days), positional };
}
const args = parse(process.argv.slice(2));

const env = process.env, { APP_MODE: mode, FIREBASE_PROJECT_ID: projectId } = env, emulator = mode === 'emulator';
if (!['emulator', 'staging', 'production'].includes(mode) || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '') || projectId === 'automathtics') {
  throw Error('Set APP_MODE and a NEW FIREBASE_PROJECT_ID. The live prototype is forbidden.');
}
if (emulator) {
  if (!projectId.startsWith('demo-') || env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') throw Error('Use a demo-* project and Firestore emulator at 127.0.0.1:8088.');
} else if (projectId.startsWith('demo-') || env.CONFIRM_PROJECT !== projectId || Object.keys(env).some((k) => k.includes('EMULATOR') && env[k])) {
  throw Error('Confirm the exact new project; remove all emulator variables for cloud writes.');
}
const operator = emulator ? 'emulator-operator' : env.OPERATOR_ID;
if (!operator) throw Error('Set OPERATOR_ID to your auditable operator identity.');
const reading = args.command === 'feedback'; // the operator's read of the feedback: no button to sign, nothing to send
const owners = args.command === 'leaving'; // the owner's own report: no button to sign and no app origin to open, but it does send
if (!reading && !owners && !/^[a-f0-9]{64,}$/.test(env.SESSION_SECRET || '')) throw Error('SESSION_SECRET is required: it signs the buttons in the email, which the service checks.');
let origin = null; try { origin = new URL(env.APP_ORIGIN).origin; } catch { /* refused below */ }
if (!reading && !owners && (!origin || origin !== env.APP_ORIGIN || (!emulator && !origin.startsWith('https://')))) throw Error('Set APP_ORIGIN to the app’s https origin, no path or trailing slash: the buttons open it.');
const mail = reading ? null : mailerConfig(env);
// Where the owner's own reports go: the feedback address if there is one, else OWNER_EMAIL. Neither is a skip with a log line.
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const ownerTo = [env.FEEDBACK_TO, env.OWNER_EMAIL].find((x) => ADDRESS.test(x || '')) || null;
if (owners && !ownerTo && (env.FEEDBACK_TO || env.OWNER_EMAIL)) throw Error('FEEDBACK_TO / OWNER_EMAIL must be one email address: where the owner’s reports go.');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { FirestoreStore, FirebaseIdentity } = await import('../server/firebase.mjs');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const speak = (line) => console.log(JSON.stringify(line));
/** The owner's monthly leaving report. Its own claim, so the monthly pass of `send` and an explicit run never send twice. */
async function leavingReport(mailer, month) {
  const { LeavingReports } = await import('../server/leaving-report.mjs');
  const r = await new LeavingReports({ store, mailer, to: ownerTo, operator, log: speak }).run({ month, dryRun: args.dryRun });
  speak({ event: 'leaving_report_run', month: r.month, provider: mail.provider, dryRun: args.dryRun, status: r.status, reason: r.reason || null });
  return r;
}
if (reading) {
  const { Feedback } = await import('../server/feedback.mjs');
  for (const note of await new Feedback({ store }).recent(args.days)) console.log(JSON.stringify(note));
} else if (owners) {
  const mailer = createMailer({ ...mail, store: mail.provider === 'fake' ? store : null });
  const r = await leavingReport(mailer, args.month);
  if (r.status === 'failed' || r.status === 'busy') process.exitCode = 2; // the scheduled run shows red and a rerun finishes it
} else {
  const { Reports, runFailed, isMonthlySendWeek, monthlyLeavingMonth } = await import('../server/report.mjs');
  const mailer = createMailer({ ...mail, store: mail.provider === 'fake' ? store : null });
  const reports = new Reports({ store, identity: new FirebaseIdentity(getAuth(app)), mailer, secret: env.SESSION_SECRET, origin, operator, log: (line) => console.log(JSON.stringify(line)) });
  if (args.command === 'preview') process.stdout.write((await reports.preview(args.positional[0], args.week)).html);
  else {
    const r = await reports.run({ week: args.week, familyId: args.familyId, dryRun: args.dryRun });
    console.log(JSON.stringify({ event: 'weekly_report_run', week: r.week, provider: mail.provider, dryRun: args.dryRun, sent: r.sent, unconfirmed: r.unconfirmed, skipped: r.skipped, failed: r.failed, already: r.already, busy: r.busy, wouldSend: r.wouldSend }));
    if (runFailed(r)) process.exitCode = 2; // a family failed, or another run still held one: the scheduled run shows red, and a rerun finishes it
    // The monthly pass: the same run that sends the monthly family reports sends the owner the leaving report for the month just
    // ended. One family named (--family) is one family's report and nothing else. Its own claim keeps it to one a month.
    if (args.familyId === null && isMonthlySendWeek(r.week)) {
      const month = monthlyLeavingMonth(r.week);
      const done = await leavingReport(mailer, month);
      if (done.status === 'failed' || done.status === 'busy') process.exitCode = 2;
    }
  }
}
