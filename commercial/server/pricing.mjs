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
//                is the ordinary annual 20%, never 20% off that; and a family takes one leaving offer, once.
//
// Nothing here is a counter that can drift. Whether the 10% still applies is worked out every time from the family's recorded
// charges, and "once" is read from the facts twice over — the stored offer record, and any charge either offer was ever made under —
// so a charge recorded twice or recorded badly, a recomputed charge, a lost or re-saved record or a forged count cannot give a family
// more than one offer or more than three reduced charges. Where the facts needed for that count are missing or cut short, this
// refuses rather than guesses. Three adversarial reviews (13 Sep 2026) broke the earlier versions in every way the tests now pin.
import { fail } from './security.mjs';
import { GRACE_DAYS, monthsAfter } from './subscription.mjs';

const DAY = 86_400_000;
export const MONTHLY_PRICES = Object.freeze({ 1: 199_000, 2: 379_000, 3: 519_000, 4: 599_000 });
export const CYCLES = Object.freeze(['monthly', 'annual']);
export const ANNUAL_PERCENT_OFF = 20;
export const RETENTION = Object.freeze({ monthlyPercentOff: 10, monthlyCharges: 3, paidMonthsInARow: 2 });
export const OFFER_KINDS = Object.freeze(['retention_monthly', 'retention_annual']);
// "In a row": the later month starts where the earlier one ended — up to three days early (how a provider stamps a boundary), or
// as late as the grace period (subscription.mjs), since a renewal paid late is still the same subscription. More is a break: for the
// two months that make a family eligible, and for the three months the 10% runs along.
export const IN_A_ROW = Object.freeze({ earlyMs: 3 * DAY, lateMs: GRACE_DAYS * DAY });
// What a charge's period may span: a calendar month is 28–31 days, with a day's slack either side; an annual charge runs up to a
// year and a day, and may be shorter when a provider prorates it onto the monthly anchor.
export const PERIOD_SPAN = Object.freeze({ monthly: Object.freeze({ min: 27 * DAY, max: 32 * DAY }), annual: Object.freeze({ min: 27 * DAY, max: 367 * DAY }) });
// The list prices a month may have been charged at — written out, never derived from MONTHLY_PRICES, so that changing a price cannot
// drop the old one: a month charged at a retired price must still count. When a price changes, add the new one here and keep the old.
export const KNOWN_MONTHLY_LISTS = Object.freeze([199_000, 379_000, 519_000, 599_000]);
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

// A flag that plainly says yes: any truthy value, except the strings that plainly say no.
const said = (v) => (typeof v === 'string' ? !['', 'false', '0', 'no'].includes(v.trim().toLowerCase()) : Boolean(v));
// Refunded in any way a record might say so — a flag, a time, an amount under any of its usual names, a list of refunds, a status
// mentioning a refund in any case — is not a month paid in full. A flag that plainly says no ('false', 0, '') is not a refund.
const refundedAtAll = (p) => said(p.refunded) || said(p.refundedAt) || [p.refundedAmount, p.amountRefunded, p.refunded_amount].some((v) => Number(v) > 0)
  || (Array.isArray(p.refunds) && p.refunds.length > 0) || /refund/i.test(String(p.status ?? ''));

/**
 * A successful charge as the adapter records it: { periodStart, periodEnd, cycle, amount, list, applied?, refunded? }, times in
 * milliseconds. Anything else — refunded, a proration (proration: true: a charge, not a month), a trial at nothing, a period the
 * wrong length, times in seconds, strings, a monthly list price the price list never had, a reduction the cycle cannot carry — is not
 * a month's charge, and counts for nothing as a month paid.
 */
export function isCharge(p) {
  if (!p || typeof p !== 'object' || !CYCLES.includes(p.cycle) || refundedAtAll(p) || said(p.proration)) return false;
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
/** The family's charges that count as paid, newest first: one record per period however often it was stored. */
export function chargesOf(paid) {
  const byPeriod = new Map();
  for (const p of Array.isArray(paid) ? paid : []) {
    if (!isCharge(p)) continue;
    const key = `${p.cycle}:${p.periodStart}:${p.periodEnd}`, kept = byPeriod.get(key);
    if (!kept || moreCautious(p, kept)) byPeriod.set(key, p);
  }
  return [...byPeriod.values()].sort((a, b) => b.periodEnd - a.periodEnd || b.periodStart - a.periodStart);
}

// The 10% is counted two ways, and a charge carries it only when both allow.
//
// Loosely, on the side that cannot stack: a record claiming the reduction counts as a use of it whatever else is wrong with it —
// refunded, a wrong length, strings, the wrong case — and whenever it was charged; a monthly charge below its list price after the
// offer was taken counts too, labelled or not, unless it is a proration. One period stored twice is one use.
const claimsRetention = (r) => !!r && typeof r === 'object' && String(r.applied).toLowerCase() === 'retention_monthly';
// Either offer marks the charges made under it (chargeFor's `offer`): a charge so marked means the offer was taken, record or no record.
const marksOffer = (r) => claimsRetention(r) || (!!r && typeof r === 'object' && OFFER_KINDS.includes(String(r.offer).toLowerCase()));
const belowListAfter = (r, acceptedAt) => !!r && typeof r === 'object' && !said(r.proration) && String(r.cycle).toLowerCase() === 'monthly'
  && Number(r.amount) < Number(r.list) && Number(r.periodStart) > acceptedAt;
function retentionUses(paid, acceptedAt, at) {
  const periods = new Set();
  paid.forEach((r, i) => {
    if (!(claimsRetention(r) || belowListAfter(r, acceptedAt)) || Number(r.periodStart) === at) return; // a charge is not a use of itself
    // one period stored twice is one use; a record with no period to tell it by is a use of its own
    periods.add(Number.isSafeInteger(r.periodStart) && Number.isSafeInteger(r.periodEnd) ? `${r.periodStart}:${r.periodEnd}` : `record:${i}`);
  });
  return periods.size;
}
// And along the months: the charges that carry it are the three after the month the offer was taken in, found by walking the
// recorded monthly periods from that month one at a time — each starting where the last ended (IN_A_ROW) — never by counting
// whatever the list holds. A history cut short, or missing a month, cannot make a fourth charge look like a third: the walk stops at
// the gap, and the 10% does not cross it. A break in the subscription stops it the same way, so a family who cancels during the
// three months and comes back pays full price. Any record naming a monthly period is a step, however else it is wrong, except a
// proration and a period longer than a month can be; where several could be the next step, the one reaching furthest.
const monthlyPeriod = (r) => {
  if (!r || typeof r !== 'object' || String(r.cycle).toLowerCase() !== 'monthly' || said(r.proration)) return null;
  const start = Number(r.periodStart), end = Number(r.periodEnd);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < end && end - start <= PERIOD_SPAN.monthly.max ? { start, end } : null;
};
const follows = (start, end) => start - end >= -IN_A_ROW.earlyMs && start - end <= IN_A_ROW.lateMs;
const furthest = (periods) => periods.reduce((end, p) => Math.max(end, p.end), -Infinity);
/** Which charge after the month the offer was taken in the one for the period starting `at` is — 1 for the first — or Infinity when the walk does not reach it within three. */
function chargeNumber(paid, acceptedAt, at) {
  const periods = paid.map(monthlyPeriod).filter(Boolean);
  let end = furthest(periods.filter((p) => p.start <= acceptedAt && acceptedAt < p.end));
  for (let n = 1; n <= RETENTION.monthlyCharges && end > -Infinity; n++) {
    if (follows(at, end)) return n;
    end = furthest(periods.filter((p) => follows(p.start, end)));
  }
  return Infinity;
}
const covers = (r, t) => !!r && typeof r === 'object' && String(r.cycle).toLowerCase() === 'monthly' && Number(r.periodStart) <= t && t < Number(r.periodEnd);

/** Whether the leaving 10% reduces the monthly charge for the period starting `at`: one of the three charges after the month the offer was taken in, walked to without a gap, while fewer than three others carried it. */
function retentionReduces(retention, paid, at) {
  if (!retention || typeof retention !== 'object' || retention.kind !== 'retention_monthly' || !Number.isSafeInteger(retention.acceptedAt)) return false;
  // After the offer was taken, and within the four months after it. The walk already keeps every reduced charge inside that — three
  // steps of at most a month and a grace period each — and the bound stays for the day the grace period or a month's span changes.
  if (at <= retention.acceptedAt || at >= monthsAfter(retention.acceptedAt, RETENTION.monthlyCharges + 1)) return false;
  // The history must reach back to the month the offer was taken in: there is nothing to walk from without it, and a list cut down
  // to its latest charges would count fewer uses than there were. Refused rather than trusted.
  if (!paid.some((r) => covers(r, retention.acceptedAt))) fail(400, 'PAID_INCOMPLETE');
  return chargeNumber(paid, retention.acceptedAt, at) <= RETENTION.monthlyCharges && retentionUses(paid, retention.acceptedAt, at) < RETENTION.monthlyCharges;
}

/**
 * One charge, for the period starting `at`.
 *   children   how many children the plan covers now
 *   cycle      'monthly' or 'annual'
 *   retention  the family's leaving-offer record ({ kind, acceptedAt }), or null — a required key, as for eligibility
 *   paid       the family's recorded charges, reduced ones included, from at least the month an offer was taken in — required,
 *              with `at`, when there is an offer record
 * → { amount, list, percentOff, applied, offer }: `applied` names the one reduction in it — 'annual', 'retention_monthly' or null —
 * and `offer` the leaving offer it was made under, or null. Record both with the charge.
 */
export function chargeFor(args = {}) {
  const { children, cycle, retention, paid, at } = args && typeof args === 'object' ? args : {};
  if (!CYCLES.includes(cycle)) fail(400, 'INVALID_CYCLE');
  const monthly = monthlyPrice(children);
  if (monthly === null) fail(400, 'CHILDREN_NOT_PRICED');
  // "No offer" is never read from the record's absence: charged without it, a yearly charge taken as the offer would carry no mark
  // of it, so the offer could be taken again, and a monthly charge would lose the 10%.
  if (!Object.hasOwn(args, 'retention')) fail(400, 'RETENTION_REQUIRED');
  // An annual charge is the annual price whatever else the family holds: the one reduction it carries is the annual 20%. Taken as the
  // leaving offer, it is marked so — the annual offer leaves no other trace — so a lost offer record cannot reopen the offer later.
  if (cycle === 'annual') {
    const offer = !!retention && typeof retention === 'object' && retention.kind === 'retention_annual' ? 'retention_annual' : null;
    return { amount: annualPrice(children), list: annualList(children), percentOff: ANNUAL_PERCENT_OFF, applied: 'annual', offer };
  }
  if (retention !== null && retention !== undefined) {
    // an offer record is on the family: the charges and the period are how the 10% is counted, and without them this cannot count
    if (!Array.isArray(paid)) fail(400, 'PAID_REQUIRED');
    if (!Number.isSafeInteger(at)) fail(400, 'PERIOD_REQUIRED');
    if (retentionReduces(retention, paid, at)) {
      return { amount: lessPercent(monthly, RETENTION.monthlyPercentOff), list: monthly, percentOff: RETENTION.monthlyPercentOff, applied: 'retention_monthly', offer: 'retention_monthly' };
    }
  }
  return { amount: monthly, list: monthly, percentOff: 0, applied: null, offer: null };
}

/**
 * Whether a family asking to cancel at `now` is offered the leaving discounts, and if not, the first rule that says no.
 *   paid       its recorded charges, any order
 *   retention  its stored leaving-offer record, or null — a required key: "no offer taken" is never assumed from its absence
 * → { eligible, reason }
 */
export function retentionEligibility(args = {}) {
  if (!args || typeof args !== 'object' || !Object.hasOwn(args, 'retention')) fail(400, 'RETENTION_REQUIRED');
  const { paid = [], retention, now } = args;
  if (retention !== null && retention !== undefined) return { eligible: false, reason: 'OFFER_ALREADY_USED' }; // any stored record, of any shape
  if (Array.isArray(paid) && paid.some(marksOffer)) return { eligible: false, reason: 'OFFER_ALREADY_USED' }; // the charges show it taken, record or no record
  if (!Number.isSafeInteger(now)) return { eligible: false, reason: 'NOT_CURRENT' };
  const charges = chargesOf(paid);
  if (charges.some((c) => c.cycle === 'annual' && now < c.periodEnd)) return { eligible: false, reason: 'NOT_MONTHLY' }; // on annual, or already paid to move to it
  const started = charges.filter((c) => c.periodStart <= now); // a period not yet begun is not a month paid
  if (!started.some((c) => now < c.periodEnd)) return { eligible: false, reason: 'NOT_CURRENT' }; // the flow is for a subscription running now
  const [last, before] = started.filter((c) => c.cycle === 'monthly');
  if (!before) return { eligible: false, reason: 'NOT_TWO_MONTHS' };
  const inFull = (c) => !c.applied && c.amount >= c.list;
  if (!inFull(last) || !inFull(before)) return { eligible: false, reason: 'DISCOUNTED_MONTH' };
  const gap = last.periodStart - before.periodEnd;
  if (gap < -IN_A_ROW.earlyMs || gap > IN_A_ROW.lateMs) return { eligible: false, reason: 'NOT_IN_A_ROW' };
  return { eligible: true, reason: null };
}

/** The two offers, priced for the family's children, when it is eligible — none otherwise. It takes one of them, or neither. → { eligible, reason, offers } */
export function retentionOffers(args = {}) {
  const decided = retentionEligibility(args);
  if (!decided.eligible) return { ...decided, offers: [] };
  const monthly = monthlyPrice(args.children);
  if (monthly === null) return { eligible: false, reason: 'CHILDREN_NOT_PRICED', offers: [] }; // five or more: priced by hand, offered by hand
  return { eligible: true, reason: null, offers: [
    { kind: 'retention_monthly', percentOff: RETENTION.monthlyPercentOff, charges: RETENTION.monthlyCharges, amount: lessPercent(monthly, RETENTION.monthlyPercentOff), list: monthly },
    { kind: 'retention_annual', percentOff: ANNUAL_PERCENT_OFF, amount: annualPrice(args.children), list: annualList(args.children) },
  ] };
}

/**
 * Take one offer: the record to store on the family, { kind, acceptedAt }, made in the transaction that read the facts it is given
 * ({ paid, retention, now, children, kind }). It works the offers out again from those facts — never from an eligibility handed to
 * it — so a family holding any offer record, or whose charges show one taken, is refused, and neither offer can join the other or be
 * taken twice. The annual offer moves the family to the annual cycle at the ordinary annual price, from its next renewal.
 */
export function acceptRetention(args = {}) {
  if (!args || typeof args !== 'object' || !OFFER_KINDS.includes(args.kind)) fail(400, 'INVALID_OFFER');
  const decided = retentionOffers(args);
  if (!decided.eligible) fail(409, decided.reason);
  return { kind: args.kind, acceptedAt: args.now };
}
