import { FirestoreStore } from '../server/firebase.mjs';
import { grantEntitlement } from '../server/service.mjs';

const { APP_MODE: mode, FIREBASE_PROJECT_ID: projectId } = process.env;
const emulator = mode === 'emulator';
if (!['emulator', 'staging', 'production'].includes(mode) ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '') || projectId === 'automathtics') {
  throw Error('Set APP_MODE and a NEW FIREBASE_PROJECT_ID. The live prototype is forbidden.');
}
if (emulator) {
  if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') {
    throw Error('Use a demo-* project and Firestore emulator at 127.0.0.1:8088.');
  }
} else if (projectId.startsWith('demo-') || process.env.CONFIRM_PROJECT !== projectId ||
    Object.keys(process.env).some((k) => k.includes('EMULATOR') && process.env[k])) {
  throw Error('Confirm the exact new project; remove all emulator variables for cloud grants.');
}
const [familyId, seats, until, reason, ...keep] = process.argv.slice(2);
if (!familyId || !seats || !until || !reason) {
  console.error('Usage: node scripts/grant.mjs FAMILY_UUID SEATS ISO_EXPIRY "reason" [ACTIVE_CHILD_UUID ...]');
  process.exit(1);
}
// IAM authorizes the operator. The text label is attribution, not authentication.
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (!actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const result = await grantEntitlement(new FirestoreStore(getFirestore(app)), {
  familyId, seatLimit: Number(seats), accessUntil: Date.parse(until), actor, reason,
  ...(keep.length ? { keepChildIds: keep[0] === 'none' ? [] : keep } : {}),
});
console.log(JSON.stringify(result));
