// Question styles (email-v1): what a child gets right and fast, right but slow, and wrong again and again, read from the answers
// the progress document keeps (history[].qlog). One set of rules, pure and deterministic (no clock, no random), for the weekly
// report (server/report.mjs) and the System Scan's focus (server/progress.mjs).
//
// A style is track × level × tier: `engine:3:2` is Division at difficulty 2 of 5. A qlog item names all three, with the seconds
// the answer used (s) and the seconds it was allowed (a). `ok: 0` covers a wrong answer and a timeout alike, so a timeout is
// inferred as not right at or past the allowance. An item without its track, level or allowance says nothing about a style:
// rows imported from v2 keep only {t, s, ok} (server/migrate.mjs) and are skipped.
export const STYLE_RULES = Object.freeze({
  minAnswers: 5,                          // no class on fewer than five answers in the style
  strong: { accuracy: 0.9, speed: 0.5 },   // right and fast: at least 90 % right, the median right answer in at most half its time
  slow: { accuracy: 0.8, speed: 0.75 },    // right but slow: at least 80 % right, the median right answer at 75 % of its time or more
  trouble: { wrong: 3, accuracy: 0.8 },    // wrong again and again: three or more wrong (timeouts included) and under 80 % right
  top: 3,                                  // the report lists the top three of each class
  focusStyles: 4,                          // the System Scan's focus takes at most four weak Engine styles
});
export const usable = (q) => !!q && (q.track === 'engine' || q.track === 'nav') && Number.isInteger(q.l) && q.l >= 0 && Number.isInteger(q.t) && q.t >= 1 && q.t <= 5
  && Number.isFinite(q.s) && q.s >= 0 && Number.isFinite(q.a) && q.a > 0;
export const timedOut = (q) => !q.ok && q.s >= q.a;
export const styleKey = (q) => `${q.track}:${q.l}:${q.t}`;
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
export function median(xs) { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
/** Nearest rank: the smallest value with at least a share p of all values at or below it (p = 0.8: 8 in 10 are within it). */
export function quantile(xs, p) { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); return v[Math.max(0, Math.ceil(p * v.length) - 1)]; }
/** The usable answers of history rows: every row's, or those `keep` accepts. */
export const answersOf = (rows, keep = () => true) => (Array.isArray(rows) ? rows : []).filter((r) => r && keep(r)).flatMap((r) => (Array.isArray(r.qlog) ? r.qlog : [])).filter(usable);
/**
 * Per style: answers, right, wrong (timeouts included), timeouts, accuracy, and speed, the median share of its allowance a right
 * answer used (null without a right answer); slowRight counts the right answers at or past the slow line. Sorted by style.
 */
export function styleStats(items) {
  const by = new Map();
  for (const q of items) {
    const k = styleKey(q), c = by.get(k) || { key: k, track: q.track, level: q.l, tier: q.t, n: 0, correct: 0, wrong: 0, timeouts: 0, ratios: [] };
    c.n++; if (q.ok) { c.correct++; c.ratios.push(q.s / q.a); } else { c.wrong++; if (timedOut(q)) c.timeouts++; }
    by.set(k, c);
  }
  return [...by.values()].map(({ ratios, ...c }) => ({ ...c, accuracy: c.correct / c.n, speed: median(ratios), slowRight: ratios.filter((x) => x >= STYLE_RULES.slow.speed).length })).sort(byKey);
}
/** A style's class, or null (too few answers, or in between). The thresholds make the three exclusive. */
export function classify(st) {
  const R = STYLE_RULES; if (st.n < R.minAnswers) return null;
  if (st.wrong >= R.trouble.wrong && st.accuracy < R.trouble.accuracy) return 'trouble';
  if (st.speed !== null && st.accuracy >= R.strong.accuracy && st.speed <= R.strong.speed) return 'strong';
  if (st.speed !== null && st.accuracy >= R.slow.accuracy && st.speed >= R.slow.speed) return 'slow';
  return null;
}
const ranked = (stats, cls) => {
  const of = stats.filter((s) => classify(s) === cls);
  return cls === 'trouble' ? of.sort((a, b) => b.wrong - a.wrong || byKey(a, b)) : cls === 'slow' ? of.sort((a, b) => b.speed - a.speed || byKey(a, b)) : of.sort((a, b) => b.n - a.n || byKey(a, b));
};
/** The report's three lists, the top three of each: trouble by wrong answers, slow by speed, strong by answers; ties by style. */
export const classes = (stats, top = STYLE_RULES.top) => ({ trouble: ranked(stats, 'trouble').slice(0, top), slow: ranked(stats, 'slow').slice(0, top), strong: ranked(stats, 'strong').slice(0, top) });
/**
 * The System Scan's focus: the child's weak Engine styles over all kept history, trouble first, then slow, at most four, none
 * above the sector the child is in now (a placement test can place a child a sector below the one it tested). Each carries its
 * misses, its wrong answers plus its right-but-slow ones, which weight its share of the scan (progress.mjs buildScanQuestions).
 */
export function weakStyles(history, maxLevel, limit = STYLE_RULES.focusStyles) {
  const stats = styleStats(answersOf(history).filter((q) => q.track === 'engine' && q.l <= maxLevel));
  return [...ranked(stats, 'trouble'), ...ranked(stats, 'slow')].slice(0, limit).map((s) => ({ key: s.key, level: s.level, tier: s.tier, cls: classify(s), misses: s.wrong + s.slowRight }));
}
