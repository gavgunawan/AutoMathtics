// The weekly progress report (email-v1, the owner's request of 11 Sep 2026): per child, the week's questions by style (right and
// fast, right but slow, wrong again and again), the totals, the System Scan's status, and a goldilocks pace, the question time
// at which a child is pushed but still has room to think. Pure functions over the progress document come first.
//
// The report reads history only: a session document expires after a day (learning.mjs), the progress document keeps the newest
// 60 rows, and each finished row carries its answers (qlog). A row counts for a week when its `date`, written in the family's
// time zone when the session ended, falls on the week's Monday to Sunday.
import { randomUUID } from 'node:crypto';
import { fail, uuid } from './security.mjs';
import { LEVELS, PAPERS_PER_SESSION, dayISO, weekISO, weekStart, trk, scanUnlocked, normalizeProgress } from './progress.mjs';
import { answersOf, styleStats, classes, quantile, timedOut, weakStyles } from './styles.mjs';
import { effectiveEntitlement } from './subscription.mjs';
import { AUDIT_RETENTION_MS } from './service.mjs';
import { prefsOf, prefsPath, signEmailToken, linkExpiry } from './email.mjs';
import { renderReport, buttonsFor } from './report-email.mjs';

const DAY = 86_400_000;
export const HISTORY_KEPT = 60; // learning.mjs HISTORY_MAX: a busier week is reported from the rows still kept, and says so
export const PACE_RULES = Object.freeze({
  minAnswers: 20,              // fewer answers in the week: no suggestion
  quantile: 0.8, target: 0.8,  // 8 in 10 right answers should fit in 80 % of the allowance: the pace that does it is p × q / 0.8
  accuracy: 0.8, timeouts: 0.1, // never faster under 80 % right, or with more than one answer in ten timed out…
  slower: 1.15,                // …and with that many timeouts, at least 15 % slower
  round: 5, min: 30, max: 200, step: 25, // rounded to 5, between 30 and 200, at most 25 points from the pace now in one week
  zone: 10,                    // within 10 points of the pace now: in the zone, no change
});

// ---- styles in words
// An Engine style is its sector's operation; the two fraction sectors change operation with the tier (questions/engine.mjs).
const ENGINE_OPS = ['Addition', 'Subtraction', 'Multiplication', 'Division'];
const FRACTIONS_I = [null, 'Simplifying fractions', 'Adding fractions', 'Subtracting fractions', 'Adding and subtracting fractions', 'Adding and subtracting fractions'];
const FRACTIONS_II = [null, 'Adding fractions (different denominators)', 'Subtracting fractions (different denominators)', 'Multiplying fractions', 'Dividing fractions', 'Mixed fraction questions'];
// Navigator is word problems and its template is not stored, so a Navigator style is a sector and a tier, named by the
// sector's topics in a few words (questions/navigator.mjs NAV_TOPICS has them in full).
export const NAV_TOPIC = Object.freeze(['numbers, early multiplication, time and measures', 'tables 6 to 9, fractions and perimeter', 'big numbers, decimals, area and angles',
  'percentages, ratio, rate and averages', 'speed, simple algebra and percentage change', 'problem-solving heuristics']);
export function styleLabel({ track, level, tier }) {
  const diff = `difficulty ${tier} of 5`;
  if (track === 'nav') return `Word problems · Sector ${LEVELS[level]?.id || '?'} (${NAV_TOPIC[level] || 'mixed topics'}) · ${diff}`;
  return `${(level === 4 ? FRACTIONS_I[tier] : level === 5 ? FRACTIONS_II[tier] : ENGINE_OPS[level]) || LEVELS[level]?.name || 'Engine'} · ${diff}`;
}

// ---- weeks
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export { weekStart }; // the Monday of an ISO week lives beside weekISO (progress.mjs), where the button links read it too
/** The week's seven dates, Monday first, as history rows spell them. */
export function weekDays(week) { const s = weekStart(week); if (s === null) throw Error('WEEK_INVALID'); return Array.from({ length: 7 }, (_, i) => new Date(s + i * DAY).toISOString().slice(0, 10)); }
/** The last complete ISO week in a time zone: the week before the one its today is in. */
export const lastWeek = (now, timeZone) => weekISO(Date.parse(dayISO(now, timeZone)) - 7 * DAY, 'UTC');
/** "7–13 Sep 2026", "31 Aug – 6 Sep 2026", "29 Dec 2025 – 4 Jan 2026". */
export function weekLabel(week) {
  const d = weekDays(week), [a, b] = [d[0], d[6]].map((x) => x.split('-').map(Number)), mon = (x) => MONTHS[x[1] - 1];
  if (a[0] !== b[0]) return `${a[2]} ${mon(a)} ${a[0]} – ${b[2]} ${mon(b)} ${b[0]}`;
  return a[1] !== b[1] ? `${a[2]} ${mon(a)} – ${b[2]} ${mon(b)} ${b[0]}` : `${a[2]}–${b[2]} ${mon(b)} ${b[0]}`;
}

// ---- the goldilocks pace
// Floating-point noise must not move a half across the line (100 × 0.62 / 0.8 is 77.49999… or 77.50000…): a half rounds up.
const snap = (x) => Math.round(x * 1e6) / 1e6, round5 = (x) => Math.round(snap(x) / PACE_RULES.round) * PACE_RULES.round, ceil5 = (x) => Math.ceil(snap(x) / PACE_RULES.round) * PACE_RULES.round;
/**
 * The pace that fits the week's answers. p is the pace now (the percentage of the base time each question allows; a parent may
 * set 10–200), q the 80th percentile of the share of its allowance a right answer used. Never faster under 80 % right or above
 * 10 % timeouts; with that many timeouts at least 15 % slower, rounded up so it stays at least that. Rounded to 5, kept within 25
 * points of p and within 30–200, but a bound never pushes against the evidence: a pace under 30 with fast right answers stays
 * where it is rather than being raised to 30. `limit` names the bound that held the pace, for the sentence. Within 10 points of p
 * it is in the zone, unless the child is timing out, which is never the zone.
 */
export function goldilocks(items, pacePercent) {
  const R = PACE_RULES, p = Number.isInteger(pacePercent) ? pacePercent : 100, n = items.length;
  if (n < R.minAnswers) return { current: p, suggested: p, direction: 'keep', enough: false, held: false, limit: null, evidence: { q: null, accuracy: null, timeoutRate: null, n } };
  const right = items.filter((x) => x.ok), q = quantile(right.map((x) => x.s / x.a), R.quantile), accuracy = right.length / n, timeoutRate = items.filter(timedOut).length / n;
  const timingOut = timeoutRate > R.timeouts, guarded = accuracy < R.accuracy || timingOut;
  let s = round5(Math.max(q === null ? p : (p * q) / R.target, guarded ? p : 0));
  if (timingOut) s = Math.max(s, ceil5(p * R.slower));
  const lo = Math.min(R.min, p), hi = Math.max(R.max, p), beyond = s < lo ? 'floor' : s > hi ? 'ceiling' : null; // the bounds, widened to take in p
  s = Math.min(p + R.step, Math.max(p - R.step, Math.min(hi, Math.max(lo, s))));
  if (Math.abs(s - p) < R.zone && !timingOut) s = p;
  return { current: p, suggested: s, direction: s < p ? 'faster' : s > p ? 'slower' : 'keep', enough: true, held: guarded && s === p, limit: s === p ? beyond : null, evidence: { q, accuracy, timeoutRate, n } };
}
const pct = (x) => `${Math.round(x * 100)}%`;
/** The pace in one plain sentence, the child named, no pronoun guessed. */
export function paceSentence(name, g) {
  if (!g.enough) return `Not enough play this week to suggest a pace (${g.evidence.n} answer${g.evidence.n === 1 ? '' : 's'}; ${PACE_RULES.minAnswers} needed).`;
  const { q, accuracy: acc, timeoutRate: tr } = g.evidence, p = g.current, s = g.suggested, timingOut = tr > PACE_RULES.timeouts;
  const within = q === null ? '' : q < 0.5 ? 'under half the time allowed' : `up to ${pct(q)} of the time allowed`;
  if (g.direction === 'faster') return `${name} uses ${within} on 8 in 10 correct answers, at ${pct(acc)} accuracy: the goldilocks pace is ${s}% (now ${p}%) — more push, still room to think.`;
  if (g.direction === 'slower') return timingOut ? `${name} ran out of time on ${pct(tr)} of questions, at ${pct(acc)} accuracy: the goldilocks pace is ${s}% (now ${p}%) — more time to think it through.`
    : `${name} needs ${within} on 8 in 10 correct answers, at ${pct(acc)} accuracy: the goldilocks pace is ${s}% (now ${p}%) — more room to think.`;
  if (timingOut) return `${name} ran out of time on ${pct(tr)} of questions; the pace is already ${p}%, at the most time a question can have.`;
  if (acc < PACE_RULES.accuracy) return `${name} got ${pct(acc)} right this week: the pace stays at ${p}%, and gets faster only once accuracy is back to 80%.`;
  if (g.limit === 'floor') return `${name} uses ${within} on 8 in 10 correct answers, at ${pct(acc)} accuracy: the pace stays at ${p}%, as the goldilocks pace never goes under ${PACE_RULES.min}%.`;
  if (g.limit === 'ceiling') return `${name} needs ${within} on 8 in 10 correct answers, at ${pct(acc)} accuracy: the pace stays at ${p}%, as the goldilocks pace never goes over ${PACE_RULES.max}%.`;
  return `${name} uses ${within} on 8 in 10 correct answers, at ${pct(acc)} accuracy: the pace of ${p}% is already in the goldilocks zone.`;
}

// ---- a child's week, a family's week
/** What the report reads from a (normalised) progress document. */
export const inputsOf = (prog) => ({ history: prog.history, pacePercent: prog.pacePercent, scanFocus: prog.scanFocus === true, lastScanWeek: prog.wallet?.lastScanWeek ?? null,
  levels: { engine: trk(prog, 'engine'), nav: trk(prog, 'nav') } });
/**
 * One child's week. `history` is the progress document's, newest first; `levels` are the tracks as they stand now, which is
 * what the System Scan's unlock rule reads. A quit row has no answers and counts apart.
 */
export function buildChildReport({ history, pacePercent, scanFocus, lastScanWeek, levels, week, nickname = 'Your child' }) {
  const days = weekDays(week), inWeek = (r) => typeof r?.date === 'string' && r.date >= days[0] && r.date <= days[6], kept = Array.isArray(history) ? history : [];
  const rows = kept.filter(inWeek), played = rows.filter((r) => !r.quit), items = answersOf(played), lists = classes(styleStats(items)), correct = items.filter((x) => x.ok).length;
  const passed = (mode) => played.filter((r) => r.passed === true && (!mode || r.mode === mode)).length;
  const totals = { questions: items.length, correct, accuracy: items.length ? correct / items.length : null, minutes: Math.round(played.reduce((a, r) => a + (Number.isFinite(r.secs) ? r.secs : 0), 0) / 60),
    sessions: played.length, left: rows.length - played.length, passes: passed(), papersPassed: PAPERS_PER_SESSION * passed('paper'), checkpoints: passed('boss') };
  const scan = { status: lastScanWeek === week || passed('scan') ? 'passed' : scanUnlocked(levels?.engine || { level: 0, paper: 1 }) ? 'available' : 'locked', focus: scanFocus === true, tried: played.some((r) => r.mode === 'scan') };
  const pace = goldilocks(items, pacePercent), named = (st) => ({ ...st, label: styleLabel(st) });
  // The scan focus is offered on the very list a focused scan would use (learning.mjs → styles.mjs weakStyles): all kept history,
  // Engine only, none above the sector now, as it stands when the report is made. The week's three lists are another cut.
  const focusStyles = weakStyles(kept, levels?.engine?.level ?? 0).map((w) => named({ ...w, track: 'engine' }));
  return { nickname, week, answered: items.length > 0, totals, trouble: lists.trouble.map(named), slow: lists.slow.map(named), strong: lists.strong.map(named),
    focusStyles, scan, pace: { ...pace, sentence: paceSentence(nickname, pace) },
    partial: kept.length >= HISTORY_KEPT && inWeek(kept[kept.length - 1]) };
}
/** The family's week: every child given (the seated ones), in order; a child without an answer that week gets one line. */
export function buildFamilyReport({ familyLabel = null, children, week }) {
  const kids = children.map((c) => ({ childId: c.id, ...buildChildReport({ ...inputsOf(c.progress), week, nickname: c.nickname }) }));
  const sum = (k) => kids.reduce((a, c) => a + c.totals[k], 0), questions = sum('questions'), correct = sum('correct');
  return { week, weekLabel: weekLabel(week), familyLabel, children: kids, totals: { sessions: sum('sessions'), questions, correct, accuracy: questions ? correct / questions : null }, answered: questions > 0 };
}

// ---- the job: one email per family per week (scripts/report.mjs; Cloud Shell block G runs it every Monday at 07:00 Singapore)
// reports/{familyId}:{week} is the claim and its outcome, and nothing else: sending → sent | sent_unconfirmed | skipped | failed,
// with the attempts, the provider's id or the reason. No report content is kept here; the fake provider's outbox holds a
// rendered copy for 14 days.
// One week for the whole run: the last complete ISO week at the job's clock in Singapore, whatever each family's zone, so a run
// near a daylight-saving change or midnight can never give two families two weeks (DEPLOY_V3.md → 5b). Each family's answers
// still count by their own local dates; the edge is a family west of Singapore, still in its Sunday when the job runs at Monday
// 07:00 Singapore time: its answers later that Sunday are dated in the reported week, come after its email, and no report counts them.
export const REPORT_TIME_ZONE = 'Asia/Singapore', REPORT_CLAIM_MS = 15 * 60_000, REPORT_TTL_MS = 400 * DAY;
const FINAL = new Set(['sent', 'sent_unconfirmed', 'skipped']);
const codeOf = (error) => (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(error.code) ? error.code : 'ERROR'); // a code for the record, never a message
const notFound = (error) => error?.code === 'auth/user-not-found' || error?.errorInfo?.code === 'auth/user-not-found';
/** A run to show red (the CLI's exit 2): a family failed, or another run still held one (busy), so a rerun has work left either way. */
export const runFailed = (r) => r.failed > 0 || r.busy > 0;
export class Reports {
  constructor({ store, identity, mailer, secret, origin, operator = 'report-job', now = Date.now, batch = 50, log = () => {} }) {
    this.store = store; this.identity = identity; this.mailer = mailer; this.secret = secret; this.origin = origin; this.operator = operator; this.now = now; this.batch = batch; this.log = log;
  }
  /** Every family in pages (or the one named); one outcome each, one audit row for the run. A family failed or busy makes the CLI exit 2 (runFailed). */
  async run({ week = null, familyId = null, dryRun = false } = {}) {
    if (week !== null && weekStart(week) === null) fail(400, 'WEEK_INVALID');
    if (week !== null && linkExpiry('unsub', week) <= this.now()) fail(400, 'WEEK_TOO_OLD'); // its stop-the-report link would be dead: never mailed
    const runWeek = week || lastWeek(this.now(), REPORT_TIME_ZONE), results = [];
    // one family's failure is that family's: recorded as well as it can be (one()), and the run goes on to the next
    const visit = async (id, family) => {
      let r; try { r = await this.one(id, family, { week: runWeek, dryRun }); } catch (error) { r = { week: runWeek, status: 'failed', reason: codeOf(error) }; }
      results.push({ familyId: id, ...r });
      this.log({ event: 'weekly_report', familyId: id, week: r.week, status: r.status, reason: r.reason || null, dryRun }); // never an address, never a token
    };
    if (familyId !== null) { uuid(familyId); const family = await this.store.get(`families/${familyId}`); if (!family) fail(404, 'FAMILY_NOT_FOUND'); await visit(familyId, family); }
    else for (let after = null; ;) { const page = await this.store.entriesAfter('families', after, this.batch); for (const [id, f] of page) await visit(id, f); if (page.length < this.batch) break; after = page.at(-1)[0]; }
    const n = (status) => results.filter((r) => r.status === status).length;
    const summary = { sent: n('sent'), unconfirmed: n('sent_unconfirmed'), skipped: n('skipped'), failed: n('failed'), already: n('already'), busy: n('busy'), wouldSend: n('would_send') };
    if (!dryRun) { try { await this.store.transaction(async (tx) => tx.set(`audit/${randomUUID()}`, { action: 'report.run', uid: this.operator, familyId: null, childId: null, week: runWeek, ...summary, at: this.now(), expireAt: this.now() + AUDIT_RETENTION_MS })); } catch { this.log({ event: 'weekly_report_audit_failed', week: runWeek }); } }
    return { week: runWeek, results, ...summary };
  }
  async one(familyId, family, { week, dryRun = false }) {
    if (family.deleted === true || family.deletion?.status === 'executing') return { week, status: 'skipped', reason: 'family_deleted' }; // a tombstone is no family: no record
    const key = `reports/${familyId}:${week}`, claim = dryRun ? null : await this.claim(key, familyId, week); // a claim that cannot be written fails the family, not the run (run())
    if (claim && !claim.mine) return { week, status: claim.status, reason: claim.reason };
    const end = async (status, extra = {}) => { if (claim) await this.settle(key, claim.claimId, { status, ...extra }); return { week, status, ...extra }; };
    try {
      const ready = await this.prepare(familyId, family, week);
      if (ready.skip) return await end('skipped', { reason: ready.skip });
      const to = await this.address(ready.uid); // an outage throws IDENTITY_UNAVAILABLE: failed below, and the next run tries again
      if (!to) return await end('skipped', { reason: 'no_verified_address' });
      if (dryRun) return { week, status: 'would_send', reason: null };
      const links = this.links(ready.uid, familyId, ready.report), mail = renderReport(ready.report, links);
      const sent = await this.mailer.send({ to, ...mail, familyId, idempotencyKey: `report:${familyId}:${week}`, tags: [{ name: 'kind', value: 'weekly_report' }, { name: 'week', value: week }],
        headers: { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }); // RFC 8058 one-click
      // Resend refused the key as reused with another body: an email under it reached Resend already (a key still in flight is
      // PROVIDER_IN_FLIGHT, thrown by the mailer: failed below, and the next run retries it)
      return await (sent.unconfirmed ? end('sent_unconfirmed', { reason: sent.unconfirmed }) : end('sent', { providerId: sent.id }));
    } catch (error) {
      // Whatever broke (the store, the provider, a bug in rendering), the family is recorded as failed if the store lets us; if not,
      // its claim stays `sending` and is taken over after 15 minutes. A retry renders the same bytes (links()), so an email that did
      // reach Resend before the failure is answered from Resend's memory of its key, not sent twice.
      const reason = codeOf(error);
      if (claim) await this.settle(key, claim.claimId, { status: 'failed', reason }).catch(() => {});
      return { week, status: 'failed', reason };
    }
  }
  /** The claim: one report per family and week however many runs overlap. Sent, sent-unconfirmed or skipped is final; a failure,
   * or a claim left sending for 15 minutes, is taken over (the provider's Idempotency-Key makes a retry after a lost answer the same email). */
  async claim(key, familyId, week) {
    const claimId = randomUUID(), now = this.now();
    return this.store.transaction(async (tx) => {
      const old = await tx.get(key);
      if (old && FINAL.has(old.status)) return { mine: false, status: 'already', reason: old.status };
      if (old && old.status === 'sending' && old.claimedAt > now - REPORT_CLAIM_MS) return { mine: false, status: 'busy', reason: 'claimed_by_another_run' };
      tx.set(key, { familyId, week, status: 'sending', claimId, claimedAt: now, attempts: (old?.attempts || 0) + 1, providerId: null, reason: null, createdAt: old?.createdAt || now, updatedAt: now, expireAt: now + REPORT_TTL_MS });
      return { mine: true, claimId };
    });
  }
  /** The outcome lands on the claim that made it: a run whose claim was taken over leaves the newer one alone. */
  async settle(key, claimId, patch) {
    await this.store.transaction(async (tx) => { const cur = await tx.get(key); if (cur && cur.claimId === claimId) tx.set(key, { ...cur, ...patch, updatedAt: this.now() }); });
  }
  /** Who the report is for and what it says, or why there is none (the order of the checks is the order of the reasons). */
  async prepare(familyId, family, week) {
    const now = this.now(), e = effectiveEntitlement(family, now);
    if (!e || e.status !== 'active' || !(e.accessUntil > now)) return { skip: 'no_entitlement' };
    const children = await this.children(familyId, family); if (!children.length) return { skip: 'no_children' };
    const uid = await this.owner(familyId); if (!uid) return { skip: 'no_owner' };
    if (!prefsOf(await this.store.get(prefsPath(uid))).progress) return { skip: 'progress_off' };
    const report = buildFamilyReport({ familyLabel: family.label || null, children, week });
    return report.answered ? { uid, report } : { skip: 'no_play' };
  }
  /** The family's owner, as the membership and the parent record both say (one owner per family in this release). */
  async owner(familyId) {
    for (const [uid, m] of await this.store.entries(`families/${familyId}/members`)) {
      if (m.role !== 'owner' || m.status !== 'active') continue;
      const parent = await this.store.get(`parents/${uid}`);
      if (parent && parent.familyId === familyId && !parent.identityDeletion && parent.deleted !== true) return uid;
    }
    return null;
  }
  /** Every seated, active child with its progress normalised, in the family's order. */
  async children(familyId, family) {
    const out = [];
    for (const id of family.activeChildIds || []) {
      if (!(family.childIds || []).includes(id)) continue;
      const c = await this.store.get(`families/${familyId}/children/${id}`);
      if (c && c.status === 'active') out.push({ id, nickname: c.nickname, progress: normalizeProgress(await this.store.get(`families/${familyId}/learning/${id}`)) });
    }
    return out;
  }
  /** The address the identity provider holds now, verified and not disabled: nothing goes to an unverified address. Only "no such
   * user" is an answer (null: skipped for good); any other failure of the lookup is an outage, IDENTITY_UNAVAILABLE, tried again next run. */
  async address(uid) {
    let user;
    try { user = await this.identity.lookup(uid, true); } catch (error) { if (notFound(error)) return null; fail(502, 'IDENTITY_UNAVAILABLE'); }
    return user && user.disabled !== true && user.emailVerified === true && typeof user.email === 'string' && user.email ? user.email : null;
  }
  /**
   * The buttons' links: a signed token each, opening the app with it in the fragment (/#email=…, which reaches no server and no
   * request log); the app shows what the button does and waits for a tap. The List-Unsubscribe URL alone carries its token in the
   * query, because RFC 8058's one-click POST needs a URL the mailbox provider can post to. Every
   * expiry follows from the report week (email.mjs linkExpiry) and nothing else in the email moves with the clock, so rendering a
   * family-week again gives the same bytes: what Resend's Idempotency-Key needs to answer a retry as the same email. The one
   * exception is a past week's report (send --week) sent after its buttons ran out, 14 days after the week: it draws no dead
   * button and says so instead (`expired`, report-email.mjs); a retry across that very line would render differently, and
   * Resend's 409 then records it as sent_unconfirmed. A week whose stop-the-report link has died is refused before (run()).
   */
  links(uid, familyId, report) {
    const app = `${this.origin}/`, token = (payload) => signEmailToken(this.secret, { ...payload, u: uid, f: familyId, w: report.week, e: linkExpiry(payload.a, report.week) });
    const unsub = token({ a: 'unsub', v: 'progress' }), live = linkExpiry('pace', report.week) > this.now(), children = {}; // pace and focus share their expiry
    for (const c of report.children) {
      const b = buttonsFor(c), l = {};
      if (live && b.pace !== null) l.pace = `${app}#email=${token({ a: 'pace', c: c.childId, v: b.pace })}`;
      if (live && b.focus !== null) l.focus = `${app}#email=${token({ a: 'focus', c: c.childId, v: b.focus })}`;
      children[c.childId] = l;
    }
    return { app, settings: app, unsubscribe: `${app}#email=${unsub}`, oneClick: `${this.origin}/api/email/unsubscribe?t=${unsub}`, children, ...(live ? {} : { expired: true }) };
  }
  /** The operator's look at a family's email: rendered with inert links whatever the switches say; it never claims and never sends. */
  async preview(familyId, week = null) {
    uuid(familyId); if (week !== null && weekStart(week) === null) fail(400, 'WEEK_INVALID');
    const family = await this.store.get(`families/${familyId}`); if (!family || family.deleted === true) fail(404, 'FAMILY_NOT_FOUND');
    const report = buildFamilyReport({ familyLabel: family.label || null, children: await this.children(familyId, family), week: week || lastWeek(this.now(), REPORT_TIME_ZONE) });
    const inert = `${this.origin}/#email=preview`, children = Object.fromEntries(report.children.map((c) => [c.childId, { pace: inert, focus: inert }]));
    return { week: report.week, answered: report.answered, ...renderReport(report, { app: `${this.origin}/`, settings: `${this.origin}/`, unsubscribe: inert, children }) };
  }
}
