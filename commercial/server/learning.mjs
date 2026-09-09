import { randomUUID } from 'node:crypto';
import { fail, object, uuid } from './security.mjs';
import { TRACKS, LEVELS, GC_PASS, RP_PASS, PAPERS_PER_LEVEL, PAPERS_PER_SESSION, freshProgress, trk, withTrk, trackDone, bossDue, settleJumps, nextRun, buildQuestions, grade, answerText, bonusesFor, dayISO } from './progress.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const SESSION_LIFE = 2 * HOUR;     // a session left open this long is abandoned
const GRACE_MS = 5_000;            // network slack on the per-question clock
const HISTORY_MAX = 60, PASS_DAYS_MAX = 400, PASS_DAY_BONUS = 400;
export const DEFAULT_TIME_ZONE = 'Asia/Singapore';

/**
 * The learning engine behind the child session. Every method runs inside one transaction that
 * re-reads authorization through Foundation.authorize (child role: active, entitled, current PIN
 * version), so a revoked child, a lapsed family or a stale cookie cannot start, answer or quit.
 * Questions are generated and graded here; the browser only ever sees a display and says what
 * it typed. Progress and coins are written in the same transaction as the answer that earns them,
 * keyed by the session and attempt ids so a retried request cannot count twice.
 */
export class Learning {
  constructor({ foundation, store, now = Date.now }) { this.foundation = foundation; this.store = store; this.now = now; }
  paths(s) { const base = `families/${s.familyId}/learning/${s.childId}`; return { doc: base, session: (id) => `${base}/sessions/${id}` }; }
  async child(tx, ctx) {
    const a = await this.foundation.authorize(tx, ctx, ['child']);
    const p = this.paths(a.s);
    const prog = (await tx.get(p.doc)) || freshProgress();
    return { ...a, p, prog };
  }
  publicSession(sess) {
    return { id: sess.id, track: sess.track, mode: sess.mode, level: sess.level, levelId: LEVELS[sess.level].id, startPaper: sess.startPaper,
      tierEnd: sess.tierEnd, count: sess.questions.length, index: sess.index, status: sess.status };
  }
  publicQuestion(sess, i) {
    const q = sess.questions[i];
    return q ? { index: i, paper: q.paper, tier: q.tier, seconds: q.seconds, display: q.display, read: q.read, answerType: q.answer.type } : null;
  }
  publicProgress(prog) {
    const t = (name) => { const x = trk(prog, name); return { ...x, levelId: LEVELS[x.level].id, done: trackDone(prog, name), bossDue: bossDue(prog, name), next: (() => { const r = nextRun(prog, name); return { mode: r.mode, startPaper: r.startPaper, tierEnd: r.tierEnd }; })() }; };
    return { engine: t('engine'), nav: t('nav'), wallet: prog.wallet, stats: prog.stats, history: prog.history.slice(0, 20) };
  }
  async state(ctx) {
    return this.store.transaction(async (tx) => {
      const { p, prog } = await this.child(tx, ctx);
      const active = prog.activeSession ? await tx.get(p.session(prog.activeSession)) : null;
      const live = active && active.status === 'active' && this.now() < active.createdAt + SESSION_LIFE;
      return { ...this.publicProgress(prog), active: live ? { session: this.publicSession(active), question: this.publicQuestion(active, active.index) } : null };
    }, { readOnly: true });
  }
  async start(ctx, body) {
    object(body, ['track']);
    const track = body.track;
    if (!TRACKS.includes(track)) fail(400, 'INVALID_REQUEST');
    const id = randomUUID();
    return this.store.transaction(async (tx) => {
      const { p, prog } = await this.child(tx, ctx);
      const active = prog.activeSession ? await tx.get(p.session(prog.activeSession)) : null;
      if (active && active.status === 'active') {
        if (this.now() < active.createdAt + SESSION_LIFE) return { session: this.publicSession(active), question: this.publicQuestion(active, active.index), resumed: true };
        tx.set(p.session(active.id), { ...active, status: 'expired' });
      }
      const run = nextRun(prog, track);
      const now = this.now();
      const sess = { id, childId: p.doc.split('/').pop(), track, mode: run.mode, level: run.level, startPaper: run.startPaper, tierEnd: run.tierEnd,
        questions: buildQuestions(track, run), results: [], index: 0, askedAt: now, status: 'active', createdAt: now, expireAt: now + 24 * HOUR, lastAttempt: null };
      tx.set(p.session(id), sess);
      tx.set(p.doc, { ...prog, activeSession: id });
      return { session: this.publicSession(sess), question: this.publicQuestion(sess, 0), resumed: false };
    });
  }
  async answer(ctx, body) {
    object(body, ['sessionId', 'index', 'attemptId', 'answer']);
    uuid(body.sessionId); uuid(body.attemptId);
    if (!Number.isInteger(body.index) || body.index < 0) fail(400, 'INVALID_REQUEST');
    return this.store.transaction(async (tx) => {
      const { p, prog, family } = await this.child(tx, ctx);
      const sess = await tx.get(p.session(body.sessionId));
      if (!sess) fail(404, 'SESSION_NOT_FOUND');
      if (sess.lastAttempt && sess.lastAttempt.id === body.attemptId) return sess.lastAttempt.response; // a retried request counts once
      if (sess.status !== 'active') fail(409, 'SESSION_OVER');
      const now = this.now();
      if (now >= sess.createdAt + SESSION_LIFE) fail(409, 'SESSION_EXPIRED'); // start() retires it and opens a new one
      if (body.index !== sess.index) fail(409, 'STALE_QUESTION');
      const q = sess.questions[sess.index];
      const graded = grade(q, body.answer);
      if (graded === null) fail(400, 'INVALID_ANSWER');
      const secs = Math.max(0, Math.round((now - sess.askedAt) / 1000));
      const result = now > sess.askedAt + q.seconds * 1000 + GRACE_MS ? 'timeout' : graded;
      const next = { ...sess, results: [...sess.results, { r: result, secs, tier: q.tier }], index: sess.index + 1, askedAt: now };
      const done = next.index >= next.questions.length;
      const response = { result, correct: result === 'correct', expected: answerText(q), index: sess.index };
      if (done) {
        const { progress, summary } = this.finish(prog, next, now, family.timeZone || DEFAULT_TIME_ZONE);
        next.status = 'done'; next.finishedAt = now;
        tx.set(p.doc, progress);
        response.done = true; response.summary = summary;
      } else {
        response.question = this.publicQuestion(next, next.index);
      }
      next.lastAttempt = { id: body.attemptId, response };
      tx.set(p.session(sess.id), next);
      return response;
    });
  }
  async quit(ctx, body) {
    object(body, ['sessionId']); uuid(body.sessionId);
    return this.store.transaction(async (tx) => {
      const { p, prog, family } = await this.child(tx, ctx);
      const sess = await tx.get(p.session(body.sessionId));
      if (!sess) fail(404, 'SESSION_NOT_FOUND');
      if (sess.status !== 'active') return { ok: true, status: sess.status };
      const now = this.now();
      tx.set(p.session(sess.id), { ...sess, status: 'quit', finishedAt: now });
      const row = { ts: now, date: dayISO(now, family.timeZone || DEFAULT_TIME_ZONE), track: sess.track, mode: sess.mode, level: sess.level, levelId: LEVELS[sess.level].id,
        papers: this.label(sess), quit: true, atQ: sess.index, total: sess.questions.length };
      tx.set(p.doc, { ...prog, activeSession: prog.activeSession === sess.id ? null : prog.activeSession, history: [row, ...prog.history].slice(0, HISTORY_MAX) });
      return { ok: true, status: 'quit' };
    });
  }
  label(sess) {
    if (sess.mode === 'boss') return `CP T${sess.tierEnd / 20}`;
    return `${sess.mode === 'practice' ? 'practice ' : ''}${sess.startPaper}–${sess.startPaper + PAPERS_PER_SESSION - 1}`;
  }
  // Session over: one history row, and — on a clean sheet — paper or crown, coins, streak bonus, jump.
  finish(prog, sess, now, timeZone) {
    const total = sess.questions.length;
    const correct = sess.results.filter((r) => r.r === 'correct').length;
    const timeout = sess.results.filter((r) => r.r === 'timeout').length;
    const incorrect = total - correct - timeout;
    const passed = correct === total;
    const date = dayISO(now, timeZone);
    const row = { ts: now, date, track: sess.track, mode: sess.mode, level: sess.level, levelId: LEVELS[sess.level].id, papers: this.label(sess),
      // Firestore forbids arrays nested in arrays, so the per-question log is a list of objects, not v2's triples.
      correct, incorrect, timeout, total, passed, secs: Math.round((now - sess.createdAt) / 1000), qlog: sess.results.map((r) => ({ t: r.tier, s: r.secs, ok: r.r === 'correct' ? 1 : 0 })) };
    let np = { ...prog, activeSession: null, history: [row, ...prog.history].slice(0, HISTORY_MAX),
      stats: { sessions: (prog.stats?.sessions || 0) + 1, passes: (prog.stats?.passes || 0) + (passed ? 1 : 0) }, wallet: { ...prog.wallet } };
    let gcEarned = 0, rpEarned = 0, jumped = [];
    // A finished sector's practice runs are unpaid and count for no streak: passing the same papers
    // again while the other track catches up must not become a way to farm coins.
    const rewarded = passed && sess.mode !== 'practice';
    if (passed) {
      const cur = trk(np, sess.track);
      if (sess.mode === 'boss') np = withTrk(np, sess.track, { bossCleared: Math.min(5, cur.bossCleared + 1) });
      else if (sess.mode === 'paper') np = withTrk(np, sess.track, { paper: Math.min(sess.startPaper + PAPERS_PER_SESSION, PAPERS_PER_LEVEL + 1) });
      const settled = settleJumps(np); np = settled.p; jumped = settled.jumped;
    }
    if (rewarded) {
      const mult = sess.mode === 'boss' ? 2 : 1;
      gcEarned += GC_PASS * mult; rpEarned += RP_PASS * mult;
      const passDays = [...new Set([...(prog.passDays || []), date])].sort().slice(-PASS_DAYS_MAX);
      const bonuses = bonusesFor(passDays);
      const newBonuses = Math.max(0, bonuses - (prog.wallet.bonuses || 0));
      gcEarned += newBonuses * GC_PASS; rpEarned += newBonuses * RP_PASS;
      np.passDays = passDays; np.wallet.bonuses = bonuses;
    }
    np.wallet.gc = (prog.wallet.gc || 0) + gcEarned; np.wallet.rp = (prog.wallet.rp || 0) + rpEarned;
    const summary = { passed, rewarded, correct, incorrect, timeout, total, gcEarned, rpEarned, wallet: np.wallet, track: sess.track, mode: sess.mode, papers: row.papers,
      leveledUp: jumped.includes(sess.track), jumped, newLevel: trk(np, sess.track).level, newLevelId: LEVELS[trk(np, sess.track).level].id,
      bossNext: passed && sess.mode !== 'boss' && bossDue(np, sess.track), trackNowDone: passed && !jumped.includes(sess.track) && trackDone(np, sess.track) && !trackDone(prog, sess.track) };
    return { progress: np, summary };
  }
}
