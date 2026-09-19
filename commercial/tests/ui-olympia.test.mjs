// 🪐 Olympia and 💡 Explain to me on the kids' page (19 Sep 2026): the Gateway tile and the third wallet tile, the hub's moons, a
// visit that says nothing until the reveal, the moon wares, the tutor's warning and reply, and the parent's switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture, nodes } from './ui-support.mjs';
import { bootstrap, entry, post } from '../server/ledger.mjs';
import { normalizeProgress } from '../server/progress.mjs';
import { canonical } from './support.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const learning = (h, kid) => `families/${h.a.familyId}/learning/${kid.id}`;
async function kidIn(t, opts = {}) {
  const h = await uiFixture(t, { recordBodies: ['/api/olympia/answer', '/api/tutor/explain', '/api/game/parent/settings'], ...opts });
  const kid = (await h.f.service.createChild(h.a.ctx, { nickname: 'Allison', icon: 'fox', pin: '763829', age: 9, yearLevel: 3, start: 'a1' }, crypto.randomUUID())).child;
  await h.api.refresh(); await h.click('Hand over to kids');
  await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick(); h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  return { h, kid };
}
const text = (h) => h.root.textContent;
const activeVisit = async (h, kid) => { const prog = await h.f.store.get(learning(h, kid)); return h.f.store.get(`${learning(h, kid)}/sessions/${prog.olympia.activeVisit}`); };
// answer the question on the screen with the server's own right (or a wrong) answer: a choice is tapped, anything else typed and sent
async function answerShown(h, kid, right = true) {
  const v = await activeVisit(h, kid), q = v.questions[v.index], a = canonical(q);
  if (q.answer.type === 'choice') { const want = q.display.choices[right ? q.answer.v : (q.answer.v + 1) % q.display.choices.length]; await h.nodes('BUTTON').find((b) => b.className === 'choicebtn' && b.textContent === want).onclick(); return; }
  const box = h.nodes('INPUT').find((i) => i.className === 'answer-box'); box.value = right ? (typeof a === 'object' ? `${a.n}/${a.d}` : a) : (typeof a === 'object' ? `${Number(a.n) + 1}/${a.d}` : String(Number(a) + 1));
  h.nodes('FORM')[0].onsubmit({ preventDefault() {} }); await h.idle();
}

test('the home: a third wallet tile of Olyminerals and the Gateway jump under the tracks; the hub names seven moons, four open, with the band and the not-affiliated line, and US-Moon locked for Year 1', async (t) => {
  const { h } = await kidIn(t);
  assert.ok(text(h).includes('💎 0') && text(h).includes('olyminerals'), 'the pilot family may enter, so the minerals show');
  const gate = h.nodes('BUTTON').find((b) => b.textContent === '🪐 Gateway jump'); assert.ok(gate); assert.equal(gate.attrs['data-sub'], 'to the Olympia moons');
  await gate.onclick(); await h.idle();
  assert.ok(text(h).includes('🪐 OLYMPIA · PLANETARY SYSTEM') && text(h).includes('Allison · Year 3'));
  for (const name of ['SEA-Moon', 'US-Moon', 'SG-Moon', 'T-Moon', 'HK-Moon', 'BKK-Moon', 'PHI-Moon']) assert.ok(text(h).includes(name), name);
  assert.ok(text(h).includes('modelled on SEAMO') && text(h).includes('not affiliated') && text(h).includes('Paper B') && text(h).includes('Grade 3'));
  const visits = h.nodes('BUTTON').filter((b) => /^.+ Visit .+-Moon ▶$/.test(b.textContent)).map((b) => b.textContent);
  assert.deepEqual(visits, ['🌊 Visit SEA-Moon ▶', '🦅 Visit US-Moon ▶', '🦁 Visit SG-Moon ▶', '🏮 Visit T-Moon ▶', '🐉 Visit HK-Moon ▶', '🐘 Visit BKK-Moon ▶', '🌴 Visit PHI-Moon ▶'], 'Year 3: the seven moons open at Year 3');
  assert.ok(text(h).includes('DC-Moon') && text(h).includes('🔒 opens at Year 4'), 'DC-Moon, the AMC 8, waits for Year 4');
  await h.click('What does it ask?'); assert.ok(text(h).includes('Paper A · Years 1–2'), 'the syllabus lines under a tap');
  await h.click('Back'); assert.ok(h.nodes('BUTTON').some((b) => b.textContent === '🪐 Gateway jump'));
});
test('a visit: the hint that nothing is marked until the end, ten questions with no flash between them, then the reveal with every question, the medal and the minerals; the home then shows them', async (t) => {
  const { h, kid } = await kidIn(t);
  await h.click('🪐 Gateway jump'); await h.click('🌊 Visit SEA-Moon ▶');
  assert.ok(text(h).includes('SEA-Moon · Multiple choice · 1/10'), text(h).slice(0, 300)); assert.ok(text(h).includes('no marks until the end'));
  assert.ok(!h.nodes('BUTTON').some((b) => b.textContent === '💡 Explain to me'), 'no tutor without a key');
  assert.ok(!h.nodes('BUTTON').some((b) => b.textContent === '↺ Restart'), 'no restart on a visit');
  for (let i = 0; i < 9; i++) { await answerShown(h, kid, i < 7); assert.ok(text(h).includes(`· ${i + 2}/10`), `question ${i + 2}`); assert.ok(!/⭐ Correct|✗ Not quite|it was/.test(text(h)), 'nothing said between questions'); }
  await answerShown(h, kid, false);
  assert.ok(text(h).includes('🥈 SILVER MEDAL — SEA-Moon') && text(h).includes('7/10') && text(h).includes('The reveal') && text(h).includes('+💎20') && text(h).includes('+⚡30 +🏆60'), text(h).slice(0, 400));
  assert.equal(all(h.root).filter((n) => /^reveal-row /.test(n.className || '')).length, 10);
  assert.equal(all(h.root).filter((n) => n.className === 'reveal-row ok').length, 7);
  await h.click('Home'); assert.ok(text(h).includes('💎 20'), 'the wallet tile'); assert.equal(h.nodes('BUTTON').find((b) => b.textContent === '🪐 Gateway jump').attrs['data-sub'], 'to the Olympia moons · 1 medal');
  await h.click('🪐 Gateway jump'); assert.ok(text(h).includes('🥈 1') && text(h).includes('best 7/10') && text(h).includes('1 rewarded visit left today') && text(h).includes('Your visits'));
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
test('💡 Explain to me: the button on a paper only with a tutor, the warning first, the reply in the box and spoken, a follow-up, and a paper that says it was practice', async (t) => {
  const said = []; const { h, kid } = await kidIn(t, { tutorModel: async ({ messages }) => (messages.length > 1 ? 'Carrying means the extra ten moves left.' : 'Add the ones first. Try 14 + 8: 4 and 8 make 12, write 2, carry 1. Now yours!') });
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
  assert.ok(text(h).includes('💡 Explain to me') && text(h).includes('🪐 Olympia') && text(h).includes('Geralt: no visits yet'));
  await h.click('Switch the tutor off');
  assert.deepEqual(h.requests.filter((r) => r.path === '/api/game/parent/settings').map((r) => r.body), [{ tutorOff: true }]);
  assert.ok(text(h).includes('The tutor is switched off for your family') && h.nodes('BUTTON').some((b) => b.textContent === 'Switch the tutor on'));
});
