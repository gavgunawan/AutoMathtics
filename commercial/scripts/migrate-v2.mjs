// One-off operator tool: import a child's v2 progress record (a JSON file the operator exported
// from the old game's database) into their v3 learning document. Same project guards as grant.mjs.
// This tool never connects to the v2 project; the record comes in as a file.
//
//   node scripts/migrate-v2.mjs FAMILY_UUID CHILD_UUID path/to/child.json "reason"
//
// Prints the conversion summary and stops. Set CONFIRM_MIGRATION=write to actually write.
import { readFile } from 'node:fs/promises';
import { FirestoreStore } from '../server/firebase.mjs';
import { convertV2, importLearning } from '../server/migrate.mjs';

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
  throw Error('Confirm the exact new project; remove all emulator variables for cloud writes.');
}
const [familyId, childId, file, reason] = process.argv.slice(2);
if (!familyId || !childId || !file || !reason) {
  console.error('Usage: node scripts/migrate-v2.mjs FAMILY_UUID CHILD_UUID path/to/child.json "reason"');
  process.exit(1);
}
const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
if (!actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
const record = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')); // exports from Windows tools often carry a BOM
const { summary } = convertV2(record, { now: Date.now() });
console.log(JSON.stringify({ event: 'migration_preview', familyId, childId, ...summary }, null, 2));
if (process.env.CONFIRM_MIGRATION !== 'write') {
  console.log('Dry run. Set CONFIRM_MIGRATION=write to import. Nothing was written.');
  process.exit(0);
}
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const result = await importLearning(new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) }), { familyId, childId, record, actor, reason });
console.log(JSON.stringify({ event: 'migration_written', familyId, childId, ...result }));
