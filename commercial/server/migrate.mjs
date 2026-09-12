// One-off import of a v2 (the live GitHub Pages game) progress record into a v3 learning document.
// Operator-only: reached from scripts/migrate-v2.mjs, never from an HTTP route. This is the only
// code that ever writes progress into a family from outside the learning engine, and it refuses
// to touch a child who already has any.
import { randomUUID } from 'node:crypto';
import { Fault, fail, uuid, text } from './security.mjs';
import { GC_PASS, RP_PASS, LEVELS, PAPERS_PER_LEVEL, Q_PER_PAPER, EQUIP_SLOTS, freshProgress, normalizeWallet, bonusesFor } from './progress.mjs';
import { SHOP_ITEMS, ROCKET_LIMITS, rocketPrize, rocketFuel, rocketReady, readGameConfig } from './game.mjs';
import { entry, post } from './ledger.mjs';

const KNOWN_ITEMS = new Set(SHOP_ITEMS.map((x) => x.id));
const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

const HISTORY_MAX = 60, PASS_DAYS_MAX = 400, DAY = 24 * 60 * 60_000;
const int = (v, lo, hi, name) => { if (!Number.isInteger(v) || v < lo || v > hi) fail(400, `V2_RECORD_INVALID:${name}`); return v; };
const track = (t, name) => ({ level: int(t.level ?? 0, 0, LEVELS.length - 1, `${name}.level`), paper: int(t.paper ?? 1, 1, PAPERS_PER_LEVEL + 1, `${name}.paper`), bossCleared: int(t.bossCleared ?? 0, 0, 5, `${name}.bossCleared`) });
const minsToSecs = (m) => { const x = /^(\d+):(\d\d)$/.exec(String(m || '')); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
const cleanPapers = (s) => String(s || '').replace(/^🧭 /, '').replace(/^🔁 /, 'practice ').replace(/^👑 CHECK POINT /, 'CP ').replace(/^🧠 SCAN$/, 'SCAN').trim();
const modeOf = (r) => (r.boss ? 'boss' : r.scan ? 'scan' : r.practice ? 'practice' : 'paper');

// A family on its way out takes no import of either kind. A tombstone or a deletion being executed is the
// condition authorize() refuses every session on (server/service.mjs); a deletion the parent has asked for
// and not taken back (server/support.mjs: requestDeletion sets family.deletion, cancelDeletion removes it)
// means the family is to be removed in at most 14 days, so nothing is carried into it either.
function refuseClosingFamily(family) {
  if (family.deleted === true || family.deletion?.status === 'executing') fail(409, 'FAMILY_DELETED');
  if (family.deletion && family.deletion.status !== 'cancelled') fail(409, 'FAMILY_DELETION_PENDING');
}

/** Pure: v2 record → v3 learning document plus a summary of what was carried over. */
export function convertV2(record, { now }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(400, 'V2_RECORD_INVALID:shape');
  const engine = track(record, 'engine');
  const nav = track(record.nav || {}, 'nav');
  const rows = Array.isArray(record.history) ? record.history : [];
  const wallet = record.wallet && typeof record.wallet === 'object' ? record.wallet : {};
  // v2's economy, applied to v2's rows exactly as the live game did: every passed row pays,
  // check points and scans ×2, three consecutive pass-days (shield days count) one bonus.
  let earnedGc = 0, earnedRp = 0, passes = 0, sessions = 0;
  const passDays = new Set(Array.isArray(wallet.shieldDays) ? wallet.shieldDays.filter((d) => typeof d === 'string') : []);
  const history = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (r.shield) continue; // a streak-shield marker, not a session; its day is in wallet.shieldDays
    const t = r.track === 'nav' ? 'nav' : 'engine';
    const level = Number.isInteger(r.levelIdx) ? Math.min(Math.max(r.levelIdx, 0), LEVELS.length - 1) : 0;
    const base = { ts: Number.isFinite(r.ts) ? r.ts : null, date: typeof r.date === 'string' ? r.date : null, track: t, mode: modeOf(r), level, levelId: LEVELS[level].id, papers: cleanPapers(r.papers) };
    if (r.quit || r.restart) { history.push({ ...base, quit: true, atQ: Number.isInteger(r.atQ) ? r.atQ : 0, total: 5 * Q_PER_PAPER[t] }); continue; }
    sessions++;
    const passed = r.passed === true;
    if (passed) { passes++; const mult = r.boss || r.scan ? 2 : 1; earnedGc += GC_PASS * mult; earnedRp += RP_PASS * mult; if (!r.scan && base.date) passDays.add(base.date); }
    const qlog = Array.isArray(r.qlog) ? r.qlog.filter(Array.isArray).map((q) => ({ t: Number(q[0]) || 1, s: Number(q[1]) || 0, ok: q[2] ? 1 : 0 })) : [];
    history.push({ ...base, correct: Number(r.correct) || 0, incorrect: Number(r.incorrect) || 0, timeout: Number(r.timeout) || 0, total: Number(r.total) || 0, passed, secs: minsToSecs(r.mins), qlog });
  }
  const days = [...passDays].sort().slice(-PASS_DAYS_MAX);
  const bonuses = bonusesFor(days);
  earnedGc += bonuses * GC_PASS; earnedRp += bonuses * RP_PASS;
  const gcSpent = Math.max(0, Number(wallet.gcSpent) || 0), rpSpent = Math.max(0, Number(wallet.rpSpent) || 0);
  // The v2 wallet becomes the v3 game wallet: only items the v3 catalog knows are carried
  // (an unknown id is dropped and reported), equipped slots are kept when the item is owned,
  // and purchase / redemption rows take the shapes the game service writes.
  const inventory = (Array.isArray(wallet.inventory) ? wallet.inventory : []).filter((x) => typeof x === 'string');
  const carried = [...new Set(inventory.filter((id) => KNOWN_ITEMS.has(id)))], dropped = [...new Set(inventory.filter((id) => !KNOWN_ITEMS.has(id)))];
  const slots = {};
  for (const [kind, slot] of Object.entries(EQUIP_SLOTS)) { const v = wallet[slot]; slots[slot] = typeof v === 'string' && carried.includes(v) && SHOP_ITEMS.some((x) => x.id === v && x.kind === kind) ? v : null; }
  const purchases = (Array.isArray(wallet.purchases) ? wallet.purchases : []).filter((p) => p && typeof p === 'object')
    .map((p) => ({ id: str(p.id, 64), emoji: str(p.emoji, 12), name: str(p.name, 80), cost: Math.max(0, Number(p.cost) || 0), date: str(p.date, 10), at: null })).slice(0, 120);
  const redemptions = (Array.isArray(wallet.redemptions) ? wallet.redemptions : []).filter((p) => p && typeof p === 'object')
    .map((p) => ({ id: str(p.id, 64) || randomUUID(), rewardId: str(p.rewardId, 64), emoji: str(p.emoji, 12), name: str(p.name, 80), cost: Math.max(0, Number(p.cost) || 0), date: str(p.date, 10),
      status: ['pending', 'approved', 'rejected'].includes(p.status) ? p.status : 'approved', requestedAt: null, decidedAt: null })).slice(0, 50);
  const shieldDays = [...passDays].filter((d) => Array.isArray(wallet.shieldDays) && wallet.shieldDays.includes(d));
  const doc = {
    ...freshProgress(), engine, nav,
    wallet: normalizeWallet({ gc: Math.max(0, earnedGc - gcSpent), rp: Math.max(0, earnedRp - rpSpent), bonuses, gcSpent, rpSpent,
      inventory: carried, ...slots, shields: Math.min(2, Math.max(0, Number(wallet.shields) || 0)), shieldDays, egg: null, purchases, redemptions,
      lastScanWeek: typeof wallet.lastScanWeek === 'string' ? wallet.lastScanWeek : null }),
    passDays: days, stats: { sessions, passes },
    history: history.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, HISTORY_MAX), activeSession: null,
    legacy: { from: 'v2', at: now, earnedGc, earnedRp, gcSpent, rpSpent, droppedItems: dropped, savedAt: Number.isFinite(record.savedAt) ? record.savedAt : null },
  };
  // A pending v2 redemption still needs the parent's decision in v3; its points were already held.
  return { doc, summary: { engine, nav, rows: rows.length, kept: doc.history.length, sessions, passes, bonuses, earnedGc, earnedRp, gcSpent, rpSpent, gc: doc.wallet.gc, rp: doc.wallet.rp, passDays: days.length,
    inventory: carried.length, droppedItems: dropped, purchases: purchases.length, redemptions: redemptions.length, pendingRedemptions: redemptions.filter((r) => r.status === 'pending').length } };
}

/** Transactional: refuses unless the child exists, is active, belongs to a family that is not being deleted, and has no progress yet. */
export async function importLearning(store, { familyId, childId, record, actor, reason }, now = Date.now()) {
  uuid(familyId); uuid(childId); text(actor, 3, 200); text(reason, 5, 200);
  const { doc, summary } = convertV2(record, { now });
  return store.transaction(async (tx) => {
    const family = await tx.get(`families/${familyId}`);
    if (family) refuseClosingFamily(family); // before the child checks: a tombstone lists no children, and "not found" would hide why
    const child = family ? await tx.get(`families/${familyId}/children/${childId}`) : null;
    const existing = child ? await tx.get(`families/${familyId}/learning/${childId}`) : null;
    if (!family || !child || !family.childIds.includes(childId)) fail(404, 'CHILD_NOT_FOUND');
    if (child.status !== 'active') fail(409, 'CHILD_INACTIVE');
    // never merge, never overwrite anything played; a document that exists only because the child was created with a year level
    // (a pending placement test) or a pace was set is not progress (Stage 4 review, third round)
    if (existing && (existing.stats?.sessions > 0 || existing.activeSession || (existing.history || []).length > 0 || (existing.wallet?.ledgerSeq || 0) > 0)) fail(409, 'ALREADY_HAS_PROGRESS');
    // The carried balance is the ledger's opening row, so the child's ledger derives to the wallet from day one.
    const base = `families/${familyId}/learning/${childId}`;
    const carried = { ...(Number.isInteger(existing?.pacePercent) ? { pacePercent: existing.pacePercent } : {}), placement: { status: 'done', finishedAt: now, attempts: 0, result: null, source: 'v2-import' } }; // the v2 record places the child; no test is pending
    const opened = await post(tx, base, { ...doc, ...carried, wallet: { ...doc.wallet, gc: 0, rp: 0, ledgerSeq: 0, ledgerLast: null } },
      entry({ id: 'migrate-opening', type: 'migrate.opening', gc: doc.wallet.gc, rp: doc.wallet.rp, note: 'carried from v2', at: now }));
    tx.set(base, opened);
    tx.set(`audit/${randomUUID()}`, { action: 'learning.migrated', familyId, childId, actor, reason, at: now, expireAt: now + 400 * DAY,
      summary: { rows: summary.rows, kept: summary.kept, passes: summary.passes, gc: summary.gc, rp: summary.rp, engine: `${LEVELS[doc.engine.level].id}${doc.engine.paper}`, nav: `${LEVELS[doc.nav.level].id}${doc.nav.paper}` } });
    return summary;
  });
}

// ---------------------------------------------------------------------------------------------------
// The Family Rocket. v2 keeps one rocket per family (the export's `rocket` node); v3 keeps it in the
// family's game config. The owner's rule for the cutover (PILOT.md, decision 2) is that the v3 rocket
// opens with the EXACT fuel v2 shows on the day, and the parent route cannot do that: a built rocket
// always starts at fuel {} and fuel only arrives through the child fuel route, which charges the child.
//
// The accounting that decides the shape of this import: the child import above carries each balance as
// v2-earned minus v2-spent, and every point a child poured into the v2 rocket is in that spent figure
// (it is a v2 redemption, `rewardId: 'rocket'`). The fuel has therefore ALREADY left the carried wallets.
// So the rocket is carried as a plain config write: no ledger row, no wallet touched. Posting the fuel
// through the ledger again would take it from the children a second time.
//
// That accounting is enforced, not assumed: for every crew child, the v2 spending in the rocket's currency
// (the legacy block the child import wrote) must EQUAL that child's fuel plus the other spending the
// operator declares for that child (0 unless declared). Smaller, and some fuel never left the carried
// balance; larger and undeclared, and the difference is unexplained. Either way nothing is written and the
// owner decides. Earlier v2 rockets (the node's `history`) are the usual reason for other spending: fuel
// poured into them is in the spent figure too.
//
// The v3 rocket is built in exactly the shape Game.rocket's build branch writes — a fresh id, status,
// prize, currency, goal, minEach, crewChildIds, fuel keyed by child id, createdAt — and nothing else,
// so every reader (publicRocket, childRocket, rocketReady, the fuel route, both views) sees a normal
// rocket. v2-only fields (its id, createdOn, createdAt, the size of its history, the lastFuel note with a
// child's name in it) go to the summary, and only the ids and numbers among them to the audit row; never
// into the rocket. createdAt is the import time, as it would be if the parent had built it that day.

const rocketBad = (name) => fail(400, `V2_ROCKET_INVALID:${name}`);
const plainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// A refusal that carries the numbers the operator needs (printed by the CLI on stderr, rocketRefusalLines).
// No HTTP route reaches this module, so the detail never leaves the operator's terminal.
const refuse = (status, code, detail) => { const e = new Fault(status, code); e.detail = detail; throw e; };

// The file given to the rocket form is the `rocket` node itself. The two mistakes an operator can make with
// the files of one export are handing over the node still inside its wrapper (`{ "rocket": {...} }`, or the
// whole family export) and handing over a child's record; both are named, so the fix is obvious.
const CHILD_RECORD_KEYS = ['level', 'paper', 'bossCleared', 'nav', 'wallet', 'pin', 'savedBy'];
const ROCKET_KEYS = ['status', 'crew', 'fuel', 'goal', 'currency', 'prize', 'minEach'];
const wrongFile = (v) => Object.hasOwn(v, 'rocket') || CHILD_RECORD_KEYS.some((k) => Object.hasOwn(v, k))
  || (Object.hasOwn(v, 'history') && !Object.hasOwn(v, 'crew') && !Object.hasOwn(v, 'fuel')) // a child's history, not a rocket's
  || !ROCKET_KEYS.some((k) => Object.hasOwn(v, k));
// v2 keys a rocket's crew by `player.name.toLowerCase()` of a trimmed name, so a real crew key is never
// empty, padded or upper case; one that is was edited, and could never match a nickname anyway.
const crewNameOk = (n) => typeof n === 'string' && n.length >= 1 && n.length <= 40 && n.isWellFormed() && n === n.trim() && n === n.toLowerCase() && n === n.normalize('NFC');
// Only id-shaped and date-shaped v2 values are kept: they go to the audit row, which holds ids and numbers only.
const v2IdOf = (id) => (typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : Number.isSafeInteger(id) && id >= 0 ? String(id) : null);
const v2DateOf = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/**
 * Pure: a v2 rocket node plus a crew map (v2 crew name → v3 child id) and the operator's declared other
 * spending (v2 crew name → points, default 0 for each child) → the v3 rocket and a summary. Writes nothing.
 */
export function convertRocketV2(v2Rocket, crewMap, { now, otherSpent = {} } = {}) {
  if (!plainObject(v2Rocket)) rocketBad('shape');
  // v2's own "no rocket in progress" state: a v2 scrap or claim rewrites the node as { id: 'none', status:
  // 'claimed', history }. It is the right file with nothing in it, so it is named before the wrong-file test
  // (which would otherwise see a history without crew or fuel and send the operator to re-save the node, a
  // loop). There is nothing to carry: v3 starts without a rocket.
  if (v2Rocket.status === 'claimed') fail(400, 'V2_ROCKET_NONE');
  if (wrongFile(v2Rocket)) fail(400, 'V2_ROCKET_WRONG_FILE');
  // Only a rocket still being fuelled is carried. A launched v2 rocket is a prize the family owes, not
  // fuel in a tank; the owner settles it by hand and v3 starts without one.
  if (v2Rocket.status !== 'fueling') rocketBad('status');
  if (!ROCKET_LIMITS.currencies.includes(v2Rocket.currency)) rocketBad('currency');
  const { goal, minEach } = v2Rocket;
  if (!Number.isSafeInteger(goal) || goal < ROCKET_LIMITS.goalMin || goal > ROCKET_LIMITS.goalMax) rocketBad('goal');
  if (!Number.isSafeInteger(minEach) || minEach < 0 || minEach > goal) rocketBad('minEach');
  let prize; try { prize = rocketPrize(v2Rocket.prize); } catch { rocketBad('prize'); } // the build route's own cleaning and text() limits
  const names = v2Rocket.crew;
  if (!Array.isArray(names) || !names.length || !names.every(crewNameOk) || new Set(names).size !== names.length) rocketBad('crew');
  // fuel is keyed by crew names only; every amount a non-negative safe integer (v2 never had fractions or
  // debts, so either would mean the export was edited or damaged, and an estimate is not the exact fuel)
  if (!plainObject(v2Rocket.fuel)) rocketBad('fuel');
  for (const [name, amount] of Object.entries(v2Rocket.fuel)) {
    if (!names.includes(name)) rocketBad(`fuel.${name}`);
    if (!Number.isSafeInteger(amount) || amount < 0) rocketBad(`fuel.${name}`);
  }
  const fuelOf = (name) => (Object.hasOwn(v2Rocket.fuel, name) ? v2Rocket.fuel[name] : 0); // own keys only: a crew name like "constructor" reads nothing inherited
  // Earlier rockets. Counted and reported, never carried: their fuel is inside the spent figures.
  const history = v2Rocket.history ?? [];
  if (!Array.isArray(history)) rocketBad('history');
  // The crew map must match the crew exactly, both ways: a crew name with no child would drop that
  // child's fuel on the floor, and a mapping with no crew name means the operator is pointing at a
  // different rocket (or a typo) — both are refused rather than guessed.
  if (!plainObject(crewMap)) fail(400, 'V2_ROCKET_CREW_MAP_INVALID');
  for (const name of names) if (!Object.hasOwn(crewMap, name)) fail(400, `V2_ROCKET_UNMAPPED_CREW:${name}`);
  for (const name of Object.keys(crewMap)) if (!names.includes(name)) fail(400, `V2_ROCKET_MAPPING_WITHOUT_CREW:${name}`);
  const crewChildIds = names.map((name) => uuid(crewMap[name]));
  if (new Set(crewChildIds).size !== crewChildIds.length) fail(400, 'V2_ROCKET_CREW_MAP_DUPLICATE'); // two names, one child: one child's fuel would overwrite the other's
  // Other spending is declared per child, by crew name, or it is 0. Never guessed, never spread.
  if (!plainObject(otherSpent)) fail(400, 'V2_ROCKET_OTHER_SPENT_INVALID');
  for (const [name, amount] of Object.entries(otherSpent)) {
    if (!names.includes(name)) fail(400, `V2_ROCKET_OTHER_SPENT_WITHOUT_CREW:${name}`);
    if (!Number.isSafeInteger(amount) || amount < 0) fail(400, `V2_ROCKET_OTHER_SPENT_INVALID:${name}`);
  }
  const otherOf = (name) => (Object.hasOwn(otherSpent, name) ? otherSpent[name] : 0);
  const fuel = Object.fromEntries(Object.entries(v2Rocket.fuel).map(([name, amount]) => [crewMap[name], amount]));
  const rocket = { id: randomUUID(), status: 'fueling', prize, currency: v2Rocket.currency, goal, minEach, crewChildIds, fuel, createdAt: now };
  // A v2 rocket that is still fuelling but already meets its goal and every minimum should have launched
  // in v2. Importing it as fuelling would leave it stuck (the fuel route launches only on the next pour),
  // so the operator is told instead and the owner decides.
  if (rocketReady(rocket)) fail(400, 'V2_ROCKET_ALREADY_READY');
  const total = rocketFuel(rocket);
  const last = plainObject(v2Rocket.lastFuel) ? v2Rocket.lastFuel : null;
  return { rocket, summary: {
    v2Id: v2IdOf(v2Rocket.id), v2CreatedOn: v2DateOf(v2Rocket.createdOn), v2CreatedAt: Number.isSafeInteger(v2Rocket.createdAt) && v2Rocket.createdAt > 0 ? v2Rocket.createdAt : null,
    v2HistoryCount: history.length,
    prize: `${prize.emoji} ${prize.name}`, currency: rocket.currency, goal, minEach,
    crew: names.map((name) => ({ name, childId: crewMap[name], fuel: fuelOf(name), otherSpent: otherOf(name) })),
    totalFuel: total, remaining: goal - total, ready: false,
    lastFuelNotCarried: last ? { amount: Number.isSafeInteger(last.amt) ? last.amt : null, at: Number.isSafeInteger(last.at) ? last.at : null } : null,
  } };
}

// v2 keys a rocket's crew and fuel by `player.name.toLowerCase()` (the live game's fuel handler and its
// admin crew picker both do exactly that), and a v2 player's name was trimmed when the player was made.
// A v3 nickname is NFC and trimmed on the way in; normalising it the same way again costs nothing and
// keeps this check honest if that ever changes. The result must equal the v2 crew name exactly.
const v2CrewKey = (nickname) => (typeof nickname === 'string' ? nickname.normalize('NFC').trim().toLowerCase() : null);

/**
 * Transactional: carries the v2 rocket into the family's game config. Every check runs inside the one
 * transaction and before any write: the family exists and is not deleted, being deleted or asked to be
 * deleted; every crew child is an active child of this family whose nickname is the v2 crew name (so two
 * swapped ids are caught); every crew child was carried from v2 by importLearning first, and their v2
 * spending in the rocket's currency EQUALS their fuel plus their declared other spending (the accounting
 * note above); the family has never had a v2 rocket imported (the one-shot marker); and no rocket is in the
 * config. Writes the config and one audit row — never a ledger row, never a wallet.
 */
export async function importRocket(store, { familyId, crewMap, otherSpent = {}, v2Rocket, actor, reason }, now = Date.now()) {
  uuid(familyId); text(actor, 3, 200); text(reason, 5, 200);
  // The rocket id is drawn here, OUTSIDE the transaction, on purpose: if the store re-runs the function
  // after a commit whose outcome it could not see, the re-run carries the same id and can recognise its
  // own marker (below) instead of refusing its own write as a second import.
  const { rocket, summary } = convertRocketV2(v2Rocket, crewMap, { now, otherSpent });
  const spentKey = rocket.currency === 'gc' ? 'gcSpent' : 'rpSpent';
  return store.transaction(async (tx) => {
    const family = await tx.get(`families/${familyId}`);
    if (!family) fail(404, 'FAMILY_NOT_FOUND');
    refuseClosingFamily(family);
    const children = [], learning = [];
    for (const id of rocket.crewChildIds) {
      children.push(await tx.get(`families/${familyId}/children/${id}`));
      learning.push(await tx.get(`families/${familyId}/learning/${id}`));
    }
    const { configPath, cfg } = await readGameConfig(tx, familyId); // the game service's own read, defaults and all
    // The legacy block, never the wallet: wallet.rpSpent keeps moving as the child plays v3, legacy is what v2 said.
    const spentOf = (i) => (Number.isSafeInteger(learning[i]?.legacy?.[spentKey]) ? learning[i].legacy[spentKey] : null);
    const crew = summary.crew.map((c, i) => ({ ...c, spent: spentOf(i), nickname: typeof children[i]?.nickname === 'string' ? children[i].nickname : null }));
    const result = (alreadyWritten) => ({ ...summary, crew, rocketId: rocket.id, alreadyWritten });
    // The one-shot marker, read before anything that could refuse for another reason. A marker naming
    // THIS run's rocket id can only be this run's own commit, seen again by a retried transaction: report
    // it and write nothing. Any other marker means this family's v2 rocket was carried before — even if
    // that rocket has since been claimed or scrapped, importing the file again would pour the same v2 fuel
    // into a second rocket.
    const marker = cfg.rocketMigration;
    if (marker) {
      if (marker.rocketId === rocket.id) return result(true);
      refuse(409, 'V2_ROCKET_ALREADY_IMPORTED', { rocketId: marker.rocketId ?? null, at: marker.at ?? null });
    }
    rocket.crewChildIds.forEach((id, i) => {
      if (!children[i] || !(family.childIds || []).includes(id)) fail(404, 'CHILD_NOT_FOUND');
      // the build route admits only active children to a crew; a paused child could not fuel anyway
      if (!(family.activeChildIds || []).includes(id) || children[i].status !== 'active') fail(409, 'CHILD_INACTIVE');
    });
    summary.crew.forEach(({ name }, i) => {
      // two ids swapped in the map would give each child the other's fuel; the nickname catches it
      if (v2CrewKey(children[i].nickname) !== name) fail(409, `V2_ROCKET_CREW_NAME_MISMATCH:${name}`);
    });
    summary.crew.forEach(({ name, childId, fuel, otherSpent: other }, i) => {
      // Children first: without the v2 legacy block there is no carried balance the fuel was taken from.
      if (learning[i]?.legacy?.from !== 'v2') fail(409, `V2_ROCKET_CHILD_NOT_IMPORTED:${name}`);
      // The equality the whole import rests on (the accounting note above).
      const spent = spentOf(i), expected = fuel + other;
      if (spent !== expected) refuse(409, `V2_ROCKET_FUEL_SPENT_MISMATCH:${name}`, { name, childId, spentKey, spent, fuel, otherSpent: other, expected });
    });
    // Only a fuelling or launched rocket can sit in the config (scrap and claim move it to the history and
    // clear it). Neither is ever replaced by an import — a rocket the parent already built stops here.
    if (cfg.rocket) fail(409, 'ROCKET_EXISTS');
    // The marker sits beside the rocket in the config, never inside it: every reader spreads the config
    // (normalizeConfig, the fuel, rewards and rocket routes), so it survives claim and scrap, and no route
    // sends the raw config to a browser (the family export strips it, server/support.mjs). No operator
    // identity goes in it — that is in the audit row. Every value is a number, a string or null: Firestore
    // refuses undefined (FirestoreStore passes documents to the Admin SDK as they are).
    const rocketMigration = { v2Id: summary.v2Id, rocketId: rocket.id, at: now };
    tx.set(configPath, { ...cfg, rocket, rocketMigration, updatedAt: now }); // rocketHistory and rewards exactly as read
    // Audit rows outlive a family's deletion (PRIVACY.md: ids and numbers only), so this one holds no child
    // name, no nickname and no prize text: the rocket and the crew are named by id.
    tx.set(`audit/${randomUUID()}`, { action: 'rocket.migrated', familyId, childId: null, actor, reason, at: now, expireAt: now + 400 * DAY,
      summary: { rocketId: rocket.id, v2Id: summary.v2Id, v2CreatedOn: summary.v2CreatedOn, v2CreatedAt: summary.v2CreatedAt, v2HistoryCount: summary.v2HistoryCount,
        currency: rocket.currency, goal: rocket.goal, minEach: rocket.minEach, totalFuel: summary.totalFuel,
        crew: crew.map(({ childId, fuel, spent, otherSpent: other }) => ({ childId, fuel, spent, otherSpent: other })) } });
    return result(false);
  });
}

/**
 * The lines the operator tool prints on stderr for a refusal that carries numbers. Operator-only: the
 * detail is set by importRocket above, which no HTTP route reaches. Any other error prints nothing extra.
 */
export function rocketRefusalLines(error) {
  const d = error?.detail;
  if (!d || typeof error.code !== 'string') return [];
  if (error.code.startsWith('V2_ROCKET_FUEL_SPENT_MISMATCH:')) {
    const lines = [`${error.code}: ${d.name} (child ${d.childId}) has v2 ${d.spentKey} ${d.spent ?? 'missing'}; fuel ${d.fuel} + declared other spending ${d.otherSpent} = ${d.expected}. They must be equal. Nothing was written.`];
    if (d.spent === null) lines.push('The child’s v2 legacy block has no spending figure in this currency: stop, the owner decides.');
    else if (d.spent < d.expected) lines.push(`The v2 spending is ${d.expected - d.spent} short: that much of the fuel (or of the declared other spending) never left the carried balance. Stop: the owner decides.`);
    else lines.push(`${d.spent - d.expected} of the v2 spending is not accounted for. Stop: the owner decides what it was. Only spending the owner confirms is declared, as other.${d.name}=AMOUNT (the total other spending for this child), and the dry run is repeated.`);
    return lines;
  }
  if (error.code === 'V2_ROCKET_ALREADY_IMPORTED') {
    const at = Number.isSafeInteger(d.at) ? `${d.at} (${new Date(d.at).toISOString()})` : String(d.at);
    return [`V2_ROCKET_ALREADY_IMPORTED: this family's v2 rocket was already imported as rocketId ${d.rocketId} at ${at}. Nothing was written. Do not retry: go to cutover step 8 and verify.`];
  }
  return [];
}
