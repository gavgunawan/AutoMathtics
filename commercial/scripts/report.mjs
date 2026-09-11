// The weekly progress email (email-v1): the job and the operator's look at it. Cloud Shell block G runs `send` from the
// service's own image every Monday at 07:00 Singapore time; each family gets the last complete week in its own time zone. The
// same project guards as support.mjs, checked before any SDK loads. The buttons are signed with SESSION_SECRET, which the
// service checks them with. EMAIL_PROVIDER picks the mailer: fake (the default) keeps each email in Firestore's outbox for 14
// days instead of sending it; resend needs EMAIL_API_KEY, and EMAIL_FROM names the sender. The output is one JSON line per
// family and a summary: never an address, never a token, never the key.
//
//   node scripts/report.mjs send [--week YYYY-Www] [--family FAMILY_UUID] [--dry-run]   exit 2 when any send failed
//   node scripts/report.mjs preview FAMILY_UUID [--week YYYY-Www]                         the HTML on stdout, links inert; never sends
import { mailerConfig, createMailer } from '../server/mailer.mjs';

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
if (!/^[a-f0-9]{64,}$/.test(env.SESSION_SECRET || '')) throw Error('SESSION_SECRET is required: it signs the buttons in the email, which the service checks.');
let origin = null; try { origin = new URL(env.APP_ORIGIN).origin; } catch { /* refused below */ }
if (!origin || origin !== env.APP_ORIGIN || (!emulator && !origin.startsWith('https://'))) throw Error('Set APP_ORIGIN to the app’s https origin, no path or trailing slash: the buttons open it.');
const mail = mailerConfig(env);
const [command, ...rest] = process.argv.slice(2);
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] ?? null : null; };
if (!['send', 'preview'].includes(command)) { console.error('Usage: node scripts/report.mjs send [--week YYYY-Www] [--family FAMILY_UUID] [--dry-run] | preview FAMILY_UUID [--week YYYY-Www]'); process.exit(1); }
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { FirestoreStore, FirebaseIdentity } = await import('../server/firebase.mjs');
const { Reports } = await import('../server/report.mjs');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const mailer = createMailer({ ...mail, store: mail.provider === 'fake' ? store : null });
const reports = new Reports({ store, identity: new FirebaseIdentity(getAuth(app)), mailer, secret: env.SESSION_SECRET, origin, operator, log: (line) => console.log(JSON.stringify(line)) });
const week = option('--week');
if (command === 'preview') process.stdout.write((await reports.preview(rest[0], week)).html);
else {
  const r = await reports.run({ week, familyId: option('--family'), dryRun: rest.includes('--dry-run') });
  console.log(JSON.stringify({ event: 'weekly_report_run', week: week || 'the last complete week of each family', provider: mail.provider, dryRun: rest.includes('--dry-run'),
    sent: r.sent, skipped: r.skipped, failed: r.failed, already: r.already, busy: r.busy, wouldSend: r.wouldSend }));
  if (r.failed) process.exitCode = 2; // a scheduled run fails visibly; a rerun retries what failed
}
