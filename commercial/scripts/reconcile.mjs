// Operator tool: re-derive every child's balance from their ledger and compare it with the wallet's
// cache. Read-only by default; CONFIRM_REPAIR=write sets the cache to the ledger's value (the ledger
// is the truth; a cache that disagrees is the bug). Same project guards as grant.mjs.
//
//   node scripts/reconcile.mjs FAMILY_UUID [CHILD_UUID]
import { FirestoreStore } from '../server/firebase.mjs';
import { reconcile } from '../server/ledger.mjs';
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
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const family = await store.get(`families/${familyId}`);
if (!family) throw Error('FAMILY_NOT_FOUND');
let bad = 0;
for (const childId of (family.childIds || []).filter((id) => !onlyChild || id === onlyChild)) {
  const base = `families/${familyId}/learning/${childId}`;
  const prog = normalizeProgress(await store.get(base));
  const rows = await store.list(`${base}/ledger`);
  const r = reconcile(rows, prog.wallet);
  console.log(JSON.stringify({ childId, match: r.match, derived: r.derived, cached: r.cached, problems: r.problems }));
  if (r.match) continue;
  bad++;
  if (process.env.CONFIRM_REPAIR !== 'write') continue;
  await store.transaction(async (tx) => {
    const current = normalizeProgress(await tx.get(base));
    tx.set(base, { ...current, wallet: { ...current.wallet, gc: r.derived.gc, rp: r.derived.rp, ledgerSeq: r.derived.count, ledgerLast: r.derived.last } });
    tx.set(`audit/${crypto.randomUUID()}`, { action: 'ledger.repaired', familyId, childId, actor: process.env.OPERATOR_ID || 'emulator-operator', from: r.cached, to: r.derived, at: Date.now(), expireAt: Date.now() + 400 * 86_400_000 });
  });
  console.log(JSON.stringify({ childId, repaired: true }));
}
if (bad && process.env.CONFIRM_REPAIR !== 'write') { console.log(`${bad} wallet(s) disagree with their ledger. Set CONFIRM_REPAIR=write to set the cache to the ledger's value.`); process.exit(2); }
