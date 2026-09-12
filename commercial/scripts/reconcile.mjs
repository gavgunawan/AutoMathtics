// Operator tool: re-derive every child's balance from their ledger and compare it with the wallet's
// cache. Read-only by default; CONFIRM_REPAIR=write repairs a drifted cache from a *valid* ledger,
// inside one transaction over the wallet and its rows (a concurrent balance change makes the
// transaction retry rather than overwrite). A structurally damaged ledger is never repaired here.
// Same project guards as grant.mjs; cloud repair requires OPERATOR_ID.
//
//   node scripts/reconcile.mjs FAMILY_UUID [CHILD_UUID]
import { randomUUID } from 'node:crypto';
import { FirestoreStore } from '../server/firebase.mjs';
import { reconcile, repair } from '../server/ledger.mjs';
import { normalizeProgress } from '../server/progress.mjs';

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
  throw Error('Confirm the exact new project; remove all emulator variables for cloud access.');
}
const [familyId, onlyChild] = process.argv.slice(2);
if (!familyId) { console.error('Usage: node scripts/reconcile.mjs FAMILY_UUID [CHILD_UUID]'); process.exit(1); }
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (process.env.CONFIRM_REPAIR === 'write' && !actor) throw Error('Set OPERATOR_ID to your auditable operator identity before repairing.');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const family = await store.get(`families/${familyId}`);
if (!family) throw Error('FAMILY_NOT_FOUND');
let drifted = 0, damaged = 0;
for (const childId of (family.childIds || []).filter((id) => !onlyChild || id === onlyChild)) {
  const base = `families/${familyId}/learning/${childId}`;
  const prog = normalizeProgress(await store.get(base));
  const r = reconcile(await store.list(`${base}/ledger`), prog.wallet);
  console.log(JSON.stringify({ childId, match: r.match, damaged: r.damaged, derived: r.derived, cached: r.cached, problems: r.problems }));
  if (r.match) continue;
  if (r.damaged) { damaged++; continue; }
  drifted++;
  if (process.env.CONFIRM_REPAIR !== 'write') continue;
  const out = await store.transaction(async (tx) => {
    const res = await repair(tx, base); // re-reads wallet and rows under the transaction; refuses a damaged ledger
    if (res.repaired) tx.set(`audit/${randomUUID()}`, { action: 'ledger.repaired', familyId, childId, actor, from: res.cached, to: res.derived, at: Date.now(), expireAt: Date.now() + 400 * 86_400_000 });
    return res;
  });
  console.log(JSON.stringify({ childId, repaired: out.repaired, now: out.derived }));
}
if (damaged) { console.log(`${damaged} ledger(s) are structurally damaged (sequence gap, chain break or dishonest running balance). Not repaired: investigate by hand.`); process.exit(3); }
if (drifted && process.env.CONFIRM_REPAIR !== 'write') { console.log(`${drifted} wallet(s) disagree with a valid ledger. Set CONFIRM_REPAIR=write (and OPERATOR_ID) to set the cache to the ledger's value.`); process.exit(2); }
