// Operator tool for subscription events until Stage 3.3 brings verified webhooks. Same project
// guards as grant.mjs. Every event is idempotent by its id and recorded before it acts.
//
//   node scripts/subscription.mjs FAMILY_UUID payment.succeeded PLAN PERIOD_END_ISO [SEAT_CHILD_UUID ...]
//   node scripts/subscription.mjs FAMILY_UUID payment.failed
//   node scripts/subscription.mjs FAMILY_UUID plan.change PLAN [SEAT_CHILD_UUID ...]
//   node scripts/subscription.mjs FAMILY_UUID seats.assign SEAT_CHILD_UUID ...   (who occupies the seats; can reactivate)
//   node scripts/subscription.mjs FAMILY_UUID plan.schedule PLAN|none [SEAT_CHILD_UUID ...]   (downgrade at period end; none clears)
//   node scripts/subscription.mjs FAMILY_UUID refund AMOUNT_CENTS [full]   (record a refund; full ends access now)
//   node scripts/subscription.mjs FAMILY_UUID cancel.request | cancel.undo | terminate
//
// Trials are not started here: a trial is the parent's action and is decided by their verified phone.
import { randomUUID } from 'node:crypto';
import { FirestoreStore } from '../server/firebase.mjs';
import { Subscriptions, PLANS } from '../server/subscription.mjs';

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
  throw Error('Confirm the exact new project; remove all emulator variables for cloud writes.');
}
const [familyId, type, ...rest] = process.argv.slice(2);
if (!familyId || !type) { console.error('Usage: node scripts/subscription.mjs FAMILY_UUID EVENT [PLAN] [PERIOD_END_ISO] [KEEP_CHILD_UUID ...]'); process.exit(1); }
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (!actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
const event = { id: process.env.EVENT_ID || randomUUID(), type, provider: 'manual' };
if (type === 'payment.succeeded') { event.plan = rest[0]; event.periodEnd = Date.parse(rest[1]); if (rest.length > 2) event.seatChildIds = rest.slice(2); }
else if (type === 'plan.change') { event.plan = rest[0]; if (rest.length > 1) event.seatChildIds = rest.slice(1); }
else if (type === 'seats.assign') { event.seatChildIds = rest; }
else if (type === 'plan.schedule') { event.plan = rest[0] === 'none' ? null : rest[0]; if (rest.length > 1) event.seatChildIds = rest.slice(1); }
else if (type === 'refund') { event.amountCents = Number(rest[0]); event.full = rest[1] === 'full'; }
if (event.plan && !PLANS[event.plan]) throw Error(`Unknown plan; choose one of ${Object.keys(PLANS).filter((p) => PLANS[p].purchasable).join(', ')}`);
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const billing = new Subscriptions({ store, audit: (tx, action, who, family) => tx.set(`audit/${randomUUID()}`, { action, uid: who, familyId: family, childId: null, at: Date.now(), expireAt: Date.now() + 400 * 86_400_000 }) });
const result = await billing.apply(familyId, event, actor);
console.log(JSON.stringify({ event: event.id, ...result }));
