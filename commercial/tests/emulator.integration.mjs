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

// a fresh MFA sign-in for an already enrolled parent (the same ceremony parent() ran), for tests that need a second session later
async function signInAgain(email, uid, password = 'Synthetic-password-7638') {
  const signIn = await post('v1/accounts:signInWithPassword', { email, password, returnSecureToken: true });
  const mfaEnrollmentId = signIn.mfaInfo?.[0]?.mfaEnrollmentId; assert.ok(signIn.mfaPendingCredential && mfaEnrollmentId);
  const mfaStart = await post('v2/accounts/mfaSignIn:start', { mfaPendingCredential: signIn.mfaPendingCredential, mfaEnrollmentId });
  const codes = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/verificationCodes`).then((r) => r.json());
  const code = codes.verificationCodes.find((c) => c.sessionInfo === mfaStart.phoneResponseInfo.sessionInfo)?.code; assert.ok(code);
  const final = await post('v2/accounts/mfaSignIn:finalize', { mfaPendingCredential: signIn.mfaPendingCredential, phoneVerificationInfo: { sessionInfo: mfaStart.phoneResponseInfo.sessionInfo, code } });
  return { uid, idToken: final.idToken };
}

test('real Auth emulator rejects unverified email before account access', async () => {
  const p = await parent(`unverified-${randomUUID()}@example.test`, '+16505550110', false);
  await assert.rejects(service.login(p.idToken), rejected('VERIFY_EMAIL'));
});
test('real SMS MFA token, Firestore seat contention, private rules and expiry', async () => {
  const p = await parent(`verified-${randomUUID()}@example.test`, '+16505550111');
  const loginCookie = await service.login(p.idToken), loginCtx = await service.authenticate(loginCookie);
  const family = await service.createFamily(loginCtx, { label: 'Emulator family', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
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
  const fa = await service.createFamily(la, { label: 'Trial race A', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
  const fb = await service.createFamily(lb, { label: 'Trial race B', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
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
  const fam = await service.createFamily(l, { label: 'Webhook family', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
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
  assert.equal((await db.doc(`checkouts/fake:${co.checkoutId}`).get()).data().expireAt, undefined, 'a checkout is financial evidence: no TTL field');
});
test('real Firestore: an abandoned plan change that is taken over can never finalise, and never disturbs its successor (S3.4-F)', async () => {
  const { Subscriptions } = await import('../server/subscription.mjs');
  const { Payments, FakeGateway, signWebhook } = await import('../server/payments.mjs');
  const { webhookSecret } = await import('./support.mjs');
  const billing = new Subscriptions({ foundation: service, store });
  const gateway = new FakeGateway({ secret: webhookSecret });
  const payments = new Payments({ foundation: service, store, billing, provider: 'fake', gateways: { fake: gateway }, inflightMs: 1500 }); // a short window for the test
  const p = await parent(`takeover-${randomUUID()}@example.test`, '+16505550140');
  const l = await service.authenticate(await service.login(p.idToken));
  const fam = await service.createFamily(l, { label: 'Takeover family', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
  const ctx = await service.authenticate(fam.token);
  const co = await payments.checkout(ctx, { plan: 'starter', operationId: randomUUID() });
  const event = { id: `evt_${randomUUID()}`, type: 'checkout.completed', at: Date.now(), customer: co.customerRef, data: { price: 'price_fake_starter', periodEnd: Date.now() + 30 * 86_400_000, checkoutId: co.checkoutId } };
  const raw = Buffer.from(JSON.stringify(event));
  assert.equal((await payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, Date.now()) })).status, 'applied');
  const gates = new Map(); const real = gateway.changePlan.bind(gateway);
  gateway.changePlan = async (args) => { const gate = gates.get(args.idempotencyKey); if (gate) await gate; return real(args); };
  const idA = randomUUID(), idB = randomUUID(); let openA, openB;
  gates.set(idA, new Promise((r) => { openA = r; })); gates.set(idB, new Promise((r) => { openB = r; }));
  const pA = payments.changePlan(ctx, { plan: 'family', operationId: idA });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await db.doc(`families/${fam.id}`).get()).data().billingIntent.operationId, idA);
  await new Promise((r) => setTimeout(r, 1500)); // the in-flight window passes with A still at the provider
  const pB = payments.changePlan(ctx, { plan: 'big', operationId: idB });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await db.doc(`billingChangeIntents/fake:${idA}`).get()).data().status, 'superseded');
  assert.equal((await db.doc(`families/${fam.id}`).get()).data().billingIntent.operationId, idB);
  openA(); await assert.rejects(pA, rejected('SUBSCRIPTION_CHANGED'));
  const mid = (await db.doc(`families/${fam.id}`).get()).data(); assert.equal(mid.subscription.plan, 'starter'); assert.equal(mid.billingIntent.operationId, idB, 'A did not clear B\'s marker');
  openB(); assert.equal((await pB).entitlement.plan, 'big');
  const after = (await db.doc(`families/${fam.id}`).get()).data(); assert.equal(after.subscription.seats, 6); assert.equal(after.billingIntent, null);
  assert.equal((await db.doc(`billingChangeIntents/fake:${idB}`).get()).data().status, 'applied');
  assert.equal((await db.collection(`families/${fam.id}/billing`).where('type', '==', 'plan.change').get()).size, 1);
});
test('real Firestore: a requested deletion removes the people and the game and leaves the money records and tombstones (Stage 3.5)', async () => {
  const { Subscriptions } = await import('../server/subscription.mjs');
  const { Payments, FakeGateway, signWebhook } = await import('../server/payments.mjs');
  const { Support } = await import('../server/support.mjs');
  const { webhookSecret } = await import('./support.mjs');
  const billing = new Subscriptions({ foundation: service, store });
  const payments = new Payments({ foundation: service, store, billing, provider: 'fake', gateways: { fake: new FakeGateway({ secret: webhookSecret }) } });
  const support = new Support({ foundation: service, store, billing, payments });
  const p = await parent(`delete-${randomUUID()}@example.test`, '+16505550150');
  const l = await service.authenticate(await service.login(p.idToken));
  const fam = await service.createFamily(l, { label: 'Leaving family', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
  const ctx = await service.authenticate(fam.token);
  const co = await payments.checkout(ctx, { plan: 'starter', operationId: randomUUID() });
  const event = { id: `evt_${randomUUID()}`, type: 'checkout.completed', at: Date.now(), customer: co.customerRef, data: { price: 'price_fake_starter', periodEnd: Date.now() + 30 * 86_400_000, checkoutId: co.checkoutId } };
  const raw = Buffer.from(JSON.stringify(event));
  assert.equal((await payments.receive('fake', raw, { 'x-webhook-signature': signWebhook(webhookSecret, raw, Date.now()) })).status, 'applied');
  const { child } = await service.createChild(ctx, { nickname: 'Leaver', icon: 'fox', pin: '763829' }, randomUUID());
  // the parent asks and exports before handing the device over (the handover retires this parent session, S1-001)
  const req = await support.requestDeletion(ctx, { operationId: randomUUID() }); assert.ok(req.pending);
  const x = await support.exportFamily(ctx); assert.equal(x.children.length, 1); assert.equal(x.children[0].nickname, 'Leaver');
  const sel = await service.authenticate(await service.lock(ctx));
  const childCtx = await service.authenticate(await service.selectChild(sel, child.id, '763829'));
  const started = await learning.start(childCtx, { track: 'nav' }); assert.ok(started.session.id);
  // a long history: 520 ledger rows, more than one Firestore transaction may write
  for (let start = 0; start < 520; start += 400) { const b = db.batch(); for (let i = start; i < Math.min(520, start + 400); i++) b.set(db.doc(`families/${fam.id}/learning/${child.id}/ledger/row-${i}`), { id: `row-${i}`, seq: i + 1, gc: 1, rp: 0, type: 'parent.adjust', at: Date.now(), balance: { gc: i + 1, rp: 0 } }); await b.commit(); }
  // the process dies right after the freeze, before the terminate (freeze = 1, terminate = 2)
  const orig = store.transaction.bind(store); let k = 0; store.transaction = (fn, o) => { k++; if (k === 2) { store.transaction = orig; return Promise.reject(Error('crash')); } return orig(fn, o); };
  await assert.rejects(support.executeDeletion(fam.id, { operator: 'emulator-operator', force: true }), /crash/);
  const mid = (await db.doc(`families/${fam.id}`).get()).data(); assert.equal(mid.deletion.status, 'executing'); assert.equal(mid.deleted, undefined);
  assert.equal(mid.subscription.state, 'active', 'frozen before the terminate: the subscription is still on record');
  const gapEvent = { id: `evt_${randomUUID()}`, type: 'invoice.paid', at: Date.now(), customer: co.customerRef, data: { price: 'price_fake_starter', periodEnd: Date.now() + 60 * 86_400_000 } };
  const gapRaw = Buffer.from(JSON.stringify(gapEvent));
  assert.deepEqual(await payments.receive('fake', gapRaw, { 'x-webhook-signature': signWebhook(webhookSecret, gapRaw, Date.now()) }), { status: 'reconciliation_required', reason: 'FAMILY_DELETED' }, 'a renewal in the gap is recorded, never applied');
  assert.equal((await db.doc(`families/${fam.id}`).get()).data().subscription.version, mid.subscription.version);
  await assert.rejects(learning.start(childCtx, { track: 'engine' }), rejected('FAMILY_DELETED'), 'Blocker 1: no Stage 2 write lands while the deletion runs');
  await assert.rejects(service.me(childCtx), rejected('FAMILY_DELETED'), 'the live child session is refused too (the parent session was retired by the handover)');
  assert.equal((await db.doc(`families/${fam.id}/learning/${child.id}`).get()).exists, true, 'nothing destroyed before the freeze');
  const record = await support.executeDeletion(fam.id, { operator: 'emulator-operator' }); // resumed
  assert.equal(record.counts.children, 1); assert.equal(record.counts.sessions, 1); assert.equal(record.counts.ledgerRows, 520); assert.equal(record.forced, true); assert.equal(record.executionId, mid.deletion.executionId);
  assert.equal((await db.collection(`families/${fam.id}/learning/${child.id}/ledger`).get()).size, 0, 'Blocker 2: 520 rows went in bounded batches');
  assert.equal((await db.collection('sessions').where('familyId', '==', fam.id).get()).size, 0, 'no family session survives');
  assert.equal((await db.collection('sessions').where('uid', '==', p.uid).get()).size, 0, 'no parent session survives');
  assert.equal((await db.doc(`families/${fam.id}/children/${child.id}`).get()).exists, false);
  assert.equal((await db.doc(`families/${fam.id}/credentials/${child.id}`).get()).exists, false);
  assert.equal((await db.doc(`families/${fam.id}/learning/${child.id}`).get()).exists, false);
  assert.equal((await db.collection(`families/${fam.id}/learning/${child.id}/sessions`).get()).size, 0);
  assert.equal((await db.collection(`families/${fam.id}/members`).get()).size, 0);
  const tomb = (await db.doc(`families/${fam.id}`).get()).data(); assert.equal(tomb.deleted, true); assert.equal(tomb.label, undefined); assert.equal(tomb.subscription.state, 'cancelled');
  assert.equal((await db.collection(`families/${fam.id}/billing`).get()).size, 2, 'the payment and the terminate stay');
  assert.equal((await db.doc(`billingEvents/fake:${event.id}`).get()).exists, true);
  assert.equal((await db.doc(`parents/${p.uid}`).get()).data().deleted, true);
  await assert.rejects(service.me(childCtx), rejected('SIGN_IN_REQUIRED'));
  await assert.rejects(service.me(sel), rejected('SIGN_IN_REQUIRED'));
  // Blocker 3: a valid signed renewal after the deletion is recorded and never revives the family
  const late = { id: `evt_${randomUUID()}`, type: 'invoice.paid', at: Date.now(), customer: co.customerRef, data: { price: 'price_fake_starter', periodEnd: Date.now() + 60 * 86_400_000 } };
  const lateRaw = Buffer.from(JSON.stringify(late));
  assert.deepEqual(await payments.receive('fake', lateRaw, { 'x-webhook-signature': signWebhook(webhookSecret, lateRaw, Date.now()) }), { status: 'reconciliation_required', reason: 'FAMILY_DELETED' });
  const after = (await db.doc(`families/${fam.id}`).get()).data(); assert.equal(after.deleted, true); assert.equal(after.subscription.state, 'cancelled');
  assert.equal((await db.doc(`billingEvents/fake:${late.id}`).get()).data().outcome.reason, 'FAMILY_DELETED');
});
test('real Auth: once the family is gone the parent deletes the sign-in account, and the Auth emulator no longer knows the user (Stage 4.0)', async () => {
  const { Subscriptions } = await import('../server/subscription.mjs');
  const { Payments, FakeGateway } = await import('../server/payments.mjs');
  const { Support } = await import('../server/support.mjs');
  const { webhookSecret } = await import('./support.mjs');
  const billing = new Subscriptions({ foundation: service, store });
  const payments = new Payments({ foundation: service, store, billing, provider: 'fake', gateways: { fake: new FakeGateway({ secret: webhookSecret }) } });
  const support = new Support({ foundation: service, store, billing, payments });
  const email = `leaving-${randomUUID()}@example.test`, p = await parent(email, '+16505550160');
  const l = await service.authenticate(await service.login(p.idToken));
  const fam = await service.createFamily(l, { label: 'Leaving for good', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
  const ctx = await service.authenticate(fam.token);
  await assert.rejects(support.deleteAccount(ctx, { operationId: randomUUID() }), rejected('FAMILY_STILL_EXISTS'));
  await support.requestDeletion(ctx, { operationId: randomUUID() });
  await support.executeDeletion(fam.id, { operator: 'emulator-operator', force: true });
  await new Promise((r) => setTimeout(r, 1100)); // reauthAfter moved to this second: a token minted in the next one is fresh
  const again = await signInAgain(email, p.uid); const ctx2 = await service.authenticate(await service.login(again.idToken));
  assert.equal((await service.me(ctx2)).family, null);
  const r = await support.deleteAccount(ctx2, { operationId: randomUUID() }); assert.equal(r.deleted, true);
  await assert.rejects(auth.getUser(p.uid), (e) => e.code === 'auth/user-not-found', 'the Auth account is gone at the provider');
  const tomb = (await db.doc(`parents/${p.uid}`).get()).data(); assert.equal(tomb.deleted, true); assert.ok(tomb.identityDeletion.deletedAt); assert.equal(typeof tomb.phoneKey, 'string');
  assert.equal((await db.collection('sessions').where('uid', '==', p.uid).get()).size, 0);
  await assert.rejects(service.login(again.idToken), rejected('INVALID_LOGIN'), 'a token of the deleted user cannot sign in');
});

async function enrolPhone(idToken, phoneNumber) {
  const start = await post('v2/accounts/mfaEnrollment:start', { idToken, phoneEnrollmentInfo: { phoneNumber } }), sessionInfo = start.phoneSessionInfo.sessionInfo;
  const codes = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/verificationCodes`).then((r) => r.json());
  const code = codes.verificationCodes.find((c) => c.sessionInfo === sessionInfo)?.code; assert.ok(code);
  await post('v2/accounts/mfaEnrollment:finalize', { idToken, phoneVerificationInfo: { sessionInfo, code } });
}
test('real Auth: lost phone — the factor is removed only after the emailed password reset and the waiting period; the password-only token is refused; a new mobile is enrolled and the same family reopens (Stage 4.4)', async () => {
  const { Recovery } = await import('../server/recovery.mjs');
  const WAIT = 3000, identity = new FirebaseIdentity(auth); // the real clock: a jumped clock would put the reauth floor in the future
  const recovery = new Recovery({ foundation: service, store, identity, secret, waitMs: WAIT });
  const email = `lost-${randomUUID()}@example.test`, p = await parent(email, '+16505550170');
  const cookie = await service.login(p.idToken), l = await service.authenticate(cookie);
  const fam = await service.createFamily(l, { label: 'Lost phone', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
  const before = (await db.doc(`parents/${p.uid}`).get()).data();
  const started = await recovery.start({ email }); assert.equal(started.accepted, true); assert.ok(started.readyAt > Date.now() && started.readyAt <= Date.now() + WAIT);
  assert.deepEqual(await recovery.complete({ email }), { completed: false }, 'no proof: the same answer as for any email');
  // the parent resets the password from the emailed link (the emulator exposes the code)
  const resetPassword = async (newPassword) => {
    await post('v1/accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
    const codes = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`).then((r) => r.json());
    const oob = codes.oobCodes.filter((c) => c.email === email && c.requestType === 'PASSWORD_RESET').at(-1); assert.ok(oob, 'the emulator issued a reset code');
    await post('v1/accounts:resetPassword', { oobCode: oob.oobCode, newPassword });
  };
  await resetPassword('Synthetic-password-9911');
  assert.deepEqual(await recovery.complete({ email }), { completed: false }, 'proof, but the wait is not over');
  assert.equal((await auth.getUser(p.uid)).multiFactor.enrolledFactors.length, 1, 'nothing changes before the waiting period');
  await new Promise((r) => setTimeout(r, WAIT + 500)); // the waiting period passes
  // the race: the owner signs in with the old phone after complete() has read the request as pending and before it claims it
  const realLookup = identity.lookup.bind(identity);
  identity.lookup = async (uid, fresh) => { identity.lookup = realLookup; const owner = await signInAgain(email, p.uid, 'Synthetic-password-9911'); await service.login(owner.idToken); return realLookup(uid, fresh); };
  assert.deepEqual(await recovery.complete({ email }), { completed: false });
  assert.equal((await auth.getUser(p.uid)).multiFactor.enrolledFactors.length, 1, 'the factor stayed: the sign-in won');
  assert.equal((await db.doc(`recoveries/${p.uid}`).get()).data().status, 'cancelled_by_sign_in');
  // the parent asks again, proves the inbox again, waits again — and this time nobody signs in
  await new Promise((r) => setTimeout(r, 1100));
  await recovery.start({ email }); await resetPassword('Synthetic-password-9922');
  await new Promise((r) => setTimeout(r, WAIT + 500));
  assert.deepEqual(await recovery.complete({ email }), { completed: true });
  assert.equal((await auth.getUser(p.uid)).multiFactor?.enrolledFactors?.length ?? 0, 0, 'the factor is gone at the provider');
  await assert.rejects(service.authenticate(cookie), 'the old session is gone');
  const rec = (await db.doc(`recoveries/${p.uid}`).get()).data(); assert.equal(rec.status, 'completed'); assert.ok(['tokens_revoked', 'password_changed'].includes(rec.proof)); assert.ok(rec.claimId);
  // password alone yields a token this server refuses until a mobile is verified again
  const plain = await post('v1/accounts:signInWithPassword', { email, password: 'Synthetic-password-9922', returnSecureToken: true }); assert.ok(plain.idToken);
  await assert.rejects(service.login(plain.idToken), rejected('VERIFY_MOBILE_WITH_MFA'));
  await enrolPhone(plain.idToken, '+16505550171');
  await new Promise((r) => setTimeout(r, 1100)); // reauthAfter moved to the completion second
  const again = await signInAgain(email, p.uid, 'Synthetic-password-9922'), ctx = await service.authenticate(await service.login(again.idToken));
  const me = await service.me(ctx); assert.equal(me.family.id, fam.id, 'the same family'); assert.equal(me.recovery.status, 'completed');
  const after = (await db.doc(`parents/${p.uid}`).get()).data(); assert.notEqual(after.phoneKey, before.phoneKey, 'the phone key follows the new number'); assert.equal(after.familyId, before.familyId);
});
test('real Firestore: two children imported from v2 and then the family rocket — the config, the one-shot marker and one audit row are written, and the ledgers are untouched', async () => {
  const { importLearning, importRocket } = await import('../server/migrate.mjs');
  const p = await parent(`rocket-${randomUUID()}@example.test`, '+16505550180');
  const l = await service.authenticate(await service.login(p.idToken));
  const fam = await service.createFamily(l, { label: 'Rocket family', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
  const ctx = await service.authenticate(fam.token);
  await grantEntitlement(store, { familyId: fam.id, seatLimit: 2, accessUntil: Date.now() + 600000, reason: 'emulator rocket grant', actor: 'integration-test' });
  const { child: nova } = await service.createChild(ctx, { nickname: 'Nova', icon: 'fox', pin: '763829' }, randomUUID());
  const { child: orion } = await service.createChild(ctx, { nickname: 'Orion', icon: 'wolf', pin: '763829' }, randomUUID());
  // synthetic v2 records: `passes` passed papers on one day, and v2 RP spending equal to the child's rocket fuel
  const record = (passes, rpSpent) => ({ level: 0, paper: 1, bossCleared: 0, nav: { level: 0, paper: 1, bossCleared: 0 }, savedAt: 1788870699017,
    history: Array.from({ length: passes }, (_, i) => ({ date: '2026-09-01', ts: Date.parse('2026-09-01T04:00:00Z') + i * 60_000, levelIdx: 0, levelId: 'A', papers: '1–5', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, mins: '5:12' })),
    wallet: { gcSpent: 0, rpSpent, shields: 0, shieldDays: [], inventory: [], purchases: [], redemptions: [] } });
  for (const [child, passes, rpSpent] of [[nova, 70, 6700], [orion, 75, 7100]]) {
    await importLearning(store, { familyId: fam.id, childId: child.id, record: record(passes, rpSpent), actor: 'integration-test', reason: 'emulator v2 child' });
  }
  const snapshot = async () => Promise.all([nova, orion].map(async (c) => ({ doc: (await db.doc(`families/${fam.id}/learning/${c.id}`).get()).data(),
    ledger: (await db.collection(`families/${fam.id}/learning/${c.id}/ledger`).get()).docs.map((d) => [d.id, d.data()]) })));
  const before = await snapshot();
  for (const s of before) { assert.deepEqual(s.ledger.map(([id]) => id), ['migrate-opening']); assert.equal(s.doc.legacy.from, 'v2'); }
  const v2Rocket = { createdAt: 1788000000000, createdOn: '2026-08-29', crew: ['nova', 'orion'], currency: 'rp', fuel: { nova: 6700, orion: 7100 }, goal: 20000, id: '1788000000000',
    lastFuel: { amt: 100, at: 1788100000000, by: 'Orion' }, minEach: 10000, prize: { emoji: '🎡', name: 'Theme park day' }, status: 'fueling' };
  const crewMap = { nova: nova.id, orion: orion.id };
  const result = await importRocket(store, { familyId: fam.id, crewMap, v2Rocket, actor: 'integration-test', reason: 'emulator v2 rocket' });
  assert.equal(result.alreadyWritten, false); assert.deepEqual(result.crew.map((c) => [c.name, c.nickname, c.fuel, c.spent]), [['nova', 'Nova', 6700, 6700], ['orion', 'Orion', 7100, 7100]]);
  const cfg = (await db.doc(`families/${fam.id}/game/config`).get()).data();
  assert.deepEqual(cfg.rocket, { id: result.rocketId, status: 'fueling', prize: { emoji: '🎡', name: 'Theme park day' }, currency: 'rp', goal: 20000, minEach: 10000,
    crewChildIds: [nova.id, orion.id], fuel: { [nova.id]: 6700, [orion.id]: 7100 }, createdAt: cfg.rocket.createdAt });
  assert.deepEqual(cfg.rocketMigration, { v2Id: '1788000000000', rocketId: result.rocketId, at: cfg.rocket.createdAt });
  assert.deepEqual(cfg.rewards, []); assert.deepEqual(cfg.rocketHistory, []);
  const audits = (await db.collection('audit').where('familyId', '==', fam.id).get()).docs.map((d) => d.data()).filter((a) => a.action === 'rocket.migrated');
  assert.equal(audits.length, 1); assert.ok(audits[0].expireAt instanceof Timestamp, 'the audit row carries a real TTL Timestamp');
  assert.equal(audits[0].childId, null); assert.equal(audits[0].expireAt.toMillis(), audits[0].at + 400 * 24 * 60 * 60_000, 'the audit TTL is 400 days');
  // ids and numbers only (PRIVACY.md): no crew name, no nickname, no prize text
  assert.deepEqual(audits[0].summary, { rocketId: result.rocketId, v2Id: '1788000000000', v2CreatedOn: '2026-08-29', v2CreatedAt: 1788000000000, v2HistoryCount: 0,
    currency: 'rp', goal: 20000, minEach: 10000, totalFuel: 13800,
    crew: [{ childId: nova.id, fuel: 6700, spent: 6700, otherSpent: 0 }, { childId: orion.id, fuel: 7100, spent: 7100, otherSpent: 0 }] });
  for (const secret of ['nova', 'Nova', 'orion', 'Orion', 'Theme park', '🎡']) assert.ok(!JSON.stringify(audits[0].summary).includes(secret), `the audit row never holds ${secret}`);
  assert.deepEqual(await snapshot(), before, 'no learning document and no ledger row changed');
  const second = await importRocket(store, { familyId: fam.id, crewMap, v2Rocket, actor: 'integration-test', reason: 'emulator second run' }).then(() => null, (e) => e);
  assert.equal(second?.code, 'V2_ROCKET_ALREADY_IMPORTED'); assert.deepEqual(second.detail, { rocketId: result.rocketId, at: cfg.rocketMigration.at }, 'the detail survives a real Firestore transaction');
  assert.equal((await db.collection('audit').where('familyId', '==', fam.id).get()).docs.filter((d) => d.data().action === 'rocket.migrated').length, 1);
});
test('real Firestore, through the operator tool: a leftover CONFIRM_MIGRATION=write is a dry run, a spending mismatch prints both numbers, declared other spending writes, and a repeat prints the existing import', async () => {
  const { importLearning } = await import('../server/migrate.mjs');
  const { spawnSync } = await import('node:child_process');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const p = await parent(`rocket-cli-${randomUUID()}@example.test`, '+16505550181');
  const l = await service.authenticate(await service.login(p.idToken));
  const fam = await service.createFamily(l, { label: 'Rocket CLI family', adultAttestation: true, consentVersion: 'terms-2026-09-13.2' });
  const ctx = await service.authenticate(fam.token);
  await grantEntitlement(store, { familyId: fam.id, seatLimit: 2, accessUntil: Date.now() + 600000, reason: 'emulator rocket grant', actor: 'integration-test' });
  const { child: nova } = await service.createChild(ctx, { nickname: 'Nova', icon: 'fox', pin: '763829' }, randomUUID());
  const { child: orion } = await service.createChild(ctx, { nickname: 'Orion', icon: 'wolf', pin: '763829' }, randomUUID());
  const record = (passes, rpSpent) => ({ level: 0, paper: 1, bossCleared: 0, nav: { level: 0, paper: 1, bossCleared: 0 }, savedAt: 1788870699017,
    history: Array.from({ length: passes }, (_, i) => ({ date: '2026-09-01', ts: Date.parse('2026-09-01T04:00:00Z') + i * 60_000, levelIdx: 0, levelId: 'A', papers: '1–5', correct: 25, incorrect: 0, timeout: 0, total: 25, passed: true, mins: '5:12' })),
    wallet: { gcSpent: 0, rpSpent, shields: 0, shieldDays: [], inventory: [], purchases: [], redemptions: [] } });
  // orion's v2 spending holds 100 RP of an earlier rocket (the node's history) on top of this rocket's fuel
  for (const [child, passes, rpSpent] of [[nova, 70, 6700], [orion, 75, 7200]]) {
    await importLearning(store, { familyId: fam.id, childId: child.id, record: record(passes, rpSpent), actor: 'integration-test', reason: 'emulator v2 child' });
  }
  const dir = await mkdtemp(join(tmpdir(), 'am-rocket-cli-'));
  try {
    const file = join(dir, 'rocket.json');
    await writeFile(file, JSON.stringify({ createdAt: 1788000000000, createdOn: '2026-08-29', crew: ['nova', 'orion'], currency: 'rp', fuel: { nova: 6700, orion: 7100 }, goal: 20000, id: '1788000000000',
      minEach: 10000, prize: { emoji: '🎡', name: 'Theme park day' }, status: 'fueling', history: [{ id: '1780000000000', status: 'claimed' }] }));
    const script = fileURLToPath(new URL('../scripts/migrate-v2.mjs', import.meta.url));
    const cli = (token, ...extra) => spawnSync(process.execPath, [script, 'rocket', fam.id, file, `nova=${nova.id}`, `orion=${orion.id}`, ...extra, 'emulator cli rocket'],
      { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, APP_MODE: 'emulator', FIREBASE_PROJECT_ID: projectId, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088', ...(token ? { CONFIRM_MIGRATION: token } : {}) } });
    const configDoc = db.doc(`families/${fam.id}/game/config`);
    const leftover = cli('write');
    assert.equal(leftover.status, 0, leftover.stderr); assert.match(leftover.stdout, /Nothing was written/); assert.match(leftover.stderr, /WARNING: this v2 rocket lists 1 earlier rocket/);
    assert.equal((await configDoc.get()).exists, false, 'CONFIRM_MIGRATION=write wrote no rocket');
    const mismatch = cli('rocket');
    assert.notEqual(mismatch.status, 0); assert.match(mismatch.stderr, /V2_ROCKET_FUEL_SPENT_MISMATCH:orion/);
    assert.match(mismatch.stderr, /rpSpent 7200; fuel 7100 \+ declared other spending 0 = 7100/, 'both numbers for the operator');
    assert.equal((await configDoc.get()).exists, false);
    const written = cli('rocket', 'other.orion=100');
    assert.equal(written.status, 0, written.stderr); assert.match(written.stdout, /"event":"rocket_migration_written"/);
    const cfg = (await configDoc.get()).data();
    assert.deepEqual(cfg.rocket.fuel, { [nova.id]: 6700, [orion.id]: 7100 });
    const audit = (await db.collection('audit').where('familyId', '==', fam.id).get()).docs.map((d) => d.data()).filter((a) => a.action === 'rocket.migrated');
    assert.equal(audit.length, 1); assert.equal(audit[0].actor, 'emulator-operator'); assert.equal(audit[0].summary.v2HistoryCount, 1);
    assert.deepEqual(audit[0].summary.crew, [{ childId: nova.id, fuel: 6700, spent: 6700, otherSpent: 0 }, { childId: orion.id, fuel: 7100, spent: 7200, otherSpent: 100 }]);
    const repeat = cli('rocket', 'other.orion=100');
    assert.notEqual(repeat.status, 0); assert.match(repeat.stderr, /V2_ROCKET_ALREADY_IMPORTED/);
    assert.ok(repeat.stderr.includes(`rocketId ${cfg.rocketMigration.rocketId}`) && repeat.stderr.includes(String(cfg.rocketMigration.at)), 'the existing import is named');
    assert.equal((await configDoc.get()).data().rocket.id, cfg.rocket.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('a filtered page after a document id (queryAfter) on real Firestore: id order, only the filtered rows, inside and outside a transaction', async () => {
  const col = `qa-${randomUUID()}`;
  await store.transaction(async (tx) => { for (let i = 0; i < 7; i++) tx.set(`${col}/d${i}`, { familyId: i % 2 ? 'odd' : 'even', n: i }); });
  const p1 = await store.queryAfter(col, 'familyId', 'even', null, 2), p2 = await store.queryAfter(col, 'familyId', 'even', p1.at(-1)[0], 2), p3 = await store.queryAfter(col, 'familyId', 'even', p2.at(-1)[0], 2);
  assert.deepEqual([...p1, ...p2, ...p3].map(([id]) => id), ['d0', 'd2', 'd4', 'd6']); assert.deepEqual(p2, [['d4', { familyId: 'even', n: 4 }], ['d6', { familyId: 'even', n: 6 }]]); assert.deepEqual(p3, [], 'four rows in pages of two: the third page is empty');
  assert.deepEqual((await store.transaction((tx) => tx.queryAfter(col, 'familyId', 'odd', 'd1', 5), { readOnly: true })).map(([id]) => id), ['d3', 'd5']);
  assert.deepEqual(await store.queryAfter(col, 'familyId', 'none', null, 5), []);
});
test('the newest rows since a time (since, the feedback read) on real Firestore: at or after the time, newest first, at most the limit', async () => {
  const col = `since-${randomUUID()}`;
  await store.transaction(async (tx) => { for (let i = 0; i < 5; i++) tx.set(`${col}/d${i}`, { at: 1000 + i * 10, n: i }); });
  assert.deepEqual((await store.since(col, 'at', 1020, 10)).map(([id]) => id), ['d4', 'd3', 'd2']);
  assert.deepEqual(await store.since(col, 'at', 0, 2), [['d4', { at: 1040, n: 4 }], ['d3', { at: 1030, n: 3 }]]);
  assert.deepEqual(await store.since(col, 'at', 5000, 10), []);
});
