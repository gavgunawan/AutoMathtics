// The owner's prices and the leaving offers (13 Sep 2026), checked three ways before the payment provider charges a rupiah by
// them: (1) every amount against a figure worked out by hand, (2) every amount against the rule it comes from, recomputed here
// independently in floating point and rounded, and (3) a simulation of every family of one to four children through every
// month, cancel attempt and offer, asserting the invariants rather than the figures: no charge ever carries two reductions,
// the 10% runs exactly three charges, an annual charge is never below the annual price, and no family takes a second offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTHLY_PRICES, ANNUAL_PERCENT_OFF, RETENTION, monthlyPrice, annualList, annualPrice, chargeFor, afterCharge,
  retentionEligibility, retentionOffers, acceptRetention } from '../server/pricing.mjs';
import { monthsAfter } from '../server/subscription.mjs';

const DAY = 86_400_000, T0 = Date.UTC(2026, 9, 11, 0, 0, 0); // 11 Oct 2026, the first day the grid charges
const code = (c) => (e) => e.code === c;

// (1) by hand
const BY_HAND = {
  1: { monthly: 199_000, annual: 1_910_400, tenOff: 179_100 },
  2: { monthly: 379_000, annual: 3_638_400, tenOff: 341_100 },
  3: { monthly: 519_000, annual: 4_982_400, tenOff: 467_100 },
  4: { monthly: 599_000, annual: 5_750_400, tenOff: 539_100 },
};

test('(1) by hand: monthly 199,000 · 379,000 · 519,000 · 599,000; annual 1,910,400 · 3,638,400 · 4,982,400 · 5,750,400; the leaving 10% 179,100 · 341,100 · 467,100 · 539,100', () => {
  for (const [n, want] of Object.entries(BY_HAND)) {
    const children = Number(n);
    assert.equal(monthlyPrice(children), want.monthly, `${n}: monthly`);
    assert.equal(annualPrice(children), want.annual, `${n}: annual`);
    assert.equal(chargeFor({ children, cycle: 'monthly' }).amount, want.monthly, `${n}: a monthly charge`);
    assert.equal(chargeFor({ children, cycle: 'annual' }).amount, want.annual, `${n}: an annual charge`);
    assert.equal(chargeFor({ children, cycle: 'monthly', discount: { kind: 'retention_monthly', chargesLeft: 1 } }).amount, want.tenOff, `${n}: a monthly charge under the leaving 10%`);
  }
  assert.deepEqual(Object.keys(MONTHLY_PRICES).map(Number), [1, 2, 3, 4], 'exactly four prices');
  for (const children of [0, 5, 6, -1, 1.5, '1', null, undefined]) {
    assert.equal(monthlyPrice(children), null, `${children}: not priced`); assert.equal(annualPrice(children), null);
    assert.throws(() => chargeFor({ children, cycle: 'monthly' }), code('CHILDREN_NOT_PRICED'));
  }
  assert.throws(() => chargeFor({ children: 1, cycle: 'weekly' }), code('INVALID_CYCLE'));
});

test('(2) by rule: annual is 12 × monthly less 20%, the leaving offer is monthly less 10%, recomputed independently in floating point', () => {
  assert.equal(ANNUAL_PERCENT_OFF, 20); assert.deepEqual(RETENTION, { monthlyPercentOff: 10, monthlyCharges: 3, paidMonthsInARow: 2 });
  for (let children = 1; children <= 4; children++) {
    const m = monthlyPrice(children);
    assert.equal(annualList(children), m * 12);
    assert.equal(annualPrice(children), Math.round(m * 12 * 0.8), `${children}: 12 × ${m} × 0.8`);
    assert.equal(Number.isSafeInteger(annualPrice(children)), true, 'a whole rupiah, with nothing rounded away');
    const offers = retentionOffers({ eligible: true }, children);
    assert.equal(offers[0].amount, Math.round(m * 0.9), `${children}: ${m} × 0.9`);
    assert.equal(offers[1].amount, annualPrice(children), 'the annual offer is the annual price itself');
    assert.notEqual(offers[1].amount, Math.round(annualPrice(children) * 0.8), 'and never 20% off the annual price as well');
  }
});

// a family's history, built the way a provider reports it: monthly periods, each starting where the last one ended
function months(count, { from = T0, amount = (list) => list, children = 1 } = {}) {
  const out = []; let start = from;
  for (let i = 0; i < count; i++) { const end = monthsAfter(start, 1), list = monthlyPrice(children); out.push({ periodStart: start, periodEnd: end, cycle: 'monthly', amount: amount(list, i), list }); start = end; }
  return out;
}

test('eligibility: two monthly charges in a row, both at full price, on a subscription running now, never taken before — and each rule on its own says no', () => {
  const two = months(2), mid = two[1].periodStart + 5 * DAY;
  assert.deepEqual(retentionEligibility({ cycle: 'monthly', paid: two, now: mid }), { eligible: true, reason: null });
  assert.deepEqual(retentionEligibility({ cycle: 'monthly', paid: months(7), now: months(7)[6].periodStart + DAY }), { eligible: true, reason: null }, 'more than two months: still two in a row');
  assert.equal(retentionEligibility({ cycle: 'monthly', paid: [...two].reverse(), now: mid }).eligible, true, 'any order in, the same answer');
  const no = (args, reason) => assert.deepEqual(retentionEligibility({ cycle: 'monthly', paid: two, now: mid, ...args }), { eligible: false, reason }, reason);
  no({ paid: months(1) }, 'NOT_TWO_MONTHS');
  no({ paid: [] }, 'NOT_TWO_MONTHS');
  no({ cycle: 'annual' }, 'NOT_MONTHLY');
  no({ paid: months(2, { amount: (list, i) => (i === 1 ? list - list / 10 : list) }) }, 'DISCOUNTED_MONTH');
  no({ paid: [two[0], { ...two[1], periodStart: two[0].periodEnd + 3 * DAY, periodEnd: monthsAfter(two[0].periodEnd + 3 * DAY, 1) }], now: two[0].periodEnd + 10 * DAY }, 'NOT_IN_A_ROW');
  no({ now: two[1].periodEnd }, 'NOT_CURRENT');
  no({ retention: { kind: 'retention_monthly', acceptedAt: T0, chargesLeft: 2 } }, 'OFFER_ALREADY_USED');
  no({ retention: { kind: 'retention_annual', acceptedAt: T0, chargesLeft: 0 } }, 'OFFER_ALREADY_USED');
  no({ paid: [...months(1), { ...months(2)[1], cycle: 'annual' }] }, 'NOT_TWO_MONTHS');
  // month ends: 31 January → 28 February → 31 March is in a row, however the months fall
  const jan31 = Date.UTC(2027, 0, 31), feb28 = Date.UTC(2027, 1, 28), mar31 = Date.UTC(2027, 2, 31);
  const clamped = [{ periodStart: jan31, periodEnd: feb28, cycle: 'monthly', amount: 199_000, list: 199_000 }, { periodStart: feb28, periodEnd: mar31, cycle: 'monthly', amount: 199_000, list: 199_000 }];
  assert.equal(retentionEligibility({ cycle: 'monthly', paid: clamped, now: feb28 + DAY }).eligible, true);
  assert.deepEqual(retentionOffers({ eligible: false, reason: 'NOT_MONTHLY' }, 1), [], 'not eligible: no offers at all');
  assert.deepEqual(retentionOffers({ eligible: true }, 5), [], 'a family the price list does not cover: none either');
});

test('no stacking: one offer a family, once; the 10% runs exactly three charges; annual is the annual price with or without a discount; a second acceptance of either kind is refused', () => {
  const two = months(2), now = two[1].periodStart + DAY, eligible = retentionEligibility({ cycle: 'monthly', paid: two, now });
  const taken = acceptRetention({ eligibility: eligible, kind: 'retention_monthly', now });
  assert.deepEqual(taken, { kind: 'retention_monthly', acceptedAt: now, cycle: 'monthly', chargesLeft: 3 });
  // the same family asks to cancel again, while the discount runs and after it has ended: never eligible, never an offer
  for (const retention of [taken, { ...taken, chargesLeft: 0 }]) {
    const again = retentionEligibility({ cycle: 'monthly', paid: months(6), retention, now: months(6)[5].periodStart + DAY });
    assert.deepEqual(again, { eligible: false, reason: 'OFFER_ALREADY_USED' });
    assert.deepEqual(retentionOffers(again, 1), []);
    for (const kind of ['retention_monthly', 'retention_annual']) assert.throws(() => acceptRetention({ eligibility: again, kind, now }), code('OFFER_ALREADY_USED'), kind);
  }
  // the 10% applies to the next three monthly charges and no more
  let discount = taken; const amounts = [];
  for (let i = 0; i < 5; i++) { const c = chargeFor({ children: 2, cycle: 'monthly', discount }); amounts.push(c.amount); discount = afterCharge(discount, c); }
  assert.deepEqual(amounts, [341_100, 341_100, 341_100, 379_000, 379_000]);
  // moving to annual while the 10% runs: the annual price exactly, and the 10% is gone for good
  const annual = chargeFor({ children: 2, cycle: 'annual', discount: taken });
  assert.deepEqual(annual, { amount: 3_638_400, list: 4_548_000, percentOff: 20, applied: 'annual' });
  assert.equal(afterCharge(taken, annual).chargesLeft, 0);
  assert.equal(chargeFor({ children: 2, cycle: 'monthly', discount: afterCharge(taken, annual) }).amount, 379_000, 'back to monthly later: full price');
  // the annual offer is taken on its own terms and nothing more
  const annualOffer = acceptRetention({ eligibility: eligible, kind: 'retention_annual', now });
  assert.deepEqual(annualOffer, { kind: 'retention_annual', acceptedAt: now, cycle: 'annual', chargesLeft: 0 });
  assert.equal(chargeFor({ children: 2, cycle: 'annual', discount: annualOffer }).amount, 3_638_400);
  assert.equal(chargeFor({ children: 2, cycle: 'monthly', discount: annualOffer }).amount, 379_000, 'the annual offer carries no monthly 10%');
  assert.throws(() => acceptRetention({ eligibility: { eligible: false, reason: 'NOT_MONTHLY' }, kind: 'retention_monthly', now }), code('NOT_MONTHLY'));
  assert.throws(() => acceptRetention({ eligibility: eligible, kind: 'both', now }), code('INVALID_OFFER'));
  // a forged discount record cannot deepen or lengthen a reduction: an unknown kind, a negative or fractional count, applies nothing
  for (const forged of [{ kind: 'retention_annual', chargesLeft: 3 }, { kind: 'retention_monthly', chargesLeft: -1 }, { kind: 'retention_monthly', chargesLeft: 1.5 }, { kind: 'vip', chargesLeft: 9 }])
    assert.equal(chargeFor({ children: 1, cycle: 'monthly', discount: forged }).amount, 199_000, JSON.stringify(forged));
});

test('(3) simulation: every family of 1–4 children, cancelling at every month of two years and taking each answer — no charge ever holds two reductions, the 10% runs three charges, annual never drops below the annual price, one offer a family', () => {
  const answers = ['decline', 'retention_monthly', 'retention_annual'];
  let families = 0, offersTaken = 0;
  for (let children = 1; children <= 4; children++) {
    const m = monthlyPrice(children), yearly = annualPrice(children);
    for (let cancelAt = 0; cancelAt < 24; cancelAt++) {
      for (const answer of answers) {
        families++;
        let cycle = 'monthly', retention = null, discount = null, start = T0, reduced = 0, accepted = 0;
        const paid = [];
        for (let month = 0; month < 36; month++) {
          // every period is charged at its start, in advance; a parent can ask to cancel at any point inside it
          const c = chargeFor({ children, cycle, discount });
          assert.ok(['annual', 'retention_monthly', null].includes(c.applied), 'one reduction at most, named');
          if (c.applied === 'annual') assert.equal(c.amount, yearly, 'annual: the annual price, never less');
          if (c.applied === 'retention_monthly') { reduced++; assert.equal(c.amount, m - m / 10); }
          if (c.applied === null) assert.equal(c.amount, m);
          assert.ok(c.amount >= (cycle === 'annual' ? yearly : m - m / 10), 'no charge below its one allowed reduction');
          discount = afterCharge(discount, c);
          const end = cycle === 'annual' ? monthsAfter(start, 12) : monthsAfter(start, 1);
          paid.push({ periodStart: start, periodEnd: end, cycle, amount: c.amount, list: c.list });
          if (c.applied === 'annual') break; // a year paid: this family's story is told
          if (month === cancelAt) {
            const now = start + DAY;
            const eligibility = retentionEligibility({ cycle, paid, retention, now });
            const offers = retentionOffers(eligibility, children);
            assert.equal(offers.length, eligibility.eligible ? 2 : 0);
            assert.equal(eligibility.eligible, paid.length >= 2, `${children} children, cancelling in month ${cancelAt + 1}: eligible exactly when two full months are paid`);
            if (eligibility.eligible && answer !== 'decline') {
              retention = acceptRetention({ eligibility, kind: answer, now }); accepted++; offersTaken++;
              if (answer === 'retention_monthly') discount = retention; else cycle = 'annual'; // either way, from the next charge
              // asked again at once: refused, whichever kind
              const again = retentionEligibility({ cycle, paid, retention, now });
              for (const kind of answers.slice(1)) assert.throws(() => acceptRetention({ eligibility: again, kind, now }), code('OFFER_ALREADY_USED'));
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
