// One-off operator tool: import a child's v2 progress record (a JSON file the operator exported
// from the old game's database) into their v3 learning document. Same project guards as grant.mjs.
// This tool never connects to the v2 project; the record comes in as a file.
//
//   node scripts/migrate-v2.mjs FAMILY_UUID CHILD_UUID path/to/child.json "reason"
//
// The family's Family Rocket (the v2 export's `rocket` node) comes over with its own form, after both
// children have been imported. Every v2 crew name is mapped to the v3 child it became, and the map must
// cover the crew exactly (server/migrate.mjs, importRocket). It writes the rocket with its exact fuel into
// the family's game config and one audit row — no ledger row and no wallet change, because the children's
// carried balances already had that fuel taken out as v2 spending.
//
//   node scripts/migrate-v2.mjs rocket FAMILY_UUID path/to/rocket.json allison=CHILD_UUID geralt=CHILD_UUID [other.allison=N ...] "reason"
//
// The write refuses unless each crew child's v2 spending in the rocket's currency equals their fuel plus
// their other spending. Other spending is 0 for every child unless declared, one child at a time, as
// `other.NAME=N` (N whole points, the child's total v2 spending in that currency that is NOT this rocket's
// fuel — earlier rockets, for instance). Declare only what the owner has confirmed.
//
// Either form prints the conversion summary and stops. The child form writes only with
// CONFIRM_MIGRATION=write; the rocket form only with CONFIRM_MIGRATION=rocket, so a `write` left over from
// the child step still gives a rocket dry run. Set the variable as a one-shot prefix of the one command.
import { readFile } from 'node:fs/promises';
import { FirestoreStore } from '../server/firebase.mjs';
import { convertV2, importLearning, convertRocketV2, importRocket, rocketRefusalLines } from '../server/migrate.mjs';
import { uuid } from '../server/security.mjs';

// v2 keys its rocket crew by the player's name lower-cased; the pilot family's names are plain letters.
const CREW_NAME = /^[a-z0-9_-]{1,40}$/;
const POINTS = /^(0|[1-9]\d{0,15})$/;
const CHILD_USAGE = 'Usage: node scripts/migrate-v2.mjs FAMILY_UUID CHILD_UUID path/to/child.json "reason"';
const ROCKET_USAGE = 'Usage: node scripts/migrate-v2.mjs rocket FAMILY_UUID path/to/rocket.json NAME=CHILD_UUID [NAME=CHILD_UUID ...] [other.NAME=POINTS ...] "reason"';

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

// The write path's one Firestore client. When a transaction refuses (the importer throws inside it), the Admin
// SDK sends the rollback WITHOUT waiting for it; a process that exits on the error right away never sends it,
// and the documents the transaction read stay locked until the lock times out — the next run, the operator's
// corrected one, then fails with "Transaction lock timeout". terminate() waits for requests in flight, so the
// rollback goes out and the locks are released before the error ends the process.
async function withFirestore(fn) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
  const db = getFirestore(app);
  try { return await fn(new FirestoreStore(db, { timestamp: (ms) => Timestamp.fromMillis(ms) })); }
  finally { await db.terminate().catch(() => {}); }
}

if (process.argv[2] === 'rocket') {
  // rocket FAMILY_UUID file name=CHILD_UUID... [other.name=N...] "reason": the reason is always the last
  // argument, and one that looks like a mapping means the reason was left off — refuse rather than import
  // under "geralt=…".
  const [familyId, file, ...rest] = process.argv.slice(3);
  // Null-prototype maps: a crew name such as "__proto__" or "constructor" is an own key like any other,
  // never something inherited from Object.prototype that the importer's checks could trip over.
  const reason = rest.pop(), crewMap = Object.create(null), otherSpent = Object.create(null);
  const usage = () => { console.error(ROCKET_USAGE); process.exit(1); };
  if (!familyId || !file || !reason || /^[^\s=]+=\S+$/.test(reason)) usage();
  let mappings = 0;
  for (const pair of rest) {
    // other.NAME=POINTS: this child's v2 spending that is not this rocket's fuel. A crew name has no dot,
    // so this can never be read as a mapping; declared once per child, whole points only.
    const other = /^other\.([^=]*)=(.*)$/.exec(pair);
    if (other) {
      if (!CREW_NAME.test(other[1]) || Object.hasOwn(otherSpent, other[1]) || !POINTS.test(other[2]) || !Number.isSafeInteger(Number(other[2]))) usage();
      otherSpent[other[1]] = Number(other[2]); continue;
    }
    const m = /^([^=]+)=(.+)$/.exec(pair);
    // a v2 crew key is a lower-cased player name; anything else is a typo, and a name given twice is too
    if (!m || !CREW_NAME.test(m[1]) || Object.hasOwn(crewMap, m[1])) usage();
    crewMap[m[1]] = m[2]; mappings++;
  }
  if (!mappings) usage();
  uuid(familyId); // a mistyped family id is caught on the dry run, not first on the write
  const actor = emulator ? 'emulator-operator' : process.env.OPERATOR_ID;
  if (!actor) throw Error('Set OPERATOR_ID to your auditable operator identity.');
  const v2Rocket = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')); // exports from Windows tools often carry a BOM
  const { summary } = convertRocketV2(v2Rocket, crewMap, { now: Date.now(), otherSpent });
  console.log(JSON.stringify({ event: 'rocket_migration_preview', familyId, ...summary }, null, 2));
  if (summary.v2HistoryCount > 0) {
    // earlier v2 rockets: their fuel is inside the children's spending too, and nothing here can split it out
    console.error(`WARNING: this v2 rocket lists ${summary.v2HistoryCount} earlier rocket(s) in its history. Fuel poured into those rockets is inside each child's v2 spending as well,`);
    console.error('so the write refuses (V2_ROCKET_FUEL_SPENT_MISMATCH) unless that spending is declared per child as other.NAME=POINTS. Declare only amounts the owner has confirmed.');
  }
  const token = process.env.CONFIRM_MIGRATION;
  if (token !== 'rocket') {
    if (token === 'write') console.log('CONFIRM_MIGRATION=write confirms the child form only; the rocket form writes only with CONFIRM_MIGRATION=rocket.');
    // the dry run reads only the file: say plainly what it has not checked, so a clean preview is not taken for more
    console.log('Checked only on the write: family membership and deletion, active seats, nicknames, v2 spending equal to fuel plus other spending, and the one-shot marker.');
    console.log('Dry run. Put CONFIRM_MIGRATION=rocket in front of this same command to import the rocket. Nothing was written.');
    process.exit(0);
  }
  let result;
  try {
    result = await withFirestore((store) => importRocket(store, { familyId, crewMap, otherSpent, v2Rocket, actor, reason }));
  } catch (error) {
    for (const line of rocketRefusalLines(error)) console.error(line); // both numbers of a mismatch; the existing import of a repeat
    throw error;
  }
  console.log(JSON.stringify({ event: 'rocket_migration_written', familyId, ...result }));
} else {
  const [familyId, childId, file, reason] = process.argv.slice(2);
  if (!familyId || !childId || !file || !reason) {
    console.error(CHILD_USAGE);
    console.error(`   or: ${ROCKET_USAGE.slice('Usage: '.length)}`);
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
  const result = await withFirestore((store) => importLearning(store, { familyId, childId, record, actor, reason }));
  console.log(JSON.stringify({ event: 'migration_written', familyId, childId, ...result }));
}
