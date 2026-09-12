// Stage 4.8 operator dashboard — the answer to "where can i (developer) access dashboard?".
//
// It is a command, not a page on the site: this release has no operator login, and no browser route is a
// generic admin surface (SUPPORT.md). This reads the project, computes aggregates only (server/analytics.mjs),
// and writes ONE self-contained HTML file the operator keeps on their own machine — inline CSS, one inline
// SVG, no script, no external request, opens offline. Nothing is written to the project except one audit row
// per run (`operator.dashboard`), and nothing identifying is ever computed: no nickname, no family, child or
// parent reference, no address, nothing a child wrote. Any number computed from fewer than --min-cell
// families is left out of the HTML and the JSON alike.
//
//   node scripts/dashboard.mjs [--out dashboard.html] [--json dashboard.json] [--days 90] [--min-cell 5] [--by year|age]
//
// Same project guards as scripts/support.mjs: the same environment that runs the other operator tools runs
// this one, so a command pointed at the wrong project (or at the v2 prototype) fails before it reads a thing.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { FirestoreStore } from '../server/firebase.mjs';
import { collectSnapshot, buildReport, renderHtml, auditRow, MIN_CELL, DEFAULT_DAYS } from '../server/analytics.mjs';

const { APP_MODE: mode, FIREBASE_PROJECT_ID: projectId } = process.env;
const emulator = mode === 'emulator';
if (!['emulator', 'staging', 'production'].includes(mode) ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '') || projectId === 'automathtics') {
  throw Error('Set APP_MODE and a NEW FIREBASE_PROJECT_ID. The live prototype is forbidden.');
}
if (emulator) {
  if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') throw Error('Use a demo-* project and Firestore emulator at 127.0.0.1:8088.');
} else if (projectId.startsWith('demo-') || process.env.CONFIRM_PROJECT !== projectId ||
    Object.keys(process.env).some((k) => k.includes('EMULATOR') && process.env[k])) {
  throw Error('Confirm the exact new project; remove all emulator variables for cloud reads.');
}
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (!actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
if (!/^[A-Za-z0-9@._:-]{3,120}$/.test(actor)) throw Error('OPERATOR_ID must be a plain auditable identity (3-120 characters of letters, digits and @._:-).');
const secret = process.env.SESSION_SECRET, pepper = process.env.PIN_PEPPER, webhookSecret = process.env.WEBHOOK_SECRET_FAKE, stripeKey = process.env.STRIPE_SECRET_KEY;
if (!/^[a-f0-9]{64,}$/.test(secret || '') || !/^[a-f0-9]{64,}$/.test(pepper || '')) throw Error('SESSION_SECRET and PIN_PEPPER are required (the same operator environment as scripts/support.mjs).');
if (!/^[a-f0-9]{64,}$/.test(webhookSecret || '') && !stripeKey) throw Error('Set WEBHOOK_SECRET_FAKE (fake provider) or the STRIPE_* variables (Stripe), as the server has them.');

// strictly flag/value pairs, so a typo is refused rather than silently ignored
const OPTIONS = new Set(['--out', '--json', '--days', '--min-cell', '--by']);
const args = process.argv.slice(2), given = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!OPTIONS.has(args[i]) || args[i + 1] === undefined) {
    console.error(`Usage: node scripts/dashboard.mjs [--out dashboard.html] [--json dashboard.json] [--days ${DEFAULT_DAYS}] [--min-cell ${MIN_CELL}] [--by year|age]`);
    process.exit(1);
  }
  given.set(args[i], args[i + 1]);
}
const flag = (name, fallback = null) => (given.has(name) ? given.get(name) : fallback);
const out = flag('--out', 'dashboard.html'), jsonOut = flag('--json', null);
const days = Number(flag('--days', DEFAULT_DAYS)), minCell = Number(flag('--min-cell', MIN_CELL)), by = flag('--by', 'year');
if (!Number.isInteger(days) || days < 1 || days > 730) throw Error('--days must be a whole number of days between 1 and 730.');
if (!Number.isInteger(minCell) || minCell < 1 || minCell > 1000) throw Error('--min-cell must be a whole number of families, 1 or more. Lower it below 5 only with a reason you can defend (PRIVACY.md).');
if (!['year', 'age'].includes(by)) throw Error('--by must be year or age.');

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });

const now = Date.now();
const snapshot = await collectSnapshot(store, { now, days });
const report = buildReport(snapshot, { minCell, by });
writeFileSync(out, renderHtml(report), 'utf8');
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
// the one write to the project: who ran the report, when, and over how many families — never which ones
const row = auditRow({ operator: actor, at: now, families: report.scope.families, minCell, days, by });
await store.transaction(async (tx) => { tx.set(`audit/${randomUUID()}`, row); });
console.log(JSON.stringify({ out, json: jsonOut, ...report.scope, by, days,
  easyFlags: report.speed.engine.flags.easy.length + report.speed.nav.flags.easy.length,
  hardFlags: report.speed.engine.flags.hard.length + report.speed.nav.flags.hard.length,
  audited: 'operator.dashboard' }, null, 2));
if (report.scope.families < minCell) console.log(`Fewer than ${minCell} families: nearly every number in the report is a dash. That is the suppression rule working, not a fault.`);
