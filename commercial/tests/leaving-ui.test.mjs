// Leaving, part four: the page. Mission Control's "Cancel or pause" and the unsubscribe link both open the same flow; it names
// what will and will not change before anything is chosen, nothing is sent until a tap, an offer the server did not make cannot
// be taken, and cancelling still passes through its own confirmation and the existing billing route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { uiFixture, nodes } from './ui-support.mjs';
import { secret } from './support.mjs';
import { signWebhook } from '../server/payments.mjs';
import { signEmailToken, linkExpiry } from '../server/email.mjs';
import { monthsAfter } from '../server/subscription.mjs';

const DAY = 86_400_000, WEEK = '2026-W35';
/** The harness's family, paying for `plan` through the fake provider: a checkout and its signed completion, off the page. */
async function subscribe(h, plan = 'big') {
  const f = h.f, co = await f.payments.checkout(h.a.ctx, { plan, operationId: randomUUID() });
  const ev = { id: `evt_${randomUUID()}`, type: 'checkout.completed', at: f.now(), customer: co.customerRef, data: { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * DAY, checkoutId: co.checkoutId } };
  const raw = Buffer.from(JSON.stringify(ev));
  const out = await f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook('c3'.repeat(32), raw, f.now()), 'content-type': 'application/json' });
  assert.equal(out.status, 'applied');
  await h.api.refresh();
  return { co, periodEnd: f.now() + 30 * DAY };
}
const leavingRows = async (h) => (await h.f.store.entries(`families/${h.a.familyId}/leaving`)).map(([, r]) => r);
const subOf = async (h) => (await h.f.store.get(`families/${h.a.familyId}`)).subscription;
const pick = (h, value) => { const i = nodes(h.root, 'INPUT').find((x) => x.type === 'radio' && x.value === value); assert.ok(i, `no reason ${value}`); i.checked = true; return i; };
const text = (h) => h.root.textContent;

test('UI: the flow names what will and will not change, asks why, and writes nothing until a tap', async (t) => {
  const h = await uiFixture(t);
  await subscribe(h, 'big');
  assert.ok(text(h).includes('Cancel or pause'), 'Mission Control offers the flow, not a bare cancel button');
  assert.ok(!text(h).includes('Cancel at the end of the period'), 'the one-tap cancel is gone: it is inside the flow now');
  await h.click('Cancel or pause');
  assert.ok(text(h).includes('tell us why you are thinking of leaving'));
  assert.ok(text(h).includes('Your children keep their profiles, their progress and their coins'));
  assert.ok(text(h).includes('Big family plan, 6 child slots, paid to'), 'what is paid for, and until when');
  assert.equal(nodes(h.root, 'INPUT').filter((i) => i.type === 'radio').length, 7, 'the seven reasons');
  assert.equal(nodes(h.root, 'TEXTAREA')[0].maxLength, 500);
  await h.click('Continue');
  assert.ok(h.message.textContent.includes('Choose one reason first.'), h.message.textContent);
  assert.equal(h.requests.filter((r) => r.path === '/api/leaving' || r.path === '/api/leaving/offers').length, 0, 'no reason, no request');
  assert.deepEqual(await leavingRows(h), [], 'and nothing recorded by looking at the page');
  await h.click('Back'); assert.ok(text(h).includes('MISSION CONTROL'));
  assert.deepEqual(await leavingRows(h), []);
});

test('UI: too expensive offers the smaller plan and fewer seats; taking a break offers the pause, and one tap does it', async (t) => {
  const h = await uiFixture(t);
  const { periodEnd } = await subscribe(h, 'big'); // 6 slots, one child seated
  await h.click('Cancel or pause'); pick(h, 'too_expensive');
  nodes(h.root, 'TEXTAREA')[0].value = '  it is more than we can spend  ';
  await h.click('Continue');
  assert.ok(text(h).includes('Switch to the smaller Family plan at renewal (4 slots)'));
  assert.ok(text(h).includes('Fewer seats at renewal: Starter, 2 slots'));
  assert.equal(h.requests.filter((r) => r.path === '/api/leaving').length, 0, 'the offers are read only: nothing submitted yet');
  await h.click('Switch to the smaller Family plan at renewal (4 slots)');
  assert.ok(h.message.textContent.includes('Scheduled: Family from the next renewal'), h.message.textContent);
  const sub = await subOf(h);
  assert.deepEqual([sub.plan, sub.scheduled.plan], ['big', 'family'], 'nobody loses a seat before the renewal');
  const [rec] = await leavingRows(h);
  assert.deepEqual([rec.reason, rec.action, rec.offerAccepted, rec.toPlan, rec.plan, rec.seats, rec.source, rec.outcome], ['too_expensive', 'downgrade', 'downgrade', 'family', 'big', 6, 'app', 'done']);
  assert.deepEqual(rec.offersShown, ['downgrade', 'seats']);
  assert.equal(rec.freeText, 'it is more than we can spend', 'the parent\'s own words, trimmed');
  assert.equal(rec.cohort, new Date(h.f.now()).toISOString().slice(0, 7));
  assert.ok(!JSON.stringify(rec).includes('Test family') && !JSON.stringify(rec).includes('@'), 'no name and no address in the record');
  // and a pause, on another family: the second door of the same flow
  const g = await uiFixture(t);
  const paid = await subscribe(g, 'family');
  await g.click('Cancel or pause'); pick(g, 'taking_a_break'); await g.click('Continue');
  assert.ok(text(g).includes('A pause keeps everything as it is and collects nothing'));
  for (const months of [1, 2, 3]) assert.ok(text(g).includes(`Pause for ${months} month${months === 1 ? '' : 's'}`), String(months));
  await g.click('Pause for 2 months');
  assert.ok(g.message.textContent.includes('Paused for 2 months.'), g.message.textContent);
  assert.deepEqual((await subOf(g)).pause, { months: 2, pausedAt: g.f.now(), resumesAt: monthsAfter(paid.periodEnd, 2), by: 'parent', echoed: false });
  assert.ok(text(g).includes('Start my subscription again now'), 'Mission Control says how to end it');
  assert.ok(text(g).includes('Paused: the period you have paid for runs to'));
  await g.click('Start my subscription again now');
  assert.equal((await subOf(g)).pause, null); assert.ok(g.message.textContent.includes('The pause is over.'));
  void periodEnd;
});

test('UI: too many emails offers monthly before off, and keeps the subscription', async (t) => {
  const h = await uiFixture(t);
  await subscribe(h, 'starter');
  await h.click('Cancel or pause'); pick(h, 'too_many_emails'); await h.click('Continue');
  const labels = nodes(h.root, 'BUTTON').map((b) => b.textContent);
  assert.ok(labels.indexOf('Send the progress report monthly instead of weekly') < labels.indexOf('Turn the progress report off, keep the subscription'), 'monthly is offered first');
  await h.click('Send the progress report monthly instead of weekly');
  assert.ok(h.message.textContent.includes('once a month, on the first Monday. Your subscription is unchanged.'), h.message.textContent);
  assert.equal((await h.f.store.get('emailPrefs/parentA')).cadence, 'monthly');
  assert.equal((await subOf(h)).state, 'active');
  const [rec] = await leavingRows(h);
  assert.deepEqual([rec.action, rec.cadence, rec.offerAccepted, rec.offersShown], ['reduce_email', 'monthly', 'email_monthly', ['email_monthly', 'email_off']]);
  assert.ok(text(h).includes('Send it monthly instead'), 'and Mission Control shows it');
  const monthlyBox = nodes(h.root, 'LABEL').find((l) => l.textContent.includes('Send it monthly instead')).children.find((c) => c.tagName === 'INPUT');
  assert.equal(monthlyBox.checked, true);
});

test('UI: technical problems cancel nothing yet — the feedback panel opens with the reason filled in', async (t) => {
  const h = await uiFixture(t);
  await subscribe(h, 'starter');
  await h.click('Cancel or pause'); pick(h, 'technical');
  nodes(h.root, 'TEXTAREA')[0].value = 'the timer jumps on my phone';
  await h.click('Continue');
  assert.ok(text(h).includes('Let us fix it first'));
  assert.ok(!nodes(h.root, 'BUTTON').some((b) => b.textContent === 'Cancel my subscription'), 'nothing to cancel on this screen');
  await h.click('Tell us what went wrong');
  const box = nodes(h.root, 'TEXTAREA').find((x) => x.maxLength === 2000);
  assert.ok(box, 'the feedback panel is open');
  assert.equal(box.value, 'Technical problems. the timer jumps on my phone', 'with the reason already typed in');
  assert.ok(h.message.textContent.includes('Nothing has been cancelled.'), h.message.textContent);
  assert.deepEqual(await leavingRows(h), [], 'and nothing recorded');
  await h.click('Send');
  assert.equal((await h.f.store.list('feedback')).length, 1);
  assert.equal((await subOf(h)).state, 'active', 'the subscription is untouched');
  // the parent who still wants to leave says so, and only then sees the way out
  const g = await uiFixture(t); await subscribe(g, 'starter');
  await g.click('Cancel or pause'); pick(g, 'technical'); await g.click('Continue');
  await g.click('I still want to cancel');
  assert.ok(nodes(g.root, 'BUTTON').some((b) => b.textContent === 'Cancel my subscription'));
});

test('UI: cancelling passes through its own confirmation and the existing billing route; Keep records the reason and changes nothing', async (t) => {
  const h = await uiFixture(t);
  const { periodEnd } = await subscribe(h, 'family');
  await h.click('Cancel or pause'); pick(h, 'lost_interest'); await h.click('Continue');
  assert.deepEqual(nodes(h.root, 'BUTTON').filter((b) => b.textContent.startsWith('Pause for')).length, 0, 'no offer for this reason');
  await h.click('Cancel my subscription');
  assert.ok(text(h).includes('Cancel the subscription?'));
  assert.ok(text(h).includes('is not renewed after that'));
  assert.equal(h.requests.filter((r) => r.path === '/api/leaving').length, 0, 'one tap on Cancel sends nothing: only the confirmation screen does');
  assert.equal((await subOf(h)).cancelAtPeriodEnd, false);
  await h.click('Back'); assert.ok(text(h).includes('What would you like to do?'), 'Back returns to the choices, cancelling nothing');
  assert.equal((await subOf(h)).cancelAtPeriodEnd, false);
  await h.click('Cancel my subscription'); await h.click('Yes, cancel at the period end');
  assert.ok(h.message.textContent.includes('Cancelled. The grid stays open until'), h.message.textContent);
  const sub = await subOf(h);
  assert.equal(sub.cancelAtPeriodEnd, true); assert.equal(sub.periodEnd, periodEnd, 'access is not cut short');
  assert.deepEqual(h.f.gateway.calls.filter((c) => c[0] === 'setCancelAtPeriodEnd').length, 1, 'through the existing route, which tells the provider first');
  const [rec] = await leavingRows(h);
  assert.deepEqual([rec.reason, rec.action, rec.offerAccepted, rec.offersShown], ['lost_interest', 'cancel', null, []]);
  assert.ok(text(h).includes('Keep my subscription'), 'and Mission Control offers the way back');
  // another family says why and keeps everything: the reason is recorded, nothing else moves
  const g = await uiFixture(t); await subscribe(g, 'family');
  await g.click('Cancel or pause'); pick(g, 'something_else'); await g.click('Continue');
  const before = await subOf(g);
  await g.click('Keep everything as it is');
  assert.ok(g.message.textContent.includes('Nothing was changed.'));
  assert.deepEqual(await subOf(g), before);
  const [kept] = await leavingRows(g);
  assert.deepEqual([kept.action, kept.outcome, kept.reason], ['keep', 'noop', 'something_else']);
});

test('UI: the same flow from an email link, recorded as the email door; the offers are the server\'s, not the browser\'s', async (t) => {
  const h = await uiFixture(t, { location: async (f, parent) => ({ search: '', hash: `#email=${signEmailToken(secret, { a: 'unsub', v: 'progress', u: 'parentA', f: parent.familyId, w: WEEK, e: linkExpiry('unsub', WEEK) })}`, pathname: '/' }) });
  assert.ok(text(h).includes('Stop the weekly progress report'));
  assert.ok(text(h).includes('Once a month may be enough'), 'monthly before off');
  await h.click('It is not just the email — cancel or pause');
  assert.ok(text(h).includes('tell us why you are thinking of leaving'));
  pick(h, 'too_many_emails'); await h.click('Continue');
  await h.click('Turn the progress report off, keep the subscription');
  assert.equal((await h.f.store.get('emailPrefs/parentA')).cadence, 'off');
  const [rec] = await leavingRows(h);
  assert.deepEqual([rec.source, rec.action, rec.cadence, rec.offerAccepted], ['email', 'reduce_email', 'off', 'email_off']);
  // the browser cannot take an offer this server did not make: the flow asks the server again before it acts
  const g = await uiFixture(t); await subscribe(g, 'starter');
  await assert.rejects(g.api.getModel() && g.f.leaving.submit(g.a.ctx, { reason: 'lost_interest', action: 'pause', months: 3, offerAccepted: 'pause', operationId: randomUUID() }), (e) => e.code === 'OFFER_NOT_OFFERED');
  assert.equal((await subOf(g)).pause, null, 'and nothing was paused');
});
