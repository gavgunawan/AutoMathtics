// Feedback (the owner's request of 12 Sep 2026): a parent, or anyone at the sign-in screen, tells the owner something in a few
// lines. The browser sends the words, the screen it was on and, signed out, an address to be answered at if the sender wants one;
// who sent it is the server's to say (a parent's session, or nobody), never the body's. Each note is kept 400 days by TTL, audited
// by its id alone, part of the family's export, and gone with the family or the sign-in account that sent it (support.mjs). With
// the resend mailer and FEEDBACK_TO set it is also emailed to the owner, answerable by Reply: best effort, a short wait, never a
// failed request. A child never sends one: the app shows the button nowhere in kid mode, and http.mjs refuses a child's or the
// launch pad's session.
import { randomUUID } from 'node:crypto';
import { fail, object } from './security.mjs';

const DAY = 86_400_000;
export const FEEDBACK_TTL_MS = 400 * DAY, FEEDBACK_MAIL_TIMEOUT_MS = 3000, FEEDBACK_MAX = 2000;
const SCREEN = /^[a-z0-9][a-z0-9-]{0,39}$/, ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export class Feedback {
  constructor({ foundation = null, store, mailer = null, to = null, release = null, now = Date.now, log = () => {}, mailTimeoutMs = FEEDBACK_MAIL_TIMEOUT_MS }) {
    this.foundation = foundation; this.store = store; this.mailer = mailer; this.to = to; this.release = release; this.now = now; this.log = log; this.mailTimeoutMs = mailTimeoutMs;
  }
  /** The body, checked before any budget is spent: { text, page, contact }. The words as typed, ends trimmed; a contact is one address or nothing. */
  parse(body) {
    object(body, ['text', 'page', 'contact']);
    const words = typeof body.text === 'string' ? body.text.trim() : '';
    if (!words || words.length > FEEDBACK_MAX) fail(400, 'FEEDBACK_TEXT');
    if (typeof body.page !== 'string' || !SCREEN.test(body.page)) fail(400, 'INVALID_REQUEST');
    let contact = null;
    if (body.contact !== undefined && body.contact !== '') {
      contact = typeof body.contact === 'string' ? body.contact.trim() : '';
      if (contact.length > 254 || !ADDRESS.test(contact)) fail(400, 'FEEDBACK_CONTACT');
    }
    return { text: words, page: body.page, contact };
  }
  /**
   * Keep the note, audit it by id, forward it. `from` is the parent's session ({ uid, familyId, email }), or null signed out. A
   * signed-in parent is answered at the account's own address, so a contact sent beside a session is dropped, never stored.
   */
  async record(input, from = null) {
    const id = randomUUID(), at = this.now();
    const who = from ? { uid: from.uid, ...(from.familyId ? { familyId: from.familyId } : {}) } : input.contact ? { contact: input.contact } : {};
    const doc = { text: input.text, page: input.page, at, ...who, release: this.release, expireAt: at + FEEDBACK_TTL_MS };
    await this.store.transaction(async (tx) => { tx.set(`feedback/${id}`, doc); this.foundation.audit(tx, 'feedback.sent', from?.uid ?? null, from?.familyId ?? null, null, { feedbackId: id }); });
    await this.forward(id, doc, from ? from.email : input.contact);
    return { ok: true };
  }
  /** The owner's copy: only with Resend and FEEDBACK_TO. A failure is a log line with its code (never the words); the note is kept either way. */
  async forward(id, doc, replyTo) {
    if (!this.mailer || this.mailer.provider !== 'resend' || !this.to) return;
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
