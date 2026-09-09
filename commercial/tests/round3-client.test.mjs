// Stage 4 review, third round — the browser: a parent changes the mobile number in the app; a kids' device whose child
// session was refused goes back to the launch pad instead of dying on an empty screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';

test('a parent changes the mobile number in the app: a fresh sign-in, a code to the new number, the old factor removed, then a sign-in with the new number', async (t) => {
  const h = await uiFixture(t); const calls = [];
  h.setAuth('parentA', { changeMobileSend: async (phone, consent) => { calls.push(['send', phone, consent]); }, changeMobileConfirm: async (code) => { calls.push(['confirm', code]); return { stage: 'signin', notice: 'Mobile number changed.' }; } });
  await h.click('Change my mobile number'); assert.ok(h.root.textContent.includes('PARENT VERIFICATION'), 'a fresh sign-in first');
  await h.submitLogin(); assert.ok(h.root.textContent.includes('CHANGE MOBILE'), h.root.textContent.slice(0, 200));
  const inputs = h.nodes('INPUT'); inputs[0].value = '+6581234567'; inputs[1].checked = true;
  await h.click('Send code to the new number'); assert.ok(h.message.textContent.includes('Code sent'));
  inputs[2].value = '123456'; await h.click('Verify new number');
  assert.deepEqual(calls, [['send', '+6581234567', true], ['confirm', '123456']]);
  assert.ok(h.root.textContent.includes('Sign in as parent'), 'back at sign-in'); assert.ok(h.message.textContent.includes('Mobile number changed'));
  assert.ok(h.requests.some((r) => r.path === '/api/auth/logout' && r.method === 'POST'), 'the old session ends: the next sign-in carries the new factor');
});
test('a kids\' device whose child session was refused goes back to the launch pad, never a dead screen', async (t) => {
  const h = await uiFixture(t); const kid = (await h.f.child(h.a.ctx)).child; await h.api.refresh();
  await h.click('Hand over to kids'); await h.nodes('BUTTON').find((n) => n.className === 'player-card').onclick();
  h.nodes('INPUT')[0].value = '763829'; await h.click('Enter my grid'); assert.ok(h.root.textContent.includes('Welcome,'));
  // the parent, elsewhere, resets the PIN: the child session is revoked under the device
  h.f.advance(2000); const parent = await h.f.login('parentA'); await h.f.service.resetPin(parent.ctx, kid.id, '111111'); // a token minted after the handover
  await h.api.refresh();
  assert.ok(h.root.textContent.includes('Who is on a mission'), h.root.textContent.slice(0, 300)); assert.ok(h.message.textContent.length > 0, 'the child is told why');
  assert.ok(h.nodes('BUTTON').some((n) => n.className === 'player-card'), 'the explorer can be chosen again');
});
test('the sign-in provider\'s refusal reaches the parent in words, with its code: an invalid number, a paused device, an unknown refusal with the provider\'s own text', async (t) => {
  const h = await uiFixture(t, { signedIn: false });
  const fail = (code, message) => Object.assign(new Error(message), { code });
  let next = fail('auth/invalid-phone-number', 'Firebase: Error (auth/invalid-phone-number).');
  h.setAuth('parentA', { signIn: async () => ({ stage: 'enroll' }), sendCode: async () => { throw next; } });
  await h.submitLogin(); assert.ok(h.root.textContent.includes('Protect the command deck'), h.root.textContent.slice(0, 200));
  h.nodes('INPUT')[0].value = '0812'; await h.click('Send verification code'); assert.ok(h.message.textContent.includes('international form'), h.message.textContent);
  next = fail('auth/too-many-requests', 'Firebase: Error (auth/too-many-requests).'); await h.click('Send verification code'); assert.ok(h.message.textContent.includes('paused requests'), h.message.textContent);
  next = fail('auth/internal-error', 'Firebase: ((HTTP Cloud Function returned an error. Code: 429, Message: SMS quota exceeded)) (auth/internal-error).'); await h.click('Send verification code');
  assert.ok(h.message.textContent.includes('auth/internal-error') && h.message.textContent.includes('SMS quota exceeded'), h.message.textContent);
  assert.ok(!h.message.textContent.includes('Firebase:'), 'the provider\'s prefix is dropped');
});
