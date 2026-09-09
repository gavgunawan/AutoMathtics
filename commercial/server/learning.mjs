import { randomUUID } from 'node:crypto';
import { fail, object, uuid } from './security.mjs';
import { TRACKS, LEVELS, GC_PASS, RP_PASS, PAPERS_PER_LEVEL, PAPERS_PER_SESSION, normalizeProgress, trk, withTrk, trackDone, bossDue, settleJumps, nextRun, buildQuestions, buildScanQuestions, grade, answerText, bonusesFor, dayISO, weekISO, scanState } from './progress.mjs';
import { applyGameDerived, heatmap } from './game.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const SESSION_LIFE = 2 * HOUR;
const GRACE_MS = 5_000;
const HISTORY_MAX = 60, PASS_DAYS_MAX = 400;
export const DEFAULT_TIME_ZONE = 'Asia/Singapore';

/** Secure learning loop. Browser input is limited to route intent and answer text; the server owns
 * identity, track state, questions, expected answers, clocks, marks, progress and rewards. */
export class Learning {
  constructor({ foundation, store, now = Date.now }) { this.foundation = foundation; this.store = store; this.now = now; }
  paths(s) { const base = `families/${s.familyId}/learning/${s.childId}`; return { doc: base, session: (id) => `${base}/sessions/${id}` }; }
  async child(tx, ctx) {
    const a = await this.foundation.authorize(tx, ctx, ['child']); const p = this.paths(a.s);
    const prog = normalizeProgress(await tx.get(p.doc)); return { ...a, p, prog };
  }
  publicSession(sess) {
    return { id: sess.id, track: sess.track, mode: sess.mode, level: sess.level, levelId: LEVELS[sess.level].id, startPaper: sess.startPaper,
      tierEnd: sess.tierEnd, count: sess.questions.length, index: sess.index, status: sess.status };
  }
  publicQuestion(sess, i) {
    const q = sess.questions[i];
    return q ? { index: i, paper: q.paper, tier: q.tier, level: q.level, levelId: LEVELS[q.level]?.id || '?', seconds: q.seconds, display: q.display, read: q.read, answerType: q.answer.type } : null;
  }
  publicProgress(prog, family) {
    const t = (name) => { const x = trk(prog, name); return { ...x, levelId: LEVELS[x.level].id, done: trackDone(prog, name), bossDue: bossDue(prog, name), next: (() => { const r = nextRun(prog, name); return { mode: r.mode, startPaper: r.startPaper, tierEnd: r.tierEnd }; })() }; };
    const tz = family?.timeZone || DEFAULT_TIME_ZONE;
    return { engine: t('engine'), nav: t('nav'), wallet: prog.wallet, pacePercent: prog.pacePercent, stats: prog.stats, history: prog.history.slice(0, 20),
      scan: scanState(prog, this.now(), tz), heatmap: heatmap(prog) };
  }
  async state(ctx) {
    return this.store.transaction(async (tx) => {
      const { p, prog, family } = await this.child(tx, ctx); const active = prog.activeSession ? await tx.get(p.session(prog.activeSession)) : null;
      const live = active && active.status === 'active' && this.now() < active.createdAt + SESSION_LIFE;
      return { ...this.publicProgress(prog, family), active: live ? { session: this.publicSession(active), question: this.publicQuestion(active, active.index) } : null };
    }, { readOnly: true });
  }
  async start(ctx, body) {
    object(body, ['track', 'mode']); let track = body.track; if (!TRACKS.includes(track)) fail(400, 'INVALID_REQUEST');
    const requestedMode = body.mode === undefined || body.mode === null ? null : body.mode;
    if (requestedMode !== null && requestedMode !== 'scan') fail(400, 'INVALID_REQUEST'); if (requestedMode === 'scan') track = 'engine';
    const id = randomUUID();
    return this.store.transaction(async (tx) => {
      const { p, prog: original, s, family } = await this.child(tx, ctx); const active = original.activeSession ? await tx.get(p.session(original.activeSession)) : null;
      if (active && active.status === 'active' && this.now() < active.createdAt + SESSION_LIFE)
        return { session: this.publicSession(active), question: this.publicQuestion(active, active.index), resumed: true };
      const commitRate = await this.foundation.rateIn(tx, `learning-start:${s.familyId}:${s.childId}`, 20, HOUR);
      const tz = family.timeZone || DEFAULT_TIME_ZONE; const derived = applyGameDerived(original, this.now(), tz); const prog = derived.progress;
      let run, questions;
      if (requestedMode === 'scan') {
        const state = scanState(prog, this.now(), tz); if (!state.available) fail(409, state.unlocked ? 'SCAN_ALREADY_DONE' : 'SCAN_LOCKED');
        run = { mode: 'scan', level: trk(prog, 'engine').level, startPaper: null, tierEnd: null }; questions = buildScanQuestions(run.level, prog.pacePercent / 100);
      } else { run = nextRun(prog, track); questions = buildQuestions(track, run, prog.pacePercent / 100); }
      const now = this.now(), sess = { id, childId: s.childId, track, mode: run.mode, level: run.level, startPaper: run.startPaper, tierEnd: run.tierEnd,
        questions, results: [], index: 0, askedAt: now, status: 'active', createdAt: now, expireAt: now + 24 * HOUR, lastAttempt: null };
      if (active && active.status === 'active') tx.set(p.session(active.id), { ...active, status: 'expired' }); commitRate(); tx.set(p.session(id), sess); tx.set(p.doc, { ...prog, activeSession: id });
      return { session: this.publicSession(sess), question: this.publicQuestion(sess, 0), resumed: false, gameEvents: derived.events };
    });
  }
  async answer(ctx, body) {
    object(body, ['sessionId', 'index', 'attemptId', 'answer']); uuid(body.sessionId); uuid(body.attemptId);
    if (!Number.isInteger(body.index) || body.index < 0) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const { p, prog, family } = await this.child(tx, ctx); const sess = await tx.get(p.session(body.sessionId));
      if (!sess) fail(404, 'SESSION_NOT_FOUND'); if (sess.lastAttempt && sess.lastAttempt.id === body.attemptId) return sess.lastAttempt.response;
      if (sess.status !== 'active') fail(409, 'SESSION_OVER'); const now = this.now(); if (now >= sess.createdAt + SESSION_LIFE) fail(409, 'SESSION_EXPIRED');
      if (body.index !== sess.index) fail(409, 'STALE_QUESTION'); const q = sess.questions[sess.index], graded = grade(q, body.answer); if (graded === null) fail(400, 'INVALID_ANSWER');
      const secs = Math.max(0, Math.round((now - sess.askedAt) / 1000)); const result = now > sess.askedAt + q.seconds * 1000 + GRACE_MS ? 'timeout' : graded;
      const next = { ...sess, results: [...sess.results, { r: result, secs, tier: q.tier, level: q.level, track: q.track || sess.track, allowed: q.seconds }], index: sess.index + 1, askedAt: now };
      const done = next.index >= next.questions.length, response = { result, correct: result === 'correct', expected: answerText(q), index: sess.index };
      if (done) { const { progress, summary } = this.finish(prog, next, now, family.timeZone || DEFAULT_TIME_ZONE); next.status = 'done'; next.finishedAt = now; tx.set(p.doc, progress); response.done = true; response.summary = summary; }
      else response.question = this.publicQuestion(next, next.index);
      next.lastAttempt = { id: body.attemptId, response }; tx.set(p.session(sess.id), next); return response;
    });
  }
  async quit(ctx, body) {
    object(body, ['sessionId']); uuid(body.sessionId);
    return this.store.transaction(async (tx) => {
      const { p, prog, family } = await this.child(tx, ctx); const sess = await tx.get(p.session(body.sessionId)); if (!sess) fail(404, 'SESSION_NOT_FOUND');
      if (sess.status !== 'active') return { ok: true, status: sess.status }; const now = this.now(); tx.set(p.session(sess.id), { ...sess, status: 'quit', finishedAt: now });
      const row = { ts: now, date: dayISO(now, family.timeZone || DEFAULT_TIME_ZONE), track: sess.track, mode: sess.mode, level: sess.level, levelId: LEVELS[sess.level].id,
        papers: this.label(sess), quit: true, atQ: sess.index, total: sess.questions.length };
      tx.set(p.doc, { ...prog, activeSession: prog.activeSession === sess.id ? null : prog.activeSession, history: [row, ...prog.history].slice(0, HISTORY_MAX) }); return { ok: true, status: 'quit' };
    });
  }
  label(sess) {
    if (sess.mode === 'boss') return `CP T${sess.tierEnd / 20}`; if (sess.mode === 'scan') return 'SYSTEM SCAN';
    return `${sess.mode === 'practice' ? 'practice ' : ''}${sess.startPaper}–${sess.startPaper + PAPERS_PER_SESSION - 1}`;
  }
  finish(value, sess, now, timeZone) {
    const prog = normalizeProgress(value), total = sess.questions.length, correct = sess.results.filter((r) => r.r === 'correct').length;
    const timeout = sess.results.filter((r) => r.r === 'timeout').length, incorrect = total - correct - timeout, passed = correct === total, date = dayISO(now, timeZone);
    const row = { ts: now, date, track: sess.track, mode: sess.mode, level: sess.level, levelId: LEVELS[sess.level].id, papers: this.label(sess), correct, incorrect, timeout, total, passed,
      secs: Math.round((now - sess.createdAt) / 1000), qlog: sess.results.map((r) => ({ t: r.tier, l: r.level, track: r.track, s: r.secs, a: r.allowed, ok: r.r === 'correct' ? 1 : 0 })) };
    let np = { ...prog, activeSession: null, history: [row, ...prog.history].slice(0, HISTORY_MAX), stats: { sessions: prog.stats.sessions + 1, passes: prog.stats.passes + (passed ? 1 : 0) }, wallet: { ...prog.wallet } };
    let gcEarned = 0, rpEarned = 0, jumped = [];
    if (passed) {
      const mult = sess.mode === 'boss' || sess.mode === 'scan' ? 2 : 1; gcEarned += GC_PASS * mult; rpEarned += RP_PASS * mult; const cur = trk(np, sess.track);
      if (sess.mode === 'boss') np = withTrk(np, sess.track, { bossCleared: Math.min(5, cur.bossCleared + 1) });
      else if (sess.mode === 'paper') np = withTrk(np, sess.track, { paper: Math.min(sess.startPaper + PAPERS_PER_SESSION, PAPERS_PER_LEVEL + 1) });
      if (sess.mode === 'scan') np.wallet.lastScanWeek = weekISO(now, timeZone);
      else {
        const passDays = [...new Set([...(prog.passDays || []), date])].sort().slice(-PASS_DAYS_MAX); const bonuses = bonusesFor([...passDays, ...(prog.wallet.shieldDays || [])]);
        const newBonuses = Math.max(0, bonuses - (prog.wallet.bonuses || 0)); gcEarned += newBonuses * GC_PASS; rpEarned += newBonuses * RP_PASS; np.passDays = passDays; np.wallet.bonuses = bonuses;
      }
      const settled = settleJumps(np); np = settled.p; jumped = settled.jumped;
    }
    np.wallet.gc = prog.wallet.gc + gcEarned; np.wallet.rp = prog.wallet.rp + rpEarned;
    const derived = applyGameDerived(np, now, timeZone); np = derived.progress;
    const summary = { passed, correct, incorrect, timeout, total, gcEarned: np.wallet.gc - prog.wallet.gc, rpEarned: np.wallet.rp - prog.wallet.rp, wallet: np.wallet,
      track: sess.track, mode: sess.mode, papers: row.papers, gameEvents: derived.events, leveledUp: jumped.includes(sess.track), jumped,
      newLevel: trk(np, sess.track).level, newLevelId: LEVELS[trk(np, sess.track).level].id,
      bossNext: passed && !['boss', 'scan'].includes(sess.mode) && bossDue(np, sess.track), trackNowDone: passed && !jumped.includes(sess.track) && trackDone(np, sess.track) && !trackDone(prog, sess.track) };
    return { progress: np, summary };
  }
}
