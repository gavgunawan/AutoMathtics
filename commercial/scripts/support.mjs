// Stage 3.5 operator/support tool. Same project guards as grant.mjs; every corrective action is
// audited under OPERATOR_ID. Reads print JSON. Nothing here rebinds a family, a child or a
// subscription to another account (NO_TRANSFER.md).
//
//   node scripts/support.mjs family FAMILY_UUID                       everything support needs, problems first
//   node scripts/support.mjs customer PROVIDER CUSTOMER_REF          provider reference → family
//   node scripts/support.mjs inbox [requires_action|rejected|ignored|applied|all]
//   node scripts/support.mjs reprocess FAMILY_UUID                   server-side reprocessing of waiting events
//   node scripts/support.mjs reconcile-intent PROVIDER OPERATION_UUID OUTCOME "what was established at the provider"
//        OUTCOME: no_provider_change | provider_reverted | applied_by_operator | refunded
//   node scripts/support.mjs export FAMILY_UUID                      the family's data as JSON (stdout)
//   node scripts/support.mjs delete FAMILY_UUID                      execute a deletion the parent requested and whose 14 days have passed
//        CONFIRM_DELETION=FAMILY_UUID is required; FORCE_BEFORE_GRACE=yes executes early (audited as forced)
import { FirestoreStore } from '../server/firebase.mjs';
import { Foundation } from '../server/service.mjs';
import { Subscriptions } from '../server/subscription.mjs';
import { Payments, FakeGateway } from '../server/payments.mjs';
import { Support } from '../server/support.mjs';
import { pinHasher } from '../server/security.mjs';

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
const [command, ...rest] = process.argv.slice(2);
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (!actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
const secret = process.env.SESSION_SECRET, pepper = process.env.PIN_PEPPER, webhookSecret = process.env.WEBHOOK_SECRET_FAKE;
if (!/^[a-f0-9]{64,}$/.test(secret || '') || !/^[a-f0-9]{64,}$/.test(pepper || '') || !/^[a-f0-9]{64,}$/.test(webhookSecret || '')) throw Error('SESSION_SECRET, PIN_PEPPER and WEBHOOK_SECRET_FAKE are required (the tool constructs the same services the server does).');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { FirebaseIdentity } = await import('../server/firebase.mjs');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const service = new Foundation({ store, identity: new FirebaseIdentity(getAuth(app)), hasher: pinHasher(pepper), secret });
const billing = new Subscriptions({ foundation: service, store });
const payments = new Payments({ foundation: service, store, billing, provider: 'fake', gateways: { fake: new FakeGateway({ secret: webhookSecret }) } });
const support = new Support({ foundation: service, store, billing, payments });
const out = (v) => console.log(JSON.stringify(v, null, 2));
switch (command) {
  case 'family': out(await support.familyReport(rest[0])); break;
  case 'customer': out(await support.customerLookup(rest[0], rest[1])); break;
  case 'inbox': out(await support.inbox(rest[0] || 'requires_action')); break;
  case 'reprocess': out(await support.reprocess(rest[0], actor)); break;
  case 'reconcile-intent': out(await support.reconcileIntent(rest[0], rest[1], { operator: actor, outcome: rest[2], note: rest.slice(3).join(' ') })); break;
  case 'export': { const family = await store.get(`families/${rest[0]}`); if (!family) throw Error('FAMILY_NOT_FOUND'); out(await store.transaction((tx) => support.collect(tx, family, actor), { readOnly: true })); break; }
  case 'delete': {
    if (process.env.CONFIRM_DELETION !== rest[0]) throw Error('Set CONFIRM_DELETION to the exact family id to execute a deletion.');
    out(await support.executeDeletion(rest[0], { operator: actor, force: process.env.FORCE_BEFORE_GRACE === 'yes' })); break;
  }
  default: console.error('Usage: node scripts/support.mjs family|customer|inbox|reprocess|reconcile-intent|export|delete ...'); process.exit(1);
}
