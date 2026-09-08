import { randomUUID } from 'node:crypto';
import { Foundation, grantEntitlement } from '../server/service.mjs';
import { FirebaseIdentity } from '../server/firebase.mjs';
import { mac } from '../server/security.mjs';

// Tests only: serializable copy-on-write transactions; rollback on throw;
// disallow reads after writes to match the real Firestore adapter contract.
export class MemoryStore {
  data = new Map(); tail = Promise.resolve();
  async get(path) { return structuredClone(this.data.get(path) || null); }
  transaction(fn) {
    const run = this.tail.then(async () => {
      const working = new Map(structuredClone([...this.data])); let written = false;
      const result = await fn({
        get: async (p) => { if (written) throw Error('Read after write'); return structuredClone(working.get(p) || null); },
        set: (p, v) => { written = true; working.set(p, structuredClone(v)); },
        delete: (p) => { written = true; working.delete(p); },
      });
      this.data = working; return result;
    });
    this.tail = run.catch(() => {}); return run;
  }
  put(p, v) { return this.transaction(async (t) => t.set(p, v)); }
}
export const secret = 'a1'.repeat(32), pepper = 'b2'.repeat(32);
export const fakeHasher = {
  hash: async (f, c, p) => mac(pepper, `${f}:${c}:${p}`),
  verify: async (f, c, p, h) => h === mac(pepper, `${f}:${c}:${p}`),
};
export function fixture() {
  let clock = Date.parse('2026-09-06T10:00:00Z');
  const store = new MemoryStore(), users = new Map(), tokens = new Map();
  const auth = {
    verifyIdToken: async (t, revoked) => { if (!revoked || !tokens.has(t)) throw Error('invalid'); return structuredClone(tokens.get(t)); },
    getUser: async (uid) => { if (!users.has(uid)) throw Error('missing'); return structuredClone(users.get(uid)); },
  };
  const identity = new FirebaseIdentity(auth);
  const service = new Foundation({ store, identity, hasher: fakeHasher, secret, now: () => clock });
  function token(uid, patch = {}) {
    if (!users.has(uid)) users.set(uid, { uid, email: `${uid}@example.test`, emailVerified: true, disabled: false,
      tokensValidAfterTime: new Date(0).toUTCString(), multiFactor: { enrolledFactors: [{ uid: `mfa-${uid}`, factorId: 'phone' }] } });
    const value = `test-id-token-${randomUUID()}`;
    tokens.set(value, { uid, email: users.get(uid).email, email_verified: true, auth_time: Math.floor(clock / 1000),
      firebase: { sign_in_provider: 'password', sign_in_second_factor: 'phone', second_factor_identifier: `mfa-${uid}` }, ...patch });
    return value;
  }
  async function login(uid, patch) { const idToken = token(uid, patch); const cookie = await service.login(idToken); return { cookie, idToken, ctx: await service.authenticate(cookie) }; }
  async function family(uid = 'parentA', seats = 1) {
    const session = await login(uid);
    const created = await service.createFamily(session.ctx, { label: 'Test family', adultAttestation: true, consentVersion: 'pilot-v1' });
    if (created.token) {
      session.cookie = created.token;
      session.ctx = await service.authenticate(created.token);
    }
    const id = created.id;
    if (seats) await grantEntitlement(store, { familyId: id, seatLimit: seats, accessUntil: clock + 15 * 60_000, reason: 'synthetic pilot', actor: 'test-operator' }, clock);
    return { ...session, familyId: id };
  }
  const child = (ctx, nickname = 'Fox', requestId = randomUUID()) => service.createChild(ctx, { nickname, icon: 'fox', pin: '763829' }, requestId);
  return { service, store, identity, users, tokens, auth, token, login, family, child, now: () => clock, advance: (ms) => { clock += ms; } };
}
export const rejected = (code) => (err) => err.code === code;
