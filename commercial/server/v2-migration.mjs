import { randomUUID } from 'node:crypto';
import { bonusesFor, freshProgress, freshWallet, normalizeProgress, LEVELS } from './progress.mjs';
import { SHOP_ITEMS } from './game.mjs';

const DAY = 86_400_000;
const KNOWN_ITEMS = new Map(SHOP_ITEMS.map((x) => [x.id, x]));
const SLOTS = Object.freeze({
  activePet: 'pet', activeFx: 'fx', activeSnd: 'snd', activeBg: 'bg', ring: 'ring',
  activeOutfit: 'outfit', activeShout: 'shout', activeTimer: 'timer', activeTitle: 'title',
  activeNameFx: 'namefx', activeMap: 'map', activeVehicle: 'vehicle', activeBase: 'base',
});
const SAFE_REWARD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK = /^\d{4}-W\d{2}$/;
const int = (x, fallback = 0, lo = 0, hi = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) ? Math.max(lo, Math.min(hi, x)) : fallback;
const uniq = (xs) => [...new Set(xs)];
const cleanDate = (x) => typeof x === 'string' && DATE.test(x) && Number.isFinite(Date.parse(`${x}T00:00:00Z`)) ? x : null;
const cleanText = (x, max, fallback = '') => typeof x === 'string' ? x.normalize('NFC').trim().slice(0, max) : fallback;
const cleanEmoji = (x) => cleanText(x, 12, '🎁') || '🎁';
const cleanLevel = (x) => int(x, 0, 0, LEVELS.length - 1);
const cleanPaper = (x) => int(x, 1, 1, 101);
const cleanBoss = (x) => int(x, 0, 0, 5);
const cleanTimeZone = (x) => {
  if (typeof x !== 'string' || x.length < 1 || x.length > 64) return 'Asia/Singapore';
  try { new Intl.DateTimeFormat('en', { timeZone: x }).format(0); return x; }
  catch { return 'Asia/Singapore'; }
};
const rowMode = (h) => h?.scan ? 'scan' : h?.boss ? 'boss' : h?.practice ? 'practice' : 'paper';
const rowTrack = (h) => h?.track === 'nav' || String(h?.papers || '').includes('🧭') ? 'nav' : 'engine';

function secondsFromOld(row) {
  if (Number.isSafeInteger(row?.secs) && row.secs >= 0) return row.secs;
  if (typeof row?.mins === 'number' && Number.isFinite(row.mins) && row.mins >= 0) return Math.round(row.mins * 60);
  const m = typeof row?.mins === 'string' ? row.mins.match(/^(\d+):(\d{2})$/) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function qlogFromOld(row) {
  if (!Array.isArray(row?.qlog)) return [];
  const fallbackTrack = rowTrack(row), fallbackLevel = cleanLevel(row?.levelIdx ?? row?.level);
  return row.qlog.slice(0, 60).flatMap((q) => {
    if (Array.isArray(q)) {
      const [tier, secs, ok, qLevel, isNav] = q;
      if (!Number.isInteger(tier) || tier < 1 || tier > 5) return [];
      return [{ t: tier, l: cleanLevel(qLevel ?? fallbackLevel), track: isNav ? 'nav' : fallbackTrack,
        ...(Number.isFinite(secs) && secs >= 0 ? { s: Math.round(secs) } : {}), ok: ok ? 1 : 0 }];
    }
    if (!q || typeof q !== 'object' || Array.isArray(q)) return [];
    const tier = Number.isInteger(q.t) ? q.t : q.tier;
    if (!Number.isInteger(tier) || tier < 1 || tier > 5) return [];
    const track = q.track === 'nav' ? 'nav' : q.track === 'engine' ? 'engine' : fallbackTrack;
    const out = { t: tier, l: cleanLevel(q.l ?? q.level ?? fallbackLevel), track, ok: q.ok ? 1 : 0 };
    if (Number.isFinite(q.s ?? q.secs) && (q.s ?? q.secs) >= 0) out.s = Math.round(q.s ?? q.secs);
    if (Number.isFinite(q.a ?? q.allowed) && (q.a ?? q.allowed) > 0) out.a = Math.round(q.a ?? q.allowed);
    return [out];
  });
}

export function migrateHistoryRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const date = cleanDate(row.date), track = rowTrack(row), level = cleanLevel(row.levelIdx ?? row.level);
  const out = {
    ...(Number.isSafeInteger(row.ts) && row.ts >= 0 ? { ts: row.ts } : date ? { ts: Date.parse(`${date}T12:00:00Z`) } : {}),
    ...(date ? { date } : {}), track, mode: rowMode(row), level, levelId: LEVELS[level].id,
    papers: cleanText(String(row.papers ?? '—'), 40, '—'),
  };
  for (const k of ['correct', 'incorrect', 'timeout', 'total', 'atQ']) if (Number.isSafeInteger(row[k]) && row[k] >= 0) out[k] = row[k];
  if (typeof row.passed === 'boolean') out.passed = row.passed;
  if (row.quit === true) out.quit = true;
  if (row.restart === true) out.restart = true;
  if (row.shield === true) out.shield = true;
  const secs = secondsFromOld(row); if (secs !== null) out.secs = secs;
  const qlog = qlogFromOld(row); if (qlog.length) out.qlog = qlog;
  return out;
}

function sanitizePurchases(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 120).flatMap((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
    const id = cleanText(r.id, 64); if (!id) return [];
    const cost = int(r.cost, 0, 0, 1_000_000), date = cleanDate(r.date);
    return [{ id, emoji: cleanEmoji(r.emoji), name: cleanText(r.name, 100, id), cost, ...(date ? { date } : {}), ...(Number.isSafeInteger(r.at) ? { at: r.at } : {}) }];
  });
}
function sanitizeRedemptions(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 50).flatMap((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
    const id = cleanText(String(r.id ?? ''), 64), rewardId = cleanText(String(r.rewardId ?? ''), 64);
    if (!id || !rewardId) return [];
    const status = ['pending', 'approved', 'rejected'].includes(r.status) ? r.status : 'approved', date = cleanDate(r.date);
    return [{ id, rewardId, emoji: cleanEmoji(r.emoji), name: cleanText(r.name, 100, rewardId), cost: int(r.cost, 0, 0, 1_000_000), status,
      ...(date ? { date } : {}), ...(Number.isSafeInteger(r.requestedAt) ? { requestedAt: r.requestedAt } : {}), ...(Number.isSafeInteger(r.decidedAt) ? { decidedAt: r.decidedAt } : {}) }];
  });
}

function oldEconomy(history, shieldDays) {
  let gcEarned = 0, rpEarned = 0, passes = 0, sessions = 0;
  const passDays = [];
  for (const h of history) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) continue;
    if (Number.isSafeInteger(h.total) && !h.quit && !h.restart) sessions++;
    if (!h.passed) continue;
    passes++;
    const mult = h.boss || h.scan ? 2 : 1;
    gcEarned += 50 * mult; rpEarned += 100 * mult;
    const d = cleanDate(h.date); if (!h.scan && d) passDays.push(d);
  }
  const days = uniq([...passDays, ...shieldDays]).sort();
  const bonuses = bonusesFor(days); gcEarned += bonuses * 50; rpEarned += bonuses * 100;
  return { gcEarned, rpEarned, bonuses, passes, sessions, passDays: uniq(passDays).sort().slice(-400) };
}

export function migrateV2Progress(source, { pacePercent = null } = {}) {
  const src = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const wallet = src.wallet && typeof src.wallet === 'object' && !Array.isArray(src.wallet) ? src.wallet : {};
  const warnings = [];
  const oldHistory = Array.isArray(src.history) ? src.history : [];
  const shieldDays = uniq((Array.isArray(wallet.shieldDays) ? wallet.shieldDays : []).map(cleanDate).filter(Boolean)).sort().slice(-400);
  const economy = oldEconomy(oldHistory, shieldDays);
  const gcSpent = int(wallet.gcSpent, 0, 0, 100_000_000), rpSpent = int(wallet.rpSpent, 0, 0, 100_000_000);
  if (wallet.gcSpent < 0 || wallet.rpSpent < 0) warnings.push('Negative v2 sandbox spend was not imported.');
  if (gcSpent > economy.gcEarned) warnings.push(`Grid-coin spend (${gcSpent}) exceeds reconstructed earnings (${economy.gcEarned}); balance was clamped to zero.`);
  if (rpSpent > economy.rpEarned) warnings.push(`Reward-point spend (${rpSpent}) exceeds reconstructed earnings (${economy.rpEarned}); balance was clamped to zero.`);

  const inventory = [];
  for (const id of Array.isArray(wallet.inventory) ? wallet.inventory : []) {
    if (KNOWN_ITEMS.has(id)) inventory.push(id); else if (typeof id === 'string') warnings.push(`Unknown inventory item skipped: ${id}`);
  }
  for (const [slot, kind] of Object.entries(SLOTS)) {
    const id = wallet[slot]; if (typeof id === 'string' && KNOWN_ITEMS.get(id)?.kind === kind) inventory.push(id);
  }
  const inv = uniq(inventory).slice(0, 200);
  const nw = freshWallet();
  nw.gc = Math.max(0, economy.gcEarned - gcSpent); nw.rp = Math.max(0, economy.rpEarned - rpSpent); nw.bonuses = economy.bonuses;
  nw.gcSpent = gcSpent; nw.rpSpent = rpSpent; nw.inventory = inv;
  nw.shields = int(wallet.shields, 0, 0, 2); nw.shieldDays = shieldDays;
  nw.purchases = sanitizePurchases(wallet.purchases); nw.redemptions = sanitizeRedemptions(wallet.redemptions);
  if (typeof wallet.lastScanWeek === 'string' && WEEK.test(wallet.lastScanWeek)) nw.lastScanWeek = wallet.lastScanWeek;
  if (wallet.egg && typeof wallet.egg === 'object' && !Array.isArray(wallet.egg)) {
    const passesAt = int(wallet.egg.passesAt, economy.passes, 0, 10_000_000);
    const into = typeof wallet.egg.into === 'string' && KNOWN_ITEMS.get(wallet.egg.into)?.hatch ? wallet.egg.into : null;
    nw.egg = { passesAt, hatched: wallet.egg.hatched === true, ...(cleanDate(wallet.egg.bought) ? { bought: wallet.egg.bought } : {}),
      ...(into ? { into } : {}), ...(cleanDate(wallet.egg.hatchedOn) ? { hatchedOn: wallet.egg.hatchedOn } : {}) };
  }
  for (const [slot, kind] of Object.entries(SLOTS)) {
    const id = wallet[slot]; nw[slot] = typeof id === 'string' && inv.includes(id) && KNOWN_ITEMS.get(id)?.kind === kind ? id : null;
  }

  const requestedPace = pacePercent ?? src.pacePercent;
  const pace = Number.isFinite(requestedPace) ? Math.max(10, Math.min(200, Math.round(requestedPace))) : 100;
  const p = freshProgress();
  p.engine = { level: cleanLevel(src.level), paper: cleanPaper(src.paper), bossCleared: cleanBoss(src.bossCleared) };
  const nav = src.nav && typeof src.nav === 'object' && !Array.isArray(src.nav) ? src.nav : {};
  p.nav = { level: cleanLevel(nav.level), paper: cleanPaper(nav.paper), bossCleared: cleanBoss(nav.bossCleared) };
  p.wallet = nw; p.passDays = economy.passDays; p.pacePercent = pace; p.stats = { sessions: economy.sessions, passes: economy.passes };
  p.history = oldHistory.map(migrateHistoryRow).filter(Boolean).slice(0, 60); p.activeSession = null;
  return { progress: normalizeProgress(p), report: { sourceHistoryRows: oldHistory.length, importedHistoryRows: p.history.length, reconstructed: economy,
    balances: { gc: nw.gc, rp: nw.rp, gcSpent, rpSpent }, pacePercent: pace, warnings } };
}

function mapChildNames(names, childMap) {
  const lower = new Map(Object.entries(childMap || {}).map(([name, id]) => [name.toLowerCase(), id]));
  return uniq((Array.isArray(names) ? names : []).map((n) => typeof n === 'string' ? lower.get(n.toLowerCase()) : null).filter(Boolean));
}

export function migrateV2GameConfig(settings, rocket, childMap, { makeId = randomUUID } = {}) {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const allChildIds = uniq(Object.values(childMap || {}).filter((x) => typeof x === 'string'));
  const rewards = [];
  for (const r of Array.isArray(s.rewards) ? s.rewards : []) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const id = cleanText(String(r.id ?? ''), 64), name = cleanText(r.name, 40); if (!SAFE_REWARD_ID.test(id) || !name || rewards.some((x) => x.id === id)) continue;
    const explicitlyScoped = Array.isArray(r.kids);
    const mapped = explicitlyScoped ? mapChildNames(r.kids, childMap) : allChildIds;
    // In v3 an empty childIds list means "available to every child". Never let a
    // v2 reward that was explicitly scoped to unknown names accidentally broaden to all children.
    if (explicitlyScoped && r.kids.length > 0 && mapped.length === 0) continue;
    rewards.push({ id, emoji: cleanEmoji(r.emoji), name, cost: int(r.cost, 100, 1, 100_000), hidden: r.hidden === true, cap: int(r.cap, 0, 0, 20), childIds: mapped });
  }
  const config = { rewards, rocket: null, rocketHistory: [] };
  if (rocket && typeof rocket === 'object' && !Array.isArray(rocket) && ['fueling', 'launched'].includes(rocket.status)) {
    const crewChildIds = mapChildNames(rocket.crew, childMap);
    const currency = rocket.currency === 'rp' ? 'rp' : 'gc'; const goal = int(rocket.goal, 0, 50, 1_000_000); const minEach = int(rocket.minEach, 0, 0, goal || 0);
    const prize = { emoji: cleanEmoji(rocket.prize?.emoji), name: cleanText(rocket.prize?.name, 50) };
    if (crewChildIds.length && goal >= 50 && prize.name) {
      const fuel = {}; const lower = new Map(Object.entries(childMap || {}).map(([name, id]) => [name.toLowerCase(), id]));
      for (const [name, amount] of Object.entries(rocket.fuel || {})) { const id = lower.get(name.toLowerCase()); if (id) fuel[id] = int(amount, 0, 0, 1_000_000); }
      config.rocket = { id: makeId(), status: rocket.status, prize, currency, goal, minEach, crewChildIds, fuel,
        createdAt: Number.isSafeInteger(rocket.createdAt) ? rocket.createdAt : Date.now(), ...(rocket.status === 'launched' ? { launchedAt: Number.isSafeInteger(rocket.launchedAt) ? rocket.launchedAt : Date.now(), ...(rocket.forced ? { forced: true } : {}) } : {}) };
    }
  }
  const paceByChildId = {};
  for (const [name, childId] of Object.entries(childMap || {})) {
    const rawScale = s[`${name.toLowerCase()}Scale`], mult = Number.isFinite(s?.paceMultipliers?.[name]) ? s.paceMultipliers[name] : 1;
    const scale = Number.isFinite(rawScale) ? rawScale : 100; paceByChildId[childId] = Math.max(10, Math.min(200, Math.round(scale * mult)));
  }
  return { config, timeZone: cleanTimeZone(s.timeZone), paceByChildId };
}
