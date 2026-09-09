import { randomInt, randomUUID } from 'node:crypto';
import { fail, object, text, uuid } from './security.mjs';
import { GC_PASS, RP_PASS, EQUIP_SLOTS, LEVELS, bonusesFor, dayISO, normalizeProgress, liveDayRun, scanState, trk, trackDone, bossDue } from './progress.mjs';
import { entry, post } from './ledger.mjs';

const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const OP_LIFE = DAY;
const PURCHASE_MAX = 120, REDEMPTION_MAX = 50;
export const LEGEND_SINCE = '2026-09-06', EGG_PASSES = 5;
export const ROCKET_AMOUNTS = Object.freeze({ gc: [50, 100, 250], rp: [100, 200, 500] });

// Exact functional catalog migrated from v2. The catalog is server authority: the browser can
// choose only an id, never a cost, kind, unlock condition or crate outcome.
export const SHOP_ITEMS = Object.freeze([
  { id: 'ring_pulse', kind: 'ring', emoji: '⭕', name: 'Pulse ring', cost: 300 },
  { id: 'ring_halo', kind: 'ring', emoji: '✨', name: 'Holo halo', cost: 450 },
  { id: 'ring_prestige', kind: 'ring', emoji: '💠', name: 'Prestige frame', cost: 4000, big: true },
  { id: 'bg_symbols', kind: 'bg', emoji: '🧮', name: 'Falling symbols bg', cost: 250 },
  { id: 'bg_city', kind: 'bg', emoji: '🌆', name: 'Neon city bg', cost: 350 },
  { id: 'bg_space', kind: 'bg', emoji: '🌌', name: 'Deep space bg', cost: 500 },
  { id: 'pet_drone', kind: 'pet', emoji: '🤖', name: 'Pixel drone', cost: 500 },
  { id: 'pet_cat', kind: 'pet', emoji: '🐈‍⬛', name: 'Neon cat', cost: 800 },
  { id: 'pet_dragon', kind: 'pet', emoji: '🐉', name: 'Volt dragon', cost: 1200 },
  { id: 'pet_fox', kind: 'pet', emoji: '🦊', name: 'Neon fox', cost: 0, hatch: true },
  { id: 'pet_octo', kind: 'pet', emoji: '🐙', name: 'Glitch octopus', cost: 0, hatch: true },
  { id: 'pet_unicorn', kind: 'pet', emoji: '🦄', name: 'Chrome unicorn', cost: 0, hatch: true },
  { id: 'pet_turtle', kind: 'pet', emoji: '🐢', name: 'Turbo turtle', cost: 0, hatch: true },
  { id: 'pet_legend', kind: 'pet', emoji: '🐲', name: 'Storm Dragon', cost: 0, unlock: { type: 'passRun', n: 5, text: 'pass 5 sessions in a row' } },
  { id: 'pet_semilegend', kind: 'pet', emoji: '🦅', name: 'Thunder Hawk', cost: 0, unlock: { type: 'dayRun', n: 10, text: 'practise 10 days in a row' } },
  { id: 'fit_hat', kind: 'outfit', emoji: '🎩', name: 'Top hat', cost: 150 },
  { id: 'fit_shades', kind: 'outfit', emoji: '🕶️', name: 'Cool shades', cost: 150 },
  { id: 'fit_bow', kind: 'outfit', emoji: '🎀', name: 'Big bow', cost: 150 },
  { id: 'fit_scarf', kind: 'outfit', emoji: '🧣', name: 'Racing scarf', cost: 200 },
  { id: 'fit_crown', kind: 'outfit', emoji: '👑', name: 'Tiny crown', cost: 300 },
  { id: 'fx_confetti', kind: 'fx', emoji: '🎊', name: 'Confetti bolts fx', cost: 250 },
  { id: 'fx_lightning', kind: 'fx', emoji: '🌩️', name: 'Lightning storm fx', cost: 300 },
  { id: 'fx_goldrain', kind: 'fx', emoji: '💰', name: 'Gold rain fx', cost: 300 },
  { id: 'snd_retro', kind: 'snd', emoji: '🕹️', name: 'Retro arcade sounds', cost: 200 },
  { id: 'snd_space', kind: 'snd', emoji: '🛸', name: 'Space bleeps sounds', cost: 200 },
  { id: 'shout_kapow', kind: 'shout', emoji: '💥', name: 'KAPOW pack', cost: 250 },
  { id: 'shout_turbo', kind: 'shout', emoji: '🚀', name: 'Turbo pack', cost: 250 },
  { id: 'shout_robot', kind: 'shout', emoji: '🤖', name: 'Robot pack', cost: 250 },
  { id: 'shout_dino', kind: 'shout', emoji: '🦖', name: 'Dino pack', cost: 250 },
  { id: 'tbar_bolt', kind: 'timer', emoji: '⚡', name: 'Lightning fuse', cost: 200 },
  { id: 'tbar_lava', kind: 'timer', emoji: '🌋', name: 'Lava flow', cost: 200 },
  { id: 'tbar_rainbow', kind: 'timer', emoji: '🌈', name: 'Rainbow road', cost: 200 },
  { id: 'tbar_pixel', kind: 'timer', emoji: '🟩', name: 'Pixel blocks', cost: 200 },
  { id: 'title_runner', kind: 'title', emoji: '🏷️', name: 'GRID RUNNER', cost: 100 },
  { id: 'title_ninja', kind: 'title', emoji: '🥷', name: 'MATH NINJA', cost: 150 },
  { id: 'title_speed', kind: 'title', emoji: '💨', name: 'SPEED DEMON', cost: 150 },
  { id: 'title_combo', kind: 'title', emoji: '🔥', name: 'COMBO MASTER', cost: 150 },
  { id: 'title_time', kind: 'title', emoji: '⏳', name: 'TIME LORD', cost: 150 },
  { id: 'title_dragon', kind: 'title', emoji: '🐉', name: 'DRAGON TAMER', cost: 200 },
  { id: 'nfx_rainbow', kind: 'namefx', emoji: '🌈', name: 'Rainbow name', cost: 300 },
  { id: 'nfx_glitch', kind: 'namefx', emoji: '👾', name: 'Glitch name', cost: 350 },
  { id: 'nfx_gold', kind: 'namefx', emoji: '✨', name: 'Gold shimmer name', cost: 300 },
  { id: 'map_lava', kind: 'map', emoji: '🔥', name: 'Lava route', cost: 400 },
  { id: 'map_ice', kind: 'map', emoji: '❄️', name: 'Ice route', cost: 400 },
  { id: 'map_matrix', kind: 'map', emoji: '🟢', name: 'Matrix route', cost: 400 },
  { id: 'map_gold', kind: 'map', emoji: '✨', name: 'Gold circuit', cost: 500 },
  { id: 'veh_bike', kind: 'vehicle', emoji: '🏍️', name: 'Hover bike', cost: 2200, big: true },
  { id: 'veh_rocket', kind: 'vehicle', emoji: '🚀', name: 'Star rocket', cost: 2500, big: true },
  { id: 'veh_mech', kind: 'vehicle', emoji: '🦾', name: 'Mech suit', cost: 3000, big: true },
  { id: 'base_deck', kind: 'base', emoji: '🛰️', name: 'Command Deck', cost: 3000, big: true },
  { id: 'shield', kind: 'shield', emoji: '🛡️', name: 'Streak shield', cost: 400, consumable: true },
  { id: 'crate', kind: 'crate', emoji: '🎁', name: 'Surprise Box', cost: 300, consumable: true },
  { id: 'egg', kind: 'egg', emoji: '🥚', name: 'Mystery Egg', cost: 900, consumable: true },
]);
const BY_ID = new Map(SHOP_ITEMS.map((x) => [x.id, x]));
const CRATE_KINDS = new Set(['outfit', 'shout', 'timer', 'title', 'namefx', 'map']);
const CRATE_RARE = new Set(['namefx', 'map']);
const HATCH_POOL = ['pet_fox', 'pet_octo', 'pet_unicorn', 'pet_turtle'];
const EARNED = SHOP_ITEMS.filter((x) => x.unlock);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const previousDay = (date, n = 1) => new Date(Date.parse(date) - n * DAY).toISOString().slice(0, 10);
const itemPublic = (x) => ({ id: x.id, kind: x.kind, emoji: x.emoji, name: x.name, cost: x.cost, ...(x.big ? { big: true } : {}), ...(x.hatch ? { hatch: true } : {}), ...(x.unlock ? { unlock: x.unlock } : {}) });
const item = (id) => { const x = typeof id === 'string' ? BY_ID.get(id) : null; if (!x) fail(400, 'INVALID_ITEM'); return x; };
const nowRow = (it, cost, now, timeZone, how = null) => ({ id: it.id, emoji: it.emoji, name: how ? `${it.name} (${how})` : it.name, cost, date: dayISO(now, timeZone), at: now });

function passRun(history, since) {
  let n = 0;
  for (const h of history || []) {
    if (h?.quit || h?.restart || typeof h?.total !== 'number') continue;
    if (since && h.date && h.date < since) continue;
    if (h.passed) n++; else break;
  }
  return n;
}
function liveLocalRun(days, now, timeZone) {
  const xs = [...new Set(days)].sort(); if (!xs.length) return 0;
  let run = 1; for (let i = xs.length - 1; i > 0; i--) { if (Date.parse(xs[i]) - Date.parse(xs[i - 1]) !== DAY) break; run++; }
  const gap = Math.round((Date.parse(dayISO(now, timeZone)) - Date.parse(xs.at(-1))) / DAY);
  return gap <= 1 ? run : 0;
}
export function unlockProgress(it, progress, now, timeZone) {
  if (!it.unlock) return null;
  const allDays = [...(progress.passDays || []), ...(progress.wallet.shieldDays || [])];
  const have = it.unlock.type === 'passRun' ? passRun(progress.history, LEGEND_SINCE)
    : it.unlock.type === 'dayRun' ? liveLocalRun(allDays, now, timeZone) : 0;
  return { have: Math.min(have, it.unlock.n), need: it.unlock.n, done: have >= it.unlock.n };
}

// Applies v2-derived automatic game events from trusted progress: a streak shield may bridge one
// missed yesterday, earned pets unlock, and a warmed egg hatches after five successful sessions.
// It is pure except for the injected random picker, so Learning can commit it atomically with a pass.
export function applyGameDerived(value, now, timeZone, pickIndex = (n) => randomInt(n)) {
  let p = normalizeProgress(value), w = { ...p.wallet, inventory: [...p.wallet.inventory], shieldDays: [...p.wallet.shieldDays], purchases: [...p.wallet.purchases] };
  const events = []; const today = dayISO(now, timeZone), yesterday = previousDay(today), dayBefore = previousDay(today, 2);
  const continuity = new Set([...(p.passDays || []), ...w.shieldDays]);
  if (w.shields > 0 && !continuity.has(yesterday) && continuity.has(dayBefore)) {
    w.shields--; w.shieldDays = [...new Set([...w.shieldDays, yesterday])].sort().slice(-400);
    const totalBonuses = bonusesFor([...(p.passDays || []), ...w.shieldDays]);
    const newBonuses = Math.max(0, totalBonuses - (w.bonuses || 0));
    if (newBonuses) { w.bonuses = totalBonuses; w.gc += newBonuses * GC_PASS; w.rp += newBonuses * RP_PASS; }
    events.push({ type: 'shield', date: yesterday, bonusBlocks: newBonuses });
  }
  p = { ...p, wallet: w };
  for (const it of EARNED) {
    if (w.inventory.includes(it.id)) continue;
    const u = unlockProgress(it, p, now, timeZone);
    if (u?.done) {
      w.inventory.push(it.id); w.activePet = it.id; w.purchases.unshift(nowRow(it, 0, now, timeZone, 'earned'));
      events.push({ type: 'earned', item: itemPublic(it) });
    }
  }
  if (w.egg && !w.egg.hatched && (p.stats?.passes || 0) - (w.egg.passesAt || 0) >= EGG_PASSES) {
    const pool = HATCH_POOL.filter((id) => !w.inventory.includes(id));
    if (pool.length) {
      const id = pool[pickIndex(pool.length)], got = BY_ID.get(id);
      w.inventory.push(id); w.activePet = id; w.egg = { ...w.egg, hatched: true, into: id, hatchedOn: today };
      w.purchases.unshift(nowRow(got, 0, now, timeZone, 'hatched'));
      events.push({ type: 'hatched', item: itemPublic(got) });
    }
  }
  w.inventory = [...new Set(w.inventory)]; w.purchases = w.purchases.slice(0, PURCHASE_MAX);
  return { progress: { ...p, wallet: w }, events };
}

export function heatmap(progress) {
  const cells = {};
  for (const h of progress.history || []) for (const q of h.qlog || []) {
    const track = q.track || h.track || 'engine', level = Number.isInteger(q.l) ? q.l : h.level, tier = q.t;
    if (!['engine', 'nav'].includes(track) || !Number.isInteger(level) || !Number.isInteger(tier)) continue;
    const key = `${track}:${level}:${tier}`, c = cells[key] || { track, level, levelId: LEVELS[level]?.id || '?', tier, attempts: 0, correct: 0, secs: 0, allowed: 0 };
    c.attempts++; c.correct += q.ok ? 1 : 0; if (Number.isFinite(q.s)) c.secs += q.s; if (Number.isFinite(q.a)) c.allowed += q.a; cells[key] = c;
  }
  return Object.values(cells).map((c) => ({ ...c, accuracy: c.attempts ? Math.round(c.correct * 1000 / c.attempts) / 10 : 0,
    avgSeconds: c.attempts ? Math.round(c.secs * 10 / c.attempts) / 10 : null, pace: c.allowed ? Math.round(c.secs * 100 / c.allowed) / 100 : null }));
}

const rewardPublic = (r) => ({ id: r.id, emoji: r.emoji, name: r.name, cost: r.cost, hidden: r.hidden, cap: r.cap, childIds: r.childIds });
const rewardChildPublic = (r) => ({ id: r.id, emoji: r.emoji, name: r.name, cost: r.cost, hidden: r.hidden, cap: r.cap });
function validateRewards(value, childIds) {
  if (!Array.isArray(value) || value.length > 30) fail(400, 'INVALID_REWARDS');
  const seen = new Set();
  return value.map((v) => {
    if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).some((k) => !['id', 'emoji', 'name', 'cost', 'hidden', 'cap', 'childIds'].includes(k))) fail(400, 'INVALID_REWARDS');
    const id = text(v.id, 1, 64); if (!SAFE_ID.test(id) || seen.has(id)) fail(400, 'INVALID_REWARDS'); seen.add(id);
    const emoji = text(v.emoji, 1, 12).normalize('NFC'), name = text(v.name, 1, 40).normalize('NFC').trim();
    if (!name || !Number.isSafeInteger(v.cost) || v.cost < 1 || v.cost > 100_000 || typeof v.hidden !== 'boolean' || !Number.isInteger(v.cap) || v.cap < 0 || v.cap > 20 || !Array.isArray(v.childIds)) fail(400, 'INVALID_REWARDS');
    const kids = [...new Set(v.childIds)]; if (kids.some((id) => !childIds.includes(id))) fail(400, 'INVALID_REWARDS');
    return { id, emoji, name, cost: v.cost, hidden: v.hidden, cap: v.cap, childIds: kids };
  });
}
const defaultConfig = () => ({ rewards: [], rocket: null, rocketHistory: [] });
const normalizeConfig = (v) => ({ ...defaultConfig(), ...(v && typeof v === 'object' ? v : {}), rewards: Array.isArray(v?.rewards) ? v.rewards : [], rocketHistory: Array.isArray(v?.rocketHistory) ? v.rocketHistory.slice(-20) : [] });
const rocketFuel = (r) => Object.values(r?.fuel || {}).reduce((a, b) => a + (Number.isSafeInteger(b) ? b : 0), 0);
const rocketReady = (r) => r?.status === 'fueling' && rocketFuel(r) >= r.goal && (!r.minEach || r.crewChildIds.every((id) => (r.fuel[id] || 0) >= r.minEach));
const publicRocket = (r) => !r ? null : ({ id: r.id, status: r.status, prize: r.prize, currency: r.currency, goal: r.goal, minEach: r.minEach,
  crewChildIds: r.crewChildIds, fuel: r.fuel, totalFuel: rocketFuel(r), createdAt: r.createdAt, launchedAt: r.launchedAt || null });
const childRocket = (r, childId) => !r ? null : ({ id: r.id, status: r.status, prize: r.prize, currency: r.currency, goal: r.goal, minEach: r.minEach,
  totalFuel: rocketFuel(r), myFuel: r.fuel?.[childId] || 0, isCrew: r.crewChildIds?.includes(childId) || false, createdAt: r.createdAt, launchedAt: r.launchedAt || null });

export class Game {
  constructor({ foundation, store, now = Date.now, pickIndex = (n) => randomInt(n) }) { this.foundation = foundation; this.store = store; this.now = now; this.pickIndex = pickIndex; }
  paths(s) { const base = `families/${s.familyId}/learning/${s.childId}`; return { doc: base, op: (id) => `${base}/operations/${id}`, ledger: (id) => `${base}/ledger/${id}`, config: `families/${s.familyId}/game/config` }; }
  async child(tx, ctx) {
    const a = await this.foundation.authorize(tx, ctx, ['child']); const p = this.paths(a.s);
    return { ...a, p, prog: normalizeProgress((await tx.get(p.doc)) || null), cfg: normalizeConfig(await tx.get(p.config)) };
  }
  async parent(tx, ctx, recent = false) {
    const a = await this.foundation.authorize(tx, ctx, ['parent']); if (recent) this.foundation.requireRecent(a.s);
    const configPath = `families/${a.s.familyId}/game/config`, cfg = normalizeConfig(await tx.get(configPath));
    return { ...a, configPath, cfg };
  }
  publicWallet(w) { return { ...w, inventory: [...w.inventory], purchases: w.purchases.slice(0, 20), redemptions: w.redemptions.slice(0, 20) }; }
  catalogFor(prog, timeZone) { return SHOP_ITEMS.map((it) => ({ ...itemPublic(it), owned: prog.wallet.inventory.includes(it.id), unlockProgress: unlockProgress(it, prog, this.now(), timeZone) })); }
  async state(ctx) {
    return this.store.transaction(async (tx) => {
      const { prog, cfg, family, s } = await this.child(tx, ctx);
      const rewards = cfg.rewards.filter((r) => !r.childIds?.length || r.childIds.includes(s.childId)).filter((r) => !r.hidden || prog.wallet.rp >= r.cost).map(rewardChildPublic);
      const timeZone = family.timeZone || 'Asia/Singapore';
      return { wallet: this.publicWallet(prog.wallet), catalog: this.catalogFor(prog, timeZone), rewards, rocket: childRocket(cfg.rocket, s.childId), heatmap: heatmap(prog), pacePercent: prog.pacePercent,
        scan: scanState(prog, this.now(), timeZone) };
    }, { readOnly: true });
  }
  async operation(tx, p, operationId, action, fingerprint) {
    uuid(operationId); const path = p.op(operationId), old = await tx.get(path);
    if (old) { if (old.action !== action || old.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT'); return { old, path }; }
    return { old: null, path };
  }
  async buy(ctx, body) {
    object(body, ['itemId', 'operationId']); const it = item(body.itemId), operationId = uuid(body.operationId);
    if (it.hatch || it.unlock || it.cost < 1) fail(400, 'ITEM_NOT_FOR_SALE');
    return this.store.transaction(async (tx) => {
      const { p, prog, family, s } = await this.child(tx, ctx); const op = await this.operation(tx, p, operationId, 'buy', it.id);
      if (op.old) return op.old.response;
      let w = { ...prog.wallet, inventory: [...prog.wallet.inventory], purchases: [...prog.wallet.purchases] };
      if (w.gc < it.cost) fail(409, 'INSUFFICIENT_GRID_COINS');
      let awarded = null;
      if (it.kind === 'shield') { if (w.shields >= 2) fail(409, 'SHIELD_LIMIT'); w.shields++; }
      else if (it.kind === 'crate') {
        const pool = SHOP_ITEMS.filter((x) => CRATE_KINDS.has(x.kind) && !w.inventory.includes(x.id) && !x.unlock && !x.hatch);
        if (!pool.length) fail(409, 'CRATE_EMPTY');
        const weighted = pool.flatMap((x) => Array(CRATE_RARE.has(x.kind) ? 1 : 3).fill(x)); awarded = weighted[this.pickIndex(weighted.length)];
        w.inventory.push(awarded.id); w[EQUIP_SLOTS[awarded.kind]] = awarded.id;
      } else if (it.kind === 'egg') {
        if (w.egg && !w.egg.hatched) fail(409, 'EGG_ALREADY_WARMING');
        if (!HATCH_POOL.some((id) => !w.inventory.includes(id))) fail(409, 'EGG_COLLECTION_COMPLETE');
        w.egg = { passesAt: prog.stats.passes, hatched: false, bought: dayISO(this.now(), family.timeZone || 'Asia/Singapore') };
      } else {
        if (w.inventory.includes(it.id)) fail(409, 'ITEM_ALREADY_OWNED'); w.inventory.push(it.id); w[EQUIP_SLOTS[it.kind]] = it.id;
      }
      w.gcSpent += it.cost; w.inventory = [...new Set(w.inventory)];
      w.purchases.unshift(nowRow(it.kind === 'crate' && awarded ? { ...it, name: `${it.name} -> ${awarded.emoji} ${awarded.name}` } : it, it.cost, this.now(), family.timeZone || 'Asia/Singapore'));
      w.purchases = w.purchases.slice(0, PURCHASE_MAX);
      // The price leaves the wallet only through the ledger (server/ledger.mjs).
      const next = await post(tx, p.doc, { ...prog, wallet: w }, entry({ id: operationId, type: 'shop.buy', gc: -it.cost, ref: it.id, note: awarded ? awarded.id : null, at: this.now() }));
      const response = { wallet: this.publicWallet(next.wallet), item: itemPublic(it), awarded: awarded ? itemPublic(awarded) : null };
      tx.set(p.doc, next);
      tx.set(op.path, { action: 'buy', fingerprint: it.id, response, at: this.now(), expireAt: this.now() + OP_LIFE });
      this.foundation.audit(tx, 'game.shop_buy', s.uid, s.familyId, s.childId); return response;
    });
  }
  async equip(ctx, body) {
    object(body, ['kind', 'itemId']); if (!Object.hasOwn(EQUIP_SLOTS, body.kind)) fail(400, 'INVALID_ITEM');
    if (body.itemId !== null && typeof body.itemId !== 'string') fail(400, 'INVALID_ITEM');
    return this.store.transaction(async (tx) => {
      const { p, prog, s } = await this.child(tx, ctx); const w = { ...prog.wallet };
      if (body.itemId !== null) { const it = item(body.itemId); if (it.kind !== body.kind || !w.inventory.includes(it.id)) fail(403, 'ITEM_NOT_OWNED'); }
      w[EQUIP_SLOTS[body.kind]] = body.itemId; tx.set(p.doc, { ...prog, wallet: w }); this.foundation.audit(tx, 'game.equip', s.uid, s.familyId, s.childId);
      return { wallet: this.publicWallet(w) };
    });
  }
  async redeem(ctx, body) {
    object(body, ['rewardId', 'operationId']); const rewardId = text(body.rewardId, 1, 64), operationId = uuid(body.operationId);
    return this.store.transaction(async (tx) => {
      const { p, prog, cfg, family, s } = await this.child(tx, ctx); const op = await this.operation(tx, p, operationId, 'redeem', rewardId); if (op.old) return op.old.response;
      const reward = cfg.rewards.find((r) => r.id === rewardId); if (!reward || (reward.childIds?.length && !reward.childIds.includes(s.childId))) fail(404, 'REWARD_NOT_FOUND');
      const date = dayISO(this.now(), family.timeZone || 'Asia/Singapore'); const w = { ...prog.wallet, redemptions: [...prog.wallet.redemptions] };
      const used = w.redemptions.filter((r) => r.rewardId === reward.id && r.date === date && r.status !== 'rejected').length;
      if (reward.cap > 0 && used >= reward.cap) fail(409, 'REWARD_DAILY_LIMIT'); if (w.rp < reward.cost) fail(409, 'INSUFFICIENT_REWARD_POINTS');
      const redemption = { id: randomUUID(), rewardId: reward.id, emoji: reward.emoji, name: reward.name, cost: reward.cost, date, status: 'pending', requestedAt: this.now() };
      w.rpSpent += reward.cost; w.redemptions = [redemption, ...w.redemptions].slice(0, REDEMPTION_MAX);
      const next = await post(tx, p.doc, { ...prog, wallet: w }, entry({ id: operationId, type: 'reward.request', rp: -reward.cost, ref: redemption.id, note: rewardId, at: this.now() }));
      const response = { redemption, wallet: this.publicWallet(next.wallet) };
      tx.set(p.doc, next);
      tx.set(op.path, { action: 'redeem', fingerprint: rewardId, response, at: this.now(), expireAt: this.now() + OP_LIFE }); this.foundation.audit(tx, 'game.reward_requested', s.uid, s.familyId, s.childId); return response;
    });
  }
  async fuel(ctx, body) {
    object(body, ['rocketId', 'amount', 'operationId']); const rocketId = uuid(body.rocketId), operationId = uuid(body.operationId);
    if (!Number.isSafeInteger(body.amount) || body.amount <= 0) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const { p, prog, cfg, s, family } = await this.child(tx, ctx); const op = await this.operation(tx, p, operationId, 'rocket.fuel', `${rocketId}:${body.amount}`); if (op.old) return op.old.response;
      const r = cfg.rocket; if (!r || r.id !== rocketId || r.status !== 'fueling') fail(409, 'ROCKET_NOT_FUELING');
      if (!r.crewChildIds.includes(s.childId) || !ROCKET_AMOUNTS[r.currency]?.includes(body.amount)) fail(403, 'ROCKET_FUEL_DENIED');
      const w = { ...prog.wallet, purchases: [...prog.wallet.purchases], redemptions: [...prog.wallet.redemptions] };
      if (w[r.currency] < body.amount) fail(409, r.currency === 'rp' ? 'INSUFFICIENT_REWARD_POINTS' : 'INSUFFICIENT_GRID_COINS');
      if (r.currency === 'gc') w.gcSpent += body.amount; else w.rpSpent += body.amount;
      const label = { id: 'rocket', emoji: '🚀', name: `Rocket fuel - ${r.prize.name}` };
      const timeZone = family.timeZone || 'Asia/Singapore';
      if (r.currency === 'gc') w.purchases = [nowRow(label, body.amount, this.now(), timeZone), ...w.purchases].slice(0, PURCHASE_MAX);
      else w.redemptions = [{ id: randomUUID(), rewardId: 'rocket', emoji: '🚀', name: label.name, cost: body.amount, date: dayISO(this.now(), timeZone), status: 'approved', requestedAt: this.now(), decidedAt: this.now() }, ...w.redemptions].slice(0, REDEMPTION_MAX);
      const nextRocket = { ...r, fuel: { ...r.fuel, [s.childId]: (r.fuel[s.childId] || 0) + body.amount }, lastFuel: { childId: s.childId, amount: body.amount, at: this.now() } };
      if (rocketReady(nextRocket)) { nextRocket.status = 'launched'; nextRocket.launchedAt = this.now(); }
      const nextCfg = { ...cfg, rocket: nextRocket };
      const next = await post(tx, p.doc, { ...prog, wallet: w }, entry({ id: operationId, type: 'rocket.fuel', [r.currency]: -body.amount, ref: rocketId, at: this.now() }));
      const response = { rocket: childRocket(nextRocket, s.childId), wallet: this.publicWallet(next.wallet) };
      tx.set(p.doc, next); tx.set(p.config, nextCfg);
      tx.set(op.path, { action: 'rocket.fuel', fingerprint: `${rocketId}:${body.amount}`, response, at: this.now(), expireAt: this.now() + OP_LIFE }); this.foundation.audit(tx, 'game.rocket_fuel', s.uid, s.familyId, s.childId); return response;
    });
  }
  async parentState(ctx) {
    return this.store.transaction(async (tx) => {
      const { s, family, cfg } = await this.parent(tx, ctx, false); const children = [];
      for (const id of family.childIds || []) { const child = await tx.get(`families/${s.familyId}/children/${id}`); const prog = normalizeProgress(await tx.get(`families/${s.familyId}/learning/${id}`));
        if (child) children.push({ child: { id, nickname: child.nickname, icon: child.icon, status: child.status }, pacePercent: prog.pacePercent,
          engine: { ...trk(prog, 'engine'), levelId: LEVELS[trk(prog, 'engine').level].id, done: trackDone(prog, 'engine'), bossDue: bossDue(prog, 'engine') },
          nav: { ...trk(prog, 'nav'), levelId: LEVELS[trk(prog, 'nav').level].id, done: trackDone(prog, 'nav'), bossDue: bossDue(prog, 'nav') }, wallet: this.publicWallet(prog.wallet), stats: prog.stats, history: prog.history.slice(0, 12), heatmap: heatmap(prog) }); }
      return { timeZone: family.timeZone || 'Asia/Singapore', rewards: cfg.rewards.map(rewardPublic), rocket: publicRocket(cfg.rocket), rocketHistory: cfg.rocketHistory, children };
    }, { readOnly: true });
  }
  async setRewards(ctx, body) {
    object(body, ['rewards']); return this.store.transaction(async (tx) => { const { s, family, cfg, configPath } = await this.parent(tx, ctx, true);
      const rewards = validateRewards(body.rewards, family.childIds || []); tx.set(configPath, { ...cfg, rewards, updatedAt: this.now() }); this.foundation.audit(tx, 'game.rewards_configured', s.uid, s.familyId); return { rewards: rewards.map(rewardPublic) }; });
  }
  async decideRedemption(ctx, body) {
    object(body, ['childId', 'redemptionId', 'decision']); uuid(body.childId); uuid(body.redemptionId); if (!['approve', 'reject'].includes(body.decision)) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => { const { s, family } = await this.parent(tx, ctx, true); if (!family.childIds.includes(body.childId)) fail(404, 'CHILD_NOT_FOUND');
      const path = `families/${s.familyId}/learning/${body.childId}`, prog = normalizeProgress(await tx.get(path)); const w = { ...prog.wallet, redemptions: [...prog.wallet.redemptions] };
      const i = w.redemptions.findIndex((r) => r.id === body.redemptionId); if (i < 0) fail(404, 'REDEMPTION_NOT_FOUND'); const red = w.redemptions[i]; if (red.status !== 'pending') fail(409, 'REDEMPTION_ALREADY_DECIDED');
      let next = { ...prog, wallet: w };
      if (body.decision === 'approve') w.redemptions[i] = { ...red, status: 'approved', decidedAt: this.now() };
      else {
        w.rpSpent = Math.max(0, w.rpSpent - red.cost); w.redemptions[i] = { ...red, status: 'rejected', decidedAt: this.now() };
        next = await post(tx, path, next, entry({ id: `${red.id}-refund`, type: 'reward.refund', rp: red.cost, ref: red.id, at: this.now() })); // the held points come back through the ledger
      }
      tx.set(path, next); this.foundation.audit(tx, `game.reward_${body.decision}d`, s.uid, s.familyId, body.childId); return { redemption: w.redemptions[i] }; });
  }
  async rocket(ctx, body) {
    object(body, ['action', 'rocketId', 'prize', 'currency', 'goal', 'minEach', 'crewChildIds']);
    if (!['build', 'launch', 'scrap', 'claim'].includes(body.action)) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => { const { s, family, cfg, configPath } = await this.parent(tx, ctx, true); let r = cfg.rocket, history = [...cfg.rocketHistory];
      if (body.action === 'build') {
        if (r && r.status === 'fueling') fail(409, 'ROCKET_ALREADY_FUELING'); if (!body.prize || typeof body.prize !== 'object' || Array.isArray(body.prize) || Object.keys(body.prize).some((k) => !['emoji', 'name'].includes(k))) fail(400, 'INVALID_REQUEST');
        const prize = { emoji: text(body.prize.emoji, 1, 12).normalize('NFC'), name: text(body.prize.name, 1, 50).normalize('NFC').trim() };
        if (!prize.name || !['gc', 'rp'].includes(body.currency) || !Number.isSafeInteger(body.goal) || body.goal < 50 || body.goal > 1_000_000 || !Number.isSafeInteger(body.minEach) || body.minEach < 0 || body.minEach > body.goal || !Array.isArray(body.crewChildIds)) fail(400, 'INVALID_REQUEST');
        const crew = [...new Set(body.crewChildIds)]; if (!crew.length || crew.some((id) => !family.activeChildIds.includes(id))) fail(400, 'INVALID_REQUEST');
        r = { id: randomUUID(), status: 'fueling', prize, currency: body.currency, goal: body.goal, minEach: body.minEach, crewChildIds: crew, fuel: {}, createdAt: this.now() };
      } else {
        uuid(body.rocketId); if (!r || r.id !== body.rocketId) fail(404, 'ROCKET_NOT_FOUND');
        if (body.action === 'launch') { if (r.status !== 'fueling') fail(409, 'ROCKET_NOT_FUELING'); r = { ...r, status: 'launched', launchedAt: this.now(), forced: true }; }
        if (body.action === 'scrap') { if (r.status !== 'fueling') fail(409, 'ROCKET_NOT_FUELING'); history = [...history, { ...r, status: 'scrapped', closedAt: this.now() }].slice(-20); r = null; }
        if (body.action === 'claim') { if (r.status !== 'launched') fail(409, 'ROCKET_NOT_LAUNCHED'); history = [...history, { ...r, status: 'claimed', claimedAt: this.now() }].slice(-20); r = null; }
      }
      tx.set(configPath, { ...cfg, rocket: r, rocketHistory: history, updatedAt: this.now() }); this.foundation.audit(tx, `game.rocket_${body.action}`, s.uid, s.familyId); return { rocket: publicRocket(r), rocketHistory: history };
    });
  }
  async adjust(ctx, body) {
    object(body, ['childId', 'currency', 'amount', 'reason', 'operationId']); uuid(body.childId); uuid(body.operationId); if (!['gc', 'rp'].includes(body.currency) || !Number.isSafeInteger(body.amount) || body.amount === 0 || Math.abs(body.amount) > 10_000) fail(400, 'INVALID_REQUEST');
    const reason = text(body.reason, 3, 120).normalize('NFC').trim();
    return this.store.transaction(async (tx) => { const { s, family } = await this.parent(tx, ctx, true); if (!family.childIds.includes(body.childId)) fail(404, 'CHILD_NOT_FOUND');
      const base = `families/${s.familyId}/learning/${body.childId}`, opPath = `${base}/operations/${body.operationId}`, old = await tx.get(opPath); const fp = `${body.currency}:${body.amount}:${reason}`;
      if (old) { if (old.action !== 'adjust' || old.fingerprint !== fp) fail(409, 'IDEMPOTENCY_CONFLICT'); return old.response; }
      const prog = normalizeProgress(await tx.get(base)); if (prog.wallet[body.currency] + body.amount < 0) fail(409, 'INSUFFICIENT_BALANCE');
      const next = await post(tx, base, prog, entry({ id: body.operationId, type: 'parent.adjust', [body.currency]: body.amount, note: reason, at: this.now() }));
      const response = { wallet: this.publicWallet(next.wallet) }; tx.set(base, next);
      tx.set(opPath, { action: 'adjust', fingerprint: fp, response, at: this.now(), expireAt: this.now() + OP_LIFE }); this.foundation.audit(tx, 'game.parent_adjust', s.uid, s.familyId, body.childId); return response; });
  }
  async settings(ctx, body) {
    object(body, ['timeZone', 'childId', 'pacePercent']);
    return this.store.transaction(async (tx) => { const { s, family } = await this.parent(tx, ctx, true); let nextFamily = family, childPath = null, prog = null;
      if (body.timeZone !== undefined && body.timeZone !== null) { const tz = text(body.timeZone, 1, 64); try { new Intl.DateTimeFormat('en', { timeZone: tz }).format(new Date()); } catch { fail(400, 'INVALID_TIME_ZONE'); } nextFamily = { ...family, timeZone: tz }; }
      if (body.childId !== undefined && body.childId !== null) { uuid(body.childId); if (!family.childIds.includes(body.childId) || !Number.isInteger(body.pacePercent) || body.pacePercent < 10 || body.pacePercent > 200) fail(400, 'INVALID_PACE'); childPath = `families/${s.familyId}/learning/${body.childId}`; prog = normalizeProgress(await tx.get(childPath)); }
      if (nextFamily !== family) tx.set(`families/${s.familyId}`, nextFamily); if (childPath) tx.set(childPath, { ...prog, pacePercent: body.pacePercent }); this.foundation.audit(tx, 'game.settings', s.uid, s.familyId, body.childId || null);
      return { timeZone: nextFamily.timeZone, childId: body.childId || null, pacePercent: body.childId ? body.pacePercent : null }; });
  }
}
