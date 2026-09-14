// Payments not open, the page (PAYMENT_PROVIDER=none): nothing that would reach a payment provider is drawn — no plan, checkout, change
// of plan or pause — and where the page would ask a family to subscribe it says one plain sentence instead, with no date: that the
// free access continues, to a family that has it. A free trial can still be cancelled. With payments open nothing changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { uiFixture } from './ui-support.mjs';
import { secret } from './support.mjs';
import { signEmailToken, linkExpiry } from '../server/email.mjs';

const WIB = (local) => Date.parse(`${local}+07:00`), DAY = 86_400_000, WEEK = '2026-W35';
const WITH_ACCESS = 'Subscriptions are not open yet and your free access continues.', WITHOUT_ACCESS = 'Subscriptions are not open yet.';
const buttons = (h) => h.nodes('BUTTON').map((b) => b.textContent);
/** Nothing on the screen that would reach a provider, and no request to subscribe. */
function noProviderControls(h, where) {
  for (const re of [/^(Starter|Family|Big family): \d child slots$/, /^Upgrade to /, /^Switch to /, /^Pause for /, /^Start my subscription again now$/, /^Keep my current plan instead$/, /cancel or pause$/i])
    assert.ok(!buttons(h).some((b) => re.test(b)), `${where}: a button matches ${re}: ${buttons(h).join(' | ')}`);
  for (const words of ['Subscribe before then', 'Subscribe again', 'subscribe again', 'Choose a plan to subscribe', 'Prices are shown at checkout', 'Payment reference', 'CANCEL OR PAUSE'])
    assert.ok(!h.root.textContent.includes(words), `${where}: "${words}"`);
}
const providerRoutes = (h) => h.requests.filter((r) => /^\/api\/billing\/(checkout|plan|pause|resume)$/.test(r.path));
/** Sign-up and the family's step, the page's clock and the server's moved together (tests/opening-trial.test.mjs). */
async function signUpAt(t, clock, provider = 'none') {
  const h = await uiFixture(t, { signedIn: false, family: false, clock, provider, location: async (f) => { f.advance(clock() - f.now()); return null; } });
  h.api.signInScreen(true);
  h.setAuth('newParent', { signUp: async () => ({ stage: 'ready', idToken: h.f.token('newParent') }), idToken: async () => h.f.token('newParent') });
  const [terms, emails] = h.nodes('INPUT').filter((i) => i.type === 'checkbox'); terms.checked = true; emails.checked = true;
  await h.submitLogin();
  h.nodes('INPUT')[0].value = 'Test crew'; await h.click('Create family workspace');
  return h;
}

test('UI, payments not open: a family on the opening trial sees its trial and one sentence, never a plan, checkout, change of plan or pause, and can still cancel the trial', async (t) => {
  const h = await signUpAt(t, () => WIB('2026-09-20T08:00:00'));
  const text = h.root.textContent;
  assert.ok(text.includes('Opening free trial, ends 10 October 2026, 23:59 WIB.'), text.slice(0, 400));
  assert.equal(text.split(WITH_ACCESS).length - 1, 1, 'the sentence, exactly once'); assert.ok(!text.includes(`${WITH_ACCESS.slice(0, -1)} `), 'and nothing tacked on');
  noProviderControls(h, 'Mission Control');
  assert.ok(buttons(h).includes('Cancel the free trial'));
  await h.click('Cancel the free trial');
  assert.ok(h.root.textContent.includes('tell us why you are thinking of leaving'));
  noProviderControls(h, 'the reasons');
  h.nodes('INPUT').find((x) => x.type === 'radio' && x.value === 'taking_a_break').checked = true; await h.click('Continue');
  assert.ok(h.root.textContent.includes(WITH_ACCESS), 'the sentence where the alternatives to leaving would be');
  noProviderControls(h, 'the offers');
  await h.click('Cancel my subscription');
  assert.ok(h.root.textContent.includes(WITH_ACCESS)); noProviderControls(h, 'the confirmation');
  await h.click('Yes, cancel at the period end');
  assert.ok(h.message.textContent.includes('Cancelled.'), h.message.textContent);
  assert.equal((await h.f.store.get(`families/${h.api.getModel().family.id}`)).subscription.cancelAtPeriodEnd, true);
  assert.ok(buttons(h).includes('Keep my subscription'), 'and it can be kept again from Mission Control');
  noProviderControls(h, 'Mission Control after cancelling');
  assert.deepEqual(providerRoutes(h), [], 'no request to a provider route was ever made');
});

test('UI, payments open: the same family sees the plans, the subscribe line and Cancel or pause, as before', async (t) => {
  const h = await signUpAt(t, () => WIB('2026-09-20T08:00:00'), 'fake');
  const text = h.root.textContent;
  assert.ok(text.includes('Opening free trial, ends 10 October 2026, 23:59 WIB. Subscribe before then to keep going.'), text.slice(0, 400));
  for (const label of ['Starter: 2 child slots', 'Family: 4 child slots', 'Big family: 6 child slots', 'Cancel or pause']) assert.ok(buttons(h).includes(label), label);
  assert.ok(text.includes('Choose a plan to subscribe. Prices are shown at checkout.'));
  assert.ok(!text.includes(WITHOUT_ACCESS), 'no word of subscriptions not being open');
  await h.click('Cancel or pause'); assert.ok(h.root.textContent.includes('CANCEL OR PAUSE'));
});

test('UI, payments not open, during the opening: the free trial starts with the family and the full sentence shows beside it; once the opening is over the short one, and never a plan', async (t) => {
  let now = WIB('2026-09-15T10:00:00');
  const h = await signUpAt(t, () => now);
  assert.equal(h.requests.filter((r) => r.path === '/api/billing/trial').length, 1, 'started once, by the family\'s step, as with payments open');
  assert.ok(h.root.textContent.includes('Opening free trial, ends 10 October 2026, 23:59 WIB.'), h.root.textContent.slice(0, 400));
  assert.ok(h.root.textContent.includes(WITH_ACCESS), 'on the trial: the free access continues'); noProviderControls(h, 'the opening trial');
  now = WIB('2026-10-12T10:00:00'); h.f.advance(now - h.f.now()); // the opening has ended
  await h.api.refresh(); h.setAuth('newParent'); h.api.signInScreen(); await h.submitLogin();
  assert.ok(h.root.textContent.includes('The subscription expired.'), h.root.textContent.slice(0, 400));
  assert.ok(h.root.textContent.includes(WITHOUT_ACCESS) && !h.root.textContent.includes(WITH_ACCESS), 'no access: nothing is said to continue');
  noProviderControls(h, 'expired');
  assert.deepEqual(providerRoutes(h), []);
});

test('UI, payments not open, after the opening: the 7-day free trial is offered beside the short sentence; on the trial the full one; once it is over the short one again, and never a plan', async (t) => {
  let now = WIB('2026-10-12T10:00:00');
  const h = await signUpAt(t, () => now);
  assert.ok(h.root.textContent.includes('Start the 7-day free trial'));
  assert.ok(h.root.textContent.includes(WITHOUT_ACCESS) && !h.root.textContent.includes(WITH_ACCESS), 'no access yet: nothing is said to continue');
  noProviderControls(h, 'no subscription');
  await h.click('Start the 7-day free trial');
  assert.ok(h.root.textContent.includes(WITH_ACCESS), h.root.textContent.slice(0, 400)); noProviderControls(h, 'the ordinary trial');
  now = WIB('2026-10-20T10:00:00'); h.f.advance(now - h.f.now()); // past its seven days
  await h.api.refresh(); h.setAuth('newParent'); h.api.signInScreen(); await h.submitLogin();
  assert.ok(h.root.textContent.includes('The subscription expired.'), h.root.textContent.slice(0, 400));
  assert.ok(h.root.textContent.includes(WITHOUT_ACCESS) && !h.root.textContent.includes(WITH_ACCESS), 'no access: nothing is said to continue');
  noProviderControls(h, 'expired');
  assert.deepEqual(providerRoutes(h), []);
});

test('UI, payments not open: a paid plan on the record (an operator\'s event) shows no way to cancel, pause, resume or change it', async (t) => {
  const h = await uiFixture(t, { provider: 'none' }), f = h.f, id = h.a.familyId;
  await f.billing.apply(id, { id: randomUUID(), type: 'payment.succeeded', plan: 'family', periodEnd: f.now() + 30 * DAY, provider: 'manual' }, 'ops@example.test');
  await h.api.refresh();
  assert.ok(h.root.textContent.includes('Family plan, 4 child slots.'), h.root.textContent.slice(0, 400));
  noProviderControls(h, 'active'); assert.ok(!buttons(h).includes('Cancel the free trial') && !buttons(h).includes('Keep my subscription'));
  // paused (as a provider's echo left it before this project stopped taking payments): within the paid period, then after it
  await f.billing.apply(id, { id: randomUUID(), type: 'pause.start', by: 'provider', resumesAt: f.now() + 60 * DAY }, 'ops@example.test');
  await h.api.refresh();
  assert.ok(h.root.textContent.includes('Paused: the period you have paid for runs to')); noProviderControls(h, 'paused in its paid period');
  f.advance(31 * DAY); await h.api.refresh(); h.setAuth('parentA'); h.api.signInScreen(); await h.submitLogin();
  assert.ok(h.root.textContent.includes('Family plan, paused.'), h.root.textContent.slice(0, 400)); noProviderControls(h, 'paused');
  assert.deepEqual(providerRoutes(h), []);
});

test('UI, payments not open: the unsubscribe link offers the way to cancel a free trial, with no pause named', async (t) => {
  const link = (familyId) => `#email=${signEmailToken(secret, { a: 'unsub', v: 'progress', u: 'parentA', f: familyId, w: WEEK, e: linkExpiry('unsub', WEEK) })}`;
  const h = await uiFixture(t, { provider: 'none', location: async (f, parent) => {
    const { entitlement, ...family } = await f.store.get(`families/${parent.familyId}`); void entitlement; // the harness's pilot grant goes, so the trial can start
    await f.store.put(`families/${parent.familyId}`, family); await f.billing.startTrial(parent.ctx, { operationId: randomUUID() });
    return { search: '', hash: link(parent.familyId), pathname: '/' };
  } });
  assert.ok(h.root.textContent.includes('Stop the weekly progress report'), h.root.textContent.slice(0, 300));
  assert.ok(buttons(h).includes('It is not just the email — cancel the free trial')); noProviderControls(h, 'the email button');
  await h.click('It is not just the email — cancel the free trial');
  assert.ok(h.root.textContent.includes('tell us why you are thinking of leaving')); noProviderControls(h, 'the flow from the email');
});
