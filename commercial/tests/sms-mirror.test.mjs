// The device's copy of the SMS resend ladder, run for real: public/auth.js is executed with a stand-in for the
// Firebase SDK, a fake localStorage and a clock the test moves, so the countdown the owner asked for (11 Sep 2026)
// is checked on behaviour, not on source text. The provider stays the authority; this is what the Send button
// counts down from when the provider's own seconds do not reach the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto, createHash, createHmac } from 'node:crypto';
import vm from 'node:vm';
import * as ladder from '../public/sms-schedule.js';

const SECOND = 1000, MINUTE = 60 * SECOND, DAY = 24 * 60 * MINUTE;
const NUMBER = '+6281234567890';

function storage({ broken = false, seed = {} } = {}) {
  const map = new Map(Object.entries(seed));
  if (broken) {
    const boom = () => { throw new Error('storage blocked'); };
    return { map, getItem: boom, setItem: boom, removeItem: boom, key: boom, get length() { throw new Error('storage blocked'); } };
  }
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
}

async function load({ store = storage(), start = Date.parse('2026-09-11T10:00:00Z') } = {}) {
  let now = start;
  class Clock extends Date { static now() { return now; } }
  const user = { factors: [], emailVerified: true, reload: async () => {}, getIdTokenResult: async () => ({ token: 't', claims: { firebase: { sign_in_second_factor: 'phone' } } }) };
  const state = { user, mfa: false, verify: async () => 'verification-id', asked: 0, resolver: null };
  const authObj = { get currentUser() { return state.user; } };
  const sdk = {
    initializeAuth: () => authObj, inMemoryPersistence: {}, connectAuthEmulator: () => {},
    RecaptchaVerifier: class { render() { return Promise.resolve(1); } clear() {} _reset() {} },
    PhoneAuthProvider: class { async verifyPhoneNumber(options) { state.asked++; return state.verify(options); } static credential(id, code) { return { id, code }; } },
    PhoneMultiFactorGenerator: { FACTOR_ID: 'phone', assertion: (c) => c },
    multiFactor: (u) => ({ get enrolledFactors() { return u.factors; }, getSession: async () => ({}),
      enroll: async () => { u.factors = [...u.factors, { uid: 'factor-new', factorId: 'phone', phoneNumber: '+62*******7890' }]; },
      unenroll: async (f) => { u.factors = u.factors.filter((x) => x.uid !== f.uid); } }),
    getMultiFactorResolver: () => state.resolver,
    signInWithEmailAndPassword: async () => {
      if (!state.mfa) return { user: state.user };
      state.resolver = { hints: [{ factorId: 'phone', uid: 'factor-new', phoneNumber: '+62*******7890' }], session: {}, resolveSignIn: async () => ({ user: state.user }) };
      throw Object.assign(new Error('mfa'), { code: 'auth/multi-factor-auth-required' });
    },
    signOut: async () => { state.user = null; },
  };
  const source = await readFile(new URL('../public/auth.js', import.meta.url), 'utf8');
  const swaps = [
    ["import * as ladder from '/sms-schedule.js';", 'const ladder = __ladder;'],
    ["await fetch('/api/config', { cache: 'no-store' }).then((r) => r.json())", '__cfg'],
    ["await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js')", '__app'],
    ["await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js')", '__sdk'],
  ];
  let body = source;
  for (const [from, to] of swaps) { assert.ok(body.includes(from), `auth.js no longer contains: ${from}`); body = body.replace(from, to); }
  body = body.replace(/^export (async function|function|const) /gm, '$1 ');
  const context = vm.createContext({ __ladder: ladder, __cfg: { emulator: false, firebase: {} }, __app: { initializeApp: () => ({}) }, __sdk: sdk,
    localStorage: store, crypto: webcrypto, TextEncoder, location: { hostname: 'app.example', search: '' }, Date: Clock, console });
  const mod = await vm.runInContext(`(async()=>{ ${body}\nreturn { sendCode, nextSendAt, confirmCode, signIn, e164, changeMobileSend, changeMobileConfirm }; })()`, context);
  return { mod, state, store, now: () => now, advance: (ms) => { now += ms; } };
}
const refusedWith = (seconds) => (e) => e?.waitSeconds === seconds;

test('each accepted code steps this device along the ladder: three codes 30 seconds apart, then two minutes, and an early press is refused with the seconds left without asking the provider', async () => {
  const s = await load(); const t0 = s.now();
  assert.equal(await s.mod.nextSendAt(NUMBER), 0, 'nothing sent yet: nothing to wait for');
  await s.mod.sendCode('+62 812-3456-7890', true); assert.equal(s.state.asked, 1);
  assert.equal(await s.mod.nextSendAt(NUMBER), t0 + 30 * SECOND);
  s.advance(10 * SECOND); await assert.rejects(s.mod.sendCode(NUMBER, true), refusedWith(20)); assert.equal(s.state.asked, 1, 'the provider was not asked');
  s.advance(20 * SECOND); await s.mod.sendCode(NUMBER, true);
  s.advance(30 * SECOND); await s.mod.sendCode(NUMBER, true); assert.equal(s.state.asked, 3);
  assert.equal(await s.mod.nextSendAt(NUMBER), t0 + 60 * SECOND + 2 * MINUTE, 'after the third, two minutes');
  s.advance(SECOND); await assert.rejects(s.mod.sendCode(NUMBER, true), refusedWith(119));
});

test('a refusal that names its seconds is kept for that number: the count survives retyping it, and another number is not held', async () => {
  const s = await load();
  s.state.verify = async () => { throw Object.assign(new Error('Firebase: HTTP Cloud Function returned an error. Code: 429, Status: "RESOURCE_EXHAUSTED", Message: "SMS_WAIT:600" (auth/internal-error).'), { code: 'auth/internal-error' }); };
  await assert.rejects(s.mod.sendCode(NUMBER, true), refusedWith(600));
  assert.equal(await s.mod.nextSendAt('+62 812 3456 7890'), s.now() + 600 * SECOND, 'the same number, typed differently, keeps the wait');
  assert.equal(await s.mod.nextSendAt('+6591234567'), 0, 'a different number is not held');
  s.advance(599 * SECOND); await assert.rejects(s.mod.sendCode(NUMBER, true), refusedWith(1));
  s.advance(SECOND); s.state.verify = async () => 'verification-id'; await s.mod.sendCode(NUMBER, true);
});

// The owner's report of 12 Sep 2026: thirty seconds after a code, the Send button refused and then counted down from
// two minutes, for a code that was never sent. A failed send was being written into this device's run, so every retry
// climbed a rung it had not spent. It now holds the shortest rung and asks again; the function keeps the real count.
test('a failure that may be the ladder holds the shortest rung and never climbs it, however often it repeats; only codes that went out are counted; a plain provider error records nothing', async () => {
  const s = await load(); const t0 = s.now();
  await s.mod.sendCode(NUMBER, true);
  s.advance(40 * SECOND);
  s.state.verify = async () => { throw Object.assign(new Error('Firebase: Error (auth/internal-error-encountered.).'), { code: 'auth/internal-error-encountered.' }); };
  await assert.rejects(s.mod.sendCode(NUMBER, true), refusedWith(30));
  assert.equal(await s.mod.nextSendAt(NUMBER), t0 + 70 * SECOND, 'a send that failed is held off for the shortest rung');
  s.advance(30 * SECOND);
  await assert.rejects(s.mod.sendCode(NUMBER, true), refusedWith(30));
  assert.equal(await s.mod.nextSendAt(NUMBER), t0 + 100 * SECOND, 'and a second failure is another 30 seconds, not the two minutes a spent rung used to cost');
  s.advance(30 * SECOND); s.state.verify = async () => 'verification-id';
  await s.mod.sendCode(NUMBER, true);
  assert.equal(await s.mod.nextSendAt(NUMBER), t0 + 130 * SECOND, 'the run holds the two codes that went out, so this is still the second rung');
  const other = await load();
  other.state.verify = async () => { throw Object.assign(new Error('Firebase: Error (auth/invalid-phone-number).'), { code: 'auth/invalid-phone-number' }); };
  await assert.rejects(other.mod.sendCode(NUMBER, true), (e) => e.code === 'auth/invalid-phone-number');
  assert.equal(await other.mod.nextSendAt(NUMBER), 0, 'nothing recorded for a code that was never allowed');
});

test('the codes of an enrolment count on the sign-in challenge right after it', async () => {
  const s = await load(); const t0 = s.now();
  await s.mod.sendCode(NUMBER, true); s.advance(30 * SECOND); await s.mod.sendCode(NUMBER, true);
  await s.mod.confirmCode('123456');
  s.state.user = { factors: [{ uid: 'factor-new', factorId: 'phone' }], emailVerified: true, reload: async () => {} }; s.state.mfa = true;
  assert.equal((await s.mod.signIn('p@example.test', 'pw')).stage, 'challenge');
  assert.equal(await s.mod.nextSendAt(''), t0 + 60 * SECOND, 'the challenge counts the two enrolment codes');
});

test('storage that throws leaves no record and never stops a send', async () => {
  const s = await load({ store: storage({ broken: true }) });
  assert.equal(await s.mod.nextSendAt(NUMBER), 0);
  await s.mod.sendCode(NUMBER, true); await s.mod.sendCode(NUMBER, true);
  assert.equal(s.state.asked, 2, 'with no record the provider alone decides');
});

test('the stored names are keyed on this device: no key holds the number or a plain SHA-256 of it', async () => {
  const s = await load();
  await s.mod.sendCode(NUMBER, true);
  const keys = [...s.store.map.keys()];
  assert.ok(keys.length >= 2, 'a record and the device key');
  assert.ok(keys.every((k) => !k.includes('6281234567890')), 'the number is not in any key');
  const plain = 'automathtics.sms.' + createHash('sha256').update(`sms:${NUMBER}`).digest('hex');
  assert.ok(!keys.includes(plain), 'not a precomputable SHA-256 of the number');
  assert.ok(keys.includes('automathtics.sms.key'), 'the device key');
});

test('records expire: a finished run and a passed hold are swept on load, a live run and the device key stay', async () => {
  const start = Date.parse('2026-09-11T10:00:00Z');
  const seed = {
    'automathtics.sms.old': JSON.stringify([start - 2 * DAY]),
    'automathtics.sms.done.hold': String(start - SECOND),
    'automathtics.sms.live': JSON.stringify([start - MINUTE]),
    'automathtics.sms.key': 'a'.repeat(64),
    'unrelated': 'kept',
  };
  const s = await load({ store: storage({ seed }), start });
  const keys = [...s.store.map.keys()].sort();
  assert.deepEqual(keys, ['automathtics.sms.key', 'automathtics.sms.live', 'unrelated'].sort());
});

test('a wait written under a wrong clock is not trusted: nothing further off than the longest rung is counted down, and it is swept (review of PR #44)', async () => {
  const start = Date.parse('2026-09-11T10:00:00Z'), keyHex = 'a'.repeat(64);
  const hold = 'automathtics.sms.' + createHmac('sha256', Buffer.from(keyHex, 'hex')).update(`sms:${NUMBER}`).digest('hex') + '.hold';
  const s = await load({ store: storage({ seed: { 'automathtics.sms.key': keyHex, [hold]: String(start + 365 * DAY) } }), start });
  assert.ok(!s.store.map.has(hold), 'swept on load');
  s.store.map.set(hold, String(s.now() + 365 * DAY)); // and one that appears later is ignored
  assert.equal(await s.mod.nextSendAt(NUMBER), 0);
  await s.mod.sendCode(NUMBER, true); assert.equal(s.state.asked, 1, 'the provider is asked');
  assert.equal(ladder.refusalSeconds({ message: 'SMS_WAIT:99999999' }), 86_400, 'a relayed wait is capped at the longest rung');
});

test('a changed mobile number carries its codes to the new factor, so the sign-in straight after counts them', async () => {
  const s = await load(); const t0 = s.now();
  s.state.user.factors = [{ uid: 'factor-old', factorId: 'phone', phoneNumber: '+65*******4567' }];
  await s.mod.changeMobileSend(NUMBER, true);
  await s.mod.changeMobileConfirm('123456');
  assert.equal(s.state.user, null, 'signed out to sign in with the new number');
  s.state.user = { factors: [{ uid: 'factor-new', factorId: 'phone' }], emailVerified: true, reload: async () => {} }; s.state.mfa = true;
  assert.equal((await s.mod.signIn('p@example.test', 'pw')).stage, 'challenge');
  assert.equal(await s.mod.nextSendAt(''), t0 + 30 * SECOND, 'the new factor counts the code the new number already had');
});
