// Leaving, part one: the reasons, the offer rules (reason → offers, the 90-day cap), the month and cohort arithmetic, the shape
// of the record, and the monthly report's sums. All pure: no store, no clock, no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, rejected, webhookSecret } from './support.mjs';
import { signWebhook } from '../server/payments.mjs';
import { LEAVING_REASONS, LEAVING_ACTIONS, OFFER_KINDS, OFFER_WINDOW_MS, OFFERS_MAX, FREE_TEXT_MAX, LEAVING_TTL_MS, PAUSE_MONTHS, EMAIL_CADENCES,
  monthKey, monthRange, monthsBefore, monthsAfter, cohortOf, smallerPlan, fewestSeatsPlan, offersFor, offerAllowed,
  readLeavingInput, leavingRecord, lastOffersAt, volumeOf, summariseLeaving } from '../server/leaving.mjs';
import { PLANS } from '../server/subscription.mjs';

const DAY = 86_400_000, NOW = Date.parse('2026-09-12T04:00:00Z');
const paid = (more = {}) => ({ state: 'active', plan: 'family', cadence: 'weekly', seatedChildren: 2, now: NOW, ...more });
const kinds = (r) => r.offers.map((o) => o.kind);

test('the reasons and actions are a closed list, and the offer window is 90 days', () => {
  assert.deepEqual([...LEAVING_REASONS], ['too_expensive', 'not_using', 'lost_interest', 'too_many_emails', 'technical', 'taking_a_break', 'something_else']);
  assert.deepEqual([...LEAVING_ACTIONS], ['keep', 'reduce_email', 'pause', 'downgrade', 'cancel']);
  assert.deepEqual([...EMAIL_CADENCES], ['weekly', 'monthly', 'off']);
  assert.deepEqual([...PAUSE_MONTHS], [1, 2, 3]);
  assert.equal(OFFER_WINDOW_MS, 90 * DAY); assert.equal(OFFERS_MAX, 2); assert.equal(FREE_TEXT_MAX, 500); assert.equal(LEAVING_TTL_MS, 400 * DAY);
  for (const r of LEAVING_REASONS) assert.ok(offersFor({ ...paid(), reason: r }).offers.length <= OFFERS_MAX, r);
  for (const o of OFFER_KINDS) assert.ok(['email_monthly', 'email_off', 'pause', 'downgrade', 'seats', 'feedback'].includes(o));
});

test('too many emails: monthly before off, and only what the family does not already have', () => {
  assert.deepEqual(kinds(offersFor({ ...paid(), reason: 'too_many_emails' })), ['email_monthly', 'email_off']);
  assert.deepEqual(kinds(offersFor({ ...paid({ cadence: 'monthly' }), reason: 'too_many_emails' })), ['email_off'], 'monthly already: only off is left to offer');
  assert.deepEqual(kinds(offersFor({ ...paid({ cadence: 'off' }), reason: 'too_many_emails' })), [], 'the report is off already');
  // the email offers do not depend on the subscription: a family on no plan at all can still be asked to read less
  assert.deepEqual(kinds(offersFor({ reason: 'too_many_emails', state: 'none', plan: null, cadence: 'weekly', now: NOW })), ['email_monthly', 'email_off']);
});

test('taking a break or not using it: a pause of 1, 2 or 3 months, and only on a paid subscription that is active and not ending', () => {
  for (const reason of ['taking_a_break', 'not_using']) {
    const r = offersFor({ ...paid(), reason });
    assert.deepEqual(kinds(r), ['pause']); assert.deepEqual(r.offers[0].months, [1, 2, 3]); assert.equal(r.hold, false);
  }
  assert.deepEqual(kinds(offersFor({ ...paid({ cancelAtPeriodEnd: true }), reason: 'taking_a_break' })), [], 'a cancellation is pending: a pause would quietly undo it');
  assert.deepEqual(kinds(offersFor({ ...paid({ paused: true }), reason: 'taking_a_break' })), [], 'paused already');
  for (const state of ['grace', 'past_due', 'trial', 'cancelled', 'expired', 'none', 'paused']) {
    assert.deepEqual(kinds(offersFor({ ...paid({ state }), reason: 'not_using' })), [], state);
  }
  assert.deepEqual(kinds(offersFor({ ...paid({ plan: 'trial' }), reason: 'not_using' })), [], 'a trial collects nothing, so there is nothing to pause');
});

test('too expensive: the smaller plan, and fewer seats at the next renewal when that is a different plan again', () => {
  assert.deepEqual([smallerPlan('big'), smallerPlan('family'), smallerPlan('starter'), smallerPlan('trial')], ['family', 'starter', null, null]);
  assert.deepEqual([fewestSeatsPlan('big', 2), fewestSeatsPlan('big', 3), fewestSeatsPlan('big', 6), fewestSeatsPlan('starter', 1)], ['starter', 'family', null, null]);
  const big = offersFor({ ...paid({ plan: 'big', seatedChildren: 2 }), reason: 'too_expensive' });
  assert.deepEqual(kinds(big), ['downgrade', 'seats']);
  assert.deepEqual(big.offers.map((o) => [o.plan, o.seats]), [['family', PLANS.family.seats], ['starter', PLANS.starter.seats]]);
  const four = offersFor({ ...paid({ plan: 'big', seatedChildren: 4 }), reason: 'too_expensive' });
  assert.deepEqual(kinds(four), ['downgrade'], 'the smallest plan that still seats four children is the smaller plan itself: one offer, not two');
  assert.deepEqual(kinds(offersFor({ ...paid({ plan: 'starter', seatedChildren: 1 }), reason: 'too_expensive' })), [], 'already the smallest plan');
  assert.deepEqual(kinds(offersFor({ ...paid({ plan: 'big', state: 'grace', seatedChildren: 2 }), reason: 'too_expensive' })), ['downgrade', 'seats'], 'in grace a downgrade can still be scheduled');
  for (const state of ['past_due', 'cancelled', 'expired', 'trial', 'none']) assert.deepEqual(kinds(offersFor({ ...paid({ state }), reason: 'too_expensive' })), [], state);
});

test('technical problems hold the flow: the feedback panel, and nothing cancelled yet; a reason with no alternative offers none', () => {
  const r = offersFor({ ...paid(), reason: 'technical' });
  assert.deepEqual(kinds(r), ['feedback']); assert.equal(r.hold, true, 'cancel nothing yet');
  for (const reason of ['lost_interest', 'something_else']) {
    const none = offersFor({ ...paid(), reason });
    assert.deepEqual(kinds(none), []); assert.equal(none.hold, false);
  }
  assert.deepEqual(offersFor({ ...paid(), reason: 'nonsense' }), { offers: [], capped: false, hold: false });
});

test('the 90-day cap: a family shown offers once is shown none again until the window has passed, whatever the reason', () => {
  for (const reason of LEAVING_REASONS) {
    const capped = offersFor({ ...paid({ plan: 'big' }), reason, lastOffersAt: NOW - OFFER_WINDOW_MS + 1 });
    assert.deepEqual(capped.offers, [], reason); assert.equal(capped.capped, true, reason); assert.equal(capped.hold, false, `${reason}: nothing is held back when nothing is offered`);
  }
  const edge = offersFor({ ...paid({ plan: 'big' }), reason: 'too_expensive', lastOffersAt: NOW - OFFER_WINDOW_MS });
  assert.equal(edge.capped, false); assert.deepEqual(kinds(edge), ['downgrade', 'seats'], '90 days exactly: the window has passed');
  assert.equal(offersFor({ ...paid(), reason: 'too_expensive', lastOffersAt: null }).capped, false);
  assert.equal(offersFor({ ...paid(), reason: 'too_expensive', lastOffersAt: 'soon' }).capped, false, 'nonsense is no record of an offer');
  // the newest record with offers is the one the window counts from; records without offers never start one
  assert.equal(lastOffersAt([]), null);
  assert.equal(lastOffersAt([{ at: 5, offersShown: [] }, { at: 9, offersShown: [] }]), null);
  assert.equal(lastOffersAt([{ at: 5, offersShown: ['pause'] }, { at: 9, offersShown: [] }, { at: 7, offersShown: ['email_off'] }]), 7);
});

test('an accepted offer must be one of the offers the server decided to show', () => {
  const { offers } = offersFor({ ...paid({ plan: 'big' }), reason: 'too_expensive' });
  assert.equal(offerAllowed(offers, null), true); assert.equal(offerAllowed(offers, 'downgrade'), true); assert.equal(offerAllowed(offers, 'seats'), true);
  assert.equal(offerAllowed(offers, 'pause'), false); assert.equal(offerAllowed([], 'email_off'), false);
});

test('months: the key, the range, the months before, and calendar months after an instant, clamped to the end of the month', () => {
  assert.equal(monthKey(Date.parse('2026-09-12T23:59:59Z')), '2026-09');
  assert.deepEqual(monthRange('2026-09'), { start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 1) });
  assert.deepEqual(monthRange('2026-12'), { start: Date.UTC(2026, 11, 1), end: Date.UTC(2027, 0, 1) });
  for (const bad of ['2026-13', '2026-00', '26-09', '2026-9', 'soon', '1999-09', null, 5]) assert.equal(monthRange(bad), null, String(bad));
  assert.deepEqual(monthsBefore('2026-09', 3), ['2026-08', '2026-07', '2026-06']);
  assert.deepEqual(monthsBefore('2026-01', 3), ['2025-12', '2025-11', '2025-10']);
  assert.deepEqual(monthsBefore('nope', 3), []);
  assert.equal(new Date(monthsAfter(Date.parse('2026-09-12T04:00:00Z'), 1)).toISOString(), '2026-10-12T04:00:00.000Z');
  assert.equal(new Date(monthsAfter(Date.parse('2026-01-31T09:30:00Z'), 1)).toISOString(), '2026-02-28T09:30:00.000Z', '31 January plus a month is the end of February, never 3 March');
  assert.equal(new Date(monthsAfter(Date.parse('2028-01-31T00:00:00Z'), 1)).toISOString(), '2028-02-29T00:00:00.000Z', 'a leap year');
  assert.equal(new Date(monthsAfter(Date.parse('2026-11-30T00:00:00Z'), 3)).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.equal(new Date(monthsAfter(Date.parse('2026-12-15T00:00:00Z'), 2)).toISOString(), '2027-02-15T00:00:00.000Z');
  assert.equal(cohortOf({ createdAt: Date.parse('2026-07-02T00:00:00Z') }), '2026-07');
  assert.equal(cohortOf({}), null); assert.equal(cohortOf(null), null);
});

test('the record: what was asked, what was offered, what happened, and nothing that names anybody', () => {
  const id = randomUUID(), input = readLeavingInput({ reason: 'taking_a_break', freeText: '  we are away until December  ', action: 'pause', months: 2, offerAccepted: 'pause', operationId: id });
  assert.deepEqual(input, { reason: 'taking_a_break', freeText: 'we are away until December', action: 'pause', offerAccepted: 'pause', source: 'app', cadence: null, months: 2, plan: null });
  const at = NOW, rec = leavingRecord({ id, at, input, offersShown: [{ kind: 'pause', months: [1, 2, 3] }], plan: 'family', seats: 4, state: 'active', cohort: '2026-07' });
  assert.deepEqual(rec, { id, at, reason: 'taking_a_break', freeText: 'we are away until December', offersShown: ['pause'], offerAccepted: 'pause', action: 'pause', cadence: null, months: 2,
    toPlan: null, plan: 'family', seats: 4, state: 'active', cohort: '2026-07', source: 'app', outcome: 'done', expireAt: at + LEAVING_TTL_MS });
  assert.equal(rec.expireAt - at, 400 * DAY, 'the free text goes after 400 days, with the rest of the record');
  const bare = leavingRecord({ id, at, input: readLeavingInput({ reason: 'something_else', action: 'cancel', operationId: id }), offersShown: [], plan: null, seats: null, state: 'trial', cohort: null, outcome: 'noop' });
  assert.deepEqual([bare.freeText, bare.offersShown, bare.offerAccepted, bare.plan, bare.seats, bare.cohort, bare.outcome], [null, [], null, null, null, null, 'noop']);
  assert.equal(readLeavingInput({ reason: 'something_else', action: 'cancel', freeText: '', operationId: id }).freeText, null);
  assert.equal(readLeavingInput({ reason: 'something_else', action: 'cancel', freeText: '   ', operationId: id }).freeText, null, 'spaces are not words');
  assert.equal(readLeavingInput({ reason: 'too_many_emails', action: 'reduce_email', cadence: 'monthly', source: 'email', operationId: id }).source, 'email');
});

test('the record\'s input is read strictly: a reason and an action are required, and each action\'s own field with it', () => {
  const id = randomUUID(), base = { reason: 'something_else', action: 'cancel', operationId: id };
  for (const bad of [{ ...base, reason: 'bored' }, { ...base, reason: undefined }, { ...base, reason: null }]) assert.throws(() => readLeavingInput(bad), rejected('LEAVING_REASON_REQUIRED'));
  for (const bad of [{ ...base, action: 'refund' }, { ...base, action: undefined }]) assert.throws(() => readLeavingInput(bad), rejected('LEAVING_ACTION_REQUIRED'));
  assert.throws(() => readLeavingInput({ ...base, freeText: 'x'.repeat(FREE_TEXT_MAX + 1) }), rejected('INVALID_REQUEST'));
  assert.throws(() => readLeavingInput({ ...base, offerAccepted: 'a-free-month' }), rejected('INVALID_REQUEST'));
  assert.throws(() => readLeavingInput({ ...base, source: 'sms' }), rejected('INVALID_REQUEST'));
  assert.throws(() => readLeavingInput({ ...base, note: 'x' }), rejected('INVALID_REQUEST'));
  for (const cadence of [undefined, 'weekly', 'never', 5]) assert.throws(() => readLeavingInput({ ...base, action: 'reduce_email', cadence }), rejected('INVALID_REQUEST'));
  for (const months of [undefined, 0, 4, '2', 1.5]) assert.throws(() => readLeavingInput({ ...base, action: 'pause', months }), rejected('INVALID_MONTHS'));
  for (const plan of [undefined, 'trial', 'gold', 5]) assert.throws(() => readLeavingInput({ ...base, action: 'downgrade', plan }), rejected('INVALID_PLAN'));
  assert.equal(readLeavingInput({ ...base, action: 'downgrade', plan: 'starter' }).plan, 'starter');
  assert.equal(readLeavingInput({ ...base, action: 'pause', months: 3, plan: 'starter' }).plan, null, 'only the action\'s own field is kept');
});

test('the monthly sums: volume, each as a share of the active families at the month start, reasons ranked, offers shown against accepted, the mixes, the trend', () => {
  const rec = (more) => ({ at: Date.UTC(2026, 7, 10), reason: 'something_else', action: 'cancel', offersShown: [], offerAccepted: null, plan: 'family', seats: 4, cohort: '2026-06', ...more });
  const records = [
    rec({ reason: 'too_expensive', action: 'downgrade', offersShown: ['downgrade', 'seats'], offerAccepted: 'downgrade', plan: 'big', seats: 6, cohort: '2026-06' }),
    rec({ reason: 'too_expensive', action: 'cancel', offersShown: ['downgrade', 'seats'], offerAccepted: null, plan: 'big', seats: 6, cohort: '2026-07' }),
    rec({ reason: 'taking_a_break', action: 'pause', offersShown: ['pause'], offerAccepted: 'pause', plan: 'family', seats: 4, cohort: '2026-07' }),
    rec({ reason: 'too_many_emails', action: 'reduce_email', offersShown: ['email_monthly', 'email_off'], offerAccepted: 'email_monthly', plan: 'family', seats: 4, cohort: '2026-08' }),
    rec({ reason: 'technical', action: 'keep', offersShown: ['feedback'], offerAccepted: 'feedback', plan: 'starter', seats: 2, cohort: '2026-08' }),
    rec({ reason: 'lost_interest', action: 'cancel', offersShown: [], offerAccepted: null, plan: null, seats: null, cohort: null }),
  ];
  assert.deepEqual(volumeOf(records), { cancellations: 2, pauses: 1, downgrades: 1, emailOptOuts: 1, kept: 1, total: 6 });
  const s = summariseLeaving({ month: '2026-08', records, activeAtStart: 40, previous: [{ month: '2026-07', activeAtStart: 30, volume: { cancellations: 3, pauses: 0 } }, { month: '2026-06', activeAtStart: 20, volume: {} }] });
  assert.equal(s.month, '2026-08'); assert.equal(s.activeAtStart, 40); assert.equal(s.anything, true);
  assert.deepEqual(s.rate, { cancellations: 2 / 40, pauses: 1 / 40, downgrades: 1 / 40, emailOptOuts: 1 / 40 });
  assert.deepEqual(s.reasons, [{ key: 'too_expensive', n: 2 }, { key: 'lost_interest', n: 1 }, { key: 'taking_a_break', n: 1 }, { key: 'technical', n: 1 }, { key: 'too_many_emails', n: 1 }], 'ranked, ties by name');
  assert.deepEqual(s.offers, [{ kind: 'downgrade', shown: 2, accepted: 1, rate: 0.5 }, { kind: 'email_monthly', shown: 1, accepted: 1, rate: 1 }, { kind: 'email_off', shown: 1, accepted: 0, rate: 0 },
    { kind: 'feedback', shown: 1, accepted: 1, rate: 1 }, { kind: 'pause', shown: 1, accepted: 1, rate: 1 }, { kind: 'seats', shown: 2, accepted: 0, rate: 0 }]);
  assert.deepEqual(s.plans, [{ key: 'big', n: 2 }, { key: 'family', n: 2 }, { key: 'starter', n: 1 }, { key: 'none', n: 1 }].sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1)));
  assert.deepEqual(s.seats, [{ key: '4', n: 2 }, { key: '6', n: 2 }, { key: '2', n: 1 }, { key: 'none', n: 1 }]);
  assert.deepEqual(s.cohorts, [{ key: '2026-07', n: 2 }, { key: '2026-08', n: 2 }, { key: '2026-06', n: 1 }, { key: 'unknown', n: 1 }]);
  assert.deepEqual(s.trend.map((t) => [t.month, t.activeAtStart, t.volume.cancellations, t.volume.total]), [['2026-07', 30, 3, 0], ['2026-06', 20, 0, 0]]);
  // a month in which nothing happened: every count zero, every share zero, and `anything` false, so nothing is sent
  const quiet = summariseLeaving({ month: '2026-08', records: [], activeAtStart: 40 });
  assert.equal(quiet.anything, false); assert.deepEqual(quiet.volume, { cancellations: 0, pauses: 0, downgrades: 0, emailOptOuts: 0, kept: 0, total: 0 });
  assert.deepEqual(quiet.reasons, []); assert.deepEqual(quiet.offers, []); assert.deepEqual(quiet.trend, []); assert.deepEqual(quiet.rate.cancellations, 0);
  // no active family at the month's start: a share of nothing is nothing to report, not a division by zero
  const none = summariseLeaving({ month: '2026-08', records: [rec({})], activeAtStart: 0 });
  assert.deepEqual(none.rate, { cancellations: null, pauses: null, downgrades: null, emailOptOuts: null });
});

// ---- the flow as a service: the same rules, over the store, through the routes that own each action
const MS_DAY = 86_400_000;
async function subscribed(f, uid = 'parentA', plan = 'big') {
  const a = await f.family(uid, 0);
  const co = await f.payments.checkout(a.ctx, { plan, operationId: randomUUID() });
  const ev = { id: `evt_${randomUUID()}`, type: 'checkout.completed', at: f.now(), customer: co.customerRef, data: { price: `price_fake_${plan}`, periodEnd: f.now() + 30 * MS_DAY, checkoutId: co.checkoutId } };
  const raw = Buffer.from(JSON.stringify(ev));
  assert.equal((await f.payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, f.now()), 'content-type': 'application/json' })).status, 'applied');
  return a;
}
const rows = async (f, familyId) => (await f.store.entries(`families/${familyId}/leaving`)).map(([, r]) => r);
const ctxOf = async (f, uid = 'parentA') => (await f.login(uid)).ctx;

test('the 90-day cap over the store: offers once, then the plain choices until the window has passed', async () => {
  const f = fixture(), a = await subscribed(f);
  const first = await f.leaving.offers(a.ctx, { reason: 'too_expensive' });
  assert.deepEqual(first.offers.map((o) => o.kind), ['downgrade', 'seats']);
  assert.deepEqual([first.capped, first.plan, first.planName, first.seats, first.state, first.cadence], [false, 'big', 'Big family', 6, 'active', 'weekly']);
  await f.leaving.submit(a.ctx, { reason: 'too_expensive', action: 'keep', operationId: randomUUID() });
  const capped = await f.leaving.offers(a.ctx, { reason: 'taking_a_break' });
  assert.deepEqual([capped.offers, capped.capped], [[], true], 'offered once this quarter: not again');
  const rec = await f.leaving.submit(a.ctx, { reason: 'taking_a_break', action: 'keep', operationId: randomUUID() });
  assert.deepEqual(rec.offersShown, [], 'and the record says none was shown');
  await assert.rejects(f.leaving.submit(a.ctx, { reason: 'taking_a_break', action: 'pause', months: 1, offerAccepted: 'pause', operationId: randomUUID() }), rejected('OFFER_NOT_OFFERED'));
  f.advance(OFFER_WINDOW_MS + 1000); // and the paid period with it: the email offers do not need a live subscription
  const later = await f.leaving.offers(await ctxOf(f), { reason: 'too_many_emails' });
  assert.deepEqual([later.offers.map((o) => o.kind), later.capped], [['email_monthly', 'email_off'], false], 'the window has passed');
  assert.equal((await rows(f, a.familyId)).length, 2);
});

test('a submitted flow is one record and one action however many times the tap is repeated; a child and a stale sign-in are refused', async () => {
  const f = fixture(), a = await subscribed(f, 'parentA', 'family'), id = randomUUID();
  const body = { reason: 'not_using', action: 'pause', months: 1, offerAccepted: 'pause', freeText: 'back in the new year', operationId: id };
  const first = await f.leaving.submit(a.ctx, body);
  assert.deepEqual([first.ok, first.action, first.outcome, first.months], [true, 'pause', 'done', 1]);
  const again = await f.leaving.submit(a.ctx, body);
  assert.deepEqual(again, first, 'the same operation id answers the same');
  assert.equal((await rows(f, a.familyId)).length, 1, 'one record');
  assert.equal(f.gateway.calls.filter((c) => c[0] === 'pauseCollection').length, 1, 'and the provider was told once');
  const sub = (await f.store.get(`families/${a.familyId}`)).subscription;
  assert.equal(sub.pause.months, 1);
  const row = (await f.store.list('audit')).find((x) => x.action === 'leaving.recorded');
  assert.deepEqual([row.familyId, row.uid, row.leavingId, row.childId], [a.familyId, 'parentA', id, null], 'the audit row carries ids and nothing else: no reason, no words');
  await assert.rejects(f.leaving.submit(a.ctx, { ...body, action: 'cancel', operationId: id }), rejected('IDEMPOTENCY_CONFLICT'), 'the same id for another action is never answered as the first');
  const k = await f.childSession('parentB');
  await assert.rejects(f.leaving.offers(k.childCtx, { reason: 'not_using' }), rejected('PARENT_REQUIRED'));
  await assert.rejects(f.leaving.submit(k.childCtx, { reason: 'not_using', action: 'keep', operationId: randomUUID() }), rejected('PARENT_REQUIRED'));
  f.advance(6 * 60_000);
  await assert.rejects(f.leaving.submit(a.ctx, { reason: 'not_using', action: 'keep', operationId: randomUUID() }), rejected('REAUTHENTICATE'), 'the flow can change money: a fresh sign-in');
  const looking = await f.leaving.offers(a.ctx, { reason: 'not_using' });
  assert.equal(looking.reason, 'not_using', 'but looking at the page needs only the session');
});
