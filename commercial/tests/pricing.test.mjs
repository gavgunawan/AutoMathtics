// The owner's prices and the leaving offers (13 Sep 2026), checked before the payment provider charges a rupiah by them: (1) every
// amount against a figure worked out by hand, (2) against the rule it comes from, recomputed independently, (3) every eligibility
// rule on its own and at its boundaries, (4) the no-stacking rules against every way four adversarial reviews broke earlier
// versions — both offers taken, one taken twice, the 10% stretched past three charges by a handed-in eligibility, a forged count, a
// charge recorded badly or twice, a lost or re-saved offer record, a price change, a history cut short or missing months, a
// proration — and (5) a simulation of every family of one to four children through two years of charges, cancel attempts and answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MONTHLY_PRICES, KNOWN_MONTHLY_LISTS, ANNUAL_PERCENT_OFF, RETENTION, OFFER_KINDS, IN_A_ROW, PERIOD_SPAN, monthlyPrice, annualList,
  annualPrice, lessPercent, chargeFor, chargesOf, retentionEligibility, retentionOffers, acceptRetention } from '../server/pricing.mjs';
import { GRACE_DAYS, monthsAfter } from '../server/subscription.mjs';

const DAY = 86_400_000, T0 = Date.UTC(2026, 9, 11); // 11 Oct 2026, the first day the grid charges
const code = (c) => (e) => e.code === c;
const OK = { eligible: true, reason: null };

// a monthly history as a provider reports it: each period starting where the last ended, at full price unless `reduce` says otherwise
function months(count, { from = T0, children = 1, reduce = () => false } = {}) {
  const out = [], list = monthlyPrice(children); let start = from;
  for (let i = 0; i < count; i++) {
    const end = monthsAfter(start, 1), reduced = reduce(i);
    out.push({ periodStart: start, periodEnd: end, cycle: 'monthly', amount: reduced ? lessPercent(list, 10) : list, list, applied: reduced ? 'retention_monthly' : null });
    start = end;
  }
  return out;
}
const month = (start, extra = {}) => ({ periodStart: start, periodEnd: monthsAfter(start, 1), cycle: 'monthly', amount: 199_000, list: 199_000, applied: null, ...extra });
const year = (start, extra = {}) => ({ periodStart: start, periodEnd: monthsAfter(start, 12), cycle: 'annual', amount: 1_910_400, list: 2_388_000, applied: 'annual', ...extra });

// (1) by hand
const BY_HAND = {
  1: { monthly: 199_000, annual: 1_910_400, tenOff: 179_100 },
  2: { monthly: 379_000, annual: 3_638_400, tenOff: 341_100 },
  3: { monthly: 519_000, annual: 4_982_400, tenOff: 467_100 },
  4: { monthly: 599_000, annual: 5_750_400, tenOff: 539_100 },
};

test('(1) by hand: monthly 199,000 · 379,000 · 519,000 · 599,000; annual 1,910,400 · 3,638,400 · 4,982,400 · 5,750,400; the leaving 10% 179,100 · 341,100 · 467,100 · 539,100', async () => {
  for (const [n, want] of Object.entries(BY_HAND)) {
    const children = Number(n), taken = { kind: 'retention_monthly', acceptedAt: T0 }, yearlyTaken = { kind: 'retention_annual', acceptedAt: T0 };
    assert.equal(monthlyPrice(children), want.monthly, `${n}: monthly`);
    assert.equal(annualPrice(children), want.annual, `${n}: annual`);
    assert.deepEqual(chargeFor({ children, cycle: 'monthly', retention: null, at: T0 }), { amount: want.monthly, list: want.monthly, percentOff: 0, applied: null, offer: null });
    assert.deepEqual(chargeFor({ children, cycle: 'annual', retention: null, at: T0 }), { amount: want.annual, list: 12 * want.monthly, percentOff: 20, applied: 'annual', offer: null });
    assert.deepEqual(chargeFor({ children, cycle: 'monthly', retention: taken, paid: [month(T0)], at: monthsAfter(T0, 1) }), { amount: want.tenOff, list: want.monthly, percentOff: 10, applied: 'retention_monthly', offer: 'retention_monthly' });
    assert.deepEqual(chargeFor({ children, cycle: 'annual', retention: yearlyTaken, at: monthsAfter(T0, 1) }), { amount: want.annual, list: 12 * want.monthly, percentOff: 20, applied: 'annual', offer: 'retention_annual' });
  }
  assert.deepEqual(Object.keys(MONTHLY_PRICES).map(Number), [1, 2, 3, 4], 'exactly four prices');
  // the list prices a month may have been charged at: today's four, written out in the source rather than derived from MONTHLY_PRICES,
  // so that a price change cannot drop an old price — when a price changes, the old one stays here
  assert.ok(Object.isFrozen(KNOWN_MONTHLY_LISTS));
  assert.deepEqual([...KNOWN_MONTHLY_LISTS], [199_000, 379_000, 519_000, 599_000]);
  const source = await readFile(new URL('../server/pricing.mjs', import.meta.url), 'utf8');
  assert.match(source, /export const KNOWN_MONTHLY_LISTS = Object\.freeze\(\[(?:\d[\d_]*, )*\d[\d_]*\]\);/, 'written out as numbers, not derived');
  for (const price of Object.values(MONTHLY_PRICES)) assert.ok(KNOWN_MONTHLY_LISTS.includes(price), `${price} is a known list price`);
  for (const children of [0, 5, 6, -1, 1.5, '1', NaN, [2], null, undefined]) {
    assert.equal(monthlyPrice(children), null, `${children}: not priced`); assert.equal(annualPrice(children), null);
    assert.throws(() => chargeFor({ children, cycle: 'monthly', retention: null, at: T0 }), code('CHILDREN_NOT_PRICED'));
  }
  assert.throws(() => chargeFor({ children: 1, cycle: 'weekly', retention: null }), code('INVALID_CYCLE'));
  for (const nothing of [undefined, null, 'monthly', 1]) assert.throws(() => chargeFor(nothing), code('INVALID_CYCLE'), `${nothing}: a refusal, not a crash`);
  // the offer record is required, and none is null: a charge worked out without it — left out, or undefined — is refused, never read as "no offer"
  for (const cycle of ['monthly', 'annual']) {
    assert.throws(() => chargeFor({ children: 1, cycle, at: T0 }), code('RETENTION_REQUIRED'), `${cycle}: left out`);
    assert.throws(() => chargeFor({ children: 1, cycle, at: T0, retention: undefined }), code('RETENTION_REQUIRED'), `${cycle}: a field read under the wrong name`);
  }
  assert.equal(lessPercent(199_000, 10), 179_100);
  assert.throws(() => lessPercent(199_999, 10), /not a whole rupiah/, 'a fraction of a rupiah is refused, never rounded');
});

test('(2) by rule: annual is 12 × monthly less 20%, the leaving offer monthly less 10%, recomputed independently; the offers exactly as shown', () => {
  assert.equal(ANNUAL_PERCENT_OFF, 20); assert.deepEqual(RETENTION, { monthlyPercentOff: 10, monthlyCharges: 3, paidMonthsInARow: 2 });
  for (let children = 1; children <= 4; children++) {
    const m = monthlyPrice(children), two = months(2, { children });
    assert.equal(annualList(children), m * 12);
    assert.equal(annualPrice(children), Math.round(m * 12 * 0.8), `${children}: 12 × ${m} × 0.8`);
    const { offers } = retentionOffers({ paid: two, retention: null, now: two[1].periodStart + DAY, children });
    assert.deepEqual(offers, [
      { kind: 'retention_monthly', percentOff: 10, charges: 3, amount: Math.round(m * 0.9), list: m },
      { kind: 'retention_annual', percentOff: 20, amount: Math.round(m * 12 * 0.8), list: m * 12 },
    ], `${children} children: the two offers, field by field`);
    assert.notEqual(offers[1].amount, Math.round(m * 12 * 0.8 * 0.8), 'the annual offer is never 20% off the annual price as well');
  }
});

test('(3) eligibility: the two latest monthly charges in a row and in full, while that month runs, no offer ever taken — each rule alone says no, at its boundary', () => {
  const two = months(2), now = two[1].periodStart + 5 * DAY;
  const is = (args, want, label) => assert.deepEqual(retentionEligibility({ paid: two, retention: null, now, ...args }), want, label);
  const no = (args, reason, label = reason) => is(args, { eligible: false, reason }, label);
  is({}, OK, 'two months in a row');
  const seven = months(7); is({ paid: seven, now: seven[6].periodStart + DAY }, OK, 'seven months: the last two are in a row');
  is({ paid: [...two].reverse() }, OK, 'any order in, the same answer');
  no({ paid: months(1), now: T0 + DAY }, 'NOT_TWO_MONTHS');
  for (const paid of [[], null, 'x', undefined]) no({ paid }, 'NOT_CURRENT');
  for (const at of [two[1].periodEnd, undefined, NaN, T0 - DAY, String(now)]) no({ now: at }, 'NOT_CURRENT');
  // the stored record is required, and none is null: "no offer taken" is never read from an absent key or an undefined field
  assert.throws(() => retentionEligibility({ paid: two, now }), code('RETENTION_REQUIRED'));
  assert.throws(() => retentionEligibility({ paid: two, now, retention: undefined }), code('RETENTION_REQUIRED'), 'a field read under the wrong name');
  assert.throws(() => retentionEligibility(), code('RETENTION_REQUIRED'));
  assert.throws(() => retentionOffers({ paid: two, now, children: 1 }), code('RETENTION_REQUIRED'));
  // on annual — running now, already paid to start next, or prorated onto the anchor — is not monthly; an annual that has ended is history
  no({ paid: [...two, year(two[1].periodEnd)], now: two[1].periodEnd + DAY }, 'NOT_MONTHLY');
  no({ paid: [...two, year(two[1].periodEnd)] }, 'NOT_MONTHLY');
  no({ paid: [...two, { ...year(two[1].periodEnd), periodEnd: two[1].periodEnd + 356 * DAY }], now: two[1].periodEnd + DAY }, 'NOT_MONTHLY');
  no({ paid: [...two, { ...year(two[1].periodEnd), periodEnd: two[1].periodEnd + PERIOD_SPAN.annual.max }] }, 'NOT_MONTHLY');
  is({ paid: [...two, { ...year(two[1].periodEnd), periodEnd: two[1].periodEnd + PERIOD_SPAN.annual.max + 1 }] }, OK, 'an "annual" longer than a year and a day is no annual charge');
  const afterYear = monthsAfter(T0, 12);
  no({ paid: [year(T0), month(afterYear)], now: afterYear + DAY }, 'NOT_TWO_MONTHS');
  is({ paid: [year(T0), month(afterYear), month(monthsAfter(afterYear, 1))], now: monthsAfter(afterYear, 1) + DAY }, OK, 'back on monthly: two monthly months again');
  // the charges themselves show an offer taken — with no record at all, whenever, however badly recorded: a charge that carried the
  // 10%, or any charge made under either offer
  no({ paid: months(2, { reduce: (i) => i === 1 }) }, 'OFFER_ALREADY_USED');
  no({ paid: months(2, { reduce: (i) => i === 0 }) }, 'OFFER_ALREADY_USED');
  const five = months(5, { reduce: (i) => i >= 1 && i <= 3 }); no({ paid: five, now: five[4].periodStart + DAY }, 'OFFER_ALREADY_USED');
  no({ paid: [...two, { ...month(monthsAfter(T0, -6)), applied: 'RETENTION_MONTHLY', refunded: true, amount: '179100' }] }, 'OFFER_ALREADY_USED');
  no({ paid: [...two, year(monthsAfter(T0, -13), { offer: 'retention_annual' })] }, 'OFFER_ALREADY_USED', 'a yearly charge made under the yearly offer');
  no({ paid: [...two, year(monthsAfter(T0, -13), { offer: 'Retention_Annual', refunded: true })] }, 'OFFER_ALREADY_USED', 'refunded, in capitals');
  no({ paid: [...two, { offer: 'retention_monthly' }] }, 'OFFER_ALREADY_USED', 'a mark on nothing else');
  is({ paid: [...two, year(monthsAfter(T0, -13), { offer: null })] }, OK, 'an ordinary yearly plan, long over, is no offer');
  // in full: not below the list price; above it is still in full
  no({ paid: [{ ...two[0], amount: 179_100 }, two[1]] }, 'DISCOUNTED_MONTH');
  no({ paid: [two[0], { ...two[1], amount: 198_999 }] }, 'DISCOUNTED_MONTH');
  is({ paid: [two[0], { ...two[1], amount: 201_000 }] }, OK, 'more than the list is not less than full price');
  // in a row: up to three days early, up to the grace period late — a millisecond more either way is a break
  assert.deepEqual(IN_A_ROW, { earlyMs: 3 * DAY, lateMs: GRACE_DAYS * DAY });
  const end = two[0].periodEnd, pair = (start) => ({ paid: [two[0], month(start)], now: start + 5 * DAY });
  is(pair(end), OK, 'starts where the last ended');
  is(pair(end + IN_A_ROW.lateMs), OK, 'a renewal paid on the last day of grace');
  no(pair(end + IN_A_ROW.lateMs + 1), 'NOT_IN_A_ROW');
  is(pair(end - IN_A_ROW.earlyMs), OK, 'stamped three days early');
  no(pair(end - IN_A_ROW.earlyMs - 1), 'NOT_IN_A_ROW');
  no({ paid: [month(T0), month(monthsAfter(T0, 3))], now: monthsAfter(T0, 3) + DAY }, 'NOT_IN_A_ROW');
  // a month's length: 27 to 32 days counts, a millisecond outside does not
  assert.deepEqual(PERIOD_SPAN.monthly, { min: 27 * DAY, max: 32 * DAY }); assert.deepEqual(PERIOD_SPAN.annual, { min: 27 * DAY, max: 367 * DAY });
  const earlier = (span) => ({ ...month(0), periodStart: two[1].periodStart - span, periodEnd: two[1].periodStart });
  is({ paid: [earlier(PERIOD_SPAN.monthly.min), two[1]] }, OK, 'a 27-day month');
  no({ paid: [earlier(PERIOD_SPAN.monthly.min - 1), two[1]] }, 'NOT_TWO_MONTHS');
  is({ paid: [earlier(PERIOD_SPAN.monthly.max), two[1]] }, OK, 'a 32-day month');
  no({ paid: [earlier(PERIOD_SPAN.monthly.max + 1), two[1]] }, 'NOT_TWO_MONTHS');
  // month ends: 31 January → 28 February → 31 March is in a row
  const jan31 = Date.UTC(2027, 0, 31), feb28 = Date.UTC(2027, 1, 28), mar31 = Date.UTC(2027, 2, 31);
  is({ paid: [{ ...month(jan31), periodEnd: feb28 }, { ...month(feb28), periodEnd: mar31 }], now: feb28 + DAY }, OK, 'short February');
  // one month stored twice is one month; copies that disagree are read cautiously — lower amount, then higher list — in either order
  no({ paid: [two[1], two[1]] }, 'NOT_TWO_MONTHS');
  const belowCopy = { ...two[1], amount: 179_100, applied: null }, higherListCopy = { ...two[1], list: 379_000 };
  no({ paid: [two[0], two[1], belowCopy] }, 'DISCOUNTED_MONTH'); no({ paid: [two[0], belowCopy, two[1]] }, 'DISCOUNTED_MONTH');
  no({ paid: [two[0], two[1], higherListCopy] }, 'DISCOUNTED_MONTH'); no({ paid: [two[0], higherListCopy, two[1]] }, 'DISCOUNTED_MONTH');
  const reducedCopy = { ...two[1], amount: 179_100, applied: 'retention_monthly' };
  assert.equal(chargesOf([two[1], reducedCopy]).length, 1);
  assert.equal(chargesOf([two[1], reducedCopy])[0].applied, 'retention_monthly'); assert.equal(chargesOf([reducedCopy, two[1]])[0].applied, 'retention_monthly');
  // what is not a month paid counts for nothing, whatever order it comes in
  const seconds = Math.floor(two[0].periodStart / 1000), before = monthsAfter(T0, -1);
  const notMonths = {
    'twelve hours at nothing': { ...month(two[1].periodStart), periodEnd: two[1].periodStart + 12 * 3_600_000, amount: 0 },
    'a trial at nothing': { ...month(monthsAfter(T0, -2)), amount: 0, list: 0 },
    'a refunded month': { ...month(before), refunded: true },
    'refunded as a string': { ...month(before), refunded: 'true' },
    'a refund time': { ...month(before), refundedAt: T0 },
    'a refund status': { ...month(before), status: 'refunded' },
    'a refund status in capitals': { ...month(before), status: 'REFUNDED' },
    'partly refunded': { ...month(before), status: 'partially_refunded' },
    'a partial refund': { ...month(before), refundedAmount: 150_000 },
    'an amount refunded, by another name': { ...month(before), amountRefunded: 50_000 },
    'an amount refunded, by a third': { ...month(before), refunded_amount: 50_000 },
    'a list of refunds': { ...month(before), refunds: [{ amount: 50_000 }] },
    'a proration': { ...month(before), proration: true },
    'a proration flagged yes': { ...month(before), proration: 'yes' },
    'a proration flagged 1': { ...month(before), proration: 1 },
    'times in seconds': { ...month(0), periodStart: seconds - 2_678_400, periodEnd: seconds },
    'times as strings': { ...month(before), periodStart: String(before) },
    'an amount as a string': { ...month(before), amount: '199000' },
    'a fraction of a rupiah': { ...month(before), amount: 199_000.5 },
    'a list price never on the list': { ...month(before), amount: 199_500, list: 199_500 },
    'a period not yet begun': month(two[1].periodEnd + DAY),
    'a monthly charge claiming the annual reduction': { ...month(before), applied: 'annual' },
    'a cycle that does not exist': { ...month(before), cycle: 'weekly' },
    'a two-day period': { ...month(before), periodEnd: before + 2 * DAY },
    'nothing at all': null,
  };
  for (const [label, junk] of Object.entries(notMonths)) {
    no({ paid: [junk, two[1]] }, 'NOT_TWO_MONTHS', `${label}: not a month`); no({ paid: [two[1], junk] }, 'NOT_TWO_MONTHS', `${label}: not a month, whatever the order`);
    is({ paid: [junk, ...two] }, OK, `${label}: ignored`); is({ paid: [...two, junk] }, OK, `${label}: ignored, whatever the order`);
  }
  // a flag that plainly says no is no refund, and no proration: the month counts
  for (const extra of [{ refunded: false }, { refunded: 'false' }, { refunded: ' No ' }, { refunded: 0 }, { refunded: '0' }, { refundedAt: 0 }, { refundedAt: '' },
    { refundedAt: null }, { refundedAmount: 0 }, { refunds: [] }, { status: 'paid' }, { proration: false }, { proration: 'false' }, { proration: 0 },
    { proration: '0' }, { proration: null }])
    is({ paid: [two[0], { ...two[1], ...extra }] }, OK, `${JSON.stringify(extra)}: still a month paid`);
  // adding a child mid-month: the proration, recorded with the month's own period, is a charge but not a month — it neither makes the
  // month look discounted nor stands in for it. Left unflagged, it reads as that month charged below its list.
  const prorated = { ...two[1], amount: 90_000, list: 379_000, proration: true };
  is({ paid: [...two, prorated] }, OK, 'a proration beside its month');
  is({ paid: [prorated, ...two] }, OK, 'a proration beside its month, whatever the order');
  no({ paid: [two[0], prorated] }, 'NOT_CURRENT', 'a proration does not stand in for its month: no month runs now');
  no({ paid: [...two, { ...prorated, proration: undefined }] }, 'DISCOUNTED_MONTH', 'an unflagged proration');
  // any offer record, of any shape, means the offer is spent; only no record at all leaves it open
  for (const retention of [{ kind: 'retention_monthly', acceptedAt: T0 }, { kind: 'retention_annual', acceptedAt: T0 }, { kind: 'retention_monthly' },
    { acceptedAt: '2026-10-11' }, {}, [], 'taken', '{"kind":"retention_monthly"}', 0, false]) no({ retention }, 'OFFER_ALREADY_USED');
  is({ retention: null }, OK, 'null: none taken');
  // a family the price list does not cover is offered nothing
  assert.deepEqual(retentionOffers({ paid: two, retention: null, now, children: 5 }), { eligible: false, reason: 'CHILDREN_NOT_PRICED', offers: [] });
  assert.deepEqual(retentionOffers({ paid: two, retention: null, now: two[1].periodEnd, children: 1 }), { eligible: false, reason: 'NOT_CURRENT', offers: [] });
});

test('(4) no stacking: one offer, once, however it is asked; the 10% is three charges however the charges are recorded and whichever are passed; annual is the annual price; missing facts are refused', () => {
  const children = 2, two = months(2, { children }), now = two[1].periodStart + DAY;
  const taken = acceptRetention({ paid: two, retention: null, now, children, kind: 'retention_monthly' });
  assert.deepEqual(taken, { kind: 'retention_monthly', acceptedAt: now });
  for (const kind of OFFER_KINDS) {
    assert.throws(() => acceptRetention({ paid: two, retention: taken, now, children, kind }), code('OFFER_ALREADY_USED'), `a second offer: ${kind}`);
    assert.throws(() => acceptRetention({ paid: two, retention: taken, now, children, kind, eligibility: { eligible: true } }), code('OFFER_ALREADY_USED'), 'a handed-in eligibility is never read');
    assert.throws(() => acceptRetention({ paid: two, now, children, kind }), code('RETENTION_REQUIRED'), 'the record left out is refused, never read as none');
    assert.throws(() => acceptRetention({ paid: two, retention: undefined, now, children, kind }), code('RETENTION_REQUIRED'), 'nor read as none when undefined');
  }
  assert.throws(() => acceptRetention({ paid: two, retention: null, now, children: 5, kind: 'retention_monthly' }), code('CHILDREN_NOT_PRICED'), 'an offer never shown cannot be taken');
  assert.throws(() => acceptRetention({ paid: two, retention: null, children, kind: 'retention_monthly' }), code('NOT_CURRENT'));
  assert.throws(() => acceptRetention({ paid: [], retention: null, now, children, kind: 'retention_annual' }), code('NOT_CURRENT'), 'no history, no offer');
  assert.throws(() => acceptRetention({ paid: two, retention: null, now, children, kind: 'both' }), code('INVALID_OFFER'));
  assert.throws(() => acceptRetention(), code('INVALID_OFFER'));
  // the next three monthly charges carry the 10%, counted from the charges recorded — however they were recorded — and no more
  const run = (retention, count, { from = two[1].periodEnd, late = 0, record = (r) => r } = {}) => {
    const paid = [...two], amounts = []; let start = from;
    for (let i = 0; i < count; i++) {
      const c = chargeFor({ children, cycle: 'monthly', retention, paid, at: start }), end = monthsAfter(start, 1);
      amounts.push(c.amount); paid.push(record({ periodStart: start, periodEnd: end, cycle: 'monthly', amount: c.amount, list: c.list, applied: c.applied, offer: c.offer }, i));
      start = end + late;
    }
    return { amounts, paid };
  };
  const THREE = [341_100, 341_100, 341_100, 379_000, 379_000, 379_000], { paid } = run(taken, 6);
  assert.deepEqual(run(taken, 6).amounts, THREE);
  assert.deepEqual(run({ ...taken, chargesLeft: 1000, percentOff: 50 }, 6).amounts, THREE, 'fields stored beside the record change nothing');
  for (const [label, record] of Object.entries({
    'the reductions stored without their labels': (r) => ({ ...r, applied: null, offer: null }),
    'the second marked refunded': (r, i) => (i === 1 ? { ...r, refunded: true } : r),
    'the second stamped as a 26-day period': (r, i) => (i === 1 ? { ...r, periodEnd: r.periodStart + 26 * DAY } : r),
    'amounts stored as strings': (r) => ({ ...r, amount: String(r.amount) }),
    'the cycle in capitals': (r) => ({ ...r, cycle: 'Monthly' }),
    'periods stored as strings': (r) => ({ ...r, periodStart: String(r.periodStart), periodEnd: String(r.periodEnd) }),
    'no labels, and amounts as strings': (r) => ({ ...r, applied: null, offer: null, amount: String(r.amount) }),
  })) assert.deepEqual(run(taken, 6, { record }).amounts, THREE, `${label}: still three`);
  const lastDay = acceptRetention({ paid: two, retention: null, now: two[1].periodEnd - DAY, children, kind: 'retention_monthly' });
  assert.deepEqual(run(lastDay, 4).amounts, [341_100, 341_100, 341_100, 379_000], 'taken on the last day of a month: still the next three');
  const firstHour = acceptRetention({ paid: two, retention: null, now: two[1].periodStart + 3_600_000, children, kind: 'retention_monthly' });
  assert.deepEqual(run(firstHour, 4, { from: two[1].periodEnd + 7 * DAY, late: 7 * DAY }).amounts, [341_100, 341_100, 341_100, 379_000], 'renewals a week late each time: all three, inside the four months');
  // The same charge recorded twice changes nothing. A charge is worked out before it is recorded: every record counts, the one for
  // the period asked about included, so with three reductions recorded no `at` — a wrong one, or a recorded month's — reduces a fourth.
  const [first, second] = [paid[2], paid[3]];
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: [...two, first, first, second], at: paid[4].periodStart }).amount, 341_100, 'a duplicate is not another reduced charge');
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: [...two, first], at: first.periodStart }).amount, 341_100, 'the first worked out again: one use of three');
  for (const k of [2, 3, 4]) assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: paid.slice(0, 5), at: paid[k].periodStart }).amount, 379_000, `three recorded, a charge worked out with the start of reduced month ${k - 1}: full price`);
  // a record re-saved later, or lost: the three reductions already carried still count, and no second offer is made
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: { ...taken, acceptedAt: paid[5].periodStart + DAY }, paid: paid.slice(0, 6), at: paid[6].periodStart }).amount, 379_000, 'a re-saved acceptance does not start three more');
  assert.throws(() => acceptRetention({ paid: paid.slice(0, 7), retention: null, now: paid[6].periodStart + DAY, children, kind: 'retention_monthly' }), code('OFFER_ALREADY_USED'), 'the record lost: the charges still say it was taken');
  // Whichever charges are passed, only the three after the month the offer was taken in can carry the 10%, and only when every month
  // between is there: every subset of the charges before each of the next six, in either order. Without the month the offer was taken
  // in, a charge inside the four months is refused.
  const lapse = monthsAfter(taken.acceptedAt, RETENTION.monthlyCharges + 1);
  for (let k = 2; k < paid.length; k++) {
    for (let mask = 0; mask < 2 ** k; mask++) {
      const view = paid.slice(0, k).filter((_, i) => mask & (1 << i)), at = paid[k].periodStart;
      const walkable = [...Array(k - 2).keys()].every((j) => mask & (1 << (j + 2))), label = `charge ${k - 1} after the offer, from charges [${view.map((c) => paid.indexOf(c) + 1)}]`;
      for (const list of [view, [...view].reverse()]) {
        const charge = () => chargeFor({ children, cycle: 'monthly', retention: taken, paid: list, at }).amount;
        if (!(mask & 2) && at < lapse) assert.throws(charge, code('PAID_INCOMPLETE'), label);
        else assert.equal(charge(), k <= 4 && walkable ? 341_100 : 379_000, label);
      }
    }
  }
  // one recording mistake made on every charge still reduces three at most: each charge stamped with the period after its own, or
  // worked out with `at` a period early
  const stampedLate = run(taken, 8, { record: (r) => ({ ...r, periodStart: r.periodEnd, periodEnd: monthsAfter(r.periodEnd, 1) }) }).amounts;
  assert.ok(stampedLate.filter((a) => a < 379_000).length <= RETENTION.monthlyCharges, `stamped a period late: ${stampedLate}`);
  const early = [...two], earlyAmounts = [];
  for (let i = 0, start = two[1].periodEnd; i < 8; i++, start = monthsAfter(start, 1)) {
    const c = chargeFor({ children, cycle: 'monthly', retention: taken, paid: early, at: monthsAfter(start, -1) });
    earlyAmounts.push(c.amount); early.push({ periodStart: start, periodEnd: monthsAfter(start, 1), cycle: 'monthly', amount: c.amount, list: c.list, applied: c.applied, offer: c.offer });
  }
  assert.deepEqual(earlyAmounts, [379_000, 341_100, 341_100, 341_100, 379_000, 379_000, 379_000, 379_000], 'worked out with `at` a period early: still three');
  // A break in the subscription ends the 10%. After the first reduced month, a renewal as late as the grace period, or stamped as
  // early as three days, is the next month; a millisecond further either way is a break, and so is coming back two weeks later.
  const firstEnd = paid[2].periodEnd, after = (at) => chargeFor({ children, cycle: 'monthly', retention: taken, paid: paid.slice(0, 3), at }).amount;
  assert.equal(after(firstEnd + IN_A_ROW.lateMs), 341_100); assert.equal(after(firstEnd + IN_A_ROW.lateMs + 1), 379_000);
  assert.equal(after(firstEnd - IN_A_ROW.earlyMs), 341_100); assert.equal(after(firstEnd - IN_A_ROW.earlyMs - 1), 379_000);
  assert.equal(after(firstEnd + 14 * DAY), 379_000, 'cancelled, and back two weeks later: full price');
  // the furthest the walk reaches — every month recorded as 32 days, every renewal a grace period late — is the third charge, still
  // inside the four months, which stay as a second bound
  const stretched = [{ ...month(T0), periodEnd: T0 + PERIOD_SPAN.monthly.max }];
  while (stretched.length < 3) { const s = stretched.at(-1).periodEnd + IN_A_ROW.lateMs; stretched.push({ ...month(s), periodEnd: s + PERIOD_SPAN.monthly.max }); }
  const furthest = stretched.at(-1).periodEnd + IN_A_ROW.lateMs, far = { kind: 'retention_monthly', acceptedAt: T0 };
  assert.equal(chargeFor({ children: 1, cycle: 'monthly', retention: far, paid: stretched, at: furthest }).amount, 179_100, 'the third, as late as it can come');
  assert.equal(chargeFor({ children: 1, cycle: 'monthly', retention: far, paid: stretched, at: furthest + 1 }).amount, 199_000);
  assert.ok(furthest < monthsAfter(T0, RETENTION.monthlyCharges + 1));
  // Renewals stamped three days early, the offer taken inside the overlap: the month it was taken in is the later one, and the three
  // after it carry the 10% — of the periods covering the moment it was taken, the walk starts from the one reaching furthest.
  const overlap = [month(Date.UTC(2026, 10, 11))]; overlap.push(month(overlap[0].periodEnd - IN_A_ROW.earlyMs));
  const inOverlap = acceptRetention({ paid: overlap, retention: null, now: overlap[0].periodEnd - DAY, children: 1, kind: 'retention_monthly' }), overlapAmounts = [];
  for (let i = 0; i < 4; i++) {
    const at = overlap.at(-1).periodEnd - IN_A_ROW.earlyMs, c = chargeFor({ children: 1, cycle: 'monthly', retention: inOverlap, paid: overlap, at });
    overlapAmounts.push(c.amount); overlap.push({ ...month(at), amount: c.amount, list: c.list, applied: c.applied, offer: c.offer });
  }
  assert.deepEqual(overlapAmounts, [179_100, 179_100, 179_100, 199_000], 'taken inside an overlap: still the next three');
  // The walk counts months, not reductions: three months charged after the offer month are the three even when none carried the 10%
  // (its record not read for them), and the 10% does not move later. The offer month is the one covering the moment it was taken, to
  // the millisecond: taken at a month's first, the month before does not stand in for it.
  const unread = [...two, ...months(3, { from: two[1].periodEnd, children })];
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: unread, at: unread[4].periodEnd }).amount, 379_000, 'a fourth month, none reduced before it');
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: unread.slice(0, 4), at: unread[3].periodEnd }).amount, 341_100, 'the third month still is');
  const atFirstMs = acceptRetention({ paid: two, retention: null, now: two[1].periodStart, children, kind: 'retention_monthly' });
  assert.throws(() => chargeFor({ children, cycle: 'monthly', retention: atFirstMs, paid: [two[0]], at: two[1].periodEnd }), code('PAID_INCOMPLETE'));
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: atFirstMs, paid: [two[1]], at: two[1].periodEnd }).amount, 341_100);
  // A child added during the three months: a proration takes none of them; left unflagged, it reads as a charge below its list and
  // takes one. A month below its list before the offer was taken — a goodwill month, say — takes none.
  const proration = { periodStart: paid[2].periodStart + 10 * DAY, periodEnd: paid[2].periodEnd, cycle: 'monthly', amount: 120_000, list: 379_000, applied: null, offer: null, proration: true };
  const goodwill = { ...months(1, { from: monthsAfter(T0, -3), children })[0], amount: 300_000 };
  const along = (extra, from) => [2, 3, 4, 5].map((k) => chargeFor({ children, cycle: 'monthly', retention: taken, paid: k >= from ? [...paid.slice(0, k), extra] : paid.slice(0, k), at: paid[k].periodStart }).amount);
  assert.deepEqual(along(proration, 3), [341_100, 341_100, 341_100, 379_000], 'a proration');
  assert.deepEqual(along({ ...proration, proration: undefined }, 3), [341_100, 341_100, 379_000, 379_000], 'a proration left unflagged');
  assert.deepEqual(along(goodwill, 2), [341_100, 341_100, 341_100, 379_000], 'a goodwill month before the offer');
  // without the charges and the period, a family holding an offer record cannot be charged by guesswork
  assert.throws(() => chargeFor({ children, cycle: 'monthly', retention: taken, at: two[1].periodEnd }), code('PAID_REQUIRED'));
  assert.throws(() => chargeFor({ children, cycle: 'monthly', retention: taken, paid: new Set(two), at: two[1].periodEnd }), code('PAID_REQUIRED'));
  assert.throws(() => chargeFor({ children, cycle: 'monthly', retention: taken, paid: two }), code('PERIOD_REQUIRED'));
  assert.throws(() => chargeFor({ children, cycle: 'monthly', retention: taken, paid: [], at: two[1].periodEnd }), code('PAID_INCOMPLETE'), 'nothing to count from');
  assert.throws(() => chargeFor({ children, cycle: 'monthly', retention: taken, paid: paid.slice(3, 5), at: paid[5].periodStart }), code('PAID_INCOMPLETE'), 'only the latest two charges');
  for (const cycle of ['monthly', 'annual']) assert.throws(() => chargeFor({ children, cycle, paid, at: two[1].periodEnd }), code('RETENTION_REQUIRED'), `${cycle}: the record left out`);
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: null, at: two[1].periodEnd }).amount, 379_000, 'no offer record: nothing more is needed');
  assert.equal(chargeFor({ children, cycle: 'annual', retention: taken }).amount, 3_638_400, 'annual needs neither: it is the annual price regardless');
  // the months it covers pass: a family who cancelled anyway and came back later pays full price; the month already paid is not reduced
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: two, at: monthsAfter(now, 4) }).amount, 379_000);
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: two, at: now }).amount, 379_000);
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: two, at: two[1].periodStart }).amount, 379_000);
  // Annual is the annual price, with the monthly 10% running or not. The annual offer is that price, carries no monthly 10%, and marks
  // the charge made under it — so with its record lost, a year later and back on monthly, the charges still refuse a second offer.
  assert.deepEqual(chargeFor({ children, cycle: 'annual', retention: taken, paid, at: two[1].periodEnd }), { amount: 3_638_400, list: 4_548_000, percentOff: 20, applied: 'annual', offer: null });
  const annualTaken = acceptRetention({ paid: two, retention: null, now, children, kind: 'retention_annual' });
  assert.deepEqual(annualTaken, { kind: 'retention_annual', acceptedAt: now });
  const yearly = chargeFor({ children, cycle: 'annual', retention: annualTaken, paid: two, at: two[1].periodEnd });
  assert.deepEqual(yearly, { amount: 3_638_400, list: 4_548_000, percentOff: 20, applied: 'annual', offer: 'retention_annual' });
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: annualTaken, paid: two, at: two[1].periodEnd }).amount, 379_000);
  const back = monthsAfter(two[1].periodEnd, 12), later = monthsAfter(back, 1) + DAY;
  const yearOn = [...two, { periodStart: two[1].periodEnd, periodEnd: back, cycle: 'annual', ...yearly }, ...months(2, { from: back, children })];
  assert.throws(() => acceptRetention({ paid: yearOn, retention: null, now: later, children, kind: 'retention_monthly' }), code('OFFER_ALREADY_USED'), 'the yearly record lost: its charge still says it was taken');
  assert.deepEqual(acceptRetention({ paid: yearOn.map((c) => ({ ...c, offer: null })), retention: null, now: later, children, kind: 'retention_monthly' }), { kind: 'retention_monthly', acceptedAt: later }, 'and it is the mark that refuses: without it the same family would be offered again');
  // a forged or malformed record reduces nothing
  for (const forged of [{ kind: 'retention_monthly' }, { kind: 'retention_monthly', acceptedAt: String(now) }, { kind: 'retention_monthly', acceptedAt: now + 0.5 },
    { kind: 'retention_monthly', acceptedAt: two[1].periodEnd + DAY }, { kind: 'vip', acceptedAt: now }, 'retention_monthly', [], true])
    assert.equal(chargeFor({ children, cycle: 'monthly', retention: forged, paid: two, at: two[1].periodEnd }).amount, 379_000, JSON.stringify(forged));
});

test('(5) simulation: every family of 1–4 children, cancelling in every month of two years and giving each answer — one reduction a charge at most, the 10% exactly three charges, annual never below the annual price, one offer a family even when its record is lost', () => {
  const answers = ['decline', ...OFFER_KINDS];
  let families = 0, offersTaken = 0;
  for (let children = 1; children <= 4; children++) {
    const m = monthlyPrice(children), yearly = annualPrice(children);
    for (let cancelIn = 0; cancelIn < 24; cancelIn++) {
      for (const answer of answers) {
        families++;
        let cycle = 'monthly', retention = null, start = T0, reduced = 0, accepted = 0;
        const paid = [];
        for (let month = 0; month < 36; month++) {
          // every period is charged at its start, in advance; a parent can ask to cancel at any point inside it
          const c = chargeFor({ children, cycle, retention, paid, at: start });
          assert.ok(['annual', 'retention_monthly', null].includes(c.applied), 'one reduction at most, named');
          // here an annual charge only ever follows the yearly offer, so every charge but a full-price month is marked with an offer
          assert.equal(c.offer, c.applied === 'retention_monthly' ? 'retention_monthly' : c.applied === 'annual' ? 'retention_annual' : null, 'marked with the offer it was made under');
          if (c.applied === 'annual') assert.equal(c.amount, yearly, 'annual: the annual price, never less');
          if (c.applied === 'retention_monthly') { reduced++; assert.equal(c.amount, m - m / 10); }
          if (c.applied === null) assert.equal(c.amount, m);
          const end = cycle === 'annual' ? monthsAfter(start, 12) : monthsAfter(start, 1);
          paid.push({ periodStart: start, periodEnd: end, cycle, amount: c.amount, list: c.list, applied: c.applied, offer: c.offer });
          if (c.applied === 'annual') {
            // a year paid; back on monthly for two months, with the offer record lost on the way: still no second offer
            const backOn = months(2, { from: end, children });
            assert.equal(retentionEligibility({ paid: [...paid, ...backOn], retention: null, now: backOn[1].periodStart + DAY }).reason, 'OFFER_ALREADY_USED');
            break;
          }
          if (month === cancelIn) {
            const now = start + DAY, decided = retentionOffers({ paid, retention, now, children });
            assert.equal(decided.offers.length, decided.eligible ? 2 : 0);
            assert.equal(decided.eligible, paid.length >= 2, `${children} children, cancelling in month ${cancelIn + 1}: eligible exactly when two full months are paid`);
            if (decided.eligible && answer !== 'decline') {
              retention = acceptRetention({ paid, retention, now, children, kind: answer }); accepted++; offersTaken++;
              if (answer === 'retention_annual') cycle = 'annual'; // from the next renewal
              for (const kind of OFFER_KINDS) assert.throws(() => acceptRetention({ paid, retention, now, children, kind }), code('OFFER_ALREADY_USED'));
            }
          }
          start = end;
        }
        assert.ok(accepted <= 1, 'never a second offer');
        assert.ok(reduced <= RETENTION.monthlyCharges, 'the 10% never runs past three charges');
        if (answer === 'retention_monthly' && accepted) {
          assert.equal(reduced, 3, 'and runs all three');
          assert.equal(retentionEligibility({ paid, retention: null, now: start - DAY }).reason, 'OFFER_ALREADY_USED', 'the record lost afterwards: the charges still refuse a second offer');
        }
      }
    }
  }
  assert.equal(families, 4 * 24 * 3); assert.ok(offersTaken > 0);
});
