// Leaving (the owner's request of 12 Sep 2026): one "thinking of leaving?" page, two doors — Mission Control's Plan and seats,
// and the unsubscribe link in an email. It always names what will and will not change, captures a reason, offers an alternative
// where one exists, and only then does what the parent asked.
//
// This module is the pure part: the reasons, the offer rules, the month and cohort arithmetic, and the shape of the record. No
// store, no clock, no provider — so the rules can be read and tested on their own, and the service (below, LeavingFlow) is
// nothing but authorization, the existing billing and email paths, and one record.
//
// families/{f}/leaving/{id} = { at, reason, freeText, offersShown, offerAccepted, action, plan, seats, cohort, source, … }
// The id is the flow's own operation id, so a retried tap is one record. It holds no name, no address and no child: the audit
// row beside it carries ids only. Kept 400 days by TTL, like the audit trail and the feedback notes (PRIVACY.md).
import { fail, object, text } from './security.mjs';
import { PLANS, PAUSE_MONTHS, monthsAfter } from './subscription.mjs';

export { PAUSE_MONTHS, monthsAfter }; // the pause's own facts live with the state machine; the rules and the report read them here

const DAY = 86_400_000;
/** Why a parent is leaving. One is required; the words the parent reads live in public/app.js. */
export const LEAVING_REASONS = Object.freeze(['too_expensive', 'not_using', 'lost_interest', 'too_many_emails', 'technical', 'taking_a_break', 'something_else']);
/** What the page can do at the end of the flow. `keep` changes nothing at all. */
export const LEAVING_ACTIONS = Object.freeze(['keep', 'reduce_email', 'pause', 'downgrade', 'cancel']);
/** The alternatives an offer can be. `feedback` opens the feedback panel with the reason filled in and cancels nothing. */
export const OFFER_KINDS = Object.freeze(['email_monthly', 'email_off', 'pause', 'downgrade', 'seats', 'feedback']);
export const OFFER_WINDOW_MS = 90 * DAY;   // never more than one set of offers per family in 90 days
export const OFFERS_MAX = 2;               // at most two, so the page is a choice and not a maze
export const FREE_TEXT_MAX = 500;
export const LEAVING_TTL_MS = 400 * DAY;
export const EMAIL_CADENCES = Object.freeze(['weekly', 'monthly', 'off']);

// ---- months
const two = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM' of an instant in UTC. The report's month and a family's cohort are both this. */
export const monthKey = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}`; };
/** The first instant of a month and the first instant of the next, from 'YYYY-MM'; null for anything else. */
export function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(typeof month === 'string' ? month : '');
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 2000 || Number(m[1]) > 2999) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1;
  return { start: Date.UTC(y, mo, 1), end: Date.UTC(y, mo + 1, 1) };
}
/** The `n` months before `month`, newest first: the trend's own months. */
export function monthsBefore(month, n) {
  const r = monthRange(month); if (!r) return [];
  const out = []; for (let i = 1; i <= n; i++) { const d = new Date(r.start); out.push(monthKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))); }
  return out;
}
/** The family's creation month, for the cohort split in the monthly report; null when the family has no creation time. */
export const cohortOf = (family) => (Number.isSafeInteger(family?.createdAt) ? monthKey(family.createdAt) : null);

// ---- the offer rules
const purchasable = () => Object.values(PLANS).filter((p) => p.purchasable).sort((a, b) => a.seats - b.seats);
/** The next smaller purchasable plan below `plan`, or null when it is already the smallest (or not a paid plan). */
export function smallerPlan(plan) {
  const all = purchasable(), here = all.findIndex((p) => p.id === plan);
  return here > 0 ? all[here - 1].id : null;
}
/** The smallest purchasable plan that still seats `children`, when it is smaller than `plan`: fewer seats at the next renewal. */
export function fewestSeatsPlan(plan, children) {
  const all = purchasable(), current = PLANS[plan];
  if (!current) return null;
  const fits = all.find((p) => p.seats >= children && p.seats < current.seats);
  return fits ? fits.id : null;
}
/**
 * The offers for a reason, from the subscription as it stands. Pure: no clock beyond the `now` it is given, no store.
 *
 *   too many emails      the report monthly instead of weekly, or off, keeping the subscription
 *   taking a break /     pause for 1, 2 or 3 months (only a paid, active subscription with no cancellation pending: a pause
 *   not using it         must never grant access nobody paid for, and never quietly undo a cancellation the parent asked for)
 *   too expensive        the smaller plan, or fewer seats at the next renewal (whichever of the two is a different plan)
 *   technical problems   the feedback panel with the reason filled in, and nothing cancelled yet (`hold`)
 *   anything else        no offer: the page goes straight to what the parent asked for
 *
 * At most two, and none at all when this family was shown offers inside the last 90 days (`capped`), so a family cannot be
 * talked round twice a quarter. → { offers, capped, hold }
 */
export function offersFor({ reason, state = 'none', plan = null, cancelAtPeriodEnd = false, paused = false, cadence = 'weekly', seatedChildren = 0, lastOffersAt = null, now = 0 }) {
  if (!LEAVING_REASONS.includes(reason)) return { offers: [], capped: false, hold: false };
  const capped = Number.isSafeInteger(lastOffersAt) && lastOffersAt > now - OFFER_WINDOW_MS;
  const paid = plan !== null && plan !== 'trial' && !!PLANS[plan]?.purchasable;
  const offers = [];
  if (reason === 'too_many_emails') {
    if (cadence === 'weekly') offers.push({ kind: 'email_monthly' }); // monthly comes before off: the least the parent asked for
    if (cadence !== 'off') offers.push({ kind: 'email_off' });
  } else if (reason === 'taking_a_break' || reason === 'not_using') {
    if (paid && state === 'active' && !cancelAtPeriodEnd && !paused) offers.push({ kind: 'pause', months: [...PAUSE_MONTHS] });
  } else if (reason === 'too_expensive') {
    if (paid && ['active', 'grace'].includes(state)) {
      const down = smallerPlan(plan), fewer = fewestSeatsPlan(plan, seatedChildren);
      if (down) offers.push({ kind: 'downgrade', plan: down, seats: PLANS[down].seats });
      if (fewer && fewer !== down) offers.push({ kind: 'seats', plan: fewer, seats: PLANS[fewer].seats });
    }
  } else if (reason === 'technical') {
    offers.push({ kind: 'feedback' });
  }
  const hold = reason === 'technical' && !capped; // cancel nothing yet: the feedback panel first
  return { offers: capped ? [] : offers.slice(0, OFFERS_MAX), capped, hold: hold && offers.length > 0 };
}
/** Whether an offer the browser says was accepted is one of the offers this server decided to show. */
export const offerAllowed = (offers, accepted) => accepted === null || offers.some((o) => o.kind === accepted);

// ---- the record
/** The parent's words and choices, read strictly. `source` says which door: the app, or a link in an email. */
export function readLeavingInput(body) {
  object(body, ['reason', 'freeText', 'action', 'offerAccepted', 'cadence', 'months', 'plan', 'source', 'operationId']);
  if (!LEAVING_REASONS.includes(body.reason)) fail(400, 'LEAVING_REASON_REQUIRED');
  if (!LEAVING_ACTIONS.includes(body.action)) fail(400, 'LEAVING_ACTION_REQUIRED');
  const freeText = body.freeText === undefined || body.freeText === null || body.freeText === '' ? null : text(body.freeText, 1, FREE_TEXT_MAX).trim() || null;
  const offerAccepted = body.offerAccepted === undefined || body.offerAccepted === null ? null : body.offerAccepted;
  if (offerAccepted !== null && !OFFER_KINDS.includes(offerAccepted)) fail(400, 'INVALID_REQUEST');
  const source = body.source === undefined || body.source === null ? 'app' : body.source;
  if (source !== 'app' && source !== 'email') fail(400, 'INVALID_REQUEST');
  if (body.action === 'reduce_email' && !['monthly', 'off'].includes(body.cadence)) fail(400, 'INVALID_REQUEST');
  if (body.action === 'pause' && !PAUSE_MONTHS.includes(body.months)) fail(400, 'INVALID_MONTHS');
  if (body.action === 'downgrade' && (typeof body.plan !== 'string' || !PLANS[body.plan]?.purchasable)) fail(400, 'INVALID_PLAN');
  return { reason: body.reason, freeText, action: body.action, offerAccepted, source,
    cadence: body.action === 'reduce_email' ? body.cadence : null, months: body.action === 'pause' ? body.months : null, plan: body.action === 'downgrade' ? body.plan : null };
}
/**
 * The record as it is written: what was asked, what was offered, what was accepted, what happened, and the family's plan, seats
 * and cohort at the moment it happened — enough for the monthly report to add it up without reading anything else, and nothing
 * that names a person. `outcome` is what the billing or email path answered ('done' | 'noop'), never the provider's reply.
 */
export function leavingRecord({ id, at, input, offersShown, plan, seats, state, cohort, outcome = 'done' }) {
  return { id, at, reason: input.reason, freeText: input.freeText ?? null, offersShown: offersShown.map((o) => o.kind), offerAccepted: input.offerAccepted ?? null,
    action: input.action, cadence: input.cadence ?? null, months: input.months ?? null, toPlan: input.plan ?? null,
    plan: plan ?? null, seats: Number.isSafeInteger(seats) ? seats : null, state: state ?? null, cohort: cohort ?? null, source: input.source, outcome, expireAt: at + LEAVING_TTL_MS };
}
/** The newest moment this family was shown offers, from its own records; null when it never was. */
export const lastOffersAt = (records) => records.reduce((max, r) => ((r.offersShown || []).length && Number.isSafeInteger(r.at) && r.at > max ? r.at : max), 0) || null;

// ---- the monthly report's arithmetic (server/leaving-report.mjs renders it; scripts/report.mjs runs it)
const COUNTED = Object.freeze({ cancel: 'cancellations', pause: 'pauses', downgrade: 'downgrades', reduce_email: 'emailOptOuts' });
const zero = () => ({ cancellations: 0, pauses: 0, downgrades: 0, emailOptOuts: 0, kept: 0, total: 0 });
/** The volumes of one month's records: what each parent's action did, and how many flows there were at all. */
export function volumeOf(records) {
  const v = zero();
  for (const r of records) { v.total++; const key = COUNTED[r.action]; if (key) v[key]++; else if (r.action === 'keep') v.kept++; }
  return v;
}
const rank = (counts) => Object.entries(counts).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
/**
 * One month, added up: volume, each volume as a share of the active families at the month's start, the reasons ranked, offers
 * shown against offers accepted per offer kind, the plan and seat mix, the cohort split, and the previous months' volumes for
 * the trend. Pure; `activeAtStart` and `previous` are the caller's counts. A share is null when nobody was active.
 */
export function summariseLeaving({ month, records, activeAtStart = 0, previous = [] }) {
  const volume = volumeOf(records), share = (n) => (activeAtStart > 0 ? n / activeAtStart : null);
  const reasons = {}, plans = {}, seats = {}, cohorts = {}, shown = {}, accepted = {};
  for (const r of records) {
    reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const p = r.plan || 'none'; plans[p] = (plans[p] || 0) + 1;
    const s = Number.isSafeInteger(r.seats) ? String(r.seats) : 'none'; seats[s] = (seats[s] || 0) + 1;
    const c = r.cohort || 'unknown'; cohorts[c] = (cohorts[c] || 0) + 1;
    for (const k of r.offersShown || []) shown[k] = (shown[k] || 0) + 1;
    if (r.offerAccepted) accepted[r.offerAccepted] = (accepted[r.offerAccepted] || 0) + 1;
  }
  const offers = [...new Set([...Object.keys(shown), ...Object.keys(accepted)])].sort()
    .map((kind) => ({ kind, shown: shown[kind] || 0, accepted: accepted[kind] || 0, rate: shown[kind] ? (accepted[kind] || 0) / shown[kind] : null }));
  return { month, activeAtStart, volume,
    rate: { cancellations: share(volume.cancellations), pauses: share(volume.pauses), downgrades: share(volume.downgrades), emailOptOuts: share(volume.emailOptOuts) },
    reasons: rank(reasons), offers, plans: rank(plans), seats: rank(seats), cohorts: rank(cohorts),
    trend: previous.map((p) => ({ month: p.month, activeAtStart: p.activeAtStart ?? null, volume: { ...zero(), ...p.volume } })),
    anything: volume.total > 0 };
}
