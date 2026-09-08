import { fail } from './security.mjs';

// Inject the official Admin SDK objects, keeping tests independent of network access.
export class FirestoreStore {
  constructor(db) { this.db = db; }
  async get(path) { const snap = await this.db.doc(path).get(); return snap.exists ? snap.data() : null; }
  transaction(fn) {
    return this.db.runTransaction((t) => fn({
      get: async (path) => { const s = await t.get(this.db.doc(path)); return s.exists ? s.data() : null; },
      set: (path, value) => t.set(this.db.doc(path), value),
      delete: (path) => t.delete(this.db.doc(path)),
    }));
  }
}
export class FirebaseIdentity {
  constructor(auth) { this.auth = auth; }
  async verifyLogin(idToken, now) {
    let decoded, user;
    try { decoded = await this.auth.verifyIdToken(idToken, true); user = await this.auth.getUser(decoded.uid); }
    catch { fail(401, 'INVALID_LOGIN'); }
    if (typeof decoded.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(decoded.uid) || user.uid !== decoded.uid) fail(401, 'INVALID_LOGIN');
    if (!decoded.email_verified || !user.emailVerified || !user.email || decoded.email !== user.email) fail(403, 'VERIFY_EMAIL');
    if (decoded.firebase?.sign_in_provider !== 'password') fail(403, 'PASSWORD_SIGN_IN_REQUIRED');
    const mfaUid = decoded.firebase?.second_factor_identifier;
    if (decoded.firebase?.sign_in_second_factor !== 'phone' || typeof mfaUid !== 'string' ||
        !user.multiFactor?.enrolledFactors?.some((f) => f.factorId === 'phone' && f.uid === mfaUid)) fail(403, 'VERIFY_MOBILE_WITH_MFA');
    if (!Number.isSafeInteger(decoded.auth_time) || decoded.auth_time * 1000 < now - 300_000 ||
        decoded.auth_time * 1000 > now + 30_000) fail(403, 'REAUTHENTICATE');
    const who = { uid: decoded.uid, email: user.email, mfaUid, authTime: decoded.auth_time };
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
    try { user = await this.auth.getUser(session.uid); } catch { fail(401, 'SESSION_REVOKED'); }
    this.check(user, session);
  }
}
