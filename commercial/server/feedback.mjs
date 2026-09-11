// Feedback (the owner's request of 12 Sep 2026): a parent, or anyone at the sign-in screen, tells the owner something in a few
// lines. The browser sends the words, the screen it was on, an operation id of its own making and, signed out, an address to be
// answered at if the sender wants one; who sent it is the server's to say (a parent's session, checked as every session route
// checks it, or nobody), never the body's. Each note is kept 400 days by TTL under its operation id, so a retried send is one
// note, audited by that id alone, part of the family's export, and gone with the family or the sign-in account that sent it
// (support.mjs). With the resend mailer and FEEDBACK_TO set the owner gets a copy, answerable by Reply, while the day's caps allow:
// best effort, a short wait, never a failed request. A child never sends one: the app hides the button on a device in kid mode,
// and http.mjs refuses a child's or the launch pad's session.
import { fail, object, uuid } from './security.mjs';

const DAY = 86_400_000;
export const FEEDBACK_TTL_MS = 400 * DAY, FEEDBACK_MAIL_TIMEOUT_MS = 3000, FEEDBACK_MAX = 2000;
// A UTC day's allowance, counted in feedbackDays/{YYYY-MM-DD} inside each note's own transaction (review of 12 Sep 2026): notes kept
// from signed-out senders, every sender together (then FEEDBACK_BUSY for them, never for a parent), and copies to the owner, the
// signed-out ones apart, since they go out under the Resend key the weekly report needs (100 emails a day on the free plan). A
// note past a copy cap is still kept, and the operator's CLI reads it. Forged addresses and fresh cookies move none of these counts.
export const FEEDBACK_DAY = Object.freeze({ signedOut: 100, copies: 20, copiesSignedOut: 5 });
const SCREEN = /^[a-z0-9][a-z0-9-]{0,39}$/, ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export class Feedback {
  constructor({ foundation = null, store, mailer = null, to = null, release = null, now = Date.now, log = () => {}, mailTimeoutMs = FEEDBACK_MAIL_TIMEOUT_MS }) {
    this.foundation = foundation; this.store = store; this.mailer = mailer; this.to = to; this.release = release; this.now = now; this.log = log; this.mailTimeoutMs = mailTimeoutMs;
  }
  /** The body, checked before any budget is spent: { id, text, page, contact }. The words as typed, ends trimmed; a contact is one address or nothing; the id is the page's operation id. */
  parse(body) {
    object(body, ['text', 'page', 'contact', 'operationId']);
    const words = typeof body.text === 'string' ? body.text.trim() : '';
    if (!words || words.length > FEEDBACK_MAX) fail(400, 'FEEDBACK_TEXT');
    if (typeof body.page !== 'string' || !SCREEN.test(body.page)) fail(400, 'INVALID_REQUEST');
    let contact = null;
    if (body.contact !== undefined && body.contact !== '') {
      contact = typeof body.contact === 'string' ? body.contact.trim() : '';
      if (contact.length > 254 || !ADDRESS.test(contact)) fail(400, 'FEEDBACK_CONTACT');
    }
    return { id: uuid(body.operationId), text: words, page: body.page, contact };
  }
  /** Whether a note is kept under this id already: its retry is answered as the first send was, before any check or budget. */
  async kept(id) { return (await this.store.get(`feedback/${id}`)) !== null; }
  /**
   * Keep the note, audit it by id and, while the day allows, copy it to the owner. One transaction: a retry (the id kept by now)
   * changes nothing; a parent's session (`ctx`, authenticated by http.mjs) is authorized as on every session route, so a revoked
   * or superseded one writes nothing and never a stale family; every budget ([bucket, maximum, windowMs]) is read, and refused if
   * spent, before any is spent, so a refused note spends none; a signed-out note past the day's cap is refused (FEEDBACK_BUSY)
   * while a parent's is kept; a copy slot is taken only while one is left. → { ok, replay }
   */
  async record(input, { ctx = null, budgets = [] } = {}) {
    const at = this.now(), day = new Date(at).toISOString().slice(0, 10), mailing = !!this.mailer && this.mailer.provider === 'resend' && !!this.to;
    const out = await this.store.transaction(async (tx) => {
      if (await tx.get(`feedback/${input.id}`)) return { replay: true };
      const s = ctx ? (await this.foundation.authorize(tx, ctx, ['parent'], false)).s : null;
      const spend = []; for (const [bucket, maximum, windowMs] of budgets) spend.push(await this.foundation.rateIn(tx, bucket, maximum, windowMs));
      const n = { stored: 0, storedSignedOut: 0, copies: 0, copiesSignedOut: 0, ...(await tx.get(`feedbackDays/${day}`)) };
      if (!s && n.storedSignedOut >= FEEDBACK_DAY.signedOut) fail(429, 'FEEDBACK_BUSY');
      const copy = mailing && n.copies < FEEDBACK_DAY.copies && (!!s || n.copiesSignedOut < FEEDBACK_DAY.copiesSignedOut);
      for (const write of spend) write();
      tx.set(`feedbackDays/${day}`, { day, stored: n.stored + 1, storedSignedOut: n.storedSignedOut + (s ? 0 : 1), copies: n.copies + (copy ? 1 : 0), copiesSignedOut: n.copiesSignedOut + (copy && !s ? 1 : 0), expireAt: Date.parse(day) + 8 * DAY });
      const who = s ? { uid: s.uid, ...(s.familyId ? { familyId: s.familyId } : {}) } : input.contact ? { contact: input.contact } : {};
      const doc = { text: input.text, page: input.page, at, ...who, release: this.release, expireAt: at + FEEDBACK_TTL_MS };
      tx.set(`feedback/${input.id}`, doc); this.foundation.audit(tx, 'feedback.sent', s?.uid ?? null, s?.familyId ?? null, null, { feedbackId: input.id });
      return { doc, copy, capped: mailing && !copy, replyTo: s ? s.email : input.contact };
    });
    if (out.replay) return { ok: true, replay: true };
    if (out.copy) await this.forward(input.id, out.doc, out.replyTo);
    else if (out.capped) this.log({ event: 'feedback_copy_skipped', reason: 'daily_cap' }); // kept all the same: the CLI reads it
    return { ok: true, replay: false };
  }
  /** The owner's copy, under the note's own id as its Idempotency-Key. A failure is a log line with its code (never the words); the note is kept either way. */
  async forward(id, doc, replyTo) {
    const who = doc.uid ? 'from a signed-in parent: Reply goes to the account address' : doc.contact ? 'sent signed out: Reply goes to the address given' : 'sent signed out, with no address to answer';
    const text = [`Feedback ${id}`, `Screen: ${doc.page} · release ${doc.release} · ${who}`, '', doc.text].join('\n');
    try {
      await this.mailer.send({ to: this.to, subject: `AutoMathtics feedback · ${doc.page}`, text, html: `<pre style="white-space:pre-wrap;font:14px/1.5 monospace;">${esc(text)}</pre>`,
        ...(typeof replyTo === 'string' && ADDRESS.test(replyTo) ? { replyTo } : {}), idempotencyKey: `feedback:${id}`, timeoutMs: this.mailTimeoutMs });
    } catch (error) { this.log({ event: 'feedback_mail_failed', code: typeof error?.code === 'string' ? error.code : 'ERROR' }); }
  }
  /** The operator's read (scripts/report.mjs feedback): the notes of the last `days` days, newest first. */
  async recent(days = 7, limit = 500) {
    return (await this.store.since('feedback', 'at', this.now() - days * DAY, limit))
      .map(([id, d]) => ({ id, at: new Date(d.at).toISOString(), page: d.page, release: d.release ?? null, uid: d.uid ?? null, familyId: d.familyId ?? null, contact: d.contact ?? null, text: d.text }));
  }
}
