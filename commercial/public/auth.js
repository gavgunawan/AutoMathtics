// Firebase handles credentials, verification and SMS MFA. No passwords or identity
// tokens are persisted by this app. A successful exchange clears the SDK session.
import * as ladder from '/sms-schedule.js';
const cfg = await fetch('/api/config', { cache: 'no-store' }).then((r) => r.json());
if (cfg.emulator && !['127.0.0.1', 'localhost'].includes(location.hostname)) throw Error('Unsafe emulator origin');
const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js');
const sdk = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js');
const auth = sdk.initializeAuth(initializeApp(cfg.firebase), { persistence: sdk.inMemoryPersistence });
if (cfg.emulator) sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
let resolver = null, verificationId = null, verifier = null;

// The number as the provider wants it: E.164, nothing else. Both screens check the string this sends, so what
// was validated and what goes on the wire are the same characters. They were not: a number typed as
// "+62 812 3456 7890" passed a check that stripped the spaces and then reached the provider with them still in.
export const e164 = (value) => String(value || '').replace(/[\s().-]/g, '');
// One robot check per screen, built once. The SDK un-ticks the widget itself after every attempt — the last thing
// verifyPhoneNumber does is `finally { verifier?._reset(); }` — and leaves it on the page, ticked off and ready to
// be ticked again. Clearing and rebuilding it on each send is what made the box vanish after a refusal and come
// back blank, which reads as "nothing happened, press it again".
function captcha() { verifier ||= new sdk.RecaptchaVerifier(auth, 'recaptcha', { size: 'normal' }); return verifier; }
export async function armCaptcha() { try { await captcha().render(); } catch { resetCaptcha(); } } // the box is on screen before Send, not conjured up by it
export function resetCaptcha() { const stale = verifier; verifier = null; try { stale?.clear(); } catch { /* already destroyed */ } } // clear() twice throws and would strand the screen

async function stage(user) {
  await user.reload();
  if (!user.emailVerified) return { stage: 'verify' };
  if (!sdk.multiFactor(user).enrolledFactors.length) return { stage: 'enroll' };
  const token = await user.getIdTokenResult(true);
  if (token.claims.firebase?.sign_in_second_factor !== 'phone') {
    await clear(); return { stage: 'signin', notice: 'Mobile verified. Sign in again to complete the two-step check.' };
  }
  return { stage: 'ready', idToken: token.token };
}
export async function signIn(email, password) {
  try { return await stage((await sdk.signInWithEmailAndPassword(auth, email, password)).user); }
  catch (error) {
    if (error.code !== 'auth/multi-factor-auth-required') throw error;
    resolver = sdk.getMultiFactorResolver(auth, error);
    const hint = resolver.hints.find((h) => h.factorId === sdk.PhoneMultiFactorGenerator.FACTOR_ID);
    if (!hint) throw Error('A verified mobile factor is required.');
    return { stage: 'challenge', phone: hint.phoneNumber, email };
  }
}
export async function signUp(email, password) {
  const { user } = await sdk.createUserWithEmailAndPassword(auth, email, password);
  await sdk.sendEmailVerification(user);
  return { stage: 'verify' };
}
export async function checkEmail() {
  if (!auth.currentUser) return { stage: 'signin' };
  return stage(auth.currentUser);
}
export async function resendEmail() {
  if (!auth.currentUser) throw Error('Sign in again first.');
  await sdk.sendEmailVerification(auth.currentUser);
}
// ---- this device's mirror of the SMS resend ladder (public/sms-schedule.js) ----
// The function at the provider is the authority, and its refusal may never reach this page with its seconds, so
// the device remembers when it sent codes and applies the same schedule: that is what the Send button counts
// down from, and it replaces the old flat minute between codes so the first three can go 30 seconds apart.
// One record per destination, under a SHA-256 of it: the typed E.164 number when enrolling or changing the
// number, the enrolled factor's uid (or its masked hint) on a sign-in challenge. The hash only keeps the number
// out of plain text on the parent's own device; it is not a secret, and nothing here leaves the device.
// A send is recorded once the provider has accepted it — and also when it fails in a way that may be the ladder
// (sms-schedule.js possibleRefusal): the function refused without its seconds reaching this page, so the server is
// at least a rung ahead of this device, or the function allowed it and the provider failed, so the server spent a
// rung. Either way the device steps one rung too, so the Send button has a real time to count down to instead of
// a sentence; each further refusal steps it again until it has caught up. Storage can be missing or throw (a
// private window, a browser blocking site data): then there is simply no record and the function alone decides.
// The function counts every code to a number in one run, but a sign-in challenge is recorded under the factor: so
// when a number is enrolled its codes are copied to the new factor, and the challenge right after counts them.
const STORE = 'automathtics.sms.';
let enrolling = null; // the E.164 number the last accepted enrolment code went to
// Each record's key is an HMAC of its destination under a random key made on this device and kept beside the
// records, so the stored names are not a table anyone can precompute. It is not a secret against someone who can
// read this device's storage: the key sits next to them and phone numbers are few enough to try one by one. What
// it does guarantee is that nothing identifying leaves the device and that a record does not outlive its run.
const DEVICE_KEY = STORE + 'key', HOLD = '.hold';
let deviceKey = null;
async function hmacKey() {
  if (deviceKey) return deviceKey;
  let hex = null;
  try { const kept = localStorage.getItem(DEVICE_KEY); if (/^[0-9a-f]{64}$/.test(kept || '')) hex = kept; } catch { /* no storage */ }
  if (!hex) {
    hex = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(DEVICE_KEY, hex); } catch { /* no storage: this page's records die with it */ }
  }
  deviceKey = await crypto.subtle.importKey('raw', new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16))), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return deviceKey;
}
// A wait the provider named (its SMS_WAIT seconds) is kept per destination too, so retyping the same number, leaving
// the screen or coming back later keeps counting from it instead of re-enabling Send while the server still refuses.
function readHold(key) { try { const v = Number(localStorage.getItem(key + HOLD)); return Number.isSafeInteger(v) && v > Date.now() ? v : 0; } catch { return 0; } }
function writeHold(key, until) { try { localStorage.setItem(key + HOLD, String(Math.floor(until))); } catch { /* no storage */ } }
// Records expire: on every load, any record whose run is over and any hold that has passed is removed, so nothing
// here lasts more than a day after the last code to that destination.
function sweep() {
  const now = Date.now(); let keys = [];
  try { keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)); } catch { return; } // no storage
  for (const k of keys) {
    if (!k || !k.startsWith(STORE) || k === DEVICE_KEY) continue;
    let raw = null; try { raw = localStorage.getItem(k); } catch { return; }
    let live = false;
    if (k.endsWith(HOLD)) live = Number(raw) > now;
    else try { const sends = JSON.parse(raw); live = Array.isArray(sends) && ladder.currentRun(sends, now).length > 0; } catch { live = false; }
    if (!live) try { localStorage.removeItem(k); } catch { return; }
  }
}
sweep();
const challengeHint = () => resolver?.hints.find((h) => h.factorId === sdk.PhoneMultiFactorGenerator.FACTOR_ID) || null;
/** The destination the next send goes to, as sendCode would choose it; null when there is none to count against. */
function destination(phoneNumber) {
  if (resolver) { const hint = challengeHint(); const id = hint?.uid || hint?.phoneNumber; return id ? `factor:${id}` : null; }
  const number = e164(phoneNumber);
  return /^\+[1-9]\d{6,14}$/.test(number) ? `sms:${number}` : null;
}
async function recordKey(dest) {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(dest)));
  return STORE + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function readSends(key) {
  let sends = []; try { sends = JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  if (!Array.isArray(sends)) return [];
  // a record that can no longer hold anything back goes the next time it is read: the device keeps a run, never a history
  if (sends.length && !ladder.currentRun(sends, Date.now()).length) { try { localStorage.removeItem(key); } catch { /* read-only storage */ } return []; }
  return sends;
}
function writeSends(key, sends) {
  try { localStorage.setItem(key, JSON.stringify(sends)); } catch { /* no storage: the function still counts */ }
}
/** When the next code to this destination may go by this device's count (a timestamp; 0 when it has nothing). Display only. */
export async function nextSendAt(phoneNumber) {
  try {
    const dest = destination(phoneNumber); if (!dest) return 0;
    const key = await recordKey(dest), sends = readSends(key), hold = readHold(key);
    const at = Math.max(sends.length ? ladder.nextSendAt(sends, Date.now()) : 0, hold);
    return at > Date.now() ? at : 0;
  } catch { return 0; }
}
// The throttle before any send: the same schedule, refused with the seconds so the screen can count them down.
async function spaced(dest) {
  if (!dest) return null;
  let key; try { key = await recordKey(dest); } catch { return null; }
  const left = Math.ceil((Math.max(ladder.nextSendAt(readSends(key), Date.now()), readHold(key)) - Date.now()) / 1000);
  if (left > 0) throw Object.assign(Error('The next code to this number can go when the countdown on the Send button reaches zero.'), { waitSeconds: left });
  return key;
}
function recorded(key) { if (key) writeSends(key, ladder.withSend(readSends(key), Date.now())); }
// After a number is enrolled: its codes go under the new factor too (see above). Never fails the enrolment.
async function carryToFactor(before) {
  const number = enrolling; enrolling = null;
  try {
    const added = sdk.multiFactor(auth.currentUser).enrolledFactors.find((f) => !before.includes(f.uid));
    if (!number || !added?.uid) return;
    const sends = readSends(await recordKey(`sms:${number}`)); if (!sends.length) return;
    const key = await recordKey(`factor:${added.uid}`);
    writeSends(key, ladder.currentRun([...new Set([...readSends(key), ...sends])], Date.now()));
  } catch { /* no storage, or no factor to name: the function still counts */ }
}

export async function sendCode(phoneNumber, consent) {
  if (!resolver && consent !== true) throw Error('Acknowledge the mobile verification notice first.');
  const key = await spaced(destination(phoneNumber));
  verificationId = null; // a code from an earlier send must never be verified against this one
  const options = resolver
    ? { multiFactorHint: challengeHint(), session: resolver.session }
    : { phoneNumber: e164(phoneNumber), session: await sdk.multiFactor(auth.currentUser).getSession() };
  try { verificationId = await new sdk.PhoneAuthProvider(auth).verifyPhoneNumber(options, captcha()); }
  catch (error) { throw providerError(error, key); }
  recorded(key); enrolling = resolver ? null : e164(phoneNumber);
}
// the SMS resend ladder at the provider (DEPLOY_V3.md, section 5) refuses with SMS_WAIT:<seconds> inside the provider's
// error; refusalSeconds reads error?.code and error?.message alike, since the SDK may fold the string into either.
// Without the seconds, a failure that may be the ladder steps this device's record one rung (see above) and the
// wait is counted from there.
function providerError(error, key) {
  const seconds = ladder.refusalSeconds(error);
  if (seconds) {
    if (key) writeHold(key, Date.now() + seconds * 1000); // the server's own count, kept for this number
    return Object.assign(Error('Too many codes were sent to this number recently. Try again when the countdown on the Send button reaches zero.'), { waitSeconds: seconds });
  }
  if (!key || !ladder.possibleRefusal(error)) return error;
  recorded(key);
  const left = Math.ceil((ladder.nextSendAt(readSends(key), Date.now()) - Date.now()) / 1000);
  return left > 0 ? Object.assign(Error('No code was sent. Codes to one number are spaced out: try again when the countdown on the Send button reaches zero. If it keeps happening, tell the operator.'), { waitSeconds: left }) : error;
}
// Stage 4 review: a parent whose old phone still works changes the number here — a code to the new number, the new factor
// enrolled first, then every other one removed, so the account is never without a second factor (RECOVERY.md). Needs the
// fresh provider sign-in the caller just made (the provider refuses enrolment on an old one).
export async function changeMobileSend(phoneNumber, consent) {
  if (!auth.currentUser) throw Error('Sign in again first.');
  if (consent !== true) throw Error('Acknowledge the mobile verification notice first.');
  const key = await spaced(destination(phoneNumber)); // the new number: no challenge is open once the fresh sign-in is done
  verificationId = null;
  try { verificationId = await new sdk.PhoneAuthProvider(auth).verifyPhoneNumber({ phoneNumber: e164(phoneNumber), session: await sdk.multiFactor(auth.currentUser).getSession() }, captcha()); }
  catch (error) { throw providerError(error, key); }
  recorded(key); enrolling = e164(phoneNumber);
}
export async function changeMobileConfirm(code) {
  if (!verificationId || !auth.currentUser) throw Error('Request a verification code first.');
  const user = auth.currentUser, before = sdk.multiFactor(user).enrolledFactors.map((f) => f.uid);
  await sdk.multiFactor(user).enroll(sdk.PhoneMultiFactorGenerator.assertion(sdk.PhoneAuthProvider.credential(verificationId, code)), 'Parent mobile');
  await carryToFactor(before); // the sign-in straight after counts the codes the new number has just had
  for (const f of sdk.multiFactor(user).enrolledFactors) if (before.includes(f.uid)) await sdk.multiFactor(user).unenroll(f); // the old number goes only once the new one is in
  await clear();
  return { stage: 'signin', notice: 'Mobile number changed. Sign in with your password and a code to your new number.' };
}
export async function confirmCode(code) {
  if (!verificationId) throw Error('Request a verification code first.');
  const assertion = sdk.PhoneMultiFactorGenerator.assertion(sdk.PhoneAuthProvider.credential(verificationId, code));
  if (resolver) {
    const { user } = await resolver.resolveSignIn(assertion);
    resolver = null; resetCaptcha();
    return stage(user);
  }
  const before = sdk.multiFactor(auth.currentUser).enrolledFactors.map((f) => f.uid);
  await sdk.multiFactor(auth.currentUser).enroll(assertion, 'Parent mobile');
  await carryToFactor(before);
  await clear();
  return { stage: 'signin', notice: 'Mobile verified. Sign in with your password and SMS code to open the family workspace.' };
}
export async function resetPassword(email) {
  // Uniform UI response avoids disclosing whether an account exists.
  try { await sdk.sendPasswordResetEmail(auth, email); } catch { /* provider abuse protections still apply */ }
}
export async function clear() {
  resolver = null; verificationId = null;
  resetCaptcha();
  await sdk.signOut(auth);
}
