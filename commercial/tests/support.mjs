import { randomUUID } from 'node:crypto';
import { Foundation, grantEntitlement } from '../server/service.mjs';
import { FirebaseIdentity } from '../server/firebase.mjs';
import { Learning } from '../server/learning.mjs';
import { Game } from '../server/game.mjs';
import { Subscriptions } from '../server/subscription.mjs';
import { Payments, FakeGateway } from '../server/payments.mjs';
import { Support } from '../server/support.mjs';
import { Recovery } from '../server/recovery.mjs';
import { Email } from '../server/email.mjs';
import { Feedback } from '../server/feedback.mjs';
import { mac } from '../server/security.mjs';

// Firestore rejects `undefined` values and arrays nested directly inside arrays; fail the same way
// here so a document shape that the emulator would refuse cannot pass the in-memory suite.
export function assertFirestoreShape(value, path = '$', inArray = false) {
  if (value === undefined) throw Error(`Firestore shape: undefined at ${path}`);
  if (Array.isArray(value)) {
    if (inArray) throw Error(`Firestore shape: array nested in array at ${path}`);
    value.forEach((v, i) => assertFirestoreShape(v, `${path}[${i}]`, true));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertFirestoreShape(v, `${path}.${k}`, false);
  }
}
// Tests only: serializable copy-on-write transactions; rollback on throw;
// disallow reads after writes to match the real Firestore adapter contract.
const byId = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); // Firestore's default order under a limit is the document id: the fixture must not hide an ordering-dependent consumer
export class MemoryStore {
  data = new Map(); tail = Promise.resolve();
  async get(path) { return structuredClone(this.data.get(path) || null); }
  async list(collectionPath) { const prefix = `${collectionPath}/`; return [...this.data.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([, v]) => structuredClone(v)); }
  async entries(collectionPath, limit) { const prefix = `${collectionPath}/`; const all = [...this.data.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([k, v]) => [k.slice(prefix.length), structuredClone(v)]).sort(byId); return limit ? all.slice(0, limit) : all; }
  async query(collectionPath, field, value, limit) { return (await this.entries(collectionPath)).filter(([, v]) => v[field] === value).slice(0, limit); }
  async queryAfter(collectionPath, field, value, afterId, limit) { const all = (await this.entriesAfter(collectionPath, afterId, Number.MAX_SAFE_INTEGER)); return all.filter(([, v]) => v[field] === value).slice(0, limit); }
  async entriesAfter(collectionPath, afterId, limit) { const all = (await this.entries(collectionPath)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); const from = afterId ? all.findIndex(([id]) => id > afterId) : 0; return from < 0 ? [] : all.slice(from, from + limit); }
  async since(collectionPath, field, min, limit) { return (await this.entries(collectionPath)).filter(([, v]) => typeof v[field] === 'number' && v[field] >= min).sort((a, b) => b[1][field] - a[1][field]).slice(0, limit); }
  transaction(fn, { readOnly = false } = {}) {
    const run = this.tail.then(async () => {
      const working = new Map(structuredClone([...this.data])); let written = false, writes = 0;
      // Firestore commits at most 500 writes in one transaction: fail the same way here so a sweep that would be refused in production cannot pass in memory.
      const write = () => { if (readOnly) throw Error('Write in readOnly transaction'); if (++writes > 500) throw Error('Firestore allows at most 500 writes in one transaction'); written = true; };
      const result = await fn({
        get: async (p) => { if (written) throw Error('Read after write'); return structuredClone(working.get(p) || null); },
        list: async (c) => { if (written) throw Error('Read after write'); const prefix = `${c}/`; return [...working.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([, v]) => structuredClone(v)); },
        entries: async (c, limit) => { if (written) throw Error('Read after write'); const prefix = `${c}/`; const all = [...working.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([k, v]) => [k.slice(prefix.length), structuredClone(v)]).sort(byId); return limit ? all.slice(0, limit) : all; },
        query: async (c, field, value, limit) => { if (written) throw Error('Read after write'); const prefix = `${c}/`; return [...working.entries()].filter(([k, v]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && v[field] === value).sort(byId).slice(0, limit).map(([k, v]) => [k.slice(prefix.length), structuredClone(v)]); },
        queryAfter: async (c, field, value, afterId, limit) => { if (written) throw Error('Read after write'); const prefix = `${c}/`; const all = [...working.entries()].filter(([k, v]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && v[field] === value).map(([k, v]) => [k.slice(prefix.length), structuredClone(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); const from = afterId ? all.findIndex(([id]) => id > afterId) : 0; return from < 0 ? [] : all.slice(from, from + limit); },
        set: (p, v) => { write(); assertFirestoreShape(v, p); working.set(p, structuredClone(v)); },
        delete: (p) => { write(); working.delete(p); },
      });
      this.data = working; return result;
    });
    this.tail = run.catch(() => {}); return run;
  }
  put(p, v) { return this.transaction(async (t) => t.set(p, v)); }
}
export const secret = 'a1'.repeat(32), pepper = 'b2'.repeat(32), webhookSecret = 'c3'.repeat(32);
export const fakeHasher = {
  hash: async (f, c, p) => mac(pepper, `${f}:${c}:${p}`),
  verify: async (f, c, p, h) => h === mac(pepper, `${f}:${c}:${p}`),
};
export function fixture() {
  let clock = Date.parse('2026-09-06T10:00:00Z');
  const store = new MemoryStore(), users = new Map(), tokens = new Map();
  const auth = { verifyCalls: [], getUserCalls: 0, deleted: [], failDelete: null, updates: [], failUpdate: null, beforeGetUser: null, beforeUpdateUser: null,
    verifyIdToken: async (t, revoked) => { auth.verifyCalls.push(revoked); if (!tokens.has(t)) throw Error('invalid'); return structuredClone(tokens.get(t)); },
    getUser: async (uid) => { auth.getUserCalls++; if (auth.beforeGetUser) await auth.beforeGetUser(uid); if (!users.has(uid)) { const e = Error('There is no user record corresponding to the provided identifier.'); e.code = 'auth/user-not-found'; throw e; } return structuredClone(users.get(uid)); }, // the Admin SDK's own code
    getUserByEmail: async (email) => { if (auth.failLookup) { const e = auth.failLookup; auth.failLookup = null; throw e; } const u = [...users.values()].find((x) => x.email.toLowerCase() === email.toLowerCase()); if (!u) { const e = Error('missing'); e.code = 'auth/user-not-found'; throw e; } return structuredClone(u); },
    updateUser: async (uid, patch) => { if (auth.beforeUpdateUser) await auth.beforeUpdateUser(uid, patch); if (auth.failUpdate) { const e = auth.failUpdate; auth.failUpdate = null; throw e; } const u = users.get(uid); if (!u) throw Error('missing'); if (patch.multiFactor && patch.multiFactor.enrolledFactors === null) u.multiFactor = { enrolledFactors: [] }; auth.updates.push([uid, structuredClone(patch)]); return structuredClone(u); },
    deleteUser: async (uid) => { if (auth.failDelete) { const e = auth.failDelete; auth.failDelete = null; throw e; } if (!users.has(uid)) throw Error('missing'); users.delete(uid); auth.deleted.push(uid); },
  };
  const identity = new FirebaseIdentity(auth, { now: () => clock });
  const service = new Foundation({ store, identity, hasher: fakeHasher, secret, now: () => clock });
  const learning = new Learning({ foundation: service, store, now: () => clock });
  const game = new Game({ foundation: service, store, now: () => clock, pickIndex: () => 0 });
  const billing = new Subscriptions({ foundation: service, store, now: () => clock });
  const gateway = new FakeGateway({ secret: webhookSecret });
  const payments = new Payments({ foundation: service, store, billing, provider: 'fake', gateways: { fake: gateway }, now: () => clock });
  const support = new Support({ foundation: service, store, billing, payments, now: () => clock });
  const recovery = new Recovery({ foundation: service, store, identity, secret, now: () => clock });
  const email = new Email({ foundation: service, store, identity, secret, now: () => clock });
  const feedback = new Feedback({ foundation: service, store, now: () => clock, release: 'test-release' }); // no mailer: nothing is copied to anyone
  // what the identity provider's own password reset changes, as the server sees it
  function resetPassword(uid) { const u = users.get(uid); u.tokensValidAfterTime = new Date(clock).toUTCString(); u.passwordHash = `hash-${randomUUID()}`; }
  function enrollPhone(uid, phoneNumber) { const u = users.get(uid), id = `mfa-${uid}-${randomUUID().slice(0, 8)}`; u.multiFactor = { enrolledFactors: [{ uid: id, factorId: 'phone', phoneNumber }] }; return id; }
  function token(uid, patch = {}) {
    if (!users.has(uid)) users.set(uid, { uid, email: `${uid}@example.test`, emailVerified: true, disabled: false,
      tokensValidAfterTime: new Date(0).toUTCString(), multiFactor: { enrolledFactors: [{ uid: `mfa-${uid}`, factorId: 'phone', phoneNumber: `+65${String(Math.abs([...uid].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 1e8).padStart(8, '0')}` }] } }); // a distinct fake number per uid
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
  // a child signed in and ready to learn: parent → family with seats → child → handover → PIN
  async function childSession(uid = 'parentA', seats = 1) {
    const p = await family(uid, seats);
    const { child: kid } = await child(p.ctx);
    const selCtx = await service.authenticate(await service.lock(p.ctx));
    const childCtx = await service.authenticate(await service.selectChild(selCtx, kid.id, '763829'));
    return { p, child: kid, selCtx, childCtx };
  }
  return { service, learning, game, billing, payments, support, recovery, email, feedback, resetPassword, enrollPhone, gateway, store, identity, users, tokens, auth, token, login, family, child, childSession, now: () => clock, advance: (ms) => { clock += ms; } };
}
export const rejected = (code) => (err) => err.code === code;
// the answer the server holds, in the shape the browser would send — and a nearby wrong one
export const canonical = (q) => { const a = q.answer; if (a.type === 'frac') return { n: String(a.n), d: String(a.d) }; if (a.type === 'dec') return String(Math.round(a.v * 100) / 100); return String(a.v); };
export const wrong = (q) => { const a = q.answer; if (a.type === 'frac') return { n: String(a.n + 1), d: String(a.d) }; if (a.type === 'choice') return String((a.v + 1) % q.display.choices.length); if (a.type === 'dec') return ((Math.round(a.v * 100) + 100) / 100).toFixed(2); return String(a.v + 1); };
