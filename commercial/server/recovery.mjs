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
//   3. nobody cancelled it — the parent by signing in, or an operator (protective only).
// Support cannot shorten the wait, cannot remove a factor and cannot complete a recovery; the
// operator's only verb is cancel. Afterwards the parent signs in with the password alone, which
// this server refuses (VERIFY_MOBILE_WITH_MFA) until a new mobile is enrolled through the normal
// ceremony; the family, the children and the subscription are untouched — recovery never changes
// which family a parent belongs to.
import { fail, object, text, mac, sha256 } from './security.mjs';

const DAY = 86_400_000;
export const RECOVERY_WAIT_MS = 7 * DAY;       // the waiting period: the owner's chance to notice and cancel
export const RECOVERY_WINDOW_MS = 30 * DAY;    // after readyAt, how long the parent has to complete before the request lapses
export const RECOVERY_NOTICE_MS = 30 * DAY;    // how long a finished request stays visible to the signed-in parent
export const RECOVERY_STATES = Object.freeze(['pending', 'completed', 'cancelled_by_sign_in', 'cancelled_by_operator', 'expired']);
export const RECOVERY_REASONS = Object.freeze(['NOT_PENDING', 'PROOF_REQUIRED', 'WAITING']);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** What a signed-in parent sees (me()): the pending request, or a finished one for a while. */
export function recoveryView(rec, now) {
  if (!rec) return null;
  if (rec.status !== 'pending' && now - (rec.completedAt || rec.cancelledAt || rec.requestedAt) > RECOVERY_NOTICE_MS) return null;
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
   * exists, has a second factor, or already has a request: accepted, and when it can complete.
   */
  async start(body) {
    const email = this.email(body), now = this.now(), readyAt = now + this.waitMs;
    await this.foundation.rate(`recovery:${sha256(email)}`, 3, DAY);
    const user = await this.identity.lookupByEmail(email);
    if (!user || !user.emailVerified || !(user.multiFactor?.enrolledFactors || []).some((f) => f.factorId === 'phone')) return { accepted: true, readyAt };
    const path = `recoveries/${user.uid}`, factor = user.multiFactor.enrolledFactors.find((f) => f.factorId === 'phone');
    return this.store.transaction(async (tx) => {
      const current = await tx.get(path);
      if (current && current.status === 'pending' && now <= current.readyAt + RECOVERY_WINDOW_MS) return { accepted: true, readyAt: current.readyAt }; // the same request; the clock does not restart
      const parent = await tx.get(`parents/${user.uid}`);
      tx.set(path, { uid: user.uid, status: 'pending', requestedAt: now, readyAt, snapshot: this.fingerprint(user), mfaUid: factor.uid, proof: null, completedAt: null, cancelledAt: null, cancelledBy: null, note: null, acknowledgedAt: null, expireAt: readyAt + RECOVERY_WINDOW_MS + RECOVERY_NOTICE_MS });
      this.foundation.audit(tx, 'parent.recovery_requested', user.uid, parent?.familyId || null);
      return { accepted: true, readyAt };
    });
  }
  /**
   * The parent returns. Nothing happens unless the proof exists and the wait has passed; then the
   * factor is removed at the provider, every session of the account ends, and old tokens die.
   */
  async complete(body) {
    const email = this.email(body), now = this.now();
    await this.foundation.rate(`recovery-complete:${sha256(email)}`, 20, DAY);
    const user = await this.identity.lookupByEmail(email), path = user ? `recoveries/${user.uid}` : null;
    const rec = path ? await this.store.get(path) : null;
    if (!user || !rec || rec.status !== 'pending') return { completed: false, reason: 'NOT_PENDING' };
    if (now > rec.readyAt + RECOVERY_WINDOW_MS) {
      await this.store.transaction(async (tx) => { const c = await tx.get(path); if (c?.status === 'pending') tx.set(path, { ...c, status: 'expired', cancelledAt: now, cancelledBy: 'time' }); });
      return { completed: false, reason: 'NOT_PENDING' };
    }
    const fresh = await this.identity.lookup(user.uid, true), proof = this.proven(rec.snapshot, this.fingerprint(fresh));
    if (!proof) return { completed: false, reason: 'PROOF_REQUIRED', readyAt: rec.readyAt };
    if (now < rec.readyAt) return { completed: false, reason: 'WAITING', readyAt: rec.readyAt };
    try { await this.identity.unenrollFactors(user.uid); } catch { fail(502, 'IDENTITY_UNAVAILABLE'); } // the record stays pending: the parent retries
    await this.store.transaction(async (tx) => {
      const current = await tx.get(path), parent = await tx.get(`parents/${user.uid}`);
      const sessions = await tx.query('sessions', 'uid', user.uid, 200);
      for (const [id] of sessions) tx.delete(`sessions/${id}`);
      if (parent) tx.set(`parents/${user.uid}`, { ...parent, reauthAfter: Math.max(parent.reauthAfter || 0, Math.floor(now / 1000)) }); // seconds, like login()
      tx.set(path, { ...(current || rec), status: 'completed', completedAt: now, proof }); // the factor is gone whatever raced: the record says so
      this.foundation.audit(tx, 'parent.recovery_completed', user.uid, parent?.familyId || null);
    });
    return { completed: true };
  }
  /** The signed-in parent has seen the notice about a finished request. */
  async acknowledge(ctx) {
    return this.store.transaction(async (tx) => {
      const { s } = await this.foundation.authorize(tx, ctx, ['parent'], false);
      const rec = await tx.get(`recoveries/${s.uid}`);
      if (rec && rec.status !== 'pending' && !rec.acknowledgedAt) tx.set(`recoveries/${s.uid}`, { ...rec, acknowledgedAt: this.now() });
      return { ok: true };
    });
  }
}
