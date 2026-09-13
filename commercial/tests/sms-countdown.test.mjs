// The Send countdown (owner, 11 Sep 2026: "Show hours:minutes:seconds countdown before they can send again"). The Send
// button of the verify-mobile, sign-in challenge and change-mobile screens is disabled until a code may go and shows the
// time left as H:MM:SS; it counts from the provider's seconds when a refusal carries them, otherwise from the device's
// copy of the ladder (auth.js nextSendAt, stubbed here), and with neither the plain sentence stands. The harness holds
// intervals until a test ticks them, and each test moves the page's clock itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-support.mjs';

// the screen's look at the device's count is asynchronous; let it land
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const sendButton = (h) => { const b = h.nodes('BUTTON').find((n) => /^Send (verification code|code to the new number|again in )/.test(n.textContent)); assert.ok(b, 'Send button missing'); return b; };
const fail = (code, message) => Object.assign(new Error(message), { code });

test('the countdown reads hours, minutes and seconds: 0:00:30, 0:12:48, 6:00:00, and a whole day as 24:00:00', async (t) => {
  const h = await uiFixture(t, { signedIn: false });
  assert.equal(h.api.hms(30), '0:00:30'); assert.equal(h.api.hms(768), '0:12:48'); assert.equal(h.api.hms(6 * 3600), '6:00:00'); assert.equal(h.api.hms(86_400), '24:00:00');
  assert.equal(h.api.hms(29.2), '0:00:30', 'a part of a second still to wait shows as a whole one'); assert.equal(h.api.hms(0), '0:00:00'); assert.equal(h.api.hms(-5), '0:00:00');
});

test('after a code the verify-mobile Send button is disabled and counts down each second in H:MM:SS, sends nothing while disabled, and comes back at zero with no clock left running', async (t) => {
  let now = Date.now(), last = 0; const sends = [];
  const h = await uiFixture(t, { signedIn: false, clock: () => now });
  // a wait as the device's count might hold one for this number: thirty seconds after the last code, whichever rung that is
  h.setAuth('parentA', { signIn: async () => ({ stage: 'enroll' }), sendCode: async (phone) => { sends.push(phone); last = now; },
    nextSendAt: async (phone) => (phone === '+6281234567890' && last ? last + 30_000 : 0) });
  await h.submitLogin(); await settle();
  assert.equal(sendButton(h).textContent, 'Send verification code'); assert.ok(!sendButton(h).disabled, 'nothing sent yet: nothing to wait for');
  h.nodes('INPUT')[0].value = '+62 812 3456 7890'; await h.click('Send verification code');
  const send = sendButton(h);
  assert.equal(send.disabled, true); assert.equal(send.textContent, 'Send again in 0:00:30'); assert.equal(h.intervals(), 1, 'one clock ticks');
  now += 18_000; h.tick(); assert.equal(send.textContent, 'Send again in 0:00:12');
  await send.onclick(); assert.deepEqual(sends, ['+6281234567890'], 'a disabled button sends nothing');
  now += 11_000; h.tick(); assert.equal(send.textContent, 'Send again in 0:00:01'); assert.equal(send.disabled, true);
  now += 1_000; h.tick(); assert.equal(send.disabled, false); assert.equal(send.textContent, 'Send verification code'); assert.equal(h.intervals(), 0, 'the clock stops at zero');
  await h.click('Send verification code'); assert.equal(sends.length, 2, 'the next code goes once the wait is over'); assert.equal(sendButton(h).textContent, 'Send again in 0:00:30');
});

test('a refused send counts down from the provider\'s seconds when they arrive, from the device\'s estimate when they do not, and with neither shows the plain sentence and no clock', async (t) => {
  let now = Date.now(), next = null, estimate = 0;
  const h = await uiFixture(t, { signedIn: false, clock: () => now });
  h.setAuth('parentA', { signIn: async () => ({ stage: 'challenge', phone: '+*******7890', email: 'synthetic@example.test' }), sendCode: async () => { throw next; }, nextSendAt: async () => estimate });
  await h.submitLogin(); await settle(); assert.ok(h.root.textContent.includes('Your second security check'));
  const send = sendButton(h); assert.ok(!send.disabled);
  // the provider relayed SMS_WAIT:768 — auth.js hands the seconds on (refusalSeconds, public/sms-schedule.js)
  next = Object.assign(Error('Too many codes were sent to this number recently. Try again when the countdown on the Send button reaches zero.'), { waitSeconds: 768 });
  await h.click('Send verification code');
  assert.equal(send.textContent, 'Send again in 0:12:48'); assert.equal(send.disabled, true); assert.ok(h.message.textContent.includes('countdown'), h.message.textContent);
  now += 767_000; h.tick(); assert.equal(send.textContent, 'Send again in 0:00:01'); now += 1_000; h.tick(); assert.equal(send.disabled, false); assert.equal(h.intervals(), 0);
  // the provider's bare internal error, no seconds: the device's own count
  next = fail('auth/internal-error', 'Firebase: Error (auth/internal-error).'); estimate = now + 5 * 60_000;
  await h.click('Send verification code');
  assert.equal(send.textContent, 'Send again in 0:05:00'); assert.equal(send.disabled, true); assert.ok(h.message.textContent.includes('spaced out'), h.message.textContent);
  now += 300_000; h.tick(); assert.equal(send.disabled, false); assert.equal(send.textContent, 'Send verification code'); assert.equal(h.intervals(), 0);
  // neither: the plain sentence, and the button stays usable
  estimate = 0; await h.click('Send verification code');
  assert.equal(send.disabled, false); assert.equal(send.textContent, 'Send verification code'); assert.equal(h.intervals(), 0);
  assert.ok(h.message.textContent.includes('could not send a code'), h.message.textContent);
  // a refusal that is not the ladder's gets no clock, even when the device has an estimate
  estimate = now + 60_000; next = fail('auth/invalid-phone-number', 'Firebase: Error (auth/invalid-phone-number).');
  await h.click('Send verification code'); assert.equal(send.disabled, false); assert.ok(h.message.textContent.includes('not valid'), h.message.textContent);
});

test('a challenge opened inside a wait starts disabled and counting, and replacing the screen stops its clock', async (t) => {
  let now = Date.now();
  const h = await uiFixture(t, { signedIn: false, clock: () => now });
  h.setAuth('parentA', { signIn: async () => ({ stage: 'challenge', phone: '+*******7890', email: 'synthetic@example.test' }), sendCode: async () => {}, nextSendAt: async () => now + 6 * 3600_000 });
  await h.submitLogin(); await settle();
  const send = sendButton(h); assert.equal(send.textContent, 'Send again in 6:00:00'); assert.equal(send.disabled, true); assert.equal(h.intervals(), 1);
  now += 1000; h.tick(); assert.equal(send.textContent, 'Send again in 5:59:59');
  await h.click('I can’t receive the code'); assert.ok(h.root.textContent.includes('Lost your phone?')); assert.equal(h.intervals(), 0, 'no interval outlives its screen');
});

test('the change-mobile Send button counts the wait of the number typed, lets a different number go at once, and its clock stops on Cancel', async (t) => {
  let now = Date.now(); const sent = [];
  const h = await uiFixture(t, { clock: () => now });
  h.setAuth('parentA', { changeMobileSend: async (phone) => { sent.push(phone); }, nextSendAt: async (phone) => (phone === '+6581234567' ? now + 86_400_000 : 0) });
  await h.click('Change my mobile number'); await h.submitLogin(); await settle(); assert.ok(h.root.textContent.includes('CHANGE MOBILE'));
  const [phone, consent] = h.nodes('INPUT'); consent.checked = true;
  phone.value = '+65 8123 4567'; phone.events.input(); await settle();
  const send = sendButton(h); assert.equal(send.textContent, 'Send again in 24:00:00'); assert.equal(send.disabled, true);
  await send.onclick(); assert.deepEqual(sent, [], 'nothing is asked of the provider while the clock runs');
  phone.value = '+65 8123 4568'; phone.events.input(); await settle();
  assert.equal(send.disabled, false); assert.equal(send.textContent, 'Send code to the new number'); assert.equal(h.intervals(), 0, 'another number has no wait of its own');
  phone.value = '+6581234567'; phone.events.input(); await settle(); assert.equal(send.disabled, true); assert.equal(h.intervals(), 1);
  await h.click('Cancel'); assert.equal(h.intervals(), 0); assert.ok(h.root.textContent.includes('Change my mobile number'), 'back in the workspace');
});
