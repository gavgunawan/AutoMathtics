// 💡 Explain to me (server/tutor.mjs, 19 Sep 2026): off without a key, on with one; the prompt carries the question, the idea and the
// child's age but never the answer; the paper it was used on counts for nothing; and every cap the owner asked for holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, canonical } from './support.mjs';
import { questionWords, tutorPrompt, conceptOf, TUTOR_LIMITS, monthISO, usagePath } from '../server/tutor.mjs';
import { createModel } from '../server/anthropic.mjs';
import { normalizeProgress } from '../server/progress.mjs';
import { grantEntitlement } from '../server/service.mjs';

const progPath = (k) => `families/${k.p.familyId}/learning/${k.child.id}`;
const sessionPath = (k, id) => `${progPath(k)}/sessions/${id}`;
const DAY = 86_400_000;
const longAccess = (f, k) => grantEntitlement(f.store, { familyId: k.p.familyId, seatLimit: 2, accessUntil: f.now() + 60 * DAY, reason: 'a long pilot', actor: 'test-operator' }, f.now());
const reenter = async (f, k) => { const p = await f.login('parentA'); const sel = await f.service.authenticate(await f.service.lock(p.ctx)); k.childCtx = await f.service.authenticate(await f.service.selectChild(sel, k.child.id, '763829')); };
/** a fake model that remembers what it was asked and answers in kind */
const fakeModel = (reply = 'Look at the ones first. Try 23 + 45: 3 and 5 make 8, then 2 and 4 make 6, so 68. Now try yours!') => { const calls = []; const m = async (req) => { calls.push(req); return typeof reply === 'function' ? reply(req, calls.length) : reply; }; m.calls = calls; return m; };
const withChild = async (f, age = 8, yearLevel = 2) => { const p = await f.family('parentA', 2); const { child } = await f.service.createChild(p.ctx, { nickname: 'Rina', icon: 'fox', pin: '763829', age, yearLevel, start: 'a1' }, randomUUID()); const selCtx = await f.service.authenticate(await f.service.lock(p.ctx)); return { p, child, childCtx: await f.service.authenticate(await f.service.selectChild(selCtx, child.id, '763829')) }; };
async function finishSession(f, k, started) {
  const raw = await f.store.get(sessionPath(k, started.session.id)); let q = started.question, last;
  while (q) { last = await f.learning.answer(k.childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: canonical(raw.questions[q.index]) }); q = last.question || null; }
  return last;
}

test('the question in words for every layout, with its figure, and the prompt: the child\'s age, the idea, the rules, and never the answer', () => {
  assert.equal(questionWords({ display: { layout: 'stack', top: 234, bottom: 189, sym: '+' } }), '234 + 189 = ?');
  assert.equal(questionWords({ display: { layout: 'inline', text: '7 × 8 = ?' } }), '7 × 8 = ?');
  assert.equal(questionWords({ display: { layout: 'frac', pre: 'Simplify:', parts: [{ n: 6, d: 8 }] } }), 'Simplify: 6/8 = ?');
  assert.equal(questionWords({ display: { layout: 'word', text: 'Rina has 5 apples and gets 3 more. How many now?', choices: ['8', '2', '15', '7'] } }), 'Rina has 5 apples and gets 3 more. How many now? The choices offered are: 8, 2, 15, 7.');
  assert.match(questionWords({ display: { layout: 'word', text: 'How many altogether?', figure: { kind: 'bars', title: 'Cans', unit: null, bars: [{ label: 'Mon', value: 4 }, { label: 'Tue', value: 6 }] } } }), /bar chart titled "Cans" shows: Mon 4, Tue 6/);
  assert.match(questionWords({ display: { layout: 'word', text: 'Paths?', figure: { kind: 'grid', title: 'Paths', rows: [{ cells: ['A', ''] }, { cells: ['', 'B'] }] } } }), /grid titled "Paths" with 2 rows and 2 columns, its marked cells: row 1 column 1 = A, row 2 column 2 = B/);
  assert.match(questionWords({ display: { layout: 'word', text: 'Which?', figure: { kind: 'table', title: 'T', head: ['Name', 'Goals'], rows: [{ cells: ['Adi', '3'] }] } } }), /table titled "T" with columns Name \| Goals has rows: Adi \| 3/);
  const system = tutorPrompt({ age: 8, year: 2, concept: 'adding whole numbers, in columns, carrying when a column passes 9', words: '234 + 189 = ?' });
  for (const must of ['a child aged 8', 'Year 2', '«234 + 189 = ?»', 'adding whole numbers, in columns', 'Never give, confirm, hint at or work out the answer', 'DIFFERENT example', 'Talk only about this question', 'Never ask for, repeat or store personal details', 'unless the child writes in Indonesian', 'Plain text only']) assert.ok(system.includes(must), must);
  assert.ok(!system.includes('423'), 'the answer is not in the prompt');
  assert.match(tutorPrompt({ age: null, year: null, concept: 'x', words: 'y' }), /a primary-school child\./);
  assert.equal(conceptOf({ track: 'engine', level: 1 }, { level: 1, track: 'engine', answer: { type: 'int' } }), 'taking away whole numbers, in columns, borrowing from the next column');
  assert.equal(conceptOf({ track: 'nav', level: 0 }, { level: 0, track: 'nav', answer: { type: 'choice' } }), 'comparing four amounts to find the biggest, the smallest, the second biggest or the second smallest');
  assert.match(conceptOf({ kind: 'olympia', moon: 'sea' }, { cat: 'pigeonhole principle' }), /pigeonhole principle \(a SEA-Moon practice question in the style of SEAMO\)/);
  assert.equal(monthISO(Date.parse('2026-09-19T10:00:00Z')), '2026-09'); assert.equal(usagePath('2026-09'), 'tutor/usage-2026-09');
});
test('without a key the tutor is off: no button (/api/me says so), and the route refuses', async () => {
  const f = fixture(), k = await f.childSession();
  assert.equal(f.tutor.on, false); assert.equal(await f.tutor.available(await f.store.get(`families/${k.p.familyId}`)), false);
  const s = await f.learning.start(k.childCtx, { track: 'engine' });
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null }), rejected('TUTOR_OFF'));
});
test('an explanation: the model gets the system prompt with the question and the child\'s age, the session is marked tutored, the reply comes back — and the paper then counts for nothing', async () => {
  const model = fakeModel(), f = fixture({ tutorModel: model }), k = await withChild(f, 8, 2);
  assert.equal(f.tutor.on, true); assert.equal(await f.tutor.available(await f.store.get(`families/${k.p.familyId}`)), true);
  const s = await f.learning.start(k.childCtx, { track: 'engine' }); assert.equal(s.session.tutored, false);
  const r = await f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null });
  assert.equal(r.reply, 'Look at the ones first. Try 23 + 45: 3 and 5 make 8, then 2 and 4 make 6, so 68. Now try yours!'); assert.equal(r.tutored, true); assert.equal(r.turnsLeft, TUTOR_LIMITS.threadTurns - 1); assert.equal(r.usedToday, 1); assert.equal(r.dailyLimit, TUTOR_LIMITS.dailyExplanations);
  assert.equal(model.calls.length, 1); const call = model.calls[0];
  assert.ok(call.system.includes('a child aged 8, in Year 2')); assert.ok(call.system.includes(questionWords((await f.store.get(sessionPath(k, s.session.id))).questions[0]))); assert.equal(call.maxTokens, TUTOR_LIMITS.replyTokens);
  assert.deepEqual(call.messages, [{ role: 'user', content: 'Please explain how to work out this kind of question.' }]);
  const sess = await f.store.get(sessionPath(k, s.session.id)); assert.equal(sess.tutored, true); assert.equal(sess.tutor['0'].length, 2); assert.equal(sess.tutor['0'][1].role, 'assistant');
  assert.equal((await f.learning.state(k.childCtx)).active.session.tutored, true);
  assert.equal((await f.store.get(`${progPath(k)}/tutor/2026-09-06`)).explanations, 1); assert.equal((await f.store.get(usagePath('2026-09'))).calls, 1);
  assert.ok([...f.store.data.entries()].some(([p, v]) => p.startsWith('audit/') && v.action === 'tutor.explained' && v.follow === false));
  // a perfect paper, and it pays nothing and moves nothing
  const last = await finishSession(f, k, s); const sum = last.summary;
  assert.equal(sum.correct, sum.total); assert.equal(sum.passed, true); assert.equal(sum.rewarded, false); assert.equal(sum.tutored, true); assert.deepEqual([sum.gcEarned, sum.rpEarned], [0, 0]);
  const prog = normalizeProgress(await f.store.get(progPath(k)));
  assert.equal(prog.engine.paper, 1, 'the paper did not advance'); assert.equal(prog.stats.passes, 0); assert.deepEqual(prog.passDays, []); assert.equal(prog.wallet.gc, 0); assert.equal(prog.history[0].tutored, true); assert.equal(prog.history[0].passed, true, 'the score is kept');
  assert.equal([...f.store.data.keys()].filter((p) => p.includes('/ledger/')).length, 0);
});
test('follow-ups carry the thread, the turns run out at the cap, and the message is bounded', async () => {
  const model = fakeModel((req, n) => `reply ${n}`), f = fixture({ tutorModel: model, tutorLimits: { threadTurns: 3 } }), k = await withChild(f);
  const s = await f.learning.start(k.childCtx, { track: 'nav' });
  const first = await f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null }); assert.equal(first.turnsLeft, 2);
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null }), rejected('TUTOR_ALREADY_EXPLAINED'));
  const second = await f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: '  What does   carrying mean? ' }); assert.equal(second.turnsLeft, 1);
  assert.deepEqual(model.calls[1].messages.map((m) => m.role), ['user', 'assistant', 'user']); assert.equal(model.calls[1].messages[2].content, 'What does carrying mean?');
  const third = await f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: 'and then?' }); assert.equal(third.turnsLeft, 0);
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: 'more?' }), rejected('TUTOR_THREAD_DONE'));
  assert.equal(model.calls.length, 3);
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: 'x'.repeat(241) }), rejected('TUTOR_MESSAGE_INVALID'));
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: '   ' }), rejected('TUTOR_MESSAGE_INVALID'));
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 1, message: null }), rejected('STALE_QUESTION'));
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: randomUUID(), index: 0, message: null }), rejected('SESSION_NOT_FOUND'));
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null, extra: 1 }), rejected('INVALID_REQUEST'));
  const sess = await f.store.get(sessionPath(k, s.session.id)); assert.equal(sess.tutor['0'].length, 6); assert.equal((await f.store.get(`${progPath(k)}/tutor/2026-09-06`)).messages, 2);
});
test('the caps: a child\'s explanations a day, and the whole service\'s calls a month — at the ceiling the button hides and a refusal spends nothing', async () => {
  const model = fakeModel(), f = fixture({ tutorModel: model, tutorLimits: { dailyExplanations: 1, monthlyCalls: 3 } }), k = await withChild(f);
  const s = await f.learning.start(k.childCtx, { track: 'engine' }); const raw = await f.store.get(sessionPath(k, s.session.id));
  await f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null });
  const next = await f.learning.answer(k.childCtx, { sessionId: s.session.id, index: 0, attemptId: randomUUID(), answer: canonical(raw.questions[0]) });
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: next.question.index, message: null }), rejected('TUTOR_DAILY_LIMIT'));
  assert.equal(model.calls.length, 1, 'a refusal never reaches the model');
  await f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: next.question.index, message: 'a follow-up on the first?' }); // messages have their own cap
  f.advance(86_400_000); await longAccess(f, k); await reenter(f, k); // a new day: the pilot grant, the child's session and the paper have all run out
  const s2 = await f.learning.start(k.childCtx, { track: 'engine' });
  await f.tutor.explain(k.childCtx, { sessionId: s2.session.id, index: 0, message: null }); // the third call of the month
  assert.equal((await f.store.get(usagePath('2026-09'))).calls, 3);
  assert.equal(await f.tutor.available(await f.store.get(`families/${k.p.familyId}`)), false, 'the month\'s ceiling: the button goes');
  f.advance(86_400_000); await reenter(f, k);
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s2.session.id, index: 0, message: 'again?' }), rejected('SESSION_EXPIRED'), 'the old paper has run out');
  const s3 = await f.learning.start(k.childCtx, { track: 'engine' }); // which retires it, and opens a fresh one
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s3.session.id, index: 0, message: null }), rejected('TUTOR_BUDGET'));
  assert.equal(model.calls.length, 3);
});
test('the parent\'s switch turns the tutor off for the family; a failed model call is TUTOR_UNAVAILABLE and counts for nothing', async () => {
  let fail = false; const model = fakeModel(() => { if (fail) { const e = Error('boom'); e.status = 529; throw e; } return 'ok'; });
  const f = fixture({ tutorModel: model }), k = await withChild(f);
  const s = await f.learning.start(k.childCtx, { track: 'engine' });
  fail = true; await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null }), rejected('TUTOR_UNAVAILABLE'));
  assert.equal(await f.store.get(usagePath('2026-09')), null, 'nothing counted'); assert.equal((await f.store.get(sessionPath(k, s.session.id))).tutored, true, 'but the paper is practice from the tap');
  fail = false; f.advance(2000); const p = await f.login('parentA'); await f.game.settings(p.ctx, { tutorOff: true });
  assert.equal(await f.tutor.available(await f.store.get(`families/${k.p.familyId}`)), false);
  await assert.rejects(f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null }), rejected('TUTOR_OFF'));
  await f.game.settings(p.ctx, { tutorOff: false }); assert.equal((await f.tutor.explain(k.childCtx, { sessionId: s.session.id, index: 0, message: null })).reply, 'ok');
});
test('the model client: one call to the Messages API with the key in its header, the text joined, an error status thrown', async () => {
  const seen = []; const fetchFn = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there.' }] }) }; };
  const model = createModel({ apiKey: 'sk-ant-test-key-000000000000000000', fetchFn });
  assert.equal(await model({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 50 }), 'Hello there.');
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages'); assert.equal(seen[0].init.headers['x-api-key'], 'sk-ant-test-key-000000000000000000'); assert.equal(seen[0].init.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(JSON.parse(seen[0].init.body), { model: 'claude-haiku-4-5-20251001', max_tokens: 50, system: 'S', messages: [{ role: 'user', content: 'U' }] });
  const bad = createModel({ apiKey: 'sk-ant-test-key-000000000000000000', fetchFn: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(bad({ system: 'S', messages: [], maxTokens: 1 }), (e) => e.status === 429);
  assert.throws(() => createModel({ apiKey: '' }));
});
