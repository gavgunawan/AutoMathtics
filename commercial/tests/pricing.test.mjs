// The owner's prices and the leaving offers (13 Sep 2026), checked before the payment provider charges a rupiah by them: (1) every
// amount against a figure worked out by hand, (2) against the rule it comes from, recomputed independently, (3) every eligibility
// rule on its own and at its boundaries, (4) the no-stacking rules against the ways an adversarial review broke the first version
// — both offers taken, one taken twice, the 10% stretched past three charges, a handed-in eligibility, a forged record — and (5) a
// simulation of every family of one to four children through two years of charges, cancel attempts and answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTHLY_PRICES, ANNUAL_PERCENT_OFF, RETENTION, OFFER_KINDS, IN_A_ROW, monthlyPrice, annualList, annualPrice, lessPercent, chargeFor,
  chargesOf, retentionEligibility, retentionOffers, acceptRetention } from '../server/pricing.mjs';
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

test('(1) by hand: monthly 199,000 · 379,000 · 519,000 · 599,000; annual 1,910,400 · 3,638,400 · 4,982,400 · 5,750,400; the leaving 10% 179,100 · 341,100 · 467,100 · 539,100', () => {
  for (const [n, want] of Object.entries(BY_HAND)) {
    const children = Number(n), taken = { kind: 'retention_monthly', acceptedAt: T0 };
    assert.equal(monthlyPrice(children), want.monthly, `${n}: monthly`);
    assert.equal(annualPrice(children), want.annual, `${n}: annual`);
    assert.deepEqual(chargeFor({ children, cycle: 'monthly', at: T0 }), { amount: want.monthly, list: want.monthly, percentOff: 0, applied: null });
    assert.deepEqual(chargeFor({ children, cycle: 'annual', at: T0 }), { amount: want.annual, list: 12 * want.monthly, percentOff: 20, applied: 'annual' });
    assert.deepEqual(chargeFor({ children, cycle: 'monthly', retention: taken, at: monthsAfter(T0, 1) }), { amount: want.tenOff, list: want.monthly, percentOff: 10, applied: 'retention_monthly' });
  }
  assert.deepEqual(Object.keys(MONTHLY_PRICES).map(Number), [1, 2, 3, 4], 'exactly four prices');
  for (const children of [0, 5, 6, -1, 1.5, '1', NaN, [2], null, undefined]) {
    assert.equal(monthlyPrice(children), null, `${children}: not priced`); assert.equal(annualPrice(children), null);
    assert.throws(() => chargeFor({ children, cycle: 'monthly', at: T0 }), code('CHILDREN_NOT_PRICED'));
  }
  assert.throws(() => chargeFor({ children: 1, cycle: 'weekly' }), code('INVALID_CYCLE'));
  assert.throws(() => chargeFor(), code('INVALID_CYCLE'), 'nothing given: a refusal, not a crash');
  assert.equal(lessPercent(199_000, 10), 179_100);
  assert.throws(() => lessPercent(199_999, 10), /not a whole rupiah/, 'a fraction of a rupiah is refused, never rounded');
});

test('(2) by rule: annual is 12 × monthly less 20%, the leaving offer monthly less 10%, recomputed independently; the offers exactly as shown', () => {
  assert.equal(ANNUAL_PERCENT_OFF, 20); assert.deepEqual(RETENTION, { monthlyPercentOff: 10, monthlyCharges: 3, paidMonthsInARow: 2 });
  for (let children = 1; children <= 4; children++) {
    const m = monthlyPrice(children), two = months(2, { children });
    assert.equal(annualList(children), m * 12);
    assert.equal(annualPrice(children), Math.round(m * 12 * 0.8), `${children}: 12 × ${m} × 0.8`);
    const { offers } = retentionOffers({ paid: two, now: two[1].periodStart + DAY, children });
    assert.deepEqual(offers, [
      { kind: 'retention_monthly', percentOff: 10, charges: 3, amount: Math.round(m * 0.9), list: m },
      { kind: 'retention_annual', percentOff: 20, amount: Math.round(m * 12 * 0.8), list: m * 12 },
    ], `${children} children: the two offers, field by field`);
    assert.notEqual(offers[1].amount, Math.round(m * 12 * 0.8 * 0.8), 'the annual offer is never 20% off the annual price as well');
  }
});

test('(3) eligibility: the two latest monthly charges in a row and in full, while that month runs, no offer ever taken — each rule alone says no, at its boundary', () => {
  const two = months(2), now = two[1].periodStart + 5 * DAY;
  const is = (args, want, label) => assert.deepEqual(retentionEligibility({ paid: two, now, ...args }), want, label);
  const no = (args, reason) => is(args, { eligible: false, reason }, reason);
  is({}, OK, 'two months in a row');
  const seven = months(7); is({ paid: seven, now: seven[6].periodStart + DAY }, OK, 'seven months: the last two are in a row');
  is({ paid: [...two].reverse() }, OK, 'any order in, the same answer');
  no({ paid: months(1), now: T0 + DAY }, 'NOT_TWO_MONTHS');
  for (const paid of [[], null, 'x', undefined]) no({ paid }, 'NOT_CURRENT');
  for (const at of [two[1].periodEnd, undefined, NaN, T0 - DAY, String(now)]) no({ now: at }, 'NOT_CURRENT');
  no({ paid: [...two, year(two[1].periodEnd)], now: two[1].periodEnd + DAY }, 'NOT_MONTHLY');
  // in full: no reduction on either month, and not below the list price; above it is still in full
  no({ paid: months(2, { reduce: (i) => i === 1 }) }, 'DISCOUNTED_MONTH');
  no({ paid: months(2, { reduce: (i) => i === 0 }) }, 'DISCOUNTED_MONTH');
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
  // month ends: 31 January → 28 February → 31 March is in a row
  const jan31 = Date.UTC(2027, 0, 31), feb28 = Date.UTC(2027, 1, 28), mar31 = Date.UTC(2027, 2, 31);
  is({ paid: [{ ...month(jan31), periodEnd: feb28 }, { ...month(feb28), periodEnd: mar31 }], now: feb28 + DAY }, OK, 'short February');
  // one month stored twice is one month; copies that disagree are read as the reduced one, in either order
  no({ paid: [two[1], two[1]] }, 'NOT_TWO_MONTHS');
  const reducedCopy = { ...two[1], amount: 179_100, applied: 'retention_monthly' };
  no({ paid: [two[0], two[1], reducedCopy] }, 'DISCOUNTED_MONTH'); no({ paid: [two[0], reducedCopy, two[1]] }, 'DISCOUNTED_MONTH');
  assert.equal(chargesOf([two[1], reducedCopy]).length, 1); assert.equal(chargesOf([reducedCopy, two[1]])[0].applied, 'retention_monthly');
  // what is not a month paid counts for nothing, whatever order it comes in
  const seconds = Math.floor(two[0].periodStart / 1000);
  const notMonths = {
    'twelve hours at nothing': { ...month(two[1].periodStart), periodEnd: two[1].periodStart + 12 * 3_600_000, amount: 0 },
    'a trial at nothing': { ...month(monthsAfter(T0, -2)), amount: 0, list: 0 },
    'a refunded month': { ...month(monthsAfter(T0, -1)), refunded: true },
    'times in seconds': { ...month(0), periodStart: seconds - 2_678_400, periodEnd: seconds },
    'times as strings': { ...month(monthsAfter(T0, -1)), periodStart: String(monthsAfter(T0, -1)) },
    'a list price never on the list': { ...month(monthsAfter(T0, -1)), amount: 199_500, list: 199_500 },
    'a period not yet begun': month(two[1].periodEnd + DAY),
    'a monthly charge claiming the annual reduction': { ...month(monthsAfter(T0, -1)), applied: 'annual' },
    'a cycle that does not exist': { ...month(monthsAfter(T0, -1)), cycle: 'weekly' },
    'a two-day period': { ...month(monthsAfter(T0, -1)), periodEnd: monthsAfter(T0, -1) + 2 * DAY },
    'nothing at all': null,
  };
  for (const [label, junk] of Object.entries(notMonths)) {
    no({ paid: [junk, two[1]] }, 'NOT_TWO_MONTHS'); no({ paid: [two[1], junk] }, 'NOT_TWO_MONTHS');
    is({ paid: [junk, ...two] }, OK, `${label}: ignored`); is({ paid: [...two, junk] }, OK, `${label}: ignored, whatever the order`);
  }
  // any offer record, of any shape, means the offer is spent; only no record at all leaves it open
  for (const retention of [{ kind: 'retention_monthly', acceptedAt: T0 }, { kind: 'retention_annual', acceptedAt: T0 }, { kind: 'retention_monthly' },
    { acceptedAt: '2026-10-11' }, {}, [], 'taken', '{"kind":"retention_monthly"}', 0, false]) no({ retention }, 'OFFER_ALREADY_USED');
  for (const retention of [null, undefined]) is({ retention }, OK, `${retention}: none taken`);
  // a family the price list does not cover is offered nothing
  assert.deepEqual(retentionOffers({ paid: two, now, children: 5 }), { eligible: false, reason: 'CHILDREN_NOT_PRICED', offers: [] });
  assert.deepEqual(retentionOffers({ paid: two, now: two[1].periodEnd, children: 1 }), { eligible: false, reason: 'NOT_CURRENT', offers: [] });
});

test('(4) no stacking: accepting works eligibility out itself, so no second offer of either kind however it is asked; the 10% is three charges counted from the charges; annual is the annual price', () => {
  const children = 2, two = months(2, { children }), now = two[1].periodStart + DAY;
  const taken = acceptRetention({ paid: two, now, children, kind: 'retention_monthly' });
  assert.deepEqual(taken, { kind: 'retention_monthly', acceptedAt: now });
  for (const kind of OFFER_KINDS) {
    assert.throws(() => acceptRetention({ paid: two, retention: taken, now, children, kind }), code('OFFER_ALREADY_USED'), `a second offer: ${kind}`);
    assert.throws(() => acceptRetention({ paid: two, retention: taken, now, children, kind, eligibility: { eligible: true } }), code('OFFER_ALREADY_USED'), 'a handed-in eligibility is never read');
  }
  assert.throws(() => acceptRetention({ paid: two, now, children: 5, kind: 'retention_monthly' }), code('CHILDREN_NOT_PRICED'), 'an offer never shown cannot be taken');
  assert.throws(() => acceptRetention({ paid: two, children, kind: 'retention_monthly' }), code('NOT_CURRENT'));
  assert.throws(() => acceptRetention({ paid: [], now, children, kind: 'retention_annual' }), code('NOT_CURRENT'), 'no history, no offer');
  assert.throws(() => acceptRetention({ paid: two, now, children, kind: 'both' }), code('INVALID_OFFER'));
  assert.throws(() => acceptRetention(), code('INVALID_OFFER'));
  // the next three monthly charges carry the 10%, counted from the charges recorded, and the fourth does not
  const run = (retention, from, count, history) => {
    const paid = [...history], amounts = []; let start = from;
    for (let i = 0; i < count; i++) {
      const c = chargeFor({ children, cycle: 'monthly', retention, paid, at: start }), end = monthsAfter(start, 1);
      amounts.push(c.amount); paid.push({ periodStart: start, periodEnd: end, cycle: 'monthly', amount: c.amount, list: c.list, applied: c.applied }); start = end;
    }
    return { amounts, paid };
  };
  const { amounts, paid } = run(taken, two[1].periodEnd, 5, two);
  assert.deepEqual(amounts, [341_100, 341_100, 341_100, 379_000, 379_000]);
  assert.deepEqual(run({ ...taken, chargesLeft: 1000 }, two[1].periodEnd, 5, two).amounts, amounts, 'a count stored beside the record changes nothing');
  const late = acceptRetention({ paid: two, now: two[1].periodEnd - DAY, children, kind: 'retention_monthly' });
  assert.deepEqual(run(late, two[1].periodEnd, 4, two).amounts, [341_100, 341_100, 341_100, 379_000], 'taken on the last day of a month: still the next three');
  // the same charge recorded twice, or worked out again after it was recorded, changes nothing
  const first = paid[2], second = paid[3];
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: [...two, first, first, second], at: paid[4].periodStart }).amount, 341_100, 'a duplicate is not another reduced charge');
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: [...two, first], at: first.periodStart }).amount, 341_100, 'working out a recorded charge again: the same answer');
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: paid.slice(0, 5), at: paid[4].periodStart }).amount, 341_100, 'the third, worked out again after it was recorded');
  // the months it covers pass: a family who cancelled anyway and came back later pays full price; the month already paid is not reduced
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: two, at: monthsAfter(now, 4) }).amount, 379_000);
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: two, at: now }).amount, 379_000);
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: two, at: two[1].periodStart }).amount, 379_000);
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: taken, paid: two }).amount, 379_000, 'no period named: full price');
  // annual is the annual price, with the monthly 10% running or not; the annual offer is that price and carries no monthly 10%
  assert.deepEqual(chargeFor({ children, cycle: 'annual', retention: taken, paid, at: two[1].periodEnd }), { amount: 3_638_400, list: 4_548_000, percentOff: 20, applied: 'annual' });
  const annualTaken = acceptRetention({ paid: two, now, children, kind: 'retention_annual' });
  assert.deepEqual(annualTaken, { kind: 'retention_annual', acceptedAt: now });
  assert.equal(chargeFor({ children, cycle: 'annual', retention: annualTaken, paid: two, at: two[1].periodEnd }).amount, 3_638_400);
  assert.equal(chargeFor({ children, cycle: 'monthly', retention: annualTaken, paid: two, at: two[1].periodEnd }).amount, 379_000);
  // a forged or malformed record reduces nothing
  for (const forged of [{ kind: 'retention_monthly' }, { kind: 'retention_monthly', acceptedAt: String(now) }, { kind: 'retention_monthly', acceptedAt: now + 0.5 },
    { kind: 'retention_monthly', acceptedAt: two[1].periodEnd + DAY }, { kind: 'vip', acceptedAt: now }, 'retention_monthly', [], true])
    assert.equal(chargeFor({ children, cycle: 'monthly', retention: forged, paid: two, at: two[1].periodEnd }).amount, 379_000, JSON.stringify(forged));
});

test('(5) simulation: every family of 1–4 children, cancelling in every month of two years and giving each answer — one reduction a charge at most, the 10% exactly three charges, annual never below the annual price, one offer a family', () => {
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
          if (c.applied === 'annual') assert.equal(c.amount, yearly, 'annual: the annual price, never less');
          if (c.applied === 'retention_monthly') { reduced++; assert.equal(c.amount, m - m / 10); }
          if (c.applied === null) assert.equal(c.amount, m);
          const end = cycle === 'annual' ? monthsAfter(start, 12) : monthsAfter(start, 1);
          paid.push({ periodStart: start, periodEnd: end, cycle, amount: c.amount, list: c.list, applied: c.applied });
          if (c.applied === 'annual') break; // a year paid: this family's story is told
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
        if (answer === 'retention_monthly' && accepted) assert.equal(reduced, 3, 'and runs all three');
      }
    }
  }
  assert.equal(families, 4 * 24 * 3); assert.ok(offersTaken > 0);
});
