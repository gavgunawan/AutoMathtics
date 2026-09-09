import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// Abort before any SDK can connect to a non-emulator service.
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
const { initializeApp, deleteApp } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { Foundation, grantEntitlement } = await import('../server/service.mjs');
const { FirebaseIdentity, FirestoreStore } = await import('../server/firebase.mjs');
const { Learning } = await import('../server/learning.mjs');
const { fakeHasher, secret, rejected, canonical } = await import('./support.mjs');
const projectId = 'demo-am-foundation';
const app = initializeApp({ projectId });
const auth = getAuth(app), db = getFirestore(app), store = new FirestoreStore(db, { timestamp: (ms) => Timestamp.fromMillis(ms) });
const service = new Foundation({ store, identity: new FirebaseIdentity(auth), hasher: fakeHasher, secret });
const learning = new Learning({ foundation: service, store });
after(async () => { await db.terminate(); await deleteApp(app); });
async function post(path, value) {
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/${path}?key=demo-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const result = await r.json();
  assert.ok(r.ok, `Emulator request failed: ${result.error?.message || r.status}`); return result;
}
async function parent(email, phoneNumber, verified = true) {
  const password = 'Synthetic-password-7638';
  const user = await auth.createUser({ email, password, emailVerified: verified });

  const first = await post('v1/accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true
  });

  if (!verified) {
    return { uid: user.uid, idToken: first.idToken };
  }

  // Enroll SMS MFA using the real emulator enrollment flow.
  const enrollStart = await post('v2/accounts/mfaEnrollment:start', {
    idToken: first.idToken,
    phoneEnrollmentInfo: { phoneNumber }
  });

  const enrollSessionInfo = enrollStart.phoneSessionInfo.sessionInfo;

  const enrollCodes = await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/verificationCodes`
  ).then((r) => r.json());

  const enrollCode = enrollCodes.verificationCodes.find(
    (c) => c.sessionInfo === enrollSessionInfo
  )?.code;

  assert.ok(
    enrollCode,
    'MFA enrollment SMS code was not emitted by the Auth emulator'
  );

  await post('v2/accounts/mfaEnrollment:finalize', {
    idToken: first.idToken,
    phoneVerificationInfo: {
      sessionInfo: enrollSessionInfo,
      code: enrollCode
    }
  });

  // Sign in again. Firebase should now demand the enrolled second factor.
  const signIn = await post('v1/accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true
  });

  const mfaEnrollmentId = signIn.mfaInfo?.[0]?.mfaEnrollmentId;

  assert.ok(
    signIn.mfaPendingCredential,
    'Auth emulator did not return an MFA pending credential'
  );

  assert.ok(
    mfaEnrollmentId,
    'Auth emulator did not return an MFA enrollment ID'
  );

  const mfaStart = await post('v2/accounts/mfaSignIn:start', {
    mfaPendingCredential: signIn.mfaPendingCredential,
    mfaEnrollmentId
  });

  const signInSessionInfo = mfaStart.phoneResponseInfo.sessionInfo;

  const signInCodes = await fetch(
    `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/verificationCodes`
  ).then((r) => r.json());

  const signInCode = signInCodes.verificationCodes.find(
    (c) => c.sessionInfo === signInSessionInfo
  )?.code;

  assert.ok(
    signInCode,
    'MFA sign-in SMS code was not emitted by the Auth emulator'
  );

  const final = await post('v2/accounts/mfaSignIn:finalize', {
    mfaPendingCredential: signIn.mfaPendingCredential,
    phoneVerificationInfo: {
      sessionInfo: signInSessionInfo,
      code: signInCode
    }
  });

  return {
    uid: user.uid,
    idToken: final.idToken
  };
}

test('real Auth emulator rejects unverified email before account access', async () => {
  const p = await parent(`unverified-${randomUUID()}@example.test`, '+16505550110', false);
  await assert.rejects(service.login(p.idToken), rejected('VERIFY_EMAIL'));
});
test('real SMS MFA token, Firestore seat contention, private rules and expiry', async () => {
  const p = await parent(`verified-${randomUUID()}@example.test`, '+16505550111');
  const loginCookie = await service.login(p.idToken), loginCtx = await service.authenticate(loginCookie);
  const family = await service.createFamily(loginCtx, { label: 'Emulator family', adultAttestation: true, consentVersion: 'pilot-v1' });
  assert.equal(typeof family.token, 'string');
  await assert.rejects(service.authenticate(loginCookie), rejected('SIGN_IN_REQUIRED'));
  const cookie = family.token, ctx = await service.authenticate(cookie);
  await grantEntitlement(store, { familyId: family.id, seatLimit: 1, accessUntil: Date.now() + 600000, reason: 'emulator test grant', actor: 'integration-test' });
  const results = await Promise.allSettled(['One', 'Two'].map((nickname) => service.createChild(ctx, { nickname, icon: 'fox', pin: '763829' }, randomUUID())));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'CHILD_LIMIT_REACHED');
  const child = results.find((r) => r.status === 'fulfilled').value.child;
  const url = `http://127.0.0.1:8088/v1/projects/${projectId}/databases/(default)/documents/families/${family.id}`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${p.idToken}` } })).status, 403);
  assert.equal((await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${p.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { seatLimit: { integerValue: '99' } } }) })).status, 403);
  const selectorToken = await service.lock(ctx);
  await assert.rejects(service.authenticate(cookie), rejected('SIGN_IN_REQUIRED'));
  const selectorCtx = await service.authenticate(selectorToken);
  const childToken = await service.selectChild(selectorCtx, child.id, '763829');
  await assert.rejects(service.authenticate(selectorToken), rejected('SIGN_IN_REQUIRED'));
  const childCtx = await service.authenticate(childToken);
  assert.equal((await service.me(childCtx)).role, 'child');
  // Stage 2: a whole Navigator session against real Firestore transactions, answers read straight
  // from the server-side session document, and the expireAt field stored as a real Timestamp.
  const started = await learning.start(childCtx, { track: 'nav' });
  assert.equal(started.session.count, 15); assert.ok(!JSON.stringify(started).includes('"answer"'));
  const sessionPath = `families/${family.id}/learning/${child.id}/sessions/${started.session.id}`;
  const rawSession = (await db.doc(sessionPath).get()).data();
  assert.ok(rawSession.expireAt instanceof Timestamp, 'expireAt is stored as a Firestore Timestamp');
  assert.ok(rawSession.questions.every((q) => q.answer));
  let q = started.question, last;
  while (q) {
    last = await learning.answer(childCtx, { sessionId: started.session.id, index: q.index, attemptId: randomUUID(), answer: canonical(rawSession.questions[q.index]) });
    q = last.question || null;
  }
  assert.equal(last.summary.passed, true); assert.equal(last.summary.gcEarned, 50);
  const state = await learning.state(childCtx);
  assert.equal(state.nav.paper, 6); assert.equal(state.wallet.rp, 100); assert.equal(state.active, null);
  const rawSessionDoc = (await db.doc('sessions/' + (await import('../server/security.mjs')).sha256(childToken)).get()).data();
  assert.ok(rawSessionDoc.expireAt instanceof Timestamp, 'login sessions carry a Timestamp expireAt too');
  await grantEntitlement(store, { familyId: family.id, seatLimit: 1, accessUntil: Date.now() - 1, reason: 'emulator expiry', actor: 'integration-test' });
  await assert.rejects(service.me(childCtx), rejected('SUBSCRIPTION_INACTIVE'));
  await assert.rejects(learning.start(childCtx, { track: 'engine' }), rejected('SUBSCRIPTION_INACTIVE'));
});
