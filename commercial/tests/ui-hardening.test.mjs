import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture, nodes } from './ui-support.mjs';

// DOM/HTTP tests, not Firebase/browser end-to-end claims.
test('UI: normal sign-in actually mounts the email, password and submit controls', async (t) => {
  const h = await uiFixture(t, { signedIn: false });
  assert.equal(h.nodes('FORM').length, 1);
  assert.equal(h.nodes('INPUT').filter(n => n.type === 'email').length, 1);
  assert.equal(h.nodes('INPUT').filter(n => n.type === 'password').length, 1);
  assert.ok(h.root.textContent.includes('Sign in as parent'));
});
test('UI S1-003: same-parent MFA continuation preserves only nickname/icon and clears PINs', async (t) => {
  const h = await uiFixture(t); await h.draft();
  assert.ok(h.nodes('INPUT').every(n => n.value !== '763829'));
  h.setAuth('parentA', { signIn: async () => ({ stage: 'mfa', phone: 'test number' }), sendCode: async () => {},
    confirmCode: async () => ({ stage: 'ready', idToken: h.f.token('parentA') }) });
  await h.submitLogin(); assert.ok(h.root.textContent.includes('Your second security check'));
  await h.click('Send verification code'); h.nodes('INPUT').find(n => n.autocomplete === 'one-time-code').value = '123456';
  await h.click('Verify code');
  assert.ok(h.root.textContent.includes('NEW CHILD PROFILE'));
  assert.equal(h.nodes('INPUT')[0].value, 'Private draft'); assert.equal(h.nodes('SELECT')[0].value, 'wolf');
  assert.equal(h.nodes('INPUT')[1].value, ''); assert.equal(h.nodes('INPUT')[2].value, '');
  assert.equal((await h.f.store.get(`families/${h.a.familyId}`)).childIds.length, 0);
});
test('UI S1-003: different parent cannot resume or submit the original family child draft', async (t) => {
  const h = await uiFixture(t), b = await h.f.family('parentB', 2); await h.draft(); h.setAuth('parentB'); await h.submitLogin();
  assert.equal(h.api.getModel().family.id, b.familyId);
  assert.ok(!h.root.textContent.includes('NEW CHILD PROFILE'));
  assert.ok(h.nodes('INPUT').every(n => n.value !== 'Private draft'));
  assert.ok(h.message.textContent.includes('discarded'));
  assert.equal((await h.f.store.get(`families/${b.familyId}`)).childIds.length, 0);
  assert.equal((await h.f.store.get(`families/${h.a.familyId}`)).childIds.length, 0);
});
test('UI S1-003: different parents with no family cannot share a family-setup continuation', async (t) => {
  const h = await uiFixture(t, { family: false }); await h.f.login('parentB');
  h.nodes('INPUT')[0].value = 'Private family label'; h.nodes('INPUT')[1].checked = true; h.f.advance(301000);
  await h.click('Create family workspace'); h.setAuth('parentB'); await h.submitLogin();
  assert.equal(h.api.getModel().parent.uid, 'parentB'); assert.equal(h.api.getModel().family, null);
  assert.equal(h.nodes('INPUT')[0].value, ''); assert.equal(h.nodes('INPUT')[1].checked, false);
  assert.ok(h.message.textContent.includes('discarded'));
});
test('UI S1-003: same-parent family setup restores its label and acknowledgement', async (t) => {
  const h = await uiFixture(t, { family: false });
  h.nodes('INPUT')[0].value = 'Private family label'; h.nodes('INPUT')[1].checked = true; h.f.advance(301000);
  await h.click('Create family workspace'); h.setAuth(); await h.submitLogin();
  assert.equal(h.nodes('INPUT')[0].value, 'Private family label'); assert.equal(h.nodes('INPUT')[1].checked, true);
});
test('UI S1-003: cancelling reauthentication discards the callback even if an old form later fires', async (t) => {
  const h = await uiFixture(t); await h.draft(); h.setAuth(); const oldForm = h.nodes('FORM')[0];
  await h.click('Cancel verification');
  const count = h.requests.filter(r => r.path === '/api/auth/session').length;
  oldForm.onsubmit({ preventDefault() {} }); await h.idle();
  assert.equal(h.requests.filter(r => r.path === '/api/auth/session').length, count);
  assert.ok(!h.root.textContent.includes('NEW CHILD PROFILE'));
  assert.ok(h.nodes('INPUT').every(n => n.value !== 'Private draft'));
});
test('UI S1-003: a session change during pending login invalidates the continuation and is not dropped', async (t) => {
  const h = await uiFixture(t), b = await h.f.family('parentB', 2); await h.draft();
  let release; const ready = new Promise(r => { release = r; });
  h.setAuth('parentA', { signIn: async () => { await ready; return { stage: 'ready', idToken: h.f.token('parentA') }; } });
  const form = h.nodes('FORM')[0]; form.onsubmit({ preventDefault() {} });
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 1));
  const count = h.requests.filter(r => r.path === '/api/auth/session').length;
  h.setCookie(b.cookie); h.sessionChange(); release(); await h.idle();
  assert.equal(h.api.getModel().family.id, b.familyId);
  assert.equal(h.requests.filter(r => r.path === '/api/auth/session').length, count);
  assert.ok(h.nodes('INPUT').every(n => n.value !== 'Private draft'));
});
test('UI S1-003: revoked family membership prevents reauth continuation', async (t) => {
  const h = await uiFixture(t); await h.draft(); h.setAuth();
  await h.f.store.put(`families/${h.a.familyId}/members/parentA`, { role: 'owner', status: 'revoked' });
  await h.submitLogin(); assert.ok(!h.root.textContent.includes('NEW CHILD PROFILE'));
  assert.equal((await h.f.store.get(`families/${h.a.familyId}`)).childIds.length, 0);
});
test('UI S1-003: removed MFA factor cannot resume a draft', async (t) => {
  const h = await uiFixture(t); await h.draft(); h.setAuth();
  h.f.users.get('parentA').multiFactor.enrolledFactors = [];
  await h.submitLogin(); assert.ok(!h.root.textContent.includes('NEW CHILD PROFILE'));
});
test('UI S1-003: PIN reset resumes only for the original parent with empty PIN fields', async (t) => {
  const h = await uiFixture(t), kid = (await h.f.child(h.a.ctx)).child;
  h.api.resetPinScreen(kid); h.nodes('INPUT')[0].value = h.nodes('INPUT')[1].value = '992233'; h.f.advance(301000);
  await h.click('Set new PIN'); h.setAuth(); await h.submitLogin();
  assert.ok(h.root.textContent.includes('Set new PIN'));
  assert.ok(h.nodes('INPUT').every(n => n.value === ''));
});
test('UI S1-003: reauthentication still works after the old parent cookie expires', async (t) => {
  const h = await uiFixture(t); await h.draft(); h.f.advance(30 * 60000); h.setAuth(); await h.submitLogin();
  assert.ok(h.root.textContent.includes('NEW CHILD PROFILE')); assert.equal(h.nodes('INPUT')[0].value, 'Private draft');
});
test('UI: Alt+Tab keeps drafts and child PIN screen while real session changes still refresh', async (t) => {
  const h = await uiFixture(t); h.api.addChildScreen(); h.nodes('INPUT')[0].value = 'AltTabTest';
  h.visibility(); await h.idle(); assert.equal(h.nodes('INPUT')[0].value, 'AltTabTest');
  await h.click('Back to family'); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  await h.click('Hand over to kids');
  const card = h.nodes('BUTTON').find(n => n.className === 'player-card'); await card.onclick();
  h.visibility(); await h.idle(); assert.ok(h.root.textContent.includes('Enter my grid'));
  const parent = await h.f.login('parentB'); h.setCookie(parent.cookie); h.sessionChange(); await h.idle();
  assert.ok(!h.root.textContent.includes('Enter my grid')); assert.equal(h.api.getModel().parent.uid, 'parentB');
});
test('UI S1-001: handover, child PIN and switch-child refresh CSRF and broadcast changed sessions', async (t) => {
  const h = await uiFixture(t); await h.f.child(h.a.ctx); await h.api.refresh();
  const old = h.cookie(); await h.click('Hand over to kids'); assert.notEqual(h.cookie(), old);
  await h.nodes('BUTTON').find(n => n.className === 'player-card').onclick();
  h.nodes('INPUT')[0].value = '000000'; await h.click('Enter my grid'); assert.ok(h.message.textContent.includes('did not match'));
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid'); assert.ok(h.root.textContent.includes('Welcome,'));
  assert.ok(h.root.textContent.includes('ENGINE · SECTOR A') && h.root.textContent.includes('⚡ 0'));
  await h.click('Switch child'); assert.ok(h.root.textContent.includes("who's on a mission today?"));
  assert.ok(h.broadcasts.length >= 3);
});
test('UI Stage 2: a child starts a session, answers what the server asks, and can leave it', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  await h.click('Hand over to kids'); await h.nodes('BUTTON').find(n => n.className === 'player-card').onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  await h.click('Start ENGINE'); assert.ok(h.root.textContent.includes('Question 1 of 25'), h.root.textContent);
  const prog = await h.f.store.get(`families/${h.a.familyId}/learning/${kid.id}`);
  const stored = await h.f.store.get(`families/${h.a.familyId}/learning/${kid.id}/sessions/${prog.activeSession}`);
  assert.ok(!h.root.textContent.includes(String(stored.questions[0].answer.v)) || stored.questions[0].display.layout !== 'stack');
  const form = h.nodes('FORM')[0]; h.nodes('INPUT')[0].value = String(stored.questions[0].answer.v); // the answer box is the only input on the play screen
  form.onsubmit({ preventDefault() {} }); await h.idle();
  assert.ok(h.message.textContent.includes('Correct')); assert.ok(h.root.textContent.includes('Question 2 of 25'));
  await h.click('Leave this session'); assert.ok(h.root.textContent.includes('Welcome,') && h.root.textContent.includes('left at Q2'));
  assert.equal((await h.f.learning.state(await h.f.service.authenticate(h.cookie().slice('__session='.length)))).active, null);
});

test('UI Stage 2 game: child shop, migrated catalog and Navigator read-aloud are reachable only after child entry', async (t) => {
  const h = await uiFixture(t); await h.f.child(h.a.ctx); await h.api.refresh();
  assert.ok(!h.root.textContent.includes('GRID SHOP'));
  await h.click('Hand over to kids'); await h.nodes('BUTTON').find(n => n.className === 'player-card').onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid');
  assert.ok(h.root.textContent.includes('🛒 Shop & rewards'));
  await h.click('🛒 Shop & rewards');
  assert.ok(h.root.textContent.includes('GRID SHOP') && h.root.textContent.includes('Volt dragon') && h.root.textContent.includes('⚡1200'));
  await h.click('Back to my grid'); await h.click('Start NAVIGATOR');
  assert.ok(h.root.textContent.includes('NAVIGATOR') && h.root.textContent.includes('🔊 Read aloud'));
});

test('UI Stage 2 game: parent workspace exposes server-backed game/progress controls', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  await h.click('Game & progress');
  assert.ok(h.root.textContent.includes('PARENT · GAME & PROGRESS'));
  assert.ok(h.root.textContent.includes(kid.nickname));
  assert.ok(h.root.textContent.includes('Question-time pace %'));
  assert.ok(h.root.textContent.includes('Reward Store'));
  assert.ok(h.root.textContent.includes('Family Rocket'));
});

test('UI Family Rocket: one click on Scrap or Launch now changes nothing; only the confirmation screen sends it', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  const cfg = () => h.f.store.get(`families/${h.a.familyId}/game/config`);
  const build = () => h.f.game.rocket(h.a.ctx, { action: 'build', prize: { emoji: '🍦', name: 'Ice cream' }, currency: 'gc', goal: 100, minEach: 0, crewChildIds: [kid.id] });
  await build(); await h.click('Game & progress');
  const posts = () => h.requests.filter((r) => r.path === '/api/game/parent/rocket').length;
  await h.click('Scrap (no refund)');
  assert.ok(h.root.textContent.includes('Scrap this rocket?') && h.root.textContent.includes('not refunded'));
  assert.equal((await cfg()).rocket.status, 'fueling', 'one click does not scrap'); assert.equal(posts(), 0, 'nothing was sent');
  await h.click('Back'); assert.ok(h.root.textContent.includes('PARENT · GAME & PROGRESS'));
  await h.click('Launch now');
  assert.ok(h.root.textContent.includes('Launch this rocket now?'));
  assert.equal((await cfg()).rocket.status, 'fueling', 'one click does not launch'); assert.equal(posts(), 0);
  await h.click('Back');
  await h.click('Scrap (no refund)'); await h.click('Yes, scrap it');
  const scrapped = await cfg(); assert.equal(scrapped.rocket, null); assert.equal(scrapped.rocketHistory.at(-1).status, 'scrapped'); assert.equal(posts(), 1);
  assert.ok(h.root.textContent.includes('Build rocket'), 'back on the game screen');
  await build(); await h.click('Back to family'); await h.click('Game & progress');
  await h.click('Launch now'); await h.click('Yes, launch now');
  assert.equal((await cfg()).rocket.status, 'launched'); assert.ok(h.root.textContent.includes('Prize delivered · clear'));
});

test('UI Stage 2 game: sensitive parent game writes require fresh reauthentication and are not auto-submitted afterward', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  await h.click('Game & progress'); h.f.advance(301000);
  const before = await h.f.store.get(`families/${h.a.familyId}/learning/${kid.id}`);
  await h.click('+⚡50 credit');
  assert.ok(h.root.textContent.includes('PARENT VERIFICATION'));
  const after = await h.f.store.get(`families/${h.a.familyId}/learning/${kid.id}`);
  assert.equal(after?.wallet?.gc || 0, before?.wallet?.gc || 0);
});
