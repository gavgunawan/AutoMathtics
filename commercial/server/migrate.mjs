// One-off import of a v2 (the live GitHub Pages game) progress record into a v3 learning document.
// Operator-only: reached from scripts/migrate-v2.mjs, never from an HTTP route. This is the only
// code that ever writes progress into a family from outside the learning engine, and it refuses
// to touch a child who already has any.
import { randomUUID } from 'node:crypto';
import { fail, uuid, text } from './security.mjs';
import { GC_PASS, RP_PASS, LEVELS, PAPERS_PER_LEVEL, Q_PER_PAPER, EQUIP_SLOTS, freshProgress, normalizeWallet, bonusesFor } from './progress.mjs';
import { SHOP_ITEMS } from './game.mjs';
import { entry, post } from './ledger.mjs';

const KNOWN_ITEMS = new Set(SHOP_ITEMS.map((x) => x.id));
const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

const HISTORY_MAX = 60, PASS_DAYS_MAX = 400, DAY = 24 * 60 * 60_000;
const int = (v, lo, hi, name) => { if (!Number.isInteger(v) || v < lo || v > hi) fail(400, `V2_RECORD_INVALID:${name}`); return v; };
const track = (t, name) => ({ level: int(t.level ?? 0, 0, LEVELS.length - 1, `${name}.level`), paper: int(t.paper ?? 1, 1, PAPERS_PER_LEVEL + 1, `${name}.paper`), bossCleared: int(t.bossCleared ?? 0, 0, 5, `${name}.bossCleared`) });
const minsToSecs = (m) => { const x = /^(\d+):(\d\d)$/.exec(String(m || '')); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
const cleanPapers = (s) => String(s || '').replace(/^🧭 /, '').replace(/^🔁 /, 'practice ').replace(/^👑 CHECK POINT /, 'CP ').replace(/^🧠 SCAN$/, 'SCAN').trim();
const modeOf = (r) => (r.boss ? 'boss' : r.scan ? 'scan' : r.practice ? 'practice' : 'paper');

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

/** Transactional: refuses unless the child exists, is active, belongs to the family, and has no progress yet. */
export async function importLearning(store, { familyId, childId, record, actor, reason }, now = Date.now()) {
  uuid(familyId); uuid(childId); text(actor, 3, 200); text(reason, 5, 200);
  const { doc, summary } = convertV2(record, { now });
  return store.transaction(async (tx) => {
    const family = await tx.get(`families/${familyId}`);
    const child = family ? await tx.get(`families/${familyId}/children/${childId}`) : null;
    const existing = child ? await tx.get(`families/${familyId}/learning/${childId}`) : null;
    if (!family || !child || !family.childIds.includes(childId)) fail(404, 'CHILD_NOT_FOUND');
    if (child.status !== 'active') fail(409, 'CHILD_INACTIVE');
    if (existing) fail(409, 'ALREADY_HAS_PROGRESS'); // never merge, never overwrite — an operator deletes by hand if it was wrong
    // The carried balance is the ledger's opening row, so the child's ledger derives to the wallet from day one.
    const base = `families/${familyId}/learning/${childId}`;
    const opened = post(tx, base, { ...doc, wallet: { ...doc.wallet, gc: 0, rp: 0, ledgerSeq: 0, ledgerLast: null } },
      entry({ id: 'migrate-opening', type: 'migrate.opening', gc: doc.wallet.gc, rp: doc.wallet.rp, note: 'carried from v2', at: now }));
    tx.set(base, opened);
    tx.set(`audit/${randomUUID()}`, { action: 'learning.migrated', familyId, childId, actor, reason, at: now, expireAt: now + 400 * DAY,
      summary: { rows: summary.rows, kept: summary.kept, passes: summary.passes, gc: summary.gc, rp: summary.rp, engine: `${LEVELS[doc.engine.level].id}${doc.engine.paper}`, nav: `${LEVELS[doc.nav.level].id}${doc.nav.paper}` } });
    return summary;
  });
}
