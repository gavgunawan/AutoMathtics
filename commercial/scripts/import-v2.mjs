import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FirestoreStore } from '../server/firebase.mjs';
import { migrateV2GameConfig, migrateV2Progress } from '../server/v2-migration.mjs';

const args = process.argv.slice(2);
const take = (name) => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) return null; return args[i + 1]; };
const has = (name) => args.includes(name);
const file = take('--file'), familyId = take('--family'), apply = has('--apply'), overwrite = has('--overwrite');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
if (!file || !UUID.test(familyId || '')) {
  console.error('Usage: node scripts/import-v2.mjs --file v2-export.json --family FAMILY_UUID [--apply] [--overwrite]');
  console.error('Default is dry-run. --apply writes only to the configured v3 project. This script never connects to v2.');
  process.exit(1);
}
let bundle;
try { bundle = JSON.parse(await readFile(file, 'utf8')); } catch (e) { throw Error(`Could not parse ${file}: ${e.message}`); }
if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw Error('Import bundle must be a JSON object.');
const children = bundle.children && typeof bundle.children === 'object' && !Array.isArray(bundle.children) ? bundle.children : null;
if (!children || !Object.keys(children).length) throw Error('Bundle must contain children: { oldName: { childId, progress, multiplier? } }.');
const childMap = {}, multipliers = {};
for (const [oldName, entry] of Object.entries(children)) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !UUID.test(entry.childId || '')) throw Error(`Invalid childId for ${oldName}.`);
  if (Object.values(childMap).includes(entry.childId)) throw Error(`Duplicate childId in mapping: ${entry.childId}`);
  childMap[oldName] = entry.childId; if (Number.isFinite(entry.multiplier)) multipliers[oldName] = entry.multiplier;
}
const settings = { ...(bundle.settings && typeof bundle.settings === 'object' && !Array.isArray(bundle.settings) ? bundle.settings : {}), paceMultipliers: multipliers };
const familyMigration = migrateV2GameConfig(settings, bundle.rocket || null, childMap);
const migrations = [];
for (const [oldName, entry] of Object.entries(children)) {
  const source = entry.progress && typeof entry.progress === 'object' ? entry.progress : entry;
  const pacePercent = Number.isFinite(entry.pacePercent) ? entry.pacePercent : familyMigration.paceByChildId[entry.childId];
  const migrated = migrateV2Progress(source, { pacePercent });
  migrations.push({ oldName, childId: entry.childId, ...migrated });
}
const summary = {
  mode: apply ? 'APPLY' : 'DRY_RUN', familyId, children: migrations.map((m) => ({ oldName: m.oldName, childId: m.childId,
    engine: m.progress.engine, nav: m.progress.nav, wallet: { gc: m.progress.wallet.gc, rp: m.progress.wallet.rp, inventory: m.progress.wallet.inventory.length },
    historyRows: m.progress.history.length, passes: m.progress.stats.passes, pacePercent: m.progress.pacePercent, warnings: m.report.warnings })),
  rewards: familyMigration.config.rewards.length, rocket: familyMigration.config.rocket ? familyMigration.config.rocket.status : null, timeZone: familyMigration.timeZone,
};
console.log(JSON.stringify(summary, null, 2));
if (!apply) {
  console.log('DRY RUN ONLY: no Firebase SDK was loaded and no database was modified. Re-run with --apply after reviewing this output.');
  process.exit(0);
}

const { APP_MODE: mode, FIREBASE_PROJECT_ID: projectId } = process.env;
const emulator = mode === 'emulator';
if (!['emulator', 'staging', 'production'].includes(mode) || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '') || projectId === 'automathtics') {
  throw Error('Set APP_MODE and a NEW v3 FIREBASE_PROJECT_ID. The live v2 project is forbidden.');
}
if (emulator) {
  if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') throw Error('Use demo-* and Firestore emulator 127.0.0.1:8088.');
} else if (projectId.startsWith('demo-') || process.env.CONFIRM_PROJECT !== projectId || Object.keys(process.env).some((k) => k.includes('EMULATOR') && process.env[k])) {
  throw Error('Cloud import requires CONFIRM_PROJECT equal to the v3 project and no emulator variables.');
}
const actor = emulator ? 'emulator-v2-import' : process.env.OPERATOR_ID;
if (!actor) throw Error('Set OPERATOR_ID to an auditable operator identity.');
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) });
const store = new FirestoreStore(getFirestore(app), { timestamp: (ms) => Timestamp.fromMillis(ms) });
const configPath = `families/${familyId}/game/config`;
await store.transaction(async (tx) => {
  const family = await tx.get(`families/${familyId}`); if (!family) throw Error('Target family not found.');
  const rows = [];
  for (const m of migrations) {
    const child = await tx.get(`families/${familyId}/children/${m.childId}`); if (!child || child.status !== 'active') throw Error(`Target child missing/inactive: ${m.childId}`);
    const current = await tx.get(`families/${familyId}/learning/${m.childId}`); rows.push({ m, current });
  }
  const currentConfig = await tx.get(configPath);
  if (!overwrite && rows.some((x) => x.current)) throw Error('Target progress already exists. Re-run only after review with --overwrite if replacement is intended.');
  if (!overwrite && currentConfig && (currentConfig.rewards?.length || currentConfig.rocket)) throw Error('Target game config already contains data; --overwrite is required.');
  const validChildIds = new Set(family.childIds || []); if (migrations.some((m) => !validChildIds.has(m.childId))) throw Error('A mapped child is not a member of the target family.');
  for (const { m } of rows) tx.set(`families/${familyId}/learning/${m.childId}`, m.progress);
  if (bundle.settings || bundle.rocket) tx.set(configPath, familyMigration.config);
  const importTimeZone = bundle.settings && Object.hasOwn(bundle.settings, 'timeZone')
    ? familyMigration.timeZone : family.timeZone || familyMigration.timeZone || 'Asia/Singapore';
  tx.set(`families/${familyId}`, { ...family, timeZone: importTimeZone });
  const at = Date.now();
  tx.set(`audit/${randomUUID()}`, { action: 'operator.v2_import', uid: actor, familyId, childId: null,
    childIds: migrations.map((m) => m.childId), overwrite, at, expireAt: at + 400 * 24 * 60 * 60_000 });
});
console.log(JSON.stringify({ imported: true, familyId, childIds: migrations.map((m) => m.childId), projectId, overwrite }));
