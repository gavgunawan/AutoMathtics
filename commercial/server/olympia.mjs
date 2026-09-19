// 🪐 OLYMPIA — the olympiad practice world behind the kids' page's "Gateway jump" (the owner's request of 19 Sep 2026).
//
// Eight moons named for places, each modelled on one olympiad and none affiliated with it (questions/olympia/moons.mjs). A
// visit is a ten-question heat in that moon's real shape, the child's year picking the band: the year from sign-up, or the
// sector reached on either track when that is further, since the app advances a child past school (the owner, 19 Sep 2026:
// a child who has unlocked Sector B is a Year 2 wherever the school has them). Unlike the two
// tracks there are no streaks and no feedback as the child goes: every right and wrong — the final score — is revealed only
// at the end, as a competition does. Medals on the real-world thresholds pay Grid Coins, Reward Points and Olyminerals, the
// currency only Olympia's shop takes; at most two visits a moon a day are rewarded, later ones are training runs. A visit on
// which the child used "Explain to me" counts for nothing — no medal, no reward (the owner's rule). Olympia is a separately
// charged subscription: open during the opening free trial and on a pilot grant, otherwise it needs the Olympia pass a
// family carries (`family.olympia`, set by scripts/olympia-pass.mjs until payments open).
import { randomUUID } from 'node:crypto';
import { Fault, fail, object, uuid, text, YEAR_LEVELS } from './security.mjs';
import { normalizeProgress, grade, answerText, dayISO, trk, TRACKS, LEVELS } from './progress.mjs';
import { effectiveEntitlement } from './subscription.mjs';
import { entry, post } from './ledger.mjs';
import { MOONS, moonById, moonPublic, bandOf, buildVisit, HEAT_QUESTIONS } from './questions/olympia/moons.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const VISIT_LIFE = 2 * HOUR, GRACE_MS = 5_000, STARTS_PER_HOUR = 30, HISTORY_MAX = 30, GIVEN_MAX = 16;
const AUDIT_RETENTION_MS = 400 * DAY;
export const MEDALS = Object.freeze([
  Object.freeze({ id: 'gold', min: 8, gc: 50, rp: 100, om: 30 }), Object.freeze({ id: 'silver', min: 6, gc: 30, rp: 60, om: 20 }),
  Object.freeze({ id: 'bronze', min: 4, gc: 20, rp: 40, om: 10 }), Object.freeze({ id: 'merit', min: 2, gc: 0, rp: 0, om: 5 })]);
export const REWARDED_VISITS_PER_DAY = 2;
export const DEFAULT_TIME_ZONE = 'Asia/Singapore';
export const medalFor = (score) => MEDALS.find((m) => score >= m.min) || null;
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
export const medalTally = (prog) => Object.values(prog.olympia?.moons || {}).reduce((a, m) => a + (m.gold || 0) + (m.silver || 0) + (m.bronze || 0), 0);

export class Olympia {
  constructor({ foundation, store, now = Date.now }) { this.foundation = foundation; this.store = store; this.now = now; }
  paths(s) { const base = `families/${s.familyId}/learning/${s.childId}`; return { doc: base, session: (id) => `${base}/sessions/${id}` }; }
  async child(tx, ctx) { const a = await this.foundation.authorize(tx, ctx, ['child']); const p = this.paths(a.s); return { ...a, p, prog: normalizeProgress(await tx.get(p.doc)) }; }
  publicVisit(v) { const m = moonById(v.moon); return { id: v.id, moon: v.moon, moonName: m?.name || v.moon, emoji: m?.emoji || '🌑', year: v.year, band: m ? bandOf(m, v.year) : null, count: v.questions.length, index: v.index, status: v.status, tutored: v.tutored === true }; }
  publicQuestion(v, i) { const q = v.questions[i]; return q ? { index: i, moon: v.moon, section: q.section, cat: q.cat, seconds: q.seconds, display: q.display, read: q.read, answerType: q.answer.type } : null; }
  moonsFor(prog, year, date) {
    return MOONS.map((m) => {
      const t = { ...freshMoon(), ...(prog.olympia.moons[m.id] || {}) }, days = prog.olympia.rewardDays[m.id] || {};
      const available = m.open && year >= m.years[0] && year <= m.years[1];
      return { ...moonPublic(m), available, why: !m.open ? 'soon' : year < m.years[0] ? `opens at Year ${m.years[0]}` : null, band: bandOf(m, year),
        medals: { gold: t.gold, silver: t.silver, bronze: t.bronze, merit: t.merit }, visits: t.visits, best: t.best, bestScore: t.bestScore, rewardedToday: days.date === date ? days.n : 0, rewardedPerDay: REWARDED_VISITS_PER_DAY };
    });
  }
  async state(ctx) {
    return this.store.transaction(async (tx) => {
      const { p, prog, family, child } = await this.child(tx, ctx); const now = this.now(), tz = family.timeZone || DEFAULT_TIME_ZONE, year = yearOf(child, prog);
      const active = prog.olympia.activeVisit ? await tx.get(p.session(prog.olympia.activeVisit)) : null;
      const live = active && active.status === 'active' && now < active.createdAt + VISIT_LIFE;
      return { access: olympiaAccess(family, now), year, ...yearFrom(child, prog), minerals: prog.wallet.om, medals: MEDALS.map((m) => ({ id: m.id, min: m.min, gc: m.gc, rp: m.rp, om: m.om })), heat: HEAT_QUESTIONS,
        moons: this.moonsFor(prog, year, dayISO(now, tz)), history: prog.olympia.history.slice(0, 12), medalCount: medalTally(prog),
        active: live ? { visit: this.publicVisit(active), question: this.publicQuestion(active, active.index) } : null };
    }, { readOnly: true });
  }
  async start(ctx, body) {
    object(body, ['moon']); const moon = moonById(typeof body.moon === 'string' ? body.moon : ''); if (!moon) fail(400, 'INVALID_REQUEST');
    const id = randomUUID();
    return this.store.transaction(async (tx) => {
      const { p, prog, s, family, child } = await this.child(tx, ctx); const now = this.now();
      if (!olympiaAccess(family, now).open) fail(403, 'OLYMPIA_LOCKED');
      const active = prog.olympia.activeVisit ? await tx.get(p.session(prog.olympia.activeVisit)) : null;
      if (active && active.status === 'active' && now < active.createdAt + VISIT_LIFE) return { visit: this.publicVisit(active), question: this.publicQuestion(active, active.index), resumed: true };
      const year = yearOf(child, prog);
      if (!moon.open) fail(409, 'MOON_NOT_OPEN'); if (year < moon.years[0] || year > moon.years[1]) fail(409, 'MOON_NOT_FOR_YEAR');
      const commitRate = await this.foundation.rateIn(tx, `olympia-start:${s.familyId}:${s.childId}`, STARTS_PER_HOUR, HOUR)
        .catch((e) => { if (e instanceof Fault && e.code === 'TOO_MANY_ATTEMPTS') fail(429, 'TOO_MANY_PAPERS'); throw e; });
      const pace = prog.pacePercent / 100;
      const questions = buildVisit(moon, year).map((q) => ({ ...q, seconds: Math.max(30, Math.round(moon.seconds * pace)) }));
      const visit = { id, kind: 'olympia', childId: s.childId, moon: moon.id, year, questions, results: [], index: 0, askedAt: now, status: 'active', tutored: false, createdAt: now, expireAt: now + 24 * HOUR, lastAttempt: null };
      if (active && active.status === 'active') tx.set(p.session(active.id), { ...active, status: 'expired' }); // left open past its two hours: no score, no reward
      commitRate(); tx.set(p.session(id), visit); tx.set(p.doc, { ...prog, olympia: { ...prog.olympia, activeVisit: id } });
      this.foundation.audit(tx, 'olympia.visit_started', s.uid, s.familyId, s.childId, { moon: moon.id });
      return { visit: this.publicVisit(visit), question: this.publicQuestion(visit, 0), resumed: false };
    });
  }
  // An answer is marked and kept, and nothing is said about it until the paper ends: the reply carries the next question only.
  async answer(ctx, body) {
    object(body, ['visitId', 'index', 'attemptId', 'answer']); uuid(body.visitId); uuid(body.attemptId);
    if (!Number.isInteger(body.index) || body.index < 0) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const { p, prog, family, s } = await this.child(tx, ctx); const v = await tx.get(p.session(body.visitId));
      if (!v || v.kind !== 'olympia') fail(404, 'SESSION_NOT_FOUND'); if (v.lastAttempt && v.lastAttempt.id === body.attemptId) return v.lastAttempt.response;
      if (v.status !== 'active') fail(409, 'SESSION_OVER'); const now = this.now(); if (now >= v.createdAt + VISIT_LIFE) fail(409, 'SESSION_EXPIRED');
      if (body.index !== v.index) fail(409, 'STALE_QUESTION');
      const q = v.questions[v.index], graded = grade(q, body.answer); if (graded === null) fail(400, 'INVALID_ANSWER');
      const secs = Math.max(0, Math.round((now - v.askedAt) / 1000)), r = now > v.askedAt + q.seconds * 1000 + GRACE_MS ? 'timeout' : graded;
      const given = q.answer.type === 'choice' ? q.display.choices[Number(body.answer)] : q.answer.type === 'frac' ? `${body.answer.n}/${body.answer.d}` : String(body.answer);
      const next = { ...v, results: [...v.results, { r, secs, allowed: q.seconds, given: String(given).slice(0, GIVEN_MAX) }], index: v.index + 1, askedAt: now };
      const done = next.index >= next.questions.length, response = { index: v.index, done };
      if (done) {
        const tz = family.timeZone || DEFAULT_TIME_ZONE, { progress, result, reward } = this.finish(prog, next, now, tz);
        let final = progress;
        if (reward.gc || reward.rp || reward.om) final = await post(tx, p.doc, progress, entry({ id: v.id, type: 'olympia.medal', gc: reward.gc, rp: reward.rp, om: reward.om, ref: v.moon, note: `${result.medal} ${result.score}/${result.total}`, at: now }));
        result.wallet = final.wallet; response.result = result;
        next.status = 'done'; next.finishedAt = now; next.result = { score: result.score, medal: result.medal, rewarded: result.rewarded }; tx.set(p.doc, final);
        this.foundation.audit(tx, 'olympia.visit_finished', s.uid, s.familyId, s.childId, { moon: v.moon, medal: result.medal, rewarded: result.rewarded });
      } else response.question = this.publicQuestion(next, next.index);
      next.lastAttempt = { id: body.attemptId, response }; tx.set(p.session(v.id), next); return response;
    });
  }
  async quit(ctx, body) {
    object(body, ['visitId']); uuid(body.visitId);
    return this.store.transaction(async (tx) => {
      const { p, prog, family, s } = await this.child(tx, ctx); const v = await tx.get(p.session(body.visitId)); if (!v || v.kind !== 'olympia') fail(404, 'SESSION_NOT_FOUND');
      if (v.status !== 'active') return { ok: true, status: v.status }; const now = this.now();
      tx.set(p.session(v.id), { ...v, status: 'quit', finishedAt: now });
      const row = { id: v.id, ts: now, date: dayISO(now, family.timeZone || DEFAULT_TIME_ZONE), moon: v.moon, year: v.year, score: v.results.filter((r) => r.r === 'correct').length, total: v.questions.length, answered: v.results.length, medal: null, tutored: v.tutored === true, rewarded: false, quit: true };
      tx.set(p.doc, { ...prog, olympia: { ...prog.olympia, activeVisit: prog.olympia.activeVisit === v.id ? null : prog.olympia.activeVisit, history: [row, ...prog.olympia.history].slice(0, HISTORY_MAX) } });
      this.foundation.audit(tx, 'olympia.visit_quit', s.uid, s.familyId, s.childId, { moon: v.moon }); return { ok: true, status: 'quit' };
    });
  }
  /** Pure: the score, the medal, whether this visit is rewarded, the tally, and the reveal — every question with the answer it wanted. */
  finish(value, v, now, tz) {
    const prog = normalizeProgress(value), moon = moonById(v.moon), total = v.questions.length, score = v.results.filter((r) => r.r === 'correct').length;
    const medal = medalFor(score), date = dayISO(now, tz), days = prog.olympia.rewardDays[v.moon] || {}, paidToday = days.date === date ? days.n : 0;
    const tutored = v.tutored === true, rewarded = Boolean(medal) && !tutored && paidToday < REWARDED_VISITS_PER_DAY;
    const reward = rewarded ? { gc: medal.gc, rp: medal.rp, om: medal.om } : { gc: 0, rp: 0, om: 0 };
    const t = { ...freshMoon(), ...(prog.olympia.moons[v.moon] || {}) }; t.visits++;
    if (medal && !tutored) { t[medal.id]++; if (!t.best || RANK[medal.id] > RANK[t.best]) t.best = medal.id; t.bestScore = Math.max(t.bestScore, score); }
    const secs = Math.max(0, Math.round((now - v.createdAt) / 1000));
    const row = { id: v.id, ts: now, date, moon: v.moon, year: v.year, score, total, medal: tutored ? null : medal?.id || null, tutored, rewarded, secs };
    const progress = { ...prog, olympia: { ...prog.olympia, activeVisit: prog.olympia.activeVisit === v.id ? null : prog.olympia.activeVisit, moons: { ...prog.olympia.moons, [v.moon]: t },
      history: [row, ...prog.olympia.history].slice(0, HISTORY_MAX), rewardDays: { ...prog.olympia.rewardDays, [v.moon]: { date, n: rewarded ? paidToday + 1 : paidToday } } } };
    const result = { visitId: v.id, moon: v.moon, moonName: moon?.name || v.moon, emoji: moon?.emoji || '🌑', year: v.year, band: moon ? bandOf(moon, v.year) : null, score, total, medal: tutored ? null : medal?.id || null, tutored, rewarded,
      trainingRun: !rewarded && !tutored && Boolean(medal), gcEarned: reward.gc, rpEarned: reward.rp, omEarned: reward.om, secs, medals: { gold: t.gold, silver: t.silver, bronze: t.bronze, merit: t.merit, best: t.best },
      questions: v.results.map((r, i) => ({ index: i, section: v.questions[i].section, cat: v.questions[i].cat, r: r.r, expected: answerText(v.questions[i]), given: r.given ?? null, secs: r.secs })) };
    return { progress, result, reward };
  }
}
