// What a family pays, in one place (the owner's rules of 13 Sep 2026): the prices the public pages quote, and the arithmetic the
// payment provider's adapter (Xendit, next) must charge by. Whole Indonesian rupiah in integer arithmetic — a reduction that did
// not come out whole would be a price nobody chose, so it is refused rather than rounded.
//
//   monthly      IDR 199,000 for one child · 379,000 two · 519,000 three · 599,000 four. Five or more are priced by hand.
//   annual       12 × the monthly price, less 20%: IDR 1,910,400 · 3,638,400 · 4,982,400 · 5,750,400.
//   leaving      a monthly subscriber whose two latest monthly charges were in a row and both at full price, asking to cancel
//                while that month runs, is offered ONE of: 10% off the next three monthly charges, or the annual plan at the
//                annual price above.
//   no stacking  a charge carries at most one reduction. An annual charge is the annual price and nothing less; the annual offer
//                is the ordinary annual 20%, never 20% off that; and a family takes one leaving offer, once — any stored offer
//                record, whatever its shape, means the offer is spent.
//
// Nothing here is a counter that can drift. Whether the 10% still applies is worked out every time from the family's recorded
// charges — how many already carried it, and whether the months it covers have passed — so a charge recorded twice, a retried
// request or a forged count changes nothing; and accepting an offer works its own eligibility out from the family's facts rather
// than trusting one handed in. An adversarial review of the first version (13 Sep 2026) could take both offers, take one twice and
// stretch the 10% past three charges; each of those is a test in tests/pricing.test.mjs now.
import { fail } from './security.mjs';
import { GRACE_DAYS, monthsAfter } from './subscription.mjs';

const DAY = 86_400_000;
export const MONTHLY_PRICES = Object.freeze({ 1: 199_000, 2: 379_000, 3: 519_000, 4: 599_000 });
export const CYCLES = Object.freeze(['monthly', 'annual']);
export const ANNUAL_PERCENT_OFF = 20;
export const RETENTION = Object.freeze({ monthlyPercentOff: 10, monthlyCharges: 3, paidMonthsInARow: 2 });
export const OFFER_KINDS = Object.freeze(['retention_monthly', 'retention_annual']);
// "In a row": the later month starts where the earlier one ended — up to three days early (how a provider stamps a boundary), or
// as late as the grace period (subscription.mjs), since a renewal paid late is still the same subscription. More is a break.
export const IN_A_ROW = Object.freeze({ earlyMs: 3 * DAY, lateMs: GRACE_DAYS * DAY });
// What a charge's period may span: a calendar month is 28–31 days and a year 365–366, with a day's slack either side.
export const PERIOD_SPAN = Object.freeze({ monthly: Object.freeze({ min: 27 * DAY, max: 32 * DAY }), annual: Object.freeze({ min: 364 * DAY, max: 367 * DAY }) });
// The list prices a month may have been charged at. When the price list changes, keep the retired prices here too: a month
// charged at a list price this does not know is not counted as a month paid.
export const KNOWN_MONTHLY_LISTS = Object.freeze(Object.values(MONTHLY_PRICES));
const MS_FLOOR = Date.UTC(2020, 0, 1); // times are milliseconds: a record in seconds reads as 1970, and is refused rather than trusted
const APPLIED = Object.freeze({ monthly: 'retention_monthly', annual: 'annual' }); // the one reduction a charge of each cycle can carry

/** `percent` of `amount`, which must come out a whole rupiah: 10% of 199,000 is 19,900; a fraction is a refusal, never a rounding. */
function percentOf(amount, percent) {
  const part = (amount * percent) / 100;
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(part)) throw Error(`${percent}% of ${amount} is not a whole rupiah`);
  return part;
}
export const lessPercent = (amount, percent) => amount - percentOf(amount, percent);

/** The monthly price for this many children — a whole number the price list covers — or null. */
export const monthlyPrice = (children) => (Number.isInteger(children) && Object.hasOwn(MONTHLY_PRICES, children) ? MONTHLY_PRICES[children] : null);
/** Twelve months of the monthly price: what a year costs before the annual 20% comes off. */
export const annualList = (children) => { const m = monthlyPrice(children); return m === null ? null : 12 * m; };
/** The annual price: twelve months less 20%. */
export const annualPrice = (children) => { const list = annualList(children); return list === null ? null : lessPercent(list, ANNUAL_PERCENT_OFF); };

/**
 * A successful charge as the adapter records it: { periodStart, periodEnd, cycle, amount, list, applied?, refunded? }, times in
 * milliseconds. Anything else — refunded, a trial at nothing, a period the wrong length, times in seconds, strings, a monthly list
 * price the price list never had, a reduction the cycle cannot carry — is not a charge, and counts for nothing.
 */
export function isCharge(p) {
  if (!p || typeof p !== 'object' || !CYCLES.includes(p.cycle) || p.refunded === true) return false;
  const { periodStart: start, periodEnd: end, amount, list } = p;
  if (![start, end, amount, list].every(Number.isSafeInteger) || start < MS_FLOOR || end <= start || amount <= 0 || list <= 0) return false;
  const span = PERIOD_SPAN[p.cycle];
  if (end - start < span.min || end - start > span.max) return false;
  if (p.cycle === 'monthly' && !KNOWN_MONTHLY_LISTS.includes(list)) return false;
  return p.applied === undefined || p.applied === null || p.applied === APPLIED[p.cycle];
}
// Of two records of one period, the one to believe: the reduced one, then the lower amount, then the higher list — never the kinder
// reading, and the same answer whatever order the copies come in.
const moreCautious = (a, b) => (!!a.applied !== !!b.applied ? !!a.applied : a.amount !== b.amount ? a.amount < b.amount : a.list > b.list);
/** The family's charges that count, newest first: one record per period however often it was stored. */
export function chargesOf(paid) {
  const byPeriod = new Map();
  for (const p of Array.isArray(paid) ? paid : []) {
    if (!isCharge(p)) continue;
    const key = `${p.cycle}:${p.periodStart}:${p.periodEnd}`, kept = byPeriod.get(key);
    if (!kept || moreCautious(p, kept)) byPeriod.set(key, p);
  }
  return [...byPeriod.values()].sort((a, b) => b.periodEnd - a.periodEnd || b.periodStart - a.periodStart);
}

/**
 * Whether the leaving 10% reduces the monthly charge for the period starting `at`: a monthly offer taken before that period began,
 * the period beginning within the months the offer covers, and fewer than three other charges already reduced by it.
 */
function retentionReduces(retention, charges, at) {
  if (!retention || typeof retention !== 'object' || retention.kind !== 'retention_monthly' || !Number.isSafeInteger(retention.acceptedAt)) return false;
  if (!Number.isSafeInteger(at) || at <= retention.acceptedAt || at >= monthsAfter(retention.acceptedAt, RETENTION.monthlyCharges + 1)) return false;
  const used = charges.filter((c) => c.cycle === 'monthly' && c.applied === 'retention_monthly' && c.periodStart > retention.acceptedAt && c.periodStart !== at).length;
  return used < RETENTION.monthlyCharges;
}

/**
 * One charge, for the period starting `at`.
 *   children   how many children the plan covers now
 *   cycle      'monthly' or 'annual'
 *   retention  the family's leaving-offer record ({ kind, acceptedAt }), or null
 *   paid       the family's successful charges so far, reduced ones included
 * → { amount, list, percentOff, applied }: `applied` names the one reduction in it — 'annual', 'retention_monthly' or null.
 */
export function chargeFor({ children, cycle, retention = null, paid = [], at } = {}) {
  if (!CYCLES.includes(cycle)) fail(400, 'INVALID_CYCLE');
  const monthly = monthlyPrice(children);
  if (monthly === null) fail(400, 'CHILDREN_NOT_PRICED');
  // an annual charge is the annual price whatever else the family holds: the one reduction it carries is the annual 20%
  if (cycle === 'annual') return { amount: annualPrice(children), list: annualList(children), percentOff: ANNUAL_PERCENT_OFF, applied: 'annual' };
  if (retentionReduces(retention, chargesOf(paid), at)) {
    return { amount: lessPercent(monthly, RETENTION.monthlyPercentOff), list: monthly, percentOff: RETENTION.monthlyPercentOff, applied: 'retention_monthly' };
  }
  return { amount: monthly, list: monthly, percentOff: 0, applied: null };
}

/**
 * Whether a family asking to cancel at `now` is offered the leaving discounts, and if not, the first rule that says no.
 *   paid       its successful charges, any order
 *   retention  its leaving-offer record, or null — any stored record at all means the offer is spent
 * → { eligible, reason }
 */
export function retentionEligibility({ paid = [], retention = null, now } = {}) {
  if (retention !== null && retention !== undefined) return { eligible: false, reason: 'OFFER_ALREADY_USED' };
  if (!Number.isSafeInteger(now)) return { eligible: false, reason: 'NOT_CURRENT' };
  const charges = chargesOf(paid).filter((c) => c.periodStart <= now); // a period not yet begun is not a month paid
  const current = charges.find((c) => now < c.periodEnd); // the charge for the period running now: the flow is for a live subscription
  if (!current) return { eligible: false, reason: 'NOT_CURRENT' };
  if (current.cycle !== 'monthly') return { eligible: false, reason: 'NOT_MONTHLY' }; // an annual subscriber has the annual 20% already
  const [last, before] = charges.filter((c) => c.cycle === 'monthly');
  if (!before) return { eligible: false, reason: 'NOT_TWO_MONTHS' };
  const inFull = (c) => !c.applied && c.amount >= c.list;
  if (!inFull(last) || !inFull(before)) return { eligible: false, reason: 'DISCOUNTED_MONTH' };
  const gap = last.periodStart - before.periodEnd;
  if (gap < -IN_A_ROW.earlyMs || gap > IN_A_ROW.lateMs) return { eligible: false, reason: 'NOT_IN_A_ROW' };
  return { eligible: true, reason: null };
}

/** The two offers, priced for the family's children, when it is eligible — none otherwise. It takes one of them, or neither. → { eligible, reason, offers } */
export function retentionOffers({ paid = [], retention = null, now, children } = {}) {
  const decided = retentionEligibility({ paid, retention, now });
  if (!decided.eligible) return { ...decided, offers: [] };
  const monthly = monthlyPrice(children);
  if (monthly === null) return { eligible: false, reason: 'CHILDREN_NOT_PRICED', offers: [] }; // five or more: priced by hand, offered by hand
  return { eligible: true, reason: null, offers: [
    { kind: 'retention_monthly', percentOff: RETENTION.monthlyPercentOff, charges: RETENTION.monthlyCharges, amount: lessPercent(monthly, RETENTION.monthlyPercentOff), list: monthly },
    { kind: 'retention_annual', percentOff: ANNUAL_PERCENT_OFF, amount: annualPrice(children), list: annualList(children) },
  ] };
}

/**
 * Take one offer: the record to store on the family, { kind, acceptedAt }, made in the transaction that read the facts it is given.
 * It works the offers out again from those facts — never from an eligibility handed to it — so a family holding any offer record
 * is refused, and neither offer can join the other or be taken twice. The annual offer moves the family to the annual cycle at the
 * ordinary annual price, from its next renewal.
 */
export function acceptRetention({ paid = [], retention = null, now, children, kind } = {}) {
  if (!OFFER_KINDS.includes(kind)) fail(400, 'INVALID_OFFER');
  const decided = retentionOffers({ paid, retention, now, children });
  if (!decided.eligible) fail(409, decided.reason);
  return { kind, acceptedAt: now };
}
