// Stage 4.4 — the lost-phone recovery ceremony (RECOVERY.md).
//
// A parent who can no longer receive the SMS second factor cannot sign in, so nothing here runs
// under a session. The ceremony has one privileged step — removing the enrolled factor at the
// identity provider — and the server takes it only when three things hold at once:
//   1. the parent proved control of the account's email since asking: the password was reset
//      through the provider's own emailed link (visible to us as the provider's token-revocation
//      time moving, or the password hash changing — we keep an HMAC of the hash, never the hash);
//   2. the waiting period has passed (RECOVERY_WAIT_MS), during which any full sign-in with the
//      old phone cancels the request (Foundation.login) and a notice is shown afterwards;
//   3. nobody cancelled it — the parent by signing in, or an operator (protective only) — and that
//      is decided by a transactional claim: pending → completing, compare-and-set, immediately
//      before the provider is touched, bound by an immutable `requestId` to the very request whose
//      proof and wait were verified: a request cancelled and replaced since is a different one.
//      A sign-in that committed its cancellation first wins and
//      the provider is never called; a claim that committed first is the point of no return.
// Every unauthenticated answer is the same whether or not an account exists, has a second factor
// or has a request under way: "accepted, come back after the wait" and "not completed (yet)".
// Support cannot shorten the wait, cannot remove a factor and cannot complete a recovery; the
// operator's only verb is cancel. Afterwards the parent signs in with the password alone, which
// this server refuses (VERIFY_MOBILE_WITH_MFA) until a new mobile is enrolled through the normal
// ceremony; the family, the children and the subscription are untouched — recovery never changes
// which family a parent belongs to.
import { randomUUID } from 'node:crypto';
import { fail, object, text, mac, sha256 } from './security.mjs';

const DAY = 86_400_000;
export const RECOVERY_WAIT_MS = 7 * DAY;       // the waiting period: the owner's chance to notice and cancel
export const RECOVERY_WINDOW_MS = 30 * DAY;    // after readyAt, how long the parent has to complete before the request lapses
export const RECOVERY_NOTICE_MS = 30 * DAY;    // how long a finished request stays visible to the signed-in parent
export const RECOVERY_STATES = Object.freeze(['pending', 'completing', 'completed', 'cancelled_by_sign_in', 'cancelled_by_operator', 'expired']);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const NOT_COMPLETED = Object.freeze({ completed: false }); // the one answer for every way of not completing
const DECOY_UID = 'recovery-decoy';                         // a uid no account has: the provider lookup made when there is nothing to check
const decoyUid = (email) => `none-${sha256(email).slice(0, 40)}`; // a record path nothing ever writes: the reads made when there is no account

/** Every session of a uid, in bounded batches (Firestore commits at most 500 writes; TTL is eventual, so old rows may be many). */
export async function sweepSessions(store, uid, batch = 200) {
  let total = 0;
  for (;;) {
    const n = await store.transaction(async (tx) => { const rows = await tx.query('sessions', 'uid', uid, batch); for (const [id] of rows) tx.delete(`sessions/${id}`); return rows.length; });
    total += n; if (n < batch) return total;
  }
}
/** What a signed-in parent sees (me()): the request under way, or a finished one for a while. */
export function recoveryView(rec, now) {
  if (!rec) return null;
  const open = rec.status === 'pending' || rec.status === 'completing';
  if (!open && now - (rec.completedAt || rec.cancelledAt || rec.requestedAt) > RECOVERY_NOTICE_MS) return null;
  return { status: rec.status, requestedAt: rec.requestedAt, readyAt: rec.readyAt, completedAt: rec.completedAt || null, cancelledAt: rec.cancelledAt || null, acknowledgedAt: rec.acknowledgedAt || null };
}

export class Recovery {
  constructor({ foundation, store, identity, secret, now = Date.now, waitMs = RECOVERY_WAIT_MS }) {
    this.foundation = foundation; this.store = store; this.identity = identity; this.secret = secret; this.now = now; this.waitMs = waitMs;
  }
  /** The provider-side facts a password reset changes, kept without the credential. */
  fingerprint(user) {
    return { validAfter: Date.parse(user.tokensValidAfterTime || '') || 0, password: typeof user.passwordHash === 'string' && user.passwordHash ? mac(this.secret, `password:${user.passwordHash}`) : null };
  }
  /** Proof of email control since the request: the provider revoked tokens after it, or the password hash moved. */
  proven(snapshot, current) {
    if (current.validAfter > (snapshot.validAfter || 0)) return 'tokens_revoked';
    if (snapshot.password && current.password && current.password !== snapshot.password) return 'password_changed';
    return null;
  }
  email(body) {
    object(body, ['email']);
    const email = text(body.email, 3, 254).trim().toLowerCase();
    if (!EMAIL.test(email)) fail(400, 'INVALID_REQUEST');
    return email;
  }
  /**
   * The parent asks, with nothing but the email. The answer is the same whether or not an account
   * exists, has a second factor, or already has a request: accepted, and the earliest moment a
   * request made now could complete. An existing request keeps its own, earlier date and is not
   * restarted; the parent learns the real date by completing, never by asking.
   */
  async start(body) {
    const email = this.email(body), now = this.now(), answer = { accepted: true, readyAt: now + this.waitMs };
    const user = await this.identity.lookupByEmail(email);
    const factor = user && user.emailVerified ? (user.multiFactor?.enrolledFactors || []).find((f) => f.factorId === 'phone') || null : null;
    // The same work for every email — one provider lookup, then one transaction that spends the per-email budget, reads a request
    // record and a parent record, and commits — so neither the answer nor the time it takes says whether an account exists
    // (Stage 4 review, third round). Without an account the reads land on a path nothing ever writes.
    const uid = factor ? user.uid : decoyUid(email), path = `recoveries/${uid}`;
    await this.store.transaction(async (tx) => {
      const spend = await this.foundation.rateIn(tx, `recovery:${sha256(email)}`, 3, DAY);
      const current = await tx.get(path), parent = await tx.get(`parents/${uid}`);
      spend();
      if (!factor) return;
      if (current && (current.status === 'completing' || (current.status === 'pending' && now <= current.readyAt + RECOVERY_WINDOW_MS))) return; // the same request; the clock does not restart
      tx.set(path, { uid: user.uid, requestId: randomUUID(), status: 'pending', requestedAt: now, readyAt: answer.readyAt, snapshot: this.fingerprint(user), mfaUid: factor.uid, proof: null, claimId: null, claimedAt: null, completedAt: null, cancelledAt: null, cancelledBy: null, note: null, acknowledgedAt: null, expireAt: answer.readyAt + RECOVERY_WINDOW_MS + RECOVERY_NOTICE_MS });
      this.foundation.audit(tx, 'parent.recovery_requested', user.uid, parent?.familyId || null);
    });
    return answer;
  }
  /**
   * The parent returns. Nothing happens unless the proof exists and the wait has passed; then the
   * request is claimed (pending → completing, in a transaction that re-reads it: a sign-in that
   * cancelled it first wins, and the provider is never asked), the factor is removed at the
   * provider, every session of the account ends, older tokens die, and the record is completed.
   * A provider fault after the claim leaves `completing`: the next attempt resumes from there.
   * Every non-completion answers the same way.
   */
  async complete(body) {
    const email = this.email(body), now = this.now();
    await this.foundation.rate(`recovery-complete:${sha256(email)}`, 20, DAY);
    const user = await this.identity.lookupByEmail(email);
    const path = `recoveries/${user ? user.uid : decoyUid(email)}`, rec = await this.store.get(path);
    const open = !!user && !!rec && typeof rec.requestId === 'string' && (rec.status === 'pending' || rec.status === 'completing');
    // The same work whether or not there is anything to complete — one record read, one fresh provider lookup (of a uid nothing
    // has, when there is no proof to check) — so the time an answer takes says nothing either (Stage 4 review, third round).
    const fresh = open && rec.status === 'pending' ? await this.identity.lookup(user.uid, true) : await this.identity.lookup(DECOY_UID, true).catch(() => null);
    if (!open) return NOT_COMPLETED;
    // Everything below is decided about *this* request. One cancelled and replaced by a newer request since it was read
    // here carries a different requestId: the newer one has its own proof to show and its own wait to sit out, and
    // nothing verified against the old one may touch it (Stage 4 review, second round).
    const same = (current) => !!current && current.requestId === rec.requestId;
    if (rec.status === 'pending') {
      if (now > rec.readyAt + RECOVERY_WINDOW_MS) {
        await this.store.transaction(async (tx) => { const c = await tx.get(path); if (same(c) && c.status === 'pending') tx.set(path, { ...c, status: 'expired', cancelledAt: now, cancelledBy: 'time' }); });
        return NOT_COMPLETED;
      }
      const proof = this.proven(rec.snapshot, this.fingerprint(fresh));
      if (!proof || now < rec.readyAt) return NOT_COMPLETED;
      // the claim: the point of no return, decided against the record as it is now, not as it was read above
      const claimId = randomUUID();
      const claimed = await this.store.transaction(async (tx) => {
        const current = await tx.get(path);
        if (!same(current)) return false;                 // gone, or replaced by a newer request whose proof and wait this attempt never checked
        if (current.status === 'completing') return true; // an earlier attempt claimed it and stopped before the provider answered: resume
        if (current.status !== 'pending') return false;   // cancelled meanwhile — by the owner's sign-in or the operator: the provider is never touched
        const parent = await tx.get(`parents/${user.uid}`);
        tx.set(path, { ...current, status: 'completing', claimId, claimedAt: now, proof });
        this.foundation.audit(tx, 'parent.recovery_claimed', user.uid, parent?.familyId || null);
        return true;
      });
      if (!claimed) return NOT_COMPLETED;
    }
    try { await this.identity.unenrollFactors(user.uid); } catch { fail(502, 'IDENTITY_UNAVAILABLE'); } // the record stays `completing`: the parent retries and resumes here
    await sweepSessions(this.store, user.uid);
    await this.store.transaction(async (tx) => {
      const current = await tx.get(path), parent = await tx.get(`parents/${user.uid}`);
      if (parent) tx.set(`parents/${user.uid}`, { ...parent, reauthAfter: Math.max(parent.reauthAfter || 0, Math.floor(now / 1000)) }); // seconds, like login()
      tx.set(path, { ...(same(current) ? current : rec), status: 'completed', completedAt: now }); // the factor is gone: the record says so whatever else moved
      this.foundation.audit(tx, 'parent.recovery_completed', user.uid, parent?.familyId || null);
    });
    return { completed: true };
  }
  /** The signed-in parent has seen the notice about a finished request. */
  async acknowledge(ctx) {
    return this.store.transaction(async (tx) => {
      const { s } = await this.foundation.authorize(tx, ctx, ['parent'], false);
      const rec = await tx.get(`recoveries/${s.uid}`);
      if (rec && rec.status !== 'pending' && rec.status !== 'completing' && !rec.acknowledgedAt) tx.set(`recoveries/${s.uid}`, { ...rec, acknowledgedAt: this.now() });
      return { ok: true };
    });
  }
}
