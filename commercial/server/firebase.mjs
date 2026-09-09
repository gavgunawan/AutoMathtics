import { fail } from './security.mjs';

// Inject the official Admin SDK objects, keeping tests independent of network access.
export class FirestoreStore {
  // `timestamp` turns a millisecond number into a Firestore Timestamp (Timestamp.fromMillis).
  // The service keeps every time as a number; only the `expireAt` field is stored as a real
  // Timestamp so Firestore TTL policies can delete the record (DEPLOY_V3.md §4b).
  constructor(db, { timestamp = null } = {}) { this.db = db; this.timestamp = timestamp; }
  encode(value) { return this.timestamp && value && typeof value.expireAt === 'number' ? { ...value, expireAt: this.timestamp(value.expireAt) } : value; }
  decode(data) { return data && data.expireAt && typeof data.expireAt.toMillis === 'function' ? { ...data, expireAt: data.expireAt.toMillis() } : data; }
  async get(path) { const snap = await this.db.doc(path).get(); return snap.exists ? this.decode(snap.data()) : null; }
  // Every document directly under a collection path (reconciliation reads a child's whole ledger).
  async list(collectionPath) { const snap = await this.db.collection(collectionPath).get(); return snap.docs.map((d) => this.decode(d.data())); }
  async entries(collectionPath, limit) { const q = limit ? this.db.collection(collectionPath).limit(limit) : this.db.collection(collectionPath); const snap = await q.get(); return snap.docs.map((d) => [d.id, this.decode(d.data())]); }
  async query(collectionPath, field, value, limit) { const snap = await this.db.collection(collectionPath).where(field, '==', value).limit(limit).get(); return snap.docs.map((d) => [d.id, this.decode(d.data())]); }
  /** A page of a collection in document-id order, starting after `afterId` (null: the first page) — the sweep walks collections of any size with this. */
  async entriesAfter(collectionPath, afterId, limit) { let q = this.db.collection(collectionPath).orderBy('__name__'); if (afterId) q = q.startAfter(afterId); const snap = await q.limit(limit).get(); return snap.docs.map((d) => [d.id, this.decode(d.data())]); }
  // readOnly transactions take no document locks, so read-only routes never contend with writers.
  transaction(fn, { readOnly = false } = {}) {
    return this.db.runTransaction((t) => fn({
      get: async (path) => { const s = await t.get(this.db.doc(path)); return s.exists ? this.decode(s.data()) : null; },
      // A whole collection read under the transaction (Firestore locks the documents it returns).
      list: async (collectionPath) => { const s = await t.get(this.db.collection(collectionPath)); return s.docs.map((d) => this.decode(d.data())); },
      entries: async (collectionPath, limit) => { const s = await t.get(limit ? this.db.collection(collectionPath).limit(limit) : this.db.collection(collectionPath)); return s.docs.map((d) => [d.id, this.decode(d.data())]); },
      query: async (collectionPath, field, value, limit) => { const s = await t.get(this.db.collection(collectionPath).where(field, '==', value).limit(limit)); return s.docs.map((d) => [d.id, this.decode(d.data())]); },
      set: (path, value) => t.set(this.db.doc(path), this.encode(value)),
      delete: (path) => t.delete(this.db.doc(path)),
    }), readOnly ? { readOnly: true } : undefined);
  }
}
export class FirebaseIdentity {
  // Per-request rechecks reuse a user record for `cacheMs`, so one busy session cannot spend the
  // project's Auth Admin quota on everyone's behalf. Revocation, disabling and MFA changes are
  // therefore honoured within cacheMs plus one request. Login always fetches fresh.
  constructor(auth, { now = Date.now, cacheMs = 60_000, cacheMax = 5000 } = {}) {
    this.auth = auth; this.now = now; this.cacheMs = cacheMs; this.cacheMax = cacheMax;
    this.cache = new Map(); this.lookups = 0;
  }
  /** Stage 4: the parent's Auth account itself. Only support.deleteAccount calls this, after the family is gone. */
  async deleteUser(uid) { this.cache.delete(uid); await this.auth.deleteUser(uid); }
  /** Stage 4.4: recovery starts from an email, before any token exists. Unknown → null; the caller answers uniformly. */
  async lookupByEmail(email) { try { return await this.auth.getUserByEmail(email); } catch { return null; } }
  /** Stage 4.4: the one privileged identity change this server makes — Recovery.complete only, after the ceremony (RECOVERY.md). */
  async unenrollFactors(uid) { this.cache.delete(uid); await this.auth.updateUser(uid, { multiFactor: { enrolledFactors: null } }); this.cache.delete(uid); }
  async lookup(uid, fresh = false) {
    const hit = this.cache.get(uid);
    if (!fresh && hit && hit.until > this.now()) return hit.user;
    this.cache.delete(uid);
    const user = await this.auth.getUser(uid); this.lookups++;
    if (this.cache.size >= this.cacheMax) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(uid, { user, until: this.now() + this.cacheMs });
    return user;
  }
  async verifyLogin(idToken, now, beforeLookup = null) {
    // Signature/expiry verification is local once Google's public keys are cached. Do not ask
    // Auth to perform a revocation lookup here and then immediately perform accounts:lookup too.
    // The fresh user record below is the single authoritative backend read; check() enforces
    // tokensValidAfterTime, disabled state, email verification and current MFA enrollment.
    let decoded;
    try { decoded = await this.auth.verifyIdToken(idToken, false); }
    catch { fail(401, 'INVALID_LOGIN'); }
    if (typeof decoded.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(decoded.uid)) fail(401, 'INVALID_LOGIN');
    // The UID is now cryptographically authenticated, so an account-scoped throttle can run
    // before the network lookup. A caller cannot spend another account's bucket with a forged UID.
    if (beforeLookup) await beforeLookup(decoded.uid);
    let user;
    try { user = await this.lookup(decoded.uid, true); }
    catch { fail(401, 'INVALID_LOGIN'); }
    if (user.uid !== decoded.uid) fail(401, 'INVALID_LOGIN');
    if (!decoded.email_verified || !user.emailVerified || !user.email || decoded.email !== user.email) fail(403, 'VERIFY_EMAIL');
    if (decoded.firebase?.sign_in_provider !== 'password') fail(403, 'PASSWORD_SIGN_IN_REQUIRED');
    const mfaUid = decoded.firebase?.second_factor_identifier;
    if (decoded.firebase?.sign_in_second_factor !== 'phone' || typeof mfaUid !== 'string' ||
        !user.multiFactor?.enrolledFactors?.some((f) => f.factorId === 'phone' && f.uid === mfaUid)) fail(403, 'VERIFY_MOBILE_WITH_MFA');
    if (!Number.isSafeInteger(decoded.auth_time) || decoded.auth_time * 1000 < now - 300_000 ||
        decoded.auth_time * 1000 > now + 30_000) fail(403, 'REAUTHENTICATE');
    // The verified phone behind the MFA factor is the one identity a parent cannot mint for free;
    // the service keys families to an HMAC of it (never the number itself).
    const factor = user.multiFactor.enrolledFactors.find((f) => f.factorId === 'phone' && f.uid === mfaUid);
    const who = { uid: decoded.uid, email: user.email, mfaUid, authTime: decoded.auth_time, phone: typeof factor.phoneNumber === 'string' ? factor.phoneNumber : null };
    this.check(user, who);
    return who;
  }
  check(user, s) {
    if (user.disabled || !user.emailVerified || user.email !== s.email ||
        !user.multiFactor?.enrolledFactors?.some((f) => f.factorId === 'phone' && f.uid === s.mfaUid) ||
        s.authTime * 1000 < (Date.parse(user.tokensValidAfterTime) || 0)) fail(401, 'SESSION_REVOKED');
  }
  async recheck(session) {
    let user;
    try { user = await this.lookup(session.uid); } catch { fail(401, 'SESSION_REVOKED'); }
    this.check(user, session);
  }
}
