// Progress and game rules for the two learning tracks. This is deliberately pure: the browser
// never supplies authoritative progress, scores, currency, time allowances or unlock state.
import { genEngine, engineSecondsFor, LEVELS } from './questions/engine.mjs';
import { genNavigator, navSecondsFor } from './questions/navigator.mjs';

export const PAPERS_PER_LEVEL = 100, PAPERS_PER_SESSION = 5;
export const Q_PER_PAPER = Object.freeze({ engine: 5, nav: 3 });
export const TRACKS = Object.freeze(['engine', 'nav']);
export const OTHER = Object.freeze({ engine: 'nav', nav: 'engine' });
export const GC_PASS = 50, RP_PASS = 100;
export const DEFAULT_PACE_PERCENT = 100;
export const tierOf = (paper) => Math.min(5, Math.ceil(paper / 20));
// Onboarding (v3.1): Sector A is Year 1 primary, B Year 2 … F Year 6. A child starts either with the
// placement test (recommended), directly at the year's sector, or from A1.
export const yearToLevel = (yearLevel) => Math.max(0, Math.min(LEVELS.length - 1, yearLevel - 1));
export const PLACEMENT = Object.freeze({ tier: 3, engineQuestions: 15, navQuestions: 10 }); // the middle of the sector, both tracks; 25 questions is about 15–25 minutes at the normal allowances
export function initialProgress({ start, yearLevel }, now) {
  const p = freshProgress();
  if (start === 'year') { const level = yearToLevel(yearLevel); p.engine = { level, paper: 1, bossCleared: 0 }; p.nav = { level, paper: 1, bossCleared: 0 }; }
  if (start === 'test') p.placement = { status: 'pending', yearLevel, level: yearToLevel(yearLevel), tier: PLACEMENT.tier, requestedAt: now };
  return p;
}
export { LEVELS };

export const EQUIP_SLOTS = Object.freeze({
  pet: 'activePet', fx: 'activeFx', snd: 'activeSnd', bg: 'activeBg', ring: 'ring',
  outfit: 'activeOutfit', shout: 'activeShout', timer: 'activeTimer', title: 'activeTitle',
  namefx: 'activeNameFx', map: 'activeMap', vehicle: 'activeVehicle', base: 'activeBase',
});

export const freshWallet = () => ({
  gc: 0, rp: 0, bonuses: 0, gcSpent: 0, rpSpent: 0, ledgerSeq: 0, ledgerLast: null, // gc/rp are the ledger's cached balance (server/ledger.mjs)
  inventory: [], activePet: null, activeFx: null, activeSnd: null, activeBg: null, ring: null,
  activeOutfit: null, activeShout: null, activeTimer: null, activeTitle: null,
  activeNameFx: null, activeMap: null, activeVehicle: null, activeBase: null,
  shields: 0, shieldDays: [], egg: null, purchases: [], redemptions: [], lastScanWeek: null,
});

export const freshProgress = () => ({
  engine: { level: 0, paper: 1, bossCleared: 0 }, nav: { level: 0, paper: 1, bossCleared: 0 },
  wallet: freshWallet(), passDays: [], pacePercent: DEFAULT_PACE_PERCENT,
  stats: { sessions: 0, passes: 0 }, history: [], activeSession: null, placement: null,
});

const uniqStrings = (xs, max = 500) => [...new Set((Array.isArray(xs) ? xs : []).filter((x) => typeof x === 'string'))].slice(-max);
export function normalizeWallet(value) {
  const base = freshWallet(), w = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = { ...base, ...w };
  for (const key of ['gc', 'rp', 'bonuses', 'gcSpent', 'rpSpent', 'shields']) {
    if (!Number.isSafeInteger(out[key]) || out[key] < 0) out[key] = 0;
  }
  out.shields = Math.min(2, out.shields);
  if (!Number.isSafeInteger(out.ledgerSeq) || out.ledgerSeq < 0) out.ledgerSeq = 0;
  if (typeof out.ledgerLast !== 'string') out.ledgerLast = null;
  out.inventory = uniqStrings(out.inventory, 200);
  out.shieldDays = uniqStrings(out.shieldDays, 400).sort();
  out.purchases = Array.isArray(out.purchases) ? out.purchases.slice(0, 120) : [];
  // every pending request survives a read; only decided rows are trimmed to the newest fifty (Stage 4 review, third round)
  out.redemptions = Array.isArray(out.redemptions) ? (() => { let decided = 0; return out.redemptions.filter((r) => r && typeof r === 'object' && (r.status === 'pending' || decided++ < 50)); })() : [];
  if (!out.egg || typeof out.egg !== 'object' || Array.isArray(out.egg)) out.egg = null;
  for (const slot of Object.values(EQUIP_SLOTS)) if (typeof out[slot] !== 'string') out[slot] = null;
  if (typeof out.lastScanWeek !== 'string') out.lastScanWeek = null;
  return out;
}
export function normalizeProgress(value) {
  const base = freshProgress(), p = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const track = (name) => {
    const x = p[name] && typeof p[name] === 'object' ? p[name] : {};
    const level = Number.isInteger(x.level) ? Math.max(0, Math.min(LEVELS.length - 1, x.level)) : 0;
    const paper = Number.isInteger(x.paper) ? Math.max(1, Math.min(PAPERS_PER_LEVEL + 1, x.paper)) : 1;
    const bossCleared = Number.isInteger(x.bossCleared) ? Math.max(0, Math.min(5, x.bossCleared)) : 0;
    return { level, paper, bossCleared };
  };
  const pacePercent = Number.isInteger(p.pacePercent) ? Math.max(10, Math.min(200, p.pacePercent)) : DEFAULT_PACE_PERCENT;
  const stats = p.stats && typeof p.stats === 'object' ? p.stats : {};
  return { ...base, ...p, engine: track('engine'), nav: track('nav'), wallet: normalizeWallet(p.wallet),
    passDays: uniqStrings(p.passDays, 400).sort(), pacePercent,
    stats: { sessions: Number.isSafeInteger(stats.sessions) && stats.sessions >= 0 ? stats.sessions : 0,
      passes: Number.isSafeInteger(stats.passes) && stats.passes >= 0 ? stats.passes : 0 },
    history: Array.isArray(p.history) ? p.history.slice(0, 60) : [], activeSession: typeof p.activeSession === 'string' ? p.activeSession : null,
    placement: p.placement && typeof p.placement === 'object' && !Array.isArray(p.placement) && ['pending', 'done'].includes(p.placement.status) ? p.placement : null };
}

export const trk = (p, t) => p[t] || { level: 0, paper: 1, bossCleared: 0 };
export const withTrk = (p, t, patch) => ({ ...p, [t]: { ...trk(p, t), ...patch } });
export const trackDone = (p, t) => { const x = trk(p, t); return x.paper > PAPERS_PER_LEVEL && x.bossCleared >= 5; };
export const bossDue = (p, t) => { const x = trk(p, t); return x.bossCleared < Math.min(5, Math.floor((x.paper - 1) / 20)); };
const jumpTrack = (p, t, level) => withTrk(p, t, { level, paper: 1, bossCleared: 0 });
export const canJump = (p, t) => {
  const me = trk(p, t), o = trk(p, OTHER[t]);
  return trackDone(p, t) && me.level < LEVELS.length - 1 && (o.level > me.level || (o.level === me.level && trackDone(p, OTHER[t])));
};
export const settleJumps = (p) => {
  let out = p; const jumped = [];
  for (let i = 0; i < 2; i++) for (const t of TRACKS) if (canJump(out, t) && !jumped.includes(t)) { out = jumpTrack(out, t, trk(out, t).level + 1); jumped.push(t); }
  return { p: out, jumped };
};
export const sectorsCleared = (p) => Math.min(trk(p, 'engine').level, trk(p, 'nav').level);

export function nextRun(p, t) {
  const x = trk(p, t);
  if (trackDone(p, t)) return { mode: 'practice', level: x.level, startPaper: 1 + 5 * Math.floor(Math.random() * (PAPERS_PER_LEVEL / PAPERS_PER_SESSION)), tierEnd: null };
  if (bossDue(p, t)) return { mode: 'boss', level: x.level, startPaper: null, tierEnd: (x.bossCleared + 1) * 20 };
  return { mode: 'paper', level: x.level, startPaper: x.paper, tierEnd: null };
}
const gen = (t, level, paper) => (t === 'nav' ? genNavigator(level, tierOf(paper)) : genEngine(level, tierOf(paper)));
const secondsFor = (t, level, paper, pace = 1) => (t === 'nav' ? navSecondsFor(level, tierOf(paper), pace) : engineSecondsFor(level, tierOf(paper), pace));
const question = (t, level, paper, pace) => {
  const q = gen(t, level, paper);
  return { paper, tier: tierOf(paper), level, track: t, seconds: Math.max(5, secondsFor(t, level, paper, pace)), display: q.display, answer: q.answer, read: q.read || null };
};
// Server-side question list. `answer` never leaves the server; `seconds` is the allowance.
export function buildQuestions(t, run, pace = 1) {
  const qs = [];
  const push = (paper) => qs.push(question(t, run.level, paper, pace));
  if (run.mode === 'boss') {
    for (let i = 0; i < PAPERS_PER_SESSION * Q_PER_PAPER[t]; i++) push(run.tierEnd - 19 + Math.floor(Math.random() * 20));
  } else {
    for (let p = run.startPaper; p < run.startPaper + PAPERS_PER_SESSION; p++) for (let i = 0; i < Q_PER_PAPER[t]; i++) push(p);
  }
  return qs;
}
// The placement test: both tracks at the middle tier (papers 41–60) of the year's sector, Engine first
// then Navigator, with the normal per-question allowances. Time counts as well as accuracy.
export function buildPlacementQuestions(level, pace = 1) {
  const qs = [], paper = () => 41 + Math.floor(Math.random() * 20);
  for (let i = 0; i < PLACEMENT.engineQuestions; i++) qs.push(question('engine', level, paper(), pace));
  for (let i = 0; i < PLACEMENT.navQuestions; i++) qs.push(question('nav', level, paper(), pace));
  return qs;
}
/**
 * Where one track starts after the test, from accuracy and the share of the allowance used
 * (Kumon-style: right AND quick means ahead). Tested at sector L, tier 3:
 *   ≥ 90 % correct, ≤ 60 % of the time  → next sector, paper 1 (F: paper 61)
 *   ≥ 90 % correct                        → L paper 41 (as tested)
 *   ≥ 70 %                                → L paper 21
 *   ≥ 50 %                                → L paper 1
 *   ≥ 30 %                                → previous sector paper 41 (A: paper 1)
 *   below                                 → previous sector paper 1 (A: paper 1)
 * bossCleared is set so no check point is due for the papers skipped.
 */
export function placeTrack({ correct, total, timeRatio }, level) {
  const acc = total ? correct / total : 0;
  let band, l = level, paper;
  if (acc >= 0.9 && timeRatio <= 0.6) { band = 'ahead'; if (level < LEVELS.length - 1) { l = level + 1; paper = 1; } else paper = 61; }
  else if (acc >= 0.9) { band = 'on-level'; paper = 41; }
  else if (acc >= 0.7) { band = 'building'; paper = 21; }
  else if (acc >= 0.5) { band = 'foundations'; paper = 1; }
  else if (acc >= 0.3) { band = 'previous'; if (level > 0) { l = level - 1; paper = 41; } else paper = 1; }
  else { band = 'previous-start'; if (level > 0) { l = level - 1; paper = 1; } else paper = 1; }
  return { band, level: l, paper, bossCleared: Math.floor((paper - 1) / 20), accuracy: Math.round(acc * 100), timeRatio: Math.round(timeRatio * 100) / 100 };
}
export function placementFromResults(results, level) {
  const out = {};
  for (const t of TRACKS) {
    const rs = results.filter((r) => r.track === t), correct = rs.filter((r) => r.r === 'correct').length;
    const used = rs.reduce((a, r) => a + (r.secs || 0), 0), allowed = rs.reduce((a, r) => a + (r.allowed || 0), 0);
    out[t] = placeTrack({ correct, total: rs.length, timeRatio: allowed ? used / allowed : 1 }, level);
    out[t].correct = correct; out[t].total = rs.length; out[t].secs = used;
  }
  return out;
}
// v2 weekly System Scan: 25 Engine questions, ten from the current sector and fifteen from
// previously learned sectors, shuffled. It unlocks from sector B after papers 1-20 are clear.
// Scan focus (email-v1, a parent's yes from the weekly email or Game & progress): 19 of the 25 come from the child's weak Engine
// styles (styles.mjs weakStyles, over all kept history), each at its own sector on a paper inside its tier's band, shared by
// misses with at least two each; the other six are the normal mix scaled down (two from the sector now, four from earlier
// ones). No weak style: the normal scan. The unlock, the 25/25 rule, the double pay and the retries do not change.
export const SCAN_FOCUS = Object.freeze({ weak: 19, minEach: 2, recapCurrent: 2, recapEarlier: 4 });
/** How many of the 19 each weak style gets: two each, the rest by misses (largest remainder, ties to the weaker). No random. */
export function focusPlan(styles) {
  const list = Array.isArray(styles) ? styles.slice(0, 4) : []; if (!list.length) return [];
  const rest = SCAN_FOCUS.weak - SCAN_FOCUS.minEach * list.length, w = list.map((s) => Math.max(0, Number(s.misses) || 0)), sum = w.reduce((a, b) => a + b, 0);
  const exact = w.map((x) => (sum ? (rest * x) / sum : rest / list.length)), whole = exact.map((x) => Math.floor(x + 1e-9)), counts = whole.map((x) => SCAN_FOCUS.minEach + x);
  let left = SCAN_FOCUS.weak - counts.reduce((a, b) => a + b, 0);
  for (const [, i] of exact.map((x, i) => [x - whole[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])) { if (left <= 0) break; counts[i]++; left--; }
  return list.map((s, i) => ({ level: s.level, tier: s.tier, count: counts[i] }));
}
export function buildScanQuestions(level, pace = 1, focus = null) {
  const qs = [], plan = focusPlan(focus);
  const push = (li, paper) => qs.push(question('engine', li, paper, pace)), anyPaper = () => 1 + Math.floor(Math.random() * PAPERS_PER_LEVEL), earlier = () => (level > 0 ? Math.floor(Math.random() * level) : 0);
  if (plan.length) {
    for (const s of plan) for (let i = 0; i < s.count; i++) push(s.level, (s.tier - 1) * 20 + 1 + Math.floor(Math.random() * 20));
    for (let i = 0; i < SCAN_FOCUS.recapCurrent; i++) push(level, anyPaper());
    for (let i = 0; i < SCAN_FOCUS.recapEarlier; i++) push(earlier(), anyPaper());
  } else {
    for (let i = 0; i < 10; i++) push(level, anyPaper());
    for (let i = 0; i < 15; i++) push(earlier(), anyPaper());
  }
  for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
  return qs;
}

// Strict grading. Reject non-canonical numeric spellings rather than coercing browser strings.
const INT = /^(?:0|-?[1-9]\d{0,6})$/;
const DEC = /^-?(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/;
const NUM = /^(?:0|[1-9]\d{0,3})$/, DEN = /^[1-9]\d{0,3}$/;
const negativeZero = (v) => /^-0(?:\.0{1,2})?$/.test(v);
export function grade(q, answer) {
  const a = q.answer;
  if (a.type === 'int') return typeof answer === 'string' && INT.test(answer) ? (Number(answer) === a.v ? 'correct' : 'incorrect') : null;
  if (a.type === 'dec') return typeof answer === 'string' && DEC.test(answer) && !negativeZero(answer)
    ? (Math.round(Number(answer) * 100) === Math.round(a.v * 100) ? 'correct' : 'incorrect') : null;
  if (a.type === 'frac') {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || Object.keys(answer).length !== 2 ||
        !Object.hasOwn(answer, 'n') || !Object.hasOwn(answer, 'd') || typeof answer.n !== 'string' || typeof answer.d !== 'string' ||
        !NUM.test(answer.n) || !DEN.test(answer.d)) return null;
    return Number(answer.n) === a.n && Number(answer.d) === a.d ? 'correct' : 'incorrect';
  }
  if (a.type === 'choice') {
    const i = typeof answer === 'string' && /^(?:0|[1-9]\d?)$/.test(answer) ? Number(answer) : null;
    if (i === null || !q.display.choices || i >= q.display.choices.length) return null;
    return i === a.v ? 'correct' : 'incorrect';
  }
  return null;
}
export function answerText(q) {
  const a = q.answer;
  if (a.type === 'frac') return `${a.n}/${a.d}`;
  if (a.type === 'choice') return q.display.choices[a.v];
  if (a.type === 'dec') return String(Math.round(a.v * 100) / 100);
  return String(a.v);
}

export function bonusesFor(passDays) {
  let bonuses = 0, run = 0, prev = null;
  for (const d of [...new Set(passDays)].sort()) {
    run = prev && Date.parse(d) - Date.parse(prev) === 86_400_000 ? run + 1 : 1;
    if (run % 3 === 0) bonuses++;
    prev = d;
  }
  return bonuses;
}
export function liveDayRun(passDays, now = Date.now()) {
  const days = [...new Set(passDays)].sort(); if (!days.length) return 0;
  let run = 1; for (let i = days.length - 1; i > 0; i--) { if (Date.parse(days[i]) - Date.parse(days[i - 1]) !== 86_400_000) break; run++; }
  const gap = Math.round((Date.parse(new Date(now).toISOString().slice(0, 10)) - Date.parse(days.at(-1))) / 86_400_000);
  return gap <= 1 ? run : 0;
}
export function dayISO(ms, timeZone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
}
export function weekISO(ms, timeZone) {
  const d = dayISO(ms, timeZone).split('-').map(Number); const t = new Date(Date.UTC(d[0], d[1] - 1, d[2]));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
}
// one unlock rule for the scan itself, the weekly report and its email (server/report.mjs): Engine Sector B, papers 1-20 clear
export const scanUnlocked = (engine) => engine.level >= 1 && engine.paper > 20;
export function scanState(prog, now, timeZone) {
  const e = trk(prog, 'engine'); const unlocked = scanUnlocked(e); const week = weekISO(now, timeZone);
  return { unlocked, available: unlocked && prog.wallet.lastScanWeek !== week, week, doneThisWeek: prog.wallet.lastScanWeek === week };
}
