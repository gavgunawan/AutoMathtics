// 🪐 OLYMPIA — the olympiad practice world behind the kids' page's "Gateway jump" (the owner's request of 19 Sep 2026).
//
// Eight moons named for places, each modelled on one olympiad and none affiliated with it (questions/olympia/moons.mjs). Since
// 20 Sep 2026 a moon is the real paper, whole: its own number of questions in its own sections, on the paper's own total time,
// sat as three phases the child picks one at a time — α Alpha, β Beta, γ Gamma — each a section on one clock (the owner: the
// format and the number of questions follow the actual paper; ninety minutes straight is too much, so three selectable
// sections, each with its own log of the last ten scores and durations). A visit is one phase. The child's year picks the band:
// the year from sign-up, or the sector reached on either track when that is further, since the app advances a child past
// school (the owner, 19 Sep 2026: a child who has unlocked Sector B is a Year 2 wherever the school has them). Unlike the two
// tracks there are no streaks and no feedback as the child goes: every right and wrong — the final score — is revealed only
// at the end, as a competition does, with the worked solution under every question. When the bell goes the paper is
// collected as it stands: what is unanswered is blank. Medals on the paper's share of questions right pay Grid Coins, Reward
// Points and Olyminerals, the currency only Olympia's shop takes; at most two visits a phase a day are rewarded, later ones
// are training runs. A visit on which the child used "Explain to me" counts for nothing — no medal, no reward (the owner's
// rule). Olympia is a separately charged subscription: open during the opening free trial and on a pilot grant, otherwise it
// needs the Olympia pass a family carries (`family.olympia`, set by scripts/olympia-pass.mjs until payments open).
import { randomUUID } from 'node:crypto';
import { Fault, fail, object, uuid, text, YEAR_LEVELS } from './security.mjs';
import { normalizeProgress, grade, answerText, dayISO, trk, TRACKS, LEVELS } from './progress.mjs';
import { effectiveEntitlement } from './subscription.mjs';
import { entry, post } from './ledger.mjs';
import { MOONS, moonById, moonPublic, phaseById, phasePublic, bandOf, buildVisit, PHASE_NAMES } from './questions/olympia/moons.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const LATE_MS = 5_000, EARLY_MS = 2_000, STARTS_PER_HOUR = 30, HISTORY_MAX = 30, PHASE_LOG = 10, GIVEN_MAX = 16;
const AUDIT_RETENTION_MS = 400 * DAY;
// a medal is a share of the phase's questions right: 8 of 10, 12 of 15, 4 of 5, 13 of 16 for gold — the same bar whatever the section's length
export const MEDALS = Object.freeze([
  Object.freeze({ id: 'gold', share: 0.8, gc: 50, rp: 100, om: 30 }), Object.freeze({ id: 'silver', share: 0.6, gc: 30, rp: 60, om: 20 }),
  Object.freeze({ id: 'bronze', share: 0.4, gc: 20, rp: 40, om: 10 }), Object.freeze({ id: 'merit', share: 0.2, gc: 0, rp: 0, om: 5 })]);
export const REWARDED_VISITS_PER_DAY = 2;
export const DEFAULT_TIME_ZONE = 'Asia/Singapore';
export const medalAt = (share, total) => Math.max(1, Math.ceil(share * total - 1e-9));
export const thresholds = (total) => Object.fromEntries(MEDALS.map((m) => [m.id, medalAt(m.share, total)]));
export const medalFor = (score, total) => MEDALS.find((m) => score >= medalAt(m.share, total)) || null;
const RANK = { gold: 4, silver: 3, bronze: 2, merit: 1 };

/** Whether a family may enter Olympia now, and why: the pass, the opening trial, or a pilot grant; a paid plan without the pass may not. */
export function olympiaAccess(family, now) {
  const pass = family?.olympia;
  if (pass && pass.status === 'active' && Number.isSafeInteger(pass.until) && pass.until > now) return { open: true, why: 'pass', until: pass.until };
  const e = effectiveEntitlement(family || {}, now);
  if (e && e.status === 'active' && Number.isSafeInteger(e.accessUntil) && e.accessUntil > now) {
    if (e.source !== 'subscription') return { open: true, why: 'pilot', until: e.accessUntil };
    if (e.state === 'trial') return { open: true, why: 'trial', until: e.accessUntil };
  }
  return { open: false, why: 'none', until: null };
}
/** The highest sector (a LEVELS index) reached on either track: Sector B on the Engine is 1 whatever the Navigator says. */
const sectorReached = (prog) => Math.max(0, ...TRACKS.map((t) => trk(prog, t).level));
/**
 * The year a child is asked at. From sign-up, else from the age (7 is Year 1), else Year 1 — lifted to the sector reached on
 * either track when that is further (Sector B = Year 2 … F = Year 6): the app advances a child past school, so a child who has
 * unlocked Sector B is a Year 2 wherever the school has them (the owner, 19 Sep 2026). Never lowered: a Year 3 at Sector A stays 3.
 */
export function yearOf(child, prog = null) {
  const y = child?.demographics?.yearLevel, a = child?.demographics?.age;
  const signedUp = YEAR_LEVELS.includes(y) ? y : Number.isInteger(a) ? Math.max(1, Math.min(6, a - 6)) : 1;
  return prog ? Math.max(signedUp, Math.min(6, sectorReached(prog) + 1)) : signedUp;
}
/** For the hub: whether the sector lifted the year past sign-up, and which sector that is. */
export const yearFrom = (child, prog) => ({ yearLifted: yearOf(child, prog) > yearOf(child), sector: LEVELS[sectorReached(prog)]?.id || 'A' });
/** The operator's Olympia pass (scripts/olympia-pass.mjs): the family may enter until `until`; a past `until` closes it. Audited. */
export async function grantOlympia(store, { familyId, until, actor, reason }, now = Date.now()) {
  uuid(familyId); text(reason, 5, 200); text(actor, 3, 200);
  if (!Number.isSafeInteger(until) || until < 0) fail(400, 'INVALID_ENTITLEMENT');
  return store.transaction(async (tx) => {
    const path = `families/${familyId}`, family = await tx.get(path); if (!family) fail(404, 'FAMILY_NOT_FOUND');
    const olympia = { status: 'active', until, grantedAt: now, version: (family.olympia?.version || 0) + 1, source: 'manual' };
    tx.set(path, { ...family, olympia });
    tx.set(`audit/${randomUUID()}`, { action: 'olympia.granted', familyId, actor, reason, olympia, at: now, expireAt: now + AUDIT_RETENTION_MS });
    return olympia;
  });
}
const freshMoon = () => ({ gold: 0, silver: 0, bronze: 0, merit: 0, visits: 0, best: null, bestScore: 0 });
const freshPhase = () => ({ visits: 0, best: null, bestScore: 0, log: [] });
export const phaseKey = (moon, phase) => `${moon}:${phase}`;
export const medalTally = (prog) => Object.values(prog.olympia?.moons || {}).reduce((a, m) => a + (m.gold || 0) + (m.silver || 0) + (m.bronze || 0), 0);
const isLive = (v, now) => Boolean(v) && v.status === 'active' && now < v.deadline + LATE_MS;
const isOverdue = (v, now) => Boolean(v) && v.status === 'active' && now >= v.deadline + LATE_MS;

export class Olympia {
  constructor({ foundation, store, now = Date.now }) { this.foundation = foundation; this.store = store; this.now = now; }
  paths(s) { const base = `families/${s.familyId}/learning/${s.childId}`; return { doc: base, session: (id) => `${base}/sessions/${id}` }; }
  async child(tx, ctx) { const a = await this.foundation.authorize(tx, ctx, ['child']); const p = this.paths(a.s); return { ...a, p, prog: normalizeProgress(await tx.get(p.doc)) }; }
  publicVisit(v, now) {
    const m = moonById(v.moon), ph = m ? phaseById(m, v.phase) : null;
    return { id: v.id, moon: v.moon, moonName: m?.name || v.moon, emoji: m?.emoji || '🌑', year: v.year, band: m ? bandOf(m, v.year) : null, phase: v.phase, ...(PHASE_NAMES[v.phase] || { name: v.phase, sym: '' }), title: ph?.title || '', marks: ph?.marks ?? null,
      count: v.questions.length, index: v.index, status: v.status, tutored: v.tutored === true, seconds: v.seconds, left: Math.max(0, Math.round((v.deadline - now) / 1000)), thresholds: thresholds(v.questions.length) };
  }
  publicQuestion(v, i) { const q = v.questions[i]; return q ? { index: i, moon: v.moon, section: q.section, cat: q.cat, display: q.display, read: q.read, answerType: q.answer.type, explains: Array.isArray(q.steps) && q.steps.length > 0 } : null; }
  moonsFor(prog, year, date) {
    return MOONS.map((m) => {
      const t = { ...freshMoon(), ...(prog.olympia.moons[m.id] || {}) };
      const available = m.open && year >= m.years[0] && year <= m.years[1];
      const phases = m.phases.map((ph) => {
        const key = phaseKey(m.id, ph.id), pt = { ...freshPhase(), ...(prog.olympia.phases[key] || {}) }, days = prog.olympia.rewardDays[key] || {}, pub = phasePublic(m, ph, year);
        return { ...pub, thresholds: thresholds(pub.count), visits: pt.visits, best: pt.best, bestScore: pt.bestScore, log: pt.log.slice(0, PHASE_LOG), rewardedToday: days.date === date ? days.n : 0, rewardedPerDay: REWARDED_VISITS_PER_DAY };
      });
      return { ...moonPublic(m, year), available, why: !m.open ? 'soon' : year < m.years[0] ? `opens at Year ${m.years[0]}` : null, band: bandOf(m, year),
        medals: { gold: t.gold, silver: t.silver, bronze: t.bronze, merit: t.merit }, visits: t.visits, best: t.best, bestScore: t.bestScore, phases };
    });
  }
  // the bell rang while the child was away: the paper is collected as it stands, marked and logged, before anything else is shown
  async collectOverdue(tx, a, now) {
    const active = a.prog.olympia.activeVisit ? await tx.get(a.p.session(a.prog.olympia.activeVisit)) : null;
    if (!isOverdue(active, now)) return { prog: a.prog, active: isLive(active, now) ? active : null };
    const { progress } = await this.settle(tx, a, active, now, 'bell');
    return { prog: progress, active: null };
  }
  async state(ctx) {
    return this.store.transaction(async (tx) => {
      const a = await this.child(tx, ctx); const now = this.now(), tz = a.family.timeZone || DEFAULT_TIME_ZONE, year = yearOf(a.child, a.prog);
      const { prog, active } = await this.collectOverdue(tx, a, now);
      return { access: olympiaAccess(a.family, now), year, ...yearFrom(a.child, prog), minerals: prog.wallet.om, medals: MEDALS.map((m) => ({ id: m.id, share: m.share, gc: m.gc, rp: m.rp, om: m.om })), rewardedPerDay: REWARDED_VISITS_PER_DAY,
        moons: this.moonsFor(prog, year, dayISO(now, tz)), history: prog.olympia.history.slice(0, 12), medalCount: medalTally(prog),
        active: active ? { visit: this.publicVisit(active, now), question: this.publicQuestion(active, active.index) } : null };
    });
  }
  async start(ctx, body) {
    object(body, ['moon', 'phase']); const moon = moonById(typeof body.moon === 'string' ? body.moon : ''); if (!moon) fail(400, 'INVALID_REQUEST');
    const ph = phaseById(moon, typeof body.phase === 'string' ? body.phase : ''); if (!ph) fail(400, 'INVALID_REQUEST');
    const id = randomUUID();
    return this.store.transaction(async (tx) => {
      const a = await this.child(tx, ctx); const { p, s, family, child } = a; const now = this.now();
      if (!olympiaAccess(family, now).open) fail(403, 'OLYMPIA_LOCKED');
      const { prog, active } = await this.collectOverdue(tx, a, now);
      if (active) return { visit: this.publicVisit(active, now), question: this.publicQuestion(active, active.index), resumed: true }; // one visit at a time: a second start resumes it
      const year = yearOf(child, prog);
      if (!moon.open) fail(409, 'MOON_NOT_OPEN'); if (year < moon.years[0] || year > moon.years[1]) fail(409, 'MOON_NOT_FOR_YEAR');
      const commitRate = await this.foundation.rateIn(tx, `olympia-start:${s.familyId}:${s.childId}`, STARTS_PER_HOUR, HOUR)
        .catch((e) => { if (e instanceof Fault && e.code === 'TOO_MANY_ATTEMPTS') fail(429, 'TOO_MANY_PAPERS'); throw e; });
      const pace = prog.pacePercent / 100, seconds = Math.max(60, Math.round(ph.minutes * 60 * pace)); // the section's clock, stretched by the child's pace setting
      const questions = buildVisit(moon, year, ph.id);
      const visit = { id, kind: 'olympia', childId: s.childId, moon: moon.id, phase: ph.id, year, questions, results: [], index: 0, askedAt: now, seconds, deadline: now + seconds * 1000, status: 'active', tutored: false, createdAt: now, expireAt: now + 24 * HOUR, lastAttempt: null };
      commitRate(); tx.set(p.session(id), visit); tx.set(p.doc, { ...prog, olympia: { ...prog.olympia, activeVisit: id } });
      this.foundation.audit(tx, 'olympia.visit_started', s.uid, s.familyId, s.childId, { moon: moon.id, phase: ph.id });
      return { visit: this.publicVisit(visit, now), question: this.publicQuestion(visit, 0), resumed: false };
    });
  }
  async visitOf(tx, a, visitId) {
    const v = await tx.get(a.p.session(visitId)); if (!v || v.kind !== 'olympia') fail(404, 'SESSION_NOT_FOUND'); return v;
  }
  // An answer is marked and kept, and nothing is said about it until the paper ends: the reply carries the next question only. A
  // null answer is a blank — the child skipped it, as a paper allows. One that arrives after the bell is late, and the paper closes.
  async answer(ctx, body) {
    object(body, ['visitId', 'index', 'attemptId', 'answer']); uuid(body.visitId); uuid(body.attemptId);
    if (!Number.isInteger(body.index) || body.index < 0) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const a = await this.child(tx, ctx); const v = await this.visitOf(tx, a, body.visitId);
      if (v.lastAttempt && v.lastAttempt.id === body.attemptId) return v.lastAttempt.response;
      if (v.status !== 'active') fail(409, 'SESSION_OVER'); const now = this.now();
      if (body.index !== v.index) fail(409, 'STALE_QUESTION');
      const q = v.questions[v.index], blank = body.answer === null, graded = blank ? 'blank' : grade(q, body.answer); if (graded === null) fail(400, 'INVALID_ANSWER');
      const secs = Math.max(0, Math.round((now - v.askedAt) / 1000)), late = now > v.deadline + LATE_MS, r = late ? 'timeout' : graded;
      const given = blank ? null : q.answer.type === 'choice' ? q.display.choices[Number(body.answer)] : q.answer.type === 'frac' ? `${body.answer.n}/${body.answer.d}` : String(body.answer);
      const next = { ...v, results: [...v.results, { r, secs, given: given === null ? null : String(given).slice(0, GIVEN_MAX) }], index: v.index + 1, askedAt: now };
      const done = late || next.index >= next.questions.length, response = { index: v.index, done };
      if (done) { const { result } = await this.settle(tx, a, next, now, late ? 'bell' : 'end', { attemptId: body.attemptId, response }); response.result = result; }
      else { response.question = this.publicQuestion(next, next.index); response.left = Math.max(0, Math.round((v.deadline - now) / 1000)); next.lastAttempt = { id: body.attemptId, response }; tx.set(a.p.session(v.id), next); }
      return response;
    });
  }
  /** The paper handed in: at the bell (`why` 'timeup', which the server checks against its own clock) or early by choice ('handin'); what is unanswered is blank. */
  async finish(ctx, body) {
    object(body, ['visitId', 'why']); uuid(body.visitId); if (!['timeup', 'handin'].includes(body.why)) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const a = await this.child(tx, ctx); const v = await this.visitOf(tx, a, body.visitId);
      if (v.status !== 'active') { if (v.status === 'done' && v.result?.reveal) return { done: true, result: v.result.reveal }; fail(409, 'SESSION_OVER'); } // a retry after the bell closed it answers the same
      const now = this.now(); if (body.why === 'timeup' && now < v.deadline - EARLY_MS) fail(409, 'TIME_LEFT');
      const { result } = await this.settle(tx, a, v, now, body.why === 'timeup' ? 'bell' : 'handin');
      return { done: true, result };
    });
  }
  async quit(ctx, body) {
    object(body, ['visitId']); uuid(body.visitId);
    return this.store.transaction(async (tx) => {
      const a = await this.child(tx, ctx); const { p, prog, family, s } = a; const v = await this.visitOf(tx, a, body.visitId);
      if (v.status !== 'active') return { ok: true, status: v.status }; const now = this.now(), date = dayISO(now, family.timeZone || DEFAULT_TIME_ZONE);
      tx.set(p.session(v.id), { ...v, status: 'quit', finishedAt: now });
      const score = v.results.filter((r) => r.r === 'correct').length, secs = Math.max(0, Math.round((now - v.createdAt) / 1000));
      const row = { id: v.id, ts: now, date, moon: v.moon, phase: v.phase, year: v.year, score, total: v.questions.length, answered: v.results.length, medal: null, tutored: v.tutored === true, rewarded: false, quit: true, secs };
      const key = phaseKey(v.moon, v.phase), pt = { ...freshPhase(), ...(prog.olympia.phases[key] || {}) };
      const phases = { ...prog.olympia.phases, [key]: { ...pt, log: [{ ts: now, date, score, total: v.questions.length, secs, medal: null, tutored: row.tutored, rewarded: false, quit: true }, ...pt.log].slice(0, PHASE_LOG) } };
      tx.set(p.doc, { ...prog, olympia: { ...prog.olympia, activeVisit: prog.olympia.activeVisit === v.id ? null : prog.olympia.activeVisit, phases, history: [row, ...prog.olympia.history].slice(0, HISTORY_MAX) } });
      this.foundation.audit(tx, 'olympia.visit_quit', s.uid, s.familyId, s.childId, { moon: v.moon, phase: v.phase }); return { ok: true, status: 'quit' };
    });
  }
  /**
   * 💡 Explain to me on a moon question (20 Sep 2026): the worked solution the question carries, shown at no cost and with no
   * call to the AI tutor — which stays for the child's follow-up questions where a key is on (server/tutor.mjs). As before, the
   * visit then counts for nothing: it is marked tutored here, before the steps leave the server.
   */
  async explain(ctx, body) {
    object(body, ['visitId', 'index']); uuid(body.visitId); if (!Number.isInteger(body.index) || body.index < 0) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const a = await this.child(tx, ctx); const v = await this.visitOf(tx, a, body.visitId); const now = this.now();
      if (v.status !== 'active') fail(409, 'SESSION_OVER'); if (!isLive(v, now)) fail(409, 'SESSION_EXPIRED'); if (body.index !== v.index) fail(409, 'STALE_QUESTION');
      const q = v.questions[v.index]; if (!q) fail(409, 'SESSION_OVER');
      if (v.tutored !== true) { tx.set(a.p.session(v.id), { ...v, tutored: true, tutoredAt: now }); this.foundation.audit(tx, 'olympia.explained', a.s.uid, a.s.familyId, a.s.childId, { moon: v.moon, phase: v.phase, index: v.index }); }
      return { tutored: true, steps: Array.isArray(q.steps) ? q.steps : [], tip: typeof q.tip === 'string' ? q.tip : null, expected: answerText(q) };
    });
  }
  /** The paper closed, whichever way: scored, the medal paid through the ledger, the phase's log and the moon's tally kept, the session written. */
  async settle(tx, a, v, now, how, attempt = null) {
    const { p, prog, family, s } = a, tz = family.timeZone || DEFAULT_TIME_ZONE;
    const full = { ...v, results: [...v.results, ...v.questions.slice(v.results.length).map(() => ({ r: 'blank', secs: 0, given: null }))] }; // the bell: what is unanswered is blank
    const { progress, result, reward } = this.score(prog, full, now, tz, how);
    let final = progress;
    if (reward.gc || reward.rp || reward.om) final = await post(tx, p.doc, progress, entry({ id: v.id, type: 'olympia.medal', gc: reward.gc, rp: reward.rp, om: reward.om, ref: `${v.moon}:${v.phase}`, note: `${result.medal} ${result.score}/${result.total}`, at: now }));
    result.wallet = final.wallet;
    const closed = { ...full, status: 'done', finishedAt: now, how, result: { score: result.score, medal: result.medal, rewarded: result.rewarded, reveal: result }, ...(attempt ? { lastAttempt: { id: attempt.attemptId, response: { ...attempt.response, result } } } : {}) };
    tx.set(p.session(v.id), closed); tx.set(p.doc, final);
    this.foundation.audit(tx, 'olympia.visit_finished', s.uid, s.familyId, s.childId, { moon: v.moon, phase: v.phase, how, medal: result.medal, rewarded: result.rewarded });
    return { progress: final, result };
  }
  /** Pure: the score, the medal, whether this visit is rewarded, the phase's log and the moon's tally, and the reveal — every question with the answer it wanted and the working. */
  score(value, v, now, tz, how = 'end') {
    const prog = normalizeProgress(value), moon = moonById(v.moon), ph = moon ? phaseById(moon, v.phase) : null, total = v.questions.length, score = v.results.filter((r) => r.r === 'correct').length;
    const medal = medalFor(score, total), date = dayISO(now, tz), key = phaseKey(v.moon, v.phase), days = prog.olympia.rewardDays[key] || {}, paidToday = days.date === date ? days.n : 0;
    const tutored = v.tutored === true, rewarded = Boolean(medal) && !tutored && paidToday < REWARDED_VISITS_PER_DAY;
    const reward = rewarded ? { gc: medal.gc, rp: medal.rp, om: medal.om } : { gc: 0, rp: 0, om: 0 };
    const t = { ...freshMoon(), ...(prog.olympia.moons[v.moon] || {}) }; t.visits++;
    const pt = { ...freshPhase(), ...(prog.olympia.phases[key] || {}) }; pt.visits++;
    if (medal && !tutored) { t[medal.id]++; if (!t.best || RANK[medal.id] > RANK[t.best]) t.best = medal.id; t.bestScore = Math.max(t.bestScore, score); if (!pt.best || RANK[medal.id] > RANK[pt.best]) pt.best = medal.id; }
    if (!tutored) pt.bestScore = Math.max(pt.bestScore, score);
    const secs = Math.max(0, Math.min(v.seconds || Infinity, Math.round((now - v.createdAt) / 1000))); // the clock's reading when the paper closed; never past the bell
    const logRow = { ts: now, date, score, total, secs, medal: tutored ? null : medal?.id || null, tutored, rewarded, quit: false, how };
    pt.log = [logRow, ...pt.log].slice(0, PHASE_LOG);
    const row = { id: v.id, ts: now, date, moon: v.moon, phase: v.phase, year: v.year, score, total, medal: tutored ? null : medal?.id || null, tutored, rewarded, secs, how };
    const progress = { ...prog, olympia: { ...prog.olympia, activeVisit: prog.olympia.activeVisit === v.id ? null : prog.olympia.activeVisit, moons: { ...prog.olympia.moons, [v.moon]: t }, phases: { ...prog.olympia.phases, [key]: pt },
      history: [row, ...prog.olympia.history].slice(0, HISTORY_MAX), rewardDays: { ...prog.olympia.rewardDays, [key]: { date, n: rewarded ? paidToday + 1 : paidToday } } } };
    const at = moon ? moon.phases.findIndex((x) => x.id === v.phase) : -1, nextPh = moon && at >= 0 ? moon.phases[at + 1] || null : null;
    const result = { visitId: v.id, moon: v.moon, moonName: moon?.name || v.moon, emoji: moon?.emoji || '🌑', year: v.year, band: moon ? bandOf(moon, v.year) : null, phase: v.phase, ...(PHASE_NAMES[v.phase] || { name: v.phase, sym: '' }), title: ph?.title || '', marks: ph?.marks ?? null,
      score, total, blank: v.results.filter((r) => r.r === 'blank').length, medal: tutored ? null : medal?.id || null, tutored, rewarded, how, thresholds: thresholds(total),
      trainingRun: !rewarded && !tutored && Boolean(medal), gcEarned: reward.gc, rpEarned: reward.rp, omEarned: reward.om, secs, seconds: v.seconds, medals: { gold: t.gold, silver: t.silver, bronze: t.bronze, merit: t.merit, best: t.best },
      phaseLog: pt.log, next: nextPh ? { id: nextPh.id, ...PHASE_NAMES[nextPh.id], title: nextPh.title } : null,
      questions: v.results.map((r, i) => { const q = v.questions[i]; return { index: i, section: q.section, cat: q.cat, text: q.display.text, r: r.r, expected: answerText(q), given: r.given ?? null, secs: r.secs, steps: Array.isArray(q.steps) ? q.steps : [], ...(q.tip ? { tip: q.tip } : {}) }; }) };
    return { progress, result, reward };
  }
}
