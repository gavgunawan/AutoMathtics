// Progress rules for the two tracks, ported from the v2 game so a child keeps the same journey:
// six sectors (A–F), 100 papers each, five-paper sessions, a 👑 check point every 20 papers,
// both tracks through a sector before the jump to the next. Pure functions: no store, no clock.
import { genEngine, engineSecondsFor, LEVELS } from './questions/engine.mjs';
import { genNavigator, navSecondsFor } from './questions/navigator.mjs';

export const PAPERS_PER_LEVEL = 100, PAPERS_PER_SESSION = 5;
export const Q_PER_PAPER = Object.freeze({ engine: 5, nav: 3 });
export const TRACKS = Object.freeze(['engine', 'nav']);
export const OTHER = Object.freeze({ engine: 'nav', nav: 'engine' });
export const GC_PASS = 50, RP_PASS = 100;
export const tierOf = (paper) => Math.min(5, Math.ceil(paper / 20));
export { LEVELS };

export const freshProgress = () => ({
  engine: { level: 0, paper: 1, bossCleared: 0 }, nav: { level: 0, paper: 1, bossCleared: 0 },
  wallet: { gc: 0, rp: 0, bonuses: 0 }, passDays: [], stats: { sessions: 0, passes: 0 }, history: [], activeSession: null,
});
export const trk = (p, t) => p[t] || { level: 0, paper: 1, bossCleared: 0 };
export const withTrk = (p, t, patch) => ({ ...p, [t]: { ...trk(p, t), ...patch } });
export const trackDone = (p, t) => { const x = trk(p, t); return x.paper > PAPERS_PER_LEVEL && x.bossCleared >= 5; };
export const bossDue = (p, t) => { const x = trk(p, t); return x.bossCleared < Math.min(5, Math.floor((x.paper - 1) / 20)); };
const jumpTrack = (p, t, level) => withTrk(p, t, { level, paper: 1, bossCleared: 0 });
// a finished track jumps on once the other track has finished that sector too (or is already past it)
export const canJump = (p, t) => {
  const me = trk(p, t), o = trk(p, OTHER[t]);
  return trackDone(p, t) && me.level < LEVELS.length - 1 && (o.level > me.level || (o.level === me.level && trackDone(p, OTHER[t])));
};
// settle every jump that is due — one track jumping can unblock the other, so go round twice
export const settleJumps = (p) => {
  let out = p; const jumped = [];
  for (let i = 0; i < 2; i++) for (const t of TRACKS) if (canJump(out, t) && !jumped.includes(t)) { out = jumpTrack(out, t, trk(out, t).level + 1); jumped.push(t); }
  return { p: out, jumped };
};
export const sectorsCleared = (p) => Math.min(trk(p, 'engine').level, trk(p, 'nav').level);

// What the next session on a track is: the due check point, the next five papers, or practice.
export function nextRun(p, t) {
  const x = trk(p, t);
  if (trackDone(p, t)) return { mode: 'practice', level: x.level, startPaper: 1 + 5 * Math.floor(Math.random() * (PAPERS_PER_LEVEL / PAPERS_PER_SESSION)), tierEnd: null };
  if (bossDue(p, t)) return { mode: 'boss', level: x.level, startPaper: null, tierEnd: (x.bossCleared + 1) * 20 };
  return { mode: 'paper', level: x.level, startPaper: x.paper, tierEnd: null };
}
const gen = (t, level, paper) => (t === 'nav' ? genNavigator(level, tierOf(paper)) : genEngine(level, tierOf(paper)));
const secondsFor = (t, level, paper) => (t === 'nav' ? navSecondsFor(level, tierOf(paper), 1) : engineSecondsFor(level, tierOf(paper), 1));
// Server-side question list. `answer` never leaves the server; `seconds` is the per-question allowance.
export function buildQuestions(t, run) {
  const qs = [];
  const push = (paper) => { const q = gen(t, run.level, paper); qs.push({ paper, tier: tierOf(paper), seconds: secondsFor(t, run.level, paper), display: q.display, answer: q.answer, read: q.read || null }); };
  if (run.mode === 'boss') {
    for (let i = 0; i < PAPERS_PER_SESSION * Q_PER_PAPER[t]; i++) push(run.tierEnd - 19 + Math.floor(Math.random() * 20));
  } else {
    for (let p = run.startPaper; p < run.startPaper + PAPERS_PER_SESSION; p++) for (let i = 0; i < Q_PER_PAPER[t]; i++) push(p);
  }
  return qs;
}

// Strict grading. Anything that is not a well-formed answer of the question's type is `null`
// (rejected, not counted); the browser never gets to say what a number "roughly" is.
const INT = /^-?\d{1,7}$/, DEC = /^-?\d{1,6}(\.\d{1,2})?$/, SMALL = /^\d{1,4}$/;
export function grade(q, answer) {
  const a = q.answer;
  if (a.type === 'int') return typeof answer === 'string' && INT.test(answer) ? (Number(answer) === a.v ? 'correct' : 'incorrect') : null;
  if (a.type === 'dec') return typeof answer === 'string' && DEC.test(answer) ? (Math.round(Number(answer) * 100) === Math.round(a.v * 100) ? 'correct' : 'incorrect') : null;
  if (a.type === 'frac') {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || typeof answer.n !== 'string' || typeof answer.d !== 'string' || !SMALL.test(answer.n) || !SMALL.test(answer.d)) return null;
    return Number(answer.n) === a.n && Number(answer.d) === a.d ? 'correct' : 'incorrect'; // reduced form, as the paper asks
  }
  if (a.type === 'choice') {
    const i = typeof answer === 'string' && /^\d{1,2}$/.test(answer) ? Number(answer) : null;
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

// Streak bonuses: every completed block of three consecutive pass-days earns one bonus.
export function bonusesFor(passDays) {
  let bonuses = 0, run = 0, prev = null;
  for (const d of [...passDays].sort()) {
    run = prev && Date.parse(d) - Date.parse(prev) === 86_400_000 ? run + 1 : 1;
    if (run % 3 === 0) bonuses++;
    prev = d;
  }
  return bonuses;
}
// The family's local calendar day, so a late-evening pass counts for the day the child sees.
export function dayISO(ms, timeZone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
}
