// The opening email to the waiting list (the owner's approval of 13 Sep 2026), run once the doors open, from the service's own
// image (the report job, which has the secrets) or from Cloud Shell with the service's settings. It is a dry run unless --send is
// given; it writes to at most --limit addresses a run (90 by default, under Resend's free 100 a day), and to each address once
// however often it runs, so a rerun the next day finishes a long list. The same project guards as report.mjs, checked before any
// SDK loads. The unsubscribe links are signed with SESSION_SECRET, which the service checks them with. EMAIL_PROVIDER picks the
// mailer as for the report; WAITLIST_FROM names the sender (no-reply) and WAITLIST_REPLY_TO where Reply goes. It prints counts,
// never an address, a token or the key.
//
//   node scripts/waitlist-open.mjs [--send] [--limit N]        exit 2 when a send failed (a rerun sends the rest)
import { mailerConfig, createMailer } from '../server/mailer.mjs';

const USAGE = 'Usage: node scripts/waitlist-open.mjs [--send] [--limit N]';
function usage() { console.error(USAGE); process.exit(64); }
const argv = process.argv.slice(2);
let send = false, limit = null;
for (let i = 0; i < argv.length; i++) { // read strictly: a slip must never widen a run or send by accident
  if (argv[i] === '--send' && !send) send = true;
  else if (argv[i] === '--limit' && limit === null && /^\d{1,4}$/.test(argv[i + 1] || '')) limit = Number(argv[++i]);
  else usage();
}
if (limit !== null && (limit < 1 || limit > 1000)) usage();

const env = process.env, { APP_MODE: mode, FIREBASE_PROJECT_ID: projectId } = env, emulator = mode === 'emulator';
if (!['emulator', 'staging', 'production'].includes(mode) || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '') || projectId === 'automathtics') {
  throw Error('Set APP_MODE and a NEW FIREBASE_PROJECT_ID. The live prototype is forbidden.');
}
if (emulator) {
  if (!projectId.startsWith('demo-') || env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') throw Error('Use a demo-* project and Firestore emulator at 127.0.0.1:8088.');
} else if (projectId.startsWith('demo-') || env.CONFIRM_PROJECT !== projectId || Object.keys(env).some((k) => k.includes('EMULATOR') && env[k])) {
  throw Error('Confirm the exact new project; remove all emulator variables for cloud writes.');
}
if (!(emulator || env.OPERATOR_ID)) throw Error('Set OPERATOR_ID to your auditable operator identity.');
if (!/^[a-f0-9]{64,}$/.test(env.SESSION_SECRET || '')) throw Error('SESSION_SECRET is required: it signs each unsubscribe link, which the service checks.');
let origin = null; try { origin = new URL(env.APP_ORIGIN).origin; } catch { /* refused below */ }
if (!origin || origin !== env.APP_ORIGIN || (!emulator && !origin.startsWith('https://'))) throw Error('Set APP_ORIGIN to the app’s https origin, no path or trailing slash: the email links to its /join.');
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const replyTo = env.WAITLIST_REPLY_TO || null;
if (replyTo !== null && !ADDRESS.test(replyTo)) throw Error('WAITLIST_REPLY_TO must be one email address.');
const mail = mailerConfig({ ...env, ...(env.WAITLIST_FROM ? { EMAIL_FROM: env.WAITLIST_FROM } : {}) }); // the list writes as no-reply, as its confirmations do

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { FirestoreStore } = await import('../server/firebase.mjs');
const { Waitlist } = await import('../server/waitlist.mjs');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const mailer = createMailer({ ...mail, store: mail.provider === 'fake' ? store : null });
const list = new Waitlist({ store, secret: env.SESSION_SECRET, origin, mailer, replyTo, log: (line) => console.log(JSON.stringify(line)) });
const r = await list.announceOpening({ dryRun: !send, ...(limit === null ? {} : { limit }) });
console.log(JSON.stringify({ event: 'waitlist_open', provider: mail.provider, dryRun: !send, ...r }));
if (r.failed > 0 || r.status === 'no_mailer' || r.status === 'unsigned') process.exitCode = 2;
