// Stage 4.8 — the operator dashboard's arithmetic (owner's request, 12 Sep 2026).
//
// "where can i (developer) access dashboard?" is answered by an operator COMMAND — scripts/dashboard.mjs
// writes a private HTML file — not by a browser route: this release has no operator login and the standing
// rule is that no browser route is a generic admin surface (SUPPORT.md, PRIVACY.md).
//
// Everything in this module is pure except `collectSnapshot`, which only reads, and only through the store
// the caller injects (the same contract server/firebase.mjs and the in-memory test double implement). The
// arithmetic is therefore testable without a project, and the CLI and the HTML renderer are thin on top.
//
// Three privacy rules hold everywhere below, so a report cannot become a list of families:
//   1. nothing identifying is ever computed: no nickname, no family/child/parent id, no address, no child
//      free text. The snapshot deliberately does not even read nicknames;
//   2. every number is built through `cellFactory(minCell)`: a value computed from fewer than minCell
//      families is not in the report at all (`{ value: null, suppressed: true }`), so neither the HTML nor
//      the JSON carries it. The one exemption is the size of the cohort itself (`scope.families`,
//      `scope.tombstones`): that is the report's scope, not a statistic about a subgroup, and the header
//      has to state it for a reader to understand the dashes;
//   3. parent-entered reward names appear only in aggregate (section 3) and in the de-duplicated appendix,
//      never beside anything else on the line.
import { dayISO, normalizeProgress, LEVELS } from './progress.mjs';
import { GRACE_DAYS } from './subscription.mjs';
import { SHOP_ITEMS } from './game.mjs';

const DAY = 86_400_000;
export const MIN_CELL = 5;            // --min-cell: the smallest number of families any printed number may come from
export const DEFAULT_DAYS = 90;       // --days: how far back the daily-active series reaches
export const CALENDAR_BACK = 3, CALENDAR_FORWARD = 6; // the subscription calendar: the last 3 months and the next 6
export const AUDIT_RETENTION_MS = 400 * DAY; // the TTL every audit row carries (server/support.mjs)

// ---------------------------------------------------------------- small pure helpers
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
export function mean(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
export const round = (value, places = 2) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);
/**
 * The suppression rule, in one place: a number computed from fewer than `minCell` families is not
 * returned. `n` is always a count of FAMILIES, never of sessions or children — a cell that carries a
 * session count as well keeps it beside the value and loses it with the value.
 */
export function cellFactory(minCell) {
  const floor = Number.isInteger(minCell) && minCell > 0 ? minCell : MIN_CELL;
  return (value, families, extra = null) => (families >= floor && value !== null && value !== undefined
    ? { value, n: families, suppressed: false, ...(extra || {}) }
    : { value: null, n: null, suppressed: true });
}
export const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);
export function monthShift(key, n) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
export function monthRange(from, to) {
  const out = [];
  for (let k = from; k <= to; k = monthShift(k, 1)) { out.push(k); if (out.length > 600) break; }
  return out;
}
export const dayShift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export function dayRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = dayShift(d, 1)) { out.push(d); if (out.length > 4000) break; }
  return out;
}
/** Count → cells, in a stable key order. `basis` says which families contributed each key. */
function tally() {
  const counts = new Map(), families = new Map();
  return {
    add(key, familyId, amount = 1) {
      counts.set(key, (counts.get(key) || 0) + amount);
      if (!families.has(key)) families.set(key, new Set());
      families.get(key).add(familyId);
    },
    keys() { return [...counts.keys()]; },
    count(key) { return counts.get(key) || 0; },
    families(key) { return families.get(key)?.size || 0; },
  };
}

// ---------------------------------------------------------------- what a history row says about activity
/**
 * How many questions a recorded session answered. A finished row carries its per-question log (and the
 * correct/incorrect/timeout counts); a row the child left carries how far they got. A v2-imported row with
 * no timestamp says nothing about *when*, so it counts for nothing here.
 */
export function answeredIn(row) {
  if (!row || !Number.isFinite(row.ts)) return 0;
  if (Array.isArray(row.qlog) && row.qlog.length) return row.qlog.length;
  const graded = (row.correct || 0) + (row.incorrect || 0) + (row.timeout || 0);
  if (graded > 0) return graded;
  return Number.isInteger(row.atQ) && row.atQ > 0 ? row.atQ : 0;
}
/** Every answered-question event of a family, with the local day of the family's own time zone. */
export function activityOf(family) {
  const zone = family.timeZone || 'UTC', out = [];
  for (const { childId, history } of family.progress || []) {
    for (const row of history || []) {
      const answered = answeredIn(row);
      if (!answered) continue;
      out.push({ childId, ts: row.ts, answered, day: dayISO(row.ts, zone) });
    }
  }
  return out;
}
const lastActivity = (family) => activityOf(family).reduce((a, e) => Math.max(a, e.ts), 0);

// ---------------------------------------------------------------- section 1 — households
export function households(snapshot, cell) {
  const { now, days, families } = snapshot;
  const live = families.filter((f) => !f.deleted);
  const total = live.length;
  // created per month, from the earliest family to this month
  const created = tally();
  for (const f of live) if (Number.isFinite(f.createdAt)) created.add(monthKey(f.createdAt), f.id);
  const firstMonth = created.keys().sort()[0] || monthKey(now);
  const createdPerMonth = monthRange(firstMonth, monthKey(now)).map((month) => ({ month, families: cell(created.count(month), created.families(month)) }));

  // active / quiet: an answered question inside the window
  const seen = new Map(live.map((f) => [f.id, lastActivity(f)]));
  const within = (ms) => live.filter((f) => seen.get(f.id) > 0 && seen.get(f.id) >= now - ms).length;
  const without = (ms) => live.filter((f) => !(seen.get(f.id) > 0 && seen.get(f.id) >= now - ms)).length;

  // region: the IANA zone the parent's family carries — the app stores no city and no location
  const zones = tally(), areas = tally(), countries = tally();
  for (const f of live) {
    const zone = f.timeZone || 'not set';
    zones.add(zone, f.id);
    areas.add(zone.includes('/') ? zone.split('/')[0] : zone, f.id);
    countries.add(f.billingCountry || 'unknown', f.id);
  }
  // children, ages, year levels, starting option
  const perHousehold = tally(), ages = tally(), years = tally(), starts = tally();
  let children = 0;
  for (const f of live) {
    const kids = f.children || [];
    children += kids.length;
    perHousehold.add(String(kids.length), f.id);
    for (const c of kids) {
      ages.add(Number.isInteger(c.age) ? String(c.age) : 'not given', f.id);
      years.add(Number.isInteger(c.yearLevel) ? String(c.yearLevel) : 'not given', f.id);
      starts.add(c.start || 'not recorded', f.id);
    }
  }
  const histogram = (t, order = (a, b) => Number(a) - Number(b)) => t.keys()
    .sort((a, b) => (a === 'not given' || a === 'not recorded' ? 1 : b === 'not given' || b === 'not recorded' ? -1 : order(a, b)))
    .map((key) => ({ key, children: cell(t.count(key), t.families(key)) }));

  return {
    total: cell(total, total), children: cell(children, live.filter((f) => (f.children || []).length).length),
    createdPerMonth,
    active: { d7: cell(within(7 * DAY), within(7 * DAY)), d30: cell(within(30 * DAY), within(30 * DAY)) },
    quiet: { d30: cell(without(30 * DAY), without(30 * DAY)), d60: cell(without(60 * DAY), without(60 * DAY)) },
    areas: areas.keys().sort().map((key) => ({ key, families: cell(areas.count(key), areas.families(key)) })),
    zones: zones.keys().sort().map((key) => ({ key, families: cell(zones.count(key), zones.families(key)) })),
    billingCountries: countries.keys().sort().map((key) => ({ key, families: cell(countries.count(key), countries.families(key)) })),
    childrenPerHousehold: perHousehold.keys().sort((a, b) => Number(a) - Number(b)).map((key) => ({ key, families: cell(perHousehold.count(key), perHousehold.families(key)) })),
    childAges: histogram(ages), yearLevels: histogram(years),
    startOptions: histogram(starts, (a, b) => a.localeCompare(b)),
    subscriptionCalendar: subscriptionCalendar(snapshot, cell),
    dau: dailyActive(snapshot, cell, days),
  };
}

/**
 * Month by month, the dates the subscription machine already implies: trial ends, renewals, the
 * cancel-at-period-end dates, the end of each grace window, and the manual pilot grants' expiries. Derived
 * from the stored facts only (server/subscription.mjs) — nothing here schedules or changes anything.
 */
export function subscriptionCalendar(snapshot, cell) {
  const { now, families } = snapshot;
  const months = monthRange(monthShift(monthKey(now), -CALENDAR_BACK), monthShift(monthKey(now), CALENDAR_FORWARD));
  const kinds = { trialEnds: tally(), renewals: tally(), cancellations: tally(), graceEnds: tally(), grantExpiries: tally() };
  const put = (kind, at, familyId) => { if (Number.isSafeInteger(at) && at > 0) kinds[kind].add(monthKey(at), familyId); };
  for (const f of families.filter((x) => !x.deleted)) {
    const sub = f.subscription || null;
    if (sub) {
      if (sub.state === 'trial') put('trialEnds', sub.trialEndsAt, f.id);
      if (sub.cancelAtPeriodEnd === true) put('cancellations', sub.state === 'trial' ? sub.trialEndsAt : sub.periodEnd, f.id);
      else if (sub.state === 'active') { put('renewals', sub.periodEnd, f.id); put('graceEnds', sub.periodEnd + GRACE_DAYS * DAY, f.id); }
    } else if (f.grant && Number.isSafeInteger(f.grant.accessUntil) && f.grant.accessUntil > 0) put('grantExpiries', f.grant.accessUntil, f.id);
  }
  return months.map((month) => Object.fromEntries([['month', month],
    ...Object.entries(kinds).map(([kind, t]) => [kind, cell(t.count(month), t.families(month))])]));
}

/**
 * Daily active users per LOCAL day: each answered question is dated in its own family's time zone
 * (Intl, so a daylight-saving change moves the boundary with the zone), then distinct children and
 * distinct families are counted per day, with 7- and 28-day rolling averages. A day's numbers are
 * suppressed unless minCell families were active on it; a rolling average is suppressed unless minCell
 * families were active across its whole window.
 */
export function dailyActive(snapshot, cell, days = DEFAULT_DAYS) {
  const { now, families } = snapshot;
  const from = dayISO(now - days * DAY, 'UTC'), to = dayISO(now, 'UTC');
  const perDay = new Map(); // day → { children:Set, families:Set }
  for (const f of families.filter((x) => !x.deleted)) {
    for (const e of activityOf(f)) {
      if (e.day < from || e.day > to) continue;
      if (!perDay.has(e.day)) perDay.set(e.day, { children: new Set(), families: new Set() });
      const slot = perDay.get(e.day); slot.children.add(`${f.id}:${e.childId}`); slot.families.add(f.id);
    }
  }
  const axis = dayRange(from, to);
  const childrenOn = (day) => perDay.get(day)?.children.size || 0;
  const familiesOn = (day) => perDay.get(day)?.families.size || 0;
  const rolling = (index, span, pick) => {
    const window = axis.slice(Math.max(0, index - span + 1), index + 1);
    const basis = new Set();
    for (const day of window) for (const id of perDay.get(day)?.families || []) basis.add(id);
    return cell(round(mean(window.map(pick)), 2), basis.size);
  };
  const series = axis.map((day, i) => ({ day,
    children: cell(childrenOn(day), familiesOn(day)), families: cell(familiesOn(day), familiesOn(day)),
    avg7: rolling(i, 7, childrenOn), avg28: rolling(i, 28, childrenOn) }));
  const activeFamilies = new Set([...perDay.values()].flatMap((s) => [...s.families]));
  return { from, to, days, series, totalFamilies: cell(activeFamilies.size, activeFamilies.size) };
}

// ---------------------------------------------------------------- section 2 — the speed matrices
// "Passed unusually easily" and "unusually hard", as the owner asked for them. Both are review flags on a
// paper band, never on a child: the lists carry a sector, a band, a column and the medians, nothing else.
export const EASY = Object.freeze({ shareBelow: 0.5, fasterThanNeighbours: 0.35 });
export const HARD = Object.freeze({ shareAtLeast: 0.9, passRateBelow: 0.4 });
const BAND_ORDER = Object.freeze(['paper', 'practice', 'checkpoint', 'scan', 'placement']);
export const BAND_LABEL = Object.freeze({ paper: 'papers', practice: 'practice', checkpoint: 'check point', scan: 'system scan', placement: 'placement test' });

/** The band a history row belongs to: its sector and the papers it recorded, e.g. `B 21–25`. */
export function bandOf(row) {
  const level = Number.isInteger(row?.level) ? row.level : null;
  const levelId = LEVELS[level]?.id || '?';
  const papers = typeof row?.papers === 'string' ? row.papers.trim() : '';
  const kind = row?.mode === 'boss' ? 'checkpoint' : BAND_ORDER.includes(row?.mode) ? row.mode
    : /^CP\b/i.test(papers) ? 'checkpoint' : /SCAN/i.test(papers) ? 'scan' : /PLACEMENT/i.test(papers) ? 'placement'
      : /^practice\b/i.test(papers) ? 'practice' : 'paper';
  const numbers = papers.match(/(\d+)\s*[–-]\s*(\d+)/);
  const tier = Number(papers.match(/T(\d+)/i)?.[1]);
  const from = numbers ? Number(numbers[1]) : (kind === 'checkpoint' && Number.isFinite(tier) ? tier * 20 - 19 : 0);
  return { label: `${levelId} ${papers}`.trim(), level, levelId, kind, from, to: numbers ? Number(numbers[2]) : null };
}
/**
 * A session counts towards a matrix only if its per-question log carries the allowance: the v2 import
 * records seconds without one (server/migrate.mjs), and a share of the allowance cannot be computed from
 * seconds alone, so those rows are skipped rather than guessed at.
 */
export const timedRow = (row) => !row?.quit && Array.isArray(row?.qlog) && row.qlog.length > 0
  && row.qlog.every((q) => Number.isFinite(q?.a) && q.a > 0 && Number.isFinite(q?.s) && q.s >= 0);
const columnOf = (child, by) => {
  const v = by === 'age' ? child?.age : child?.yearLevel;
  return Number.isInteger(v) ? String(v) : 'not given';
};
/**
 * One track's matrix: the paper bands the history records down the side, year level (or age) across, and in
 * each cell the median seconds per question over sessions that passed with every question correct, with the
 * number of such sessions and the median share of the allowance those sessions used.
 *
 * The medians come from the passes; the pass rate uses every finished, timed attempt of the cell. A child's
 * column is their currently recorded year level or age — the profile keeps one, not a history of them.
 */
export function speedMatrix(snapshot, track, cell, { minCell = MIN_CELL, by = 'year' } = {}) {
  const acc = new Map();
  const key = (band, column) => `${band.label} ${column}`;
  for (const f of snapshot.families.filter((x) => !x.deleted)) {
    const columns = new Map((f.children || []).map((c) => [c.id, columnOf(c, by)]));
    for (const { childId, history } of f.progress || []) {
      const column = columns.get(childId) || 'not given';
      for (const row of history || []) {
        if (row?.track !== track || !timedRow(row)) continue;
        const band = bandOf(row);
        if (band.level === null) continue;
        const k = key(band, column);
        if (!acc.has(k)) acc.set(k, { band, column, perQuestion: [], shares: [], attempts: 0, passes: 0, families: new Set(), children: new Set() });
        const c = acc.get(k);
        c.attempts++; c.families.add(f.id); c.children.add(`${f.id}:${childId}`);
        if (row.passed !== true || row.correct !== row.total) continue;
        const seconds = row.qlog.reduce((a, q) => a + q.s, 0), allowed = row.qlog.reduce((a, q) => a + q.a, 0);
        c.passes++; c.perQuestion.push(seconds / row.qlog.length); c.shares.push(seconds / allowed);
      }
    }
  }
  // raw cells first: a flag has to be decided from cells that may themselves be printed
  const raw = [...acc.values()].map((c) => ({ band: c.band, column: c.column, families: c.families.size,
    sessions: c.passes, attempts: c.attempts, medianSeconds: round(median(c.perQuestion), 2),
    medianShare: round(median(c.shares), 3), passRate: c.attempts ? round(c.passes / c.attempts, 3) : null }));
  const publishable = (c) => c && c.families >= minCell && c.sessions >= minCell && Number.isFinite(c.medianSeconds);
  const bands = [...new Map(raw.map((c) => [c.band.label, c.band])).values()]
    .sort((a, b) => a.level - b.level || BAND_ORDER.indexOf(a.kind) - BAND_ORDER.indexOf(b.kind) || a.from - b.from || a.label.localeCompare(b.label));
  const columnKeys = columnsFor(raw, by);
  const at = (label, column) => raw.find((c) => c.band.label === label && c.column === column) || null;
  // the neighbouring bands of the same sector and the same kind, in band order: a paper band is compared
  // with paper bands, never with a check point
  const neighbours = (band, column) => {
    const family = bands.filter((b) => b.level === band.level && b.kind === band.kind);
    const i = family.findIndex((b) => b.label === band.label);
    return [family[i - 1], family[i + 1]].filter(Boolean).map((b) => at(b.label, column)).filter(publishable);
  };
  const flags = { easy: [], hard: [] };
  for (const c of raw) {
    if (!publishable(c)) continue;
    const near = neighbours(c.band, c.column), reference = mean(near.map((n) => n.medianSeconds));
    const faster = Number.isFinite(reference) && reference > 0 ? round(1 - c.medianSeconds / reference, 3) : null;
    const common = { track, sector: c.band.levelId, band: c.band.label, kind: c.band.kind, column: c.column,
      sessions: c.sessions, attempts: c.attempts, medianSeconds: c.medianSeconds, medianShare: c.medianShare, passRate: c.passRate };
    if (c.medianShare !== null && c.medianShare < EASY.shareBelow && faster !== null && faster >= EASY.fasterThanNeighbours) {
      c.flag = 'easy';
      flags.easy.push({ ...common, neighbourMedianSeconds: round(reference, 2), fasterBy: faster,
        reason: `median share ${c.medianShare} below ${EASY.shareBelow} and ${Math.round(faster * 100)}% faster than the neighbouring bands` });
    } else if ((c.medianShare !== null && c.medianShare >= HARD.shareAtLeast) || (c.passRate !== null && c.passRate < HARD.passRateBelow)) {
      c.flag = 'hard';
      flags.hard.push({ ...common, neighbourMedianSeconds: round(reference, 2),
        reason: c.medianShare !== null && c.medianShare >= HARD.shareAtLeast
          ? `median share ${c.medianShare} at or above ${HARD.shareAtLeast}` : `pass rate ${c.passRate} below ${HARD.passRateBelow}` });
    }
  }
  const order = (a, b) => a.sector.localeCompare(b.sector) || a.band.localeCompare(b.band) || a.column.localeCompare(b.column);
  flags.easy.sort(order); flags.hard.sort(order);
  return { track, by, columns: columnKeys,
    rows: bands.map((band) => ({ ...band, cells: columnKeys.map((column) => matrixCell(at(band.label, column), column, cell)) })),
    flags, thresholds: { easy: EASY, hard: HARD, minSessions: minCell, minFamilies: minCell } };
}
function columnsFor(raw, by) {
  const present = new Set(raw.map((c) => c.column));
  const numbers = by === 'age' ? [...present].filter((k) => k !== 'not given').sort((a, b) => Number(a) - Number(b))
    : ['1', '2', '3', '4', '5', '6'];
  return [...numbers, ...(present.has('not given') ? ['not given'] : [])];
}
/** Every number of a cell lives or dies together, and the labels are not numbers. */
function matrixCell(c, column, cell) {
  if (!c) return { column, empty: true, suppressed: false };
  const sessions = cell(c.sessions, c.families);
  if (sessions.suppressed) return { column, suppressed: true };
  return { column, suppressed: false, sessions: c.sessions, attempts: c.attempts, families: c.families,
    medianSeconds: c.medianSeconds, medianShare: c.medianShare, passRate: c.passRate, flag: c.flag || null };
}

// ---------------------------------------------------------------- section 3 — rewards and the shop
// A parent types a reward's name by hand, so the report never prints one beside anything else: each name is
// normalised into a category, the categories carry the numbers, and an appendix lists the de-duplicated raw
// names with nothing else on the line. The keyword lists include Indonesian, because the pilot's families
// write in it: uang jajan is pocket money, jajan is a snack, main game is screen-and-console time, nonton is
// watching something.
export const REWARD_CATEGORIES = Object.freeze(['screen_time', 'money', 'outing', 'food', 'toy', 'game', 'book', 'activity', 'other']);
export const CATEGORY_LABEL = Object.freeze({ screen_time: 'Screen time', money: 'Money / cash', outing: 'Outing',
  food: 'Food / treat', toy: 'Toy', game: 'Game / console', book: 'Book', activity: 'Activity', other: 'Other' });
const KEYWORDS = Object.freeze({
  screen_time: ['screen', 'screen time', 'screentime', 'tv', 'television', 'telly', 'youtube', 'netflix', 'disney', 'ipad', 'tablet', 'phone', 'phone time', 'cartoon', 'anime', 'tiktok',
    'nonton', 'menonton', 'tonton', 'nonton tv', 'waktu layar', 'layar', 'hp'],
  money: ['money', 'cash', 'pocket money', 'allowance', 'dollar', 'dollars', 'rupiah', 'ringgit', 'peso', 'baht', 'savings',
    'uang', 'uang jajan', 'uang saku', 'duit', 'tabungan'],
  outing: ['outing', 'trip', 'day out', 'park', 'theme park', 'water park', 'playground', 'zoo', 'aquarium', 'museum', 'beach', 'cinema', 'movie', 'movies', 'mall', 'picnic', 'holiday', 'vacation', 'camping',
    'taman', 'kebun binatang', 'pantai', 'bioskop', 'piknik', 'jalan jalan', 'liburan'],
  food: ['ice cream', 'icecream', 'chocolate', 'candy', 'sweets', 'snack', 'snacks', 'cake', 'pizza', 'burger', 'mcdonald', 'kfc', 'boba', 'bubble tea', 'donut', 'doughnut', 'biscuit', 'dessert', 'treat', 'fries', 'milkshake', 'juice', 'soda',
    'es krim', 'cokelat', 'permen', 'jajan', 'jajanan', 'kue', 'makan', 'makanan', 'bakso', 'martabak', 'sate', 'jus'],
  toy: ['toy', 'toys', 'lego', 'doll', 'puzzle', 'figure', 'action figure', 'plush', 'slime', 'bike', 'bicycle', 'scooter', 'skateboard',
    'mainan', 'boneka', 'sepeda'],
  game: ['game', 'games', 'gaming', 'game time', 'video game', 'video games', 'playstation', 'ps4', 'ps5', 'xbox', 'nintendo', 'switch', 'roblox', 'minecraft', 'fortnite', 'mobile legends', 'free fire', 'steam', 'console', 'pc game',
    'main game', 'mabar'],
  book: ['book', 'books', 'comic', 'comics', 'manga', 'novel', 'magazine', 'story', 'stories',
    'buku', 'komik', 'majalah', 'cerita'],
  activity: ['swimming', 'swim', 'football', 'soccer', 'basketball', 'badminton', 'sport', 'sports', 'dance', 'dancing', 'music', 'piano', 'guitar', 'drawing', 'painting', 'craft', 'baking', 'cooking', 'karate', 'taekwondo', 'bowling', 'skating', 'yoga', 'futsal', 'tennis', 'sleepover', 'class', 'lesson', 'playdate',
    'berenang', 'renang', 'sepak bola', 'bulu tangkis', 'olahraga', 'menari', 'gitar', 'menggambar', 'memasak', 'les'],
  other: [],
});
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// longest keyword first: "uang jajan" is pocket money although it contains "jajan", and "main game" is the
// console although it contains "game". A tie goes to the earlier category in REWARD_CATEGORIES.
const MATCHERS = Object.entries(KEYWORDS).flatMap(([category, words]) => words.map((word) => ({ category, word,
  re: new RegExp(`(?<![\\p{L}\\p{N}])${word.split(/\s+/).map(escape).join('\\s+')}(?![\\p{L}\\p{N}])`, 'u') })))
  .sort((a, b) => b.word.length - a.word.length || REWARD_CATEGORIES.indexOf(a.category) - REWARD_CATEGORIES.indexOf(b.category));
/** Fold a parent-entered name to plain lower-case words: accents, emoji and punctuation all become spaces. */
export const normalizeName = (name) => String(name ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function rewardCategory(name) {
  const text = normalizeName(name);
  if (!text) return 'other';
  for (const m of MATCHERS) if (m.re.test(text)) return m.category;
  return 'other';
}
/** Cost bands, so the owner can see what a typical reward of a kind costs without any single reward showing. */
export const COST_BANDS = Object.freeze([[1, 99], [100, 199], [200, 499], [500, 999], [1000, 1999], [2000, 4999], [5000, null]]);
export function costBand(cost) {
  if (!Number.isFinite(cost)) return 'not given';
  for (const [from, to] of COST_BANDS) if (cost >= from && (to === null || cost <= to)) return to === null ? `${from}+` : `${from}–${to}`;
  return 'not given';
}
/**
 * Rewards by category: how many families use one, what it costs in reward points, how often it is asked for,
 * approved and refused, and how long a reward waits for its first redemption.
 *
 * The wait is the one number the stored shape limits: the game config keeps one `updatedAt` for the whole
 * reward list, not a date per reward (server/game.mjs → setRewards), so a pair counts only where the list has
 * not been saved again since that first redemption. Rocket fuel paid in reward points is not a reward: it is
 * counted on its own line, and the rocket's prize name never enters a category or the appendix.
 */
export function rewardInsights(snapshot, cell) {
  const live = snapshot.families.filter((f) => !f.deleted);
  const per = new Map(REWARD_CATEGORIES.map((k) => [k, { families: new Set(), costs: [], rewards: 0,
    redemptions: 0, approvals: 0, refusals: 0, pending: 0, waits: [], waitFamilies: new Set(), bands: new Map() }]));
  const names = new Set();
  const configured = new Set(), rocket = { redemptions: 0, families: new Set() };
  for (const f of live) {
    const known = new Map();
    if ((f.rewards || []).length) configured.add(f.id);
    const band = (slot, key, familyId) => {
      if (!slot.bands.has(key)) slot.bands.set(key, { rewards: 0, redemptions: 0, families: new Set() });
      const b = slot.bands.get(key); b.families.add(familyId); return b;
    };
    for (const r of f.rewards || []) {
      const category = rewardCategory(r.name), slot = per.get(category);
      known.set(r.id, { category, cost: r.cost });
      slot.rewards++; slot.families.add(f.id);
      if (Number.isFinite(r.cost)) slot.costs.push(r.cost);
      if (typeof r.name === 'string' && r.name.trim()) names.add(r.name.trim());
      band(slot, costBand(r.cost), f.id).rewards++;
    }
    const first = new Map();
    for (const { wallet } of f.progress || []) {
      for (const red of wallet?.redemptions || []) {
        if (!red || typeof red !== 'object') continue;
        if (red.rewardId === 'rocket') { rocket.redemptions++; rocket.families.add(f.id); continue; }
        const seen = known.get(red.rewardId), category = seen ? seen.category : rewardCategory(red.name);
        const slot = per.get(category);
        if (!seen && typeof red.name === 'string' && red.name.trim()) names.add(red.name.trim()); // a reward the parent has since removed
        slot.redemptions++; slot.families.add(f.id);
        if (red.status === 'approved') slot.approvals++;
        else if (red.status === 'rejected') slot.refusals++;
        else slot.pending++;
        band(slot, costBand(seen?.cost ?? red.cost), f.id).redemptions++;
        if (Number.isFinite(red.requestedAt) && (!first.has(red.rewardId) || first.get(red.rewardId).at > red.requestedAt)) first.set(red.rewardId, { at: red.requestedAt, category });
      }
    }
    if (Number.isFinite(f.configUpdatedAt)) {
      for (const [, v] of first) {
        if (f.configUpdatedAt > v.at) continue; // the list was saved again after that redemption: the pair says nothing
        const slot = per.get(v.category);
        slot.waits.push((v.at - f.configUpdatedAt) / DAY); slot.waitFamilies.add(f.id);
      }
    }
  }
  const categories = REWARD_CATEGORIES.map((key) => {
    const s = per.get(key), n = s.families.size;
    return { key, label: CATEGORY_LABEL[key],
      families: cell(n, n), rewards: cell(s.rewards, n),
      averageCost: cell(round(mean(s.costs), 0), n), medianCost: cell(round(median(s.costs), 0), n),
      redemptions: cell(s.redemptions, n), approvals: cell(s.approvals, n), refusals: cell(s.refusals, n), pending: cell(s.pending, n),
      daysToFirstRedemption: cell(round(median(s.waits), 1), s.waitFamilies.size),
      bands: [...s.bands.entries()].sort(byBand).map(([band, b]) => ({ band,
        families: cell(b.families.size, b.families.size), rewards: cell(b.rewards, b.families.size), redemptions: cell(b.redemptions, b.families.size) })) };
  });
  return { categories, configuredFamilies: cell(configured.size, configured.size),
    rocketFuel: { redemptions: cell(rocket.redemptions, rocket.families.size), families: cell(rocket.families.size, rocket.families.size) },
    names: [...names].sort((a, b) => a.localeCompare(b)).slice(0, 500) };
}
const bandBounds = (label) => (label === 'not given' ? Number.MAX_SAFE_INTEGER : Number(label.split(/[–+]/)[0]));
const byBand = (a, b) => bandBounds(a[0]) - bandBounds(b[0]);

/**
 * The shop, from the wallets and the ledgers: what is bought and what is ignored, who owns what, the balance a
 * child held when they bought, and what the two currencies do — earned, spent, saved, and spent as a share of
 * earned. The ledger is the source of truth for money (server/ledger.mjs): each row stores the balance after
 * it, so the balance at the moment of a purchase is that balance minus the row's own (negative) amount.
 */
export function shopInsights(snapshot, cell) {
  const live = snapshot.families.filter((f) => !f.deleted);
  const catalogue = new Map(SHOP_ITEMS.map((x) => [x.id, x]));
  const items = new Map(), kinds = new Map(), owned = new Map();
  const money = { gc: blank(), rp: blank() };
  const childFamilies = new Set();
  let children = 0;
  const itemSlot = (id) => { if (!items.has(id)) items.set(id, { purchases: 0, spent: 0, families: new Set(), children: new Set(), balances: [] }); return items.get(id); };
  const kindSlot = (kind) => { if (!kinds.has(kind)) kinds.set(kind, { purchases: 0, spent: { gc: 0, rp: 0 }, families: new Set(), children: new Set(), costs: [] }); return kinds.get(kind); };
  for (const f of live) {
    for (const { childId, wallet } of f.progress || []) {
      children++; childFamilies.add(f.id);
      for (const id of wallet?.inventory || []) {
        if (!owned.has(id)) owned.set(id, { children: new Set(), families: new Set() });
        owned.get(id).children.add(`${f.id}:${childId}`); owned.get(id).families.add(f.id);
      }
      for (const c of ['gc', 'rp']) {
        const balance = Number.isFinite(wallet?.[c]) ? wallet[c] : 0;
        money[c].saved += balance; money[c].savedPerChild.push(balance); money[c].families.add(f.id);
      }
    }
    for (const { childId, rows } of f.ledgers || []) {
      const spent = { gc: 0, rp: 0 };
      for (const r of rows || []) {
        if (!r || typeof r !== 'object') continue;
        for (const c of ['gc', 'rp']) {
          const delta = Number.isFinite(r[c]) ? r[c] : 0;
          if (delta > 0) money[c].earned += delta;
          else if (delta < 0) { money[c].spent += -delta; spent[c] += -delta; }
        }
        if (r.type === 'shop.buy') {
          const it = catalogue.get(r.ref) || null, slot = itemSlot(r.ref);
          slot.purchases++; slot.spent += -(r.gc || 0); slot.families.add(f.id); slot.children.add(`${f.id}:${childId}`);
          if (r.balance && Number.isFinite(r.balance.gc)) slot.balances.push(r.balance.gc - (r.gc || 0)); // the balance before the charge
          const k = kindSlot(it ? it.kind : 'unknown');
          k.purchases++; k.spent.gc += -(r.gc || 0); k.families.add(f.id); k.children.add(`${f.id}:${childId}`); k.costs.push(-(r.gc || 0));
          if (r.balance && Number.isFinite(r.balance.gc)) money.gc.purchaseBalances.push(r.balance.gc - (r.gc || 0));
        } else if (r.type === 'reward.request' || r.type === 'rocket.fuel' || (r.type === 'parent.adjust' && ((r.gc || 0) < 0 || (r.rp || 0) < 0))) {
          const k = kindSlot(r.type === 'reward.request' ? 'reward' : r.type === 'rocket.fuel' ? 'rocket fuel' : 'parent adjustment');
          k.purchases++; k.families.add(f.id); k.children.add(`${f.id}:${childId}`);
          k.spent.gc += Math.max(0, -(r.gc || 0)); k.spent.rp += Math.max(0, -(r.rp || 0));
          if (r.type === 'reward.request' && r.balance && Number.isFinite(r.balance.rp)) money.rp.purchaseBalances.push(r.balance.rp - (r.rp || 0));
        }
      }
      for (const c of ['gc', 'rp']) if (spent[c] > 0) money[c].spentPerChild.push(spent[c]);
    }
  }
  const itemRows = [...items.entries()].map(([id, s]) => {
    const it = catalogue.get(id) || null, own = owned.get(id) || { children: new Set(), families: new Set() };
    const basis = s.families.size;
    return { id, name: it?.name || 'not in the catalogue', kind: it?.kind || 'unknown', cost: it?.cost ?? null,
      purchases: cell(s.purchases, basis), children: cell(s.children.size, basis), spent: cell(s.spent, basis),
      owners: cell(own.children.size, own.families.size),
      ownedPercent: cell(children ? round(own.children.size * 100 / children, 1) : null, own.families.size),
      medianBalanceBefore: cell(round(median(s.balances), 0), basis), rank: s.purchases };
  }).sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const publishable = itemRows.filter((r) => !r.purchases.suppressed);
  const currencies = Object.fromEntries(['gc', 'rp'].map((c) => {
    const m = money[c], n = m.families.size;
    return [c, { earned: cell(m.earned, n), spent: cell(m.spent, n), saved: cell(m.saved, n),
      spendingPercent: cell(m.earned > 0 ? round(m.spent * 100 / m.earned, 1) : null, n),
      medianSpentPerChild: cell(round(median(m.spentPerChild), 0), n), medianSavedPerChild: cell(round(median(m.savedPerChild), 0), n),
      medianBalanceAtPurchase: cell(round(median(m.purchaseBalances), 0), n) }];
  }));
  return { children: cell(children, childFamilies.size),
    items: itemRows.map(({ rank, ...r }) => r),
    most: publishable.slice(0, 5).map(({ rank, ...r }) => r),
    least: publishable.slice(-5).reverse().map(({ rank, ...r }) => r),
    neverBought: SHOP_ITEMS.filter((x) => x.cost > 0 && !items.has(x.id)).map((x) => ({ id: x.id, name: x.name, kind: x.kind, cost: x.cost })),
    kinds: [...kinds.entries()].sort((a, b) => b[1].purchases - a[1].purchases || a[0].localeCompare(b[0])).map(([kind, s]) => ({ kind,
      purchases: cell(s.purchases, s.families.size), children: cell(s.children.size, s.families.size),
      spentGc: cell(s.spent.gc, s.families.size), spentRp: cell(s.spent.rp, s.families.size),
      medianCost: cell(round(median(s.costs), 0), s.families.size) })),
    currencies };
}
const blank = () => ({ earned: 0, spent: 0, saved: 0, families: new Set(), spentPerChild: [], savedPerChild: [], purchaseBalances: [] });

// ---------------------------------------------------------------- reading the store (the only I/O)
/**
 * One read-only pass for the whole report. Walks families in pages, and per family reads its children's
 * profiles (never a nickname), their progress documents, their ledgers, the game config and the provider
 * customer mapping. Nothing is written and nothing identifying leaves this function's return value except
 * the ids the arithmetic needs to count distinct families and children, which never reach the report.
 */
export async function collectSnapshot(store, { now = Date.now(), days = DEFAULT_DAYS, batch = 100 } = {}) {
  const families = [];
  for (let after = null; ;) {
    const page = await store.entriesAfter('families', after, batch);
    for (const [id, f] of page) families.push(await collectFamily(store, id, f));
    if (page.length < batch) break;
    after = page.at(-1)[0];
  }
  return { now, days, families };
}
async function collectFamily(store, id, f) {
  if (f.deleted === true) return { id, deleted: true, createdAt: f.createdAt ?? null, timeZone: null, subscription: f.subscription || null, grant: null, billingCountry: null, children: [], progress: [], ledgers: [], rewards: [], configUpdatedAt: null };
  const children = [], progress = [], ledgers = [];
  for (const [childId, c] of await store.entries(`families/${id}/children`)) {
    children.push({ id: childId, status: c.status || null, createdAt: c.createdAt ?? null,
      age: c.demographics?.age ?? null, yearLevel: c.demographics?.yearLevel ?? null, start: c.start?.option || null });
    const stored = await store.get(`families/${id}/learning/${childId}`);
    if (!stored) continue;
    const prog = normalizeProgress(stored);
    progress.push({ childId, history: prog.history, wallet: prog.wallet, stats: prog.stats });
    ledgers.push({ childId, rows: await store.list(`families/${id}/learning/${childId}/ledger`) });
  }
  const cfg = await store.get(`families/${id}/game/config`);
  // billing country is the provider's, not the app's: the service stores no address (PRIVACY.md)
  let billingCountry = null;
  for (const [provider, ref] of Object.entries(f.billing || {})) {
    const mapping = await store.get(`billingCustomers/${provider}:${ref}`);
    if (mapping?.country) { billingCountry = String(mapping.country).slice(0, 8); break; }
  }
  return { id, deleted: false, createdAt: f.createdAt ?? null, timeZone: f.timeZone || null,
    subscription: f.subscription || null, grant: f.subscription ? null : (f.entitlement || null), billingCountry,
    children, progress, ledgers,
    rewards: Array.isArray(cfg?.rewards) ? cfg.rewards : [], configUpdatedAt: Number.isFinite(cfg?.updatedAt) ? cfg.updatedAt : null };
}

// ---------------------------------------------------------------- the report
/** The whole report: scope, then the sections. Every number has already been through the suppression rule. */
export function buildReport(snapshot, { minCell = MIN_CELL, by = 'year' } = {}) {
  const cell = cellFactory(minCell);
  const live = snapshot.families.filter((f) => !f.deleted);
  const column = by === 'age' ? 'age' : 'year';
  return {
    version: 1, generatedAt: snapshot.now, minCell, by: column, days: snapshot.days,
    // the cohort's own size is the report's scope, not a statistic about a subgroup: printed plainly so a
    // reader understands the dashes below it (PRIVACY.md → the operator report)
    scope: { families: live.length, tombstones: snapshot.families.length - live.length,
      children: live.reduce((a, f) => a + (f.children || []).length, 0),
      suppressedBelow: minCell, dayWindow: snapshot.days },
    households: households(snapshot, cell),
    speed: { engine: speedMatrix(snapshot, 'engine', cell, { minCell, by: column }), nav: speedMatrix(snapshot, 'nav', cell, { minCell, by: column }) },
    rewards: rewardInsights(snapshot, cell),
    shop: shopInsights(snapshot, cell),
  };
}
/** The audit row one run writes — built here so a test can check it names the operator and no family. */
export function auditRow({ operator, at, families, minCell, days, by }) {
  return { action: 'operator.dashboard', uid: operator, familyId: null, childId: null, at,
    expireAt: at + AUDIT_RETENTION_MS, families, minCell, days, by };
}
