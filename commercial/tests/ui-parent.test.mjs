// The parent's screens as v2's admin panel (port plan section 5; test 8). Mission Control: a block per concern, each child in a row
// of its own with its two actions, v2's footer. Game & progress: one list of the requests waiting, the Reward Store editor, whose one
// Save sends each reward's emoji, hidden flag, daily limit and the children ticked, and the rocket's build form, which sends the fuel
// chosen and a crew of children with a seat only. The server checks everything again; these tests read what the page sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { uiFixture } from './ui-support.mjs';
import { freshProgress } from '../server/progress.mjs';

const all = (node) => [node, ...node.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
const find = (h, cls) => all(h.root).filter((n) => new RegExp(`(^| )${cls}( |$)`).test(n.className || ''));
const input = (h, aria) => h.nodes('INPUT').find((i) => i.attrs['aria-label'] === aria);
const labelled = (scope, words) => all(scope).find((n) => n.tagName === 'LABEL' && n.textContent === words);
const box = (scope, words) => labelled(scope, words).children.find((c) => c.tagName === 'INPUT');
const config = (h) => h.f.store.get(`families/${h.a.familyId}/game/config`);
// the page reads the fixture's clock once the fixture exists (its grant lasts fifteen minutes of that clock, not of today's)
async function parentPage(t, options = {}) { let h = null; h = await uiFixture(t, { clock: () => (h ? h.f.now() : Date.now()), ...options }); return h; }
async function family(t) {
  const h = await parentPage(t, { recordBodies: ['/api/game/parent/rewards', '/api/game/parent/rocket'] });
  const allison = (await h.f.child(h.a.ctx, 'Allison')).child, geralt = (await h.f.child(h.a.ctx, 'Geralt')).child;
  await h.api.refresh(); return { h, allison, geralt };
}

test('Mission Control is v2\'s admin panel: account, crew, plan, game, email and data blocks, a row per child with its two actions in its colour, and v2\'s footer', async (t) => {
  const { h, allison, geralt } = await family(t);
  assert.deepEqual(all(h.root).filter((n) => n.tagName === 'H2').map((n) => n.textContent), ['🔐 Account & security', '👥 Your crew', '💳 Plan & seats', '🎮 Game & progress', '📧 Email updates', '🗄 Data & deletion']);
  const rows = find(h, 'kid-row');
  assert.deepEqual(rows.map((r) => /acc-\d/.exec(r.className)[0]), ['acc-0', 'acc-1'], 'each child in its place in the palette');
  for (const [row, kid] of [[rows[0], allison], [rows[1], geralt]]) {
    for (const words of [kid.nickname, 'MISSION READY', 'READY FOR THE GRID']) assert.ok(row.textContent.includes(words), words);
    assert.deepEqual(all(row).filter((n) => n.tagName === 'BUTTON').map((b) => b.textContent), [`Reset ${kid.nickname}’s PIN`, `Change ${kid.nickname}’s starting point`]);
  }
  for (const words of ['2 / 2', 'child slots in use', 'PILOT ACCESS ACTIVE', 'Pilot access: 2 child slots until', 'Family reference: ']) assert.ok(h.root.textContent.includes(words), words);
  assert.equal(find(h, 'add-row').length, 0, 'every slot taken: no Add a child');
  assert.deepEqual(find(h, 'admin-foot')[0].children.map((b) => b.textContent), ['Hand over to kids', 'Sign out'], 'v2\'s footer, Hand over to kids where v2 had Done');
  // a free slot: the dashed row adds a child
  const one = await parentPage(t); await one.f.child(one.a.ctx, 'Allison'); await one.api.refresh();
  assert.equal(find(one, 'add-row').length, 1); assert.ok(find(one, 'add-row')[0].textContent.includes('1 free child slot'));
  await one.click('Add a child'); assert.ok(one.root.textContent.includes('NEW CHILD PROFILE'));
});

test('the Reward Store editor: a new reward with its emoji, hidden flag and daily limit, ticked for one child, goes out only on Save, as one list; ✕ and Save take it away', async (t) => {
  const { h, allison } = await family(t);
  await h.click('Game & progress');
  const posts = () => h.requests.filter((r) => r.path === '/api/game/parent/rewards'), save = () => h.nodes('BUTTON').find((b) => b.textContent === 'Save rewards');
  assert.equal(save().disabled, true, 'nothing to save yet');
  input(h, 'reward emoji').value = '🍦'; input(h, 'reward name').value = 'Ice cream'; input(h, 'cost in reward points').value = '300'; input(h, 'daily limit, 0 for none').value = '2';
  box(h.root, 'hide til afford').checked = true;
  await h.click('+ ADD');
  const row = find(h, 'rw-row')[0];
  for (const words of ['Ice cream', '🏆300', 'hidden until affordable', 'max 2/day']) assert.ok(row.textContent.includes(words), words);
  assert.equal(posts().length, 0, 'the draft stays in the page until Save');
  const geralt = box(row, 'Geralt'); assert.equal(geralt.checked, true, 'a new reward starts ticked for every child');
  geralt.checked = false; geralt.events.change();
  assert.ok(h.root.textContent.includes('Unsaved changes')); assert.equal(save().disabled, false);
  await h.click('Save rewards');
  assert.equal(posts().length, 1);
  const [sent] = posts()[0].body.rewards;
  assert.deepEqual([sent.emoji, sent.name, sent.cost, sent.hidden, sent.cap, sent.childIds], ['🍦', 'Ice cream', 300, true, 2, [allison.id]]);
  assert.match(sent.id, /^rw-[0-9a-f-]{36}$/);
  assert.deepEqual((await config(h)).rewards.map((r) => [r.name, r.hidden, r.cap, r.childIds]), [['Ice cream', true, 2, [allison.id]]], 'the server holds it');
  assert.ok(!h.root.textContent.includes('Unsaved changes') && save().disabled, 'the screen shows what the server now holds');
  await h.click('✕'); assert.equal(posts().length, 1, '✕ changes the draft only');
  await h.click('Save rewards'); assert.deepEqual((await config(h)).rewards, []);
});

test('the rocket build form: the fuel chosen with v2\'s goal and minimum for it, and a crew of children with a seat only', async (t) => {
  const { h, allison, geralt } = await family(t);
  const fam = `families/${h.a.familyId}`; // Geralt loses his seat: the server lets no child without one join a crew
  await h.f.store.put(fam, { ...(await h.f.store.get(fam)), activeChildIds: [allison.id] });
  await h.f.store.put(`${fam}/children/${geralt.id}`, { ...(await h.f.store.get(`${fam}/children/${geralt.id}`)), status: 'inactive' });
  await h.api.refresh(); assert.ok(find(h, 'kid-row')[1].textContent.includes('PROFILE INACTIVE'));
  await h.click('Game & progress');
  const crew = find(h, 'rk-crew')[0];
  assert.ok(labelled(crew, 'Allison') && !labelled(crew, 'Geralt'), 'no tick for a child without a seat'); assert.equal(box(crew, 'Allison').checked, true);
  assert.deepEqual([input(h, 'goal').value, input(h, 'minimum each, 0 for none').value], ['2000', '300'], 'v2\'s goal and minimum for grid coins');
  const fuel = h.nodes('SELECT').find((s) => s.attrs['aria-label'] === 'fuel type'); fuel.value = 'rp'; fuel.events.change();
  assert.deepEqual([input(h, 'goal').value, input(h, 'minimum each, 0 for none').value], ['4000', '600'], 'and for reward points');
  input(h, 'prize name').value = 'Movie night';
  await h.click('Build rocket');
  const [post] = h.requests.filter((r) => r.path === '/api/game/parent/rocket');
  assert.deepEqual(post.body, { action: 'build', prize: { emoji: '🎬', name: 'Movie night' }, currency: 'rp', goal: 4000, minEach: 600, crewChildIds: [allison.id] });
  const { rocket } = await config(h); assert.deepEqual([rocket.currency, rocket.goal, rocket.crewChildIds], ['rp', 4000, [allison.id]]);
  assert.ok(h.root.textContent.includes('🎬 Movie night · goal 🏆4000 · at least 🏆600 each') && h.root.textContent.includes('Launch now'), 'the rocket as the server now holds it');
});

test('Approvals: the requests waiting from every child in one list with the child\'s face, Approve decided by the server; and each child\'s log', async (t) => {
  const { h, allison } = await family(t);
  const p = freshProgress(); p.wallet.rp = 200; p.wallet.rpSpent = 300;
  p.wallet.redemptions = [{ id: randomUUID(), rewardId: 'rw-ice', emoji: '🍦', name: 'Ice cream', cost: 300, date: '2026-09-06', status: 'pending', requestedAt: h.f.now() }];
  p.history = [{ ts: Date.parse('2026-09-06T09:00:00Z'), date: '2026-09-06', track: 'engine', mode: 'paper', level: 0, levelId: 'A', papers: '1–5', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, secs: 754 }];
  await h.f.store.put(`families/${h.a.familyId}/learning/${allison.id}`, p);
  await h.click('Game & progress');
  const [wait] = find(h, 'wait-row');
  assert.ok(wait.textContent.includes('Allison: 🍦 Ice cream') && wait.textContent.includes('🏆300'));
  assert.ok(all(wait).some((n) => /\bav-22\b/.test(n.className || '') && n.className.includes('acc-0')), 'her face, in her colour');
  for (const words of ['Allison\'s log', '25/25', '12:34', 'PASS', 'Geralt: no sessions yet.']) assert.ok(h.root.textContent.includes(words), words);
  await h.click('Approve');
  assert.equal((await h.f.store.get(`families/${h.a.familyId}/learning/${allison.id}`)).wallet.redemptions[0].status, 'approved');
  assert.ok(h.root.textContent.includes('no pending redemptions'));
});
