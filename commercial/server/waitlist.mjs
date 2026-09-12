// The waiting list (the owner's request of 12 Sep 2026): the doors open on 19 September, the posts go up before then, so the
// /join page takes an address and nothing else until they do. No account, no password, no mobile, no child — a parent who
// leaves an address here has not signed up for anything and has nothing to sign out of.
//
// One row per address, keyed by a SHA-256 of it so the same address left twice is one row and not two, and so a row can be
// found and removed by address alone when someone asks. The address itself is kept in the row, because writing to these
// people on the 19th is the entire point of the list; the consent that allows that is recorded with it. Rows expire 400 days
// after the last time the address was left, by TTL, so a list nobody ever writes to empties itself.
//
// A new address gets one email back at once (the owner's request of 12 Sep 2026: a list you join in silence feels broken).
// It is sent from no-reply, because nothing useful happens if someone answers a machine, but Reply is pointed at the support
// address all the same so a person who does answer reaches a person. It carries the unsubscribe every message to this list
// carries: a link signed for that one address, working as a click and as the one-click POST a mailbox provider makes on the
// reader's behalf (RFC 8058). Sending is best effort with a short deadline — an address is on the list whether or not the
// provider was reachable, and a parent is never shown a failure for a message they did not ask for.
//
// `source` is the tag on the link a post carried (/join?from=ig), so the owner can see which post brought people in. It is
// a short slug from a fixed shape, never free text, and it says nothing about the person.
import { equal, fail, mac, object, sha256 } from './security.mjs';

const DAY = 86_400_000;
export const WAITLIST_TTL_MS = 400 * DAY, WAITLIST_MAIL_TIMEOUT_MS = 3000;
// A day's allowance for addresses never seen before, counted in waitlistDays/{YYYY-MM-DD}: the route's own budgets stop one
// address or one network flooding it, and this stops the list itself being filled from many. An address already on the list
// costs nothing, so a parent who taps Join twice is never refused.
export const WAITLIST_A_DAY = 500;
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const SOURCE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export class Waitlist {
  constructor({ store, secret = null, origin = '', mailer = null, replyTo = null, opensOn = '19 September 2026',
    release = null, now = Date.now, log = () => {}, mailTimeoutMs = WAITLIST_MAIL_TIMEOUT_MS } = {}) {
    this.store = store; this.secret = secret; this.origin = origin; this.mailer = mailer; this.replyTo = replyTo;
    this.opensOn = opensOn; this.release = release; this.now = now; this.log = log; this.mailTimeoutMs = mailTimeoutMs;
  }
  /** The body, checked before any budget is spent: { email, consent, source }. Consent must be given here; it is not assumed. */
  parse(body) {
    object(body, ['email', 'consent', 'source']);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!ADDRESS.test(email)) fail(400, 'INVALID_EMAIL');
    if (body.consent !== true) fail(400, 'CONSENT_REQUIRED');
    const source = typeof body.source === 'string' && SOURCE.test(body.source) ? body.source : null;
    return { email, source };
  }
  /** The link that takes one address off the list: its row id and a signature over it, good until the secret is rotated. */
  leaveToken(id) { return this.secret ? `${id}.${mac(this.secret, `waitlist:${id}`)}` : null; }
  leaveUrl(id) { const t = this.leaveToken(id); return t ? `${this.origin}/api/waitlist/leave?t=${encodeURIComponent(t)}` : null; }
  /** The row a token names, or null: the signature is checked in constant time and an unsigned service removes nothing. */
  idFromToken(token) {
    if (!this.secret || typeof token !== 'string') return null;
    const cut = token.lastIndexOf('.');
    if (cut <= 0) return null;
    const id = token.slice(0, cut);
    return /^[0-9a-f]{64}$/.test(id) && equal(token.slice(cut + 1), mac(this.secret, `waitlist:${id}`)) ? id : null;
  }
  /** Put an address on the list. Idempotent: the same address again renews its expiry and keeps the tag it first arrived with. */
  async join(input) {
    const now = this.now(), id = sha256(input.email.toLowerCase()), day = new Date(now).toISOString().slice(0, 10);
    const repeat = await this.store.transaction(async (tx) => {
      const seen = await tx.get(`waitlist/${id}`), counted = await tx.get(`waitlistDays/${day}`);
      const n = counted?.count || 0;
      if (!seen && n >= WAITLIST_A_DAY) fail(429, 'WAITLIST_BUSY');
      if (!seen) tx.set(`waitlistDays/${day}`, { day, count: n + 1, expireAt: Date.parse(day) + 40 * DAY });
      tx.set(`waitlist/${id}`, {
        email: input.email, source: seen?.source ?? input.source, consentAt: seen?.consentAt ?? now,
        joinedAt: seen?.joinedAt ?? now, lastAt: now, release: this.release, expireAt: now + WAITLIST_TTL_MS,
        // carried, not dropped: a row is replaced whole here, and losing this would send the note again on every Join
        ...(seen?.mailedAt ? { mailedAt: seen.mailedAt } : {}),
      });
      return Boolean(seen);
    });
    // A new address is written to at once. An address already listed is written to again only if it has never actually had
    // the note — the list existed before the note did — or if a day has passed, which keeps a second Join from being a way to
    // mail-bomb somebody else's address while still letting a parent who lost it ask again tomorrow.
    const already = await this.store.get(`waitlist/${id}`);
    const mailedAt = already?.mailedAt ?? null;
    const due = !repeat || !mailedAt || now - mailedAt >= DAY;
    const mailed = due ? (await this.confirm(id, input.email)).sent : false;
    if (mailed) await this.store.transaction(async (tx) => {
      const row = await tx.get(`waitlist/${id}`); if (row) tx.set(`waitlist/${id}`, { ...row, mailedAt: now });
    });
    this.log({ event: 'waitlist_join', source: input.source, repeat, mailed });
    // The page says which of the two happened, and when the note went, so a parent who joins twice is told rather than left
    // guessing (the owner's report of 13 Sep 2026). A waiting list is not an account: that someone is on it discloses only
    // that they asked about a maths app, and saying nothing costs more confusion than that is worth (PRIVACY.md).
    return { ok: true, repeat, mailed, mailedAt: mailed ? now : mailedAt };
  }
  /** The one email back. Never throws: the address is listed whether or not the provider answered. */
  async confirm(id, email) {
    if (!this.mailer) return { sent: false, reason: 'no_mailer' };
    const leave = this.leaveUrl(id);
    if (!leave) return { sent: false, reason: 'unsigned' }; // no unsubscribe can be made, so nothing is sent
    const line = `We will write to you on ${this.opensOn}, the morning AutoMathtics opens. Nothing else happens until then.`;
    const text = [`Thank you — you are on the list.`, '', line, '',
      'AutoMathtics is maths practice children ask to do: papers of 25 questions through six sectors, coins they earn by passing,',
      'and rewards their parent sets and approves.', '',
      `If you did not ask for this, or change your mind, take yourself off the list here: ${leave}`].join('\n');
    const html = [`<p>Thank you — you are on the list.</p>`, `<p>${esc(line)}</p>`,
      '<p>AutoMathtics is maths practice children ask to do: papers of 25 questions through six sectors, coins they earn by passing, and rewards their parent sets and approves.</p>',
      `<p><a href="${esc(leave)}">Take yourself off the list</a> if you did not ask for this, or change your mind.</p>`].join('');
    try {
      await this.mailer.send({
        to: email, subject: 'You are on the AutoMathtics list', html, text, tags: ['waitlist'],
        ...(this.replyTo ? { replyTo: this.replyTo } : {}),
        headers: { 'List-Unsubscribe': `<${leave}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        idempotencyKey: `waitlist-confirm:${id}`, timeoutMs: this.mailTimeoutMs,
      });
      return { sent: true };
    } catch (error) { // a provider that is slow or down does not make the address any less listed
      this.log({ event: 'waitlist_confirm_failed', reason: String(error?.code || error?.message || error).slice(0, 120) });
      return { sent: false, reason: 'send_failed' };
    }
  }
  /** Take one address off, named by a signed token. Saying "gone" for a row that was never there tells a guesser nothing. */
  async leave(token) {
    const id = this.idFromToken(token);
    if (!id) fail(400, 'INVALID_TOKEN');
    await this.store.transaction(async (tx) => { if (await tx.get(`waitlist/${id}`)) tx.delete(`waitlist/${id}`); });
    this.log({ event: 'waitlist_leave' });
    return { ok: true };
  }
  /** How many addresses the list holds, for the operator's dashboard. Counts rows; reads no address. */
  async size() { return (await this.store.list('waitlist')).length; }
}
