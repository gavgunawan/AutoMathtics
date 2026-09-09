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
  // Real-Firestore concurrency proof: two distinct attempts race the same current question.
  // Firestore retries one transaction; exactly one answer advances the index and the other fails stale.
  const race = await Promise.allSettled([randomUUID(), randomUUID()].map((attemptId) =>
    learning.answer(childCtx, { sessionId: started.session.id, index: 0, attemptId, answer: canonical(rawSession.questions[0]) })));
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(race.filter((r) => r.status === 'rejected').length, 1);
  assert.equal(race.find((r) => r.status === 'rejected').reason.code, 'STALE_QUESTION');
  const afterRace = (await db.doc(sessionPath).get()).data();
  assert.equal(afterRace.index, 1); assert.equal(afterRace.results.length, 1);
  let last = race.find((r) => r.status === 'fulfilled').value, q = last.question || null;
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
test('real Firestore: two families under one verified phone race for the single free trial — exactly one wins', async () => {
  const { Subscriptions } = await import('../server/subscription.mjs');
  const billing = new Subscriptions({ foundation: service, store });
  const pa = await parent(`trial-a-${randomUUID()}@example.test`, '+16505550120');
  const pb = await parent(`trial-b-${randomUUID()}@example.test`, '+16505550121');
  const la = await service.authenticate(await service.login(pa.idToken)), lb = await service.authenticate(await service.login(pb.idToken));
  // Give both parents the same phone key (as two sign-ups with one SIM would have) before their families exist.
  const keyA = (await db.doc(`parents/${pa.uid}`).get()).data().phoneKey; assert.ok(keyA);
  await db.doc(`parents/${pb.uid}`).update({ phoneKey: keyA });
  const fa = await service.createFamily(la, { label: 'Trial race A', adultAttestation: true, consentVersion: 'pilot-v1' });
  const fb = await service.createFamily(lb, { label: 'Trial race B', adultAttestation: true, consentVersion: 'pilot-v1' });
  const ctxA = await service.authenticate(fa.token), ctxB = await service.authenticate(fb.token);
  assert.deepEqual((await db.doc(`phones/${keyA}`).get()).data().families.sort(), [fa.id, fb.id].sort());
  const race = await Promise.allSettled([billing.startTrial(ctxA, { operationId: randomUUID() }), billing.startTrial(ctxB, { operationId: randomUUID() })]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(race.map((r) => r.status === 'rejected' ? r.reason.code : 'ok')));
  assert.equal(race.find((r) => r.status === 'rejected').reason.code, 'TRIAL_ALREADY_USED');
  const ledger = (await db.doc(`phones/${keyA}`).get()).data();
  const winner = race[0].status === 'fulfilled' ? fa.id : fb.id, loser = winner === fa.id ? fb.id : fa.id;
  assert.equal(ledger.trialFamilyId, winner);
  assert.equal((await db.doc(`families/${winner}`).get()).data().subscription.state, 'trial');
  assert.equal((await db.doc(`families/${loser}`).get()).data().subscription, undefined);
});
test('real Firestore: the same signed webhook delivered three times at once is applied exactly once; the others replay the stored outcome', async () => {
  const { Subscriptions } = await import('../server/subscription.mjs');
  const { Payments, FakeGateway, signWebhook } = await import('../server/payments.mjs');
  const { webhookSecret } = await import('./support.mjs');
  const billing = new Subscriptions({ foundation: service, store });
  const payments = new Payments({ foundation: service, store, billing, provider: 'fake', gateways: { fake: new FakeGateway({ secret: webhookSecret }) } });
  const p = await parent(`hook-${randomUUID()}@example.test`, '+16505550130');
  const l = await service.authenticate(await service.login(p.idToken));
  const fam = await service.createFamily(l, { label: 'Webhook family', adultAttestation: true, consentVersion: 'pilot-v1' });
  const ctx = await service.authenticate(fam.token);
  const co = await payments.checkout(ctx, { plan: 'starter', operationId: randomUUID() });
  assert.equal((await db.doc(`billingCustomers/fake:${co.customerRef}`).get()).data().familyId, fam.id);
  const event = { id: `evt_${randomUUID()}`, type: 'checkout.completed', at: Date.now(), customer: co.customerRef, data: { price: 'price_fake_starter', periodEnd: Date.now() + 30 * 86_400_000, checkoutId: co.checkoutId } };
  const raw = Buffer.from(JSON.stringify(event)), headers = { 'x-webhook-signature': signWebhook(webhookSecret, raw, Date.now()) };
  const results = await Promise.all([1, 2, 3].map(() => payments.receive('fake', raw, headers)));
  assert.equal(results.filter((r) => r.status === 'applied').length, 3, JSON.stringify(results));
  assert.equal(results.filter((r) => r.replayed).length, 2, 'exactly one delivery did the work');
  const family = (await db.doc(`families/${fam.id}`).get()).data();
  assert.equal(family.subscription.state, 'active'); assert.equal(family.subscription.version, 1);
  assert.equal((await db.collection(`families/${fam.id}/billing`).get()).size, 1);
  assert.equal((await db.doc(`billingEvents/fake:${event.id}`).get()).data().outcome.status, 'applied');
  assert.equal((await db.doc(`checkouts/fake:${co.checkoutId}`).get()).data().status, 'completed');
  assert.ok((await db.doc(`checkouts/fake:${co.checkoutId}`).get()).data().expireAt instanceof Timestamp, 'checkout expiry is a real Timestamp for the TTL policy');
});
