// The waiting list (the owner's request of 12 Sep 2026): the doors open on 19 September, the posts go up before then, so the
// /join page takes an address and nothing else until they do. No account, no password, no mobile, no child — a parent who
// leaves an address here has not signed up for anything and has nothing to sign out of.
//
// One row per address, keyed by a SHA-256 of it so the same address left twice is one row and not two, and so a row can be
// found and removed by address alone when someone asks. The address itself is kept in the row, because writing to these
// people on the 19th is the entire point of the list; the consent that allows that is recorded with it, and every message
// sent to the list carries the unsubscribe the mailer already puts on the weekly report. Rows expire 400 days after the
// last time the address was left, by TTL, so a list nobody ever writes to empties itself.
//
// `source` is the tag on the link a post carried (/join?from=ig), so the owner can see which post brought people in. It is
// a short slug from a fixed shape, never free text, and it says nothing about the person.
import { fail, object, sha256 } from './security.mjs';

const DAY = 86_400_000;
export const WAITLIST_TTL_MS = 400 * DAY;
// A day's allowance for addresses never seen before, counted in waitlistDays/{YYYY-MM-DD}: the route's own budgets stop one
// address or one network flooding it, and this stops the list itself being filled from many. An address already on the list
// costs nothing, so a parent who taps Join twice is never refused.
export const WAITLIST_A_DAY = 500;
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const SOURCE = /^[a-z0-9][a-z0-9-]{0,23}$/;

export class Waitlist {
  constructor({ store, release = null, now = Date.now, log = () => {} }) {
    this.store = store; this.release = release; this.now = now; this.log = log;
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
      });
      return Boolean(seen);
    });
    this.log({ event: 'waitlist_join', source: input.source, repeat });
    return { ok: true, repeat };
  }
  /** How many addresses the list holds, for the operator's dashboard. Counts rows; reads no address. */
  async size() { return (await this.store.list('waitlist')).length; }
}
