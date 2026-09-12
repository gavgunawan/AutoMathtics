// Operator tool: give every pre-ledger wallet in a family its opening row, once. A wallet that
// already has rows, or has nothing to carry, is untouched, so the tool is safe to run twice.
// Until a non-zero wallet is bootstrapped the ledger primitive refuses to move its money
// (LEDGER_NOT_BOOTSTRAPPED), so this is the required first step for any v3 data written before
// Stage 3.1. Dry run by default; CONFIRM_BOOTSTRAP=write to write. Same project guards as grant.mjs.
//
//   node scripts/bootstrap-ledger.mjs FAMILY_UUID [CHILD_UUID]
import { randomUUID } from 'node:crypto';
import { FirestoreStore } from '../server/firebase.mjs';
import { bootstrap } from '../server/ledger.mjs';
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
  throw Error('Confirm the exact new project; remove all emulator variables for cloud writes.');
}
const [familyId, onlyChild] = process.argv.slice(2);
if (!familyId) { console.error('Usage: node scripts/bootstrap-ledger.mjs FAMILY_UUID [CHILD_UUID]'); process.exit(1); }
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (process.env.CONFIRM_BOOTSTRAP === 'write' && !actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const family = await store.get(`families/${familyId}`);
if (!family) throw Error('FAMILY_NOT_FOUND');
for (const childId of (family.childIds || []).filter((id) => !onlyChild || id === onlyChild)) {
  const base = `families/${familyId}/learning/${childId}`;
  const prog = normalizeProgress(await store.get(base));
  const needs = (prog.wallet.ledgerSeq || 0) === 0 && (prog.wallet.gc || prog.wallet.rp);
  console.log(JSON.stringify({ childId, gc: prog.wallet.gc, rp: prog.wallet.rp, ledgerSeq: prog.wallet.ledgerSeq || 0, needsOpeningRow: !!needs }));
  if (!needs || process.env.CONFIRM_BOOTSTRAP !== 'write') continue;
  let opened;
  try {
    opened = await store.transaction(async (tx) => {
      const current = normalizeProgress(await tx.get(base));
      const r = await bootstrap(tx, base, current, Date.now());
      if (r.opened) { tx.set(base, r.prog); tx.set(`audit/${randomUUID()}`, { action: 'ledger.bootstrapped', familyId, childId, actor, gc: current.wallet.gc, rp: current.wallet.rp, at: Date.now(), expireAt: Date.now() + 400 * 86_400_000 }); }
      return r.opened;
    });
  } catch (error) {
    if (error.code !== 'LEDGER_DAMAGED') throw error;
    console.log(JSON.stringify({ childId, opened: false, damaged: true, note: 'ledger rows exist but the wallet says none; run scripts/reconcile.mjs and investigate before bootstrapping' }));
    process.exitCode = 3; continue;
  }
  console.log(JSON.stringify({ childId, opened }));
}
if (process.env.CONFIRM_BOOTSTRAP !== 'write') console.log('Dry run. Set CONFIRM_BOOTSTRAP=write to write opening rows.');
