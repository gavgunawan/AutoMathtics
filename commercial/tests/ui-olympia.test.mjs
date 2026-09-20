// 🪐 Olympia and 💡 Explain to me on the kids' page (19–20 Sep 2026): the Gateway tile and the third wallet tile, the hub's moons
// with their three phases, a phase on its own clock that says nothing until the reveal with the working, the moon wares, the
// worked solution behind Explain to me on a moon question and the tutor's warning and reply on a track paper, and the parent's switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture, nodes } from './ui-support.mjs';
import { bootstrap, entry, post } from '../server/ledger.mjs';
import { normalizeProgress, answerText } from '../server/progress.mjs';
import { canonical } from './support.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const learning = (h, kid) => `families/${h.a.familyId}/learning/${kid.id}`;
async function kidIn(t, opts = {}) {
  const h = await uiFixture(t, { recordBodies: ['/api/olympia/answer', '/api/olympia/explain', '/api/tutor/explain', '/api/game/parent/settings'], ...opts });
  const kid = (await h.f.service.createChild(h.a.ctx, { nickname: 'Allison', icon: 'fox', pin: '763829', age: 9, yearLevel: 3, start: 'a1' }, crypto.randomUUID())).child;
  await h.api.refresh(); await h.click('Hand over to kids');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick(); h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  return { h, kid };
}
const text = (h) => h.root.textContent;
const activeVisit = async (h, kid) => { const prog = await h.f.store.get(learning(h, kid)); return h.f.store.get(`${learning(h, kid)}/sessions/${prog.olympia.activeVisit}`); };
const startFirst = async (h) => { await h.nodes('BUTTON').find((b) => b.textContent === 'Start α ▶').onclick(); await h.idle(); }; // the first Start on the hub is SEA-Moon's Alpha
// answer the question on the screen with the server's own right (or a wrong) answer: a choice is tapped, anything else typed and sent
async function answerShown(h, kid, right = true) {
  const v = await activeVisit(h, kid), q = v.questions[v.index], a = canonical(q);
  if (q.answer.type === 'choice') { const want = q.display.choices[right ? q.answer.v : (q.answer.v + 1) % q.display.choices.length]; await h.nodes('BUTTON').find((b) => b.className === 'choicebtn' && b.textContent === want).onclick(); return; }
  const box = h.nodes('INPUT').find((i) => i.className === 'answer-box'); box.value = right ? (typeof a === 'object' ? `${a.n}/${a.d}` : a) : (typeof a === 'object' ? `${Number(a.n) + 1}/${a.d}` : String(Number(a) + 1));
  h.nodes('FORM')[0].onsubmit({ preventDefault() {} }); await h.idle();
}

test('the home: a third wallet tile of Olyminerals and the Gateway jump under the tracks; the hub names eight moons, seven open at Year 3, each its real paper in three phases with a Start on each, the band and the not-affiliated line, and DC-Moon locked until Year 4', async (t) => {
  const { h } = await kidIn(t);
  assert.ok(text(h).includes('💎 0') && text(h).includes('olyminerals'), 'the pilot family may enter, so the minerals show');
  const gate = h.nodes('BUTTON').find((b) => b.textContent === '🪐 Gateway jump'); assert.ok(gate); assert.equal(gate.attrs['data-sub'], 'to the Olympia moons');
  await gate.onclick(); await h.idle();
  assert.ok(text(h).includes('🪐 OLYMPIA · PLANETARY SYSTEM') && text(h).includes('Allison · Year 3'));
  for (const name of ['SEA-Moon', 'US-Moon', 'SG-Moon', 'T-Moon', 'HK-Moon', 'BKK-Moon', 'PHI-Moon', 'DC-Moon']) assert.ok(text(h).includes(name), name);
  assert.ok(text(h).includes('modelled on SEAMO') && text(h).includes('not affiliated') && text(h).includes('Paper B') && text(h).includes('Grade 3'));
  assert.ok(text(h).includes('three phases you sit one at a time'), 'the intro says what a paper is now');
  assert.ok(text(h).includes('α Alpha · Section A10 questions · 3 marks each · 25 min · tap the answer') && text(h).includes('γ Gamma · Section C5 questions · 6 marks each · 30 min · type the answer'), `SEAMO's three sections: ${text(h).slice(0, 900)}`);
  assert.ok(text(h).includes('gold from 8/10 · not sat yet') && text(h).includes('gold from 4/5 · not sat yet'));
  assert.ok(text(h).includes('the real paper: 90 minutes for 40 questions at Grades 1–2, 45 at Grades 3–4'), 'SMC in its own shape');
  const starts = h.nodes('BUTTON').filter((b) => /^Start [αβγ] ▶$/.test(b.textContent)); assert.equal(starts.length, 21, 'seven moons open at Year 3, three phases each');
  assert.ok(text(h).includes('🔒 opens at Year 4'), 'DC-Moon, the AMC 8, waits for Year 4');
  await h.click('What does it ask?'); assert.ok(text(h).includes('Paper A · Years 1–2'), 'the syllabus lines under a tap');
  await h.click('Back'); assert.ok(h.nodes('BUTTON').some((b) => b.textContent === '🪐 Gateway jump'));
});
test('a phase: SEAMO Section A on its 25-minute clock, the hint, ten questions with no flash between them and one skipped, then the reveal with every question, its working under a tap, the medal, the minerals and the way to Beta; the hub then shows the phase\'s log', async (t) => {
  const { h, kid } = await kidIn(t);
  await h.click('🪐 Gateway jump'); await startFirst(h);
  assert.ok(text(h).includes('SEA-Moon · α Section A · 1/10'), text(h).slice(0, 300)); assert.ok(text(h).includes('⏱ 25:00'), 'the section\'s clock, not a question\'s'); assert.ok(text(h).includes('no marks until the end'));
  assert.ok(h.nodes('BUTTON').some((b) => b.textContent === 'Skip →') && h.nodes('BUTTON').some((b) => b.textContent === 'Hand in ✓') && h.nodes('BUTTON').some((b) => b.textContent === '✕ Quit'));
  assert.ok(!h.nodes('BUTTON').some((b) => b.textContent === '↺ Restart'), 'no restart on a visit');
  assert.equal(h.intervals(), 1, 'one clock, the phase\'s');
  for (let i = 0; i < 8; i++) { await answerShown(h, kid, i < 7); assert.ok(text(h).includes(`· ${i + 2}/10`), `question ${i + 2}`); assert.ok(!/⭐ Correct|✗ Not quite|it was/.test(text(h)), 'nothing said between questions'); }
  await h.click('Skip →'); assert.ok(text(h).includes('· 10/10'), 'a skip moves on');
  assert.equal(h.requests.filter((r) => r.path === '/api/olympia/answer').at(-1).body.answer, null, 'a skip is a blank');
  await answerShown(h, kid, false);
  assert.ok(text(h).includes('🥈 SILVER MEDAL — SEA-Moon · α Alpha') && text(h).includes('7/10') && text(h).includes('The reveal') && text(h).includes('+💎20') && text(h).includes('+⚡30 +🏆60') && text(h).includes('1 blank'), text(h).slice(0, 500));
  assert.equal(all(h.root).filter((n) => /^reveal-row /.test(n.className || '')).length, 10);
  assert.equal(all(h.root).filter((n) => n.className === 'reveal-row ok').length, 7); assert.equal(all(h.root).filter((n) => n.className === 'reveal-row blank').length, 1);
  const v = await activeVisit(h, kid).catch(() => null); // the visit is closed: read it from the reveal's own rows instead
  const work = h.nodes('BUTTON').filter((b) => b.textContent === 'Working ▾'); // one under every question that carries its worked solution
  if (work.length) { await work[0].onclick(); await h.idle(); assert.ok(all(h.root).some((n) => n.className === 'step' || n.className === 'step model'), 'the steps drawn under the question'); }
  assert.ok(h.nodes('BUTTON').some((b) => b.textContent === 'Next: β Beta ▶') && h.nodes('BUTTON').some((b) => b.textContent === 'Sit α again ▶'));
  assert.equal(v, null);
  await h.click('Home'); assert.ok(text(h).includes('💎 20'), 'the wallet tile'); assert.equal(h.nodes('BUTTON').find((b) => b.textContent === '🪐 Gateway jump').attrs['data-sub'], 'to the Olympia moons · 1 medal');
  await h.click('🪐 Gateway jump'); assert.ok(text(h).includes('🥈 1') && text(h).includes('best 7/10 🥈 · 1 visit · gold from 8/10') && text(h).includes('Your visits'), text(h).slice(0, 900));
  await h.click('Log · 1'); assert.ok(/\d{4}-\d\d-\d\d · 7\/10 · \d+:\d\d · 🥈 SILVER/.test(text(h)), 'the phase\'s log: when, the score, the clock, the medal');
});
test('sit as a lower year: the hub offers Allison (Year 3) Years 1, 2 and 3 on SEA-Moon, a lower year is marked a warm-up, its Start sends the year, and the paper says it pays nothing', async (t) => {
  const { h } = await kidIn(t);
  await h.click('🪐 Gateway jump');
  assert.ok(text(h).includes('Sit as') && h.nodes('BUTTON').some((b) => b.textContent === 'Year 3 ✓') && h.nodes('BUTTON').some((b) => b.textContent === 'Year 1'), text(h).slice(0, 700));
  assert.ok(!h.nodes('BUTTON').some((b) => b.textContent === 'Year 4'), 'never a year above');
  await h.nodes('BUTTON').find((b) => b.textContent === 'Year 2').onclick(); await h.idle(); // SEA-Moon's card comes first
  assert.ok(text(h).includes('A Year 2 paper (Paper A), below your Year 3: a warm-up — no minerals, no medal count'), text(h).slice(0, 900));
  await h.nodes('BUTTON').find((b) => b.textContent === 'Start α · Year 2 ▶').onclick(); await h.idle();
  assert.ok(text(h).includes('SEA-Moon · α Section A · 1/10') && text(h).includes('🧭 a Year 2 warm-up (Paper A), below your year — no minerals, no medal count'), text(h).slice(0, 400));
  await h.click('Hand in ✓');
  assert.ok(text(h).includes('🧭 Year 2 warm-up — SEA-Moon · α Alpha') && text(h).includes('0/10') && text(h).includes('A warm-up on a Year 2 paper, below your Year 3: nothing is paid and no medal is counted'), text(h).slice(0, 500));
  assert.ok(!text(h).includes('+💎'));
});
test('the moon wares: bought with Olyminerals and worn, refused without them; the Grid Shop keeps them out of its sections', async (t) => {
  const { h, kid } = await kidIn(t);
  const path = learning(h, kid);
  await h.f.store.transaction(async (tx) => { const p = normalizeProgress(await tx.get(path)); tx.set(path, await post(tx, path, p, entry({ id: 'seed', type: 'olympia.medal', om: 70, ref: 'sea', at: h.f.now() }))); });
  await h.click('🛒 Shop'); assert.ok(!text(h).includes('Reef dolphin'), 'not in the Grid Shop'); assert.ok(h.nodes('BUTTON').some((b) => b.textContent === '💎 Olympia shop'), 'but the way there, with minerals in hand');
  await h.click('💎 Olympia shop'); assert.ok(text(h).includes('💎 OLYMPIA SHOP · ALLISON') && text(h).includes('💎 70') && text(h).includes('Reef dolphin') && text(h).includes('Lunar rover'));
  const rover = all(h.root).find((n) => /^shopitem/.test(n.className || '') && n.textContent.includes('Lunar rover')); assert.ok(/\bdim\b/.test(rover.className), 'out of reach and dimmed');
  await h.click('💎150 BUY'); assert.ok(h.message.textContent.includes('Need 💎80 more'));
  await h.click('💎60 BUY'); assert.ok(h.message.textContent.includes('Reef dolphin — bought & equipped'));
  assert.ok(text(h).includes('💎 10') && h.nodes('BUTTON').some((b) => b.textContent === '✓ EQUIPPED'));
  await h.click('✓ EQUIPPED'); assert.ok(h.nodes('BUTTON').some((b) => b.textContent === 'EQUIP'));
  await h.click('Back'); assert.ok(text(h).includes('🪐 OLYMPIA'));
});
test('💡 Explain to me on a moon question: the warning, then the worked solution from the server with no AI call and the clock running on, a box to ask the tutor about a step, and a reveal that says the visit was practice', async (t) => {
  const { h, kid } = await kidIn(t, { tutorModel: async () => 'That step doubles the number, so the two halves make the whole.' });
  await h.click('🪐 Gateway jump'); await startFirst(h);
  await h.click('💡 Explain to me'); assert.ok(text(h).includes('makes this phase practice'), 'the warning first'); assert.ok(!h.requests.some((r) => r.path === '/api/olympia/explain'));
  await h.click('Not now'); assert.ok(!text(h).includes('makes this phase practice'));
  await h.click('💡 Explain to me'); await h.click('Yes, show me');
  assert.equal(h.requests.filter((r) => r.path === '/api/olympia/explain').length, 1); assert.equal(h.requests.filter((r) => r.path === '/api/tutor/explain').length, 0, 'the working needs no AI');
  const v = await activeVisit(h, kid), q = v.questions[0]; assert.equal(v.tutored, true);
  if (q.steps.length) { assert.ok(text(h).includes(q.steps[0]), text(h).slice(0, 600)); assert.ok(text(h).includes(`Answer: ${answerText(q)}`)); if (q.tip) assert.ok(text(h).includes(`Tip: ${q.tip}`)); }
  assert.ok(text(h).includes('Ask the tutor about the working'), 'the AI tutor is on for this family: a box for a question about a step');
  assert.equal(h.intervals(), 1, 'the phase clock runs on: the bell still rings');
  const ask = h.nodes('INPUT').find((i) => i.className === 'tutor-input'); ask.value = 'why double?'; await h.click('Send');
  assert.ok(text(h).includes('why double?') && text(h).includes('That step doubles the number'));
  assert.equal(h.requests.find((r) => r.path === '/api/tutor/explain').body.message, 'why double?');
  await h.click('I get it 👍'); assert.ok(!text(h).includes('That step doubles the number'));
  await answerShown(h, kid, true); assert.ok(text(h).includes('💡 a practice visit — no medal, no minerals'), 'the hint from the next question on');
  for (let i = 0; i < 9; i++) await answerShown(h, kid, true);
  assert.ok(text(h).includes('💡 A practice visit — SEA-Moon · α Alpha') && text(h).includes('10/10'), text(h).slice(0, 400)); assert.ok(!text(h).includes('+💎'));
});
test('💡 Explain to me on a track paper: the button only with a tutor, the warning first, the reply in the box and spoken, a follow-up, and a paper that says it was practice', async (t) => {
  const { h, kid } = await kidIn(t, { tutorModel: async ({ messages }) => (messages.length > 1 ? 'Carrying means the extra ten moves left.' : 'Add the ones first. Try 14 + 8: 4 and 8 make 12, write 2, carry 1. Now yours!') });
  await h.click('⚙️ Start Engine ▶'); assert.ok(text(h).includes('Paper 1 · 1/25'));
  await h.click('💡 Explain to me'); assert.ok(text(h).includes('makes this paper practice'), 'the warning first'); assert.ok(!h.requests.some((r) => r.path === '/api/tutor/explain'));
  await h.click('Not now'); assert.ok(!text(h).includes('makes this paper practice'));
  await h.click('💡 Explain to me'); await h.click('Yes, explain');
  assert.ok(text(h).includes('Add the ones first. Try 14 + 8'), text(h).slice(0, 500)); assert.ok(text(h).includes('5 more'));
  assert.equal(h.requests.filter((r) => r.path === '/api/tutor/explain').length, 1); assert.equal(h.requests.find((r) => r.path === '/api/tutor/explain').body.message, null);
  assert.equal(h.intervals(), 0, 'the clock stopped: this paper is practice');
  const ask = h.nodes('INPUT').find((i) => i.className === 'tutor-input'); ask.value = 'what is carrying?'; await h.click('Send');
  assert.ok(text(h).includes('what is carrying?') && text(h).includes('Carrying means the extra ten moves left.')); assert.ok(text(h).includes('4 more'));
  await h.click('I get it 👍'); assert.ok(!text(h).includes('Carrying means'));
  // the paper: every answer right, and it counts for nothing
  const prog = await h.f.store.get(learning(h, kid)), raw = await h.f.store.get(`${learning(h, kid)}/sessions/${prog.activeSession}`);
  for (let i = 0; i < 25; i++) { const q = raw.questions[i], a = canonical(q); const box = h.nodes('INPUT').find((x) => x.className === 'answer-box'); if (box) { box.value = typeof a === 'object' ? `${a.n}/${a.d}` : a; h.nodes('FORM')[0].onsubmit({ preventDefault() {} }); await h.idle(); } else await h.nodes('BUTTON').find((b) => b.className === 'choicebtn' && b.textContent === q.display.choices[q.answer.v]).onclick(); }
  assert.ok(text(h).includes('Explain to me was used — this paper was practice') && text(h).includes('counts for nothing'), text(h).slice(0, 400));
  assert.ok(!text(h).includes('+⚡50'));
  await h.click('Home'); assert.ok(text(h).includes('💡 TUTOR'), 'the log says why it paid nothing'); assert.ok(text(h).includes('papers 1–5'), 'the same papers again');
});
test('the parent: Game & progress has the tutor switch and the Olympia section; the plan line says Olympia is included', async (t) => {
  const h = await uiFixture(t, { recordBodies: ['/api/game/parent/settings'] });
  await h.f.child(h.a.ctx, 'Geralt'); await h.api.refresh();
  assert.ok(text(h).includes('🪐 Olympia: included in pilot access.'), text(h).slice(0, 600));
  await h.click('Game & progress');
  assert.ok(text(h).includes('💡 Explain to me') && text(h).includes('🪐 Olympia') && text(h).includes('Geralt: no visits yet') && text(h).includes('three phases'));
  await h.click('Switch the tutor off');
  assert.deepEqual(h.requests.filter((r) => r.path === '/api/game/parent/settings').map((r) => r.body), [{ tutorOff: true }]);
  assert.ok(text(h).includes('The tutor is switched off for your family') && h.nodes('BUTTON').some((b) => b.textContent === 'Switch the tutor on'));
});
