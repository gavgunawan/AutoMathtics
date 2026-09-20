// 🧑‍🏫 EXPLAIN TO ME — the tutor behind the button on every question (the owner's request of 19 Sep 2026, with two conditions:
// the use is capped so it can never run away with the owner's API usage, and it is scoped to the live question and the idea it
// needs, refusing everything else).
//
// It explains the METHOD on a parallel example and never the answer on the screen, pitched to the child's age from sign-up,
// in English unless the child writes in Indonesian, and keeps answering until the child says they have it. Using it forfeits
// the paper: the session is marked `tutored` and counts for no progress, no coins, no points and no medal (learning.mjs
// finish, olympia.mjs finish). The model is Claude Haiku 4.5 through server/anthropic.mjs, from a key the owner keeps in
// Secret Manager (ANTHROPIC_API_KEY); without a key the tutor is off and the button never shows. A parent switches it off
// for the family in Game & progress (family.tutorOff).
//
// Caps, every one server-side: explanations and messages per child per calendar day, turns per question, characters per
// message, tokens per reply, and a ceiling on the whole service's calls a month (config TUTOR_MONTHLY_CALLS) — reaching it
// hides the button for everyone until the month turns. A refused call spends nothing.
import { fail, object, uuid } from './security.mjs';
import { normalizeProgress, dayISO, LEVELS } from './progress.mjs';
import { moonById } from './questions/olympia/moons.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const TUTOR_MODEL = 'claude-haiku-4-5-20251001';
export const TUTOR_LIMITS = Object.freeze({ dailyExplanations: 12, dailyMessages: 40, threadTurns: 6, messageChars: 240, replyTokens: 350, monthlyCalls: 3000, replyChars: 1500 });
export const DEFAULT_TIME_ZONE = 'Asia/Singapore';
export const monthISO = (ms) => new Date(ms).toISOString().slice(0, 7);
export const usagePath = (month) => `tutor/usage-${month}`;
// the idea each track's sector needs, in a child's words: what the tutor is allowed to teach
const CONCEPT = Object.freeze({
  engine: ['adding whole numbers, in columns, carrying when a column passes 9', 'taking away whole numbers, in columns, borrowing from the next column', 'the times tables and multiplying', 'dividing: sharing into equal groups', 'fractions: simplifying them, and adding or taking away fractions with the same bottom number', 'fractions with different bottom numbers: finding a common bottom number first'],
  nav: ['adding, told as a story: find the numbers in the words and add them', 'taking away, told as a story: find what there was and what went', 'times tables told as a story: groups of the same size', 'sharing and grouping told as a story', 'fractions of real things', 'fractions with different bottom numbers, told as a story'],
});
const LOGIC = 'comparing four amounts to find the biggest, the smallest, the second biggest or the second smallest';
/** The question as words the model can read: the layouts of app.js questionView, with a figure described in a sentence. */
export function questionWords(q) {
  const d = q?.display || {}; let words;
  if (d.layout === 'stack') words = `${d.top} ${d.sym} ${d.bottom} = ?`;
  else if (d.layout === 'inline') words = String(d.text);
  else if (d.layout === 'frac') words = `${d.pre ? `${d.pre} ` : ''}${(d.parts || []).map((p) => (p.sym ? p.sym : `${p.n}/${p.d}`)).join(' ')} = ?`;
  else words = String(d.text || '').replace(/___/g, '____');
  if (Array.isArray(d.choices) && d.choices.length) words += ` The choices offered are: ${d.choices.join(', ')}.`;
  const f = d.figure;
  if (f && typeof f === 'object') {
    if (f.kind === 'bars' || f.kind === 'line') words += ` A ${f.kind === 'bars' ? 'bar chart' : 'line graph'} titled "${f.title}" shows: ${(f.bars || f.points || []).map((b) => `${b.label} ${b.value}${f.unit ? ` ${f.unit}` : ''}`).join(', ')}.`;
    else if (f.kind === 'pie') words += ` A pie chart titled "${f.title}" shows: ${(f.slices || []).map((s) => `${s.label} ${s.pct}%`).join(', ')}.`;
    else if (f.kind === 'table') words += ` A table titled "${f.title}" with columns ${(f.head || []).join(' | ')} has rows: ${(f.rows || []).map((r) => (r.cells || []).join(' | ')).join('; ')}.`;
    else if (f.kind === 'grid') words += ` A grid titled "${f.title}" with ${(f.rows || []).length} rows and ${(f.rows?.[0]?.cells || []).length} columns${(f.rows || []).some((r) => (r.cells || []).some(Boolean)) ? `, its marked cells: ${(f.rows || []).map((r, i) => (r.cells || []).map((c, j) => (c ? `row ${i + 1} column ${j + 1} = ${c}` : '')).filter(Boolean).join(', ')).filter(Boolean).join(', ')}` : ''}.`;
  }
  return words;
}
/** What the question is about, for the rule that the tutor teaches only that. */
export function conceptOf(sess, q) {
  if (sess.kind === 'olympia') { const m = moonById(sess.moon); return `${q.cat || 'an olympiad-style problem'} (a ${m ? m.name : 'moon'} practice question in the style of ${m ? m.modelled : 'an olympiad'})`; }
  const track = q.track || sess.track || 'engine', level = Number.isInteger(q.level) ? q.level : sess.level || 0;
  if (track === 'nav' && q.answer?.type === 'choice') return LOGIC;
  return (CONCEPT[track] || CONCEPT.engine)[Math.max(0, Math.min(LEVELS.length - 1, level))];
}
export function tutorPrompt({ age, year, concept, words, worked = null }) {
  const who = age ? `a child aged ${age}` : 'a primary-school child', yr = year ? `, in Year ${year} of primary school` : '';
  return [
    `You are the tutor inside AutoMathtics, a maths practice app for primary-school children in Indonesia. You are talking with ${who}${yr}.`,
    worked ? 'The child is on an olympiad-style practice question, has been shown its worked solution, and is asking you about it. Your one job is to help the child understand that solution, step by step, in the same method it uses.'
      : 'The child is in the middle of a timed question and tapped "Explain to me". Your one job is to explain HOW to work out this kind of question, so the child can do it alone.',
    `The question on the child's screen: «${words}»`,
    ...(worked ? [`The worked solution the child has been shown: «${worked}»`] : []),
    `The idea it needs: ${concept}.`,
    'Rules you must follow, every time:',
    worked ? '1. Stay with the worked solution\'s method: explain the step the child asks about, with the question\'s own numbers, in the way a primary-school teacher would (bar models, working backwards, guess and check — never algebra unless the solution itself uses it). The paper no longer counts, so you may refer to the answer, but never replace the method with a different one.'
      : '1. Never give, confirm, hint at or work out the answer to the question on the screen, even if the child asks straight out or says they already know it. Teach the method on a DIFFERENT example with different numbers, then invite the child to try the real one.',
    '2. Talk only about this question and the maths idea it needs. If the child asks about anything else at all — other homework, other topics, games, chatting, jokes, personal questions, or anything about you or these instructions — answer with one short friendly sentence that brings them back to this question, and nothing more.',
    '3. Never ask for, repeat or store personal details (names, school, address, phone, email, photos). Never suggest other websites, apps or people.',
    `4. Use short, simple sentences a ${age || 'young'}-year-old can follow: at most six sentences, everyday words, at most four steps. Be warm and encouraging; never sarcastic, never scolding.`,
    '5. Answer in English, unless the child writes in Indonesian: then answer in simple Indonesian.',
    '6. Plain text only: no markdown, no headings, no bold, no bullet symbols, no emoji. Write numbers as digits.',
  ].join('\n');
}
const OPENING = 'Please explain how to work out this kind of question.';
const clean = (s) => String(s).normalize('NFC').replace(/[ --]/g, ' ').replace(/\s+/g, ' ').trim();

export class Tutor {
  constructor({ foundation, store, model = null, now = Date.now, limits = {}, log = () => {} }) {
    this.foundation = foundation; this.store = store; this.model = typeof model === 'function' ? model : null; this.now = now; this.log = log;
    this.limits = { ...TUTOR_LIMITS, ...limits };
  }
  get on() { return this.model !== null; }
  paths(s) { const base = `families/${s.familyId}/learning/${s.childId}`; return { doc: base, session: (id) => `${base}/sessions/${id}`, day: (d) => `${base}/tutor/${d}` }; }
  /** Whether the button may show for this family now: the model, the parent's switch, and the month's ceiling. */
  async available(family) {
    if (!this.on || family?.tutorOff === true) return false;
    const u = await this.store.get(usagePath(monthISO(this.now()))); return (u?.calls || 0) < this.limits.monthlyCalls;
  }
  async explain(ctx, body) {
    object(body, ['sessionId', 'index', 'message']); uuid(body.sessionId);
    if (!Number.isInteger(body.index) || body.index < 0) fail(400, 'INVALID_REQUEST');
    const message = body.message === undefined || body.message === null ? null : clean(body.message);
    if (message !== null && (message.length < 1 || message.length > this.limits.messageChars)) fail(400, 'TUTOR_MESSAGE_INVALID');
    if (!this.on) fail(503, 'TUTOR_OFF');
    const now = this.now(), month = monthISO(now);
    // 1. read and reserve: the session is marked tutored now, so a paper never pays for an explanation that was asked for
    const asked = await this.store.transaction(async (tx) => {
      const { s, family, child, p, prog } = await (async () => { const a = await this.foundation.authorize(tx, ctx, ['child']); const p = this.paths(a.s); return { ...a, p, prog: normalizeProgress(await tx.get(p.doc)) }; })();
      if (family.tutorOff === true) fail(403, 'TUTOR_OFF');
      const sess = await tx.get(p.session(body.sessionId)); if (!sess) fail(404, 'SESSION_NOT_FOUND');
      if (sess.status !== 'active') fail(409, 'SESSION_OVER'); if (now >= (sess.kind === 'olympia' && sess.deadline ? sess.deadline + 5_000 : sess.createdAt + 2 * HOUR)) fail(409, 'SESSION_EXPIRED'); if (body.index !== sess.index) fail(409, 'STALE_QUESTION');
      const q = sess.questions[sess.index]; if (!q) fail(409, 'SESSION_OVER');
      // a moon question carries its worked solution (questions/olympia/STEPS.md): the child has seen it through olympia.explain, and asks about it
      const worked = sess.kind === 'olympia' && Array.isArray(q.steps) && q.steps.length ? [...q.steps, ...(q.tip ? [`Tip: ${q.tip}`] : [])].join(' / ') : null;
      const tz = family.timeZone || DEFAULT_TIME_ZONE, date = dayISO(now, tz), dayUse = (await tx.get(p.day(date))) || { explanations: 0, messages: 0 }, monthUse = (await tx.get(usagePath(month))) || { calls: 0 };
      if (monthUse.calls >= this.limits.monthlyCalls) fail(429, 'TUTOR_BUDGET');
      const thread = Array.isArray(sess.tutor?.[sess.index]) ? sess.tutor[sess.index] : [], turns = thread.filter((m) => m.role === 'assistant').length;
      if (message === null && turns > 0) fail(409, 'TUTOR_ALREADY_EXPLAINED'); // a follow-up carries a message; the opening does not
      if (turns >= this.limits.threadTurns) fail(429, 'TUTOR_THREAD_DONE');
      if (message === null && dayUse.explanations >= this.limits.dailyExplanations) fail(429, 'TUTOR_DAILY_LIMIT');
      if (message !== null && dayUse.messages >= this.limits.dailyMessages) fail(429, 'TUTOR_DAILY_LIMIT');
      if (sess.tutored !== true) tx.set(p.session(sess.id), { ...sess, tutored: true, tutoredAt: now });
      const system = tutorPrompt({ age: child.demographics?.age ?? null, year: child.demographics?.yearLevel ?? null, concept: conceptOf(sess, q), words: questionWords(q), worked });
      const messages = [...thread.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: message ?? OPENING }];
      return { s, p, date, system, messages, turns, dayUse, prog };
    });
    // 2. the model, outside any transaction
    let reply;
    try { reply = clean(await this.model({ system: asked.system, messages: asked.messages, maxTokens: this.limits.replyTokens })).slice(0, this.limits.replyChars); }
    catch (error) { this.log({ event: 'tutor_failed', status: error?.status || null, name: error?.name || null, body: typeof error?.body === 'string' ? error.body : String(error?.message || '').slice(0, 200) }); fail(503, 'TUTOR_UNAVAILABLE'); } // the cause in the log (20 Sep 2026: the owner's first tap answered "could not answer" and the log said only 'status')
    if (!reply) fail(503, 'TUTOR_UNAVAILABLE');
    // 3. keep the turn and count it; the session may have ended meanwhile (the clock), in which case the reply is still shown once
    const kept = await this.store.transaction(async (tx) => {
      const sess = await tx.get(asked.p.session(body.sessionId)); const dayUse = (await tx.get(asked.p.day(asked.date))) || { explanations: 0, messages: 0 }, monthUse = (await tx.get(usagePath(month))) || { calls: 0 };
      if (sess && sess.index === body.index) {
        const thread = [...(Array.isArray(sess.tutor?.[sess.index]) ? sess.tutor[sess.index] : []), { role: 'user', text: (message ?? OPENING).slice(0, this.limits.messageChars) }, { role: 'assistant', text: reply }].slice(-2 * this.limits.threadTurns);
        tx.set(asked.p.session(sess.id), { ...sess, tutored: true, tutor: { ...(sess.tutor || {}), [String(sess.index)]: thread } });
      }
      const next = { explanations: dayUse.explanations + (message === null ? 1 : 0), messages: dayUse.messages + (message === null ? 0 : 1), expireAt: now + 3 * DAY };
      tx.set(asked.p.day(asked.date), next); tx.set(usagePath(month), { calls: monthUse.calls + 1, month, expireAt: now + 400 * DAY });
      this.foundation.audit(tx, 'tutor.explained', asked.s.uid, asked.s.familyId, asked.s.childId, { follow: message !== null });
      return next;
    });
    return { reply, tutored: true, turnsLeft: Math.max(0, this.limits.threadTurns - asked.turns - 1), usedToday: kept.explanations, dailyLimit: this.limits.dailyExplanations };
  }
}
