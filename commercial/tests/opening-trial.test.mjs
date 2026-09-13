// The opening trial (the owner's launch plan, 13 Sep 2026): /join promises "free for every family until 10 October 2026, 23:59 WIB",
// and the server keeps it. A trial started between 19 Sep 2026 00:00 WIB and that moment runs to it however late it began, with a slot
// for each of up to four children; one started in the days before and still running when the doors open joins it; any other trial is
// the ordinary seven days with two slots. One trial per verified mobile, as always.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, rejected } from './support.mjs';
import { uiFixture } from './ui-support.mjs';
import { OPENING, inOpening, withOpening, transition, deriveState, entitlementFor, effectiveEntitlement, TRIAL_DAYS, PLANS } from '../server/subscription.mjs';

const DAY = 86_400_000, HOUR = 3_600_000, op = () => ({ operationId: randomUUID() });
const WIB = (local) => Date.parse(`${local}+07:00`);
const start = (at) => transition(null, { type: 'trial.start' }, at);

test('the moments are the page\'s: from 19 Sep 2026 00:00 WIB, until 10 Oct 2026 23:59 WIB — and /join counts with the same ones', async () => {
  assert.equal(OPENING.opensAt, WIB('2026-09-19T00:00:00')); assert.equal(OPENING.endsAt, WIB('2026-10-11T00:00:00'));
  assert.equal(OPENING.seats, 4); assert.equal(OPENING.name, 'Opening free trial');
  assert.deepEqual([OPENING.opensAt - 1, OPENING.opensAt, OPENING.endsAt - 1, OPENING.endsAt].map(inOpening), [false, true, true, false]);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('opensAt: Date.UTC(2026, 8, 18, 17)'), 'the page opens when the server does');
  assert.ok(app.includes('accessEndsAt: Date.UTC(2026, 9, 10, 17)'), 'and knows the moment the server closes every opening trial');
});

test('a trial started during the opening runs to its end however late it began, with four slots; before and after it, seven days and two', () => {
  for (const at of [OPENING.opensAt, WIB('2026-09-25T13:30:00'), OPENING.endsAt - HOUR, OPENING.endsAt - 1]) {
    const t = start(at), e = entitlementFor(t, at), label = new Date(at).toISOString();
    assert.deepEqual([t.trialEndsAt, t.seats], [OPENING.endsAt, 4], label);
    assert.deepEqual([e.status, e.state, e.seatLimit, e.accessUntil, e.trialEndsAt, e.planName], ['active', 'trial', 4, OPENING.endsAt, OPENING.endsAt, 'Opening free trial'], label);
    assert.equal(deriveState(t, OPENING.endsAt - 1), 'trial', label); assert.equal(deriveState(t, OPENING.endsAt), 'expired', `${label}: the same moment for everyone`);
  }
  for (const at of [WIB('2026-09-01T09:00:00'), OPENING.endsAt, OPENING.endsAt + 40 * DAY]) {
    const t = start(at), e = entitlementFor(t, at), label = new Date(at).toISOString();
    assert.deepEqual([t.trialEndsAt, t.seats, e.seatLimit, e.planName], [at + TRIAL_DAYS * DAY, PLANS.trial.seats, 2, '7-day free trial'], label);
  }
});

test('a trial started in the week before the doors open joins the opening; one that ended before they opened stays ended; the stored facts are never rewritten', () => {
  const early = start(OPENING.opensAt - 2 * DAY); // 17 Sep, 00:00 WIB: stored as the ordinary seven days with two slots
  assert.deepEqual([early.trialEndsAt, early.seats], [OPENING.opensAt + 5 * DAY, 2]);
  const e = entitlementFor(early, OPENING.opensAt - DAY);
  assert.deepEqual([e.state, e.accessUntil, e.trialEndsAt, e.seatLimit, e.planName], ['trial', OPENING.endsAt, OPENING.endsAt, 4, 'Opening free trial']);
  assert.equal(deriveState(early, OPENING.opensAt + 6 * DAY), 'trial', 'past its own seven days, inside the opening');
  assert.equal(deriveState(early, OPENING.endsAt), 'expired');
  assert.deepEqual([early.trialEndsAt, early.seats], [OPENING.opensAt + 5 * DAY, 2], 'nothing stored was changed');
  const ended = start(OPENING.opensAt - 8 * DAY); // over the day before the doors opened
  assert.equal(withOpening(ended), ended); assert.equal(deriveState(ended, OPENING.opensAt), 'expired');
  // cancelled during it: it runs to the opening's end and no further
  const cancelling = transition(early, { type: 'cancel.request' }, OPENING.opensAt + DAY);
  assert.equal(deriveState(cancelling, OPENING.endsAt - 1), 'trial'); assert.equal(deriveState(cancelling, OPENING.endsAt), 'cancelled');
  // paid for: an ordinary subscription, which the opening no longer touches
  const paid = transition(early, { type: 'payment.succeeded', plan: 'family', periodEnd: OPENING.endsAt + 30 * DAY, authorized: true }, OPENING.opensAt + DAY);
  assert.equal(withOpening(paid), paid); assert.equal(entitlementFor(paid, OPENING.opensAt + DAY).planName, 'Family');
});

test('through the service: a family in the opening seats four children and not a fifth, the billing view says what a trial gives, one trial per mobile, and the grid closes at 11 Oct 00:00 WIB', async () => {
  const f = fixture();
  f.advance(WIB('2026-09-19T03:00:00') - f.now());
  for (const uid of ['parentA', 'parentA2']) { f.token(uid); f.users.get(uid).multiFactor.enrolledFactors[0].phoneNumber = '+6281234560000'; }
  const a = await f.family('parentA', 0);
  const view = await f.billing.view(a.ctx);
  assert.deepEqual(view.trialOffer, { opening: true, endsAt: OPENING.endsAt, seats: 4 }); assert.equal(view.trial.eligible, true);
  const r = await f.billing.startTrial(a.ctx, op());
  assert.deepEqual([r.state, r.entitlement.seatLimit, r.entitlement.accessUntil, r.entitlement.planName], ['trial', 4, OPENING.endsAt, 'Opening free trial']);
  for (const name of ['Fox', 'Owl', 'Cat', 'Bee']) await f.child(a.ctx, name);
  await assert.rejects(f.child(a.ctx, 'Elk'), rejected('CHILD_LIMIT_REACHED'));
  const again = await f.family('parentA2', 0); // the same mobile under another email
  await assert.rejects(f.billing.startTrial(again.ctx, op()), rejected('TRIAL_ALREADY_USED'));
  const entitled = async () => effectiveEntitlement(await f.store.get(`families/${a.familyId}`), f.now()).status;
  f.advance(OPENING.endsAt - 1 - f.now()); assert.equal(await entitled(), 'active', '10 Oct, 23:59:59.999 WIB');
  f.advance(1); assert.equal(await entitled(), 'inactive', '11 Oct, 00:00 WIB: closed until the family subscribes');
  const g = fixture(), b = await g.family('parentB', 0); // before the opening, the ordinary offer
  assert.deepEqual((await g.billing.view(b.ctx)).trialOffer, { opening: false, endsAt: g.now() + TRIAL_DAYS * DAY, seats: 2 });
});

// The page, with its own clock and the server's moved together: sign-up, then the family's step, as a parent meets them.
async function signUpAt(t, clock) {
  const h = await uiFixture(t, { signedIn: false, family: false, clock });
  h.f.advance(clock() - h.f.now());
  h.api.signInScreen(true);
  h.setAuth('newParent', { signUp: async () => ({ stage: 'ready', idToken: h.f.token('newParent') }), idToken: async () => h.f.token('newParent') });
  h.nodes('INPUT').filter((i) => i.type === 'checkbox')[0].checked = true; // the terms
  await h.submitLogin();
  assert.ok(h.root.textContent.includes('Name your crew.'));
  h.nodes('INPUT')[0].value = 'Test crew'; await h.click('Create family workspace');
  return h;
}

test('the page: a family made during the opening starts its free trial with the family, and Mission Control names the one moment it ends', async (t) => {
  const h = await signUpAt(t, () => WIB('2026-09-19T08:00:00'));
  const text = h.root.textContent;
  assert.ok(text.includes('Opening free trial, ends 10 October 2026, 23:59 WIB.'), 'the end in WIB, the same words as /join');
  assert.ok(text.includes('0 / 4'), 'a slot for each of four children, waiting for the explorers');
  assert.ok(!text.includes('Start the free trial'), 'nothing left to start');
  assert.equal(h.requests.filter((r) => r.path === '/api/billing/trial').length, 1, 'started once, by the family\'s step');
});

test('the page: a family made before the doors open gets the ordinary offer and nothing starts by itself; once they open, Mission Control offers the opening trial', async (t) => {
  let now = WIB('2026-09-15T10:00:00');
  const h = await signUpAt(t, () => now);
  assert.ok(h.root.textContent.includes('Start the 7-day free trial'), 'before 19 September: the ordinary trial, on the parent\'s tap');
  assert.equal(h.requests.filter((r) => r.path === '/api/billing/trial').length, 0);
  now = WIB('2026-09-19T09:00:00'); h.f.advance(now - h.f.now());
  h.setAuth('newParent'); h.api.signInScreen(); await h.submitLogin(); // days later: a new session
  assert.ok(h.root.textContent.includes('a slot for each of up to 4 children, free until 10 October 2026, 23:59 WIB.'), h.root.textContent.slice(0, 300));
  await h.click('Start the free trial');
  assert.ok(h.root.textContent.includes('Opening free trial, ends 10 October 2026, 23:59 WIB.'));
});
