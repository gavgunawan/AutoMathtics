// What a family pays, in one place (the owner's rules of 13 Sep 2026): the prices the public pages quote, and the arithmetic the
// payment provider's adapter (Xendit, next) must charge by. Every amount is whole Indonesian rupiah and computed in integers —
// IDR has no smaller unit in practice, so a reduction that did not come out whole would be a price nobody chose, and it is
// refused rather than rounded.
//
//   monthly      IDR 199,000 for one child · 379,000 two · 519,000 three · 599,000 four. Five or more are priced by hand.
//   annual       12 × the monthly price, less 20%: IDR 1,910,400 · 3,638,400 · 4,982,400 · 5,750,400.
//   leaving      a monthly subscriber who has paid two months in a row, both at full price, and asks to cancel, is offered
//                ONE of: 10% off the next three monthly charges, or the annual plan at the annual price above.
//   no stacking  a charge carries at most one reduction. An annual charge is the annual price and nothing less: the leaving
//                10% never touches it, and the annual offer is the ordinary annual 20%, never 20% off that. A family takes
//                one leaving offer, once: the offer is never shown again, so it cannot run twice or be topped up by the other.
import { fail } from './security.mjs';

const DAY = 86_400_000;
export const MONTHLY_PRICES = Object.freeze({ 1: 199_000, 2: 379_000, 3: 519_000, 4: 599_000 });
export const CYCLES = Object.freeze(['monthly', 'annual']);
export const ANNUAL_PERCENT_OFF = 20;
export const RETENTION = Object.freeze({ monthlyPercentOff: 10, monthlyCharges: 3, paidMonthsInARow: 2 });
export const OFFER_KINDS = Object.freeze(['retention_monthly', 'retention_annual']);

/** `percent` of `amount`, which must come out a whole rupiah: 10% of 199,000 is 19,900; a fraction is a refusal, never a rounding. */
function percentOf(amount, percent) {
  const part = (amount * percent) / 100;
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(part)) throw Error(`${percent}% of ${amount} is not a whole rupiah`);
  return part;
}
export const lessPercent = (amount, percent) => amount - percentOf(amount, percent);

/** The monthly price for this many children, or null when it is not a number of children the price list covers. */
export const monthlyPrice = (children) => (Number.isInteger(children) && Object.hasOwn(MONTHLY_PRICES, children) ? MONTHLY_PRICES[children] : null); // a number, not '1'
/** Twelve months of the monthly price: what a year costs before the annual 20% comes off. */
export const annualList = (children) => { const m = monthlyPrice(children); return m === null ? null : 12 * m; };
/** The annual price: twelve months less 20%. */
export const annualPrice = (children) => { const list = annualList(children); return list === null ? null : lessPercent(list, ANNUAL_PERCENT_OFF); };

/**
 * One charge. `discount` is the family's leaving discount as recorded (acceptRetention) or null.
 * → { amount, list, percentOff, applied }: `applied` names the one reduction in it — 'annual', 'retention_monthly' or null.
 */
export function chargeFor({ children, cycle, discount = null }) {
  if (!CYCLES.includes(cycle)) fail(400, 'INVALID_CYCLE');
  const monthly = monthlyPrice(children);
  if (monthly === null) fail(400, 'CHILDREN_NOT_PRICED');
  // an annual charge is the annual price, whatever discount the family holds: the one reduction it carries is the annual 20%
  if (cycle === 'annual') return { amount: annualPrice(children), list: annualList(children), percentOff: ANNUAL_PERCENT_OFF, applied: 'annual' };
  if (discountRuns(discount)) return { amount: lessPercent(monthly, RETENTION.monthlyPercentOff), list: monthly, percentOff: RETENTION.monthlyPercentOff, applied: 'retention_monthly' };
  return { amount: monthly, list: monthly, percentOff: 0, applied: null };
}
const discountRuns = (d) => d?.kind === 'retention_monthly' && Number.isSafeInteger(d.chargesLeft) && d.chargesLeft > 0;

/** The discount after a successful charge: one of its charges spent when it applied, and nothing left of it on an annual charge. */
export function afterCharge(discount, charge) {
  if (!discount) return null;
  if (charge.applied === 'annual') return { ...discount, chargesLeft: 0 }; // moving to annual ends the monthly 10%: it never stacks
  if (charge.applied === 'retention_monthly') return { ...discount, chargesLeft: discount.chargesLeft - 1 };
  return discount;
}

/**
 * Whether a family asking to cancel is offered the leaving discounts, and if not, the first rule that says no.
 *   cycle      the family's billing cycle now
 *   paid       its successful charges, any order: { periodStart, periodEnd, cycle, amount, list }
 *   retention  its leaving-offer record, or null: { kind, acceptedAt, chargesLeft }
 * → { eligible, reason }
 */
export function retentionEligibility({ cycle, paid = [], retention = null, now }) {
  if (retention && Number.isSafeInteger(retention.acceptedAt)) return { eligible: false, reason: 'OFFER_ALREADY_USED' }; // once a family, and never while one runs
  if (cycle !== 'monthly') return { eligible: false, reason: 'NOT_MONTHLY' }; // an annual subscriber has the annual 20% already
  const months = paid.filter((p) => p?.cycle === 'monthly' && Number.isSafeInteger(p.periodStart) && Number.isSafeInteger(p.periodEnd) && p.periodEnd > p.periodStart)
    .sort((a, b) => b.periodEnd - a.periodEnd);
  const [last, before] = months;
  if (!last || !before) return { eligible: false, reason: 'NOT_TWO_MONTHS' };
  // both at full price: a month that already carried a reduction is not a month paid in full
  if (last.amount !== last.list || before.amount !== before.list) return { eligible: false, reason: 'DISCOUNTED_MONTH' };
  // in a row: the later month starts where the earlier one ended (a day's slack for how a provider stamps the boundary)
  if (Math.abs(last.periodStart - before.periodEnd) > DAY) return { eligible: false, reason: 'NOT_IN_A_ROW' };
  if (!(now < last.periodEnd)) return { eligible: false, reason: 'NOT_CURRENT' }; // the flow is for a subscription running now
  return { eligible: true, reason: null };
}

/** The two offers for an eligible family, priced for its children; none otherwise. The family takes one of them, or neither. */
export function retentionOffers(eligibility, children) {
  if (!eligibility?.eligible || monthlyPrice(children) === null) return [];
  const monthly = monthlyPrice(children);
  return [
    { kind: 'retention_monthly', percentOff: RETENTION.monthlyPercentOff, charges: RETENTION.monthlyCharges, amount: lessPercent(monthly, RETENTION.monthlyPercentOff), list: monthly },
    { kind: 'retention_annual', percentOff: ANNUAL_PERCENT_OFF, amount: annualPrice(children), list: annualList(children) },
  ];
}

/**
 * The record of the one offer a family takes, made in the same transaction that reads the eligibility. Refused whenever the
 * family is not eligible — and having taken either offer before is itself a reason it is not — so no second offer can join a
 * first, and neither can be taken twice. The annual offer moves the family to the annual cycle at the ordinary annual price.
 */
export function acceptRetention({ eligibility, kind, now }) {
  if (!OFFER_KINDS.includes(kind)) fail(400, 'INVALID_OFFER');
  if (!eligibility?.eligible) fail(409, eligibility?.reason || 'OFFER_NOT_OFFERED');
  if (!Number.isSafeInteger(now)) fail(400, 'INVALID_REQUEST');
  return kind === 'retention_monthly'
    ? { kind, acceptedAt: now, cycle: 'monthly', chargesLeft: RETENTION.monthlyCharges }
    : { kind, acceptedAt: now, cycle: 'annual', chargesLeft: 0 };
}
