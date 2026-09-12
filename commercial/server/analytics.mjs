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
import { dayISO, normalizeProgress } from './progress.mjs';
import { GRACE_DAYS } from './subscription.mjs';

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
  };
}
/** The audit row one run writes — built here so a test can check it names the operator and no family. */
export function auditRow({ operator, at, families, minCell, days, by }) {
  return { action: 'operator.dashboard', uid: operator, familyId: null, childId: null, at,
    expireAt: at + AUDIT_RETENTION_MS, families, minCell, days, by };
}
