// The Olympia pass, granted by the operator until payments open (server/olympia.mjs grantOlympia): a family may enter Olympia
// until the date given, whatever plan it is on. A date in the past closes it. Built like grant.mjs: IAM authorizes the operator,
// OPERATOR_ID is attribution, and the grant is audited.
import { FirestoreStore } from '../server/firebase.mjs';
import { grantOlympia } from '../server/olympia.mjs';

const { APP_MODE: mode, FIREBASE_PROJECT_ID: projectId } = process.env;
const emulator = mode === 'emulator';
if (!['emulator', 'staging', 'production'].includes(mode) ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '') || projectId === 'automathtics') {
  throw Error('Set APP_MODE and a NEW FIREBASE_PROJECT_ID. The live prototype is forbidden.');
}
if (emulator) {
  if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') throw Error('Use a demo-* project and Firestore emulator at 127.0.0.1:8088.');
} else if (projectId.startsWith('demo-') || process.env.CONFIRM_PROJECT !== projectId || Object.keys(process.env).some((k) => k.includes('EMULATOR') && process.env[k])) {
  throw Error('Confirm the exact new project; remove all emulator variables for cloud grants.');
}
const [familyId, until, reason] = process.argv.slice(2);
if (!familyId || !until || !reason) { console.error('Usage: node scripts/olympia-pass.mjs FAMILY_UUID ISO_EXPIRY "reason"'); process.exit(1); }
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (!actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const result = await grantOlympia(new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) }), { familyId, until: Date.parse(until), actor, reason });
console.log(JSON.stringify(result));
