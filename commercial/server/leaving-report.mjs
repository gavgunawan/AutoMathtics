// The monthly leaving report to the owner (the owner's request of 12 Sep 2026). Once a month, one plain email: how many families
// cancelled, paused, downgraded or turned the emails down, each as a share of the families that were active when the month began,
// the reasons ranked, the offers shown against the offers taken, the plan and seat mix, the cohort split, and the three months
// before for the trend.
//
// It reads the leaving records (server/leaving.mjs) and the families' own subscription facts, and nothing else: no name, no
// address, no child, no free text. `reports/leaving:{YYYY-MM}` is the claim and its outcome, so overlapping or repeated runs send
// one email a month; a month in which nothing happened writes a log line and sends nothing at all.
//
// Months are UTC: a leaving record's `at` is an instant, and a boundary that never moves is what makes the same month add up to
// the same figures whenever it is run.
import { randomUUID } from 'node:crypto';
import { fail } from './security.mjs';
import { effectiveEntitlement } from './subscription.mjs';
import { monthKey, monthRange, monthsBefore, summariseLeaving, volumeOf, LEAVING_REASONS } from './leaving.mjs';
import { AUDIT_RETENTION_MS } from './service.mjs';
import { REPORT_CLAIM_MS, REPORT_TTL_MS } from './report.mjs';

const TREND_MONTHS = 3;
export const LEAVING_REPORT_KEY = (month) => `reports/leaving:${month}`;
const FINAL = new Set(['sent', 'sent_unconfirmed', 'skipped']);
const codeOf = (error) => (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(error.code) ? error.code : 'ERROR');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (month) => { const m = /^(\d{4})-(\d{2})$/.exec(month); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : month; };
/** The words for each reason, in the owner's report. The keys are the record's (server/leaving.mjs LEAVING_REASONS). */
export const REASON_WORDS = Object.freeze({ too_expensive: 'It costs too much', not_using: 'We are not using it', lost_interest: 'The child lost interest',
  too_many_emails: 'Too many emails', technical: 'Technical problems', taking_a_break: 'Taking a break', something_else: 'Something else' });
export const OFFER_WORDS = Object.freeze({ email_monthly: 'report monthly instead', email_off: 'report off, subscription kept', pause: 'pause for 1–3 months',
  downgrade: 'the smaller plan', seats: 'fewer seats at renewal', feedback: 'tell us what went wrong' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

/** The report as an email: plain text first, and a small inline table in the HTML. No image, no link that does anything. */
export function renderLeavingReport(s) {
  const v = s.volume, r = s.rate, when = monthName(s.month);
  const subject = `AutoMathtics leaving report · ${when}: ${v.cancellations} cancelled, ${v.pauses} paused, ${v.downgrades} downgraded, ${v.emailOptOuts} fewer emails`;
  const VOLUME = [['Cancellations', v.cancellations, r.cancellations], ['Pauses', v.pauses, r.pauses], ['Downgrades', v.downgrades, r.downgrades], ['Email opt-outs', v.emailOptOuts, r.emailOptOuts]];
  const mix = (list) => (list.length ? list.map((x) => `${x.key} ${x.n}`).join(' · ') : 'none');
  const lines = [`AUTOMATHTICS · LEAVING REPORT · ${when.toUpperCase()}`, '',
    `Active families at the start of the month: ${s.activeAtStart}`,
    `Flows: ${v.total} in all — ${v.kept} changed nothing.`, '',
    'VOLUME (and each as a share of the active families at the month\'s start)',
    ...VOLUME.map(([label, n, share]) => `  ${pad(label, 16)}${lpad(n, 4)}   ${pct(share)}`), '',
    'REASONS', ...(s.reasons.length ? s.reasons.map((x) => `  ${pad(REASON_WORDS[x.key] || x.key, 24)}${lpad(x.n, 4)}`) : ['  none']), '',
    'OFFERS', `  ${pad('offer', 34)}${lpad('shown', 6)}${lpad('taken', 7)}${lpad('rate', 8)}`,
    ...(s.offers.length ? s.offers.map((o) => `  ${pad(OFFER_WORDS[o.kind] || o.kind, 34)}${lpad(o.shown, 6)}${lpad(o.accepted, 7)}${lpad(pct(o.rate), 8)}`) : ['  none shown']), '',
    `PLANS   ${mix(s.plans)}`, `SEATS   ${mix(s.seats)}`, `COHORT  ${mix(s.cohorts)}   (the month each family was created)`, '',
    'TREND', `  ${pad('month', 10)}${lpad('active', 8)}${lpad('cancel', 8)}${lpad('pause', 7)}${lpad('down', 6)}${lpad('email', 7)}`,
    `  ${pad(s.month, 10)}${lpad(s.activeAtStart, 8)}${lpad(v.cancellations, 8)}${lpad(v.pauses, 7)}${lpad(v.downgrades, 6)}${lpad(v.emailOptOuts, 7)}`,
    ...s.trend.map((t) => `  ${pad(t.month, 10)}${lpad(t.activeAtStart ?? '—', 8)}${lpad(t.volume.cancellations, 8)}${lpad(t.volume.pauses, 7)}${lpad(t.volume.downgrades, 6)}${lpad(t.volume.emailOptOuts, 7)}`),
    '', '—', 'Counted from the leaving records of each family (reason, offers, action, plan, seats and creation month; no names, no',
    'addresses, no free text in this email). Months are UTC. One email a month, from the AutoMathtics report job.', ''];
  const cell = (x, head = false) => `<${head ? 'th' : 'td'} style="padding:4px 10px;border:1px solid #2A3170;text-align:${head ? 'left' : 'right'};font:${head ? '700 ' : ''}14px/1.4 monospace;">${esc(x)}</${head ? 'th' : 'td'}>`;
  const table = (headers, rows) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;">`
    + `<tr>${headers.map((h) => cell(h, true)).join('')}</tr>${rows.map((row) => `<tr>${row.map((x, i) => (i === 0 ? `<td style="padding:4px 10px;border:1px solid #2A3170;font:14px/1.4 monospace;">${esc(x)}</td>` : cell(x))).join('')}</tr>`).join('')}</table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>`
    + `<body style="margin:0;padding:24px;background:#ffffff;color:#111111;font:15px/1.5 monospace;">`
    + `<h1 style="margin:0 0 4px;font:700 18px/1.3 monospace;">AutoMathtics · leaving report · ${esc(when)}</h1>`
    + `<p style="margin:0 0 16px;">Active families at the start of the month: <strong>${s.activeAtStart}</strong>. Flows: ${v.total} in all, ${v.kept} of which changed nothing.</p>`
    + table(['What happened', 'Families', 'Share'], VOLUME.map(([label, n, share]) => [label, n, pct(share)]))
    + table(['Reason', 'Families'], s.reasons.length ? s.reasons.map((x) => [REASON_WORDS[x.key] || x.key, x.n]) : [['none', 0]])
    + table(['Offer', 'Shown', 'Taken', 'Rate'], s.offers.length ? s.offers.map((o) => [OFFER_WORDS[o.kind] || o.kind, o.shown, o.accepted, pct(o.rate)]) : [['none shown', 0, 0, '—']])
    + `<p style="margin:0 0 6px;">Plans: ${esc(mix(s.plans))}</p><p style="margin:0 0 6px;">Seats: ${esc(mix(s.seats))}</p><p style="margin:0 0 16px;">Cohort (the month each family was created): ${esc(mix(s.cohorts))}</p>`
    + table(['Month', 'Active', 'Cancelled', 'Paused', 'Downgraded', 'Fewer emails'],
      [[s.month, s.activeAtStart, v.cancellations, v.pauses, v.downgrades, v.emailOptOuts],
        ...s.trend.map((t) => [t.month, t.activeAtStart ?? '—', t.volume.cancellations, t.volume.pauses, t.volume.downgrades, t.volume.emailOptOuts])])
    + `<p style="margin:0;font-size:13px;color:#555555;">Counted from each family's leaving records: reason, offers, action, plan, seats and creation month. No names, no addresses and no free text leave the database. Months are UTC.</p>`
    + '</body></html>';
  return { subject, html, text: lines.join('\n') };
}

export class LeavingReports {
  constructor({ store, mailer, to = null, operator = 'report-job', now = Date.now, batch = 50, log = () => {} }) {
    this.store = store; this.mailer = mailer; this.to = to; this.operator = operator; this.now = now; this.batch = batch; this.log = log;
  }
  /** The month before the one `now` is in, in UTC: the last complete month. */
  lastMonth() { return monthsBefore(monthKey(this.now()), 1)[0]; }
  /**
   * One month, added up and mailed to the owner. Idempotent per month; a month in which nothing happened is recorded as skipped
   * and nothing is sent. → { month, status, reason?, providerId? }
   */
  async run({ month = null, dryRun = false } = {}) {
    const target = month || this.lastMonth(), range = monthRange(target);
    if (!range) fail(400, 'MONTH_INVALID');
    if (range.end > this.now()) fail(400, 'MONTH_NOT_COMPLETE'); // never a month still running: its figures would change under the report
    const key = LEAVING_REPORT_KEY(target), claim = dryRun ? null : await this.claim(key, target);
    if (claim && !claim.mine) { this.log({ event: 'leaving_report', month: target, status: claim.status, reason: claim.reason }); return { month: target, status: claim.status, reason: claim.reason }; }
    const end = async (status, extra = {}) => {
      if (claim) await this.settle(key, claim.claimId, { status, ...extra }).catch(() => {});
      this.log({ event: 'leaving_report', month: target, status, reason: extra.reason || null, dryRun }); // never an address
      return { month: target, status, ...extra };
    };
    try {
      const gathered = await this.gather(target);
      const summary = summariseLeaving({ month: target, ...gathered });
      if (!summary.anything) return await end('skipped', { reason: 'nothing_happened', activeAtStart: summary.activeAtStart });
      if (!this.to) return await end('skipped', { reason: 'no_owner_address' }); // nowhere to send it: said in the log, not guessed at
      const mail = renderLeavingReport(summary);
      if (dryRun) return { month: target, status: 'would_send', reason: null, summary };
      const sent = await this.mailer.send({ to: this.to, ...mail, idempotencyKey: `leaving:${target}`, tags: [{ name: 'kind', value: 'leaving_report' }, { name: 'month', value: target }] });
      const outcome = sent.unconfirmed ? await end('sent_unconfirmed', { reason: sent.unconfirmed }) : await end('sent', { providerId: sent.id });
      if (!dryRun) { try { await this.store.transaction(async (tx) => tx.set(`audit/${randomUUID()}`, { action: 'report.leaving', uid: this.operator, familyId: null, childId: null, month: target, status: outcome.status, at: this.now(), expireAt: this.now() + AUDIT_RETENTION_MS })); } catch { this.log({ event: 'leaving_report_audit_failed', month: target }); } }
      return outcome;
    } catch (error) {
      const reason = codeOf(error);
      if (claim) await this.settle(key, claim.claimId, { status: 'failed', reason }).catch(() => {});
      this.log({ event: 'leaving_report', month: target, status: 'failed', reason });
      return { month: target, status: 'failed', reason };
    }
  }
  /** One report per month however many runs overlap; a failure, or a claim left sending for 15 minutes, is taken over. */
  async claim(key, month) {
    const claimId = randomUUID(), now = this.now();
    return this.store.transaction(async (tx) => {
      const old = await tx.get(key);
      if (old && FINAL.has(old.status)) return { mine: false, status: 'already', reason: old.status };
      if (old && old.status === 'sending' && old.claimedAt > now - REPORT_CLAIM_MS) return { mine: false, status: 'busy', reason: 'claimed_by_another_run' };
      tx.set(key, { month, kind: 'leaving', status: 'sending', claimId, claimedAt: now, attempts: (old?.attempts || 0) + 1, providerId: null, reason: null, createdAt: old?.createdAt || now, updatedAt: now, expireAt: now + REPORT_TTL_MS });
      return { mine: true, claimId };
    });
  }
  async settle(key, claimId, patch) {
    await this.store.transaction(async (tx) => { const cur = await tx.get(key); if (cur && cur.claimId === claimId) tx.set(key, { ...cur, ...patch, updatedAt: this.now() }); });
  }
  /**
   * Every family, in pages: its leaving records for the target month and the three before it, and whether it was active at the
   * start of each of those months. A family created after a month started was not active in it, whatever its facts say now; a
   * family deleted since was, and its tombstone still carries the facts that say so.
   */
  async gather(month) {
    const months = [month, ...monthsBefore(month, TREND_MONTHS)], ranges = months.map((m) => ({ month: m, ...monthRange(m) }));
    const buckets = new Map(months.map((m) => [m, []])), active = new Map(months.map((m) => [m, 0]));
    for (let after = null; ;) {
      const page = await this.store.entriesAfter('families', after, this.batch);
      for (const [id, family] of page) {
        for (const r of ranges) if (Number.isSafeInteger(family.createdAt) && family.createdAt <= r.start) {
          const e = effectiveEntitlement(family, r.start);
          if (e && e.status === 'active' && e.accessUntil > r.start) active.set(r.month, active.get(r.month) + 1);
        }
        for (const [, rec] of await this.store.entries(`families/${id}/leaving`, 200)) {
          const m = Number.isSafeInteger(rec.at) ? monthKey(rec.at) : null;
          if (m !== null && buckets.has(m)) buckets.get(m).push(rec);
        }
      }
      if (page.length < this.batch) break; after = page.at(-1)[0];
    }
    return { records: buckets.get(month), activeAtStart: active.get(month),
      previous: monthsBefore(month, TREND_MONTHS).map((m) => ({ month: m, activeAtStart: active.get(m), volume: volumeOf(buckets.get(m)) })) };
  }
}
export { LEAVING_REASONS, TREND_MONTHS };
