// Firebase handles credentials, verification and SMS MFA. No passwords or identity
// tokens are persisted by this app. A successful exchange clears the SDK session.
const cfg = await fetch('/api/config', { cache: 'no-store' }).then((r) => r.json());
if (cfg.emulator && !['127.0.0.1', 'localhost'].includes(location.hostname)) throw Error('Unsafe emulator origin');
const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js');
const sdk = await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js');
const auth = sdk.initializeAuth(initializeApp(cfg.firebase), { persistence: sdk.inMemoryPersistence });
if (cfg.emulator) sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
let resolver = null, verificationId = null, verifier = null, lastSend = 0;

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
export async function sendCode(phoneNumber, consent) {
  if (Date.now() - lastSend < 60_000) throw Error('Wait a minute before requesting another code.');
  if (!resolver && consent !== true) throw Error('Acknowledge the mobile verification notice first.');
  verifier?.clear();
  verifier = new sdk.RecaptchaVerifier(auth, 'recaptcha', { size: 'normal' });
  const options = resolver
    ? { multiFactorHint: resolver.hints.find((h) => h.factorId === sdk.PhoneMultiFactorGenerator.FACTOR_ID), session: resolver.session }
    : { phoneNumber, session: await sdk.multiFactor(auth.currentUser).getSession() };
  verificationId = await new sdk.PhoneAuthProvider(auth).verifyPhoneNumber(options, verifier);
  lastSend = Date.now();
}
export async function confirmCode(code) {
  if (!verificationId) throw Error('Request a verification code first.');
  const assertion = sdk.PhoneMultiFactorGenerator.assertion(sdk.PhoneAuthProvider.credential(verificationId, code));
  if (resolver) {
    const { user } = await resolver.resolveSignIn(assertion);
    resolver = null; verifier?.clear(); verifier = null;
    return stage(user);
  }
  await sdk.multiFactor(auth.currentUser).enroll(assertion, 'Parent mobile');
  await clear();
  return { stage: 'signin', notice: 'Mobile verified. Sign in with your password and SMS code to open the family workspace.' };
}
export async function resetPassword(email) {
  // Uniform UI response avoids disclosing whether an account exists.
  try { await sdk.sendPasswordResetEmail(auth, email); } catch { /* provider abuse protections still apply */ }
}
export async function clear() {
  resolver = null; verificationId = null;
  verifier?.clear(); verifier = null;
  await sdk.signOut(auth);
}
